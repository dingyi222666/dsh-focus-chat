/**
 * FocusView: the condensed conversation surface (Claude Code-style focus
 * mode). One row per user/assistant/command message; every run of Tool calls
 * folds into a single expandable step-summary line ("思考了 36 秒，运行了 2
 * 个命令，探索了 17 个文件，18 个目录"), whose expansion reveals one row
 * per call — each expandable to the full card rendering the chat tool rows
 * draw, with the recursive sub-call tree nested underneath. The Think rows
 * mirror the chat reasoning row: one line by default, tail-following while
 * streaming; the reasoning of an assistant step directly followed by a run
 * is absorbed into the group and folds with it. Everything renders from the
 * session chat snapshot through the standard kit — no chat renderer reuse,
 * no state outside this view.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CodeBlock, DiffBlock, DisclosureRow, IconApiOutline14, IconBranchOutline16, IconBrowseOutline16, IconCheckOutline16,
  IconChevronDownOutline14, IconChevronRightOutline14, IconCodeOutline16, IconCopyOutline16,
  IconEditOutline16, IconSearchOutline16, IconSparkle16, IconThinkOutline14, JsonBlock,
  MarkdownText, MessageText, ReadBlock, SearchBlock, StateDot, TerminalBlock, Tooltip,
  WebBlock, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions, TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationTimelineSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildFocusFlow, flattenText, formatSeconds,
  type FocusCard, type FocusFlowItem, type FocusToolGroup, type FocusToolRow,
} from './focus-model.ts'
import css from './FocusView.module.css'

type FocusTranslate = TranslateNS<'focus'>

/** One reflow-resistant scroll position (the chat view's saved shape). */
export interface FocusScrollPosition {
  /** Stable flow-item identity. */
  anchorKey: string
  /** Anchor row top relative to the scrollport. */
  anchorTop: number
  /** Raw scrollport offset at capture. */
  scrollTop: number
}

/** Owner currency of a closing assistant (the chat turn-tail owner shape). */
export interface FocusTurnTailOwner {
  /** Engine-owned closing turn boundary. */
  turn: TurnLocation
  /** The closing assistant's seq. */
  seq: number
  /** Open a filesystem path through the Host. */
  openFile: (path: string) => void
}

/** Injected business face of the focus view entry. */
export interface FocusViewInjected {
  /** Load one older page of history into the session window (chat-view semantics). */
  loadOlder: () => void
  /** Open a workspace path through the Host (tool-row semantics). */
  openFile: (path: string) => void
  /** Fork the session at one message seq (turn-tail branch semantics). */
  forkAt: (seq: number) => void
  /** Prose file-mention vocabulary for a closing assistant (optional service). */
  fileMentions: (owner: FocusTurnTailOwner) => MarkdownFileMentions | undefined
  /** Per-session scroll-position ledger (the chat view's persistence). */
  scroll: {
    save: (position: FocusScrollPosition | null) => void
    read: () => FocusScrollPosition | null
  }
}

/** Full props of the focus view entry: the conversation view kit, the injected face, and the focus locale seat. */
export type FocusViewProps = ConvViewProps & FocusViewInjected & { t: FocusTranslate }

/** First line of a multi-line string; the text itself when single-line. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Latest non-empty line of a streaming text (the running tail preview). */
function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/** Zero-padded two-digit number (the chat clock's rhythm). */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Trailing path segment, the part that identifies a produced file at a glance. */
function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Decode-throughput figure: whole tokens from ten up, one decimal below. */
function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** Local calendar-day epoch (ms at local midnight) for an instant. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Delay until the next local midnight after `ms` (at least 1ms). */
function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/** The current local calendar-day epoch, re-resolved at each midnight. */
function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        setDay(startOfLocalDay(Date.now()))
        schedule()
      }, msUntilNextLocalMidnight(Date.now()))
    }
    schedule()
    return () => { clearTimeout(timer) }
  }, [])
  return day
}

/**
 * Compact local timestamp for message chrome (the chat clock): same local
 * calendar day → `HH:mm`; earlier this year → the `clock.md` template;
 * other years → `clock.ymd`.
 * @param time - Unix epoch ms from the source session event.
 * @param t - focus locale seat supplying the date templates.
 * @param now - reference instant for the day/year cut.
 * @returns the date-aware clock string.
 */
function formatMessageClock(time: number, t: FocusTranslate, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (
    d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate()
  ) return clock
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}

/** Concatenated text blocks of a message (the chat bubble's join). */
function messageText(content: readonly { type?: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('')
}

/**
 * Display projection of reference forms in a user bubble: `/name` / `@name`
 * word-boundary tokens decorate as chips, everything else stays plain text
 * (the chat bubble's projection — sent tokens were validated at compose time,
 * so shape alone decorates).
 */
function projectUserText(text: string): ReactNode {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const label = m[2] ?? ''
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    parts.push(
      <span key={tokenStart} className={css.refChip} data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}>
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/**
 * Frame-throttled scheduling for non-essential visual alignment (the chat
 * reasoning row's rhythm): coalesce updates over a frame interval and apply
 * the latest one.
 * @param update - DOM alignment to run after the throttle interval.
 * @param intervalFrames - frames to wait before applying the latest alignment.
 * @returns a stable function that schedules the latest update.
 */
function useThrottledVisualUpdate(
  update: () => void,
  intervalFrames = 3,
): () => void {
  const updateRef = useRef(update)
  updateRef.current = update
  const pendingFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => () => {
    if (pendingFrameRef.current === null) return
    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  return useCallback(() => {
    if (pendingFrameRef.current !== null) return
    let remainingFrames = intervalFrames
    const advance = (): void => {
      remainingFrames -= 1
      if (remainingFrames > 0) {
        pendingFrameRef.current = requestAnimationFrame(advance)
        return
      }
      pendingFrameRef.current = null
      updateRef.current()
    }
    pendingFrameRef.current = requestAnimationFrame(advance)
  }, [intervalFrames])
}

/** JsonBlock truncation footer bound to the focus locale (one shared lambda). */
function jsonTruncated(t: FocusTranslate): (total: number) => string {
  return total => t('json.truncated', { total })
}

/** Card line caps the chat rows apply (design rhythm). */
const CHAT_DIFF_MAX_LINES = 8
const CHAT_READ_MAX_LINES = 8
const CHAT_SEARCH_MAX_LINES = 8

/** Terminal-card labels bound to the focus locale (the chat label seam). */
function terminalLabels(t: FocusTranslate): TerminalBlockLabels {
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('copy'),
    copied: t('copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('terminal.collapse'),
    expandAria: hidden => t('terminal.expandAria', { n: hidden }),
    expand: hidden => t('terminal.expand', { n: hidden }),
  }
}

/** Tool-family leading icons, mirroring the chat GenericToolCard table (glyphs at 14). */
const VARIANT_ICONS: Record<'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others', ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Tool name → leading-icon family (mirrors the chat row classification). */
const TOOL_VARIANTS: Readonly<Record<string, keyof typeof VARIANT_ICONS>> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
  cordis_mount: 'code',
}

/** One call's leading glyph: the family icon, or the state dot for failures. */
function leadingFor(row: FocusToolRow): ReactNode {
  if (row.state === 'error') return <StateDot state="error" />
  if (row.state === 'stopped') return <StateDot state="warning" />
  const variant = TOOL_VARIANTS[row.name] ?? 'others'
  return <span data-tool-icon={variant}>{VARIANT_ICONS[variant]}</span>
}

/**
 * One Think disclosure, mirroring the chat reasoning row: one line by
 * default, previewing the streaming tail while running (end-following
 * scroll), the first line once settled; the body expands on click.
 */
const ThinkRow = memo(function ThinkRow({ text, running, title, t }: {
  text: string
  /** Whether the reasoning is still the streaming tail. */
  running: boolean
  /** Row title: the plain Think label, or the duration for a standalone row. */
  title: string
  t: FocusTranslate
}) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])
  return (
    <div className={css.thinkWrap} data-state={running ? 'running' : 'ok'}>
      {running && <span className={css.visuallyHidden}>{t('tool.running')}</span>}
      <DisclosureRow
        className={css.thinkRow}
        rowClassName={css.thinkRowInner}
        icon={<IconThinkOutline14 size={14} />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.thinkSeparator} aria-hidden />
            <span ref={summaryRef} className={css.thinkSummary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
})

/** One call's card material through the shared card primitives (the same family the chat rows draw). */
function CardBody({ card, t }: { card: FocusCard; t: FocusTranslate }) {
  switch (card.kind) {
    case 'terminal':
      return (
        <TerminalBlock
          command={card.command}
          cwd={card.cwd}
          output={card.output}
          exitCode={card.exitCode}
          signal={card.signal}
          running={card.running}
          maxLines={Infinity}
          labels={terminalLabels(t)}
          className={css.terminalBody}
        />
      )
    case 'diff':
      return <DiffBlock diffs={card.diffs} maxLines={CHAT_DIFF_MAX_LINES} className={css.diffBody} />
    case 'read':
      return <ReadBlock label={card.label} lines={card.lines} totalLines={card.totalLines} lang={card.lang} maxLines={CHAT_READ_MAX_LINES} className={css.readBody} />
    case 'search':
      return (
        <>
          <SearchBlock {...card.props} maxLines={CHAT_SEARCH_MAX_LINES} className={css.searchBody} />
          {/* A capped search's recovery locator lives only in the result text;
              show it below the card so the dropped rows survive. */}
          {card.recovery !== undefined && <div className={css.searchRecovery}>{card.recovery}</div>}
        </>
      )
    case 'web':
      return <WebBlock {...card.props} className={css.webBody} />
  }
}

/** One Tool call row inside an expanded group: the chat ToolRow chrome (title · summary, cards, IN/OUT). */
const ToolCallRow = memo(function ToolCallRow({ row, t, openFile }: {
  row: FocusToolRow
  t: FocusTranslate
  openFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const card = row.card
  // A card replaces the text body; any of them, or a text body/output, makes
  // the row expandable (the chat row's rule). The running call stays
  // collapsed by default — expand on click only.
  const expandable = row.body !== null || row.output !== null || card !== null
  const open = expanded && expandable
  // An error row's collapsed summary IS the failure: the first error line in
  // the error color outranks the args summary.
  const failureLine = row.state === 'error' ? row.errorSummary : null
  const summaryText = failureLine ?? row.summary
  // The failure line is error prose, not the path: no open-file affordance.
  const fileLink = row.filePath !== undefined && failureLine === null
  const status = row.state === 'running' ? t('row.running')
    : row.state === 'error' ? t('row.failed')
      : row.state === 'stopped' ? t('row.stopped') : null
  // The code variant's program renders through CodeBlock, so only its output
  // joins the IN/OUT card; every other variant's input does too.
  const cardBody = row.variant === 'code' ? null : row.body
  return (
    <div className={css.callRow} data-variant={row.variant} data-tool={row.name || undefined} data-state={row.state}>
      {status !== null && <span className={css.visuallyHidden}>{status}</span>}
      <DisclosureRow
        className={css.callRowInner}
        leadingClassName={css.callLeading}
        titleClassName={css.callTitle}
        chevronClassName={css.callChevron}
        icon={leadingFor(row)}
        title={row.title}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={summaryText !== '' && (
          /* An empty summary drops the separator with it (a row that is only
             its title shows no trailing dot). */
          <>
            <span className={css.callSeparator} aria-hidden />
            {fileLink ? (
              <button
                type="button"
                className={css.callFileLink}
                onClick={(event) => {
                  event.stopPropagation()
                  openFile(row.filePath as string)
                }}
                onKeyDown={(event) => {
                  // Keep Enter/Space on the focused path link from bubbling to
                  // the row's keydown handler (the chat row's analogue).
                  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                }}
              >
                {summaryText}
              </button>
            ) : (
              <span className={`${css.callSummary}${failureLine !== null ? ` ${css.callErrorSummary}` : ''}`}>
                {summaryText}
              </span>
            )}
          </>
        )}
      >
        <div className={css.callBodyWrap}>
          {card !== null ? (
            <CardBody card={card} t={t} />
          ) : (
            <>
              {row.variant === 'code' && row.body !== null && (
                <div className={css.bodyScroll}>
                  <CodeBlock code={row.body} lang="typescript" copyLabel={t('copy')} copiedLabel={t('copied')} className={css.codeBody} />
                </div>
              )}
              {(cardBody !== null || row.output !== null) && (
                <div className={css.ioCard}>
                  {cardBody !== null && (
                    <div className={css.ioSection}>
                      <span className={css.ioLabel}>IN</span>
                      <span className={css.ioText}>{cardBody}</span>
                    </div>
                  )}
                  {cardBody !== null && row.output !== null && (
                    <span className={css.ioDivider} aria-hidden />
                  )}
                  {row.output !== null && (
                    <div className={css.ioSection}>
                      <span className={css.ioLabel}>OUT</span>
                      <span className={css.ioText} data-error={row.state === 'error' || undefined}>{row.output}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {row.subcalls.length > 0 && (
            <div className={css.subcalls} data-subcalls>
              {row.subcalls.map(sub => (
                <ToolCallRow key={sub.callId} row={sub} t={t} openFile={openFile} />
              ))}
            </div>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** The step-summary line parts (pre-casing): the thinking duration leads,
 *  then the absorbed context count, the metric families with per-family
 *  failure tallies, and the metric-less tool calls as a "called N tools"
 *  segment. While the run executes the line is replaced by the running
 *  call's own row title. */
function groupTitleParts(group: FocusToolGroup, t: FocusTranslate): string[] {
  const { commands, writes, edits, searches, files, dirs } = group.metrics
  const { commandsFailed, writesFailed, editsFailed, searchesFailed } = group.metrics
  const parts: string[] = []
  if (group.thoughtMs !== null) {
    parts.push(t('tool.thought', { n: formatSeconds(group.thoughtMs) }))
  }
  if (group.contextCount > 0) {
    parts.push(t(group.contextCount === 1 ? 'tool.context.one' : 'tool.context', {
      n: group.contextCount,
    }))
  }
  metricPart(parts, commands, commandsFailed, 'commands', t)
  metricPart(parts, writes, writesFailed, 'writes', t)
  metricPart(parts, edits, editsFailed, 'edits', t)
  metricPart(parts, searches, searchesFailed, 'searches', t)
  if (files > 0 && dirs > 0) {
    parts.push(t('tool.explored.both', { files, dirs }))
  } else if (files > 0) {
    parts.push(t(files === 1 ? 'tool.explored.files.one' : 'tool.explored.files', { n: files }))
  } else if (dirs > 0) {
    parts.push(t(dirs === 1 ? 'tool.explored.dirs.one' : 'tool.explored.dirs', { n: dirs }))
  }
  const callCount = group.items.reduce((count, item) => count + ('callId' in item ? 1 : 0), 0)
  const others = callCount - commands - writes - edits - searches - files - dirs
  if (others > 0) {
    parts.push(t(others === 1 ? 'tool.others.one' : 'tool.others', { n: others }))
  }
  if (parts.length === 0) {
    parts.push(t(callCount === 1 ? 'tool.group.one' : 'tool.group', { n: callCount }))
  }
  return parts
}

/** The settled step-summary line, sentence-cased and joined. */
function groupTitle(group: FocusToolGroup, t: FocusTranslate): string {
  return sentenceParts(groupTitleParts(group, t)).join(t('tool.separator'))
}

/** One metric family's summary segment with PR67 failure semantics: the
 *  count reads successful calls, a mixed family appends its failure tally,
 *  and a family that failed outright reads its singular failed phrase or the
 *  count with an all-failed suffix. */
function metricPart(
  parts: string[],
  total: number,
  failed: number,
  family: MetricFamily,
  t: FocusTranslate,
): void {
  const ok = total - failed
  if (ok === 0 && failed === 0) return
  if (ok > 0 && failed === 0) {
    parts.push(countSegment(family, ok, t))
    return
  }
  if (ok > 0) {
    parts.push(countSegment(family, ok, t) + t('tool.failedSuffix', { n: failed }))
    return
  }
  if (failed === 1) {
    parts.push(t(`tool.failed.${family}.one`))
    return
  }
  parts.push(countSegment(family, failed, t) + t('tool.failedAll'))
}

/** A metric family the summary line aggregates (locale key stem). */
type MetricFamily = 'commands' | 'writes' | 'edits' | 'searches'

/** The count segment of one metric family, with the singular form for one. */
function countSegment(family: MetricFamily, n: number, t: FocusTranslate): string {
  return t(n === 1 ? `tool.${family}.one` : `tool.${family}`, { n })
}

/** PR67 sentence style: the first segment is capitalized, every later
 *  segment starts lowercase (a no-op for the zh line). */
function sentenceParts(parts: readonly string[]): string[] {
  return parts.map((part, index) => {
    if (part === '') return part
    return index === 0
      ? part.charAt(0).toUpperCase() + part.slice(1)
      : part.charAt(0).toLowerCase() + part.slice(1)
  })
}

/** One folded run of Tool calls: the step-summary line with its metrics. */
const ToolGroupRow = memo(function ToolGroupRow({ group, t, codeLabels, openFile }: {
  group: FocusToolGroup
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  openFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The summary line reads the settled metrics (the running call is counted
  // in — the line stays put when the call completes; only the tail folds).
  const title = groupTitle(group, t)
  const runningRows = group.items.filter((item): item is FocusToolRow =>
    'callId' in item && item.state === 'running')
  return (
    <div className={css.groupRow} data-state={group.running ? 'running' : 'ok'}>
    <DisclosureRow
      className={css.groupRowInner}
      icon={<IconSparkle16 size={16} />}
      title={title}
      open={expanded}
      expandable
      expandOnRowClick
      onToggle={() => { setExpanded(value => !value) }}
    >
      <div className={css.calls} data-calls>
        {group.items.map((item, index) => (
          'callId' in item ? (
            <ToolCallRow key={item.callId} row={item} t={t} openFile={openFile} />
          ) : 'kind' in item ? (
            // An absorbed context injection expands to its chat row.
            <ContextRow key={item.nodeKey} item={item} t={t} codeLabels={codeLabels} />
          ) : (
            // The absorbed thinking keeps its running sweep while any call in
            // the group executes, not only while the assistant streams.
            <ThinkRow key={index} text={item.text} running={item.running || group.running} title={t('think')} t={t} />
          )
        ))}
      </div>
    </DisclosureRow>
    {/* The running call stays part of the group — the flow never rebuilds —
       but renders as a live tail under the collapsed summary line (the chat
       view's running row); it folds into the group once settled. */}
    {group.running && !expanded && runningRows.length > 0 && (
      <div className={css.runningTail} data-running-tail>
        {runningRows.map(row => (
          <ToolCallRow key={row.callId} row={row} t={t} openFile={openFile} />
        ))}
      </div>
    )}
    </div>
  )
})

/** The chat IconActions chrome: copy, optional branch, and an optional date-aware clock. */
const MessageActions = memo(function MessageActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, t }: {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; null hides the clock. */
  time: number | null
  /** Turn wall time, appended as `· 用时 15s`; null omits the reading. */
  runMs: number | null
  /** Turn first-step TTFT in ms; null omits the reading. */
  ttftMs: number | null
  /** Turn decode throughput; null omits the reading. */
  tokensPerSecond: number | null
  /** Clock before the icons (user) or after (assistant tail). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not the completed turn's last row, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  t: FocusTranslate
}) {
  const day = useCalendarDay()
  // Same success chrome as the chat rows: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then(ok => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === null ? null : (
    <span className={css.messageClock}>
      {formatMessageClock(time, t, day)}
      {runMs !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('ranFor', { duration: formatElapsed(runMs, t) })}
        </>
      )}
      {ttftMs !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('ttft', { seconds: formatSeconds(ttftMs) })}
        </>
      )}
      {tokensPerSecond !== null && (
        <>
          {' '}
          <span className={css.messageClockDot} aria-hidden>·</span>
          {' '}
          {t('tokensPerSecond', { tps: formatTokensPerSecond(tokensPerSecond) })}
        </>
      )}
    </span>
  )
  return (
    <div className={css.messageActions} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button
          type="button"
          className={css.messageAction}
          aria-label={copied ? t('copied') : t('copy')}
          onClick={onCopy}
        >
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
      {onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('branchUnavailable') : t('branch')} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.messageAction}
            aria-label={t('branch')}
            aria-disabled={branchUnavailable || undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutline16 />
          </button>
        </Tooltip>
      )}
      {clock === 'end' ? clockEl : null}
    </div>
  )
})

/** Model-facing context text stays bounded at the disclosure, not at the producer. */
const CONTEXT_MAX_CHARS = 20_000

/** Rows a list body materializes before summarizing the remainder. */
const CONTEXT_MAX_ENTRIES = 200

/** One durable context source narrowed to the readable-record shape; null for anything else. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** One run of the model-facing content: adjacent text, or one unknown block. */
type ContentRun = { text: string } | { block: unknown }

/**
 * The content blocks as runs, in the order the model received them: adjacent
 * text joins with no separator (the chat body's rule), unknown blocks break
 * the run and keep their own fallback.
 */
function contentRuns(content: readonly { type?: string; text?: string }[]): ContentRun[] {
  const runs: ContentRun[] = []
  for (const block of content) {
    if (block.type !== 'text') {
      runs.push({ block })
      continue
    }
    const last = runs[runs.length - 1]
    if (last !== undefined && 'text' in last) last.text += block.text ?? ''
    else runs.push({ text: block.text ?? '' })
  }
  return runs
}

/** The model-facing text, truncated to the display bound. */
function boundedText(text: string, t: FocusTranslate): string {
  return text.length > CONTEXT_MAX_CHARS
    ? `${text.slice(0, CONTEXT_MAX_CHARS)}\n${t('json.truncated', { total: text.length })}`
    : text
}

/** One source field rendered as a value row; nested shapes stay compact JSON. */
function fieldValue(value: unknown, t: FocusTranslate): string {
  const text = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)
  return boundedText(text, t)
}

/** Source fields as a key/value list (the chat body's field chrome). */
function SourceFields({ source, formRendered, t }: {
  source: unknown
  formRendered: boolean
  t: FocusTranslate
}): ReactNode {
  const record = asRecord(source)
  if (record === null) return null
  const hidden = formRendered ? ['kind', 'form'] : ['kind']
  const rows = Object.entries(record).filter(([key]) => !hidden.includes(key))
  if (rows.length === 0) return null
  return (
    <dl className={css.contextFields} data-context-fields>
      {rows.map(([key, value]) => (
        <div key={key} className={css.contextField}>
          <dt className={css.contextFieldKey}>{key}</dt>
          <dd className={css.contextFieldValue}>{fieldValue(value, t)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Content blocks this UI version does not know, kept visible rather than dropped. */
function UnknownBlocks({ blocks, t }: { blocks: readonly unknown[]; t: FocusTranslate }): ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <JsonBlock
          key={index}
          label={t('unknownBlock')}
          payload={block}
          truncatedLabel={jsonTruncated(t)}
        />
      ))}
    </>
  )
}

/** The model-facing content of one context, shared by every form that shows it. */
function ModelFacingContent({ content, t }: {
  content: readonly { type?: string; text?: string }[]
  t: FocusTranslate
}): ReactNode {
  return (
    <>
      {contentRuns(content).map((run, index) => ('text' in run
        ? run.text !== '' && (
          <pre key={index} className={css.contextText} data-context-text>{boundedText(run.text, t)}</pre>
        )
        : (
          <JsonBlock
            key={index}
            label={t('unknownBlock')}
            payload={run.block}
            truncatedLabel={jsonTruncated(t)}
          />
        )))}
    </>
  )
}

/** Default context presentation: the model-facing text, then the remaining source fields. */
function OpaqueBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  return (
    <>
      <ModelFacingContent content={content} t={t} />
      <SourceFields source={source} formRendered={false} t={t} />
    </>
  )
}

/** One reconciled instruction file, as the durable source records it. */
interface InstructionChange {
  action: 'set' | 'replace' | 'remove'
  path: string
  digest?: string
}

/** Instruction changes read off the source, or null when the record is not a usable list. */
function instructionChanges(source: unknown): InstructionChange[] | null {
  const record = asRecord(source)
  const list = record === null ? undefined : record['changes']
  if (!Array.isArray(list)) return null
  const changes: InstructionChange[] = []
  const seen = new Set<string>()
  for (const entry of list as readonly unknown[]) {
    const change = asRecord(entry)
    if (change === null) return null
    const path = change['path']
    if (typeof path !== 'string' || path === '') return null
    const action = change['action']
    if (action !== 'set' && action !== 'replace' && action !== 'remove') return null
    const digest = change['digest']
    if (seen.has(path)) continue
    seen.add(path)
    changes.push({ action, path, ...typeof digest === 'string' ? { digest } : {} })
  }
  return changes.length === 0 ? null : changes
}

/** Locale key for one reconciled file (the chat body's action words). */
function instructionAction(
  action: InstructionChange['action'],
  baseline: boolean,
): 'context.instructions.removed' | 'context.instructions.loaded'
  | 'context.instructions.added' | 'context.instructions.updated' {
  if (action === 'remove') return 'context.instructions.removed'
  if (baseline) return 'context.instructions.loaded'
  return action === 'set' ? 'context.instructions.added' : 'context.instructions.updated'
}

/** `instructions` form: the files this context reconciled, then their text. */
function InstructionsBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  const changes = instructionChanges(source)
  if (changes === null) return <OpaqueBody content={content} source={source} t={t} />
  const baseline = asRecord(source)?.['baseline'] === true
  return (
    <>
      <ul className={css.contextFiles} data-context-files>
        {changes.map(change => (
          <li key={change.path} className={css.contextFile} title={change.digest}>
            <span className={css.contextFilePath}>{change.path}</span>
            <span className={css.contextFileAction}>
              {t(instructionAction(change.action, baseline))}
            </span>
          </li>
        ))}
      </ul>
      <ModelFacingContent content={content} t={t} />
    </>
  )
}

/** One catalog entry, as the durable source records it. */
interface CatalogEntry {
  name: string
  description: string
}

/** Catalog entries read off the source, or null when the record is not a usable catalog. */
function catalogEntries(source: unknown): CatalogEntry[] | null {
  const record = asRecord(source)
  const list = record === null ? undefined : record['entries']
  if (!Array.isArray(list)) return null
  const entries: CatalogEntry[] = []
  for (const item of list as readonly unknown[]) {
    const entry = asRecord(item)
    if (entry === null) return null
    const name = entry['name']
    const description = entry['description']
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return null
    entries.push({ name, description })
  }
  return entries
}

/** `catalog` form: the published entries as a list, read from the source. */
function CatalogBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  const entries = catalogEntries(source)
  if (entries === null) return <OpaqueBody content={content} source={source} t={t} />
  const update = asRecord(source)?.['update'] === true
  const shown = entries.slice(0, CONTEXT_MAX_ENTRIES)
  const rest = contentRuns(content).flatMap(run => 'block' in run ? [run.block] : [])
  return (
    <>
      {update && <p className={css.contextNotice} data-context-catalog-update>{t('context.catalog.replaced')}</p>}
      <ul className={css.contextEntries} data-context-entries>
        {shown.map((entry, index) => (
          <li key={index} className={css.contextEntry}>
            <code className={css.contextEntryName}>{entry.name}</code>
            <span className={css.contextEntryDescription}>{entry.description}</span>
          </li>
        ))}
      </ul>
      {shown.length < entries.length && (
        <p className={css.contextNotice} data-context-entries-truncated>
          {t('context.catalog.more', { count: entries.length - shown.length })}
        </p>
      )}
      <UnknownBlocks blocks={rest} t={t} />
    </>
  )
}

/** One named contribution to a runtime snapshot, as the durable source records it. */
interface SnapshotSection {
  name: string
  text: string
}

/** Snapshot sections read off the source, or null when the record is unusable. */
function snapshotSections(source: unknown): SnapshotSection[] | null {
  const record = asRecord(source)
  const list = record === null ? undefined : record['sections']
  if (!Array.isArray(list)) return null
  const sections: SnapshotSection[] = []
  for (const item of list as readonly unknown[]) {
    const section = asRecord(item)
    if (section === null) return null
    const name = section['name']
    const text = section['text']
    if (typeof name !== 'string' || name === '' || typeof text !== 'string') return null
    sections.push({ name, text })
  }
  return sections.length === 0 ? null : sections
}

/** `snapshot` form: the named contributions this snapshot assembled, in order. */
function SnapshotBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  const sections = snapshotSections(source)
  if (sections === null) return <OpaqueBody content={content} source={source} t={t} />
  return (
    <>
      <p className={css.contextNotice} data-context-snapshot-supersedes>
        {t('context.snapshot.supersedes')}
      </p>
      <dl className={css.contextSections} data-context-sections>
        {sections.map((section, index) => (
          <div key={index} className={css.contextSection}>
            <dt className={css.contextSectionName}>{section.name}</dt>
            <dd className={css.contextSectionText}>{boundedText(section.text, t)}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** The one-line account a `notice` puts on its collapsed row, when it records one. */
function noticeSummary(source: unknown): string | null {
  const summary = asRecord(source)?.['summary']
  return typeof summary === 'string' && summary !== '' ? summary : null
}

/** `notice` form: what just happened, with the model-facing text beneath it. */
function NoticeBody({ content, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  return <ModelFacingContent content={content} t={t} />
}

/** The sending agent's session id, or null when the record does not name one. */
function relaySender(source: unknown): string | null {
  const sender = asRecord(source)?.['senderSessionId']
  return typeof sender === 'string' && sender !== '' ? sender : null
}

/** `relay` form: which agent sent this, then what it said. */
function RelayBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  const sender = relaySender(source)
  if (sender === null) return <OpaqueBody content={content} source={source} t={t} />
  return (
    <>
      <p className={css.contextRelaySender} data-context-relay-sender>
        {t('context.relay.from', { session: sender })}
      </p>
      <ModelFacingContent content={content} t={t} />
    </>
  )
}

/** One recalled session, as the durable source records it. */
interface RecalledSession {
  label: string
  retained: number
  omitted: number
  truncated: boolean
}

/** Recalled sessions read off the source, or null when the record is unusable. */
function recalledSessions(source: unknown): RecalledSession[] | null {
  const record = asRecord(source)
  const list = record === null ? undefined : record['references']
  if (!Array.isArray(list)) return null
  const sessions: RecalledSession[] = []
  for (const item of list as ReadonlyArray<unknown>) {
    const reference = asRecord(item)
    if (reference === null) return null
    const label = reference['label']
    const retained = reference['retainedMessages']
    const omitted = reference['omittedMessages']
    const truncated = reference['truncated']
    if (typeof label !== 'string' || label === ''
      || typeof retained !== 'number' || typeof omitted !== 'number'
      || typeof truncated !== 'boolean') return null
    sessions.push({ label, retained, omitted, truncated })
  }
  return sessions.length === 0 ? null : sessions
}

/** `recall` form: which sessions this material came from and how much survived. */
function RecallBody({ content, source, t }: {
  content: readonly { type?: string; text?: string }[]
  source: unknown
  t: FocusTranslate
}): ReactNode {
  const sessions = recalledSessions(source)
  if (sessions === null) return <OpaqueBody content={content} source={source} t={t} />
  return (
    <>
      <ul className={css.contextRecalls} data-context-recalls>
        {sessions.map((session, index) => (
          <li key={index} className={css.contextRecall}>
            <span className={css.contextRecallLabel}>{session.label}</span>
            <span className={css.contextRecallCounts}>
              {t('context.recall.counts', {
                retained: session.retained,
                omitted: session.omitted,
              })}
            </span>
            {session.truncated && (
              <span className={css.contextRecallCounts}>{t('context.recall.truncated')}</span>
            )}
          </li>
        ))}
      </ul>
      <ModelFacingContent content={content} t={t} />
    </>
  )
}

/** Choose the body for one context node (the chat body's form switch). */
function contextBody(
  form: 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall' | null,
  props: { content: readonly { type?: string; text?: string }[]; source: unknown; t: FocusTranslate },
): { rendered: 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall' | null; summary: string | null; body: ReactNode } {
  const opaque = { rendered: null, summary: null, body: <OpaqueBody {...props} /> }
  switch (form) {
    case 'instructions':
      return instructionChanges(props.source) === null
        ? opaque
        : { rendered: 'instructions', summary: null, body: <InstructionsBody {...props} /> }
    case 'catalog':
      return catalogEntries(props.source) === null
        ? opaque
        : { rendered: 'catalog', summary: null, body: <CatalogBody {...props} /> }
    case 'snapshot':
      return snapshotSections(props.source) === null
        ? opaque
        : { rendered: 'snapshot', summary: null, body: <SnapshotBody {...props} /> }
    case 'notice': {
      const summary = noticeSummary(props.source)
      return summary === null
        ? opaque
        : { rendered: 'notice', summary, body: <NoticeBody {...props} /> }
    }
    case 'relay':
      return relaySender(props.source) === null
        ? opaque
        : { rendered: 'relay', summary: null, body: <RelayBody {...props} /> }
    case 'recall':
      return recalledSessions(props.source) === null
        ? opaque
        : { rendered: 'recall', summary: null, body: <RecallBody {...props} /> }
    case null:
      return opaque
    default: {
      const unreachable: never = form
      throw new Error(`unreachable context form: ${String(unreachable)}`)
    }
  }
}

/** Logged context-injection row (the chat ContextInjectionRow chrome: header, source, form body). */
const ContextRow = memo(function ContextRow({ item, t, codeLabels }: {
  item: Extract<FocusFlowItem, { kind: 'message' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
}) {
  const [open, setOpen] = useState(false)
  const context = item.context
  const provenance = context?.provenance
  const label = provenance === undefined ? null : provenance.label
  const form = context?.form ?? null
  const { rendered, summary, body } = contextBody(form, {
    content: item.content,
    source: context?.source,
    t,
  })
  const title = provenance !== undefined && provenance.role !== 'recall'
    ? t('contextInjection')
    : t('contextRecall')
  return (
    <DisclosureRow
      className={css.contextRow}
      chevronClassName={css.contextChevron}
      icon={<IconBrowseOutline16 size={14} />}
      title={title}
      open={open}
      expandable
      expandOnRowClick
      keepContentWhenOpen
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={label === null && summary === null ? undefined : (
        <>
          {label !== null && (
            <>
              <span className={css.thinkSeparator} aria-hidden />
              <span className={css.contextSource} data-context-source>{label}</span>
            </>
          )}
          {summary !== null && (
            <>
              <span className={css.thinkSeparator} aria-hidden />
              <span className={css.contextSummary} data-context-summary>{summary}</span>
            </>
          )}
        </>
      )}
    >
      <div className={css.contextBody} data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </DisclosureRow>
  )
})

/** One running turn's context batch: consecutive context injections under a
 *  single collapsed line (the completed turn folds them into the turn fold
 *  instead; expanding here reveals the individual ContextRows). */
const ContextFoldRow = memo(function ContextFoldRow({ item, t, codeLabels }: {
  item: Extract<FocusFlowItem, { kind: 'context-fold' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
}) {
  const [open, setOpen] = useState(false)
  const title = item.items.length === 1 ? t('contextInjection') : t('context.fold', {
    count: String(item.items.length),
  })
  return (
    <div className={css.contextFold} data-context-fold>
      <DisclosureRow
        className={css.contextFoldRow}
        chevronClassName={css.contextChevron}
        icon={<IconBrowseOutline16 size={14} />}
        title={title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
      >
        <div className={css.contextFoldBody} data-context-fold-body>
          {item.items.map(inner => (
            <MessageRow key={inner.nodeKey} item={inner} t={t} codeLabels={codeLabels} />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** User / steering bubble row (the chat UserStyleBubble chrome: chips, clock, copy). */
const MessageRow = memo(function MessageRow({ item, t, codeLabels }: {
  item: Extract<FocusFlowItem, { kind: 'message' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
}) {
  if (item.role === 'context') return <ContextRow item={item} t={t} codeLabels={codeLabels} />
  const text = useMemo(() => messageText(item.content), [item.content])
  const others = item.content.filter(block => block.type !== 'text')
  return (
    <div className={css.userRow} data-role={item.role} data-time-hover-root>
      {item.role === 'steering' && <span className={css.steeringMark} data-steering-mark>{t('steering')}</span>}
      <div className={css.bubble}>
        {projectUserText(text)}
        {others.map((block, index) => (
          <JsonBlock
            key={index}
            label={t('extraBlock')}
            payload={block}
            truncatedLabel={jsonTruncated(t)}
          />
        ))}
      </div>
      <MessageActions
        text={text}
        time={item.time}
        runMs={null}
        ttftMs={null}
        tokensPerSecond={null}
        clock="start"
        t={t}
      />
    </div>
  )
})

/** Files past this stay counted but unlisted: a refactor turn must not bury the answer. */
const PRODUCED_SHOWN = 6

/** One completed turn's footer: the produced-files row and the chat actions chrome. */
const TurnTailRow = memo(function TurnTailRow({ item, openFile, forkAt, t }: {
  item: Extract<FocusFlowItem, { kind: 'turn-tail' }>
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  t: FocusTranslate
}) {
  const shown = item.produced.slice(0, PRODUCED_SHOWN)
  const hidden = item.produced.length - shown.length
  const closingSeq = item.closingSeq
  return (
    <div className={css.turnTail} data-turn-tail={item.turn} data-time-hover-root>
      {shown.length > 0 && (
        <div className={css.producedRow}>
          <span className={css.producedLabel}>{t('produced.label')}</span>
          {shown.map(path => (
            <button
              key={path}
              type="button"
              className={css.producedFile}
              // The full path is the disambiguator when two turns produce files
              // that share a basename; the chip itself stays short.
              title={path}
              aria-label={t('produced.open', { name: path })}
              onClick={() => { openFile(path) }}
            >
              {basename(path)}
            </button>
          ))}
          {hidden > 0 && <span className={css.producedMore}>{t('produced.more', { count: String(hidden) })}</span>}
        </div>
      )}
      {closingSeq !== null && (
        <MessageActions
          text={item.closingText}
          time={item.closingTime}
          runMs={item.runMs}
          ttftMs={item.ttftMs}
          tokensPerSecond={item.tokensPerSecond}
          clock="end"
          onBranch={() => { forkAt(closingSeq) }}
          branchUnavailable={item.branchUnavailable}
          t={t}
        />
      )}
    </div>
  )
})

/** One Host-authoritative pending steering item (the chat pending bubble shape). */
const PendingSteeringBubble = memo(function PendingSteeringBubble({ content, t }: {
  content: readonly { type?: string; text?: string }[]
  t: FocusTranslate
}) {
  const text = useMemo(() => messageText(content), [content])
  const others = content.filter(block => block.type !== 'text')
  return (
    <div className={css.userRow} data-pending-steering data-time-hover-root>
      <span className={css.steeringMark} data-steering-mark>{t('steering')}</span>
      <div className={css.bubble}>
        {projectUserText(text)}
        {others.map((block, index) => (
          <JsonBlock
            key={index}
            label={t('extraBlock')}
            payload={block}
            truncatedLabel={jsonTruncated(t)}
          />
        ))}
      </div>
      <MessageActions
        text={text}
        time={null}
        runMs={null}
        ttftMs={null}
        tokensPerSecond={null}
        clock="start"
        t={t}
      />
    </div>
  )
})

/** One command row (the chat GenericCommandCard chrome: name · settlement, expandable multiline body). */
const CommandRow = memo(function CommandRow({ item, runningSummary, t }: {
  item: Extract<FocusFlowItem, { kind: 'command' }>
  /** Command-specific running copy; absent uses the generic running label. */
  runningSummary?: string | undefined
  t: FocusTranslate
}) {
  const [expanded, setExpanded] = useState(false)
  const text = item.outcomeText
  const summary = item.running
    ? runningSummary ?? t('command.running')
    : text ?? (item.outcomeError ? t('command.failed') : t('command.done'))
  // Title is the bare command name: the row already reads `name · outcome`,
  // and the dispatched line's own `/` and arguments only restate what the
  // settlement text says (the chat row's rule).
  const title = item.name ?? t('command')
  const body = text !== null && text.includes('\n') ? text : null
  const open = expanded && body !== null
  return (
    <div className={css.commandRow} data-state={item.running ? 'running' : item.outcomeError ? 'error' : 'ok'}>
      {item.running && <span className={css.visuallyHidden}>{t('tool.running')}</span>}
      <DisclosureRow
        className={css.commandRowInner}
        icon={item.outcomeError ? <StateDot state="error" /> : <IconApiOutline14 size={14} />}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.thinkSeparator} aria-hidden />
            <span className={css.commandSummary} data-error={item.outcomeError || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.commandBody} data-error={item.outcomeError || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
})

/** One landed-compaction marker (the chat CompactionItem chrome). */
const CompactionRow = memo(function CompactionRow({ item, title, fallbackSummary, t, codeLabels }: {
  item: Extract<FocusFlowItem, { kind: 'compaction' }>
  /** Optional command title for a manual compaction folded into this marker. */
  title?: string | undefined
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null | undefined
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
}) {
  const [expanded, setExpanded] = useState(false)
  const expandable = item.summary !== null
  const open = expandable && expanded
  const summary = item.shadowedItemCount !== null && item.shadowedTokenCount !== null
    ? t('compaction.completed', {
      items: item.shadowedItemCount,
      tokens: item.shadowedTokenCount,
    })
    : fallbackSummary
      ?? (expandable ? t('compaction.expand') : t('compaction.unavailable'))
  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.compactionLeading} aria-hidden>
          <span className={css.compactionContextIcon} data-compaction-icon="context">
            <IconApiOutline14 />
          </span>
          <span className={css.compactionDisclosureIcon} data-compaction-disclosure={open ? 'expanded' : 'collapsed'}>
            {!open ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
          </span>
        </span>
        <span className={css.compactionTitle}>{title ?? t('compaction')}</span>
        <span className={css.compactionSep} aria-hidden />
        <span className={css.compactionSummary}>{summary}</span>
      </button>
      {open && item.summary !== null && (
        <div className={css.compactionBody}>
          <MarkdownText text={item.summary} codeLabels={codeLabels} />
        </div>
      )}
    </div>
  )
})

/** One manual `/compact` lifecycle: the command card, or the checkpoint marker. */
const ManualCompactionRow = memo(function ManualCompactionRow({ item, t, codeLabels }: {
  item: Extract<FocusFlowItem, { kind: 'manual-compaction' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
}) {
  if (item.compaction !== null) {
    return (
      <CompactionRow
        item={{
          kind: 'compaction',
          nodeKey: item.nodeKey,
          summary: item.compaction.summary,
          shadowedItemCount: item.compaction.shadowedItemCount,
          shadowedTokenCount: item.compaction.shadowedTokenCount,
        }}
        title="compact"
        fallbackSummary={item.outcomeText}
        t={t}
        codeLabels={codeLabels}
      />
    )
  }
  return (
    <CommandRow
      item={{
        kind: 'command',
        nodeKey: item.nodeKey,
        name: item.name,
        args: null,
        outcomeText: item.outcomeText,
        outcomeError: false,
        running: item.running,
      }}
      runningSummary={t('compaction.running')}
      t={t}
    />
  )
})

/** One model-retry row (the chat ModelRetryItem chrome: countdown + details). */
const RetryRow = memo(function RetryRow({ item, t }: {
  item: Extract<FocusFlowItem, { kind: 'retry' }>
  t: FocusTranslate
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + item.delayMs, [item.delayMs, item.nodeKey])
  const scheduledSeconds = retrySeconds(item.delayMs)
  const maximum = item.mode === 'normal' ? item.maxRetries : '∞'
  const [countdown, setCountdown] = useState<{ deadline: number; seconds: number }>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (item.retryState !== 'scheduled') return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [item.retryState, deadline])

  const label = item.retryState === 'scheduled'
    ? t('retry.scheduled')
    : item.retryState === 'cancelled'
      ? t('retry.cancelled')
      : t('retry.started')
  const active = item.retryState === 'scheduled'
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('retry.status', {
            label,
            retry: item.retry,
            maximum: String(maximum),
            seconds,
          })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('retry.delay')}</span>
          {Math.round(item.delayMs)}ms
        </div>
        {item.failure !== null && (
          <div>
            <span className={css.retryDetailLabel}>{t('retry.failure')}</span>
            {item.failure.message}
          </div>
        )}
      </div>
    </details>
  )
})

/** Whole seconds, one minimum (the chat retry countdown's rhythm). */
function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

/** One completed turn's work line: every intermediate assistant row and tool
 *  run folded under `工作了 X 分 Y 秒`, expandable back to the full rows. */
const TurnFoldRow = memo(function TurnFoldRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey }: {
  item: Extract<FocusFlowItem, { kind: 'turn-fold' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
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
            />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** One condensed flow row, dispatched on kind. */
const FlowRow = memo(function FlowRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey }: {
  item: FocusFlowItem
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  openFile: (path: string) => void
  forkAt: (seq: number) => void
  /** Inline file-mention vocabulary per assistant node key (closing prose). */
  mentionsByKey: ReadonlyMap<string, MarkdownFileMentions | undefined>
}) {
  switch (item.kind) {
    case 'message':
      return <MessageRow item={item} t={t} codeLabels={codeLabels} />
    case 'context-fold':
      return <ContextFoldRow item={item} t={t} codeLabels={codeLabels} />
    case 'assistant': {
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
              case 'tool-call':
                return null
              default:
                return (
                  <JsonBlock
                    key={index}
                    label={t('tool.output')}
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
        />
      )
    case 'turn-tail':
      return <TurnTailRow item={item} openFile={openFile} forkAt={forkAt} t={t} />
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
function flowKey(item: FocusFlowItem): string {
  // v8 ignore next -- ?? arm: folded groups always carry at least one node key
  return item.kind === 'tools' ? item.group.nodeKeys[0] ?? 'tools' : item.nodeKey
}

/** Latest open turn's logged start time, mirroring the chat view's clock anchor. */
function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Elapsed clock copy: whole seconds, minute-padded past 60 (the chat view's rhythm). */
function formatElapsed(ms: number, t: FocusTranslate): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0
    ? t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
    : t('duration.seconds', { seconds })
}

/** Turn-level running signal: "Deep diving..." plus an elapsed clock past 15s. */
function RunningStatus({ startTime, t }: {
  /** The running turn's logged turn/start time; null falls back to mount time. */
  startTime: number | null
  t: FocusTranslate
}) {
  const [mountedAt] = useState(() => Date.now())
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      {t('status.diving')}
      {showClock && <span className={css.turnStatusClock} aria-hidden>{formatElapsed(elapsedMs, t)}</span>}
    </div>
  )
}

/** Reader-scroll following threshold (the chat view's value). */
const FOLLOW_THRESHOLD = 24

/** Active conversation column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return from.closest('[data-conversation-scroll]') ?? from
}

/** Find an already-rendered settled flow row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-focus-anchor-key]')) {
    if (row.dataset.focusAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable flow identity, falling back only when layout has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  // The sticky composer covers the bottom of the scrollport in the app: the
  // visible area ends at its top, exactly where the chat view draws it.
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-focus-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-focus-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): FocusScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.focusAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/**
 * The focus view slot entry: pure component over the composed props. Scroll
 * follows the chat view's ledger: the resolved scrollport (the shared
 * conversation column in the app, the view itself in tests) keeps reader
 * positions saved continuously on scroll and restored on mount.
 * @param props - conversation view standard kit and the focus locale seat.
 */
export function FocusView({
  useSession, sessionId, useSessions, loadOlder, openFile, forkAt, fileMentions, scroll, t,
}: FocusViewProps) {
  // Subscribing to the whole chat snapshot (not the order/nodes handles) keeps
  // the flow fresh on every publication — including assistant-only updates
  // that leave the order array untouched, which is what folds a finished
  // Think row back in.
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const inbox = useSession(s => s.queue)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const flow = useMemo(
    () => buildFocusFlow(chat.order, key => chat.nodes.get(key), cwd),
    [chat, cwd],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(chat.timeline), [chat.timeline])
  const codeLabels = useMemo<MarkdownCodeLabels>(
    () => ({ copyLabel: t('copy'), copiedLabel: t('copied') }),
    [t],
  )
  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  // Inline file-mention vocabulary for closing assistants: the engine turn
  // data names the closing seq, the optional chatFileMentions service
  // resolves its prose tokens (absent service leaves the prose inert).
  const mentionsByKey = useMemo(() => {
    const map = new Map<string, MarkdownFileMentions | undefined>()
    for (const item of flow) {
      if (item.kind !== 'assistant' || item.finalSeq === null) continue
      const location = chat.nodes.get(item.nodeKey)?.location
      const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
      const tail = turn?.data.get('turn-tail')
      if (turn === undefined || tail?.closing?.finalNode.seq !== item.finalSeq) continue
      map.set(item.nodeKey, fileMentions({ turn, seq: item.finalSeq, openFile }))
    }
    return map
  }, [chat, fileMentions, flow, openFile])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, restored after the prepend lands. */
  const anchorRef = useRef<{ key: string; top: number } | null>(null)
  const openedRef = useRef(false)
  const firstKeyRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven chrome re-render. */
  const followSigRef = useRef<string | null>(null)

  const lastItem = flow.at(-1)
  const firstKey = flow[0] === undefined ? null : flowKey(flow[0])
  const lastKey = lastItem === undefined ? null : flowKey(lastItem)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstKey}:${lastKey}:${flow.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    scroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Mount (once the session is open — the chat view's gate): restore the
    // saved position — unless the reader was pinned to the bottom, which
    // clears the ledger (view-tab switch away and back keeps the place; a
    // fresh open follows the floor).
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = scroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        scroll.save(isAtBottom ? null : scrollPosition(local, el))
      }
      firstKeyRef.current = firstKey
      lastKeyRef.current = lastKey
      followSigRef.current = followSig
      return
    }
    // Prepend (head moved): preserve the settled row the reader anchored at click.
    if (anchorRef.current !== null && firstKey !== null && firstKeyRef.current !== null && firstKey !== firstKeyRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstKeyRef.current = firstKey
      lastKeyRef.current = lastKey
      followSigRef.current = followSig
      return
    }
    firstKeyRef.current = firstKey
    // Own words must be visible: a new trailing user node force-scrolls.
    const appendedUser = lastKey !== lastKeyRef.current && lastItem?.kind === 'message'
      && (lastItem.role === 'user' || lastItem.role === 'steering')
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render.
    if (appendedUser || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously).
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) scroll.save(null)
    else if (position !== null) scroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists (the chat
  // view's rhythm).
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      scroll.save(null)
    }
  }
  // Streaming, inserted messages, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns the focus
  // view's dynamic-height follow decisions and writes only while the reader
  // is pinned (ChatView's observer, mirrored).
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.focusAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.focusAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll} data-focus-scroll="">
        <div ref={columnRef} className={css.column} data-focus-flow="">
        {openState === 'loading' && <div className={css.hint}>{t('loadingHistory')}</div>}
        {openState === 'error' && openError !== null && (
          <div className={css.openError}>
            {t('loadError', { message: openError.message, code: openError.code })}
          </div>
        )}
        {hasMore && (
          <div className={css.older}>
            <button type="button" className={css.olderButton} disabled={loadingOlder} onClick={loadOlderAnchored}>
              {loadingOlder ? t('loading') : t('loadOlder')}
            </button>
          </div>
        )}
        {flow.length === 0 && <div className={css.empty}>{t('empty')}</div>}
        {flow.map(item => (
          <div key={flowKey(item)} className={css.flowItem} data-focus-anchor-key={flowKey(item)}>
            <FlowRow
              item={item}
              t={t}
              codeLabels={codeLabels}
              openFile={openFile}
              forkAt={forkAt}
              mentionsByKey={mentionsByKey}
            />
          </div>
        ))}
        {running && <RunningStatus startTime={runningTurnStart} t={t} />}
        {pendingSteering.map(item => (
          <PendingSteeringBubble key={item.id} content={item.content} t={t} />
        ))}
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
