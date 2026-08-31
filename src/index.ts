/**
 * Host loader entry for the focus-view plugin: registers the
 * `/focus-chat-api` RPC channel that serves the conversation's turn index and
 * per-turn event slices to the browser half (the remote turn folds), and
 * reserves the `dsh-focus-chat` settings namespace through the settings seam
 * (the plugin's own layer), keeping the name owned host-side.
 *
 * No `@deepseek-ai/*` merge import lives here: the host faces of
 * dsh-client-connection / dsh-session cannot share this package's one tsc
 * program with the browser half's client faces, and the host half only needs
 * the two structurally-typed services in `host/rpc.ts`.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settings service's Context merge (ctx.settings). The
// register API brands the namespace string itself (0.1.2-alpha.2 dropped the
// settingsNamespace() helper), so the literal is passed straight through.
import type {} from '@deepseek-ai/dsh-settings'
import { FOCUS_SETTINGS_NS } from './settings.ts'
import { FocusSettingsSchema } from './schema.ts'
import { registerFocusRpc } from './host/rpc.ts'

export { FOCUS_SETTINGS_NS } from './settings.ts'
export type { DiffStyle, FocusSettings, MdStyle } from './settings.ts'
export { DEFAULT_FOCUS_SETTINGS, DIFF_STYLES, MD_STYLES, isDiffStyle, isMdStyle, resolveFocusSettings } from './settings.ts'
export { FocusSettingsSchema } from './schema.ts'

/** Required services: the connection RPC registry and the session query engine. */
export const inject = ['connection', 'sessionQuery']

/**
 * Register the focus RPC channel and the settings namespace as effects, so
 * plugin unload removes them.
 * @param ctx - host context carrying the connection and session-query services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFocusRpc(ctx), 'dsh-focus-chat: focus rpc channel')
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(FOCUS_SETTINGS_NS, FocusSettingsSchema)
  })
}
