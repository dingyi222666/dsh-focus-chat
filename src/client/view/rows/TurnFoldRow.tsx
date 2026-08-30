import { memo, useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { formatElapsed } from '../helpers/format.ts'
import type { ImageLoader } from '../chrome/MessageImage.tsx'
import type { FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { FlowRow, flowKey } from './FlowRow.tsx'
import css from './TurnFoldRow.module.css'

/** The turn fold's label button — "worked for X" / "stopped after X" with the
 *  trailing chevron. Shared by the window fold (TurnFoldRow) and the remote
 *  fold (RemoteTurnRow) so the two lines stay pixel-identical. */
export const TurnFoldLine = memo(function TurnFoldLine({ duration, stopped, open, onToggle, t }: {
  /** Display duration text (already localized). */
  duration: string
  /** Whether the turn reads stopped-after instead of worked. */
  stopped: boolean
  open: boolean
  onToggle: () => void
  t: FocusTranslate
}) {
  return (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={css.label}>
        {stopped
          ? t('turnFold.stopped', { duration })
          : t('worked', { duration })}
      </span>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
})

/**
 * One completed turn's work line, drawn with the official turn-process
 * chrome: a bare label button with a trailing chevron and the l2 separator
 * underneath — no leading icon, the official 14px/24px label type — expanding
 * the turn's folded rows. The measurement (worked duration, stopped state)
 * stays the focus view's reading; the turn-process node's counts ride the
 * model.
 */
export const TurnFoldRow = memo(function TurnFoldRow({ item, t, mdLabels, openFile, forkAt, mentionsByKey, loadImage, feedback, isLoopback }: {
  item: Extract<FocusFlowItem, { kind: 'turn-fold' }>
  t: FocusTranslate
  mdLabels: MarkdownLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
  /** Per-message feedback verbs (the assistant-actions strip's business face). */
  feedback: FocusFeedbackActions
  isLoopback: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const duration = formatElapsed(item.durationMs, t)
  return (
    <div className={css.turnFold} data-turn-fold={item.turn}>
      <TurnFoldLine
        duration={duration}
        stopped={item.stopped}
        open={expanded}
        onToggle={() => { setExpanded(value => !value) }}
        t={t}
      />
      {expanded && (
        <div className={css.turnFoldBody} data-turn-fold-body>
          {item.items.map(inner => (
            <FlowRow
              key={flowKey(inner)}
              item={inner}
              t={t}
              mdLabels={mdLabels}
              openFile={openFile}
              forkAt={forkAt}
              mentionsByKey={mentionsByKey}
              loadImage={loadImage}
              feedback={feedback}
              isLoopback={isLoopback}
            />
          ))}
        </div>
      )}
    </div>
  )
})
