/**
 * Focus view plugin, browser half: one condensed conversation surface in the
 * view ring — every run of Tool calls folds into an expandable step-summary
 * line ("思考了 36 秒，运行了 2 个命令，探索了 17 个文件，18 个目录"), and
 * reasoning rows expand while running and fold in on completion. Pure-consumer
 * plugin: registers the 'focus' tab into the conversation view slot, provides
 * no service, declares no Context merge.
 */
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the runtime's cordis Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { FocusKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The focus view's copy. */
    focus: FocusKey
  }
}

export type { FocusKey } from './locales.ts'
export type { FocusScrollPosition, FocusTurnTailOwner, FocusViewInjected, FocusViewProps } from './contract/props.ts'

// The single assembly point (the chat plugin's layout): the apply body and
// its service declaration live in apply.ts; this entry re-exports them.
export { apply, inject } from './apply.ts'
