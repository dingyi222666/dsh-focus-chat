import { memo, useRef, useState } from 'react'
import type { MarkdownLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { toAssistantBlock, type TurnSlice } from '../../model/turn-slice.ts'
import type { TurnOpeningMessage, TurnSummary } from '../../../protocol.ts'
import { formatElapsed } from '../helpers/format.ts'
import type { ImageLoader } from '../chrome/MessageImage.tsx'
import type { FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { FlowRow, flowKey } from './FlowRow.tsx'
import { TurnFoldLine } from './TurnFoldRow.tsx'
import foldCss from './TurnFoldRow.module.css'
import css from './RemoteTurnRow.module.css'

/** The collapsed row's worked duration reading: the turn's wall time. */
function durationOf(summary: TurnSummary, t: FocusTranslate): string {
  return formatElapsed(Math.max(0, summary.endTime - summary.startTime), t)
}

/** One opening bubble's message row (the real MessageRow chrome). */
function openingItem(nodeKey: string, message: TurnOpeningMessage): FocusFlowItem {
  return {
    kind: 'message',
    nodeKey: `${nodeKey}:o${message.seq}`,
    role: 'user',
    content: message.content,
    time: message.time,
  }
}

/**
 * The collapsed row's closing reply as a real assistant row, rebuilt from the
 * Host index's carried message: a turn whose rows lie beyond the loaded window
 * still renders its actual reply — full blocks, not a one-line preview.
 */
function closingItem(nodeKey: string, summary: TurnSummary): FocusFlowItem | null {
  if (summary.closingContent === null || summary.closingSeq === null) return null
  return {
    kind: 'assistant',
    nodeKey: `${nodeKey}:c${summary.closingSeq}`,
    blocks: summary.closingContent.map(toAssistantBlock),
    running: false,
    interrupted: false,
    thoughtMs: null,
    finalSeq: summary.closingSeq,
  }
}

/**
 * One completed pre-window turn: the opening user bubbles, the fold line (the
 * local turn fold's exact chrome), and the closing reply rendered as a real
 * assistant row from the Host index's carried message. A boundary turn — its
 * closing still inside the window — keeps the real closing reply and turn tail
 * rendered from the window rows below the fold instead. Expanding fetches the
 * turn's event slice through the injected callback and renders the projected
 * rows — the same FlowRow/TurnTailRow chrome the window flow draws. A failed
 * fetch surfaces inline with a retry.
 */
export const RemoteTurnRow = memo(function RemoteTurnRow({
  item, slice, onExpand, t, mdLabels, openFile, forkAt, mentionsByKey, loadImage, feedback, isLoopback,
}: {
  item: Extract<FocusFlowItem, { kind: 'remote-turn' }>
  /** The cached projection for this turn; absent until first expansion. */
  slice: TurnSlice | undefined
  /** Fetch, project, and cache this turn's slice; resolves when cached. */
  onExpand: (turn: number) => Promise<void>
  t: FocusTranslate
  mdLabels: MarkdownLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
  loadImage: ImageLoader
  feedback: FocusFeedbackActions
  isLoopback: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const summary = item.summary
  const duration = durationOf(summary, t)
  // The collapsed row's real closing reply from the Host index; a boundary
  // turn keeps the window's own rows instead (the reply is still loaded).
  const collapsedClosing = item.keepClosing ? null : closingItem(item.nodeKey, summary)

  const request = (): void => {
    if (slice !== undefined) {
      setExpanded(value => !value)
      return
    }
    if (pendingRef.current) return
    pendingRef.current = true
    setLoading(true)
    setError(null)
    void onExpand(item.turn).then(
      () => {
        pendingRef.current = false
        setLoading(false)
        setExpanded(true)
      },
      (cause: unknown) => {
        pendingRef.current = false
        setLoading(false)
        setError(cause instanceof Error && cause.message !== '' ? cause.message : String(cause))
      },
    )
  }

  const rowProps = {
    t, mdLabels, openFile, forkAt, mentionsByKey, loadImage, feedback, isLoopback,
  } as const

  return (
    <div className={foldCss.turnFold} data-remote-turn={item.turn}>
      {summary.opening.map(message => (
        <FlowRow
          key={`o${message.seq}`}
          item={openingItem(item.nodeKey, message)}
          {...rowProps}
        />
      ))}
      <TurnFoldLine
        duration={duration}
        stopped={summary.stopped}
        open={expanded && slice !== undefined}
        onToggle={request}
        t={t}
      />
      {slice !== undefined && expanded && (
        <div className={foldCss.turnFoldBody} data-remote-turn-body>
          {slice.work.map(inner => (
            <FlowRow key={flowKey(inner)} item={inner} {...rowProps} />
          ))}
          {/* A boundary turn keeps its real closing reply and tail rendered
              from the window rows below the fold — the projected body adds
              the work only, so the reply never paints twice. */}
          {!item.keepClosing && slice.closing !== null && <FlowRow item={slice.closing} {...rowProps} />}
          {!item.keepClosing && slice.tail !== null && <FlowRow item={slice.tail} {...rowProps} />}
        </div>
      )}
      {slice === undefined && loading && (
        <div className={css.remoteTurnHint}>{t('loading')}</div>
      )}
      {error !== null && (
        <div className={css.remoteTurnError}>
          <span className={css.remoteTurnErrorText}>{error}</span>
          <button type="button" className={css.remoteTurnRetry} onClick={request}>{t('retry')}</button>
        </div>
      )}
      {/* The collapsed row's real closing reply, carried by the Host index —
          a dim one-line preview never paints in its place. */}
      {slice === undefined && !expanded && collapsedClosing !== null && (
        <FlowRow item={collapsedClosing} {...rowProps} />
      )}
    </div>
  )
})
