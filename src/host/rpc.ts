/**
 * Host-side RPC dispatch for the focus channel: wire validation, observation
 * leases, and error mapping on top of {@link computeTurnIndex}. Pure function
 * `computeTurnIndex` owns the derivation; this module owns the lease and the
 * dispatch. The two services are declared structurally: the host- and
 * client-connection faces cannot share one tsc program, and this module only
 * needs the RPC registry and one exact observation read.
 * @module dsh-focus-chat/host/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { FocusRpcValue, TurnEventsResponse, TurnIndexResponse } from '../protocol.ts'
import { FOCUS_RPC_CHANNEL } from '../protocol.ts'
import { computeTurnIndex } from './turn-index.ts'

/** One exact observation lease over a session log (the SessionObservation face this module reads). */
export interface FocusObservation {
  /** The session's durable events, in seq order. */
  readonly events: readonly SessionEvent[]
  /** Last observed event seq, or -1 for an empty log. */
  readonly cursor: number
  /** Release the lease (a prepared read holds a persistence borrow). */
  [Symbol.dispose]: () => void
}

/** The observation read face this module consumes (the SessionQueryEngine's exact read). */
export interface FocusSessionQuery {
  observeSession(
    sessionId: SessionId,
    options?: { signal?: AbortSignal; projectionMode?: 'all' | 'none' },
  ): Promise<FocusObservation>
}

/** The connection face this module consumes: the RPC channel registry. */
export interface FocusHostConnection {
  readonly rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<FocusRpcResult>,
    ): () => Promise<void>
  }
}

/** The channel's connection-generic result pair. */
export type FocusRpcResult =
  | { readonly ok: true; readonly value: FocusRpcValue }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

/** One validated request of the focus channel. */
type FocusRequest =
  | { readonly endpoint: 'focus/turnIndex'; readonly sessionId: string }
  | { readonly endpoint: 'focus/turnEvents'; readonly sessionId: string; readonly turn: number }

/** One channel failure with a connection-generic error code. */
function fail(code: string, message: string, details: object = {}): FocusRpcResult {
  return { ok: false, error: { code, message, details } }
}

function ok(value: FocusRpcValue): FocusRpcResult {
  return { ok: true, value }
}

/** Structural read of a session-query failure's stable code (the typed class is not imported at runtime). */
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Map one observation failure to the wire error: absence is `session-not-found`, everything else `internal`. */
function observationError(error: unknown, sessionId: string): FocusRpcResult {
  if (errorCode(error) === 'SESSION_QUERY_SESSION_NOT_FOUND') {
    return fail('session-not-found', error instanceof Error ? error.message : `session "${sessionId}" not found`, { sessionId })
  }
  return fail('internal', error instanceof Error ? error.message : String(error), {})
}

/** Validate the wire payload into one channel request, or a `bad-request` failure. */
function parseRequest(endpoint: string, payload: unknown): FocusRequest | FocusRpcResult {
  const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined
  const sessionId = record?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') {
    return fail('bad-request', `${endpoint}: sessionId must be a non-empty string`, {})
  }
  if (endpoint === 'focus/turnIndex') return { endpoint, sessionId }
  if (endpoint === 'focus/turnEvents') {
    const turn = record?.turn
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0) {
      return fail('bad-request', `${endpoint}: turn must be a non-negative integer`, {})
    }
    return { endpoint, sessionId, turn }
  }
  return fail('bad-request', `unknown endpoint: ${endpoint}`, {})
}

/**
 * Handle one focus channel request: observe the session under a lease, index
 * or slice, and release the lease before answering.
 * @param ctx - host context carrying `sessionQuery` and `connection`.
 * @param endpoint - channel-relative endpoint name.
 * @param payload - channel-owned request payload.
 * @param signal - caller cancellation for this request.
 * @returns the endpoint-owned success/error result.
 */
export async function handleFocusRpc(
  ctx: Context,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<FocusRpcResult> {
  const parsed = parseRequest(endpoint, payload)
  if (!('endpoint' in parsed)) return parsed
  const sessionQuery = ctx.get('sessionQuery') as FocusSessionQuery | undefined
  if (sessionQuery === undefined) {
    return fail('internal', 'session-query service is not mounted', { sessionId: parsed.sessionId })
  }
  const sessionId = parsed.sessionId as SessionId
  try {
    using observation = await sessionQuery.observeSession(sessionId, {
      signal,
      // The index and the slice read the raw log only; no consumer here reads
      // projection state, so the projection work stays off this read.
      projectionMode: 'none',
    })
    if (parsed.endpoint === 'focus/turnIndex') {
      const index = computeTurnIndex(observation.events)
      const value: TurnIndexResponse = { turns: index.turns, cursor: index.cursor }
      return ok(value)
    }
    const summary = computeTurnIndex(observation.events).turns
      .find(turn => turn.turn === parsed.turn)
    if (summary === undefined) {
      return fail('turn-not-found', `session "${parsed.sessionId}" has no completed turn ${parsed.turn}`, {
        sessionId: parsed.sessionId,
        turn: parsed.turn,
      })
    }
    const events = observation.events.filter(event => event.seq >= summary.startSeq && event.seq <= summary.endSeq)
    const value: TurnEventsResponse = {
      startSeq: summary.startSeq,
      endSeq: summary.endSeq,
      events,
    }
    return ok(value)
  } catch (error: unknown) {
    return observationError(error, parsed.sessionId)
  }
}

/**
 * Register the focus RPC channel on the host connection. The registration is
 * an effect: the caller wraps it, so plugin unload removes the channel.
 * @param ctx - host context carrying the connection and session-query services.
 * @returns the channel's disposer.
 */
export function registerFocusRpc(ctx: Context): () => Promise<void> {
  const connection = ctx.get('connection') as FocusHostConnection | undefined
  if (connection === undefined) {
    throw new Error('dsh-focus-chat: the connection service is required by the focus rpc channel')
  }
  return connection.rpc.handle(FOCUS_RPC_CHANNEL, (endpoint, payload, signal) =>
    handleFocusRpc(ctx, endpoint, payload, signal))
}
