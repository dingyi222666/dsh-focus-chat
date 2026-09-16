/**
 * `cordis_run` card. The official card is also the host seat for a
 * Package-owned interactive UI (its keyed `tool.view.cordis` child slot); the
 * focus view cannot dispatch that slot — a slot's declaring entry is the only
 * component allowed to dispatch it — so this port always renders the arm the
 * official uses when no view is registered: the `card.output` `<pre>` (and
 * nothing at all when the output is null). Every other part of the card (DOM,
 * status readings, copy, CSS metrics) is identical to the official one.
 */

import { useEffect } from 'react'
import {
  IconCodeOutline16, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusCordisActions, FocusTranslate } from '../../contract/props.ts'
import { cordisToolViewKey, cordisVisibleStatus, type FocusCordisVisibleStatus } from '../../model/cordis.ts'
import type { FocusCordisRunCard } from '../../model/types.ts'
import type { FocusKey } from '../../locales.ts'
import css from './CordisRunRow.module.css'

/** Complete props of the focus view's Run card (the official card's share). */
export interface CordisRunRowProps {
  /** The run card derived from the frozen call block. */
  readonly card: FocusCordisRunCard
  /** Owning call id (the card index's fallback identity). */
  readonly callId: string
  /** Reveal this call in the trajectory view; absent hides the inspect button. */
  readonly inspect?: (() => void) | undefined
  /** The Cordis card face (inventory, live activations, and the run-card index). */
  readonly cordis: FocusCordisActions
  readonly t: FocusTranslate
}

type RunReading = FocusCordisVisibleStatus | 'awaiting-approval' | 'failed' | 'removed' | 'superseded'

const READING_LABELS = {
  idle: 'cordis.status.idle',
  'awaiting-approval': 'cordis.status.awaitingApproval',
  failed: 'cordis.status.failed',
  'client-pending': 'cordis.status.clientPending',
  running: 'cordis.status.running',
  removed: 'cordis.status.removed',
  superseded: 'cordis.status.superseded',
} as const satisfies Record<RunReading, FocusKey>

/** Render one activation result and its latest-output fallback. */
export function CordisRunRow({ card, callId, inspect, cordis, t }: CordisRunRowProps) {
  const inventory = cordis.useInventory(snapshot => snapshot)
  const loaded = cordis.useLoaded(snapshot => snapshot)
  const latest = cordis.useRunCards(snapshot => snapshot)
  const activeRuns = cordis.useActiveRuns(snapshot => snapshot)
  const key = card.state === 'ok'
    && card.pluginId !== null
    && card.packageId !== null
    && card.pluginRunId !== null
    && card.seq !== null
    ? cordisToolViewKey(card.pluginId, card.packageId)
    : null
  const { onObserveRunCard } = cordis
  useEffect(() => {
    if (key === null || card.seq === null || card.pluginRunId === null) return
    onObserveRunCard({ key, callId, seq: card.seq, pluginRunId: card.pluginRunId })
  }, [callId, card.pluginRunId, card.seq, key, onObserveRunCard])

  const row = card.pluginId === null
    ? undefined
    : inventory.rows.find(candidate => candidate.pluginId === card.pluginId)
  const pointer = key === null ? undefined : latest.get(key)
  const superseded = pointer !== undefined && pointer.callId !== callId && pointer.seq >= (card.seq ?? -1)
  const activity = card.pluginId === null ? undefined : activeRuns.get(card.pluginId)
  const attempt = card.pluginRunId !== null && row?.latestRun?.pluginRunId === card.pluginRunId
    ? row.latestRun
    : undefined
  const awaitingApproval = attempt?.status === 'awaiting-approval' || (card.packageId !== null
    && activity?.phase === 'awaiting-approval'
    && activity.packageId === card.packageId
    && (card.mode === null || activity.mode === card.mode))
  const reading: RunReading = card.pluginId !== null && inventory.removed.has(card.pluginId)
    ? 'removed'
    : superseded
      ? 'superseded'
      : awaitingApproval
        ? 'awaiting-approval'
        : attempt?.status === 'failed'
          ? 'failed'
          : row !== undefined && card.packageId !== null
            ? cordisVisibleStatus(row, card.packageId, loaded)
            : 'idle'
  const status = t(READING_LABELS[reading])
  const summary = card.errorSummary
    ?? (card.pluginId === null ? callId : `${card.pluginId}${card.packageId === null ? '' : ` · ${card.packageId}`}`)
  const showBusiness = reading === 'running' && key !== null

  return (
    <div
      className={css.card}
      data-tool="cordis_run"
      data-state={card.state}
      data-cordis-plugin-id={card.pluginId ?? undefined}
      data-cordis-package-id={card.packageId ?? undefined}
      data-cordis-run-id={card.pluginRunId ?? undefined}
      data-cordis-status={reading}
    >
      <div className={css.row}>
        <span className={css.icon}>
          {card.state === 'error'
            ? <StateDot state="error" />
            : card.state === 'stopped'
              ? <StateDot state="warning" />
              : <IconCodeOutline16 size={14} />}
        </span>
        <span className={css.title}>{t(card.mode === 'update' ? 'cordis.row.updateTitle' : 'cordis.row.runTitle')}</span>
        <span className={css.separator} aria-hidden />
        <span className={card.errorSummary === null ? css.summary : css.error}>{summary}</span>
        <span className={css.status}>{status}</span>
        {inspect !== undefined && (
          <button type="button" className={css.inspect} aria-label={t('cordis.action.inspect')} onClick={inspect}>
            <IconInspectOutline12 />
          </button>
        )}
      </div>
      {reading === 'removed' && <div className={css.message}>{t('cordis.run.removed')}</div>}
      {reading === 'superseded' && <div className={css.message}>{t('cordis.run.superseded')}</div>}
      {reading === 'failed' && attempt?.error !== undefined && (
        <div className={css.message}>{attempt.error.message}</div>
      )}
      {showBusiness && (
        <div className={css.business} data-cordis-business-view={key}>
          {/* No `tool.view.cordis` dispatch here: this port always takes the
              official no-view fallback (the output `<pre>`, or nothing). */}
          {card.output === null ? null : <pre className={css.output}>{card.output}</pre>}
        </div>
      )}
      {!showBusiness && reading !== 'removed' && reading !== 'superseded' && card.output !== null && (
        <pre className={css.output}>{card.output}</pre>
      )}
    </div>
  )
}
