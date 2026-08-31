/**
 * Focus-view diff-style preference row registered into the General section
 * item slot: title + description + a selector pill (the official Menu)
 * choosing between the dsh-default DiffBlock and the Codex-style changes-bar
 * renderer. The selected value follows the persisted preference, never a
 * click echo.
 */
import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DiffStyle } from '../../settings.ts'
import type { FocusKey } from '../locales.ts'
import css from './SettingsRow.module.css'

/** Registration-side diff-style preference face. */
export interface DiffStyleRowInjected {
  hooks: {
    /** Persisted diff-style preference bound as useDiffStyle. */
    diffStyle: SnapshotStore<DiffStyle>
  }
  /** Change the file-mutation diff renderer. */
  setDiffStyle: (style: DiffStyle) => void
}

/** Full Settings-row props. */
export type DiffStyleRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'focus'>
  & InjectFace<DiffStyleRowInjected>

/** The two diff renderers, in menu order. */
const OPTIONS: readonly { id: DiffStyle; label: FocusKey }[] = [
  { id: 'default', label: 'settings.diff.default' },
  { id: 'codex-bar', label: 'settings.diff.codexBar' },
]

/**
 * Render the diff-style selector row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DiffStyleRow({ useDiffStyle, setDiffStyle, t }: DiffStyleRowProps) {
  const diffStyle = useDiffStyle(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = diffStyle === 'default' ? 'settings.diff.default' : 'settings.diff.codexBar'
  const closeMenu = () => { setOpen(false) }
  const selectStyle = (id: string) => {
    closeMenu()
    setDiffStyle(id as DiffStyle)
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
        <div className={css.title}>{t('settings.diff.title')}</div>
        <div className={css.desc}>{t('settings.diff.desc')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={diffStyle}
        onSelect={selectStyle}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
