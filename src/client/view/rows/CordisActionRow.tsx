/**
 * Localized cards for `cordis_stop` and `cordis_undefine` (the official
 * CordisActionRow, ported verbatim: it shares the Run card's CSS module).
 */

import {
  IconInspectOutline12, IconStopFill16, IconTrashOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusCordisActionCard } from '../../model/types.ts'
import css from './CordisRunRow.module.css'

/** Complete props of the focus view's Stop/Remove card (the official card's share). */
export interface CordisActionRowProps {
  /** The stop/remove card derived from the frozen call block. */
  readonly card: FocusCordisActionCard
  /** Wire tool name (`cordis_stop` or `cordis_undefine`) — the card's identity. */
  readonly toolName: string
  /** Owning call id (the summary fallback when the args name no Plugin). */
  readonly callId: string
  /** Reveal this call in the trajectory view; absent hides the inspect button. */
  readonly inspect?: (() => void) | undefined
  readonly t: FocusTranslate
}

/** Render one Stop or Remove call with Cordis-owned localized copy. */
export function CordisActionRow({ card, toolName, callId, inspect, t }: CordisActionRowProps) {
  const remove = toolName === 'cordis_undefine'
  const summary = card.errorSummary ?? card.pluginId ?? callId

  return (
    <div className={css.card} data-tool={toolName} data-state={card.state}>
      <div className={css.row}>
        <span className={css.icon}>
          {card.state === 'error'
            ? <StateDot state="error" />
            : card.state === 'stopped'
              ? <StateDot state="warning" />
              : remove ? <IconTrashOutline16 size={14} /> : <IconStopFill16 size={14} />}
        </span>
        <span className={css.title}>{t(remove ? 'cordis.row.removeTitle' : 'cordis.row.stopTitle')}</span>
        <span className={css.separator} aria-hidden />
        <span className={card.errorSummary === null ? css.summary : css.error}>{summary}</span>
        {inspect !== undefined && (
          <button type="button" className={css.inspect} aria-label={t('cordis.action.inspect')} onClick={inspect}>
            <IconInspectOutline12 />
          </button>
        )}
      </div>
      {card.output !== null && <pre className={css.output}>{card.output}</pre>}
    </div>
  )
}
