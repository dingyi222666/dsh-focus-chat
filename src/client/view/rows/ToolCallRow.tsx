import { memo, useState } from 'react'
import { CodeBlock, DiffBlock, DisclosureRow, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusCard, FocusToolRow } from '../../model/types.ts'
import { leadingFor } from '../helpers/icons.tsx'
import { CHAT_DIFF_MAX_LINES, CHAT_READ_MAX_LINES, CHAT_SEARCH_MAX_LINES, terminalLabels } from '../helpers/terminal.ts'
import a11yCss from '../accessibility.module.css'
import css from './ToolCallRow.module.css'

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
export const ToolCallRow = memo(function ToolCallRow({ row, t, openFile }: {
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
      {status !== null && <span className={a11yCss.visuallyHidden}>{status}</span>}
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

