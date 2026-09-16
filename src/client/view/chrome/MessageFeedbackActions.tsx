/**
 * Per-message feedback controls: the Like/Dislike pair inside the assistant
 * message's actions row, between copy and branch. Either rating opens the
 * feedback dialog, whose submission records that judgment with its category
 * and text; clicking the recorded rating retracts it, and a recorded rating
 * shows the filled glyph. A failed submission raises the Session's failure
 * toast instead of an inline line.
 * @module dsh-focus-chat/client/view/chrome/MessageFeedbackActions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconCheckOutline16, IconDislikeFill16, IconDislikeOutline16,
  IconLikeFill16, IconLikeOutline16, IconWarningOutline16, Modal, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { FeedbackCategory } from '@deepseek-ai/dsh-command-feedback/types'
import type { MessageFeedbackItem, MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type {
  MessageFeedbackActionResult, MessageFeedbackEntry, MessageFeedbackView,
} from '../../model/feedback-controller.ts'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './MessageFeedbackActions.module.css'

/** The shared feedback verbs and view hook the focus view injects (the chat
 *  assistant-actions strip's business face, re-declared here because the view
 *  cannot take that slot seat). */
export interface FocusFeedbackActions {
  /** The owning Session's feedback view, shared by every message control. */
  useFeedback: SnapshotSelectorHook<MessageFeedbackView>
  /** Load the Session's feedback once, on first interaction. */
  ensure: () => Promise<MessageFeedbackActionResult>
  /** Create or replace this Session's feedback for one message. */
  rate: (messageId: MessageId, rating: MessageFeedbackRating, entry?: MessageFeedbackEntry) => Promise<MessageFeedbackActionResult>
  /** Retract one message's matching committed rating (a re-click on the
   *  filled glyph); recording now always goes through the dialog. */
  retract: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  /** The committed item this Session's controller last observed. */
  current: (messageId: MessageId) => MessageFeedbackItem | undefined
}

/** Full props of one assistant-message feedback entry. */
export type FocusMessageFeedbackProps = FocusFeedbackActions & {
  /** Target assistant-message identity. */
  messageId: MessageId
  /** The owning view's locale seat. */
  t: FocusTranslate
}

/**
 * The chips in presentation order. A client bundle may not import a Host
 * package's values, so the taxonomy is restated as a complete record of the
 * `FeedbackCategory` union: a missing or foreign id is a compile error (the
 * official FeedbackDialog rule).
 */
const CATEGORY_CHIPS = {
  'task-result': true,
  'instruction-following': true,
  'product-interaction': true,
  'service-stability': true,
  'resource-cost': true,
  'security-privacy-permission': true,
  'other': true,
} satisfies Record<FeedbackCategory, true>
const CATEGORIES = Object.keys(CATEGORY_CHIPS) as FeedbackCategory[]

/** Failure codes with their own copy; every other code reads the generic line. */
const FAILURE_COPY: Partial<Record<string, 'feedback.error.conflict' | 'feedback.error.noteTooLarge'>> = {
  'version-conflict': 'feedback.error.conflict',
  'note-too-large': 'feedback.error.noteTooLarge',
}

/**
 * One message's feedback controls and dialog.
 * @param props - the owner's message identity, the injected verbs, and the
 *  shared feedback hook.
 * @returns the rating buttons, with the dialog while open.
 */
export function MessageFeedbackActions({ messageId, ensure, rate, retract, current, useFeedback, t }: FocusMessageFeedbackProps) {
  const item = useFeedback(view => view.items.get(messageId))
  const loadFailed = useFeedback(view => view.status === 'error')
  const rating = item?.rating
  const [pending, setPending] = useState(false)
  // A rating or load failure surfaces beside the rating buttons.
  const [rowFailure, setRowFailure] = useState<string | null>(null)
  // The dialog draft: category chips and the detail textarea.
  const [dialogOpen, setDialogOpen] = useState(false)
  // The rating the open dialog will record (either button opens it now).
  const [dialogRating, setDialogRating] = useState<MessageFeedbackRating>('negative')
  // The failure toast anchors over the composer card, like the chat entry's.
  const [toastAnchor, setToastAnchor] = useState<HTMLElement | null>(null)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dialogFailure, setDialogFailure] = useState<string | null>(null)
  // Acknowledgement toast sequence: 0 while none.
  const [toast, setToast] = useState(0)
  // The controls mount for every settled message in the transcript, so the
  // Session's feedback is read once on first hover/focus rather than on mount.
  const seeded = useRef(false)
  const seed = useCallback(() => {
    if (seeded.current) return
    seeded.current = true
    void ensure()
  }, [ensure])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const errorCopy = useCallback((result: { ok: boolean; error?: { code: string } }) => {
    return result.error?.code === 'version-conflict' ? t('feedback.error.conflict') : t('feedback.error.generic')
  }, [t])

  // A recorded rating retracts on click; either unrecorded rating opens the
  // dialog and records only after submission. The decision waits for the
  // seeding read, so a click on a cold row still sees the stored judgment.
  const choose = useCallback((nextRating: MessageFeedbackRating) => {
    setPending(true)
    setRowFailure(null)
    void ensure().then((loaded) => {
      if (!alive.current) return
      // The committed item decides record-vs-retract (the official
      // current(messageId) rule): a cold row's render-time rating is stale.
      if (!loaded.ok || current(messageId)?.rating !== nextRating) {
        setPending(false)
        setDialogRating(nextRating)
        setCategory(null)
        setText('')
        setDialogFailure(null)
        setDialogOpen(true)
        return
      }
      void retract(messageId, nextRating).then((result) => {
        if (!alive.current) return
        setPending(false)
        if (!result.ok) setRowFailure(errorCopy(result))
      })
    })
  }, [current, ensure, errorCopy, messageId, retract])
  const onLike = useCallback(() => { choose('positive') }, [choose])
  const onDislike = useCallback(() => { choose('negative') }, [choose])

  // The failure toast reads its anchor from the document once a submission
  // fails (the chat's overlay entry probes the composer card the same way).
  useEffect(() => {
    if (dialogFailure === null) return
    setToastAnchor(document.querySelector<HTMLElement>('[data-composer-card]'))
  }, [dialogFailure])

  const submit = useCallback(() => {
    setSubmitting(true)
    setDialogFailure(null)
    const note = text.trim()
    void rate(messageId, dialogRating, {
      ...(note.length === 0 ? {} : { note }),
      ...(category === null ? {} : { category }),
    }).then((result) => {
      if (!alive.current) return
      setSubmitting(false)
      if (result.ok) {
        setDialogOpen(false)
        setToast(value => value + 1)
        return
      }
      setDialogFailure(t(FAILURE_COPY[result.error.code] ?? 'feedback.error.generic'))
    })
  }, [category, dialogRating, messageId, rate, t, text])

  const likeLabel = rating === 'positive' ? t('feedback.likeActive') : t('feedback.like')
  const dislikeLabel = rating === 'negative' ? t('feedback.dislikeActive') : t('feedback.dislike')

  return (
    <>
      <Tooltip label={likeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={likeLabel}
          aria-pressed={rating === 'positive'}
          data-active={rating === 'positive' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onLike}
        >
          {rating === 'positive' ? <IconLikeFill16 /> : <IconLikeOutline16 />}
        </button>
      </Tooltip>
      <Tooltip label={dislikeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={dislikeLabel}
          aria-pressed={rating === 'negative'}
          data-active={rating === 'negative' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onDislike}
        >
          {rating === 'negative' ? <IconDislikeFill16 /> : <IconDislikeOutline16 />}
        </button>
      </Tooltip>
      {rowFailure === null && loadFailed && (
        <span className={css.failure} role="status">{t('feedback.error.load')}</span>
      )}
      {rowFailure !== null && <span className={css.failure} role="status">{rowFailure}</span>}
      <Modal
        open={dialogOpen}
        title={t('feedback.dialog.title')}
        closeLabel={t('close')}
        onClose={() => { setDialogOpen(false) }}
        className={css.dialog as string}
        footer={(
          <Button
            variant="primary"
            className={css.submit}
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? t('feedback.submitting') : t('feedback.submit')}
          </Button>
        )}
      >
        <div className={css.categories} role="group" aria-label={t('feedback.dialog.categories')}>
          {CATEGORIES.map(id => (
            <button
              key={id}
              type="button"
              className={category === id ? `${css.chip} ${css.chipActive}` : css.chip}
              aria-pressed={category === id}
              disabled={submitting}
              onClick={() => { setCategory(current => current === id ? null : id) }}
            >
              {t(`feedback.category.${id}` as const)}
            </button>
          ))}
        </div>
        <textarea
          className={css.detail}
          aria-label={t('feedback.dialog.detail')}
          placeholder={t('feedback.dialog.hint')}
          value={text}
          readOnly={submitting}
          onChange={(event) => { setText(event.target.value) }}
        />
      </Modal>
      {toast > 0 && dialogFailure === null && (
        <Toast
          key={toast}
          text={t('feedback.toast.recorded')}
          icon={<span className={css.toastIcon}><IconCheckOutline16 size={12} /></span>}
          onDone={() => { setToast(0) }}
        />
      )}
      {/* A failed submission reads as the Session's failure toast (the chat
          dialog rule): a warning icon, the composer-card anchor, and a longer
          hold — it suppresses the acknowledgement while it shows. */}
      {dialogFailure !== null && (
        <Toast
          key={`failure-${dialogFailure}`}
          text={dialogFailure}
          icon={<IconWarningOutline16 />}
          anchor={toastAnchor}
          holdMs={6000}
          onDone={() => { setDialogFailure(null) }}
        />
      )}
    </>
  )
}
