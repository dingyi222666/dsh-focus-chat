import { memo, useState } from 'react'
import { DisclosureRow, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { formatElapsed } from '../helpers/format.ts'
import type { ImageLoader } from '../chrome/MessageImage.tsx'
import type { FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { FlowRow, flowKey } from './FlowRow.tsx'
import css from './TurnFoldRow.module.css'

export const TurnFoldRow = memo(function TurnFoldRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey, loadImage, feedback, isLoopback }: {
  item: Extract<FocusFlowItem, { kind: 'turn-fold' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
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
      <DisclosureRow
        className={css.turnFoldRow}
        icon={<IconSparkle16 size={16} />}
        title={item.stopped
          ? t('turnFold.stopped', { duration })
          : t('worked', { duration })}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
      >
        <div className={css.turnFoldBody} data-turn-fold-body>
          {item.items.map(inner => (
            <FlowRow
              key={flowKey(inner)}
              item={inner}
              t={t}
              codeLabels={codeLabels}
              openFile={openFile}
              forkAt={forkAt}
              mentionsByKey={mentionsByKey}
              loadImage={loadImage}
              feedback={feedback}
              isLoopback={isLoopback}
            />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** One condensed flow row, dispatched on kind. */
