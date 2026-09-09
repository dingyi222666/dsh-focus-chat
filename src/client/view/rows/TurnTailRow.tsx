import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, LinkIcon, classifyLinkPath, IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusPresentedActions, FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { presentedFileUrl } from '../../model/presented-open.ts'
import { basename } from '../helpers/format.ts'
import { fitProducedFiles, moreLabel, PRODUCED_SHOWN } from './produced-fit.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import { MessageActions } from '../chrome/MessageActions.tsx'
import { MessageFeedbackActions, type FocusFeedbackActions } from '../chrome/MessageFeedbackActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import css from './TurnTailRow.module.css'
import presentedCss from './PresentedFileCard.module.css'

/** Delivered cards shown before the "all files" toggle (the official count). */
const COLLAPSED_PRESENTED_COUNT = 4

/** One completed turn's footer: the measured produced-files lane and the chat actions chrome. */
export const TurnTailRow = memo(function TurnTailRow({ item, presented, openFile, forkAt, feedback, t }: {
  item: Extract<FocusFlowItem, { kind: 'turn-tail' }>
  /** Presented-delivery face (durable open status, Host metadata, verbs). */
  presented: FocusPresentedActions
  openFile: (path: string, options?: { line?: number }) => void
  forkAt: (seq: number) => void
  /** Per-message feedback verbs (the assistant-actions strip's business face). */
  feedback: FocusFeedbackActions
  t: FocusTranslate
}) {
  const paths = item.produced
  const delivered = item.presented
  const closingSeq = item.closingSeq
  // Presented cards: the durable open status and the Host desktop metadata,
  // read through the injected selector hooks.
  const openStates = presented.useOpen(value => value)
  const host = presented.useHost(value => value)
  const [presentedExpanded, setPresentedExpanded] = useState(false)
  const presentedCollapsible = delivered.length > COLLAPSED_PRESENTED_COUNT
  const shownPresented = presentedCollapsible && !presentedExpanded
    ? delivered.slice(0, COLLAPSED_PRESENTED_COUNT)
    : delivered
  useEffect(() => {
    if (delivered.length > 0 && host === null) presented.reloadHost()
  }, [delivered.length, host, presented])
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
          <div className={css.producedMeasure} aria-hidden="true">
            {paths.slice(0, limit).map((path, index) => renderChip(path, {
              key: path,
              ref: (node) => { chipProbes.current[index] = node },
            }))}
            <span ref={moreProbe} className={css.producedMore} />
          </div>
        </div>
      )}
      {delivered.length > 0 && (
        <div className={presentedCss.root}>
          {host === 'error' && (
            <div className={presentedCss.hostStatus}>
              <span>{t('presented.hostError')}</span>
              <Button size="sm" onClick={() => { presented.reloadHost() }}>{t('presented.retry')}</Button>
            </div>
          )}
          {host !== null && host !== 'error' && !host.available && (
            <span className={presentedCss.hostStatus}>{t('presented.unavailable')}</span>
          )}
          <div
            className={presentedCss.presented}
            data-presented-files-row
            data-single={delivered.length === 1 ? true : undefined}
          >
            {shownPresented.map(file => (
              <PresentedFileCard
                key={`${file.seq}:${file.index}`}
                file={file}
                cwd={presented.cwd}
                phase={openStates[presentedFileUrl(presented.sessionId, file.seq, file.index)]}
                host={host === 'error' ? null : host}
                onPreview={() => { openFile(file.path) }}
                onAction={(action) => { presented.open(file.seq, file.index, action) }}
                t={t}
              />
            ))}
          </div>
          {presentedCollapsible && (
            <button
              type="button"
              className={presentedCss.toggle}
              aria-expanded={presentedExpanded}
              aria-label={t(presentedExpanded ? 'presented.collapseAria' : 'presented.expandAria', { count: delivered.length })}
              onClick={() => { setPresentedExpanded(value => !value) }}
            >
              <span>{t(presentedExpanded ? 'presented.collapse' : 'presented.all', { count: delivered.length })}</span>
              {presentedExpanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            </button>
          )}
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
              current={feedback.current}
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
