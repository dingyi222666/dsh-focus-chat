/**
 * The Codex-style changes-bar diff viewer (the PiUI look the reference
 * dsh-diff-viewer plugin implements): a unified single column with a left
 * change bar per line — solid green for additions, striped red for
 * deletions — and the line's tinted background band extending to the widest
 * line. Paired delete/insert rows highlight their changed words, so the eye
 * lands on the delta instead of the whole line. Each file's header carries
 * that file's own `+A -R` reading on the path's right (the row-level stat,
 * matching the tool row's tally), instead of a card footer.
 *
 * The hunks are whole-file prior/new texts (the same DiffHunk the official
 * DiffBlock draws as an all-deletes-then-all-adds block), so this viewer
 * first aligns the two sides line by line and then paints each row: context
 * rows get no bar, deleted rows a striped red bar, added rows a solid green
 * bar.
 */

import { useMemo, useState } from 'react'
import type { DiffBlockLabels, DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChangesBarDiff.module.css'

/** One aligned body row: a context line, a deletion, or an insertion. */
type Row =
  | { kind: 'ctx'; old: string; new: string }
  | { kind: 'del'; old: string; new?: string }
  | { kind: 'add'; old?: string; new: string }

/** Split a side's text into content lines (the DiffBlock terminator rule). */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Align old and new lines into context / deletion / insertion rows. Equal
 * runs collapse to context; a changed region splits into a deletion and an
 * insertion row that share each other as their partner, so the word-level
 * delta of each side is computed against the line it replaced. Pure
 * additions and deletions carry no partner (the whole line is the delta).
 */
function alignLines(oldText: string | null, newText: string): Row[] {
  const oldLines = oldText === null ? [] : contentLines(oldText)
  const newLines = contentLines(newText)
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      rows.push({ kind: 'ctx', old: oldLines[i], new: newLines[j] })
      i++
      j++
    } else if (i < oldLines.length && j < newLines.length) {
      // A replacement: the old line and the new line pair up.
      rows.push({ kind: 'del', old: oldLines[i], new: newLines[j] })
      rows.push({ kind: 'add', old: oldLines[i], new: newLines[j] })
      i++
      j++
    } else if (i < oldLines.length) {
      rows.push({ kind: 'del', old: oldLines[i] })
      i++
    } else {
      rows.push({ kind: 'add', new: newLines[j] })
      j++
    }
  }
  return rows
}

/** The changed words of one line, for the word-level highlight: the longest
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

/** One flattened body row: a file header (with its own +/- reading) or a line. */
type FlatRow =
  | { kind: 'path'; text: string; added: number; removed: number }
  | { kind: 'ctx' | 'del' | 'add'; text: string; oldText?: string; newText?: string }

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

  // Per-file aligned rows, plus each file's own +/- totals (context rows are
  // not changes, so the header's reading agrees with the bars the body
  // draws).
  const files = useMemo(() => diffs.map(diff => {
    const rows = alignLines(diff.oldText, diff.newText)
    let added = 0
    let removed = 0
    for (const row of rows) {
      if (row.kind === 'add') added += 1
      else if (row.kind === 'del') removed += 1
    }
    return { path: diff.path, rows, added, removed }
  }), [diffs])

  const flatRows = useMemo(() => {
    const rows: FlatRow[] = []
    for (const file of files) {
      rows.push({ kind: 'path', text: file.path, added: file.added, removed: file.removed })
      for (const row of file.rows) {
        if (row.kind === 'ctx') rows.push({ kind: 'ctx', text: row.old })
        else if (row.kind === 'del') rows.push({ kind: 'del', text: row.old, oldText: row.old, newText: row.new })
        else rows.push({ kind: 'add', text: row.new, oldText: row.old, newText: row.new })
      }
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
      switch (row.kind) {
        case 'path': return row.text
        case 'del': return `- ${row.text}`
        case 'add': return `+ ${row.text}`
        default: return row.text
      }
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

/** One body line: a file header (path + its +/- reading) or a change line. */
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
  if (row.kind === 'del') {
    const { head, delta, tail } = splitDelta(row.text, row.newText)
    return (
      <div className={css.del} data-changes-bar-line>
        <span className={css.bar} aria-hidden />
        <span className={css.sign}>-</span>
        <span className={css.lineText}>
          {head}
          {delta !== '' && <span className={css.delta}>{delta}</span>}
          {tail}
        </span>
      </div>
    )
  }
  if (row.kind === 'add') {
    const { head, delta, tail } = splitDelta(row.text, row.oldText)
    return (
      <div className={css.add} data-changes-bar-line>
        <span className={css.bar} aria-hidden />
        <span className={css.sign}>+</span>
        <span className={css.lineText}>
          {head}
          {delta !== '' && <span className={css.delta}>{delta}</span>}
          {tail}
        </span>
      </div>
    )
  }
  return (
    <div className={css.ctx} data-changes-bar-line>
      <span className={css.bar} aria-hidden />
      <span className={css.lineText}>{row.text}</span>
    </div>
  )
}
