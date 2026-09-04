/**
 * Remote turn-slice projection: the durable event slice of one completed
 * turn → the focus flow items its expanded row renders. React-free, in the
 * same posture as `toolRowModel`: the chat's derivations, reimplemented here
 * because the bundle cannot import another plugin's runtime values.
 *
 * Fold semantics align with `flow.ts` (0.1.22): consecutive tool calls fold
 * into one group, directly-consecutive runs merge, context injections
 * (including turn-less notices, counted as background jobs) absorb into the
 * adjacent run, steering interjections stay visible rows between runs, and
 * the closing reply's reasoning moves out of the reply row. Settled history
 * never consumes chunk rows — `assistant/message` carries the final blocks
 * and its embedded stream feeds the step timing (thinking time, TTFT, decode
 * throughput) only.
 * @module dsh-focus-chat/client/model/turn-slice
 */

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import { expandAssistantStream, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Pulls the dsh-commands SessionEventMap augmentation (the command/run and
// command/done event kinds this projection renders as command rows) into the
// compile graph: the events are declared by the commands package, not by the
// base session vocabulary.
import type {} from '@deepseek-ai/dsh-commands/types'
import type {
  AssistantBlock, ContextProvenanceView, KnownContextForm, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { toolGroup } from './tools.ts'
import type { FocusContextItem, FocusFlowItem, FocusGroupThink, TurnTokenUsage } from './types.ts'

/** One projected turn: the work rows, the closing reply, and the turn tail. */
export interface TurnSlice {
  /** The turn's interior rows in flow order: context folds, tool groups, intermediate rows, steering bubbles. */
  readonly work: readonly FocusFlowItem[]
  /** The closing reply's assistant row; null when the turn has no text reply. */
  readonly closing: FocusFlowItem | null
  /** The turn-tail row (branch disabled; the deliverables lane is window-only). */
  readonly tail: FocusFlowItem | null
}

/** One pre-fold row in the slice's scan order. */
interface ProtoItem {
  readonly kind: 'message' | 'assistant' | 'tool' | 'command' | 'compaction' | 'retry' | 'turn-error' | 'turn-max-tokens'
  readonly seq: number
  readonly time: number
  /** Message protos: the classified role and content. */
  role?: 'steering' | 'context' | 'user'
  content?: readonly ContentBlock[]
  context?: { source: unknown; provenance: ContextProvenanceView; form: KnownContextForm | null }
  /** Assistant protos: the classified blocks and settled facts. */
  blocks?: readonly AssistantBlock[]
  interrupted?: boolean
  thoughtMs?: number | null
  messageId?: string | null
  /** Marks the closing reply (held out of `work` and emitted as `closing`). */
  closing?: boolean
  /** Tool protos: the root block (running or settled). */
  block?: ToolCallBlock
  /** Prebuilt flow item for command / compaction / retry / notice protos. */
  item?: FocusFlowItem
}

/** Per-step timing facts derived from the step lifecycle and its token deltas. */
interface StepTiming {
  stepStartTime: number
  firstTokenTime: number | null
  completedTime: number | null
  outputTokens: number | null
}

/* ── Event-shape readers (structural: the slice rides a wire boundary) ── */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record === null ? undefined : record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Whether one user/message event is a compaction's replacement checkpoint. */
function isCompactionCheckpoint(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = asRecord(event.data.source)
  return source !== null
    && source.kind === 'plugin'
    && source.plugin === 'compact'
    && typeof source.compactionId === 'string'
    && isReplacementSurface(event)
}

/** Whether one session event carries a surface-replace op (compaction checkpoints). */
function isReplacementSurface(event: SessionEvent): boolean {
  const replace = asRecord((event as { surfaceOp?: unknown }).surfaceOp)
  return replace !== null && replace.op === 'replace'
}

/** Whether a stream chunk carries visible model output (the chat timing rule). */
function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/**
 * Feed one durable assistant event's embedded stream into a step's first-token
 * timing (the chat's v2 rule: the first visible delta across the whole step,
 * retried attempts included — the first expanded member that is a token delta
 * wins, and later events never overwrite it). Stream member order is
 * chronological, so the first hit IS the step's first token.
 */
function applyStreamTiming(step: StepTiming | undefined, stream: readonly AssistantStreamRecord[]): void {
  if (step === undefined || step.firstTokenTime !== null) return
  for (const member of expandAssistantStream(stream)) {
    if (isTokenDelta(member.chunk)) {
      step.firstTokenTime = member.time
      break
    }
  }
}

/* ── Classifications reimplemented from the chat projection (type-only reference) ── */

/** Forms the chat presents structurally; unknown merge-extensible values stay opaque. */
const KNOWN_FORMS: readonly KnownContextForm[] = [
  'instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall',
]

function contextForm(source: unknown): KnownContextForm | null {
  const record = asRecord(source)
  const form = readString(record, 'form')
  return form !== null && (KNOWN_FORMS as readonly string[]).includes(form) ? form as KnownContextForm : null
}

function collectLabels(source: Record<string, unknown> | null, member: string, field: string): string[] {
  const list = source === null ? undefined : source[member]
  if (!Array.isArray(list)) return []
  const seen: string[] = []
  for (const entry of list) {
    const value = readString(asRecord(entry), field)
    if (value !== null && !seen.includes(value)) seen.push(value)
  }
  return seen
}

function contextProvenance(source: unknown): ContextProvenanceView {
  const record = asRecord(source)
  const kind = readString(record, 'kind')
  if (record === null || kind === null) return { role: 'inject', label: null }
  switch (kind) {
    case 'session-reference':
      return { role: 'recall', label: joined(collectLabels(record, 'references', 'label')) ?? kind }
    case 'agent-instructions':
      return { role: 'inject', label: joined(collectLabels(record, 'changes', 'path')) ?? kind }
    case 'plugin':
      return { role: 'inject', label: readString(record, 'plugin') ?? kind }
    case 'skill-invocation':
      return { role: 'inject', label: readString(record, 'name') ?? kind }
    default:
      return { role: 'inject', label: kind }
  }
}

function joined(names: readonly string[]): string | null {
  return names.length > 0 ? names.join(', ') : null
}

/** Classify one finalized assistant block (the chat's content switch). */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

/** Sanitize a durable failure to display-safe fields (the chat's rule: AUTH messages never persist to UI state). */
function displayFailure(failure: unknown): { code?: string; message: string } {
  if (failure === null || typeof failure !== 'object') return { message: String(failure) }
  const record = asRecord(failure)
  if (record === null) return { message: String(failure) }
  const code = readString(record, 'code') ?? undefined
  if (code === 'AUTH') return { code, message: '' }
  const message = readString(record, 'message')
  return {
    ...(code === undefined ? {} : { code }),
    message: message ?? JSON.stringify(failure),
  }
}

/* ── Turn-level token accounting (the best-effort aggregate) ── */

interface AttemptUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
  readonly route?: { readonly provider: string; readonly model: string }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

/** Validate one reported usage sample into a countable attempt; undefined discards it. */
function normalizeUsage(usage: Record<string, unknown>, route?: AttemptUsage['route']): AttemptUsage | undefined {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens } = usage
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) return undefined
  const knownPrompt = safeSum([
    inputTokens,
    ...cacheReadTokens === undefined ? [] : [cacheReadTokens],
    ...cacheWriteTokens === undefined ? [] : [cacheWriteTokens],
  ])
  if (knownPrompt === undefined) return undefined
  let exactTotal: number
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined
    const exactPrompt = totalTokens - outputTokens
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined
    exactTotal = totalTokens
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined
    const derivedTotal = safeSum([knownPrompt, outputTokens])
    if (derivedTotal === undefined) return undefined
    exactTotal = derivedTotal
  }
  return {
    inputTokens, outputTokens, totalTokens: exactTotal,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(route === undefined ? {} : { route }),
  }
}

function everyDefined<T>(values: readonly (T | undefined)[]): values is readonly T[] {
  return values.every(value => value !== undefined)
}

/** Aggregate the turn's attempt samples; a bucket's presence requires every attempt to report it. */
function aggregateUsage(attempts: readonly AttemptUsage[]): TurnTokenUsage | undefined {
  if (attempts.length === 0) return undefined
  const inputTokens = safeSum(attempts.map(attempt => attempt.inputTokens))
  const outputTokens = safeSum(attempts.map(attempt => attempt.outputTokens))
  const totalTokens = safeSum(attempts.map(attempt => attempt.totalTokens))
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined
  const cacheReadTokens = everyDefined(attempts.map(attempt => attempt.cacheReadTokens))
    ? safeSum(attempts.map(attempt => attempt.cacheReadTokens as number))
    : undefined
  const cacheWriteTokens = everyDefined(attempts.map(attempt => attempt.cacheWriteTokens))
    ? safeSum(attempts.map(attempt => attempt.cacheWriteTokens as number))
    : undefined
  const reasoningTokens = everyDefined(attempts.map(attempt => attempt.reasoningTokens))
    ? safeSum(attempts.map(attempt => attempt.reasoningTokens as number))
    : undefined
  let routes: readonly { provider: string; model: string }[] | undefined
  if (everyDefined(attempts.map(attempt => attempt.route))) {
    const unique = new Map<string, { provider: string; model: string }>()
    for (const route of attempts.map(attempt => attempt.route as NonNullable<AttemptUsage['route']>)) {
      unique.set(`${route.provider}\0${route.model}`, route)
    }
    routes = [...unique.values()]
  }
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(routes === undefined ? {} : { routes }),
  }
}

/* ── The projection ── */

/**
 * Project one completed turn's durable event slice into the focus flow items.
 * @param events - the `[turn/start..turn/end]` closed event slice, in seq order.
 * @param cwd - session workspace root for relative path summaries.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the turn's work rows, closing reply, and tail row.
 */
export function projectTurnSlice(events: readonly SessionEvent[], cwd?: string, home?: string): TurnSlice {
  const turnStart = events.find(event => event.type === 'turn/start')
  if (turnStart === undefined || turnStart.type !== 'turn/start') return { work: [], closing: null, tail: null }
  const turn = turnStart.data.turn
  const keyOf = (kind: string, seq: number): string => `remote:${turn}:${kind}${seq}`

  /* Pass 1: the scan — lifecycle pairing, timing, usage, and the proto stream. */
  const protos: ProtoItem[] = []
  const attempts: AttemptUsage[] = []
  const timing = new Map<number, StepTiming>()
  /** Settled or running root blocks by call id (a result replaces its running call). */
  const roots = new Map<string, ToolCallBlock>()
  /** Running call heads by call id, for the result's paired call head. */
  const runningHeads = new Map<string, { name: string; argsRaw: string; time: number }>()
  /** Code-dispatch children by parent call id, in dispatch order. */
  const children = new Map<string, ToolCallBlock[]>()
  /** Command protos by commandId, for the done update and the compaction pairing. */
  const commandProtos = new Map<string, ProtoItem>()
  /** Compaction summary evidence by compactionId, for the checkpoint marker. */
  const compactionSummaries = new Map<string, {
    summary: string | null
    shadowedItemCount: number | null
    shadowedTokenCount: number | null
  }>()
  /** Retry chains by producer retryId: the first attempt's seq, the last attempt's payload, and the started retry number. */
  const retryChains = new Map<string, { firstSeq: number; last: Record<string, unknown>; startedRetry: number | null }>()
  /** Whether the turn has seen its first assistant activity — the boundary
   *  that separates the opening lane (pre-activity user messages) from the
   *  steering lane. `step/start` is not a boundary: the agent loop logs the
   *  step before it admits the prompt, so the prompt rides behind it. */
  let sawActivity = false
  let closingProto: ProtoItem | null = null
  let lastStep = 0
  let endSeq: number | null = null
  let endTime: number | null = null
  let endReason: unknown = undefined

  const attachChild = (parentCallId: string, child: ToolCallBlock): void => {
    const siblings = children.get(parentCallId)
    if (siblings === undefined) children.set(parentCallId, [child])
    else siblings.push(child)
  }

  for (const event of events) {
    switch (event.type) {
      case 'step/start': {
        lastStep = Math.max(lastStep, event.data.step)
        if (!timing.has(event.data.step)) {
          timing.set(event.data.step, { stepStartTime: event.time, firstTokenTime: null, completedTime: null, outputTokens: null })
        }
        continue
      }
      case 'step/end':
        continue
      case 'assistant/attempt': {
        // One model attempt that committed no surface message (stream error,
        // aborted finish, or cancel with no visible prefix): it marks the
        // step active and feeds first-token timing, but paints no row.
        sawActivity = true
        applyStreamTiming(timing.get(event.data.step), event.data.stream)
        continue
      }
      case 'user/message': {
        if (isCompactionCheckpoint(event)) {
          const source = asRecord(event.data.source)
          const compactionId = readString(source, 'compactionId') ?? ''
          const summary = compactionSummaries.get(compactionId)
          const sourceCommandId = readString(source, 'sourceCommandId')
          const compaction = {
            summary: summary?.summary ?? null,
            shadowedItemCount: summary?.shadowedItemCount ?? null,
            shadowedTokenCount: summary?.shadowedTokenCount ?? null,
          }
          const commandProto = sourceCommandId === null ? undefined : commandProtos.get(sourceCommandId)
          if (commandProto !== undefined && commandProto.item?.kind === 'command') {
            // Manual compaction: the command row gains its compaction evidence,
            // anchored at the checkpoint like the chat's manual-compaction node.
            commandProto.item = {
              kind: 'manual-compaction',
              nodeKey: keyOf('cp', event.seq),
              name: commandProto.item.name,
              outcomeText: commandProto.item.outcomeText,
              outcomeError: commandProto.item.outcomeError,
              running: commandProto.item.running,
              compaction,
            }
          } else {
            protos.push({
              kind: 'compaction', seq: event.seq, time: event.time,
              item: { kind: 'compaction', nodeKey: keyOf('cp', event.seq), ...compaction },
            })
          }
          continue
        }
        const source = asRecord(event.data.source)
        if (source === null || source.kind !== 'user') {
          protos.push({
            kind: 'message', seq: event.seq, time: event.time, role: 'context',
            content: event.data.content,
            context: { source: event.data.source, provenance: contextProvenance(event.data.source), form: contextForm(event.data.source) },
          })
          continue
        }
        // The opening lane renders from the summary, never from the work.
        if (!sawActivity) continue
        protos.push({ kind: 'message', seq: event.seq, time: event.time, role: 'steering', content: event.data.content })
        continue
      }
      case 'assistant/message': {
        sawActivity = true
        const blocks = event.data.message.content.map(toAssistantBlock)
        const step = timing.get(event.data.step)
        // The embedded stream carries the step's first-token timing (the
        // v2 settlement's exact timed model stream).
        applyStreamTiming(step, event.data.stream)
        const usage = asRecord(event.data.usage)
        if (step !== undefined) {
          step.completedTime = event.time
          if (usage !== null && isCount(usage.outputTokens)) step.outputTokens = usage.outputTokens
        }
        const thoughtMs = step !== undefined
          && step.firstTokenTime !== null
          && step.firstTokenTime > step.stepStartTime
          ? step.firstTokenTime - step.stepStartTime
          : null
        const proto: ProtoItem = {
          kind: 'assistant', seq: event.seq, time: event.time,
          blocks, interrupted: event.data.interrupted === true,
          thoughtMs, messageId: event.data.message.id,
        }
        if (blocks.some(block => block.kind === 'text' && block.text.trim() !== '')) {
          if (closingProto !== null) closingProto.closing = false
          proto.closing = true
          closingProto = proto
        }
        // One usage-bearing message is one best-effort attempt sample.
        if (usage !== null) {
          const messageSource = asRecord(event.data.message.source)
          const route = messageSource !== null
            && typeof messageSource.provider === 'string' && messageSource.provider.length > 0
            && typeof messageSource.model === 'string' && messageSource.model.length > 0
            ? { provider: messageSource.provider, model: messageSource.model }
            : undefined
          const normalized = normalizeUsage(usage, route)
          if (normalized !== undefined) attempts.push(normalized)
        }
        protos.push(proto)
        continue
      }
      case 'tool/call': {
        sawActivity = true
        runningHeads.set(event.data.callId, { name: event.data.name, argsRaw: event.data.arguments, time: event.time })
        const running: ToolCallBlock = {
          callId: event.data.callId, name: event.data.name, argsRaw: event.data.arguments,
          turn: event.data.turn, step: event.data.step, time: event.time, subCalls: [],
        }
        roots.set(event.data.callId, running)
        protos.push({ kind: 'tool', seq: event.seq, time: event.time, block: running })
        continue
      }
      case 'tool/result': {
        sawActivity = true
        const callId = event.data.message.source.callId
        const head = runningHeads.get(callId)
        const content = event.data.message.content[0]
        const settled: ToolResultNode = {
          kind: 'tool-result', seq: event.seq, time: event.time, callId,
          call: head === undefined ? null : { name: head.name, argsRaw: head.argsRaw },
          callTime: head?.time ?? null,
          content: content.content,
          isError: content.isError === true,
          ...(event.data.error === undefined ? {} : { error: event.data.error }),
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
          subCalls: [],
        }
        roots.set(callId, settled)
        runningHeads.delete(callId)
        const index = protos.findLastIndex(candidate => candidate.kind === 'tool' && candidate.block?.callId === callId)
        const replacement: ProtoItem = { kind: 'tool', seq: event.seq, time: event.time, block: settled }
        if (index >= 0) protos[index] = replacement
        else protos.push(replacement)
        continue
      }
      case 'command/run': {
        const proto: ProtoItem = {
          kind: 'command', seq: event.seq, time: event.time,
          item: {
            kind: 'command', nodeKey: keyOf('c', event.seq), name: event.data.name,
            args: event.data.args ?? null, outcomeText: null, outcomeError: false, running: true,
          },
        }
        commandProtos.set(event.data.commandId, proto)
        protos.push(proto)
        continue
      }
      case 'command/done': {
        const proto = commandProtos.get(event.data.commandId)
        const outcomeText = event.data.text ?? null
        const outcomeError = event.data.kind === 'error'
        if (proto !== undefined && proto.item?.kind === 'command') {
          proto.item = { ...proto.item, running: false, outcomeText, outcomeError }
        } else {
          protos.push({
            kind: 'command', seq: event.seq, time: event.time,
            item: {
              kind: 'command', nodeKey: keyOf('c', event.seq), name: null, args: null,
              outcomeText, outcomeError, running: false,
            },
          })
        }
        continue
      }
      case 'turn/end': {
        endSeq = event.seq
        endTime = event.time
        endReason = event.data.reason
        continue
      }
      default: {
        // Plugin-merged event kinds (`compaction/*`, `llm/retry*`) ride the
        // merge-extensible map: this program may not see every declaring
        // module's types, so the extended kinds read structurally.
        const kind: string = event.type
        const data = asRecord(event.data)
        if (kind === 'compaction/summary' && data !== null) {
          const summaryBlocks: unknown = data.summary
          const text = Array.isArray(summaryBlocks)
            ? summaryBlocks
              .map(block => asRecord(block) !== null && (block as { type?: unknown }).type === 'text'
                ? String((block as { text?: unknown }).text ?? '')
                : '')
              .join('')
            : ''
          const compactionId = readString(data, 'compactionId')
          if (compactionId !== null) {
            compactionSummaries.set(compactionId, {
              summary: text.trim() === '' ? null : text,
              shadowedItemCount: Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : null,
              shadowedTokenCount: isCount(data.shadowedTokenCount) ? data.shadowedTokenCount : null,
            })
          }
          continue
        }
        if (kind === 'llm/retry' && data !== null) {
          const retryId = readString(data, 'retryId')
          if (retryId === null) continue
          const existing = retryChains.get(retryId)
          retryChains.set(retryId, {
            firstSeq: existing?.firstSeq ?? event.seq,
            last: data,
            startedRetry: existing?.startedRetry ?? null,
          })
          continue
        }
        if (kind === 'llm/retry-started' && data !== null) {
          const retryId = readString(data, 'retryId')
          const chain = retryId === null ? undefined : retryChains.get(retryId)
          if (chain !== undefined && isCount(data.retry)) chain.startedRetry = data.retry
          continue
        }
        continue
      }
    }
  }

  // Code-dispatch subcalls: `tool/code-dispatch-start` opens a running child
  // under its parent, `tool/code-dispatch` settles it (paired by subCallId).
  for (const event of events) {
    const kind: string = event.type
    if (kind !== 'tool/code-dispatch-start' && kind !== 'tool/code-dispatch') continue
    const data = asRecord(event.data)
    if (data === null) continue
    const parentCallId = readString(data, 'parentCallId')
    const subCallId = readString(data, 'subCallId')
    if (parentCallId === null || subCallId === null) continue
    const siblings = children.get(parentCallId) ?? []
    const index = siblings.findIndex(child => child.callId === subCallId)
    const previous = index === -1 ? undefined : siblings[index]
    if (kind === 'tool/code-dispatch-start') {
      if (previous !== undefined) continue
      attachChild(parentCallId, {
        callId: subCallId, parentCallId,
        name: readString(data, 'name') ?? '',
        argsRaw: JSON.stringify(data.arguments ?? null),
        turn, step: lastStep, time: event.time, subCalls: [],
      })
      continue
    }
    const settledChild: ToolCallBlock = {
      kind: 'tool-result', seq: event.seq, time: event.time, callId: subCallId, parentCallId,
      call: {
        name: readString(data, 'name') ?? '',
        argsRaw: JSON.stringify(data.arguments ?? null),
      },
      callTime: previous === undefined || 'kind' in previous ? previous?.time ?? null : previous.time,
      content: Array.isArray(data.content) ? data.content as readonly ContentBlock[] : [],
      isError: data.isError === true,
      subCalls: [],
    }
    if (previous === undefined) attachChild(parentCallId, settledChild)
    else siblings[index] = settledChild
  }

  // Children nest into their parent roots, recursively.
  const nestChildren = (block: ToolCallBlock, depth: number): ToolCallBlock => {
    const direct = children.get(block.callId)
    if (direct === undefined || direct.length === 0 || depth > 16) return block
    const nested = direct.map(child => nestChildren(child, depth + 1))
    const same = block.subCalls.length === nested.length && block.subCalls.every((child, index) => child === nested[index])
    return same ? block : { ...block, subCalls: nested }
  }
  for (const [callId, block] of roots) roots.set(callId, nestChildren(block, 0))

  // Retry chains emit one row each, anchored at the chain's first attempt.
  const retryProtos: ProtoItem[] = []
  for (const chain of retryChains.values()) {
    const current = chain.last
    const mode = current.mode === 'always' ? 'always' : 'normal'
    const retryState = chain.startedRetry !== null && chain.startedRetry === current.retry ? 'started' : 'cancelled'
    const failure = asRecord(current.failure)
    retryProtos.push({
      kind: 'retry', seq: chain.firstSeq, time: 0,
      item: {
        kind: 'retry',
        nodeKey: keyOf('r', chain.firstSeq),
        delayMs: isCount(current.delayMs) ? current.delayMs : 0,
        retry: isCount(current.retry) ? current.retry : 1,
        maxRetries: mode === 'normal' ? (isCount(current.maxRetries) ? current.maxRetries : null) : null,
        mode,
        retryState,
        failure: failure === null ? null : { message: typeof failure.message === 'string' ? failure.message : '' },
      },
    })
  }
  retryProtos.sort((left, right) => left.seq - right.seq)
  for (const proto of retryProtos) {
    const index = protos.findIndex(candidate => candidate.seq > proto.seq)
    if (index === -1) protos.push(proto)
    else protos.splice(index, 0, proto)
  }

  // Terminal turn-end notices anchor at the turn's last position (after the
  // closing reply in the window flow; here they lead the reply rows, which
  // reads the truncation or failure before the reply that it explains).
  const reasonRecord = asRecord(endReason)
  if (reasonRecord !== null && reasonRecord.kind === 'error') {
    const display = displayFailure(reasonRecord.error)
    protos.push({
      kind: 'turn-error', seq: endSeq ?? Number.MAX_SAFE_INTEGER, time: endTime ?? 0,
      item: {
        kind: 'turn-error', nodeKey: keyOf('te', endSeq ?? 0),
        message: display.message, code: display.code,
      },
    })
  } else if (reasonRecord !== null && reasonRecord.kind === 'max-tokens') {
    protos.push({
      kind: 'turn-max-tokens', seq: endSeq ?? Number.MAX_SAFE_INTEGER, time: endTime ?? 0,
      item: { kind: 'turn-max-tokens', nodeKey: keyOf('mt', endSeq ?? 0) },
    })
  }

  // A completed turn freezes its still-running calls as synthetic interruptions
  // (the chat's interruption fallback): the stop is the user's, not a failure.
  if (endSeq !== null && endTime !== null) {
    for (const proto of protos) {
      if (proto.kind !== 'tool' || proto.block === undefined || 'kind' in proto.block) continue
      proto.block = {
        kind: 'tool-result',
        seq: endSeq - 0.8,
        time: endTime,
        callId: proto.block.callId,
        call: { name: proto.block.name, argsRaw: proto.block.argsRaw },
        callTime: proto.block.time,
        content: [],
        isError: true,
        error: { name: 'Interrupted', code: 'interrupted' },
        subCalls: [],
      }
    }
  }

  /* Pass 2: the fold — flow.ts's pushItem semantics over the proto stream. */
  const work: FocusFlowItem[] = []
  let pending: { keys: string[]; blocks: ToolCallBlock[] } | null = null
  let pendingContext: FocusContextItem[] = []
  let closingBlocks: readonly AssistantBlock[] = []
  let closingInterrupted = false

  /** Emit the buffered run as one group row (with context absorption and run merging). */
  const flushRun = (): void => {
    if (pending === null) return
    const runKeys = pending.keys
    // The code-dispatch tree nests at read time: the protos hold the roots
    // without their subcalls until the dispatch loop has paired them all.
    const runBlocks = pending.blocks.map(block => nestChildren(block, 0))
    pending = null
    if (runBlocks.length === 0) return
    const previousAfterAssistant = work.at(-1)
    let contextProbe = previousAfterAssistant
    if (contextProbe !== undefined && contextProbe.kind === 'assistant') {
      contextProbe = work.length > 1 ? work.at(-2) : undefined
    }
    let absorbedContext: readonly FocusContextItem[] = []
    if (contextProbe !== undefined && contextProbe.kind === 'context-fold') {
      absorbedContext = contextProbe.items
      work.splice(work.length - (contextProbe === previousAfterAssistant ? 1 : 2), 1)
    }
    const group = toolGroup(runBlocks, cwd, null, [], home)
    // A notice-form injection (a tool-jobs settlement) counts into the jobs
    // family; its row still expands inside the group with the notice body.
    const noticeJobs = absorbedContext.filter(item => item.context?.form === 'notice').length
    const folded: FocusFlowItem = {
      kind: 'tools',
      group: {
        ...group,
        nodeKeys: runKeys,
        items: [...absorbedContext, ...group.items],
        contextCount: absorbedContext.length - noticeJobs,
        context: absorbedContext,
        metrics: { ...group.metrics, jobs: group.metrics.jobs + noticeJobs },
      },
    }
    const previousItem = work.at(-1)
    if (previousItem !== undefined && previousItem.kind === 'tools') {
      const prev = previousItem.group
      const next = folded.group
      work[work.length - 1] = {
        kind: 'tools',
        group: {
          nodeKeys: [...prev.nodeKeys, ...next.nodeKeys],
          items: [...prev.items, ...next.items],
          running: prev.running || next.running,
          metrics: {
            commands: prev.metrics.commands + next.metrics.commands,
            edits: prev.metrics.edits + next.metrics.edits,
            searches: prev.metrics.searches + next.metrics.searches,
            webSearches: prev.metrics.webSearches + next.metrics.webSearches,
            fetches: prev.metrics.fetches + next.metrics.fetches,
            files: prev.metrics.files + next.metrics.files,
            dirs: prev.metrics.dirs + next.metrics.dirs,
            subagents: prev.metrics.subagents + next.metrics.subagents,
            todos: prev.metrics.todos + next.metrics.todos,
            goals: prev.metrics.goals + next.metrics.goals,
            workflows: prev.metrics.workflows + next.metrics.workflows,
            skills: prev.metrics.skills + next.metrics.skills,
            questions: prev.metrics.questions + next.metrics.questions,
            plans: prev.metrics.plans + next.metrics.plans,
            jobs: prev.metrics.jobs + next.metrics.jobs,
            commandsFailed: prev.metrics.commandsFailed + next.metrics.commandsFailed,
            searchesFailed: prev.metrics.searchesFailed + next.metrics.searchesFailed,
            webSearchesFailed: prev.metrics.webSearchesFailed + next.metrics.webSearchesFailed,
          },
          contextCount: prev.contextCount + next.contextCount,
          context: [...prev.context, ...next.context],
          thoughtMs: prev.thoughtMs === null ? next.thoughtMs
            : next.thoughtMs === null ? prev.thoughtMs
              : prev.thoughtMs + next.thoughtMs,
        },
      }
      return
    }
    work.push(folded)
  }

  const flushContext = (): void => {
    if (pendingContext.length === 0) return
    const first = pendingContext[0]
    if (first === undefined) return
    work.push({ kind: 'context-fold', nodeKey: first.nodeKey, turn, items: pendingContext })
    pendingContext = []
  }

  /**
   * Land the buffered rows in flow.ts's order: the context batch first (a
   * standalone folded line, or the row the run's group absorption pulls in),
   * then the run's group.
   */
  const flushPending = (): void => {
    flushContext()
    flushRun()
  }

  /** Absorb one assistant's settled reasoning into a directly-preceding run group; returns the remaining blocks. */
  const absorbReasoning = (proto: ProtoItem, blocks: readonly AssistantBlock[]): readonly AssistantBlock[] => {
    const previous = work.at(-1)
    if (proto.interrupted === true
      || !blocks.some(block => block.kind === 'reasoning')
      || previous === undefined || previous.kind !== 'tools') return blocks
    const group = previous.group
    const think: readonly FocusGroupThink[] = blocks
      .filter((block): block is Extract<AssistantBlock, { kind: 'reasoning' }> => block.kind === 'reasoning')
      .map(block => ({ text: block.text, running: false }))
    const thoughtMs = proto.thoughtMs ?? null
    work[work.length - 1] = {
      kind: 'tools',
      group: {
        ...group,
        items: [...group.items, ...think],
        thoughtMs: group.thoughtMs === null ? thoughtMs
          : thoughtMs === null ? group.thoughtMs
            : group.thoughtMs + thoughtMs,
      },
    }
    return blocks.filter(block => block.kind !== 'reasoning')
  }

  for (const proto of protos) {
    switch (proto.kind) {
      case 'tool': {
        if (pending === null) pending = { keys: [], blocks: [] }
        pending.keys.push(keyOf('t', proto.seq))
        if (proto.block !== undefined) pending.blocks.push(proto.block)
        continue
      }
      case 'message': {
        if (proto.role === 'context') {
          // Background notices batch into the fold that the adjacent run's
          // group absorbs (the 0.1.22 turn-less-notice semantics, jobs
          // counted); every other injection buffers individually inside the
          // completed turn's work (the completed-turn fold's own rows).
          if (proto.context?.form === 'notice') {
            const item: FocusContextItem = {
              kind: 'message', nodeKey: keyOf('m', proto.seq), role: 'context',
              content: proto.content ?? [], time: proto.time,
              context: proto.context ?? { source: undefined, provenance: { role: 'inject', label: null }, form: null },
            }
            pendingContext.push(item)
            continue
          }
          flushPending()
          work.push({
            kind: 'message', nodeKey: keyOf('m', proto.seq), role: 'context',
            content: proto.content ?? [], time: proto.time,
            context: proto.context ?? { source: undefined, provenance: { role: 'inject', label: null }, form: null },
          })
          continue
        }
        flushPending()
        work.push({
          kind: 'message', nodeKey: keyOf('m', proto.seq), role: proto.role ?? 'steering',
          content: proto.content ?? [], time: proto.time,
        })
        continue
      }
      case 'command':
      case 'compaction':
      case 'retry':
      case 'turn-error':
      case 'turn-max-tokens': {
        flushPending()
        if (proto.item !== undefined) work.push(proto.item)
        continue
      }
      case 'assistant': {
        let blocks = proto.blocks ?? []
        // The closing reply is held out of the work stream entirely.
        if (proto.closing === true) {
          if (pending !== null) flushPending()
          if (!blocks.some(block => block.kind !== 'tool-call')) { closingProto = null; continue }
          blocks = absorbReasoning(proto, blocks)
          flushContext()
          // A leading think with no preceding run to absorb into: the window
          // flow folds it into the worked line; the remote fold's line
          // carries the turn already, so the think drops rather than painting
          // a stray row beside the reply.
          blocks = blocks.filter(block => block.kind !== 'reasoning')
          closingBlocks = blocks
          closingInterrupted = proto.interrupted === true
          continue
        }
        // The main loop's flush precedes pushItem: a pending run lands (with
        // its context absorption) before the assistant row is considered.
        if (pending !== null) flushPending()
        // Dead gap: a settled assistant that paints nothing — only tool-call
        // heads — drops so no empty row sits between the runs it separates.
        if (!proto.interrupted && !blocks.some(block => block.kind !== 'tool-call')) continue
        blocks = absorbReasoning(proto, blocks)
        // A leading think with no preceding run to absorb into never paints a
        // standalone row in the remote fold — the work shows the runs and
        // the replies only.
        blocks = blocks.filter(block => block.kind !== 'reasoning')
        if (blocks.length === 0) continue
        if (!proto.interrupted && !blocks.some(block => block.kind !== 'tool-call')) continue
        flushContext()
        work.push({
          kind: 'assistant', nodeKey: keyOf('a', proto.seq),
          blocks, running: false, interrupted: proto.interrupted === true,
          thoughtMs: proto.thoughtMs ?? null, finalSeq: proto.seq,
        })
        continue
      }
    }
  }
  flushPending()

  /* Pass 3: the closing reply and the tail row. */
  let closing: FocusFlowItem | null = null
  let closingMessageId: string | null = null
  let closingTime: number | null = null
  let closingSeq: number | null = null
  let closingText = ''
  if (closingProto !== null && closingProto.blocks !== undefined) {
    closingSeq = closingProto.seq
    closingMessageId = closingProto.messageId ?? null
    closingTime = closingProto.time
    closingText = closingBlocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
    closing = {
      kind: 'assistant', nodeKey: keyOf('a', closingProto.seq),
      blocks: closingBlocks, running: false, interrupted: closingInterrupted,
      thoughtMs: closingProto.thoughtMs ?? null, finalSeq: closingProto.seq,
    }
  }

  const runMs = endTime === null ? null : Math.max(0, endTime - turnStart.time)
  const timedSteps = [...timing.values()].filter(step => step.firstTokenTime !== null)
  const firstStep = timedSteps.length > 0
    ? timedSteps.reduce((best, step) => step.stepStartTime < best.stepStartTime ? step : best)
    : undefined
  const ttftMs = firstStep !== undefined && firstStep.firstTokenTime !== null
    ? Math.max(0, firstStep.firstTokenTime - firstStep.stepStartTime)
    : null
  let decodeMs = 0
  let decodeTokens = 0
  for (const step of timedSteps) {
    if (step.completedTime === null || step.firstTokenTime === null || step.outputTokens === null) continue
    const ms = step.completedTime - step.firstTokenTime
    if (ms <= 0) continue
    decodeMs += ms
    decodeTokens += step.outputTokens
  }
  const tokensPerSecond = decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : null

  const tail: FocusFlowItem = {
    kind: 'turn-tail',
    nodeKey: `remote:${turn}:tail`,
    turn,
    closingSeq,
    closingMessageId,
    closingTime,
    closingText,
    runMs,
    ttftMs,
    tokensPerSecond,
    branchUnavailable: true,
    produced: [],
    tokenUsage: aggregateUsage(attempts),
  }

  return { work, closing, tail }
}
