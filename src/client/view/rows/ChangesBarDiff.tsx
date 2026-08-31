/**
 * The Codex-style changes-bar diff viewer, in the PiUI look the reference
 * dsh-diff-viewer plugin implements: a side-by-side (split) pair of panels
 * per change — the left panel carries the old side (striped red change bar
 * + old line number), the right panel the new side (solid green change bar
 * + new line number), with a hairline between them. Context rows show the
 * same line in both panels; the empty side of a pure add/delete pair wears a
 * diagonal stripe wash. Changed pairs mark their intra-line delta (shared
 * prefix/suffix stay plain, the middle carries the word mark) on both sides.
 * Each file's header carries that file's own `+A -R` reading on the path's
 * right (the row-level stat, matching the tool row's tally), instead of a
 * card footer.
 *
 * The hunks are whole-file prior/new texts (the same DiffHunk the official
 * DiffBlock draws as an all-deletes-then-all-adds block), so this viewer
 * first aligns the two sides line by line and then paints one pair per row.
 */

import { useMemo, useState } from 'react'
import type { DiffBlockLabels, DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChangesBarDiff.module.css'

/** One side's cell type: the pair's left (old) or right (new) role. */
type CellType = 'ctx' | 'del' | 'add' | 'empty'

/** One panel cell: the side's role, text, and its own 1-based line number. */
interface Cell {
  type: CellType
  text: string
  lineNo: number | undefined
}

/** One rendered row: the old side (left) and the new side (right) in pair. */
interface Pair {
  left: Cell
  right: Cell
}

/** Split a side's text into content lines (the DiffBlock terminator rule). */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Align old and new lines into one pair per row. Equal lines become a
 * context pair; a changed region pairs its old line (left) with the new line
 * (right); a pure deletion pairs the removed line against an empty right
 * cell and a pure addition an empty left cell against the added line. Line
 * numbers are each side's own 1-based positions.
 */
function alignPairs(oldText: string | null, newText: string): Pair[] {
  const oldLines = oldText === null ? [] : contentLines(oldText)
  const newLines = contentLines(newText)
  const pairs: Pair[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      pairs.push({
        left: { type: 'ctx', text: oldLines[i], lineNo: i + 1 },
        right: { type: 'ctx', text: newLines[j], lineNo: j + 1 },
      })
      i++
      j++
    } else if (i < oldLines.length && j < newLines.length) {
      // A replacement: the old line and the new line pair up.
      pairs.push({
        left: { type: 'del', text: oldLines[i], lineNo: i + 1 },
        right: { type: 'add', text: newLines[j], lineNo: j + 1 },
      })
      i++
      j++
    } else if (i < oldLines.length) {
      pairs.push({
        left: { type: 'del', text: oldLines[i], lineNo: i + 1 },
        right: { type: 'empty', text: '', lineNo: undefined },
      })
      i++
    } else {
      pairs.push({
        left: { type: 'empty', text: '', lineNo: undefined },
        right: { type: 'add', text: newLines[j], lineNo: j + 1 },
      })
      j++
    }
  }
  return pairs
}

/** The changed words of one side, for the word-level highlight: the longest
 *  common prefix and suffix stay plain, the middle (if any) is the delta. */
function splitDelta(text: string, partner: string | undefined): { head: string; delta: string; tail: string } {
  if (partner === undefined) return { head: '', delta: text, tail: '' }
  let head = 0
  while (head < text.length && head < partner.length && text[head] === partner[head]) head++
  let tail = 0
  while (
    tail < text.length - head && tail < partner.length - head
    && text[text.length - 1 - tail] === partner[partner.length - 1 - tail]
  ) tail++
  return {
    head: text.slice(0, head),
    delta: text.slice(head, text.length - tail),
    tail: text.slice(text.length - tail),
  }
}

/** One flattened body row: a file header (with its own +/- reading) or a pair. */
type FlatRow =
  | { kind: 'path'; text: string; added: number; removed: number }
  | { kind: 'pair'; pair: Pair }

/**
 * Render a file mutation as the Codex-style changes-bar diff surface.
 * @param props - hunks, localized chrome, height cap, and caller position.
 * @returns the changes-bar diff element.
 */
export function ChangesBarDiff({ diffs, labels, maxLines = 16, className }: {
  diffs: DiffHunk[]
  labels: DiffBlockLabels
  /** Height cap in body rows before the middle collapses (DiffBlock parity). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  // Per-file aligned pairs, plus each file's own +/- totals (context rows are
  // not changes, so the header's reading agrees with the bars the body
  // draws).
  const files = useMemo(() => diffs.map(diff => {
    const pairs = alignPairs(diff.oldText, diff.newText)
    let added = 0
    let removed = 0
    for (const pair of pairs) {
      if (pair.left.type === 'del') removed += 1
      if (pair.right.type === 'add') added += 1
    }
    return { path: diff.path, pairs, added, removed }
  }), [diffs])

  const flatRows = useMemo(() => {
    const rows: FlatRow[] = []
    for (const file of files) {
      rows.push({ kind: 'path', text: file.path, added: file.added, removed: file.removed })
      for (const pair of file.pairs) rows.push({ kind: 'pair', pair })
    }
    return rows
  }, [files])

  const hidden = flatRows.length - maxLines
  const capped = hidden > 0 && !expanded
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? flatRows.slice(0, headLines) : flatRows
  const tail = capped ? flatRows.slice(flatRows.length - tailLines) : []

  const onCopy = (): void => {
    if (copied) return
    void writeClipboard(flatRows.map(row => {
      if (row.kind === 'path') return row.text
      const { left, right } = row.pair
      const parts: string[] = []
      if (left.type === 'ctx') parts.push(left.text)
      else if (left.type === 'del') parts.push(`- ${left.text}`)
      if (right.type === 'add') parts.push(`+ ${right.text}`)
      return parts.join('\n')
    }).join('\n')).then(ok => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }

  if (flatRows.length === 0) return null

  return (
    <div className={`${css.block}${className !== undefined ? ` ${className}` : ''}`} data-changes-bar-diff="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      <div className={css.body}>
        {head.map((row, index) => <RowLine key={index} row={row} />)}
        {hidden > 0 && (
          <button
            type="button"
            className={css.expand}
            aria-expanded={expanded}
            aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
            onClick={() => { setExpanded(value => !value) }}
          >
            {expanded ? labels.collapse : labels.expand(hidden)}
          </button>
        )}
        {tail.map((row, index) => <RowLine key={`t${index}`} row={row} />)}
      </div>
    </div>
  )
}

/** One body row: a file header (path + its +/- reading) or a change pair. */
function RowLine({ row }: { row: FlatRow }) {
  if (row.kind === 'path') {
    return (
      <div className={css.path} data-changes-bar-path>
        <span className={css.pathText}>{row.text}</span>
        {(row.added > 0 || row.removed > 0) && (
          <span className={css.pathStat} data-changes-bar-stat>
            <span className={css.pathAdd}>+{row.added}</span>
            <span className={css.pathRemove}>-{row.removed}</span>
          </span>
        )}
      </div>
    )
  }
  const { left, right } = row.pair
  // A changed pair computes each side's word delta against its partner (the
  // shared prefix/suffix stay plain on both panels).
  const leftDelta = left.type === 'del' ? splitDelta(left.text, right.type === 'add' ? right.text : undefined) : undefined
  const rightDelta = right.type === 'add' ? splitDelta(right.text, left.type === 'del' ? left.text : undefined) : undefined
  return (
    <div className={css.pairRow} data-changes-bar-line>
      <Panel cell={left} delta={leftDelta} side="left" />
      <Panel cell={right} delta={rightDelta} side="right" />
    </div>
  )
}

/** One panel of a pair: change bar + line number + content (with word mark). */
function Panel({ cell, delta, side }: {
  cell: Cell
  delta: { head: string; delta: string; tail: string } | undefined
  side: 'left' | 'right'
}) {
  return (
    <div className={css.panel} data-changes-bar-panel={side}>
      <div className={css.gutter}>
        <span className={css.bar} data-bar={cell.type || undefined} aria-hidden />
        <span className={css.lineNo} data-changes-bar-line-no={cell.lineNo ?? undefined}>{cell.lineNo ?? ''}</span>
      </div>
      <div className={css.content} data-cell={cell.type || undefined}>
        {cell.type === 'empty' ? (
          <span aria-hidden />
        ) : delta === undefined ? (
          <span className={css.lineText}>{cell.text}</span>
        ) : (
          <span className={css.lineText}>
            {delta.head}
            {delta.delta !== '' && <span className={css.delta}>{delta.delta}</span>}
            {delta.tail}
          </span>
        )}
      </div>
    </div>
  )
}
