import { memo, useEffect, useMemo, useState } from 'react'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import css from './RetryRow.module.css'

export const RetryRow = memo(function RetryRow({ item, t }: {
  item: Extract<FocusFlowItem, { kind: 'retry' }>
  t: FocusTranslate
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + item.delayMs, [item.delayMs, item.nodeKey])
  const scheduledSeconds = retrySeconds(item.delayMs)
  const maximum = item.mode === 'normal' ? item.maxRetries : '∞'
  const [countdown, setCountdown] = useState<{ deadline: number; seconds: number }>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (item.retryState !== 'scheduled') return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [item.retryState, deadline])

  // The active countdown reads as the retrying label (the chat ModelRetryItem
  // rule); the scheduled label is the non-counting fallback.
  const active = item.retryState === 'scheduled'
  const label = active
    ? t('retry.active')
    : item.retryState === 'cancelled'
      ? t('retry.cancelled')
      : t('retry.started')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('retry.status', {
            label,
            retry: item.retry,
            maximum: String(maximum),
            seconds,
          })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('retry.delay')}</span>
          {Math.round(item.delayMs)}ms
        </div>
        {item.failure !== null && (
          <div>
            <span className={css.retryDetailLabel}>{t('retry.failure')}</span>
            {item.failure.message}
          </div>
        )}
      </div>
    </details>
  )
})

/** Whole seconds, one minimum (the chat retry countdown's rhythm). */
function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

/** One completed turn's work line: every intermediate assistant row and tool
 *  run folded under `工作了 X 分 Y 秒`, expandable back to the full rows. */
