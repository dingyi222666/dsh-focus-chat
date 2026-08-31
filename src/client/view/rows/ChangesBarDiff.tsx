/**
 * The Codex-style changes-bar diff viewer, in the Codex changes-bar visual
 * language (side-by-side changed-line pairs with per-line change bars):
 *
 *  - side-by-side (split) paired rows: every change is one row with a left
 *    panel (the old side: striped red change bar + old line number + content)
 *    and a right panel (the new side: solid green change bar + new line
 *    number + content), a hairline between the panels;
 *  - the `diff` package aligns the two sides line by line and marks the
 *    intra-line difference word by word (`diffWordsWithSpace`), with a
 *    fragmentation guard that drops the word marks when a line reads as a
 *    rewrite;
 *  - long runs of unchanged context collapse into expandable separators
 *    (up / down / both);
 *  - rows render windowed at a fixed line height, so a large diff never
 *    mounts all its rows;
 *  - the rows container stretches to the widest line (`ch` min-width), so
 *    every row's tinted band spans the whole column;
 *  - each file's header carries that file's own `+A -R` reading on the
 *    path's right (the focus tool-row tally), instead of a card footer.
 *
 * The source hunks are whole-file prior/new texts (the same DiffHunk the
 * official DiffBlock draws as an all-deletes-then-all-adds block).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import clsx from 'clsx'
import { diffLines, diffWordsWithSpace } from 'diff'
import type { DiffBlockLabels, DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChangesBarDiff.module.css'

/** Fixed row height (px): the windowing arithmetic and the CSS line-height share this value. */
export const DIFF_LINE_HEIGHT = 22

/** Rows rendered above and below the viewport so fast scrolling does not flash blank space. */
const OVERSCAN = 5

/** Unchanged context lines kept around each change before the rest collapses. */
const CONTEXT_LINES = 3

/** A collapsed context separator expands in chunks of this many lines. */
const EXPANSION_LINE_COUNT = 100

// ============================================
// Line model
// ============================================

type LineType = 'add' | 'delete' | 'context' | 'empty'

interface DiffLine {
  type: LineType
  content: string
  lineNo?: number
  /** Intra-line diff runs for a changed line; absent = no word marks. */
  wordDiffSegments?: WordDiffSegment[]
}

interface PairedLine {
  left: DiffLine
  right: DiffLine
}

/** One intra-line diff run; `diffType` marks an added/deleted run for its background tint. */
interface WordDiffSegment {
  text: string
  diffType?: 'add' | 'delete'
}

// ============================================
// Diff computation
// ============================================

/**
 * Pair the two sides line by line: equal runs become context pairs, an added
 * run pairs each new line against an empty left slot, and a removed run
 * preceded by an added run pairs the two sides positionally so their
 * intra-line differences can be marked. The `diff` package's `diffLines`
 * output drives the walk; line numbers are the sides' own 1-based numbers.
 */
export function computePairedLines(before: string, after: string): PairedLine[] {
  const changes = diffLines(before, after)
  const result: PairedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0
  let newIdx = 0
  let i = 0

  while (i < changes.length) {
    const change = changes[i]!
    const count = change.count || 0

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        const addCount = next.count || 0
        const maxCount = Math.max(count, addCount)

        for (let j = 0; j < maxCount; j++) {
          const oldLine = j < count ? beforeLines[oldIdx + j] : undefined
          const newLine = j < addCount ? afterLines[newIdx + j] : undefined

          let leftSegments: WordDiffSegment[] | undefined
          let rightSegments: WordDiffSegment[] | undefined

          if (oldLine !== undefined && newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) {
              leftSegments = wordDiff.left
              rightSegments = wordDiff.right
            }
          }

          result.push({
            left: oldLine !== undefined
              ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, ...(leftSegments !== undefined && { wordDiffSegments: leftSegments }) }
              : { type: 'empty', content: '' },
            right: newLine !== undefined
              ? { type: 'add', content: newLine, lineNo: newIdx + j + 1, ...(rightSegments !== undefined && { wordDiffSegments: rightSegments }) }
              : { type: 'empty', content: '' },
          })
        }

        oldIdx += count
        newIdx += addCount
        i += 2
        continue
      }

      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'delete', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'empty', content: '' },
        })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'empty', content: '' },
          right: { type: 'add', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'context', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'context', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      oldIdx += count
      newIdx += count
    }
    i++
  }

  return result
}

/**
 * The intra-line difference of one changed pair, aligned into left/right
 * segment lists (a shared run appears in both). `diff`'s `diffWordsWithSpace`
 * already merges adjacent same-direction runs, so the alignment is a straight
 * walk over its change stream.
 */
export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { left: WordDiffSegment[]; right: WordDiffSegment[]; changes: ReturnType<typeof diffWordsWithSpace> } {
  const changes = diffWordsWithSpace(oldLine, newLine)

  const left: WordDiffSegment[] = []
  const right: WordDiffSegment[] = []
  for (const change of changes) {
    if (change.removed) left.push({ text: change.value, diffType: 'delete' })
    else if (change.added) right.push({ text: change.value, diffType: 'add' })
    else {
      left.push({ text: change.value })
      right.push({ text: change.value })
    }
  }

  return { left, right, changes }
}

/**
 * Whether an intra-line diff is too fragmented to mark: fewer than 40% of the
 * characters are shared between the sides. Such a line reads as a rewrite, and
 * marking its fragments would paint the whole line; the tinted row background
 * already carries the change.
 */
export function isTooFragmented(changes: ReturnType<typeof diffWordsWithSpace>): boolean {
  let commonLength = 0
  let totalLength = 0
  for (const change of changes) {
    totalLength += change.value.length
    if (!change.added && !change.removed) commonLength += change.value.length
  }
  return totalLength > 10 && commonLength / totalLength < 0.4
}

// ============================================
// Context collapsing
// ============================================

type ExpandDirection = 'up' | 'down' | 'both'

interface ExpansionRegion {
  fromStart: number
  fromEnd: number
}

interface CollapsedRegion {
  collapsed: true
  count: number
  id: number
  isFirst: boolean
  isLast: boolean
  chunked: boolean
}

type PairedRow = PairedLine | CollapsedRegion

function isCollapsed(row: PairedRow): row is CollapsedRegion {
  return 'collapsed' in row
}

/**
 * Grow one collapsed region's expansion budget: expanding upward adds to
 * `fromStart`, downward to `fromEnd` (one {@link EXPANSION_LINE_COUNT} chunk
 * per click, or all of it for a single 'both' click on an unchunked region).
 */
export function expandRegion(prev: ReadonlyMap<number, ExpansionRegion>, id: number, direction: ExpandDirection): Map<number, ExpansionRegion> {
  const next = new Map(prev)
  const current = next.get(id) ?? { fromStart: 0, fromEnd: 0 }
  if (direction === 'up' || direction === 'both') current.fromStart += EXPANSION_LINE_COUNT
  if (direction === 'down' || direction === 'both') current.fromEnd += EXPANSION_LINE_COUNT
  next.set(id, current)
  return next
}

/**
 * Fold long runs of unchanged context into single separator rows, keeping
 * {@link CONTEXT_LINES} of context around each change. An expanded region
 * un-folds from its separator by the budget recorded in the expansion map.
 */
export function collapseContextPaired(lines: PairedLine[], expanded?: ReadonlyMap<number, ExpansionRegion>): PairedRow[] {
  if (lines.length === 0) return []

  const result: PairedRow[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    const isCtx = i < lines.length && lines[i]!.left.type === 'context' && lines[i]!.right.type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const region = expanded?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + region.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - region.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j]!)
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j]!)
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j]!)
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i]!)
    }
  }

  return result
}

// ============================================
// Geometry helpers
// ============================================

/**
 * The widest rendered line's character count across a display-row list
 * (collapsed separators carry no content). The rows container's `min-width`
 * uses it in `ch` units so every row's background spans the whole column —
 * short changed lines keep their tint to the same edge as the longest line.
 */
export function displayMaxChars(rows: readonly PairedRow[]): number {
  let max = 0
  for (const row of rows) {
    if (isCollapsed(row)) continue
    if (row.left.content.length > max) max = row.left.content.length
    if (row.right.content.length > max) max = row.right.content.length
  }
  return max
}

/** The line-number gutter width for the largest line number, with a readable floor. */
export function lineNumberColumnWidth(maxLineNo: number): number {
  const digits = String(Math.max(1, maxLineNo)).length
  return Math.max(44, digits * 8 + 28)
}

// ============================================
// Windowed scrolling
// ============================================

/**
 * Fixed-row-height windowing: render only the rows the viewport can show
 * (plus overscan), positioned inside a spacer of the full row count's height.
 */
function useWindowedRows(rowCount: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => setViewportHeight(container.clientHeight)
    update()
    // jsdom implements no ResizeObserver (the repo-wide guard pattern).
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const startIndex = Math.max(0, Math.floor(scrollTop / DIFF_LINE_HEIGHT) - OVERSCAN)
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / DIFF_LINE_HEIGHT))
  const endIndex = Math.min(rowCount, startIndex + visibleCount + OVERSCAN * 2)
  const offsetY = startIndex * DIFF_LINE_HEIGHT

  return { containerRef, startIndex, endIndex, offsetY, onScroll }
}

// ============================================
// Row rendering
// ============================================

/** The right-aligned line number cell; `undefined` draws an empty slot. */
function LineNumberCell({ lineNo, width, tone }: { lineNo: number | undefined; width: number; tone: 'changed' | 'context' }) {
  return (
    <div className={clsx(css.lineNumber, tone === 'changed' ? css.lineNumberChanged : css.lineNumberContext)} style={{ width }}>
      {lineNo}
    </div>
  )
}

/** The 4px change bar: solid success for additions, striped error for deletions. */
function ChangeBar({ type, rowTop }: { type: LineType; rowTop: number }) {
  if (type === 'add') return <div className={css.barAdd} />
  if (type === 'delete') return <div className={css.barDelete} style={{ backgroundPositionY: `${-rowTop}px` }} />
  return <div className={css.barNone} />
}

/** One rendered line's content: word marks when present, else the plain text. */
function LineContent({ line }: { line: DiffLine }) {
  if (line.wordDiffSegments !== undefined) {
    return (
      <>
        {line.wordDiffSegments.map((segment, index) => (
          segment.diffType !== undefined
            ? <span key={index} className={segment.diffType === 'delete' ? css.wordDelete : css.wordAdd}>{segment.text}</span>
            : <span key={index}>{segment.text}</span>
        ))}
      </>
    )
  }
  return <>{line.content}</>
}

/** The shared viewport chrome: vertical window, horizontal scroll, cap. */
function Viewport({ rows, maxLines, children }: {
  rows: number
  maxLines: number | undefined
  children: (
    start: number,
    end: number,
    registerContent: (el: HTMLDivElement | null) => void,
    onContentScroll: (event: UIEvent<HTMLDivElement>) => void,
  ) => ReactNode
}) {
  const { containerRef, startIndex, endIndex, offsetY, onScroll } = useWindowedRows(rows)
  // The content column(s) the sticky horizontal bar mirrors. Each column owns
  // its own overflow-x; the bar at the viewport's bottom edge stays visible
  // while a tall diff's column-native scrollbar scrolls out of view.
  const contents = useRef(new Set<HTMLDivElement>())
  const barRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)
  const [contentWidth, setContentWidth] = useState(0)
  const [clientWidth, setClientWidth] = useState(0)

  const measure = useCallback(() => {
    let maxScroll = 0
    let client = 0
    for (const column of contents.current) {
      if (column.scrollWidth > maxScroll) maxScroll = column.scrollWidth
      client = column.clientWidth
    }
    setContentWidth(maxScroll)
    setClientWidth(client)
  }, [])

  const registerContent = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return
    contents.current.add(el)
    measure()
  }, [measure])

  // Re-measure when the windowed rows change and on container resize; jsdom
  // has no ResizeObserver (the repo-wide guard pattern).
  useEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const column of contents.current) observer.observe(column)
    return () => observer.disconnect()
  }, [startIndex, endIndex, measure])

  const onContentScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return
    syncing.current = true
    const left = event.currentTarget.scrollLeft
    for (const column of contents.current) {
      if (column !== event.currentTarget) column.scrollLeft = left
    }
    if (barRef.current !== null) barRef.current.scrollLeft = left
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  const onBarScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return
    syncing.current = true
    const left = event.currentTarget.scrollLeft
    for (const column of contents.current) column.scrollLeft = left
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  return (
    <div
      ref={containerRef}
      className={css.viewport}
      onScroll={onScroll}
      style={maxLines !== undefined
        ? { maxHeight: maxLines * DIFF_LINE_HEIGHT }
        : { overflow: 'visible' }}
    >
      <div className={css.spacer} style={{ height: rows * DIFF_LINE_HEIGHT }}>
        <div className={css.window} style={{ transform: `translateY(${offsetY}px)` }}>
          {children(startIndex, endIndex, registerContent, onContentScroll)}
        </div>
      </div>
      {contentWidth > clientWidth && (
        <div ref={barRef} className={css.hbar} onScroll={onBarScroll}>
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
    </div>
  )
}

// ============================================
// Split body
// ============================================

/** The expand directions a separator offers: both when unchunked, up/down when chunked. */
export function separatorDirections({ isFirst, isLast, chunked }: { isFirst?: boolean; isLast?: boolean; chunked?: boolean }): ExpandDirection[] {
  if (!chunked) return [!isFirst && !isLast ? 'both' : isFirst ? 'down' : 'up']
  const directions: ExpandDirection[] = []
  if (!isFirst) directions.push('up')
  if (!isLast) directions.push('down')
  return directions
}

/** The chevron glyph for one expand direction (up flips the down glyph). */
function ExpandIcon({ direction }: { direction: ExpandDirection }) {
  if (direction === 'both') {
    return (
      <svg aria-hidden="true" className={css.expandIcon} viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" className={clsx(css.expandIcon, direction === 'up' && css.expandIconUp)} viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  )
}

/** The expand buttons a separator shows in the gutter column. */
function CollapsedExpandButton({ directions, onExpand, width, labels }: {
  directions: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  width?: number
  labels: ChangesBarExpandLabels
}) {
  const buttonWidth = width !== undefined && directions.length > 0 ? width / directions.length : undefined
  return (
    <div className={css.separatorButtonGroup} style={width !== undefined ? { width, flexBasis: width } : undefined}>
      {directions.map(direction => (
        <button
          key={direction}
          type="button"
          className={css.separatorButton}
          style={buttonWidth !== undefined ? { width: buttonWidth, minWidth: 0, flexBasis: buttonWidth } : undefined}
          title={direction === 'up' ? labels.expandUp : direction === 'down' ? labels.expandDown : labels.expandBoth}
          onClick={() => onExpand?.(direction)}
        >
          <ExpandIcon direction={direction} />
        </button>
      ))}
    </div>
  )
}

/** The separator's label row, spanning from the gutter over the content column. */
function CollapsedLabel({ count, labels, onExpand }: { count: number; labels: ChangesBarExpandLabels; onExpand?: (direction: ExpandDirection) => void }) {
  return (
    <div className={css.separatorLabel}>
      <button
        type="button"
        className={css.separatorTextButton}
        onClick={() => onExpand?.('both')}
      >
        {labels.unchangedLines(count)}
      </button>
    </div>
  )
}

/** Localized chrome for the context-collapse separators. */
export interface ChangesBarExpandLabels {
  /** Collapsed-separator label for a run of unchanged lines. */
  unchangedLines: (count: number) => string
  /** Title of the separator's upward-expansion button. */
  expandUp: string
  /** Title of the separator's downward-expansion button. */
  expandDown: string
  /** Title of the separator's expand-both-ways button. */
  expandBoth: string
}

/**
 * Render one file's change body: pairs every line, collapses long context
 * runs, and windows the display rows.
 */
function DiffBody({ before, after, maxLines, labels }: {
  before: string
  after: string
  maxLines: number | undefined
  labels: ChangesBarExpandLabels
}) {
  const pairs = useMemo(() => computePairedLines(before, after), [before, after])
  if (pairs.length === 0) return null

  return (
    <SplitDiffBody
      pairs={pairs}
      maxLines={maxLines}
      labels={labels}
    />
  )
}

/**
 * Side-by-side body: each row is a pair drawn in two panels — left gutter
 * (change bar + old line number) and left content over the removed/context
 * text, then the same for the added side. A collapsed separator renders its
 * buttons in the left gutter and overlays its label across both panels.
 */
function SplitDiffBody({ pairs, maxLines, labels }: {
  pairs: PairedLine[]
  maxLines: number | undefined
  labels: ChangesBarExpandLabels
}) {
  const [expanded, setExpanded] = useState<Map<number, ExpansionRegion>>(new Map())
  const displayRows = useMemo(() => collapseContextPaired(pairs, expanded), [pairs, expanded])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpanded(prev => expandRegion(prev, id, direction))
  }, [])
  // The widest rendered line in `ch` units: the rows container stretches to it
  // so every row's background spans the whole column.
  const maxChars = useMemo(() => displayMaxChars(displayRows), [displayRows])

  // The widest line number across both sides; a reduce (not a spread) so a
  // very large diff cannot overflow the argument stack.
  const lineNumberWidth = useMemo(() => lineNumberColumnWidth(
    pairs.reduce((max, pair) => Math.max(max, pair.left.lineNo ?? 0, pair.right.lineNo ?? 0), 0),
  ), [pairs])
  const gutterWidth = lineNumberWidth + 4

  return (
    <div className={css.body}>
      <Viewport rows={displayRows.length} maxLines={maxLines}>
        {(start, end, registerContent, onContentScroll) => {
          const leftGutter: ReactNode[] = []
          const leftContent: ReactNode[] = []
          const rightGutter: ReactNode[] = []
          const rightContent: ReactNode[] = []

          for (let i = start; i < end; i++) {
            const row = displayRows[i]!
            const rowTop = i * DIFF_LINE_HEIGHT

            if (isCollapsed(row)) {
              const directions = separatorDirections(row)
              leftGutter.push(
                <div key={i} className={clsx(css.separatorSurface, css.separatorRelative)} style={{ height: DIFF_LINE_HEIGHT }}>
                  <CollapsedExpandButton directions={directions} onExpand={direction => handleExpand(row.id, direction)} width={lineNumberWidth} labels={labels} />
                  <div className={css.separatorLabelOverlay} style={{ left: lineNumberWidth }}>
                    <CollapsedLabel count={row.count} labels={labels} onExpand={direction => handleExpand(row.id, direction)} />
                  </div>
                </div>,
              )
              leftContent.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              rightGutter.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              rightContent.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              continue
            }

            const pair = row
            const left = pair.left
            const right = pair.right
            leftGutter.push(
              <div key={i} className={clsx(css.gutterRow, left.type === 'delete' ? css.rowDelete : left.type === 'empty' ? css.rowEmpty : css.rowContext)} style={left.type === 'empty' ? { height: DIFF_LINE_HEIGHT, backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <ChangeBar type={left.type} rowTop={rowTop} />
                <LineNumberCell lineNo={left.lineNo} width={lineNumberWidth} tone={left.type === 'delete' ? 'changed' : 'context'} />
              </div>,
            )
            leftContent.push(
              <div key={i} className={clsx(css.contentRow, left.type === 'empty' ? css.rowEmpty : left.type === 'delete' ? css.rowDelete : css.rowContext)} style={left.type === 'empty' ? { backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <LineContent line={left} />
              </div>,
            )
            rightGutter.push(
              <div key={i} className={clsx(css.gutterRow, right.type === 'add' ? css.rowAdd : right.type === 'empty' ? css.rowEmpty : css.rowContext)} style={right.type === 'empty' ? { height: DIFF_LINE_HEIGHT, backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <ChangeBar type={right.type} rowTop={rowTop} />
                <LineNumberCell lineNo={right.lineNo} width={lineNumberWidth} tone={right.type === 'add' ? 'changed' : 'context'} />
              </div>,
            )
            rightContent.push(
              <div key={i} className={clsx(css.contentRow, right.type === 'empty' ? css.rowEmpty : right.type === 'add' ? css.rowAdd : css.rowContext)} style={right.type === 'empty' ? { backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <LineContent line={right} />
              </div>,
            )
          }

          return (
            <div className={css.splitRow}>
              <div className={css.panel}>
                <div className={css.gutter} style={{ width: gutterWidth }}>{leftGutter}</div>
                <div className={css.content} ref={registerContent} onScroll={onContentScroll}>
                  <div className={css.rows} style={{ minWidth: `max(100%, ${maxChars}ch)` }}>{leftContent}</div>
                </div>
              </div>
              <div className={css.panel}>
                <div className={css.gutter} style={{ width: gutterWidth }}>{rightGutter}</div>
                <div className={css.content} ref={registerContent} onScroll={onContentScroll}>
                  <div className={css.rows} style={{ minWidth: `max(100%, ${maxChars}ch)` }}>{rightContent}</div>
                </div>
              </div>
            </div>
          )
        }}
      </Viewport>
    </div>
  )
}

/** Split a side's text into content lines (the DiffBlock terminator rule). */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/** The diff text a reader copies: each file's path header followed by its
 *  `- `/`+ ` prefixed lines, exactly what the card shows. */
function copyText(diffs: DiffHunk[]): string {
  const parts: string[] = []
  for (const hunk of diffs) {
    parts.push(hunk.path)
    for (const line of contentLines(hunk.oldText ?? '')) parts.push(`- ${line}`)
    for (const line of contentLines(hunk.newText)) parts.push(`+ ${line}`)
  }
  return parts.join('\n')
}

/** The +/- totals across all hunks, for each file header's own reading. */
function hunkStats(hunk: DiffHunk): { added: number; removed: number } {
  return {
    removed: contentLines(hunk.oldText ?? '').length,
    added: contentLines(hunk.newText).length,
  }
}

// ============================================
// Main component
// ============================================

/**
 * Render a file mutation as the Codex-style changes-bar diff surface: split
 * paired rows with change bars, line numbers, word marks, context collapse,
 * and windowed rendering. Each file header carries that file's own +A -R
 * reading; there is no card footer.
 * @param props - hunks, localized chrome, height cap, and caller position.
 * @returns the changes-bar diff element.
 */
export function ChangesBarDiff({ diffs, labels, expandLabels, maxLines = 16, className }: {
  diffs: DiffHunk[]
  labels: DiffBlockLabels
  /** Localized chrome for the context-collapse separators. */
  expandLabels: ChangesBarExpandLabels
  /** Height cap in body rows before the viewport scrolls internally (DiffBlock parity). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}) {
  const { copied, onCopy } = useCopyFeedback(useMemo(() => copyText(diffs), [diffs]))

  if (diffs.length === 0) return null

  return (
    <div className={clsx(css.block, className)} data-diff="" data-changes-bar-diff="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      {diffs.map((hunk, index) => {
        const stats = hunkStats(hunk)
        return (
          <section key={index} className={css.file}>
            <header className={css.fileHeader} data-changes-bar-path>
              <span className={css.pathText}>{hunk.path}</span>
              {(stats.added > 0 || stats.removed > 0) && (
                <span className={css.pathStat} data-changes-bar-stat>
                  <span className={css.pathAdd}>+{stats.added}</span>
                  <span className={css.pathRemove}>-{stats.removed}</span>
                </span>
              )}
            </header>
            <DiffBody
              before={hunk.oldText ?? ''}
              after={hunk.newText}
              maxLines={maxLines}
              labels={expandLabels}
            />
          </section>
        )
      })}
    </div>
  )
}

/** Copy text with one-second success feedback on {@link writeClipboard}. */
function useCopyFeedback(text: string): { copied: boolean; onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, text])
  return { copied, onCopy }
}
