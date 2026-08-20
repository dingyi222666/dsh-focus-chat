/** Shared props of the focus view entry (the contract face between the apply side and the view). */
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { InjectFace, PropsRenderSlots, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'

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
  /** Load one older page of history into the session window (chat-view semantics). */
  loadOlder: () => void
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Open a workspace path through the Host; refusals reject so the view can surface its dialog. */
  openFile: (path: string) => Promise<void>
  /** Fork the session at one message seq (turn-tail branch semantics). */
  forkAt: (seq: number) => void
  /** Prose file-mention vocabulary for a closing assistant (optional service). */
  fileMentions: (owner: FocusTurnTailOwner) => MarkdownFileMentions | undefined
  /** Whether the browser itself is connected over loopback (produced-chip gating). */
  isLoopback: boolean
  /** Per-session scroll-position ledger (the chat view's persistence). */
  scroll: {
    save: (position: FocusScrollPosition | null) => void
    read: () => FocusScrollPosition | null
  }
}

/** Injected Host description for POSIX home-path display (the ui-tool chat rule). */
export interface FocusHostDescriptionInjected {
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
}

/** Full props of the focus view entry: the conversation view kit, the image slot render share (the chat view's gallery seat), the injected face (hooks bound), and the focus locale seat. */
export type FocusViewProps = ConvViewProps
  & PropsRenderSlots<'conversation.message.images'>
  & FocusViewInjected
  & InjectFace<FocusHostDescriptionInjected>
  & { t: FocusTranslate }

/** The focus locale seat (the view namespace). */
export type FocusTranslate = TranslateNS<'focus'>

/** Slot-backed message-image renderer the focus rows use without importing an attachment implementation. */
export type { RenderMessageImages }
