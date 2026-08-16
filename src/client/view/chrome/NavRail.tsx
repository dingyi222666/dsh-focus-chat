import { memo, useState } from 'react'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './NavRail.module.css'

/** One scroll-nav entry: a user / steering message's focus anchor. */
export interface FocusNavEntry {
  key: string
  /** First text line of the message (the rail's collapsed label). */
  label: string
}

/**
 * The in-view scroll navigation rail (the DeepSeek chat's page nav, moved
 * inside the focus scrollport so a right-hand workbench panel can never
 * cover it): a right-edge pill of entry dashes that expands on hover to
 * list every user / steering message. Clicking an entry jumps the focus
 * scrollport to that row; the active entry follows the reader (scroll-spy).
 */
export const NavRail = memo(function NavRail({ entries, activeKey, onSelect, t }: {
  entries: readonly FocusNavEntry[]
  /** The scroll-spy active entry key, or null before the first spy pass. */
  activeKey: string | null
  onSelect: (key: string) => void
  t: FocusTranslate
}) {
  const [open, setOpen] = useState(false)
  if (entries.length === 0) return null
  return (
    <div
      className={css.rail}
      data-open={open || undefined}
      data-focus-nav=""
      role="navigation"
      aria-label={t('nav.rail')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Collapse when focus leaves the rail entirely (a11y hover parity).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className={css.pill} aria-hidden />
      <div className={css.panel}>
        <div className={css.list}>
          {entries.map(entry => (
            <button
              key={entry.key}
              type="button"
              className={css.item}
              data-active={entry.key === activeKey || undefined}
              title={entry.label}
              onClick={() => onSelect(entry.key)}
            >
              <span className={css.label}>{entry.label}</span>
              <span className={css.dash} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})
