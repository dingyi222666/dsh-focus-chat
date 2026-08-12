/**
 * Focus view plugin, browser half: one condensed conversation surface in the
 * view ring — every run of Tool calls folds into an expandable step-summary
 * line ("思考了 36 秒，运行了 2 个命令，探索了 17 个文件，18 个目录"), and
 * reasoning rows expand while running and fold in on completion. Pure-consumer
 * plugin: registers the 'focus' tab into the conversation view slot, provides
 * no service, declares no Context merge.
 */
import type { Context } from 'cordis'
import { resolveWorkspacePath, type ClientContext, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the runtime's cordis Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConversationService, IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { FocusView } from './FocusView.tsx'
import type { FocusScrollPosition, FocusTurnTailOwner, FocusViewInjected, FocusViewProps } from './FocusView.tsx'
import { en, zh, type FocusKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'focus'

export type { FocusKey } from './locales.ts'
export type { FocusScrollPosition, FocusViewInjected, FocusViewProps } from './FocusView.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The focus view's copy. */
    focus: FocusKey
  }
}

/** Required services: the view slot, the locale registry, sessions, the host opener, and the connection facts. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'connection']

/**
 * Client plugin body: register the focus view tab.
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-focus-chat: dictionaries')

  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)

  // Scroll ledger shared across view remounts: tab switches keep the reader's
  // place (the chat view's persistence shape), never persisted to disk.
  const focusScrollPositions = new Map<SessionId, FocusScrollPosition | null>()

  // Host capability facts for the produced-files lane (the chat rule: chips
  // and the show-in-folder action need a loopback browser whose Host can
  // open native paths).
  const connection = ctx.get('connection') as ConnectionHandle

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'focus',
    order: 5,
    label: () => t('view.label'),
    locale: NS,
    inject: (sessionId: SessionId): FocusViewInjected => ({
      // History paging through the conversation service (chat-view semantics);
      // absent scope/service degrades to a no-op, matching the chat view's
      // optional-service posture.
      loadOlder: () => {
        const conversation = ctx.sessions.scope(sessionId)?.get('conversation') as IConversation | undefined
        conversation?.loadOlder()
      },
      // Session-authorized historical image resolution (the chat view's
      // image gallery loader); absent service degrades to a rejection.
      loadImage: (attachment: ImageAttachmentRef) => {
        const conversation = ctx.get('conversation') as ConversationService | undefined
        if (conversation === undefined) {
          return Promise.reject(new Error('dsh-focus-chat: conversation service unavailable'))
        }
        return conversation.resolveImage(sessionId, attachment)
      },
      // Host file opener (the chat view's tool-row semantics).
      openFile: (path) => {
        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
        void ctx.workspaces.openPath(resolveWorkspacePath(cwd, path)).catch(() => {
          // Host/OS open failures stay silent; the native app surfaces its own dialog.
        })
      },
      // Fork the session at one message seq (the chat view's branch semantics).
      forkAt: (seq) => {
        ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
          .then(childId => { ctx.sessions.open(childId) })
          .catch(() => {
            // Fork or child-rename failure keeps the source view untouched.
          })
      },
      // Prose file-mention vocabulary for a closing assistant; the optional
      // chatFileMentions service (ui-deliverables) is absent when composed out.
      fileMentions: (owner) => {
        const service = ctx.get('chatFileMentions') as
          | { forClosing: (owner: FocusTurnTailOwner) => MarkdownFileMentions | undefined }
          | undefined
        return service?.forClosing(owner)
      },
      // Whether the browser itself is connected over loopback (produced-chip gating).
      isLoopback: connection.isLoopback,
      hooks: {
        // Current generation's Host description, bound by the slot renderer.
        hostDescription: connection.hostDescription,
      },
      scroll: {
        save: (position) => { focusScrollPositions.set(sessionId, position) },
        read: () => focusScrollPositions.get(sessionId) ?? null,
      },
    }),
  }, FocusView))
}
