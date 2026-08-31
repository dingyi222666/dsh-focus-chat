/**
 * Focus-view markdown inline-code style preference row registered into the
 * General section item slot: title + description + a selector pill choosing
 * between the dsh-default inline-code box and the highlight rendering.
 */
import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MdStyle } from '../../settings.ts'
import type { FocusKey } from '../locales.ts'
import css from './SettingsRow.module.css'

/** Registration-side markdown-style preference face. */
export interface MdStyleRowInjected {
  hooks: {
    /** Persisted markdown inline-code preference bound as useMdStyle. */
    mdStyle: SnapshotStore<MdStyle>
  }
  /** Change the markdown inline-code rendering. */
  setMdStyle: (style: MdStyle) => void
}

/** Full Settings-row props. */
export type MdStyleRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'focus'>
  & InjectFace<MdStyleRowInjected>

/** The two inline-code renderings, in menu order. */
const OPTIONS: readonly { id: MdStyle; label: FocusKey }[] = [
  { id: 'default', label: 'settings.md.default' },
  { id: 'highlight', label: 'settings.md.highlight' },
]

/**
 * Render the markdown inline-code style selector row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function MdStyleRow({ useMdStyle, setMdStyle, t }: MdStyleRowProps) {
  const mdStyle = useMdStyle(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = mdStyle === 'default' ? 'settings.md.default' : 'settings.md.highlight'
  const closeMenu = () => { setOpen(false) }
  const selectStyle = (id: string) => {
    closeMenu()
    setMdStyle(id as MdStyle)
  }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(selectedLabel)}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.md.title')}</div>
        <div className={css.desc}>{t('settings.md.desc')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={mdStyle}
        onSelect={selectStyle}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
