import { memo, useState } from 'react'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import a11yCss from '../accessibility.module.css'
import css from './CommandRow.module.css'

/** One command row (the chat GenericCommandCard chrome: name · settlement, expandable multiline body). */
export const CommandRow = memo(function CommandRow({ item, runningSummary, t }: {
  item: Extract<FocusFlowItem, { kind: 'command' }>
  /** Command-specific running copy; absent uses the generic running label. */
  runningSummary?: string | undefined
  t: FocusTranslate
}) {
  const [expanded, setExpanded] = useState(false)
  const text = item.outcomeText
  const summary = item.running
    ? runningSummary ?? t('command.running')
    : text ?? (item.outcomeError ? t('command.failed') : t('command.done'))
  // Title is the bare command name: the row already reads `name · outcome`,
  // and the dispatched line's own `/` and arguments only restate what the
  // settlement text says (the chat row's rule).
  const title = item.name ?? t('command')
  const body = text !== null && text.includes('\n') ? text : null
  const open = expanded && body !== null
  return (
    <div className={css.commandRow} data-state={item.running ? 'running' : item.outcomeError ? 'error' : 'ok'}>
      {item.running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        className={css.commandRowInner}
        icon={item.outcomeError ? <StateDot state="error" /> : <IconApiOutline14 size={14} />}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.thinkSeparator} aria-hidden />
            <span className={css.commandSummary} data-error={item.outcomeError || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.commandBody} data-error={item.outcomeError || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
})

/** One landed-compaction marker (the chat CompactionItem chrome). */
