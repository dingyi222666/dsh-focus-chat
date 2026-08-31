import { memo, useState } from 'react'
import { CodeBlock, DiffBlock, DisclosureRow, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChangesBarDiff } from './ChangesBarDiff.tsx'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusKey } from '../../locales.ts'
import type { DiffStyle } from '../../../settings.ts'
import { planSummary } from '../../model/todo.ts'
import type { FocusCard, FocusToolRow } from '../../model/types.ts'
import { leadingFor } from '../helpers/icons.tsx'
import {
  CHAT_DIFF_MAX_LINES, CHAT_READ_MAX_LINES, CHAT_SEARCH_MAX_LINES,
  changesBarExpandLabels, diffLabels, readLabels, searchLabels, terminalLabels, webLabels,
} from '../helpers/terminal.ts'
import a11yCss from '../accessibility.module.css'
import css from './ToolCallRow.module.css'

/** One call's card material through the shared card primitives (the same family the chat rows draw). */
function CardBody({ card, t, diffStyle }: { card: FocusCard; t: FocusTranslate; diffStyle: DiffStyle }) {
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
      return diffStyle === 'codex-bar'
        ? <ChangesBarDiff diffs={card.diffs} labels={diffLabels(t)} expandLabels={changesBarExpandLabels(t)} maxLines={CHAT_DIFF_MAX_LINES} className={css.diffBody} />
        : <DiffBlock diffs={card.diffs} labels={diffLabels(t)} maxLines={CHAT_DIFF_MAX_LINES} className={css.diffBody} />
    case 'read':
      return <ReadBlock label={card.label} lines={card.lines} totalLines={card.totalLines} lang={card.lang} labels={readLabels(t)} maxLines={CHAT_READ_MAX_LINES} className={css.readBody} />
    case 'search':
      return (
        <>
          <SearchBlock {...card.props} labels={searchLabels(t)} maxLines={CHAT_SEARCH_MAX_LINES} className={css.searchBody} />
          {/* A capped search's recovery locator lives only in the result text;
              show it below the card so the dropped rows survive. */}
          {card.recovery !== undefined && <div className={css.searchRecovery}>{card.recovery}</div>}
        </>
      )
    case 'web':
      return <WebBlock {...card.props} labels={webLabels(t)} className={css.webBody} />
  }
}

/** One parsed answer entry, shape-checked (result JSON crosses the wire). */
interface AnswerEntry { selected?: unknown; custom?: unknown }

function isAnswer(value: unknown): value is AnswerEntry {
  return typeof value === 'object' && value !== null
}

/** Answered-count summary from the result JSON (a skipped question has
 *  empty `selected` and no `custom`); null when answer fields are invalid. */
function answeredSummary(text: string | null, t: FocusTranslate): string | null {
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const answers = (parsed as { answers?: unknown }).answers
  if (!Array.isArray(answers) || !answers.every(isAnswer)) return null
  const answered = answers.filter(a =>
    (Array.isArray(a.selected) && a.selected.length > 0)
    || (typeof a.custom === 'string' && a.custom !== '')).length
  return t('ask.answered', { answered, total: answers.length })
}

/** The ask-question row's summary: the composer verdict while pending or
 *  dismissed, the answered count once settled, the args summary otherwise
 *  (the chat AskQuestionRow derivation). */
function questionSummary(row: FocusToolRow, t: FocusTranslate): string {
  if (row.errorCode === 'ASK_CANCELLED') return t('ask.cancelled')
  if (row.errorCode === 'ASK_ABORTED') return t('ask.interrupted')
  if (row.state === 'running') return t('ask.waiting')
  if (row.state === 'ok') {
    const answered = answeredSummary(row.output, t)
    if (answered !== null) return answered
  }
  return row.summary
}

/** The todos array out of a todo_write row's pretty-printed args, shape-checked. */
function todoItems(body: string | null): { content: unknown; status: unknown }[] | null {
  if (body === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const todos = (parsed as { todos?: unknown } | null)?.todos
  if (!Array.isArray(todos) || !todos.every(item => typeof item === 'object' && item !== null)) return null
  return todos as { content: unknown; status: unknown }[]
}

/** The todo_write row's summary (the official TodoRow derivation): the
 *  "{done}/{total} completed" count plus the first active item's content and
 *  a "+N" suffix for any further parallel-active items. */
function todoSummary(row: FocusToolRow, t: FocusTranslate): string {
  const todos = todoItems(row.body)
  if (todos === null) return row.summary
  const { done, total, activeContent, activeExtra } = planSummary(todos)
  const head = t('todo.completed', { done, total })
  const text = activeContent === null ? head : `${head} · ${activeContent}`
  return activeExtra > 0 ? `${text} +${activeExtra}` : text
}

/** The list_agents row's summary: the returned agent count with the running
 *  share ("N subagents · M running"), derived from the result lines the
 *  host renders (`id [status] — label` per agent); a bare result falls back
 *  to the args summary. */
function agentsSummary(row: FocusToolRow, t: FocusTranslate): string {
  const output = row.output
  if (output === null || output === '') return row.summary
  if (output.includes('(no subagents)')) return t('tool.agents.none')
  const lines = output.split('\n').map(line => line.trim()).filter(line => line !== '')
  const running = lines.filter(line => /\[running\]/.test(line)).length
  const head = t('tool.agents', { total: lines.length })
  return running > 0 ? t('tool.agents.running', { text: head, running }) : head
}

/** One Tool call row inside an expanded group: the chat ToolRow chrome (title · summary, cards, IN/OUT). */
export const ToolCallRow = memo(function ToolCallRow({ row, t, openFile, diffStyle = 'default' }: {
  row: FocusToolRow
  t: FocusTranslate
  openFile: (path: string) => void
  /** The file-mutation diff renderer (official DiffBlock vs the changes bar). */
  diffStyle?: DiffStyle
}) {
  const [expanded, setExpanded] = useState(false)
  const card = row.card
  // A card replaces the text body; any of them, or a text body/output, makes
  // the row expandable (the chat row's rule). The running call stays
  // collapsed by default — expand on click only.
  const expandable = row.body !== null || row.output !== null || card !== null
  const open = expanded && expandable
  // The ask-question row reads its own interaction summary (waiting /
  // answered count / cancelled / interrupted), the todo_write row its
  // progress counts, the list_agents row its agent list; an error row's
  // collapsed summary IS the failure — the first error line in the error
  // color outranks the args summary.
  const question = row.name === 'ask_user_question'
  const todo = row.name === 'todo_write'
  const agents = row.name === 'list_agents'
  const failureLine = !question && !todo && !agents && row.state === 'error' ? row.errorSummary : null
  const summaryText = question ? questionSummary(row, t)
    : todo ? todoSummary(row, t)
      : agents ? agentsSummary(row, t)
        : failureLine ?? row.summary
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
      {status !== null && <span className={a11yCss.visuallyHidden}>{status}</span>}
      <DisclosureRow
        className={css.callRowInner}
        leadingClassName={css.callLeading}
        titleClassName={css.callTitle}
        chevronClassName={css.callChevron}
        icon={leadingFor(row)}
        title={question ? t('ask.rowTitle') : todo ? t('todo.rowTitle') : agents ? t('tool.title.listAgents') : t(row.title as FocusKey)}
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
            {/* The official diff-row stat: the card's +/- totals as a mono
                suffix after the path (the "Edit · path +3 -2" reading), both
                sides always shown. Neutral at rest; the row's hover turns the
                additions success-green and the removals error-red. */}
            {row.changeStat !== null && (
              <span className={css.changeStat} data-change-stat>
                <span className={css.changeAdd}>+{row.changeStat.added}</span>
                <span className={css.changeRemove}>-{row.changeStat.removed}</span>
              </span>
            )}
          </>
        )}
      >
        <div className={css.callBodyWrap}>
          {card !== null ? (
            <CardBody card={card} t={t} diffStyle={diffStyle} />
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

