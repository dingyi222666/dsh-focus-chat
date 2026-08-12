import { useEffect, useState } from 'react'
import type { FocusTranslate } from '../../contract/props.ts'
import { formatElapsed } from '../helpers/format.ts'
import css from './RunningStatus.module.css'

export function RunningStatus({ startTime, t }: {
  /** The running turn's logged turn/start time; null falls back to mount time. */
  startTime: number | null
  t: FocusTranslate
}) {
  const [mountedAt] = useState(() => Date.now())
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      {t('status.diving')}
      {showClock && <span className={css.turnStatusClock} aria-hidden>{formatElapsed(elapsedMs, t)}</span>}
    </div>
  )
}

/** Reader-scroll following threshold (the chat view's value). */
