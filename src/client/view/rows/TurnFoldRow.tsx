import { memo, useState, type MouseEvent } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusPresentedActions, FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import type { DiffStyle } from '../../../settings.ts'
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
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void
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
export const TurnFoldRow = memo(function TurnFoldRow({ item, t, mdLabels, pathImages, presented, openFile, openSkill, inspect, forkAt, mentionsByKey, loadImage, feedback, diffStyle }: {
  item: Extract<FocusFlowItem, { kind: 'turn-fold' }>
  t: FocusTranslate
  mdLabels: MarkdownLabels
  /** Local media-path resolver for assistant prose (the chat AssistantMarkdown vocabulary). */
  pathImages: MarkdownPathImages
  /** Presented-delivery face for the turn-tail cards. */
  presented: FocusPresentedActions
  openFile: (path: string, options?: { line?: number }) => void
  /** Open the source of a skill a sent message referenced (the chat openSkill). */
  openSkill: (name: string) => void
  /** Reveal a tool call in the trajectory view (the chat's Inspect action). */
  inspect: (callId: string) => void
  forkAt: (seq: number) => void
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
  /** Per-message feedback verbs (the assistant-actions strip's business face). */
  feedback: FocusFeedbackActions
  /** The file-mutation diff renderer (official DiffBlock vs the changes bar). */
  diffStyle: DiffStyle
}) {
  const [expanded, setExpanded] = useState(false)
  const duration = formatElapsed(item.durationMs, t)
  return (
    <div className={css.turnFold} data-turn-fold={item.turn}>
      <TurnFoldLine
        duration={duration}
        stopped={item.stopped}
        open={expanded}
        onToggle={(event) => {
          // The official TurnProcessNodeView keeps focus on the fold button.
          event.currentTarget.focus()
          setExpanded(value => !value)
        }}
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
              pathImages={pathImages}
              presented={presented}
              openFile={openFile}
              openSkill={openSkill}
              inspect={inspect}
              forkAt={forkAt}
              mentionsByKey={mentionsByKey}
              loadImage={loadImage}
              feedback={feedback}
              diffStyle={diffStyle}
            />
          ))}
        </div>
      )}
    </div>
  )
})
