import { memo, useState } from 'react'
import { CodeBlock, DiffBlock, DisclosureRow, IconInspectOutline12, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChangesBarDiff } from './ChangesBarDiff.tsx'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusKey } from '../../locales.ts'
import type { DiffStyle } from '../../../settings.ts'
import { planSummary } from '../../model/todo.ts'
import type { FocusCard, FocusToolRow } from '../../model/types.ts'
import { leadingFor } from '../helpers/icons.tsx'
import { messageImageLabels } from '../helpers/image-labels.ts'
import { ImageGallery, type ImageLoader } from '../chrome/MessageImage.tsx'
import {
  CHAT_DIFF_MAX_LINES, CHAT_READ_MAX_LINES, CHAT_SEARCH_MAX_LINES,
  changesBarExpandLabels, diffLabels, readLabels, searchLabels, terminalLabels, webLabels,
} from '../helpers/terminal.ts'
import a11yCss from '../accessibility.module.css'
import css from './ToolCallRow.module.css'

/** One call's card material through the shared card primitives (the same family the chat rows draw). */
function CardBody({ card, t, diffStyle, loadImage }: {
  card: FocusCard
  t: FocusTranslate
  diffStyle: DiffStyle
  /** Session-authorized durable image URL loader (the image card's gallery). */
  loadImage?: ImageLoader
}) {
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
    case 'ask': {
      // The official AskQuestionCard: a bordered transcript of question/answer
      // pairs, or the verdict and question list of a cancelled/aborted set.
      if (!card.answered) {
        return (
          <div className={css.askCard}>
            <p className={css.askVerdict}>
              {card.verdict === 'cancelled' ? t('ask.cancelledDetail') : t('ask.interruptedDetail')}
            </p>
            <ul className={css.askQuestionList}>
              {card.questions.map(question => (
                <li className={css.askUnanswered} key={question.id}>{question.question}</li>
              ))}
            </ul>
          </div>
        )
      }
      return (
        <dl className={css.askCard}>
          {card.questions.map(question => (
            <div className={css.askItem} key={question.id}>
              <dt className={css.askQuestion}>{question.question}</dt>
              <dd className={css.askAnswer}>
                {question.answers.length === 0
                  ? <span className={css.askSkipped}>{t('ask.skipped')}</span>
                  : question.answers.map((answer, index) => (
                    <span className={css.askAnswerLine} key={`${question.id}-${String(index)}`}>{answer}</span>
                  ))}
              </dd>
            </div>
          ))}
        </dl>
      )
    }
    case 'read':
      return <ReadBlock label={card.label} lines={card.lines} totalLines={card.totalLines} lang={card.lang} labels={readLabels(t)} maxLines={CHAT_READ_MAX_LINES} className={css.readBody} />
    case 'image':
      // The chat's image card: the read path label, the durable-image gallery
      // (the same MessageImage/ImageGallery the message rows draw), then the
      // result's own envelope text — the line under the gallery that stays
      // when the attachment arm renders nothing.
      return (
        <div className={css.imageBody}>
          <div className={css.imageLabel}>{card.label}</div>
          {loadImage !== undefined && (
            <ImageGallery images={card.images} load={loadImage} align="start" labels={messageImageLabels(t)} />
          )}
          <div className={css.imageMeta}>{card.text}</div>
        </div>
      )
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

/** Normalize the reviewer's persisted reason into one display line; null when
 *  it carries no displayable text (the official normalizeAutoReviewReason). */
function autoReviewReason(reason: string | null): string | null {
  if (reason === null) return null
  const normalized = reason.trim().replace(/[\r\n\u2028\u2029]+/gu, ' ')
  return normalized === '' ? null : normalized
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
/** The present row's status word followed by its delivered paths (the
 *  official PresentRow reading). */
function presentSummary(row: FocusToolRow, t: FocusTranslate): string {
  const status = row.state === 'running' ? t('presented.row.running')
    : row.state === 'error' ? t('presented.row.error')
      : row.state === 'stopped' ? t('presented.row.stopped') : t('presented.row.ok')
  return row.summary === '' ? status : `${status} ${row.summary}`
}

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
export const ToolCallRow = memo(function ToolCallRow({ row, t, openFile, inspect, diffStyle = 'default', loadImage }: {
  row: FocusToolRow
  t: FocusTranslate
  openFile: (path: string, options?: { line?: number }) => void
  /** Reveal this call in the trajectory view (the chat's Inspect action). */
  inspect?: (callId: string) => void
  /** The file-mutation diff renderer (official DiffBlock vs the changes bar). */
  diffStyle?: DiffStyle
  /** Session-authorized durable image URL loader (the read_image image card). */
  loadImage?: ImageLoader
}) {
  const [expanded, setExpanded] = useState(false)
  // An Auto-review denial replaces the ordinary failed-call reading: the card
  // and the args body drop, the row says what was refused and why (the
  // official GenericToolCard rule).
  const autoReview = row.autoReviewDenial === null ? null : {
    summary: t('tool.autoReviewRejected'),
    output: t('tool.autoReviewNotExecuted', {
      reason: autoReviewReason(row.autoReviewDenial.reason) ?? t('tool.autoReviewReasonFallback'),
    }),
  }
  const card = autoReview === null ? row.card : null
  const output = autoReview?.output ?? row.output
  const argsBody = autoReview === null ? row.body : null
  // A card replaces the text body; any of them, or a text body/output, makes
  // the row expandable (the chat row's rule). The running call stays
  // collapsed by default — expand on click only.
  const expandable = argsBody !== null || output !== null || card !== null
  const open = expanded && expandable
  // The ask-question row reads its own interaction summary (waiting /
  // answered count / cancelled / interrupted), the todo_write row its
  // progress counts, the list_agents row its agent list; an error row's
  // collapsed summary IS the failure — the first error line in the error
  // color outranks the args summary.
  const question = row.name === 'ask_user_question'
  const todo = row.name === 'todo_write'
  const agents = row.name === 'list_agents'
  // Every row kind surfaces its own failure line (the official ToolRow rule);
  // a failed todo/ask/agents call must not keep painting its normal summary.
  const failureLine = autoReview?.summary ?? (row.state === 'error' ? row.errorSummary : null)
  // The failure line outranks every derived summary (the official ToolRow
  // rule); the present row prefixes its delivery status word.
  const summaryText = failureLine
    ?? (row.variant === 'present' ? presentSummary(row, t) : null)
    ?? (question ? questionSummary(row, t)
      : todo ? todoSummary(row, t)
        : agents ? agentsSummary(row, t)
          : row.summary)
  // The failure line is error prose, not the path: no open-file affordance.
  const fileLink = row.filePath !== undefined && failureLine === null
  const status = row.state === 'running' ? t('row.running')
    : row.state === 'error' ? t('row.failed')
      : row.state === 'stopped' ? t('row.stopped') : null
  // The code variant's program renders through CodeBlock, so only its output
  // joins the IN/OUT card; every other variant's input does too.
  const cardBody = row.variant === 'code' ? null : argsBody
  return (
    <div
      className={css.callRow}
      data-variant={row.variant}
      data-tool={row.name || undefined}
      data-state={row.state}
      data-chat-anchor-key={`call:${row.callId}`}
      data-chat-call-id={row.callId}
    >
      {status !== null && <span className={a11yCss.visuallyHidden}>{status}</span>}
      <DisclosureRow
        rowClassName={css.callRowInner}
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
                  // A read call lands the preview on the line the model looked
                  // at (the chat's readCallLine rule); other file tools open
                  // the path at its beginning.
                  if (row.openLine === null) openFile(row.filePath as string)
                  else openFile(row.filePath as string, { line: row.openLine })
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
            {row.changeStat !== null && failureLine === null && (
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
            <CardBody card={card} t={t} diffStyle={diffStyle} loadImage={loadImage} />
          ) : (
            <>
              {row.variant === 'code' && argsBody !== null && (
                <div className={css.bodyScroll}>
                  <CodeBlock code={argsBody} lang="typescript" copyLabel={t('copy')} copiedLabel={t('copied')} className={css.codeBody} />
                </div>
              )}
              {(cardBody !== null || output !== null) && (
                <div className={css.ioCard}>
                  {cardBody !== null && (
                    <div className={css.ioSection}>
                      <span className={css.ioLabel}>{t('tool.input')}</span>
                      <span className={css.ioText}>{cardBody}</span>
                    </div>
                  )}
                  {cardBody !== null && output !== null && (
                    <span className={css.ioDivider} aria-hidden />
                  )}
                  {output !== null && (
                    <div className={css.ioSection}>
                      <span className={css.ioLabel}>{t('tool.output')}</span>
                      <span className={css.ioText} data-error={row.state === 'error' || undefined}>{output}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {inspect !== undefined && (
            <button
              type="button"
              className={css.inspectButton}
              onClick={() => { inspect(row.callId) }}
            >
              <IconInspectOutline12 />
              {t('tool.inspect')}
            </button>
          )}
        </div>
      </DisclosureRow>
      {/* The dispatch tree is always visible, a sibling of the row's
          disclosure (the official ToolCallTree rule): a collapsed parent still
          shows its children, and the child rows carry the same renderer
          props as the root. */}
      {row.subcalls.length > 0 && (
        <div className={css.subcalls} data-subcalls>
          {row.subcalls.map(sub => (
            <ToolCallRow key={sub.callId} row={sub} t={t} openFile={openFile} inspect={inspect} diffStyle={diffStyle} loadImage={loadImage} />
          ))}
        </div>
      )}
    </div>
  )
})

