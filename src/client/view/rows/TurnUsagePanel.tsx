// Icon-row Turn-stat actions (the chat TurnUsagePanel chrome): a database pill
// labelled with the turn total click-opens the per-Turn usage dialog, and a
// clock pill labelled with the turn wall time click-opens the Turn-time
// dialog. Both sit right of the branch action in the tail's IconActions row,
// ahead of the plain clock text.

import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  IconClockOutline16, IconDatabaseOutline16, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { TurnTokenUsage } from '../../model/types.ts'
import {
  formatCacheHitPercent, formatExactTokens, formatLatencySeconds, formatRunDuration, formatTokens, formatTokensPerSecond,
} from '../helpers/format.ts'
import css from './TurnUsagePanel.module.css'

export interface TurnUsagePanelProps {
  usage: TurnTokenUsage
  /** The owning view's locale seat, passed down as a plain prop. */
  t: FocusTranslate
}

export interface TurnTimePanelProps {
  /** Turn wall time in ms, the pill's label. */
  runMs: number
  /** Turn decode throughput, a dialog row when known. */
  tokensPerSecond?: number | undefined
  /** Turn first-step TTFT in ms, a dialog row when known. */
  ttftMs?: number | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: FocusTranslate
}

function formatCompactCount(value: number, t: FocusTranslate): string {
  return t('turnUsage.count', { count: formatTokens(value, t) })
}

function formatExactCount(value: number, t: FocusTranslate): string {
  return t('turnUsage.count', { count: formatExactTokens(value, t) })
}

/** Viewport margin the placement clamp keeps (the Menu portal margin). */
const PANEL_MARGIN = 12

/** Distance between the trigger's top edge and the panel's bottom. */
const PANEL_GAP = 8

/**
 * Unplaced portal panel: hidden but laid out so the clamp measures real
 * dimensions (the `useAnchoredPosition` measure pass).
 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

interface StatDialogSeat {
  open: boolean
  setOpen: (open: boolean) => void
  rootRef: MutableRefObject<HTMLSpanElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  pos: CSSProperties | null
}

/** One trigger-anchored dialog seat: open state, viewport-clamped placement, outside-close. */
function useStatDialog(): StatDialogSeat {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Portal placement: the dialog is fixed above the trigger and clamped inside
  // the viewport, so a trigger near the window edge cannot push it off-screen.
  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // Outside pointerdown closes through the shared primitive; the portaled
  // panel counts as inside. Escape close stays local, one listener while open.
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  return { open, setOpen, rootRef, panelRef, pos }
}

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * @param props - Turn usage buckets and locale seat.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage, t }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()

  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  const total = formatCompactCount(usage.totalTokens, t)
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={css.label}>{t('turnUsage.consumed', { total })}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('turnUsage.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={css.title}>
            <span className={css.titleLabel}>
              <IconDatabaseOutline16 />
              {t('turnUsage.title')}
            </span>
            <span className={css.titleValue}>{formatExactCount(usage.totalTokens, t)}</span>
          </div>
          <div className={css.titleRule} aria-hidden />
          <dl className={css.details} data-turn-usage-details>
            {routes !== '' && (
              <>
                <dt>{t('turnUsage.model')}</dt>
                <dd className={css.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens, t)}
              {usage.reasoningTokens !== undefined && (
                <span className={css.reasoning}>
                  {t('turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
                </span>
              )}
            </dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

/**
 * Turn-time IconActions pill with a click-open Turn-time details dialog.
 * @param props - Turn timing facts and locale seat.
 * @returns The clock-and-duration trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnTimePanel({ runMs, tokensPerSecond, ttftMs, t }: TurnTimePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()
  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconClockOutline16 />
        <span className={css.label}>{t('ranFor', { duration: formatRunDuration(runMs, t) })}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('turnTime.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={css.title}>
            <span className={css.titleLabel}>
              <IconClockOutline16 />
              {t('turnTime.title')}
            </span>
          </div>
          <div className={css.titleRule} aria-hidden />
          <dl className={css.details} data-turn-time-details>
            <dt>{t('turnTime.duration')}</dt>
            <dd>{formatRunDuration(runMs, t)}</dd>
            {tokensPerSecond !== undefined && (
              <>
                <dt>{t('turnTime.speed')}</dt>
                <dd>{t('tokensPerSecond', { tps: formatTokensPerSecond(tokensPerSecond) })}</dd>
              </>
            )}
            {ttftMs !== undefined && (
              <>
                <dt>{t('turnTime.ttft')}</dt>
                <dd>{t('duration.seconds', { seconds: formatLatencySeconds(ttftMs) })}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}
