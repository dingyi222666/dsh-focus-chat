/** Remote turn-slice projection: event slice → focus flow items. */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session/types'
import { projectTurnSlice } from '../src/client/model/turn-slice.ts'
import type { FocusFlowItem, FocusToolRow } from '../src/client/model/types.ts'

/** One log event cast from a loosely-typed shape (spec events stay core plus the merged kinds the wire carries). */
function ev(seq: number, time: number, type: string, data: Record<string, unknown>, surfaceOp?: unknown): SessionEvent {
  return { type, seq, time, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } as unknown as SessionEvent
}

function text(value: string): ContentBlock {
  return { type: 'text', text: value } as ContentBlock
}

const turnStart = (turn: number, seq: number, time: number): SessionEvent =>
  ev(seq, time, 'turn/start', { turn })
const stepStart = (turn: number, step: number, seq: number, time: number): SessionEvent =>
  ev(seq, time, 'step/start', { turn, step })
const turnEnd = (turn: number, seq: number, time: number, reason: Record<string, unknown> = { kind: 'completed' }): SessionEvent =>
  ev(seq, time, 'turn/end', { turn, reason })

function userMessage(seq: number, time: number, body: string, source: Record<string, unknown> = { kind: 'user' }): SessionEvent {
  return ev(seq, time, 'user/message', { id: `m${seq}`, role: 'user', content: [text(body)], source })
}

function assistantMessage(
  turn: number,
  step: number,
  seq: number,
  time: number,
  blocks: ContentBlock[],
  options: {
    messageId?: string
    usage?: Record<string, unknown>
    interrupted?: boolean
    /** The v2 settlement's embedded timed stream; empty by default. */
    stream?: readonly Record<string, unknown>[]
  } = {},
): SessionEvent {
  return ev(seq, time, 'assistant/message', {
    turn, step,
    message: {
      id: options.messageId ?? `a${seq}`, role: 'assistant', content: blocks,
      source: { kind: 'model', provider: 'prov', model: 'model-x' },
    },
    stream: options.stream ?? [],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.interrupted === true ? { interrupted: true } : {}),
  })
}

/** One v2 failed/aborted attempt: an embedded stream that commits no message. */
function assistantAttempt(
  turn: number,
  step: number,
  seq: number,
  time: number,
  stream: readonly Record<string, unknown>[],
): SessionEvent {
  return ev(seq, time, 'assistant/attempt', { turn, step, stream })
}

/** One compact text-run stream record starting at `time0` (v2 record shape). */
function textRun(time0: number, texts: readonly string[], dt: readonly number[] = []): Record<string, unknown> {
  return { type: 'text-chunks', time0, index: 0, dt, texts }
}

function toolCall(turn: number, step: number, seq: number, time: number, callId: string, name = 'bash', args = '{}'): SessionEvent {
  return ev(seq, time, 'tool/call', { turn, step, callId, name, arguments: args })
}

function toolResult(
  turn: number,
  step: number,
  seq: number,
  time: number,
  callId: string,
  body: string,
  options: { isError?: boolean; error?: { name: string; code: string } } = {},
): SessionEvent {
  return ev(seq, time, 'tool/result', {
    turn, step,
    message: {
      id: `r${seq}`, role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [text(body)], isError: options.isError === true }],
      source: { kind: 'tool', callId },
    },
    ...(options.error === undefined ? {} : { error: options.error }),
  })
}

function describeWork(work: readonly FocusFlowItem[]): string[] {
  return work.map(item => {
    switch (item.kind) {
      case 'message':
        return `${item.role}:${item.content.map(block => block.type === 'text' ? block.text : '').join('')}`
      case 'assistant':
        return `assistant:[${item.blocks.map(block => block.kind).join(',')}]`
      case 'tools':
        return `group(${item.group.metrics.commands}cmd,${item.group.metrics.jobs}jobs,${item.group.items.length}items)`
      case 'command':
        return `command:${item.name}:${item.outcomeText ?? 'running'}`
      case 'compaction':
        return `compaction:${item.summary === null ? 'none' : 'summary'}`
      case 'retry':
        return `retry:${item.retryState}`
      case 'turn-error':
        return `turn-error:${item.message}`
      case 'turn-max-tokens':
        return 'turn-max-tokens'
      default:
        return item.kind
    }
  })
}

describe('projectTurnSlice', () => {
  it('folds consecutive calls into one group, holds the closing reply out, and builds the tail', () => {
    const slice = projectTurnSlice([
      turnStart(7, 1, 1000),
      stepStart(7, 1, 2, 2000),
      assistantMessage(7, 1, 3, 2500, [{ type: 'reasoning', text: 'think' } as ContentBlock, text('running the checks')]),
      toolCall(7, 1, 4, 3000, 'c1'),
      toolResult(7, 1, 5, 3100, 'c1', 'ok'),
      toolCall(7, 1, 6, 3200, 'c2', 'read', '{"file_path":"a.ts"}'),
      toolResult(7, 1, 7, 3300, 'c2', 'body'),
      assistantMessage(7, 1, 8, 4000, [text('all green')], { messageId: 'final-1' }),
      turnEnd(7, 9, 5000),
    ], '/workspace', '/home/u')
    // The intermediate assistant row folds into the work with its reply only
    // — a leading think never paints a standalone row in the remote fold
    // (the fold line carries the turn already); the closing reply alone
    // stays out.
    expect(describeWork(slice.work)).toEqual(['assistant:[text]', 'group(1cmd,0jobs,2items)'])
    expect(slice.closing).not.toBeNull()
    const closing = slice.closing as Extract<FocusFlowItem, { kind: 'assistant' }>
    expect(closing.blocks.map(block => block.kind)).toEqual(['text'])
    expect(closing.finalSeq).toBe(8)
    expect(slice.tail).toMatchObject({
      kind: 'turn-tail', turn: 7, closingSeq: 8, closingMessageId: 'final-1',
      closingText: 'all green', runMs: 4000, branchUnavailable: true, produced: [],
    })
    expect(slice.tail?.kind === 'turn-tail' && slice.tail.closingTime).toBe(4000)
  })

  it('absorbs a following assistant reasoning into the group and keeps a leading think above the reply', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      toolCall(1, 1, 3, 3000, 'c1'),
      toolResult(1, 1, 4, 3100, 'c1', 'ok'),
      assistantMessage(1, 1, 5, 3200, [{ type: 'reasoning', text: 'after tools' } as ContentBlock, text('done')]),
      turnEnd(1, 6, 4000),
    ])
    const closing = slice.closing as Extract<FocusFlowItem, { kind: 'assistant' }>
    expect(closing.blocks.map(block => block.kind)).toEqual(['text'])
    // The reasoning rode the group: the work holds one group carrying the think.
    expect(describeWork(slice.work)).toEqual(['group(1cmd,0jobs,2items)'])
    const group = slice.work[0]
    if (group?.kind !== 'tools') throw new Error('expected a group')
    expect(group.group.items.some(item => !('callId' in item) && 'text' in item && item.text === 'after tools')).toBe(true)
  })

  it('keeps steering rows visible and separate the runs they sit between', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      userMessage(2, 1100, 'the ask'),
      stepStart(1, 1, 3, 2000),
      toolCall(1, 1, 4, 3000, 'c1'),
      toolResult(1, 1, 5, 3100, 'c1', 'ok'),
      userMessage(6, 3500, 'also check tests'),
      toolCall(1, 2, 7, 4000, 'c2'),
      toolResult(1, 2, 8, 4100, 'c2', 'ok'),
      assistantMessage(1, 2, 9, 4500, [text('done both')]),
      turnEnd(1, 10, 5000),
    ])
    expect(describeWork(slice.work)).toEqual([
      'group(1cmd,0jobs,1items)',
      'steering:also check tests',
      'group(1cmd,0jobs,1items)',
    ])
  })

  it('reads the prompt as the opening lane even though the agent loop logs it behind step/start', () => {
    // The real agent-loop order: step/start → prompt → context → attempts.
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 1100),
      userMessage(3, 1200, 'the ask'),
      userMessage(4, 1250, 'loaded instructions', { kind: 'plugin', plugin: 'watcher' }),
      assistantAttempt(1, 1, 5, 1300, [textRun(1300, ['hi'])]),
      assistantMessage(1, 1, 6, 1400, [text('reply')], { stream: [textRun(1300, ['reply'])] }),
      turnEnd(1, 7, 1500),
    ])
    // The prompt is the opening lane (never work), the context rides the work,
    // and nothing renders the prompt as a steering interjection.
    expect(describeWork(slice.work)).toEqual(['context:loaded instructions'])
  })

  it('absorbs notice injections into the adjacent run group with jobs counting and keeps other context individual', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      userMessage(3, 2100, 'loaded instructions', { kind: 'plugin', plugin: 'watcher' }),
      userMessage(4, 2200, 'background settled', { kind: 'plugin', plugin: 'tool-tasks', form: 'notice', summary: 'bash [status: completed]' }),
      toolCall(1, 1, 5, 3000, 'c1'),
      toolResult(1, 1, 6, 3100, 'c1', 'ok'),
      assistantMessage(1, 1, 7, 4000, [text('done')]),
      turnEnd(1, 8, 5000),
    ])
    expect(describeWork(slice.work)).toEqual([
      'context:loaded instructions',
      'group(1cmd,1jobs,2items)',
    ])
  })

  it('drops a tool-call-heads-only assistant row (the dead gap)', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      assistantMessage(1, 1, 3, 2500, [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' } as ContentBlock]),
      toolCall(1, 1, 4, 3000, 'c1'),
      toolResult(1, 1, 5, 3100, 'c1', 'ok'),
      assistantMessage(1, 1, 6, 4000, [text('done')]),
      turnEnd(1, 7, 5000),
    ])
    expect(describeWork(slice.work)).toEqual(['group(1cmd,0jobs,1items)'])
  })

  it('pairs command run and done events', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      ev(2, 1100, 'command/run', { commandId: 'cmd1', name: 'compact', args: '' }),
      ev(3, 1200, 'command/done', { commandId: 'cmd1', kind: 'error', text: 'nothing to compact' }),
      stepStart(1, 1, 4, 2000),
      assistantMessage(1, 1, 5, 3000, [text('ok')]),
      turnEnd(1, 6, 4000),
    ])
    expect(describeWork(slice.work)).toEqual(['command:compact:nothing to compact'])
    const command = slice.work[0]
    if (command?.kind !== 'command') throw new Error('expected a command row')
    expect(command.outcomeError).toBe(true)
    expect(command.running).toBe(false)
  })

  it('renders retry chains: started when re-dispatched, cancelled when the turn closed first', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      ev(3, 2500, 'llm/retry', { retryId: 'r1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 3, delayMs: 500, failure: { message: 'boom', code: 'X' } }),
      ev(4, 3000, 'llm/retry-started', { retryId: 'r1', turn: 1, step: 1, retry: 1 }),
      ev(5, 3100, 'llm/retry', { retryId: 'r1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 2, maxRetries: 3, delayMs: 900, failure: { message: 'boom again', code: 'X' } }),
      turnEnd(1, 6, 4000, { kind: 'error', error: { message: 'provider down', code: 'PROVIDER' } }),
    ])
    expect(describeWork(slice.work)).toEqual(['retry:cancelled', 'turn-error:provider down'])
    const [retry, turnError] = slice.work
    if (retry?.kind !== 'retry' || turnError?.kind !== 'turn-error') throw new Error('unexpected rows')
    expect(retry.mode).toBe('normal')
    expect(retry.maxRetries).toBe(3)
    expect(retry.failure).toEqual({ message: 'boom again' })
    expect(turnError.code).toBe('PROVIDER')
  })

  it('marks a retry started when its re-dispatch landed inside the turn', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      ev(3, 2500, 'llm/retry', { retryId: 'r1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 3, delayMs: 500, failure: { message: 'boom', code: 'X' } }),
      ev(4, 3000, 'llm/retry-started', { retryId: 'r1', turn: 1, step: 1, retry: 1 }),
      assistantMessage(1, 1, 5, 4000, [text('recovered')]),
      turnEnd(1, 6, 5000),
    ])
    expect(describeWork(slice.work)).toEqual(['retry:started'])
  })

  it('renders the max-tokens notice for a capped turn', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      assistantMessage(1, 1, 3, 3000, [text('truncated repl…')]),
      turnEnd(1, 4, 4000, { kind: 'max-tokens' }),
    ])
    expect(describeWork(slice.work)).toEqual(['turn-max-tokens'])
    expect(slice.closing).not.toBeNull()
  })

  it('nests code-dispatch subcalls under their parent root', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      toolCall(1, 1, 3, 3000, 'root1', 'run_code', '{"code":"..."}'),
      ev(4, 3100, 'tool/code-dispatch-start', { rootCallId: 'root1', parentCallId: 'root1', subCallId: 'root1:code:1', name: 'read', arguments: { file_path: 'a.ts' } }),
      ev(5, 3200, 'tool/code-dispatch', { rootCallId: 'root1', parentCallId: 'root1', subCallId: 'root1:code:1', name: 'read', arguments: { file_path: 'a.ts' }, isError: false, content: [text('file body')] }),
      toolResult(1, 1, 6, 3300, 'root1', 'program done'),
      assistantMessage(1, 1, 7, 4000, [text('done')]),
      turnEnd(1, 8, 5000),
    ])
    expect(describeWork(slice.work)).toEqual(['group(0cmd,0jobs,1items)'])
    const group = slice.work[0]
    if (group?.kind !== 'tools') throw new Error('expected a group')
    const root = group.group.items.find(item => 'callId' in item) as FocusToolRow | undefined
    expect(root?.subcalls).toHaveLength(1)
    expect(root?.subcalls[0]?.summary).toBe('a.ts')
  })

  it('freezes unpaired calls as synthetic interruptions on an interrupted turn', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      toolCall(1, 1, 3, 3000, 'c1'),
      assistantMessage(1, 1, 4, 3500, [text('partial')], { interrupted: true }),
      turnEnd(1, 5, 4000, { kind: 'interrupted' }),
    ])
    expect(describeWork(slice.work)).toEqual(['group(1cmd,0jobs,1items)'])
    const group = slice.work[0]
    if (group?.kind !== 'tools') throw new Error('expected a group')
    const row = group.group.items.find(item => 'callId' in item) as FocusToolRow | undefined
    expect(row?.state).toBe('stopped')
    expect(slice.closing !== null && slice.closing.kind === 'assistant' && slice.closing.interrupted).toBe(true)
    // A durable finalized prefix carries its message id (the interruption
    // fallback without one is the chunk-only synthetic, absent from the log).
    expect(slice.tail?.kind === 'turn-tail' && slice.tail.closingMessageId).toBe('a4')
  })

  it('aggregates provider token usage across the turn attempts', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      assistantMessage(1, 1, 3, 3000, [text('one')], {
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 5, totalTokens: 40 },
      }),
      stepStart(1, 2, 4, 3100),
      assistantMessage(1, 2, 5, 4000, [text('two')], {
        usage: { inputTokens: 7, outputTokens: 13, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 4, totalTokens: 25 },
      }),
      turnEnd(1, 6, 5000),
    ])
    expect(slice.tail?.kind === 'turn-tail' && slice.tail.tokenUsage).toEqual({
      uncachedInputTokens: 17,
      outputTokens: 33,
      totalTokens: 65,
      cacheReadTokens: 8,
      cacheWriteTokens: 7,
      // The first attempt reports no reasoning bucket, so the aggregate omits it.
      routes: [{ provider: 'prov', model: 'model-x' }],
    })
  })

  it('derives first-step TTFT and decode throughput from the embedded stream timing', () => {
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      stepStart(1, 1, 2, 2000),
      assistantMessage(1, 1, 3, 3400, [text('answer')], {
        stream: [textRun(2400, ['a', 'nswer'], [1000])],
        usage: { inputTokens: 1, outputTokens: 100, cacheReadTokens: 1, cacheWriteTokens: 1, totalTokens: 103 },
      }),
      turnEnd(1, 4, 4000),
    ])
    expect(slice.tail?.kind === 'turn-tail').toBe(true)
    if (slice.tail?.kind !== 'turn-tail') return
    expect(slice.tail.ttftMs).toBe(400)
    // 100 tokens decoded over 3400-2400 = 1000ms → 100 tok/s.
    expect(slice.tail.tokensPerSecond).toBeCloseTo(100, 5)
  })

  it('pairs a compaction checkpoint with its summary evidence', () => {
    const checkpointSource = { kind: 'plugin', plugin: 'compact', compactionId: 'cp1' }
    const slice = projectTurnSlice([
      turnStart(1, 1, 1000),
      ev(2, 1100, 'compaction/start', { compactionId: 'cp1', turn: 1 }),
      ev(3, 1200, 'compaction/summary', { compactionId: 'cp1', summary: [text('summary body')], shadowedSeqs: [1, 2, 3], shadowedTokenCount: 900 }),
      ev(4, 1300, 'compaction/end', { compactionId: 'cp1', turn: 1 }),
      ev(5, 1400, 'user/message', { id: 'cp', role: 'user', content: [text('compacted')], source: checkpointSource }, { op: 'replace', start: 1, end: 3 }),
      stepStart(1, 1, 6, 2000),
      assistantMessage(1, 1, 7, 3000, [text('after compaction')]),
      turnEnd(1, 8, 4000),
    ])
    expect(describeWork(slice.work)).toEqual(['compaction:summary'])
    const compaction = slice.work[0]
    if (compaction?.kind !== 'compaction') throw new Error('expected a compaction row')
    expect(compaction.summary).toBe('summary body')
    expect(compaction.shadowedItemCount).toBe(3)
    expect(compaction.shadowedTokenCount).toBe(900)
  })

  it('returns empty work for a slice without a turn boundary', () => {
    expect(projectTurnSlice([userMessage(1, 100, 'loose')])).toEqual({ work: [], closing: null, tail: null })
  })
})
