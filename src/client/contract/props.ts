/** Shared props of the focus view entry (the contract face between the apply side and the view). */
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { HostObservable, InjectFace, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ui-chat merge (useChat on the session standard kit).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConvViewProps, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageFeedbackActionResult, MessageFeedbackView } from '../model/feedback-controller.ts'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TurnEventsResponse, TurnIndexResponse } from '../../protocol.ts'

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
  /** Open a workspace path through the Host; refusals reject so the view can surface its dialog. */
  openFile: (path: string) => Promise<void>
  /** Fork the session at one message seq (turn-tail branch semantics). */
  forkAt: (seq: number) => void
  /** Prose file-mention vocabulary for a closing assistant (optional service). */
  fileMentions: (owner: FocusTurnTailOwner) => MarkdownFileMentions | undefined
  /**
   * The Host's completed-turn index for one session (the remote turn folds'
   * collapsed facts). Optional service: an absent binding — or a rejection —
   * degrades to the window-only flow. The apply side caches the index per
   * session, so tab switches stay free.
   */
  turnIndex?: (sessionId: SessionId) => Promise<TurnIndexResponse>
  /**
   * One completed turn's raw event slice (the expand-then-load transport).
   * Optional service, same posture as {@link turnIndex}; rejections surface
   * on the row with a retry.
   */
  turnEvents?: (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>
  /** Whether the browser itself is connected over loopback (produced-chip gating). */
  isLoopback: boolean
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
  }
  /** Load the Session's feedback once, on first interaction. */
  ensureFeedback: () => Promise<MessageFeedbackActionResult>
  /** Create or replace feedback for one message. */
  rateFeedback: (messageId: MessageId, rating: MessageFeedbackRating, note?: string) => Promise<MessageFeedbackActionResult>
  /** Toggle or retract one message's rating. */
  toggleFeedback: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  /** Drop the note while keeping the rating. */
  clearFeedbackNote: (messageId: MessageId) => Promise<MessageFeedbackActionResult>
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
