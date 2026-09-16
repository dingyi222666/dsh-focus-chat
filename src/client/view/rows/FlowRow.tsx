import { Fragment, memo } from 'react'
import { JsonBlock, MarkdownText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages, UserTextReferences } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusPresentedActions, FocusTranslate } from '../../contract/props.ts'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FocusFlowItem } from '../../model/types.ts'
import type { DiffStyle } from '../../../settings.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import { messageImageLabels } from '../helpers/image-labels.ts'
import { ImageGallery, type ImageLoader } from '../chrome/MessageImage.tsx'
import type { FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { ThinkRow } from './ThinkRow.tsx'
import { ToolCallRow } from './ToolCallRow.tsx'
import { ToolGroupRow } from './ToolGroupRow.tsx'
import { ContextFoldRow, ContextRow } from './ContextRow.tsx'
import { SystemPromptRow } from './SystemPromptRow.tsx'
import { MessageRow } from './UserBubble.tsx'
import { TurnTailRow } from './TurnTailRow.tsx'
import { CommandInputRow } from './CommandInputRow.tsx'
import { CommandRow } from './CommandRow.tsx'
import { WorkflowRunPanel, type WorkflowRunSessionsHook } from './WorkflowRunPanel.tsx'
export type { WorkflowRunSessionsHook }
import { CompactionRow, ManualCompactionRow } from './CompactionRow.tsx'
import { RetryRow } from './RetryRow.tsx'
import { TurnFoldRow } from './TurnFoldRow.tsx'
import css from './FlowRow.module.css'

export const FlowRow = memo(function FlowRow({ item, t, mdLabels, pathImages, presented, openFile, openSkill, inspect, forkAt, mentionsByKey, loadImage, feedback, diffStyle, sessionId, useSessions, openSession }: {
  item: FocusFlowItem
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
  /** Inline file-mention vocabulary per assistant node key (closing prose). */
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
  /** Per-message feedback verbs (the assistant-actions strip's business face). */
  feedback: FocusFeedbackActions
  /** The file-mutation diff renderer (official DiffBlock vs the changes bar). */
  diffStyle: DiffStyle
  /** Owning Session id (the workflow run's child-session navigation). */
  sessionId: string
  /** Session list snapshot selector, for the workflow run's navigable members. */
  useSessions: WorkflowRunSessionsHook
  /** Open one workflow member's child Session. */
  openSession: (sessionId: string) => void
}) {
  switch (item.kind) {
    case 'message':
      return item.role === 'context'
        ? <ContextRow item={item} t={t} mdLabels={mdLabels} />
        : (
          <MessageRow
            item={item}
            t={t}
            mdLabels={mdLabels}
            loadImage={loadImage}
            references={{ openFile: path => { void openFile(path) }, openSkill }}
          />
        )
    case 'context-fold':
      return <ContextFoldRow item={item} t={t} mdLabels={mdLabels} />
    case 'system-prompt':
      return <SystemPromptRow text={item.text} update={item.update} t={t} />
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
          <div className={css.body}>
          {item.blocks.map((block, index) => {
            switch (block.kind) {
              case 'text':
                return (
                  <MarkdownText
                    key={index}
                    text={block.text}
                    streaming={item.running}
                    labels={mdLabels}
                    fileMentions={mentionsByKey.get(item.nodeKey)}
                    pathImages={pathImages}
                  />
                )
              case 'reasoning':
                return (
                  <ThinkRow
                    key={index}
                    text={block.text}
                    running={item.running && index === last}
                    // The official ReasoningRow keeps the plain Think title
                    // whether streaming or settled.
                    title={t('think')}
                    t={t}
                  />
                )
              case 'image': {
                // Consecutive image blocks share one gallery so several
                // images tile into rows instead of each opening a one-image
                // group of its own (the chat AssistantMarkdown rule).
                const start = index
                const group = [block]
                while (index + 1 < item.blocks.length) {
                  const next = item.blocks[index + 1]
                  if (next === undefined || next.kind !== 'image') break
                  group.push(next)
                  index += 1
                }
                return (
                  <Fragment key={start}>
                    <ImageGallery
                      images={group.map(({ attachment }) => ({ attachment }))}
                      load={loadImage}
                      align="start"
                      labels={messageImageLabels(t)}
                    />
                  </Fragment>
                )
              }
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
          {item.interrupted && <span className={css.stopped}>{t('stopped')}</span>}
          </div>
        </div>
      )
    }
    case 'tools': {
      // A group that folded exactly one settled call — with nothing absorbed
      // — paints the call's own row instead of a summary line: the first
      // tool call of a run reads its row, the fold only starts once a second
      // call joins.
      const group = item.group
      if (group.items.length === 1
        && group.context.length === 0
        && 'callId' in group.items[0]
        && group.items[0].state !== 'running') {
        return <ToolCallRow row={group.items[0]} t={t} openFile={openFile} inspect={inspect} diffStyle={diffStyle} loadImage={loadImage} />
      }
      return <ToolGroupRow group={group} t={t} mdLabels={mdLabels} openFile={openFile} inspect={inspect} diffStyle={diffStyle} loadImage={loadImage} />
    }
    case 'turn-fold':
      return (
        <TurnFoldRow
          item={item}
          t={t}
          mdLabels={mdLabels}
          pathImages={pathImages}
          presented={presented}
          openFile={openFile}
          openSkill={openSkill}
          sessionId={sessionId}
          useSessions={useSessions}
          openSession={openSession}
          inspect={inspect}
          forkAt={forkAt}
          mentionsByKey={mentionsByKey}
          loadImage={loadImage}
          feedback={feedback}
          diffStyle={diffStyle}
        />
      )
    case 'turn-tail':
      return (
        <TurnTailRow
          item={item}
          presented={presented}
          openFile={openFile}
          forkAt={forkAt}
          feedback={feedback}
          t={t}
        />
      )
    case 'command':
      return <CommandRow item={item} t={t} />
    case 'command-input':
      return <CommandInputRow item={item} t={t} />
    case 'workflow-run':
      return (
        <WorkflowRunPanel
          item={item}
          sessionId={sessionId}
          useSessions={useSessions}
          openSession={openSession}
          t={t}
        />
      )
    case 'manual-compaction':
      return <ManualCompactionRow item={item} t={t} mdLabels={mdLabels} />
    case 'compaction':
      return <CompactionRow item={item} t={t} mdLabels={mdLabels} />
    case 'retry':
      return <RetryRow item={item} t={t} />
    case 'turn-error':
      return (
        <div className={css.turnErrorRow} role="status">
          <StateDot state="error" className={css.turnErrorDot} />
          <div className={css.turnErrorCopy}>
            <span className={css.turnErrorTitle}>{t('turnError')}</span>
            <span className={css.turnErrorMessage}>
              {item.code === 'AUTH' ? t('message.failure.auth') : item.message}
            </span>
          </div>
          {item.code !== undefined && <code className={css.turnErrorCode}>{item.code}</code>}
        </div>
      )
    case 'turn-max-tokens':
      // The official TurnMaxTokensItem: a warning dot, the title, and the
      // continuation hint.
      return (
        <div className={css.turnErrorRow} role="status">
          <StateDot state="warning" className={css.turnErrorDot} />
          <div className={css.turnErrorCopy}>
            <span className={css.maxTokensTitle}>{t('maxTokens')}</span>
            <span className={css.turnErrorMessage}>{t('maxTokens.hint')}</span>
          </div>
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
