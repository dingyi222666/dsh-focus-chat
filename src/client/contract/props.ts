/** Shared props of the focus view entry (the contract face between the apply side and the view). */
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { HostObservable, InjectFace, SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ui-chat merge (useChat on the session standard kit).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConvViewProps, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  MessageFeedbackActionResult, MessageFeedbackEntry, MessageFeedbackView,
} from '../model/feedback-controller.ts'
import type { MessageFeedbackItem, MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TurnEventsResponse, TurnIndexResponse } from '../../protocol.ts'
import type { DiffStyle, MdStyle } from '../../settings.ts'
import type { PresentedAction, PresentedHost, PresentedOpenPhase } from '../model/presented-open.ts'

/** The presented-file delivery face the rows read: the Session's durable
 *  open status, the Host desktop metadata, and the two verbs (the
 *  ui-deliverables presented controller, re-declared here because the focus
 *  view cannot take that plugin's slot seat). */
export interface FocusPresentedActions {
  /** Owning Session (the durable open coordinates). */
  sessionId: SessionId
  /** Session workspace root for the card's full-path title. */
  cwd: string | undefined
  /** Per-file open status keyed by action URL. */
  useOpen: SnapshotSelectorHook<Record<string, PresentedOpenPhase | undefined>>
  /** Host desktop metadata, a retryable read failure, or null while unread. */
  useHost: SnapshotSelectorHook<PresentedHost | 'error' | null>
  /** Read (or retry) the Host desktop metadata. */
  reloadHost: () => void
  /** Open or reveal one declared file through the Host. */
  open: (seq: number, index: number, action: PresentedAction) => void
}

/** One reflow-resistant scroll position (the chat view's saved shape). */
export interface FocusScrollPosition {
  /** Stable flow-item identity. */
  anchorKey: string
  /** Anchor row top relative to the scrollport. */
  anchorTop: number
  /** Raw scrollport offset at capture. */
  scrollTop: number
}

/** Owner currency of a closing assistant (the chat turn-tail owner shape). */
export interface FocusTurnTailOwner {
  /** Engine-owned closing turn boundary. */
  turn: TurnLocation
  /** The closing assistant's seq. */
  seq: number
  /** Open a filesystem path through the Host. */
  openFile: (path: string) => void
}

/** Injected business face of the focus view entry. */
export interface FocusViewInjected {
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Open a workspace path in the right Sidebar (a host without one falls
   *  back to the desktop opener); refusals reject so the view can surface its
   *  dialog. `line` lands the preview on that 1-based line. */
  openFile: (path: string, options?: { line?: number }) => Promise<void>
  /** Open the current source file of a skill a sent message referenced (the
   *  chat `openSkill`: a `/name` chip in a user bubble becomes a button). */
  openSkill: (name: string) => void
  /** Page one window of older raw history (the fallback when the Host turn
   *  index is unavailable). */
  loadOlder: () => void
  /** Page history until the given seq is loaded (the rail's unloaded jump). */
  loadThrough: (seq: number) => void
  /** Fork the session at one message seq (turn-tail branch semantics). */
  forkAt: (seq: number) => void
  /** Prose file-mention vocabulary for a closing assistant (optional service). */
  fileMentions: (owner: FocusTurnTailOwner) => MarkdownFileMentions | undefined
  /**
   * The Host's completed-turn index for one session (the remote turn folds'
   * collapsed facts, and the durable thinking-duration fallback for a
   * reloaded window). Optional service: an absent binding — or a rejection —
   * degrades to the window-only flow. The apply side caches the index per
   * session, so tab switches stay free; `throughTurn` is the newest Turn the
   * caller has seen closed, and a cache that does not reach it is refetched —
   * a Turn completed after the page loaded must still carry its step timing.
   */
  turnIndex?: (sessionId: SessionId, throughTurn?: number) => Promise<TurnIndexResponse>
  /**
   * One completed turn's raw event slice (the expand-then-load transport).
   * Optional service, same posture as {@link turnIndex}; rejections surface
   * on the row with a retry.
   */
  turnEvents?: (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>
  /** Per-session scroll-position ledger (the chat view's persistence). */
  scroll: {
    save: (position: FocusScrollPosition | null) => void
    read: () => FocusScrollPosition | null
  }
}

/** Injected Host account home and message-feedback hooks for the view (the
 *  chat tool-row rule's home abbreviation source, plus the per-message
 *  feedback view the chat's assistant-actions strip reads — re-declared here
 *  because the focus view cannot take the assistant-actions slot seat). */
export interface FocusHooksInjected {
  hooks: {
    /** Host account home of the active connection generation, bound by the
     *  slot renderer; absent while reconnecting. */
    hostHome: HostObservable<string | undefined>
    /** The owning Session's feedback view, shared by every message control. */
    feedback: HostObservable<MessageFeedbackView>
    /** The focus view's diff renderer preference (official DiffBlock vs the
     *  Codex-style changes bar), bound as useDiffStyle. */
    diffStyle: HostObservable<DiffStyle>
    /** The focus view's markdown inline-code preference (official box vs the
     *  highlight rendering), bound as useMdStyle. */
    mdStyle: HostObservable<MdStyle>
    /** Per-file presented open status (the delivery cards), bound as usePresentedOpen. */
    presentedOpen: HostObservable<Record<string, PresentedOpenPhase | undefined>>
    /** Host desktop metadata for the delivery cards, bound as usePresentedHost. */
    presentedHost: HostObservable<PresentedHost | 'error' | null>
  }
  /** Read (or retry) the Host desktop metadata for the delivery cards. */
  reloadPresentedHost: () => void
  /** Open or reveal one declared file through the Host. */
  openPresented: (sessionId: SessionId, seq: number, index: number, action: PresentedAction) => void
  /** Load the Session's feedback once, on first interaction. */
  ensureFeedback: () => Promise<MessageFeedbackActionResult>
  /** Create or replace feedback for one message. */
  rateFeedback: (messageId: MessageId, rating: MessageFeedbackRating, entry?: MessageFeedbackEntry) => Promise<MessageFeedbackActionResult>
  /** Retract one message's matching committed rating (a re-click on the
   *  filled glyph); recording now always goes through the dialog. */
  retractFeedback: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  /** The committed item this Session's controller last observed. */
  currentFeedback: (messageId: MessageId) => MessageFeedbackItem | undefined
}

/**
 * Full props of the focus view entry: the conversation view kit, the
 * injected face (hooks bound), and the focus locale seat. Message images
 * render through the view's own gallery (the chat view owns the image slot
 * declaration, so a second `conversation.view` entry cannot re-declare it).
 */
export type FocusViewProps = ConvViewProps
  & FocusViewInjected
  & InjectFace<FocusHooksInjected>
  & { t: FocusTranslate }

/** The focus locale seat (the view namespace). */
export type FocusTranslate = TranslateNS<'focus'>
