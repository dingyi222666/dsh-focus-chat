/** Time, text, and geometry helpers of the focus view (pure). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusTranslate } from '../../contract/props.ts'

export function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Latest non-empty line of a streaming text (the running tail preview). */
export function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/** Zero-padded two-digit number (the chat clock's rhythm). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** The original-image lightbox strings (the chat image-labels bridge). */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Decode-throughput figure: whole tokens from ten up, one decimal below. */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** Local calendar-day epoch (ms at local midnight) for an instant. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Delay until the next local midnight after `ms` (at least 1ms). */
export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/** The current local calendar-day epoch, re-resolved at each midnight. */
export function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        setDay(startOfLocalDay(Date.now()))
        schedule()
      }, msUntilNextLocalMidnight(Date.now()))
    }
    schedule()
    return () => { clearTimeout(timer) }
  }, [])
  return day
}

/**
 * Compact local timestamp for message chrome (the chat clock): same local
 * calendar day → `HH:mm`; earlier this year → the `clock.md` template;
 * other years → `clock.ymd`.
 * @param time - Unix epoch ms from the source session event.
 * @param t - focus locale seat supplying the date templates.
 * @param now - reference instant for the day/year cut.
 * @returns the date-aware clock string.
 */
export function formatMessageClock(time: number, t: FocusTranslate, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (
    d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate()
  ) return clock
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}

/** Concatenated text blocks of a message (the chat bubble's join). */
export function useThrottledVisualUpdate(
  update: () => void,
  intervalFrames = 3,
): () => void {
  const updateRef = useRef(update)
  updateRef.current = update
  const pendingFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => () => {
    if (pendingFrameRef.current === null) return
    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  return useCallback(() => {
    if (pendingFrameRef.current !== null) return
    let remainingFrames = intervalFrames
    const advance = (): void => {
      remainingFrames -= 1
      if (remainingFrames > 0) {
        pendingFrameRef.current = requestAnimationFrame(advance)
        return
      }
      pendingFrameRef.current = null
      updateRef.current()
    }
    pendingFrameRef.current = requestAnimationFrame(advance)
  }, [intervalFrames])
}

export function formatElapsed(ms: number, t: FocusTranslate): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  // Long-running turns read compact: "1h 23m", "1day 3h 20m" — a pure
  // minute reading (123m) is unreadable once the clock passes an hour.
  if (days > 0) return t('duration.days', { days, hours, minutes })
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
  return t('duration.seconds', { seconds })
}

/** Turn-level running signal: "Deep diving..." plus an elapsed clock past 15s. */
