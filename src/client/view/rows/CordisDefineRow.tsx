/**
 * Read-only `cordis_define` card with Host and Client source tabs.
 *
 * Ported verbatim from the ui-cordis client card (DOM, copy, and CSS
 * metrics): the focus view owns its rows, so the card is re-implemented here
 * rather than registered into the official keyed `tool.call.toolview` slot.
 * The derived card arrives on the row model (`FocusToolRow.cordis`).
 */

import { useId, useState, type ReactNode } from 'react'
import {
  CodeBlock, DisclosureRow, IconCodeOutline16, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusCordisActions, FocusTranslate } from '../../contract/props.ts'
import { cordisVisibleStatus, type FocusCordisVisibleStatus } from '../../model/cordis.ts'
import type { FocusCordisDefineCard } from '../../model/types.ts'
import type { FocusKey } from '../../locales.ts'
import css from './CordisDefineRow.module.css'

/** Complete props of the focus view's Define card (the official card's share). */
export interface CordisDefineRowProps {
  /** The define card derived from the frozen call block. */
  readonly card: FocusCordisDefineCard
  /** Owning call id (the fallback name when the args carry none). */
  readonly callId: string
  /** Reveal this call in the trajectory view; absent hides the inspect button. */
  readonly inspect?: (() => void) | undefined
  /** The Cordis card face (inventory + this page's live activations). */
  readonly cordis: FocusCordisActions
  readonly t: FocusTranslate
}

type CardReading = FocusCordisVisibleStatus | 'removed'
type SourceTab = 'client' | 'host'

const READING_LABELS = {
  idle: 'cordis.status.idle',
  'client-pending': 'cordis.status.clientPending',
  running: 'cordis.status.running',
  removed: 'cordis.status.removed',
} as const satisfies Record<CardReading, FocusKey>

function stateStatus(state: FocusCordisDefineCard['state']): FocusKey | null {
  switch (state) {
    case 'running': return 'cordis.a11y.defining'
    case 'error': return 'cordis.a11y.failed'
    case 'stopped': return 'cordis.a11y.stopped'
    default: return null
  }
}

function leadingFor(state: FocusCordisDefineCard['state']): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconCodeOutline16 size={14} />
  }
}

/** Render one immutable Package definition. */
export function CordisDefineRow({ card, callId, inspect, cordis, t }: CordisDefineRowProps) {
  const inventory = cordis.useInventory(snapshot => snapshot)
  const loaded = cordis.useLoaded(snapshot => snapshot)
  const [expanded, setExpanded] = useState(false)
  const [selectedSource, setSelectedSource] = useState<SourceTab>(card.clientCode !== null ? 'client' : 'host')
  const sourcePanelId = useId()

  const row = card.pluginId === null
    ? undefined
    : inventory.rows.find(candidate => candidate.pluginId === card.pluginId)
  const reading: CardReading = card.pluginId !== null && inventory.removed.has(card.pluginId)
    ? 'removed'
    : row !== undefined && card.packageId !== null
      ? cordisVisibleStatus(row, card.packageId, loaded)
      : 'idle'
  const name = card.name ?? callId
  const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null
  const open = expanded && expandable
  const a11yState = stateStatus(card.state)
  const hasSource = card.clientCode !== null || card.hostCode !== null
  const activeSource: SourceTab = selectedSource === 'client' && card.clientCode !== null
    ? 'client'
    : selectedSource === 'host' && card.hostCode !== null
      ? 'host'
      : card.clientCode !== null ? 'client' : 'host'
  const activeCode = activeSource === 'client' ? card.clientCode : card.hostCode

  return (
    <div
      className={css.card}
      data-tool="cordis_define"
      data-state={card.state}
      data-terminal={reading === 'removed' || undefined}
      data-cordis-plugin-id={card.pluginId ?? undefined}
      data-cordis-package-id={card.packageId ?? undefined}
      data-cordis-status={reading}
    >
      {a11yState !== null && <span className={css.visuallyHidden}>{t(a11yState)}</span>}
      <DisclosureRow
        rowClassName={css.row}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(card.state)}
        title={t('cordis.row.defineTitle')}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={card.errorSummary === null ? css.name : css.errorSummary}>
              {card.errorSummary ?? name}
            </span>
            {card.errorSummary === null && (
              <span className={css.purpose}>{card.purpose ?? t('cordis.purpose.missing')}</span>
            )}
            {card.pluginId !== null && (
              <span className={css.readout}>
                <span className={css.statusLabel}>{t(READING_LABELS[reading])}</span>
              </span>
            )}
          </>
        )}
      >
        <div className={css.bodyWrap}>
          {hasSource && activeCode !== null && (
            <section className={css.sourceCard}>
              <div className={css.sourceTabs} role="tablist" aria-label={t('cordis.body.source')}>
                {(['client', 'host'] as const).map((source) => {
                  const available = source === 'client' ? card.clientCode !== null : card.hostCode !== null
                  return (
                    <button
                      key={source}
                      id={`${sourcePanelId}-${source}`}
                      type="button"
                      role="tab"
                      aria-controls={sourcePanelId}
                      aria-selected={activeSource === source}
                      className={activeSource === source ? `${css.sourceTab} ${css.sourceTabActive}` : css.sourceTab}
                      disabled={!available}
                      onClick={() => { setSelectedSource(source) }}
                    >
                      {t(source === 'client' ? 'cordis.body.clientCode' : 'cordis.body.hostCode')}
                    </button>
                  )
                })}
              </div>
              <div
                id={sourcePanelId}
                className={css.sourcePanel}
                role="tabpanel"
                aria-labelledby={`${sourcePanelId}-${activeSource}`}
              >
                <CodeBlock
                  code={activeCode}
                  lang="javascript"
                  copyLabel={t('cordis.body.copy')}
                  copiedLabel={t('cordis.body.copied')}
                  className={css.sourceCode}
                />
              </div>
            </section>
          )}
          {card.output !== null && (
            <section className={css.codeSection}>
              <div className={css.sectionLabel}>{t('cordis.body.output')}</div>
              <pre className={css.output} data-error={card.state === 'error' || undefined}>{card.output}</pre>
            </section>
          )}
          {card.pluginId !== null && <div className={css.panelHint}>{t('cordis.panel.hint')}</div>}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {t('cordis.action.inspect')}
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
