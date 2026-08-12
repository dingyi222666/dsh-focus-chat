import { memo } from 'react'
import { ImageGallery, type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import { JsonBlock, MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FocusFlowItem } from '../../model/types.ts'
import { formatSeconds } from '../../model/text.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import { messageImageLabels } from '../helpers/image-labels.ts'
import { ThinkRow } from './ThinkRow.tsx'
import { ToolGroupRow } from './ToolGroupRow.tsx'
import { ContextFoldRow, ContextRow } from './ContextRow.tsx'
import { MessageRow } from './UserBubble.tsx'
import { TurnTailRow } from './TurnTailRow.tsx'
import { CommandRow } from './CommandRow.tsx'
import { CompactionRow, ManualCompactionRow } from './CompactionRow.tsx'
import { RetryRow } from './RetryRow.tsx'
import { TurnFoldRow } from './TurnFoldRow.tsx'
import css from './FlowRow.module.css'

export const FlowRow = memo(function FlowRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey, loadImage, isLoopback }: {
  item: FocusFlowItem
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  /** Inline file-mention vocabulary per assistant node key (closing prose). */
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
  isLoopback: boolean
}) {
  switch (item.kind) {
    case 'message':
      return item.role === 'context'
        ? <ContextRow item={item} t={t} codeLabels={codeLabels} />
        : <MessageRow item={item} t={t} codeLabels={codeLabels} loadImage={loadImage} />
    case 'context-fold':
      return <ContextFoldRow item={item} t={t} codeLabels={codeLabels} loadImage={loadImage} />
    case 'assistant': {
      // The chat assistant's shell rule: a node that is only tool-call heads
      // (or empty) paints nothing, so the flow shows no dead gap.
      if (!item.running && !item.interrupted
        && !item.blocks.some(block => block.kind !== 'tool-call')) return null
      // Blocks render in their logged order — the chat AssistantMarkdown
      // rule — so a reasoning block preceding the reply sits above the text
      // ("Thought for Ns" above the final output, never below it).
      const last = item.blocks.length - 1
      return (
        <div className={css.assistant} data-streaming={item.running || undefined}>
          {item.blocks.map((block, index) => {
            switch (block.kind) {
              case 'text':
                return (
                  <MarkdownText
                    key={index}
                    text={block.text}
                    streaming={item.running}
                    codeLabels={codeLabels}
                    fileMentions={mentionsByKey.get(item.nodeKey)}
                  />
                )
              case 'reasoning':
                return (
                  <ThinkRow
                    key={index}
                    text={block.text}
                    running={item.running && index === last}
                    title={item.running || item.thoughtMs === null
                      ? t('think')
                      : t('thought.duration', { n: formatSeconds(item.thoughtMs) })}
                    t={t}
                  />
                )
              case 'image':
                return (
                  <ImageGallery
                    key={index}
                    images={[block]}
                    load={loadImage}
                    align="start"
                    labels={messageImageLabels(t)}
                  />
                )
              case 'tool-call':
                return null
              default:
                return (
                  <JsonBlock
                    key={index}
                    label={t('unknownBlock')}
                    payload={block.block}
                    truncatedLabel={jsonTruncated(t)}
                  />
                )
            }
          })}
          {item.interrupted && <div className={css.stopped}>{t('stopped')}</div>}
        </div>
      )
    }
    case 'tools':
      return <ToolGroupRow group={item.group} t={t} codeLabels={codeLabels} openFile={openFile} />
    case 'turn-fold':
      return (
        <TurnFoldRow
          item={item}
          t={t}
          codeLabels={codeLabels}
          openFile={openFile}
          forkAt={forkAt}
          mentionsByKey={mentionsByKey}
          loadImage={loadImage}
          isLoopback={isLoopback}
        />
      )
    case 'turn-tail':
      return (
        <TurnTailRow
          item={item}
          openFile={openFile}
          forkAt={forkAt}
          t={t}
          isLoopback={isLoopback}
        />
      )
    case 'command':
      return <CommandRow item={item} t={t} />
    case 'manual-compaction':
      return <ManualCompactionRow item={item} t={t} codeLabels={codeLabels} />
    case 'compaction':
      return <CompactionRow item={item} t={t} codeLabels={codeLabels} />
    case 'retry':
      return <RetryRow item={item} t={t} />
    case 'turn-error':
      return (
        <div className={css.turnErrorRow} role="status">
          <StateDot state="error" className={css.turnErrorDot} />
          <div className={css.turnErrorCopy}>
            <span className={css.turnErrorTitle}>{t('turnError')}</span>
            <span className={css.turnErrorMessage}>{item.message}</span>
          </div>
          {item.code !== undefined && <code className={css.turnErrorCode}>{item.code}</code>}
        </div>
      )
    case 'unknown':
      return (
        <div className={css.contextRow}>
          <JsonBlock
            label={t('unknownSurface', { type: item.nodeKind })}
            payload={item.data}
            truncatedLabel={jsonTruncated(t)}
          />
        </div>
      )
  }
})

/** Stable React key for one flow item. */
export function flowKey(item: FocusFlowItem): string {
  return item.kind === 'tools' ? item.group.nodeKeys[0] ?? 'tools' : item.nodeKey
}
