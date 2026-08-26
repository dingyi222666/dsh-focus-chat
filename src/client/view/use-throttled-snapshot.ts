/** Latest-wins snapshot throttling for the focus flow derivation. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Streaming refresh cadence: the flow re-derives at most this often while
 *  only the conversation content moves. 100ms keeps streaming text smooth
 *  while cutting the per-frame full-tree rebuild the host's animation-frame
 *  publication cadence would otherwise demand. */
export const STREAM_THROTTLE_MS = 100

/**
 * Subscribe one selector to a changing snapshot and render it under a
 * latest-wins coalescing window: a structural signature change publishes the
 * newest value immediately (cancelling any pending tick); content-only
 * updates coalesce into at most one re-render per `intervalMs`. The tick
 * reads the latest value when it fires, so a stream that stops right after a
 * tick still lands its final state, and a value that arrives while a tick is
 * pending never schedules a second one.
 * @param latest - the newest selector value (recomputed every render).
 * @param signature - structural identity of the value: when it changes, the
 *  new value renders immediately; while it stays stable, updates are
 *  coalesced.
 * @param intervalMs - coalescing window.
 * @returns the value to render.
 */
export function useThrottledSnapshot<Value>(
  latest: Value,
  signature: string,
  intervalMs: number = STREAM_THROTTLE_MS,
): Value {
  const [displayed, setDisplayed] = useState(() => latest)
  // Every render records the newest selector output; the layout pass below
  // decides when it becomes the displayed value.
  const latestRef = useRef(latest)
  latestRef.current = latest
  const signatureRef = useRef(signature)
  const displayedRef = useRef(displayed)
  displayedRef.current = displayed
  const timerRef = useRef<number | null>(null)

  // Unmount-only cleanup: a pending coalescing tick must not fire after the
  // view is gone. (The scheduling pass below runs per render and therefore
  // cannot own the cleanup.)
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // Runs after every render: publish immediately on a structural change;
  // otherwise schedule one coalescing tick if none is pending (the pending
  // tick reads the latest value, so every update is eventually shown).
  useLayoutEffect(() => {
    if (signatureRef.current !== signature) {
      signatureRef.current = signature
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (displayedRef.current !== latestRef.current) setDisplayed(latestRef.current)
      return
    }
    if (timerRef.current === null && displayedRef.current !== latestRef.current) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (displayedRef.current !== latestRef.current) setDisplayed(latestRef.current)
      }, intervalMs)
    }
  })

  return displayed
}
