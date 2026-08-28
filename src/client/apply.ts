/** The focus view plugin's single assembly point: register the view tab into
 *  the conversation view slot (the chat plugin's apply layout). */

/** Required services: the view slot, the locale registry, sessions, the connection facts, the Conversation image resolver, and the Remote namespaces. */
export const inject = [
  'slots', 'locale', 'sessions', 'uiConversation', 'connection',
  'remote', 'remote.session', 'remote.messageFeedback',
]
import type { Context } from '@deepseek-ai/cordis'
// Type-only service merges consumed by the apply world.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { FocusView } from './view/FocusView.tsx'
import type { FocusHooksInjected, FocusScrollPosition, FocusTurnTailOwner, FocusViewInjected } from './contract/props.ts'
import { MessageFeedbackController } from './model/feedback-controller.ts'
import { en, zh, type FocusKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'focus'

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

  // Host account home for `~` path display: an observable over the active
  // connection generation's Host facts (absent while reconnecting — the
  // hostDescription hook's replacement).
  const hostHome = {
    getSnapshot: () => connection.generation.getSnapshot()?.host.home,
    subscribe: (listener: () => void) => connection.generation.subscribe(listener),
  }

  // One feedback controller per Session backs every Like/Dislike control in
  // that Session (the ui-message-feedback object layer, re-implemented here
  // because the focus view cannot take the assistant-actions slot seat).
  const feedbackControllers = new Map<SessionId, MessageFeedbackController>()
  const feedbackControllerFor = (sessionId: SessionId): MessageFeedbackController => {
    let controller = feedbackControllers.get(sessionId)
    if (controller === undefined) {
      controller = new MessageFeedbackController(ctx.remote.messageFeedback, sessionId)
      feedbackControllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.slots.inject('conversation.view', () => {
    const dispose = ctx.slots.register({
    name: 'conversation.view',
    id: 'focus',
    order: 5,
    label: () => t('view.label'),
    locale: NS,
    // NOTE: no `children` declaration — the chat view (B5) already declared
    // 'conversation.message.images', and a second conversation.view entry
    // cannot re-declare it (the ledger rejects duplicate declarations). The
    // focus view renders message images with its own gallery instead.
    inject: (sessionId: SessionId): FocusViewInjected & FocusHooksInjected => {
      const feedback = feedbackControllerFor(sessionId)
      return {
        // History paging through the session face (chat-view semantics);
        // absent binding degrades to a no-op, matching the chat view's
        // optional-service posture.
        loadOlder: () => {
          const session = ctx.sessions.binding(sessionId)?.session
          void session?.loadOlder()
        },
        // Session-authorized historical image resolution (the chat view's
        // image gallery loader, served by the Conversation assembly).
        loadImage: (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
        // Host file opener (the chat view's tool-row semantics): refusals
        // reject upward so the focus view's in-page open dialog surfaces them.
        openFile: async (path) => {
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const result = await ctx.remote.session.openWorkspacePath({
            path: resolveWorkspacePath(cwd, path),
          })
          if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
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
        scroll: {
          save: (position) => { focusScrollPositions.set(sessionId, position) },
          read: () => focusScrollPositions.get(sessionId) ?? null,
        },
        // Per-message feedback verbs (the assistant-actions strip's business
        // face, re-declared for the focus view).
        ensureFeedback: () => feedback.ensure(),
        rateFeedback: (messageId, rating, note) => feedback.rate(messageId, rating, note),
        toggleFeedback: (messageId, rating) => feedback.toggle(messageId, rating),
        clearFeedbackNote: messageId => feedback.clearNote(messageId),
        // Host account home (account home for `~` path display) and the
        // Session feedback view, bound by the slot renderer into the view's
        // useHostHome / useFeedback hooks.
        hooks: {
          hostHome,
          feedback,
        },
      }
    },
  }, FocusView)
    return () => {
      dispose()
      for (const controller of feedbackControllers.values()) controller.dispose()
      feedbackControllers.clear()
    }
  })
}
