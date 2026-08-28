import { memo, useState } from 'react'
import { IconApiOutline14, IconChevronDownOutline14, IconChevronRightOutline14, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { CommandRow } from './CommandRow.tsx'
import css from './CompactionRow.module.css'

/** One landed-compaction marker (the chat CompactionItem chrome). */
export const CompactionRow = memo(function CompactionRow({ item, title, fallbackSummary, t, mdLabels }: {
  item: Extract<FocusFlowItem, { kind: 'compaction' }>
  /** Optional command title for a manual compaction folded into this marker. */
  title?: string | undefined
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null | undefined
  t: FocusTranslate
  mdLabels: MarkdownLabels
}) {
  const [expanded, setExpanded] = useState(false)
  const expandable = item.summary !== null
  const open = expandable && expanded
  const summary = item.shadowedItemCount !== null && item.shadowedTokenCount !== null
    ? t('compaction.completed', {
      items: item.shadowedItemCount,
      tokens: item.shadowedTokenCount,
    })
    : fallbackSummary
      ?? (expandable ? t('compaction.expand') : t('compaction.unavailable'))
  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.compactionLeading} aria-hidden>
          <span className={css.compactionContextIcon} data-compaction-icon="context">
            <IconApiOutline14 />
          </span>
          <span className={css.compactionDisclosureIcon} data-compaction-disclosure={open ? 'expanded' : 'collapsed'}>
            {!open ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
          </span>
        </span>
        <span className={css.compactionTitle}>{title ?? t('compaction')}</span>
        <span className={css.compactionSep} aria-hidden />
        <span className={css.compactionSummary}>{summary}</span>
      </button>
      {open && item.summary !== null && (
        <div className={css.compactionBody}>
          <MarkdownText text={item.summary} labels={mdLabels} />
        </div>
      )}
    </div>
  )
})

/** One manual `/compact` lifecycle: the command card, or the checkpoint marker. */
export const ManualCompactionRow = memo(function ManualCompactionRow({ item, t, mdLabels }: {
  item: Extract<FocusFlowItem, { kind: 'manual-compaction' }>
  t: FocusTranslate
  mdLabels: MarkdownLabels
}) {
  if (item.compaction !== null) {
    return (
      <CompactionRow
        item={{
          kind: 'compaction',
          nodeKey: item.nodeKey,
          summary: item.compaction.summary,
          shadowedItemCount: item.compaction.shadowedItemCount,
          shadowedTokenCount: item.compaction.shadowedTokenCount,
        }}
        title="compact"
        fallbackSummary={item.outcomeText}
        t={t}
        mdLabels={mdLabels}
      />
    )
  }
  return (
    <CommandRow
      item={{
        kind: 'command',
        nodeKey: item.nodeKey,
        name: item.name,
        args: null,
        outcomeText: item.outcomeText,
        outcomeError: item.outcomeError,
        running: item.running,
      }}
      runningSummary={t('compaction.running')}
      t={t}
    />
  )
})

/** One model-retry row (the chat ModelRetryItem chrome: countdown + details). */
