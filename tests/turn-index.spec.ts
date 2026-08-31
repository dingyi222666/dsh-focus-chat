/** Host turn-index derivation: completed-turn summaries over one session log. */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session/types'
import { computeTurnIndex } from '../src/host/turn-index.ts'

/** One log event cast from a loosely-typed core shape (the spec builds core events only). */
function ev(seq: number, time: number, type: SessionEventType, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

function text(text: string): ContentBlock {
  return { type: 'text', text } as ContentBlock
}

function userMessage(seq: number, time: number, body: string, source: Record<string, unknown> = { kind: 'user' }): SessionEvent {
  return ev(seq, time, 'user/message', { id: `m${seq}`, role: 'user', content: [text(body)], source })
}

function assistantMessage(
  turn: number,
  step: number,
  seq: number,
  time: number,
  blocks: ContentBlock[],
  messageId = `a${seq}`,
): SessionEvent {
  return ev(seq, time, 'assistant/message', {
    turn, step,
    message: { id: messageId, role: 'assistant', content: blocks, source: { kind: 'model', provider: 'p', model: 'm' } },
  })
}

const turnStart = (turn: number, seq: number, time: number): SessionEvent =>
  ev(seq, time, 'turn/start', { turn })
const stepStart = (turn: number, step: number, seq: number, time: number): SessionEvent =>
  ev(seq, time, 'step/start', { turn, step })
const turnEnd = (turn: number, seq: number, time: number, reason: Record<string, unknown> = { kind: 'completed' }): SessionEvent =>
  ev(seq, time, 'turn/end', { turn, reason })

describe('computeTurnIndex', () => {
  it('summarizes every completed turn: boundaries, stopped flag, closing reply, and opening lane', () => {
    // The real agent-loop order: the step opens before the prompt is logged,
    // so the opening lane's boundary is the first assistant activity.
    const index = computeTurnIndex([
      userMessage(1, 100, 'outside any turn'),
      turnStart(1, 2, 200),
      stepStart(1, 1, 3, 250),
      userMessage(4, 300, 'hello'),
      assistantMessage(1, 1, 5, 500, [text('working reply')]),
      assistantMessage(1, 1, 6, 600, [text('final reply\nsecond line')]),
      turnEnd(1, 7, 1700),
      turnStart(2, 8, 2000),
      stepStart(2, 1, 9, 2050),
      userMessage(10, 2100, 'second ask'),
      turnEnd(2, 11, 3000, { kind: 'interrupted' }),
    ])
    expect(index.cursor).toBe(11)
    expect(index.turns).toHaveLength(2)
    const [first, second] = index.turns
    expect(first).toMatchObject({
      turn: 1, startSeq: 2, endSeq: 7, startTime: 200, endTime: 1700,
      stopped: false, closingSeq: 6, closingMessageId: 'a6', closingTime: 600,
      closingContent: [text('final reply\nsecond line')],
    })
    expect(first.opening).toEqual([{ seq: 4, time: 300, role: 'user', content: [text('hello')] }])
    expect(second).toMatchObject({
      turn: 2, startSeq: 8, endSeq: 11, startTime: 2000, endTime: 3000,
      stopped: true, closingSeq: null, closingMessageId: null, closingTime: null, closingContent: null,
    })
    expect(second.opening).toEqual([{ seq: 10, time: 2100, role: 'user', content: [text('second ask')] }])
  })

  it('keeps a running turn out of the index while the cursor still observes the log tail', () => {
    const index = computeTurnIndex([
      turnStart(1, 1, 100),
      stepStart(1, 1, 2, 200),
      assistantMessage(1, 1, 3, 300, [text('reply')]),
      turnEnd(1, 4, 400),
      turnStart(2, 5, 500),
      stepStart(2, 1, 6, 600),
    ])
    expect(index.turns.map(turn => turn.turn)).toEqual([1])
    expect(index.cursor).toBe(6)
  })

  it('collects only pre-activity user-source messages as the opening lane', () => {
    const index = computeTurnIndex([
      turnStart(1, 1, 100),
      stepStart(1, 1, 2, 150),
      userMessage(3, 180, 'the prompt'),
      userMessage(4, 190, 'injected context', { kind: 'plugin', plugin: 'watcher' }),
      assistantMessage(1, 1, 5, 200, [text('working reply')]),
      userMessage(6, 300, 'steering interjection'),
      userMessage(7, 310, 'injected notice', { kind: 'plugin', plugin: 'jobs', form: 'notice', summary: 'settled' }),
      turnEnd(1, 8, 400),
    ])
    const [only] = index.turns
    expect(only.opening.map(message => message.seq)).toEqual([3])
  })

  it('carries the closing reply as full durable blocks, whatever their shape', () => {
    const longReply = [text('a'.repeat(500)), { type: 'reasoning', text: 'r' } as ContentBlock]
    const index = computeTurnIndex([
      turnStart(1, 1, 100),
      stepStart(1, 1, 2, 200),
      assistantMessage(1, 1, 3, 300, longReply, 'a3'),
      turnEnd(1, 4, 400),
    ])
    const [only] = index.turns
    expect(only.closingSeq).toBe(3)
    expect(only.closingMessageId).toBe('a3')
    expect(only.closingTime).toBe(300)
    expect(only.closingContent).toEqual(longReply)
  })

  it('keeps the last text-bearing reply as the closing one', () => {
    const index = computeTurnIndex([
      turnStart(1, 1, 100),
      stepStart(1, 1, 2, 200),
      assistantMessage(1, 1, 3, 300, [text('tool-only-ish')]),
      assistantMessage(1, 2, 4, 400, [{ type: 'reasoning', text: 'r' } as ContentBlock, text('closing')]),
      turnEnd(1, 5, 500),
    ])
    const [only] = index.turns
    expect(only.closingSeq).toBe(4)
    expect(only.closingContent).toEqual([{ type: 'reasoning', text: 'r' } as ContentBlock, text('closing')])
  })

  it('ignores a turn/end without a matching open turn and replaces an abandoned open turn', () => {
    const index = computeTurnIndex([
      turnEnd(9, 1, 100),
      turnStart(1, 2, 200),
      stepStart(1, 1, 3, 300),
      // A repair shape: a new boundary opens while turn 1 never ended.
      turnStart(2, 4, 400),
      stepStart(2, 1, 5, 500),
      turnEnd(2, 6, 600),
    ])
    expect(index.turns.map(turn => turn.turn)).toEqual([2])
    expect(index.turns[0].startSeq).toBe(4)
  })

  it('returns an empty index and cursor -1 for an empty log', () => {
    expect(computeTurnIndex([])).toEqual({ turns: [], cursor: -1 })
  })
})

describe('focus rpc host handler', () => {
  /** A not-found failure shaped like the session-query taxonomy (the typed class is host-only). */
  function notFound(): Error {
    return Object.assign(new Error('session "s1" not found'), { name: 'SessionQueryError', code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
  }

  interface QueryStub {
    events: SessionEvent[]
    cursor: number
    /** Set once the observation lease is disposed. */
    disposed: boolean
    error: Error | null
  }

  /** A ctx carrying only the structural services the handler reads. */
  function ctxWith(query: QueryStub): { ctx: never; leases: number } {
    let leases = 0
    const ctx = {
      get(name: string): unknown {
        if (name !== 'sessionQuery') return undefined
        return {
          observeSession: async () => {
            leases += 1
            if (query.error !== null) throw query.error
            return {
              events: query.events,
              cursor: query.cursor,
              [Symbol.dispose]: () => { query.disposed = true },
            }
          },
        }
      },
    }
    return { ctx: ctx as never, leases }
  }

  const log: SessionEvent[] = [
    turnStart(1, 1, 100),
    stepStart(1, 1, 2, 200),
    assistantMessage(1, 1, 3, 300, [text('reply')]),
    turnEnd(1, 4, 400),
  ]

  async function handle(ctx: never, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code: string }; disposed: boolean }> {
    const stub: QueryStub = (ctx as { __stub: QueryStub }).__stub
    const { handleFocusRpc } = await import('../src/host/rpc.ts')
    const result = await handleFocusRpc(ctx, endpoint, payload, new AbortController().signal)
    return { ...result, disposed: stub.disposed }
  }

  it('serves the turn index and releases the observation lease', async () => {
    const stub: QueryStub = { events: log, cursor: 4, disposed: false, error: null }
    const { ctx } = ctxWith(stub)
    ;(ctx as { __stub: QueryStub }).__stub = stub
    const result = await handle(ctx, 'focus/turnIndex', { sessionId: 's1' })
    expect(result.ok).toBe(true)
    expect((result.value as { turns: unknown[]; cursor: number }).turns).toHaveLength(1)
    expect((result.value as { cursor: number }).cursor).toBe(4)
    expect(result.disposed).toBe(true)
  })

  it('serves one turn event slice over the closed interval', async () => {
    const stub: QueryStub = { events: log, cursor: 3, disposed: false, error: null }
    const { ctx } = ctxWith(stub)
    ;(ctx as { __stub: QueryStub }).__stub = stub
    const result = await handle(ctx, 'focus/turnEvents', { sessionId: 's1', turn: 1 })
    expect(result.ok).toBe(true)
    const value = result.value as { startSeq: number; endSeq: number; events: { seq: number }[] }
    expect(value.startSeq).toBe(1)
    expect(value.endSeq).toBe(4)
    expect(value.events.map(event => event.seq)).toEqual([1, 2, 3, 4])
    expect(result.disposed).toBe(true)
  })

  it('reports turn-not-found for a running or unknown turn', async () => {
    const stub: QueryStub = { events: log, cursor: 3, disposed: false, error: null }
    const { ctx } = ctxWith(stub)
    ;(ctx as { __stub: QueryStub }).__stub = stub
    const result = await handle(ctx, 'focus/turnEvents', { sessionId: 's1', turn: 9 })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('turn-not-found')
  })

  it('validates the wire payload', async () => {
    const stub: QueryStub = { events: log, cursor: 3, disposed: false, error: null }
    const { ctx } = ctxWith(stub)
    ;(ctx as { __stub: QueryStub }).__stub = stub
    expect((await handle(ctx, 'focus/turnIndex', {})).error?.code).toBe('bad-request')
    expect((await handle(ctx, 'focus/turnIndex', { sessionId: '' })).error?.code).toBe('bad-request')
    expect((await handle(ctx, 'focus/turnEvents', { sessionId: 's1', turn: -1 })).error?.code).toBe('bad-request')
    expect((await handle(ctx, 'focus/turnEvents', { sessionId: 's1', turn: 1.5 })).error?.code).toBe('bad-request')
    expect((await handle(ctx, 'focus/other', { sessionId: 's1' })).error?.code).toBe('bad-request')
  })

  it('maps absence to session-not-found and other failures to internal', async () => {
    const missing: QueryStub = { events: [], cursor: -1, disposed: false, error: notFound() }
    const { ctx } = ctxWith(missing)
    ;(ctx as { __stub: QueryStub }).__stub = missing
    expect((await handle(ctx, 'focus/turnIndex', { sessionId: 'gone' })).error?.code).toBe('session-not-found')
    const broken: QueryStub = { events: [], cursor: -1, disposed: false, error: new Error('storage offline') }
    const { ctx: brokenCtx } = ctxWith(broken)
    ;(brokenCtx as { __stub: QueryStub }).__stub = broken
    expect((await handle(brokenCtx, 'focus/turnIndex', { sessionId: 's1' })).error?.code).toBe('internal')
  })

  it('registers the channel through the connection registry and applies via effect', async () => {
    const channels: string[] = []
    const handlers: unknown[] = []
    const disposers: string[] = []
    const connection = {
      rpc: {
        handle: (channel: string, handler: unknown): (() => Promise<void>) => {
          channels.push(channel)
          handlers.push(handler)
          return async () => { disposers.push(channel) }
        },
      },
    }
    const effectDisposers: Array<() => Promise<void>> = []
    const ctx = {
      get: (name: string): unknown => name === 'connection' ? connection : undefined,
      effect: (factory: () => () => Promise<void>): (() => Promise<void>) => {
        const disposer = factory()
        effectDisposers.push(disposer)
        return disposer
      },
      // The settings namespace registration is a no-op here (no settings
      // service in this unit harness); the RPC channel is what this test
      // asserts.
      inject: (): unknown => ({ settings: { register: () => {} } }),
    } as never
    const { apply } = await import('../src/index.ts')
    ;(apply as (ctx: never) => void)(ctx)
    expect(channels).toEqual(['/focus-chat-api'])
    expect(handlers).toHaveLength(1)
    for (const disposer of effectDisposers) await disposer()
    expect(disposers).toEqual(['/focus-chat-api'])
  })
})
