import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconBranchOutline16, IconCheckOutline16, IconCopyOutline16, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import { formatMessageClock, useCalendarDay } from '../helpers/format.ts'
import css from './MessageActions.module.css'

export const MessageActions = memo(function MessageActions({ text, time, clock, onBranch, branchUnavailable = false, extraActions, usageAction, t }: {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; null hides the clock. */
  time: number | null
  /** Clock before the icons (user) or after (assistant tail). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not the completed turn's last row, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Slot-rendered actions owned by independent plugins (the chat's
   *  assistant-actions strip), placed between copy and branch. */
  extraActions?: ReactNode | undefined
  /** Icon-row Turn-stat triggers (the TurnUsagePanel / TurnTimePanel pills),
   *  seated after the branch control at the end of the icon cluster. */
  usageAction?: ReactNode | undefined
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
      {extraActions}
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
      {usageAction}
      {clock === 'end' ? clockEl : null}
    </div>
  )
})

