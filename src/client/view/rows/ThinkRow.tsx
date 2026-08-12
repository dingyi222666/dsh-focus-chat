import { memo, useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import { firstLine, latestLine, useThrottledVisualUpdate } from '../helpers/format.ts'
import a11yCss from '../accessibility.module.css'
import css from './ThinkRow.module.css'

/**
 * One Think disclosure, mirroring the chat reasoning row: one line by
 * default, previewing the streaming tail while running (end-following
 * scroll), the first line once settled; the body expands on click.
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
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])
  return (
    <div className={css.thinkWrap} data-state={running ? 'running' : 'ok'}>
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
            <span ref={summaryRef} className={css.thinkSummary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
})

