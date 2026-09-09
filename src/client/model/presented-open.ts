/**
 * Shared native-open status for presented delivery cards, re-implemented from
 * the ui-deliverables controller because the focus bundle cannot import that
 * plugin's runtime values. The card previews through the right Sidebar; the
 * card menu's default-application and file-manager actions post the durable
 * delivery coordinates to the Host.
 * @module dsh-focus-chat/client/model/presented-open
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Authenticated POST route for opening a workspace file on the Host desktop. */
export const PRESENT_OPEN_PATH = '/api/present.open'

/** Authenticated desktop availability and destination metadata. */
export const PRESENT_HOST_PATH = '/api/present.host'

/** Native file action selected by an explicit user gesture. */
export type PresentedAction = 'open' | 'reveal'

/** Serving Host information; file-manager names never derive from the browser's OS. */
export interface PresentedHost {
  name: string
  available: boolean
  fileManager: 'finder' | 'explorer' | 'directory' | null
}

/** State of the latest explicit open gesture for one saved file. */
export type PresentedOpenPhase =
  | 'opening' | 'opened' | 'revealing' | 'revealed'
  | 'error' | 'revealError' | 'nativeUnavailable'

/** Validate desktop metadata received over HTTP. */
function isPresentedHost(value: unknown): value is PresentedHost {
  if (typeof value !== 'object' || value === null) return false
  const host = value as Record<string, unknown>
  return typeof host.name === 'string' && typeof host.available === 'boolean'
    && (host.fileManager === null || host.fileManager === 'finder'
      || host.fileManager === 'explorer' || host.fileManager === 'directory')
}

/**
 * Build authenticated coordinates for a declared file.
 * @param sessionId - owning Session.
 * @param seq - deliverables/presented event sequence.
 * @param index - original index in the event's files array.
 * @returns same-origin file action URL.
 */
export function presentedFileUrl(sessionId: SessionId, seq: number, index: number): string {
  return `${PRESENT_OPEN_PATH}?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })}`
}

/**
 * One browser plugin's file-open requests, cancelled when that plugin is
 * disposed (the ui-deliverables PresentedOpenController shape).
 */
export class PresentedOpenController {
  /** File action URLs key the state across Sessions, turns, and both clickable surfaces. */
  readonly state = createSnapshotStore<Record<string, PresentedOpenPhase | undefined>>({})
  /** Native destination metadata, or a retryable read failure. */
  readonly host = createSnapshotStore<PresentedHost | 'error' | null>(null)
  private loading: Promise<void> | undefined
  private metadata = new AbortController()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()

  /**
   * Open a declared file once while a request for the same coordinates is pending.
   * Failures remain visible on the card and a later gesture retries them.
   * @param sessionId - viewed Session.
   * @param seq - durable delivery event sequence.
   * @param index - original file index within that event.
   * @param action - default application open or file-manager reveal.
   */
  async open(sessionId: SessionId, seq: number, index: number, action: PresentedAction = 'open'): Promise<void> {
    const url = presentedFileUrl(sessionId, seq, index)
    const phase = this.state.getSnapshot()[url]
    if (this.lifetime.signal.aborted || phase === 'opening' || phase === 'revealing') return
    this.state.update((state) => { state[url] = action === 'open' ? 'opening' : 'revealing' })
    const task = this.request(url, action)
    this.pending.add(task)
    try {
      await task
    } finally {
      this.pending.delete(task)
    }
  }

  /**
   * Read the serving desktop metadata, coalescing concurrent reads; a later call retries failure.
   */
  async loadHost(): Promise<void> {
    if (this.lifetime.signal.aborted) return
    if (this.loading !== undefined) return this.loading
    this.host.set(null)
    const task = this.readHost(AbortSignal.any([this.lifetime.signal, this.metadata.signal]))
    this.loading = task
    this.pending.add(task)
    try { await task }
    finally {
      if (this.loading === task) this.loading = undefined
      this.pending.delete(task)
    }
  }

  /** Invalidate desktop metadata on connection replacement; mounted cards request the new Host. */
  resetHost(): void {
    const wasLoading = this.loading !== undefined
    this.metadata.abort()
    this.metadata = new AbortController()
    this.loading = undefined
    this.host.set(null)
    if (wasLoading) void this.loadHost()
  }

  private async readHost(signal: AbortSignal): Promise<void> {
    let host: PresentedHost | 'error' = 'error'
    try {
      const response = await fetch(PRESENT_HOST_PATH, { signal })
      if (response.ok) {
        const value: unknown = await response.json()
        if (isPresentedHost(value)) host = value
      }
    } catch {
      host = 'error'
    }
    if (!signal.aborted) this.host.set(host)
  }

  /** Cancel outstanding requests and wait until no request can publish state. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.all(this.pending)
  }

  private async request(url: string, action: PresentedAction): Promise<void> {
    const failure: PresentedOpenPhase = action === 'open' ? 'error' : 'revealError'
    let phase: PresentedOpenPhase = action === 'open' ? 'opened' : 'revealed'
    try {
      const response = await fetch(action === 'open' ? url : `${url}&action=reveal`, {
        method: 'POST', signal: this.lifetime.signal,
      })
      if (!response.ok) phase = response.status === 422 ? 'nativeUnavailable' : failure
    } catch {
      // Transport failures share the retryable card state with Host open failures.
      phase = failure
    }
    if (!this.lifetime.signal.aborted) this.state.update((state) => { state[url] = phase })
  }
}
