/**
 * Minimal `window.__ModuleLoader__` for tests: the npm client packages ship
 * as `window.__ModuleLoader__.load({ id, factory })` closures that expect the
 * browser shell's module table. This shim executes the factory against the
 * installed platform externals and captures the module's exports, so vitest
 * can consume the bundled values through the runtime shim.
 */
import * as cordis from '@deepseek-ai/cordis'
import * as uiSlots from '@deepseek-ai/dsh-client-ui-slots'

/** Platform externals the bundled factories require by bare specifier. */
const EXTERNALS: Readonly<Record<string, unknown>> = {
  '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-client-ui-slots': uiSlots,
}

/** Exports of every bundle the loader has executed, by bundle id. */
export const modules = new Map<string, Record<string, unknown>>()

declare global {
  interface Window {
    __ModuleLoader__?: {
      load(entry: { id: string; factory: (require: (specifier: string) => unknown) => unknown }): void
    }
  }
}

window.__ModuleLoader__ = {
  load(entry) {
    const require = (specifier: string): unknown => {
      const external = EXTERNALS[specifier]
      if (external !== undefined) return external
      throw new Error(`test loader: unhandled external "${specifier}" from ${entry.id}`)
    }
    modules.set(entry.id, entry.factory(require) as Record<string, unknown>)
  },
}
