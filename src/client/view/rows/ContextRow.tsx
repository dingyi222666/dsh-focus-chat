import { memo, useState, type ReactNode } from 'react'
import { DisclosureRow, IconBrowseOutline16, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusContextItem, FocusFlowItem } from '../../model/types.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import css from './ContextRow.module.css'

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
export const ContextRow = memo(function ContextRow({ item, t, codeLabels }: {
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
export const ContextFoldRow = memo(function ContextFoldRow({ item, t, codeLabels, loadImage }: {
  item: Extract<FocusFlowItem, { kind: 'context-fold' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  loadImage: ImageLoader
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
            <ContextRow key={inner.nodeKey} item={inner} t={t} codeLabels={codeLabels} />
          ))}
        </div>
      </DisclosureRow>
    </div>
  )
})

/** User / steering bubble row (the chat UserStyleBubble chrome: image gallery, chips, clock, copy). */
