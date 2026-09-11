/**
 * Host loader entry for the focus-view plugin: registers the
 * `/focus-chat-api` RPC channel that serves the conversation's turn index and
 * per-turn event slices to the browser half (the remote turn folds), and
 * reserves the `dsh-focus-chat` settings namespace through the settings seam
 * (the plugin's own layer), keeping the name owned host-side.
 *
 * Both registrations are best-effort: a host whose connection registry or
 * settings seam cannot accept them logs a warning and continues, because an
 * optional capability must never abort the profile boot.
 *
 * No `@deepseek-ai/*` merge import lives here: the host faces of
 * dsh-client-connection / dsh-session cannot share this package's one tsc
 * program with the browser half's client faces, and the host half only needs
 * the two structurally-typed services in `host/rpc.ts`.
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: the settings service's Context merge (ctx.settings). The
// register API brands the namespace string itself (0.1.2-alpha.2 dropped the
// settingsNamespace() helper), so the literal is passed straight through.
import type {} from "@deepseek-ai/dsh-settings";
import { FOCUS_SETTINGS_NS } from "./settings.ts";
import { FocusSettingsSchema } from "./schema.ts";
import { registerFocusRpc } from "./host/rpc.ts";

export { FOCUS_SETTINGS_NS } from "./settings.ts";
export type { DiffStyle, FocusSettings, MdStyle } from "./settings.ts";
export {
  DEFAULT_FOCUS_SETTINGS,
  DIFF_STYLES,
  MD_STYLES,
  isDiffStyle,
  isMdStyle,
  resolveFocusSettings,
} from "./settings.ts";
export { FocusSettingsSchema } from "./schema.ts";

/** Required services: the connection RPC registry, session query engine, and web server carrier. */
export const inject = ["connection", "sessionQuery", "webServer"];

/**
 * Register the focus RPC channel and the settings namespace as effects, so
 * plugin unload removes them.
 * @param ctx - host context carrying the connection and session-query services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFocusChannel(ctx), "dsh-focus-chat: focus rpc channel");
  ctx.inject(["settings"], (settingsCtx) => {
    try {
      settingsCtx.settings.register(FOCUS_SETTINGS_NS, FocusSettingsSchema);
    } catch (error: unknown) {
      settingsCtx.logger("dsh-focus-chat").warn(
        "focus settings namespace registration failed; focus settings stay at their defaults: %s",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}

/**
 * Register the focus RPC channel without ever aborting the profile boot.
 *
 * The channel rides the host connection's generic RPC registry, whose
 * registration resolves `webServer` from the *connection plugin's* own
 * context. A connection build that cannot resolve it there throws (the
 * registry's owner context injects `credentials` only), and that throw used
 * to fail the whole `dsh web` boot. A missing optional capability must
 * degrade instead: the browser half then keeps the window-only flow and the
 * remote turn folds stay unavailable, so the failure is logged and the
 * channel becomes a no-op disposer.
 *
 * @param ctx - host context carrying the connection registry.
 * @returns the channel's disposer (a no-op when registration failed).
 */
function registerFocusChannel(ctx: Context): () => Promise<void> {
  try {
    return registerFocusRpc(ctx);
  } catch (error: unknown) {
    ctx.logger("dsh-focus-chat").warn(
      "focus rpc channel registration failed; remote turn folds stay disabled: %s",
      error instanceof Error ? error.message : String(error),
    );
    return async () => {};
  }
}
