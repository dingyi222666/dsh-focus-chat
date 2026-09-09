/**
 * Focus-view settings section: the `settings.section` entry owned by the
 * focus-chat plugin, in the settings-panel design language (the
 * NotificationsSection pattern). Two preference rows — the diff renderer and
 * the markdown inline-code rendering — each with a selector pill (the
 * official Menu). All copy rides the standard locale seat; the live
 * preferences come from the injected hooks compartment.
 */
import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DiffStyle, MdStyle } from '../../settings.ts'
import type { FocusKey } from '../locales.ts'
import css from './SettingsSection.module.css'

/** Registration-side preferences face (the section's injected business). */
export interface FocusSettingsSectionInjected {
  hooks: {
    /** Persisted diff-style preference bound as useDiffStyle. */
    diffStyle: SnapshotStore<DiffStyle>
    /** Persisted markdown inline-code preference bound as useMdStyle. */
    mdStyle: SnapshotStore<MdStyle>
  }
  /** Change the file-mutation diff renderer. */
  setDiffStyle: (style: DiffStyle) => void
  /** Change the markdown inline-code rendering. */
  setMdStyle: (style: MdStyle) => void
}

/** Full component props: runtime share + locale seat + injected hooks face. */
export type FocusSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'focus'>
  & InjectFace<FocusSettingsSectionInjected>

/** One selector row's option: a preference value and its locale label key. */
interface RowOption<T extends string> {
  id: T
  label: FocusKey
}

/**
 * Render the Focus chat settings section.
 * @param props - composed slot props.
 */
export function FocusSettingsSection({
  useDiffStyle, useMdStyle, setDiffStyle, setMdStyle, t,
}: FocusSettingsSectionProps) {
  const diffStyle = useDiffStyle(style => style)
  const mdStyle = useMdStyle(style => style)
  return (
    <div className={css.section}>
      <h3 className={css.title}>{t('settings.section.title')}</h3>
      <div className={css.rows}>
        <SelectorRow
          title={t('settings.diff.title')}
          desc={t('settings.diff.desc')}
          options={[
            { id: 'default' as const, label: 'settings.diff.default' as const },
            { id: 'codex-bar' as const, label: 'settings.diff.codexBar' as const },
          ]}
          value={diffStyle}
          t={t}
          onSelect={id => { setDiffStyle(id as DiffStyle) }}
        />
        <SelectorRow
          title={t('settings.md.title')}
          desc={t('settings.md.desc')}
          options={[
            { id: 'default' as const, label: 'settings.md.default' as const },
            { id: 'highlight' as const, label: 'settings.md.highlight' as const },
          ]}
          value={mdStyle}
          t={t}
          onSelect={id => { setMdStyle(id as MdStyle) }}
        />
      </div>
    </div>
  )
}

/** One preference row: title + description + a selector pill (the Menu). */
function SelectorRow({ title, desc, options, value, t, onSelect }: {
  title: string
  desc: string
  options: readonly RowOption<string>[]
  value: string
  t: (key: FocusKey) => string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.id === value) ?? options[0]
  const closeMenu = () => { setOpen(false) }
  const select = (id: string) => {
    closeMenu()
    onSelect(id)
  }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {selected !== undefined ? t(selected.label) : value}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.rowTitle}>{title}</div>
        <div className={css.desc}>{desc}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={options.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={value}
        onSelect={select}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
