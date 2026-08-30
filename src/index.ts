/**
 * Host loader entry for the focus-view plugin: registers the
 * `/focus-chat-api` RPC channel that serves the conversation's turn index and
 * per-turn event slices to the browser half (the remote turn folds).
 *
 * No `@deepseek-ai/*` merge import lives here: the host faces of
 * dsh-client-connection / dsh-session cannot share this package's one tsc
 * program with the browser half's client faces, and the host half only needs
 * the two structurally-typed services in `host/rpc.ts`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerFocusRpc } from './host/rpc.ts'

/** Required services: the connection RPC registry and the session query engine. */
export const inject = ['connection', 'sessionQuery']

/**
 * Register the focus RPC channel as an effect, so plugin unload removes it.
 * @param ctx - host context carrying the connection and session-query services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFocusRpc(ctx), 'dsh-focus-chat: focus rpc channel')
}
