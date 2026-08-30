/**
 * Host-side turn index: one O(n) scan over the durable session log that
 * derives every completed turn's condensed summary. Pure function — the RPC
 * layer owns observation leases and dispatch; this module owns the derivation.
 * @module dsh-focus-chat/host/turn-index
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TurnOpeningMessage, TurnSummary } from '../protocol.ts'

/** The complete turn index over one session log. */
export interface TurnIndex {
  /** Completed turns in log order; a running or crash-opened turn is absent. */
  readonly turns: readonly TurnSummary[]
  /** Last observed event seq of the log, or -1 for an empty log. */
  readonly cursor: number
}

/** The event kinds that mark the model's first activity inside a turn. The
 *  turn's opening user messages are the user-source ones logged before the
 *  earliest of these — `step/start` is NOT a boundary: the agent loop logs the
 *  step before it admits the prompt, so the prompt rides behind it. */
const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/** One settled `assistant/message` event reduced to the fields the flow rows render. */
export interface ClosingMessage {
  /** Seq of the `assistant/message` event. */
  readonly seq: number
  /** Unix epoch ms of the message event. */
  readonly time: number
  /** Durable message id (the per-message actions' address). */
  readonly messageId: string
  /** Exact model-facing blocks of the reply. */
  readonly content: readonly ContentBlock[]
}

/** Total text of an `assistant/message` event's text blocks (the reply body). */
function messageText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content
    .map(block => block.type === 'text' ? block.text : '')
    .join('')
}

/** Whether one log event carries a readable `source.kind` of `'user'`. */
function isUserSource(event: Extract<SessionEvent, { type: 'user/message' }>): boolean {
  const source: unknown = event.data.source
  return typeof source === 'object' && source !== null
    && (source as { kind?: unknown }).kind === 'user'
}

/** Read one `assistant/message` event into the durable closing shape. */
function closingOf(event: Extract<SessionEvent, { type: 'assistant/message' }>): ClosingMessage {
  return {
    seq: event.seq,
    time: event.time,
    messageId: event.data.message.id,
    content: event.data.message.content,
  }
}

/**
 * Derive the turn index from one session log.
 *
 * Position cursor: every event between `turn/start(T)` and `turn/end(T)`
 * belongs to turn `T` — user messages and other events without a turn field
 * read their membership from position. Only completed turns (a matching
 * `turn/end` was seen) enter the index: a running turn, and a turn whose
 * start was abandoned by a later boundary, stay out. The log is append-only,
 * so an index over a prefix of the log never invalidates.
 * @param events - the session's durable events, in seq order.
 * @returns one turn per completed turn, plus the log cursor.
 */
export function computeTurnIndex(events: readonly SessionEvent[]): TurnIndex {
  const turns: TurnSummary[] = []
  /** The turn currently open in the scan; null outside any turn. */
  let open: {
    turn: number
    startSeq: number
    startTime: number
    sawActivity: boolean
    stopped: boolean
    closing: ClosingMessage | null
    opening: TurnOpeningMessage[]
  } | null = null

  const close = (endTime: number, endSeq: number): void => {
    if (open === null) return
    turns.push({
      turn: open.turn,
      startSeq: open.startSeq,
      endSeq,
      startTime: open.startTime,
      endTime,
      stopped: open.stopped,
      closingSeq: open.closing?.seq ?? null,
      closingMessageId: open.closing?.messageId ?? null,
      closingTime: open.closing?.time ?? null,
      closingContent: open.closing?.content ?? null,
      opening: open.opening,
    })
    open = null
  }

  for (const event of events) {
    if (event.type === 'turn/start') {
      // A still-open predecessor (interrupted by a new boundary — a repair
      // shape the invariant companion guards against) never had an end event,
      // so it stays out of the index.
      open = {
        turn: event.data.turn,
        startSeq: event.seq,
        startTime: event.time,
        sawActivity: false,
        stopped: false,
        closing: null,
        opening: [],
      }
      continue
    }
    if (open === null) continue
    if (event.type === 'turn/end') {
      if (event.data.turn !== open.turn) continue
      if (event.data.reason.kind === 'interrupted') open.stopped = true
      close(event.time, event.seq)
      continue
    }
    if (event.type === 'user/message') {
      // User-source messages before the first assistant activity are the
      // turn's opening lane; later ones are steering, which the slice
      // projection renders from the log.
      if (!open.sawActivity && isUserSource(event)) {
        open.opening.push({ seq: event.seq, time: event.time, role: 'user', content: event.data.content })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      if (messageText(event).trim() !== '') open.closing = closingOf(event)
      open.sawActivity = true
      continue
    }
    if (ACTIVITY_TYPES.has(event.type)) open.sawActivity = true
  }
  return { turns, cursor: events.at(-1)?.seq ?? -1 }
}
