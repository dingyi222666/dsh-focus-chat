/**
 * One delivered-file card: identity, a sidebar preview, and the Host
 * default-application / file-manager actions behind a menu. The chrome is the
 * official 0.1.5 presented card, re-implemented here because the focus bundle
 * cannot import ui-deliverables runtime components.
 * @module dsh-focus-chat/client/view/rows/PresentedFileCard
 */
import { useRef, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  FileTypeIcon, fileExtension, IconChevronDownOutline14, IconFolderOpenOutline16,
  IconRightUpOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusPresentedFile } from '../../model/types.ts'
import type { PresentedAction, PresentedHost, PresentedOpenPhase } from '../../model/presented-open.ts'
import { basename } from '../helpers/format.ts'
import css from './PresentedFileCard.module.css'

/** Trim a trailing parenthetical from a declared description (the official rule). */
function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render one delivery card with its anchored action menu.
 * @param props - durable file metadata, the Sidebar preview, Host
 *  capabilities, gesture status, and localized copy.
 * @returns the file card and its menu.
 */
export function PresentedFileCard({ file, cwd, phase, host, onPreview, onAction, t }: {
  file: FocusPresentedFile
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  onAction: (action: PresentedAction) => void
  t: FocusTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const previewRef = useRef<HTMLButtonElement>(null)
  const pending = phase === 'opening' || phase === 'revealing'
  const menuDisabled = pending || host === null || !host.available
  // The menu closes itself when the Host metadata turns unavailable mid-open
  // (the official PresentedFileCard render reset).
  if (menuDisabled && menuOpen) setMenuOpen(false)
  const reveal = host?.fileManager ?? 'directory'
  const act = (action: PresentedAction): void => {
    setMenuOpen(false)
    previewRef.current?.focus()
    onAction(action)
  }
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const status = phase === undefined
    ? cardDescription(file.description, metadata)
    : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
      : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
        : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  return (
    <div className={css.file} data-presented-file>
      <button
        type="button"
        className={css.cardPreview}
        title={resolveWorkspacePath(cwd, file.path)}
        aria-label={t('presented.previewCard', { name: file.path })}
        onClick={onPreview}
      />
      <span className={css.fileIcon}><FileTypeIcon path={file.path} /></span>
      <div className={css.fileBody}>
        <div className={css.details}>
          <span className={css.fileName}>{name}</span>
          <span
            className={css.description}
            role={phase === undefined ? undefined : 'status'}
            data-error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? true : undefined}
          >
            <span className={css.secondaryText}>{status}</span>
            <span className={css.previewHint}>{t('presented.preview')}</span>
          </span>
        </div>
        <div className={css.split}>
          <button
            ref={previewRef}
            type="button"
            className={css.open}
            aria-label={t('presented.previewButton', { name: file.path })}
            onClick={onPreview}
          >
            {t('presented.action')}
          </button>
          <Menu
            className={css.menuAnchor}
            open={menuOpen && !menuDisabled}
            autoFocus
            portal
            align="end"
            onClose={() => { setMenuOpen(false) }}
            anchor={(
              <button
                type="button"
                className={css.chevron}
                disabled={menuDisabled}
                aria-haspopup="menu"
                aria-expanded={menuOpen && !menuDisabled}
                aria-label={t('presented.more', { name: file.path })}
                onClick={() => { setMenuOpen(value => !value) }}
              >
                <IconChevronDownOutline14 size={11} />
              </button>
            )}
            items={[
              {
                id: 'open',
                icon: <IconRightUpOutline16 size={16} className={css.menuActionIcon} />,
                label: t('presented.defaultApp'),
              },
              { id: 'reveal', icon: <IconFolderOpenOutline16 />, label: t(`presented.${reveal}`) },
            ]}
            onSelect={(id) => { act(id === 'reveal' ? 'reveal' : 'open') }}
          />
        </div>
      </div>
    </div>
  )
}
