import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { IconBranchOutline16, IconCheckOutline16, IconCopyOutline16, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import { formatElapsed, formatMessageClock, formatTokensPerSecond, useCalendarDay } from '../helpers/format.ts'
import { formatSeconds } from '../../model/text.ts'
import css from './MessageActions.module.css'

export const MessageActions = memo(function MessageActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, t }: {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; null hides the clock. */
  time: number | null
  /** Turn wall time, appended as `· 用时 15s`; null omits the reading. */
  runMs: number | null
  /** Turn first-step TTFT in ms; null omits the reading. */
  ttftMs: number | null
  /** Turn decode throughput; null omits the reading. */
  tokensPerSecond: number | null
  /** Clock before the icons (user) or after (assistant tail). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not the completed turn's last row, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  t: FocusTranslate
}) {
  const day = useCalendarDay()
  // Same success chrome as the chat rows: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then(ok => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === null ? null : (
    <span className={css.messageClock}>
      {formatMessageClock(time, t, day)}
      {runMs !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('ranFor', { duration: formatElapsed(runMs, t) })}
        </>
      )}
      {ttftMs !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('ttft', { seconds: formatSeconds(ttftMs) })}
        </>
      )}
      {tokensPerSecond !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('tokensPerSecond', { tps: formatTokensPerSecond(tokensPerSecond) })}
        </>
      )}
    </span>
  )
  return (
    <div className={css.messageActions} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button
          type="button"
          className={css.messageAction}
          aria-label={copied ? t('copied') : t('copy')}
          onClick={onCopy}
        >
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
      {onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('branchUnavailable') : t('branch')} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.messageAction}
            aria-label={t('branch')}
            aria-disabled={branchUnavailable || undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutline16 />
          </button>
        </Tooltip>
      )}
      {clock === 'end' ? clockEl : null}
    </div>
  )
})

