/**
 * Wire contract of the focus RPC channel, shared by the host and client
 * halves (type-only: every import here is erased from both bundles).
 *
 * The channel rides the Connection RPC registry at `/focus-chat-api` with
 * two endpoints:
 *  - `focus/turnIndex`  `{ sessionId }` → `{ turns, cursor }`
 *  - `focus/turnEvents` `{ sessionId, turn }` → `{ startSeq, endSeq, events }`
 * @module dsh-focus-chat/protocol
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/**
 * One event entry of the durable session log, serialized verbatim. The
 * plugin-merged event vocabulary (`command/*`, `compaction/*`, `llm/retry`,
 * `tool/code-dispatch*`, …) rides the same merge-extensible `SessionEventMap`
 * the host wrote, so consumers read extended kinds structurally.
 */
export type SessionEventEntry = SessionEvent

/** One turn-opening user message, reduced to the durable fields the collapsed row renders. */
export interface TurnOpeningMessage {
  /** Seq of the `user/message` event. */
  seq: number
  /** Unix epoch ms of the message event. */
  time: number
  /** Constant `'user'`: the opening lane only ever collects user-source messages. */
  role: 'user'
  /** Exact model-facing blocks of the message. */
  content: readonly ContentBlock[]
}

/** One completed turn's condensed facts, derived once per session log on the Host. */
export interface TurnSummary {
  /** The turn number (`turn/start` payload). */
  turn: number
  /** Seq of the `turn/start` event (inclusive slice start). */
  startSeq: number
  /** Seq of the `turn/end` event (inclusive slice end). */
  endSeq: number
  /** Unix epoch ms of the `turn/start` event. */
  startTime: number
  /** Unix epoch ms of the `turn/end` event. */
  endTime: number
  /** The turn ended interrupted: the fold line reads "用户 X 后停止". */
  stopped: boolean
  /** Last text-bearing assistant reply's event seq; null when the turn has none. */
  closingSeq: number | null
  /** Durable message id of that reply; null when the turn has none. */
  closingMessageId: string | null
  /**
   * That reply's full durable message, carried so a turn whose rows lie beyond
   * the loaded window still renders the real reply directly; null when the
   * turn has none.
   */
  closingTime: number | null
  closingContent: readonly ContentBlock[] | null
  /** User-source messages before the turn's first assistant activity, in log order. */
  opening: readonly TurnOpeningMessage[]
}

/** Payload of `focus/turnIndex`. */
export interface TurnIndexRequest {
  /** Non-empty logical session id. */
  sessionId: string
}

/** Result of `focus/turnIndex`: every completed turn's summary plus the log cursor. */
export interface TurnIndexResponse {
  /** Completed turns in log order; a running or crashed-open turn is absent. */
  turns: readonly TurnSummary[]
  /** Last observed event seq of the session log, or -1 for an empty log. */
  cursor: number
}

/** Payload of `focus/turnEvents`. */
export interface TurnEventsRequest {
  /** Non-empty logical session id. */
  sessionId: string
  /** Non-negative turn number that must exist in the turn index. */
  turn: number
}

/**
 * Result of `focus/turnEvents`: the complete durable event slice of one turn,
 * closed interval `[startSeq..endSeq]` — boundary events, messages, chunks,
 * tool calls and results, commands, compaction lifecycle, retries, headers.
 */
export interface TurnEventsResponse {
  /** Seq of the turn's `turn/start` event. */
  startSeq: number
  /** Seq of the turn's `turn/end` event. */
  endSeq: number
  /** Every log event whose seq falls inside the closed interval, in seq order. */
  events: readonly SessionEventEntry[]
}

/** The channel's response value union (the RPC result `value`). */
export type FocusRpcValue = TurnIndexResponse | TurnEventsResponse

/** The shared RPC channel the host registers and the client calls. */
export const FOCUS_RPC_CHANNEL = '/focus-chat-api'
