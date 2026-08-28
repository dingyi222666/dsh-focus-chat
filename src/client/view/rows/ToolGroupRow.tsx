import { Fragment, memo, useState } from 'react'
import { DisclosureRow, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusToolGroup } from '../../model/types.ts'
import { caseSegments, groupTitleParts } from './group-title.ts'
import { ContextRow } from './ContextRow.tsx'
import { ThinkRow } from './ThinkRow.tsx'
import { ToolCallRow } from './ToolCallRow.tsx'
import css from './ToolGroupRow.module.css'

/** One folded run of Tool calls: the step-summary line with its metrics. */
export const ToolGroupRow = memo(function ToolGroupRow({ group, t, mdLabels, openFile }: {
  group: FocusToolGroup
  t: FocusTranslate
  mdLabels: MarkdownLabels
  openFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The summary line reads the settled metrics only — a running call joins
  // the line once it settles (the think lifecycle) and renders as a live
  // row at the end of the flow meanwhile. Failure tallies render in the
  // error color, parentheses included.
  const segments = caseSegments(groupTitleParts(group, t))
  // A group with no line — every call still running (the live row at the
  // end of the flow carries the display) or younger than the live-row
  // debounce — paints nothing: the summary gains the entries directly once
  // they settle, so a fast call never flashes.
  if (segments.length === 0) return null
  return (
    <div className={css.groupRow} data-state={group.running ? 'running' : 'ok'}>
    <DisclosureRow
      className={css.groupRowInner}
      icon={<IconSparkle16 size={16} />}
      title=""
      open={expanded}
      expandable
      expandOnRowClick
      keepContentWhenOpen
      onToggle={() => { setExpanded(value => !value) }}
      collapsedContent={(
        <span className={css.groupTitleLine} data-group-title>
          {segments.map((segment, index) => (
            <Fragment key={index}>
              {index > 0 && t('tool.separator')}
              {segment.text}
              {segment.failed !== undefined && (
                <span className={css.groupTitleFailed} data-group-title-failed>{segment.failed}</span>
              )}
            </Fragment>
          ))}
        </span>
      )}
    >
      <div className={css.calls} data-calls>
        {group.items.map((item, index) => (
          // A running call renders as the flow-end live row, not here too
          // (the settled calls only appear in the expanded group).
          'callId' in item ? (
            item.state === 'running'
              ? null
              : <ToolCallRow key={item.callId} row={item} t={t} openFile={openFile} />
          ) : 'kind' in item ? (
            // An absorbed context injection expands to its chat row.
            <ContextRow key={item.nodeKey} item={item} t={t} mdLabels={mdLabels} />
          ) : (
            // The absorbed thinking is settled reasoning — only settled
            // thinks fold into a group, the streaming tail stays on the
            // running assistant's own Think row — so it never sweeps, even
            // while another call in the group is still executing.
            <ThinkRow key={index} text={item.text} running={item.running} title={t('think')} t={t} />
          )
        ))}
      </div>
    </DisclosureRow>
    </div>
  )
})

/** The chat IconActions chrome: copy, optional branch, and an optional date-aware clock. */
