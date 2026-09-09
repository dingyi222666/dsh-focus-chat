/**
 * Browser-local object layer over one Session's durable message-feedback
 * sidecar. The Host owns per-item compare-and-set: every mutation carries the
 * version this controller last observed, and a `version-conflict` reply carries
 * the authoritative item, so a lost race reconciles from the reply itself
 * instead of refetching the whole Session.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FeedbackCategory } from '@deepseek-ai/dsh-command-feedback/types'
import type {
  MessageFeedbackItem,
  MessageFeedbackRating,
} from '@deepseek-ai/dsh-message-feedback/types'

/** The optional explanation and category one rating carries (the 0.1.5 dialog). */
export interface MessageFeedbackEntry {
  /** Replacement explanation; omitted keeps the stored note. */
  readonly note?: string
  /** Category filed with a negative judgment; omitted keeps the stored one. */
  readonly category?: FeedbackCategory
}

/** Load state of the one list read that seeds every per-message control. */
export type MessageFeedbackStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to every per-message control in one Session. */
export interface MessageFeedbackView {
  status: MessageFeedbackStatus
  /** Current item per message, keyed by the addressed message id. */
  items: ReadonlyMap<MessageId, MessageFeedbackItem>
  /** Reason the last load failed, cleared by the next successful load. */
  error: string | null
}

/** Settled action shape rendered by the message-level controls. */
export type MessageFeedbackActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

/** Settled toggle: the rating now recorded, or null when the toggle retracted. */
export type MessageFeedbackToggleResult =
  | { ok: true; rating: MessageFeedbackRating | null }
  | { ok: false; error: { code: string; message: string } }

// `Object.freeze` does not protect a Map: `set`/`delete` write internal slots,
// not properties. Immutability here is by discipline instead — the view type is
// ReadonlyMap and every publish hands over a freshly built Map that this class
// keeps no mutable reference to.
const EMPTY_ITEMS: ReadonlyMap<MessageId, MessageFeedbackItem> = new Map()

const INITIAL_VIEW: MessageFeedbackView = Object.freeze({
  status: 'cold',
  items: EMPTY_ITEMS,
  error: null,
})

const OK: MessageFeedbackActionResult = Object.freeze({ ok: true })

const DISPOSED: Extract<MessageFeedbackActionResult, { ok: false }> = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'feedback controller is disposed' }),
})

/** Human-readable text for one business failure code. */
function describe(code: string): string {
  switch (code) {
    case 'session-not-found': return 'this session is no longer persisted'
    case 'target-not-found': return 'this message is not a persisted assistant message'
    case 'version-conflict': return 'feedback changed elsewhere'
    case 'note-blank': return 'a note must contain a non-whitespace character'
    case 'note-too-large': return 'the note is too long'
    default: return code
  }
}

/** Build the rejected branch for one business failure code. */
function fail(code: string): MessageFeedbackActionResult {
  return { ok: false, error: { code, message: describe(code) } }
}

/** Carrier failure rendered with the Host-supplied code and message. */
function carrierFailure(error: { code: string; message: string }): MessageFeedbackActionResult {
  return { ok: false, error: { code: error.code, message: error.message } }
}

/**
 * Per-session feedback object layer. One instance backs every per-message
 * control in that Session, so a single list read seeds them all.
 */
export class MessageFeedbackController implements HostObservable<MessageFeedbackView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<MessageFeedbackActionResult> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param ctx - the browser plugin context carrying the messageFeedback Remote namespace.
   * @param sessionId - Session owning every addressed assistant message.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {}

  /** Return the cached immutable view. */
  getSnapshot = (): MessageFeedbackView => this.view

  /** The committed item this controller last observed for one message. */
  current(messageId: MessageId): MessageFeedbackItem | undefined {
    return this.view.items.get(messageId)
  }

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load once; a failed load stays retryable.
   * @returns the settled load result, shared by concurrent callers.
   */
  ensure(): Promise<MessageFeedbackActionResult> {
    if (this.view.status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Re-read the authoritative list, collapsing concurrent callers onto one
   * in-flight read.
   *
   * This is the unserialized read used to seed a cold controller, where no
   * mutation can be in flight yet. A reconnect must use {@link resync} instead:
   * an unserialized list response can otherwise arrive after a newer mutation's
   * reply and overwrite the version that mutation just committed.
   * @returns the settled reload result.
   */
  refresh(): Promise<MessageFeedbackActionResult> {
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ status: 'loading', items: this.view.items, error: null })
    const pending = this.load()
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Re-read the list behind this Session's queued mutations, so a reconnect
   * cannot resurrect a version an in-flight mutation already replaced.
   * @returns the settled reload result.
   */
  resync(): Promise<MessageFeedbackActionResult> {
    // seed: false — this operation *is* the read, so pre-seeding would either
    // short-circuit it (status already ready) or run it twice.
    return this.mutate(() => this.refresh(), { seed: false })
  }

  /**
   * Create or replace feedback for one message, comparing against the version
   * this controller last observed.
   *
   * The entry is stored exactly as given (the official FeedbackRecord rule):
   * `mutate` awaits the one list read first, so this body always sees the
   * committed item, while a control that rendered before that read completed
   * would still be holding `undefined`.
   * @param messageId - target assistant message.
   * @param rating - desired judgment.
   * @param entry - replacement explanation/category; omitted keeps the stored values.
   * @returns the settled mutation result.
   */
  rate(
    messageId: MessageId,
    rating: MessageFeedbackRating,
    entry?: MessageFeedbackEntry,
  ): Promise<MessageFeedbackActionResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      // A replacement stores exactly the entry (the official FeedbackRecord
      // rule): a Like after a noted Dislike clears the note.
      return await this.putCommitted(messageId, rating, entry ?? {}, observed)
    })
  }

  /**
   * Replace one message's rating with the opposite judgment, or retract it when
   * the committed rating already matches. The decision reads the committed item
   * inside the serialized mutation, so a click that lands before the first list
   * read still toggles against the stored value rather than the empty view a
   * cold control rendered.
   * @param messageId - target assistant message.
   * @param rating - the judgment the human asked for.
   * @returns the settled mutation result.
   */
  toggle(messageId: MessageId, rating: MessageFeedbackRating): Promise<MessageFeedbackToggleResult> {
    return this.mutate(async () => {
      const observed = this.view.items.get(messageId)
      const retract = observed?.rating === rating
      const result = retract
        ? await this.deleteCommitted(messageId, observed)
        : await this.putCommitted(messageId, rating, {}, observed)
      return result.ok ? { ok: true, rating: retract ? null : rating } : result
    })
  }

  /** Commit one put against the observed version and reconcile a conflict. */
  private async putCommitted(
    messageId: MessageId,
    rating: MessageFeedbackRating,
    entry: MessageFeedbackEntry,
    observed: MessageFeedbackItem | undefined,
  ): Promise<MessageFeedbackActionResult> {
    const carried = await this.ctx.remote.messageFeedback.put({
      sessionId: this.sessionId,
      messageId,
      rating,
      ...(entry.note === undefined ? {} : { note: entry.note }),
      ...(entry.category === undefined ? {} : { category: entry.category }),
      ifVersion: observed?.version ?? null,
    })
    if (!carried.ok) return carrierFailure(carried.error)
    const result = carried.value
    if (result.ok) {
      this.commit(messageId, result.value)
      return OK
    }
    if (result.error.code === 'version-conflict') this.commit(messageId, result.error.current)
    return fail(result.error.code)
  }

  /** Commit one delete against the observed version and reconcile a conflict. */
  private async deleteCommitted(
    messageId: MessageId,
    observed: MessageFeedbackItem,
  ): Promise<MessageFeedbackActionResult> {
    const carried = await this.ctx.remote.messageFeedback.delete({
      sessionId: this.sessionId,
      messageId,
      ifVersion: observed.version,
    })
    if (!carried.ok) return carrierFailure(carried.error)
    const result = carried.value
    if (result.ok) {
      this.commit(messageId, null)
      return OK
    }
    if (result.error.code === 'version-conflict') this.commit(messageId, result.error.current)
    return fail(result.error.code)
  }

  /** Drop subscribers and refuse further work when the owning fiber unloads. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** Fetch the whole sidecar and publish it as the seeded view. */
  private async load(): Promise<MessageFeedbackActionResult> {
    const carried = await this.ctx.remote.messageFeedback.list({ sessionId: this.sessionId })
    if (this.disposed) return OK
    if (!carried.ok) {
      this.publish({ status: 'error', items: this.view.items, error: carried.error.message })
      return carrierFailure(carried.error)
    }
    const result = carried.value
    if (!result.ok) {
      this.publish({ status: 'error', items: this.view.items, error: describe(result.error.code) })
      return fail(result.error.code)
    }
    const items = new Map<MessageId, MessageFeedbackItem>()
    for (const item of result.value.items) items.set(item.messageId, item)
    this.publish({ status: 'ready', items, error: null })
    return OK
  }

  /**
   * Serialize one mutation behind this Session's prior mutation so queued
   * operations always compare against the committed version.
   */
  private mutate<T extends { ok: boolean; error?: { code: string; message: string } }>(
    operation: () => Promise<T>,
    options: { readonly seed?: boolean } = {},
  ): Promise<T | Extract<MessageFeedbackActionResult, { ok: false }>> {
    const guarded = async (): Promise<T | Extract<MessageFeedbackActionResult, { ok: false }>> => {
      if (this.disposed) return DISPOSED
      if (options.seed !== false) {
        const loaded = await this.ensure()
        if (!loaded.ok) return loaded
        // Disposal can land while the seeding read is in flight; without this
        // second check the fiber would still reach the wire after unloading.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
        if (this.disposed) return DISPOSED
      }
      return await operation()
    }
    const result = this.operationTail.then(guarded, guarded)
    // `guarded` settles every carrier and business failure as a
    // MessageFeedbackActionResult and never rethrows, so this tail cannot reject and
    // needs no rejection handler.
    this.operationTail = result.then(() => undefined)
    return result
  }

  /**
   * Replace one message's entry, keeping every other entry's identity. Only a
   * `mutate` operation reaches this, and `mutate` refuses admission once the
   * controller is disposed, so no disposal guard belongs here; `publish` is
   * the single place that stops notifying after listeners are dropped.
   */
  private commit(messageId: MessageId, item: MessageFeedbackItem | null): void {
    const items = new Map(this.view.items)
    if (item === null) items.delete(messageId)
    else items.set(messageId, item)
    this.publish({ status: 'ready', items, error: null })
  }

  /** Replace the view and contain subscriber failures at the observable boundary. */
  private publish(view: MessageFeedbackView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-message-feedback] subscriber threw:', error)
      }
    }
  }
}
