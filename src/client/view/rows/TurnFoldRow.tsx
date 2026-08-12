import { memo, useState } from 'react'
import { DisclosureRow, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { formatElapsed } from '../helpers/format.ts'
import { FlowRow, flowKey } from './FlowRow.tsx'
import css from './TurnFoldRow.module.css'

export const TurnFoldRow = memo(function TurnFoldRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey, loadImage, isLoopback }: {
  item: Extract<FocusFlowItem, { kind: 'turn-fold' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
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
              isLoopback={isLoopback}
            />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** One condensed flow row, dispatched on kind. */
