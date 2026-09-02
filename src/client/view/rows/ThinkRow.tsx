import { memo, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import { firstLine, latestLine } from '../helpers/format.ts'
import a11yCss from '../accessibility.module.css'
import css from './ThinkRow.module.css'

/**
 * One Think disclosure, mirroring the chat reasoning row: one line by
 * default, previewing the streaming tail while running (end-following CSS
 * alignment — the alpha.5 ReasoningRow's nested summary text), the first
 * line once settled; the body expands on click.
 */
export const ThinkRow = memo(function ThinkRow({ text, running, title, t }: {
  text: string
  /** Whether the reasoning is still the streaming tail. */
  running: boolean
  /** Row title: the plain Think label, or the duration for a standalone row. */
  title: string
  t: FocusTranslate
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = running ? latestLine(text) : firstLine(text)
  return (
    <div className={css.thinkWrap} data-state={running ? 'running' : 'ok'} data-expanded={expanded || undefined}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        className={css.thinkRow}
        rowClassName={css.thinkRowInner}
        icon={<IconThinkOutline14 size={14} />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.thinkSeparator} aria-hidden />
            <span className={css.thinkSummary} data-follow-end={running || undefined}>
              <span className={css.thinkSummaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
})

