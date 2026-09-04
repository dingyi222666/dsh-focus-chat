import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LinkIcon, classifyLinkPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { basename } from '../helpers/format.ts'
import { fitProducedFiles, moreLabel, PRODUCED_SHOWN } from './produced-fit.ts'
import { MessageActions } from '../chrome/MessageActions.tsx'
import { MessageFeedbackActions, type FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import css from './TurnTailRow.module.css'

/** One completed turn's footer: the measured produced-files lane and the chat actions chrome. */
export const TurnTailRow = memo(function TurnTailRow({ item, openFile, forkAt, feedback, t, isLoopback }: {
  item: Extract<FocusFlowItem, { kind: 'turn-tail' }>
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  /** Per-message feedback verbs (the assistant-actions strip's business face). */
  feedback: FocusFeedbackActions
  t: FocusTranslate
  isLoopback: boolean
}) {
  const paths = item.produced
  const closingSeq = item.closingSeq
  // Chips open and the show-in-folder action appears only when the browser
  // is connected over loopback (the chat lane's rule on the npm rc.1 line).
  const limit = Math.min(paths.length, PRODUCED_SHOWN)
  const [shownCount, setShownCount] = useState(limit)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  const moreProbe = useRef<HTMLSpanElement | null>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    const remainderProbe = moreProbe.current
    /* v8 ignore next -- refs attach before layout effects run. */
    if (row === null || remainderProbe === null) return
    const measure = (): void => {
      const styles = getComputedStyle(row)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  const shown = paths.slice(0, shownCount)
  const hidden = paths.length - shownCount
  // The visible chip and its hidden measurement probe share one structure:
  // the leading category glyph plus the file name (the chat lane's link
  // language, so the probe measures the same width the chip occupies).
  const renderChip = (path: string, extra: {
    key: string
    ref?: (node: HTMLButtonElement | null) => void
    onOpen?: () => void
  }): ReactNode => (
    <button
      key={extra.key}
      ref={extra.ref}
      type="button"
      tabIndex={extra.onOpen === undefined ? -1 : undefined}
      className={css.producedFile}
      // The full path is the disambiguator when two turns produce files
      // that share a basename; the chip itself stays short.
      title={path}
      aria-hidden={extra.onOpen === undefined ? true : undefined}
      aria-label={extra.onOpen === undefined ? undefined : t('produced.open', { name: path })}
      onClick={extra.onOpen}
    >
      <LinkIcon kind={classifyLinkPath(path)} className={css.producedFileIcon} />
      <span className={css.producedFileName}>{basename(path)}</span>
    </button>
  )
  return (
    <div className={css.turnTail} data-turn-tail={item.turn} data-time-hover-root>
      {paths.length > 0 && (
        <div className={css.producedRow} ref={rowRef} data-produced-row>
          <span className={css.producedLabel}>{t('produced.label')}</span>
          <div className={css.producedLane}>
            {shown.map(path => renderChip(path, { key: path, onOpen: () => { openFile(path) } }))}
            {hidden > 0 && <span className={css.producedMore}>{moreLabel(t, hidden)}</span>}
          </div>
          {hidden > 0 && isLoopback && (
            <button type="button" className={css.producedShowFolder} onClick={() => { openFile('.') }}>
              <LinkIcon kind="folder" className={css.producedFileIcon} />
              {t('produced.showInFolder')}
            </button>
          )}
          <div className={css.producedMeasure} aria-hidden="true">
            {paths.slice(0, limit).map((path, index) => renderChip(path, {
              key: path,
              ref: (node) => { chipProbes.current[index] = node },
            }))}
            <span ref={moreProbe} className={css.producedMore} />
          </div>
        </div>
      )}
      {closingSeq !== null && (
        <MessageActions
          text={item.closingText}
          time={item.closingTime}
          clock="end"
          onBranch={() => { forkAt(closingSeq) }}
          branchUnavailable={item.branchUnavailable}
          extraActions={item.closingMessageId === null ? undefined : (
            <MessageFeedbackActions
              messageId={item.closingMessageId as never}
              useFeedback={feedback.useFeedback}
              ensure={feedback.ensure}
              rate={feedback.rate}
              toggle={feedback.toggle}
              clearNote={feedback.clearNote}
              t={t}
            />
          )}
          usageAction={(
            <>
              {item.tokenUsage !== undefined && <TurnUsagePanel usage={item.tokenUsage} t={t} />}
              {item.runMs !== null && (
                <TurnTimePanel
                  runMs={item.runMs}
                  tokensPerSecond={item.tokensPerSecond ?? undefined}
                  ttftMs={item.ttftMs ?? undefined}
                  t={t}
                />
              )}
            </>
          )}
          t={t}
        />
      )}
    </div>
  )
})

/** One Host-authoritative pending steering item (the chat pending bubble shape). */
