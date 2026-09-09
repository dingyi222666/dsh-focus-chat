/** The focus view plugin's single assembly point: register the view tab into
 *  the conversation view slot (the chat plugin's apply layout). */

/** Required services: the view slot, the locale registry, sessions, the connection facts, the Conversation image resolver, and the Remote namespaces. */
export const inject = [
  'slots', 'locale', 'sessions', 'uiConversation', 'connection', 'settingsScope',
  'remote', 'remote.session', 'remote.messageFeedback',
]
import type { Context } from '@deepseek-ai/cordis'
// Type-only service merges consumed by the apply world.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the right-sidebar service's Context merge (ctx.sidebarRight).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { fileAddressFor, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { FOCUS_RPC_CHANNEL } from '../protocol.ts'
import type { TurnEventsResponse, TurnIndexResponse } from '../protocol.ts'
import { FocusView } from './view/FocusView.tsx'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FOCUS_SETTINGS_NS, type FocusSettings } from '../settings.ts'
import { FocusSettingsPolicy } from './focus-settings.ts'
import { FocusSettingsSection, type FocusSettingsSectionInjected } from './settings/FocusSettingsSection.tsx'
import type { FocusHooksInjected, FocusScrollPosition, FocusTurnTailOwner, FocusViewInjected } from './contract/props.ts'
import { MessageFeedbackController } from './model/feedback-controller.ts'
import { PresentedOpenController } from './model/presented-open.ts'
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

  // Durable view preferences (diff style, markdown inline-code style): the
  // settingsScope bind hands the plugin's namespace scope; the policy keeps
  // the live snapshot stores the view and the Settings rows share.
  const focusSettings = new FocusSettingsPolicy(
    ctx.settingsScope.bind<FocusSettings>({ namespace: FOCUS_SETTINGS_NS }),
  )

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
      controller = new MessageFeedbackController(ctx, sessionId)
      feedbackControllers.set(sessionId, controller)
    }
    return controller
  }

  // One presented-delivery controller backs every delivery card and file
  // mention across Sessions (the ui-deliverables controller shape: the open
  // status is keyed by the durable coordinates, and the desktop metadata is
  // one read per connection generation).
  const presentedOpen = new PresentedOpenController()
  ctx.effect(() => () => { void presentedOpen.dispose() }, 'dsh-focus-chat: presented open controller')
  ctx.on('connection/reset', () => {
    presentedOpen.resetHost()
    // A reconnect re-reads every Session's feedback behind its queued
    // mutations, so a stale list cannot resurrect a replaced version (the
    // official ui-message-feedback rule; a cold controller has nothing to
    // resync and stays cold until first interaction).
    for (const controller of feedbackControllers.values()) {
      if (controller.getSnapshot().status !== 'cold') void controller.resync()
    }
  })

  // The focus RPC channel: the Host's turn index and per-turn event slices.
  // The index caches per session for the plugin's lifetime (tab switches stay
  // free); the slices cache in the view instead — they are render-shaped.
  const turnIndexCache = new Map<SessionId, TurnIndexResponse>()
  const focusRpc = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const result = await connection.rpc.call(FOCUS_RPC_CHANNEL, endpoint, payload)
    if (!result.ok) throw new Error(result.error.message === '' ? result.error.code : result.error.message)
    return result.value as T
  }

  // The Focus chat settings section (the NotificationsSection pattern): one
  // `settings.section` entry owning both preference rows, bound to the
  // policy's live stores through the hooks compartment.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'focus-chat',
    order: 40,
    label: () => t('settings.nav'),
    locale: NS,
    inject: (): FocusSettingsSectionInjected => ({
      hooks: {
        diffStyle: focusSettings.diffStyle,
        mdStyle: focusSettings.mdStyle,
      },
      setDiffStyle: style => { focusSettings.setDiffStyle(style) },
      setMdStyle: style => { focusSettings.setMdStyle(style) },
    }),
  }, FocusSettingsSection))

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
        // Session-authorized historical image resolution (the chat view's
        // image gallery loader, served by the Conversation assembly).
        loadImage: Object.assign(
          (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
          { peek: (attachment: ImageAttachmentRef) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
        ),
        // File opener (the 0.1.5-alpha.2 chat rule): the file opens in the
        // right Sidebar as a session-scoped dsh-resource address — the content
        // stays in the product beside the conversation that produced it — and
        // an optional line rides the navigation params, not the address. A
        // host without the right sidebar falls back to the desktop opener;
        // its refusals reject upward so the in-page open dialog surfaces them.
        openFile: async (path, options) => {
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const sidebar = ctx.get('sidebarRight') as
            | {
              openResource: (address: string, options?: { params?: { line?: number } }) => void
            }
            | undefined
          if (sidebar !== undefined) {
            const address = fileAddressFor(sessionId, cwd, path)
            if (options?.line === undefined) sidebar.openResource(address)
            else sidebar.openResource(address, { params: { line: options.line } })
            return
          }
          const result = await ctx.remote.session.openWorkspacePath({
            path: resolveWorkspacePath(cwd, path),
          })
          if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
        },
        // Raw history paging: the fallback when the Host turn index is absent
        // (the chat view's own loadOlder).
        loadOlder: () => { ctx.sessions.binding(sessionId)?.session.loadOlder() },
        // Fork the session at one message seq (the chat view's branch semantics).
        forkAt: (seq) => {
          ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
            .then(childId => { ctx.sessions.open(childId) })
            .catch(() => {
              // Fork or child-rename failure keeps the source view untouched.
            })
        },
        // Prose file-mention vocabulary for a closing assistant; the optional
        // chatFileMentions service (ui-deliverables) is absent when composed
        // out. 0.1.5-alpha.2 adds the sessionId: the vocabulary opens a
        // presented delivery through the session-scoped presenter.
        fileMentions: (owner) => {
          const service = ctx.get('chatFileMentions') as
            | {
              forClosing: (
                owner: FocusTurnTailOwner,
                sessionId: SessionId,
              ) => MarkdownFileMentions | undefined
            }
            | undefined
          return service?.forClosing(owner, sessionId)
        },
        // The Host's completed-turn index (the remote turn folds): one RPC
        // read per session, cached for the plugin's lifetime. The optional
        // service degrades to the window-only flow when the channel is not
        // registered (an older host half).
        turnIndex: (id) => {
          const cached = turnIndexCache.get(id)
          if (cached !== undefined) return Promise.resolve(cached)
          return focusRpc<TurnIndexResponse>('focus/turnIndex', { sessionId: id })
            .then(response => {
              turnIndexCache.set(id, response)
              return response
            })
        },
        // One completed turn's raw event slice (the expand-then-load fetch);
        // the view projects and caches the slice.
        turnEvents: (id, turn) => focusRpc<TurnEventsResponse>('focus/turnEvents', { sessionId: id, turn }),
        scroll: {
          save: (position) => { focusScrollPositions.set(sessionId, position) },
          read: () => focusScrollPositions.get(sessionId) ?? null,
        },
        // Per-message feedback verbs (the assistant-actions strip's business
        // face, re-declared for the focus view).
        ensureFeedback: () => feedback.ensure(),
        rateFeedback: (messageId, rating, entry) => feedback.rate(messageId, rating, entry),
        toggleFeedback: (messageId, rating) => feedback.toggle(messageId, rating),
        currentFeedback: messageId => feedback.current(messageId),
        // Presented-delivery verbs and desktop metadata (the ui-deliverables
        // controller, re-declared for the focus view's delivery cards).
        reloadPresentedHost: () => { void presentedOpen.loadHost() },
        openPresented: (id, seq, index, action) => { void presentedOpen.open(id, seq, index, action) },
        // Host account home (account home for `~` path display) and the
        // Session feedback view, bound by the slot renderer into the view's
        // useHostHome / useFeedback hooks.
        hooks: {
          hostHome,
          feedback,
          diffStyle: focusSettings.diffStyle,
          mdStyle: focusSettings.mdStyle,
          presentedOpen: presentedOpen.state,
          presentedHost: presentedOpen.host,
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
