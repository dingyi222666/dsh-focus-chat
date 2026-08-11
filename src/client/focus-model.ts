/**
 * Pure derivations for the focus view: one condensed flow over the chat
 * snapshot (consecutive Tool calls fold into expandable groups), per-call row
 * models, card render material, and the assistant thinking duration.
 * Everything here is a pure function of plain snapshot data — the component
 * renders, tests assert.
 */
import type {
  AssistantChatData, ChatNodeDataMap, ManualCompactionChatData, ToolChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  DiffHunk, ReadBlockLine, SearchBlockProps, WebBlockProps,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import {
  resolveWorkspacePath,
  type AssistantBlock, type ChatConversationViewNode, type CommandNode, type CompactionSummaryNode,
  type ContextMessageNode, type SteeringMessageNode, type ToolCallBlock, type ToolResultNode,
  type TurnErrorNode, type UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Host-computed card render material for one call, mapped onto the shared
 * card primitives (the same family the chat tool rows draw). Null = the
 * generic sections (args + result text) render instead.
 */
export type FocusCard =
  | { kind: 'terminal'; command: string; cwd: string | undefined; output: string | undefined; exitCode: number | undefined; signal: string | undefined; running: boolean; description: string | undefined }
  | { kind: 'diff'; diffs: DiffHunk[] }
  | { kind: 'read'; label: string; lines: ReadBlockLine[]; totalLines: number; lang: string | undefined }
  | { kind: 'search'; props: SearchBlockProps; recovery: string | undefined; title: string | undefined }
  | { kind: 'web'; props: WebBlockProps }

/** Tool-row state semantics; colors self-supplied by the view. */
export type FocusToolState = 'running' | 'ok' | 'error' | 'stopped'

/** Tool-call row variants selected by the generic renderer (the chat table). */
export type FocusToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

/** One Tool call's condensed row model, derived from the frozen block. */
export interface FocusToolRow {
  callId: string
  /** Wire Tool name ('' when the window dropped the call head). */
  name: string
  /** Row variant (the chat row's classification). */
  variant: FocusToolVariant
  /** Row title: the tool-owned or variant design literal (the chat row's). */
  title: string
  /** Args-derived one-line summary (falls back to the call id). */
  summary: string
  /** Filesystem path from args for single-file tools; undefined otherwise. */
  filePath: string | undefined
  state: FocusToolState
  /** Flattened result text; null while running or when the result has none. */
  output: string | null
  /** First result line on an error row; null otherwise. */
  errorSummary: string | null
  /** Expanded-body input text (pretty args); null = no input section. */
  body: string | null
  /** Card render material from the host-computed views; null = generic sections. */
  card: FocusCard | null
  /** Recursive child rows (the sub-call tree), in dispatch order. */
  subcalls: readonly FocusToolRow[]
}

/** One reasoning row absorbed into a tool group (the chat Think disclosure). */
export interface FocusGroupThink {
  /** Complete or streaming reasoning text. */
  text: string
  /** Whether the reasoning is still the streaming tail (sweep + tail preview). */
  running: boolean
}

/** One folded row inside a tool group: an absorbed context row, an absorbed
 *  Think row, or a call. */
export type FocusGroupItem = FocusContextItem | FocusGroupThink | FocusToolRow

/** Step-summary metric families the group line aggregates, in display order. */
export type FocusMetricKey = 'commands' | 'writes' | 'edits' | 'searches' | 'files' | 'dirs'

/** Tool name → metric family; unknown tools carry no metric. */
const METRIC_BY_TOOL: Readonly<Record<string, FocusMetricKey>> = {
  bash: 'commands',
  pwsh: 'commands',
  sh: 'commands',
  cmd: 'commands',
  terminal: 'commands',
  shell: 'commands',
  write: 'writes',
  save: 'writes',
  edit: 'edits',
  replace: 'edits',
  patch: 'edits',
  apply_patch: 'edits',
  web_search: 'searches',
  grep: 'searches',
  search: 'searches',
  read: 'files',
  glob: 'dirs',
}

/** Per-family call counts and their error rows ("Ran N commands (M failed)"). */
export interface FocusGroupMetrics {
  commands: number
  writes: number
  edits: number
  searches: number
  files: number
  dirs: number
  /** Failed calls in the failure-aware families (error-state rows). */
  commandsFailed: number
  writesFailed: number
  editsFailed: number
  searchesFailed: number
}

/** One focus-mode group: the consecutive root calls folded into a summary line. */
export interface FocusToolGroup {
  /** Chat node keys of the folded roots, in flow order. */
  nodeKeys: readonly string[]
  /** Folded rows in flow order: the absorbed context rows, Think rows, and the calls. */
  items: readonly FocusGroupItem[]
  /** Whether any folded call is still running. */
  running: boolean
  /** Per-family call counts, with failure tallies for the failure-aware families. */
  metrics: FocusGroupMetrics
  /** Context injections directly preceding the run, absorbed into the group. */
  contextCount: number
  context: readonly FocusContextItem[]
  /**
   * Thinking time of the runs folded into this group, summed when every run
   * carries timing (the group merges directly-consecutive runs); null when
   * unavailable.
   */
  thoughtMs: number | null
}

/** One context-injection message row (the chat ContextInjectionRow chrome). */
export type FocusContextItem = Extract<FocusFlowItem, { kind: 'message' }> & { role: 'context' }

/** One condensed flow row; the view dispatches on `kind`. */
export type FocusFlowItem =
  | {
    kind: 'message'
    nodeKey: string
    role: 'user' | 'steering' | 'context'
    content: readonly ContentBlock[]
    time: number
    /** Context-injection chrome (the chat ContextInjectionRow); absent for user/steering. */
    context?: { source: ContextMessageNode['source']; provenance: ContextMessageNode['provenance']; form: ContextMessageNode['form'] }
  }
  | {
    /**
     * One running turn's context batch: consecutive context injections
     * folded into a single line while the turn is open (a completed turn
     * folds them individually into the turn fold instead).
     */
    kind: 'context-fold'
    nodeKey: string
    turn: number | null
    /** The merged context messages, in flow order. */
    items: readonly FocusContextItem[]
  }
  | {
    kind: 'assistant'
    nodeKey: string
    /** Remaining blocks; reasoning absorbed into a directly-following tool group is filtered out. */
    blocks: readonly AssistantBlock[]
    running: boolean
    interrupted: boolean
    thoughtMs: number | null
    /** Settled assistant seq; null while streaming. */
    finalSeq: number | null
  }
  | { kind: 'tools'; group: FocusToolGroup }
  | {
    kind: 'turn-fold'
    nodeKey: string
    turn: number
    /** Turn wall time (start → end); the "工作了 X 分 Y 秒" reading. */
    durationMs: number
    /** The user stopped the turn: the line reads "用户 X 后停止" instead. */
    stopped: boolean
    /** The turn's folded rows — intermediate assistant items and tool runs — in flow order. */
    items: readonly FocusFlowItem[]
  }
  | {
    kind: 'turn-tail'
    nodeKey: string
    turn: number
    /** Closing assistant seq — the fork anchor; null when the turn ended without one. */
    closingSeq: number | null
    /** Closing assistant time (the actions clock). */
    closingTime: number | null
    /** Text of the closing assistant (the copy source). */
    closingText: string
    /** Turn wall time for the `· Ran for Ns` reading. */
    runMs: number | null
    /** Turn first-step TTFT in ms, when recorded. */
    ttftMs: number | null
    /** Turn decode throughput, when recorded. */
    tokensPerSecond: number | null
    /** Whether fork is unavailable (engine-computed; mirrors the chat tail). */
    branchUnavailable: boolean
    /** Files produced by the closing turn, in first-seen order. */
    produced: readonly string[]
  }
  | { kind: 'command'; nodeKey: string; name: string | null; args: string | null; outcomeText: string | null; outcomeError: boolean; running: boolean }
  | { kind: 'manual-compaction'; nodeKey: string; name: string | null; outcomeText: string | null; running: boolean; compaction: { summary: string | null; shadowedItemCount: number | null; shadowedTokenCount: number | null } | null }
  | { kind: 'compaction'; nodeKey: string; summary: string | null; shadowedItemCount: number | null; shadowedTokenCount: number | null }
  | {
    kind: 'retry'
    nodeKey: string
    delayMs: number
    retry: number
    /** 'always' retries never exhaust; the chat row shows ∞. */
    maxRetries: number | null
    mode: 'normal' | 'always'
    retryState: 'scheduled' | 'started' | 'cancelled'
    failure: { message: string } | null
  }
  | { kind: 'turn-error'; nodeKey: string; message: string; code: string | undefined }
  | { kind: 'unknown'; nodeKey: string; nodeKind: string; data: unknown }

/** The chat node data union the focus view narrows, keyed by the merge-extensible map. */
type FocusNodeData = ChatNodeDataMap[Extract<keyof ChatNodeDataMap, string>]

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this turn (the ui-deliverables contract). */
    deliverables: FocusDeliverablesData
  }
}

/** One produced-path fact (the ui-deliverables turn data contract). */
interface FocusDeliverablesData {
  readonly produced: readonly { readonly seq: number; readonly path: string }[]
}

/** Concatenated text blocks of an assistant step (the chat copy source). */
function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
}

/**
 * Files one closing assistant produced: mutation paths settled at or before
 * the closing seq, in first-seen order, deduped (the ui-deliverables
 * derivation, reimplemented here).
 * @param data - engine-published deliverables for one turn.
 * @param seq - closing assistant seq; later tool settlements are excluded.
 * @returns produced paths in first-seen order; empty when the turn wrote nothing.
 */
function producedForClosing(data: Readonly<FocusDeliverablesData> | undefined, seq: number): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Resolve a terminal view's working directory the way the render-intent
 * contract assigns to the UI bridge: an absolute path is used as-is, a
 * relative one joins under the session workspace, and an omitted one IS the
 * session workspace (the chat derivation). Without a session cwd there is
 * nothing to resolve against, so a relative path stays as authored.
 * @param viewCwd - the cwd the terminal call view carries, if any.
 * @param sessionCwd - the session workspace root, if the caller knows it.
 * @returns the working directory for the prompt label, or undefined.
 */
function resolveTerminalCwd(viewCwd: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (viewCwd === undefined || viewCwd === '') return sessionCwd
  if (sessionCwd === undefined || sessionCwd === '') return normalizeSegments(viewCwd)
  return normalizeSegments(resolveWorkspacePath(sessionCwd, viewCwd))
}

/**
 * Collapse `.` and `..` segments so the prompt label names the directory the
 * command actually ran in (the chat derivation). Separators are preserved as
 * authored; a `..` that would climb past the root is dropped, and a UNC
 * path's server and share are not poppable segments.
 */
function normalizeSegments(path: string): string {
  if (!/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)) return path
  const unc = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)/.exec(path)
  if (unc !== null) {
    const [matched, server, share] = unc
    const root = `\\\\${String(server)}\\${String(share)}`
    const rest = collapse(path.slice(matched.length), true)
    return rest === '' ? root : `${root}\\${rest}`
  }
  const backslashed = path.includes('\\') && !path.includes('/')
  const separator = !backslashed ? '/' : '\\'
  const rooted = /^[/\\]/.test(path)
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? ''
  const body = collapse(path.slice(drive.length), rooted || drive !== '', separator)
  const leading = rooted ? separator : ''
  return drive === '' ? `${leading}${body}` : `${drive}${rooted ? leading : separator}${body}`
}

/** Collapse the `.`/`..` segments of a path body against a known root state. */
function collapse(body: string, rooted: boolean, separator = '/'): string {
  const kept: string[] = []
  for (const segment of body.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (kept.length > 0 && kept[kept.length - 1] !== '..') kept.pop()
      else if (!rooted) kept.push(segment)
      continue
    }
    kept.push(segment)
  }
  return kept.join(separator)
}

/** First line of a multi-line string; the text itself when single-line. */
function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** Parse args as JSON; undefined when empty or not JSON (mid-stream truncation). */
function parseArgs(raw: string): unknown {
  if (raw === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Summary-key preference per variant (the chat row's table; args-derived). */
const SUMMARY_KEYS: Readonly<Record<FocusToolVariant, readonly string[]>> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

/** Figma row titles per variant (design literals, not translatable copy). */
const VARIANT_TITLES: Readonly<Record<FocusToolVariant, string>> = {
  search: 'Search', read: 'Read', bash: 'Bash',
  write: 'Write', edit: 'Edit', code: 'Code', others: 'Tool call',
}

/** Known tool name → row variant (the chat row's classification). */
const TOOL_VARIANTS: Readonly<Record<string, FocusToolVariant>> = {
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
  cordis_inspect: 'read',
  cordis_mount: 'code',
  cordis_unmount: 'others',
}

/** Tool-owned titles that refine a generic row variant without replacing it. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  cordis_inspect: 'Inspect',
  cordis_mount: 'Mount temporary Plugin',
  cordis_unmount: 'Unmount temporary Plugin',
  pwsh: 'Pwsh',
}

/** Path keys only — never `url` (web_fetch lands on the read variant). */
const FILE_PATH_KEYS = ['path', 'file_path'] as const

/** File-tool variants whose summary may be an openable workspace path. */
const FILE_PATH_VARIANTS: ReadonlySet<FocusToolVariant> = new Set(['read', 'write', 'edit'])

/** One-line args summary: preferred key, first string value, then the raw first line. */
function deriveSummary(variant: FocusToolVariant, raw: string): string {
  if (raw === '') return ''
  const parsed = parseArgs(raw)
  if (typeof parsed !== 'object' || parsed === null) return firstLine(raw)
  const args = parsed as Record<string, unknown>
  for (const key of SUMMARY_KEYS[variant]) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  return firstLine(raw)
}

/** Filesystem path from args for a file-tool row; undefined for URL reads and non-file tools. */
function deriveFilePath(variant: FocusToolVariant, raw: string): string | undefined {
  if (!FILE_PATH_VARIANTS.has(variant)) return undefined
  const parsed = parseArgs(raw)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  for (const key of FILE_PATH_KEYS) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  return undefined
}

/** Expanded-body input text: the run_code program, or pretty args; null with no args. */
function deriveBody(variant: FocusToolVariant, raw: string): string | null {
  if (raw === '') return null
  const parsed = parseArgs(raw)
  if (parsed === undefined) return raw
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = (parsed as Record<string, unknown>).code
    if (typeof code === 'string' && code !== '') return code
  }
  return JSON.stringify(parsed, null, 2)
}

/**
 * Flatten a settled result's content blocks to display text: text blocks
 * verbatim, other block shapes as pretty JSON. Empty content on a failed call
 * falls back to the structured error's `name: code` line (the chat derivation).
 * @param node - the settled result node.
 * @returns the flattened result text (may be empty).
 */
function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

/**
 * Strip the workspace root from a workspace-rooted absolute path (display
 * only, mirroring the chat tool rows).
 * @param text - the path to shorten.
 * @param cwd - session workspace root; absent or empty leaves the text unchanged.
 * @returns the text relative to the workspace root, or unchanged.
 */
export function relativizeToCwd(text: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return text
  const root = cwd.replace(/[/\\]+$/, '')
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1)
  return text
}

/** Concatenate text content blocks (the result body the row expands to). */
export function flattenText(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * Derive the card render material from the host-computed call/result views
 * (the render-intent contract the tools declare), mapped onto the shared card
 * primitives the chat tool rows use. The completed view wins; a running
 * terminal/diff call renders its pending card.
 * @param block - running call or settled result node.
 * @param cwd - session workspace root for terminal cwd resolution.
 * @returns the card material, or null for the generic sections.
 */
function cardOf(block: ToolCallBlock, cwd?: string): FocusCard | null {
  if ('kind' in block) {
    const result = block.resultView
    if (result === null) return null
    switch (result.card) {
      case 'terminal': {
        const call = block.callView?.card === 'terminal' ? block.callView : null
        return {
          kind: 'terminal',
          // The result's title REPLACES the pending one when the tool supplies
          // it; the call title is what a result without one keeps (the chat
          // presentation contract's replacement-title rule).
          command: result.title ?? call?.title ?? '',
          // Only a PRESENT call view can mean "omitted the cwd, so use the
          // workspace": when the window dropped the call head the prompt draws
          // a bare `$` rather than naming a directory this card cannot know.
          cwd: call === null ? undefined : resolveTerminalCwd(call.cwd, cwd),
          output: result.output,
          exitCode: result.exitCode,
          signal: result.signal,
          running: false,
          description: call?.description,
        }
      }
      case 'diff':
        return { kind: 'diff', diffs: result.diffs }
      case 'read':
        return {
          kind: 'read',
          label: result.title ?? result.path,
          lines: result.lines,
          totalLines: result.totalLines,
          lang: result.lang,
        }
      case 'search': {
        // The recovery footer only matters when the tool capped the result: an
        // uncapped card holds every match/path, so the raw text adds nothing the
        // card does not already show (the chat search-card derivation).
        const recovery = result.truncated ? flattenText(block.content) : undefined
        return result.shape === 'matches'
          ? { kind: 'search', props: { kind: 'matches', files: result.files, truncated: result.truncated, total: result.total }, recovery, title: result.title }
          : { kind: 'search', props: { kind: 'paths', paths: result.paths, truncated: result.truncated, total: result.total }, recovery, title: result.title }
      }
      case 'web':
        return result.kind === 'search'
          ? { kind: 'web', props: { kind: 'search', answer: result.answer, sources: result.sources, truncated: result.truncated } }
          : { kind: 'web', props: { kind: 'fetch', url: result.url, statusCode: result.statusCode, truncated: result.truncated } }
      default:
        return null
    }
  }
  const call = block.callView
  if (call === null) return null
  switch (call.card) {
    case 'terminal':
      return {
        kind: 'terminal',
        command: call.title,
        cwd: resolveTerminalCwd(call.cwd, cwd),
        output: undefined,
        exitCode: undefined,
        signal: undefined,
        running: true,
        description: call.description,
      }
    case 'diff':
      return { kind: 'diff', diffs: call.diffs }
    default:
      return null
  }
}

/**
 * Derive the condensed row model from a frozen call slice (the chat row
 * model's derivation, reimplemented here).
 * @param block - running call or settled result node.
 * @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
 * @returns the row model.
 */
export function toolRowModel(block: ToolCallBlock, cwd?: string): FocusToolRow {
  const done = 'kind' in block
  const name = done ? block.call?.name ?? '' : block.name
  const argsRaw = done ? block.call?.argsRaw ?? '' : block.argsRaw
  const state: FocusToolState = !done ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const variant = TOOL_VARIANTS[name] ?? 'others'
  // The empty string is "no text" for both derived result fields: a settled
  // call with blank content has nothing to expand, and a blank first line
  // would erase the collapsed error row's summary slot.
  const output = done ? (resultText(block) || null) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  const base = argsRaw === '' ? block.callId : relativizeToCwd(deriveSummary(variant, argsRaw), cwd)
  const toolTitle = TOOL_TITLES[name]
  // Others keeps the static "Tool call" title (figma literal); the real tool
  // name rides the mutable summary slot unless the tool owns a specific title.
  const baseSummary = variant === 'others' && name !== '' && toolTitle === undefined
    ? `${name} · ${base}`
    : base
  const card = cardOf(block, cwd)
  // The chat row's outranking: a terminal card's model-authored description
  // (the contract's above-card text) and a search card's replacement title
  // precede the args-derived summary.
  const summary = card?.kind === 'terminal' && card.description !== undefined
    ? card.description
    : card?.kind === 'search' && card.title !== undefined
      ? card.title
      : baseSummary
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const terminalFailed = card?.kind === 'terminal' && !card.running
    && ((card.exitCode !== undefined && card.exitCode !== 0) || card.signal !== undefined)
  const rowState: FocusToolState = state === 'ok' && terminalFailed ? 'error' : state
  return {
    callId: block.callId,
    name,
    variant,
    title: toolTitle ?? VARIANT_TITLES[variant],
    summary,
    filePath: deriveFilePath(variant, argsRaw),
    state: rowState,
    output,
    errorSummary,
    body: deriveBody(variant, argsRaw),
    card,
    subcalls: block.subCalls.map(child => toolRowModel(child, cwd)),
  }
}

/** Fold one consecutive run of root calls into a group model. */
function toolGroup(
  blocks: readonly ToolCallBlock[],
  cwd: string | undefined,
  thoughtMs: number | null,
  think: readonly FocusGroupThink[],
): FocusToolGroup {
  const rows = blocks.map(block => toolRowModel(block, cwd))
  const running = rows.some(row => row.state === 'running')
  const metrics: FocusGroupMetrics = {
    commands: 0, writes: 0, edits: 0, searches: 0, files: 0, dirs: 0,
    commandsFailed: 0, writesFailed: 0, editsFailed: 0, searchesFailed: 0,
  }
  for (const row of rows) {
    // A running call joins its group's summary line only once it settles
    // (the think metric's lifecycle: "完成了才收进去摘要行"); while it runs
    // it renders as the flow-end live row instead.
    if (row.state === 'running') continue
    const key = METRIC_BY_TOOL[row.name]
    if (key === undefined) continue
    metrics[key] += 1
    // Failure tallies only for the families whose summary line carries them:
    // a failing exit status settles a terminal card's row to the error state.
    if (row.state === 'error' && (key === 'commands' || key === 'searches' || key === 'writes' || key === 'edits')) {
      if (key === 'commands') metrics.commandsFailed += 1
      else if (key === 'searches') metrics.searchesFailed += 1
      else if (key === 'writes') metrics.writesFailed += 1
      else metrics.editsFailed += 1
    }
  }
  return { nodeKeys: [], items: [...think, ...rows], running, metrics, thoughtMs, contextCount: 0, context: [] }
}

/** Resolve one node's data into the flow item family, or null to skip (turn-tail chrome). */
function flowItemOf(
  key: string,
  node: ChatConversationViewNode,
  data: FocusNodeData,
): FocusFlowItem | null {
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context': {
      const message = data as UserMessageNode | SteeringMessageNode | ContextMessageNode
      const base = {
        kind: 'message' as const,
        nodeKey: key,
        role: node.kind,
        content: message.content,
        time: message.time,
      }
      if (node.kind !== 'context') return base
      const context = message as ContextMessageNode
      return {
        ...base,
        context: { source: context.source, provenance: context.provenance, form: context.form },
      }
    }
    case 'assistant-step': {
      const assistant = data as AssistantChatData
      return {
        kind: 'assistant',
        nodeKey: key,
        blocks: assistant.blocks,
        running: assistant.status === 'running',
        interrupted: assistant.status === 'interrupted',
        thoughtMs: thoughtDurationMs(assistant),
        finalSeq: assistant.finalNode?.seq ?? null,
      }
    }
    /* v8 ignore next 2 -- unreachable: buildFocusFlow folds tool-call nodes before flowItemOf dispatch */
    case 'tool-call':
      return null // folded by the group pass; see buildFocusFlow
    case 'command': {
      const command = data as CommandNode
      const outcome = command.outcome
      return {
        kind: 'command',
        nodeKey: key,
        name: command.name,
        args: command.args,
        outcomeText: outcome === null ? null : outcome.text ?? null,
        outcomeError: outcome !== null && outcome.kind === 'error',
        running: outcome === null,
      }
    }
    case 'manual-compaction': {
      const manual = data as ManualCompactionChatData
      const command = manual.command
      const outcome = command.outcome
      return {
        kind: 'manual-compaction',
        nodeKey: key,
        name: command.name,
        outcomeText: outcome === null ? null : outcome.text ?? null,
        running: outcome === null,
        compaction: manual.compaction === null ? null : {
          summary: manual.compaction.summary,
          shadowedItemCount: manual.compaction.shadowedItemCount,
          shadowedTokenCount: manual.compaction.shadowedTokenCount,
        },
      }
    }
    case 'compaction': {
      const compaction = data as CompactionSummaryNode
      return {
        kind: 'compaction',
        nodeKey: key,
        summary: compaction.summary,
        shadowedItemCount: compaction.shadowedItemCount,
        shadowedTokenCount: compaction.shadowedTokenCount,
      }
    }
    case 'model-retry': {
      const retry = (data as { current: { retryState: string } }).current as {
        delayMs: number
        retry: number
        mode: 'normal' | 'always'
        maxRetries?: number
        retryState: 'scheduled' | 'started' | 'cancelled'
        failure?: { message?: string } | null
      }
      return {
        kind: 'retry',
        nodeKey: key,
        delayMs: retry.delayMs,
        retry: retry.retry,
        maxRetries: retry.mode === 'normal' ? (retry.maxRetries ?? null) : null,
        mode: retry.mode,
        retryState: retry.retryState,
        failure: retry.failure === undefined || retry.failure === null
          ? null
          : { message: retry.failure.message ?? '' },
      }
    }
    case 'turn-error': {
      const error = data as TurnErrorNode
      return { kind: 'turn-error', nodeKey: key, message: error.message, code: error.code }
    }
    case 'turn-tail': {
      const tail = data as TurnTailChatData
      const location = node.location
      const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
      const closing = tail.closing
      const runMs = turn === undefined || turn.start === undefined || turn.end === undefined
        ? null
        : Math.max(0, turn.end.time - turn.start.time)
      const produced = producedForClosing(turn?.data.get('deliverables'), closing?.finalNode.seq ?? tail.seq)
      return {
        kind: 'turn-tail',
        nodeKey: key,
        turn: tail.turn,
        closingSeq: closing?.finalNode.seq ?? null,
        closingTime: closing?.time ?? null,
        closingText: closing === null ? '' : assistantText(closing.blocks),
        runMs,
        ttftMs: tail.ttftMs ?? null,
        tokensPerSecond: tail.tokensPerSecond ?? null,
        branchUnavailable: tail.branchUnavailable,
        produced,
      }
    }
    default:
      return { kind: 'unknown', nodeKey: key, nodeKind: node.kind, data }
  }
}

/**
 * Build the condensed flow over the chat snapshot: consecutive `tool-call`
 * nodes fold into one group per run, and directly-consecutive runs merge
 * into a single group. A completed turn (its wall duration known) folds
 * everything except the closing assistant's reply — every intermediate
 * assistant row and tool run — into one `工作了 X 分 Y 秒` line, keeping the
 * running turn unfolded. Stale keys (node vanished from the live store) are
 * dropped.
 * @param order - snapshot chat order (stable node keys).
 * @param getNode - snapshot chat node reader.
 * @param cwd - session workspace root for relative path summaries.
 * @returns the condensed flow in order.
 */
export function buildFocusFlow(
  order: readonly string[],
  getNode: (key: string) => ChatConversationViewNode | undefined,
  cwd?: string,
): FocusFlowItem[] {
  // Pre-scan the order once: per-node turn membership, and for each turn the
  // wall boundaries (start/end), the closing assistant — the last assistant
  // step that carries a text reply, the one a completed turn keeps visible —
  // and whether the turn carries a mid-way interjection (a steering message
  // closes the current fold segment: each stretch between two interjections
  // folds with its own duration).
  const nodeTurn = new Map<string, number>()
  const turnPlans = new Map<number, {
    durationMs: number | null
    closingKey: string | null
    startTime: number | null
    endTime: number | null
    /** The user stopped the turn mid-run (an interrupted step or call). */
    stopped: boolean
  }>()
  for (const key of order) {
    const node = getNode(key)
    if (node === undefined || node.visibility === 'hidden') continue
    const location = node.location
    const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
    if (turn === undefined) continue
    nodeTurn.set(key, turn.turn)
    const plan = turnPlans.get(turn.turn)
    if (plan === undefined) {
      turnPlans.set(turn.turn, {
        durationMs: turn.start !== undefined && turn.end !== undefined
          ? Math.max(0, turn.end.time - turn.start.time)
          : null,
        closingKey: node.kind === 'assistant-step' && assistantHasText(node.data) ? key : null,
        startTime: turn.start?.time ?? null,
        endTime: turn.end?.time ?? null,
        stopped: stepInterrupted(node),
      })
    } else {
      if (node.kind === 'assistant-step' && assistantHasText(node.data)) plan.closingKey = key
      if (stepInterrupted(node)) plan.stopped = true
    }
  }

  const flow: FocusFlowItem[] = []
  let pending: { keys: string[]; blocks: ToolCallBlock[] } | null = null
  /** Turn-fold buffer: assistant rows and tool runs of the current completed
   *  turn segment (a mid-way interjection closes the segment). */
  let pendingFoldTurn: number | null = null
  let pendingFold: FocusFlowItem[] = []
  /** The buffered segment's wall-clock start: the turn start, or the previous
   *  interjection's time — the segment's worked duration reads end − start. */
  let pendingFoldStart: number | null = null
  /** Running-turn context batch: consecutive context injections merge into
   *  one collapsed line while the turn is open (a completed turn folds them
   *  individually into the turn fold instead). */
  let pendingContextTurn: number | null | undefined = undefined
  let pendingContext: FocusContextItem[] = []

  const keyOf = (item: FocusFlowItem): string =>
    item.kind === 'tools' ? item.group.nodeKeys[0] ?? 'tools' : item.nodeKey

  /** Emit the buffered rows as one `工作了 X 分 Y 秒` line. The duration
   *  reads `end − segmentStart` — a mid-way interjection passes its own time
   *  as the end, so each stretch between two interjections carries its own
   *  worked duration; a null end falls back to the turn's total wall time. A
   *  duration-less window cut renders the rows unfolded rather than a
   *  meaningless line. */
  const flushFold = (end: number | null): void => {
    const turnId = pendingFoldTurn
    pendingFoldTurn = null
    const start = pendingFoldStart
    pendingFoldStart = null
    const folded = pendingFold
    pendingFold = []
    if (turnId === null || folded.length === 0) return
    const plan = turnPlans.get(turnId)
    const endTime = end ?? plan?.endTime ?? null
    const durationMs = start !== null && endTime !== null
      ? Math.max(0, endTime - start)
      : plan?.durationMs ?? null
    if (durationMs === null) {
      for (const item of folded) flow.push(item)
      return
    }
    flow.push({
      kind: 'turn-fold',
      nodeKey: keyOf(folded[0]),
      turn: turnId,
      durationMs,
      stopped: plan?.stopped ?? false,
      items: folded,
    })
  }

  /** Emit the buffered running-turn context batch as one collapsed line. */
  const flushContext = (): void => {
    if (pendingContext.length === 0) return
    const first = pendingContext[0]
    flow.push({
      kind: 'context-fold',
      nodeKey: first.nodeKey,
      turn: pendingContextTurn ?? null,
      items: pendingContext,
    })
    pendingContext = []
    pendingContextTurn = undefined
  }

  /** Push one flow item, folding completed turns: a closed turn buffers every
   *  assistant row, context injection, and tool run until its closing reply
   *  arrives. User and steering messages stay visible — they are the
   *  conversation's anchors. */
  const pushItem = (item: FocusFlowItem): void => {
    const key = keyOf(item)
    const turnId = nodeTurn.get(key)
    if (item.kind === 'message' && item.role === 'context') {
      // A completed turn folds the injection individually (below); an open or
      // plan-less turn batches consecutive injections into one collapsed line.
      const plan = turnId === undefined ? undefined : turnPlans.get(turnId)
      if (plan === undefined || plan.durationMs === null) {
        if (pendingContext.length > 0 && pendingContextTurn !== turnId) flushContext()
        pendingContextTurn = turnId
        // TS narrows the kind but not the object's role property (property
        // narrowing applies to accesses, not to the object argument); the
        // guard above proves the role.
        pendingContext.push(item as FocusContextItem)
        return
      }
    }
    flushContext()
    // A mid-way interjection closes the current fold segment — the worked
    // duration reads the stretch between the two interjections (segment end
    // = this steering's time) — and starts the next one; the user's own
    // voice itself stays visible.
    if (item.kind === 'message' && item.role === 'steering') {
      const plan = turnId === undefined ? undefined : turnPlans.get(turnId)
      if (plan !== undefined && plan.durationMs !== null) {
        flushFold(item.time)
        pendingFoldStart = item.time
      } else {
        flushFold(null)
      }
      flow.push(item)
      return
    }
    if (turnId === undefined
      || (item.kind === 'message' && item.role !== 'context')
      || item.kind === 'turn-tail') {
      flushFold(null)
      flow.push(item)
      return
    }
    const plan = turnPlans.get(turnId)
    if (plan === undefined || plan.durationMs === null) {
      flushFold(null)
      flow.push(item)
      return
    }
    // Completed turn: keep only the closing assistant's own reply visible.
    // Its own reasoning is part of the folded work — it moves into the fold
    // (the last folded row) instead of painting a second Thought row beside
    // the reply.
    const isClosing = item.kind === 'assistant' && key === plan.closingKey
    if (isClosing) {
      let closing: FocusFlowItem = item
      if (item.kind === 'assistant' && item.blocks.some(block => block.kind === 'reasoning')) {
        const blocks: AssistantBlock[] = []
        for (const block of item.blocks) {
          if (block.kind === 'reasoning') {
            pendingFold.push({ ...item, blocks: [block] })
          } else {
            blocks.push(block)
          }
        }
        pendingFoldTurn = turnId
        closing = { ...item, blocks }
      }
      flushFold(null)
      flow.push(closing)
      return
    }
    if (item.kind === 'assistant'
      || item.kind === 'tools'
      || (item.kind === 'message' && item.role === 'context')) {
      if (pendingFoldTurn !== null && pendingFoldTurn !== turnId) flushFold(null)
      pendingFoldTurn = turnId
      if (pendingFold.length === 0 && pendingFoldStart === null) {
        // First buffered row of the segment: the stretch began at the turn
        // start (a later segment's start was set by its interjection).
        pendingFoldStart = plan.startTime
      }
      pendingFold.push(item)
      return
    }
    flushFold(null)
    flow.push(item)
  }

  const flush = (): void => {
    if (pending === null) return
    // v8 ignore next -- unreachable: pending is created only by a visible tool-call node
    if (pending.blocks.length > 0) {
      // The step summary borrows the thinking metric only from an
      // immediately-preceding assistant (anything between them — a command,
      // a steering message — keeps the Think row owning its own duration).
      // With turn folding the preceding assistant may already sit in the
      // fold buffer rather than the emitted flow.
      const previous = pendingFold.length > 0
        ? pendingFold[pendingFold.length - 1]
        : flow.at(-1)
      const adjacentAssistant = previous !== undefined && previous.kind === 'assistant'
        ? previous
        : null
      const thoughtMs = adjacentAssistant === null ? null : adjacentAssistant.thoughtMs
      const think: FocusGroupThink[] = []
      let trailingAssistant: FocusFlowItem | null = null
      if (adjacentAssistant !== null) {
        // Absorb the assistant's reasoning into the group (the chat Think
        // disclosure becomes the first row of the expanded group). Only the
        // last reasoning block keeps the streaming tail; blocks that remain
        // stay on the assistant item, and an item left with nothing visible
        // is dropped entirely.
        const blocks: AssistantBlock[] = []
        for (let i = 0; i < adjacentAssistant.blocks.length; i += 1) {
          const block = adjacentAssistant.blocks[i]
          if (block.kind === 'reasoning') {
            think.push({
              text: block.text,
              running: adjacentAssistant.running && i === adjacentAssistant.blocks.length - 1,
            })
          } else {
            blocks.push(block)
          }
        }
        const visible = adjacentAssistant.running
          || adjacentAssistant.interrupted
          || blocks.some(block => block.kind !== 'tool-call')
        if (visible) {
          // The folded group precedes the assistant's visible reply: the
          // thinking and the step-summary line render above the text, matching
          // the chat order (reasoning → reply → tool rows). The visible reply
          // also keeps the runs either side of it from merging.
          trailingAssistant = { ...adjacentAssistant, blocks }
        }
        if (pendingFold.length > 0) {
          pendingFold.pop()
        } else {
          flow.pop()
        }
      }
      // Absorb a context batch directly preceding the run into the group as
      // well: its count leads a segment of the summary line, its rows expand
      // inside the group (session order: context → thinking → calls). A
      // context batch with no adjacent run keeps its own folded line.
      const groupTurn = nodeTurn.get(pending.keys[0]) ?? null
      const previousAfterAssistant = pendingFold.length > 0
        ? pendingFold[pendingFold.length - 1]
        : flow.at(-1)
      let absorbedContext: readonly FocusContextItem[] = []
      if (previousAfterAssistant !== undefined
        && previousAfterAssistant.kind === 'context-fold'
        && previousAfterAssistant.turn === groupTurn) {
        absorbedContext = previousAfterAssistant.items
        if (pendingFold.length > 0) {
          pendingFold.pop()
        } else {
          flow.pop()
        }
      }
      const group = toolGroup(pending.blocks, cwd, thoughtMs, think)
      const folded: FocusToolGroup = {
        ...group,
        nodeKeys: pending.keys,
        items: [...absorbedContext, ...group.items],
        contextCount: absorbedContext.length,
        context: absorbedContext,
      }
      // Merge directly-consecutive runs — in the flow or in the turn-fold
      // buffer — into one summary line: metrics and thinking time aggregate,
      // the rows keep flow order. Anything visible between two runs — an
      // assistant reply, a command, a message — keeps them separate.
      const previousItem = pendingFold.length > 0
        ? pendingFold[pendingFold.length - 1]
        : flow.at(-1)
      if (trailingAssistant === null && previousItem !== undefined && previousItem.kind === 'tools') {
        const prev = previousItem.group
        const merged: FocusToolGroup = {
          nodeKeys: [...prev.nodeKeys, ...folded.nodeKeys],
          items: [...prev.items, ...folded.items],
          running: prev.running || folded.running,
          metrics: {
            commands: prev.metrics.commands + folded.metrics.commands,
            writes: prev.metrics.writes + folded.metrics.writes,
            edits: prev.metrics.edits + folded.metrics.edits,
            searches: prev.metrics.searches + folded.metrics.searches,
            files: prev.metrics.files + folded.metrics.files,
            dirs: prev.metrics.dirs + folded.metrics.dirs,
            commandsFailed: prev.metrics.commandsFailed + folded.metrics.commandsFailed,
            writesFailed: prev.metrics.writesFailed + folded.metrics.writesFailed,
            editsFailed: prev.metrics.editsFailed + folded.metrics.editsFailed,
            searchesFailed: prev.metrics.searchesFailed + folded.metrics.searchesFailed,
          },
          contextCount: prev.contextCount + folded.contextCount,
          context: [...prev.context, ...folded.context],
          thoughtMs: prev.thoughtMs === null ? folded.thoughtMs
            : folded.thoughtMs === null ? prev.thoughtMs
              : prev.thoughtMs + folded.thoughtMs,
        }
        if (pendingFold.length > 0) {
          pendingFold[pendingFold.length - 1] = { kind: 'tools', group: merged }
        } else {
          flow[flow.length - 1] = { kind: 'tools', group: merged }
        }
      } else {
        pushItem({ kind: 'tools', group: folded })
      }
      if (trailingAssistant !== null) pushItem(trailingAssistant)
    }
    pending = null
  }
  for (const key of order) {
    const node = getNode(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'tool-call') {
      const data = node.data as ToolChatData
      if (pending === null) pending = { keys: [], blocks: [] }
      pending.keys.push(key)
      pending.blocks.push(data.root)
      continue
    }
    flush()
    const item = flowItemOf(key, node, node.data as FocusNodeData)
    if (item !== null) pushItem(item)
  }
  flush()
  flushFold(null)
  flushContext()
  return flow
}

/** Whether one assistant-step node's blocks carry a visible text reply. */
function assistantHasText(data: unknown): boolean {
  const blocks = (data as AssistantChatData).blocks
  return blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

/** Whether one chat node marks a user-stopped step: an interrupted assistant
 *  step, or a settled tool call whose result error code is `interrupted`. */
function stepInterrupted(node: ChatConversationViewNode): boolean {
  if (node.kind === 'assistant-step') {
    return (node.data as AssistantChatData).status === 'interrupted'
  }
  if (node.kind === 'tool-call') {
    const root = (node.data as ToolChatData).root
    return 'kind' in root && root.error?.code === 'interrupted'
  }
  return false
}

/**
 * Assistant thinking duration: time from the step's start to its first
 * non-empty token delta. Only meaningful once the step is settled; null
 * when the timing boundaries are unavailable.
 * @param data - the assistant chat node data.
 * @returns thinking time in ms, or null when not derivable.
 */
export function thoughtDurationMs(data: AssistantChatData): number | null {
  const timing = data.finalNode?.timing
  if (timing === undefined || timing.stepStartTime === null || timing.firstTokenTime === null) return null
  const ms = timing.firstTokenTime - timing.stepStartTime
  return ms > 0 ? ms : null
}

/**
 * Display seconds for a duration: one decimal under ten seconds, whole
 * seconds beyond. Unit-less so the locale templates own the suffix.
 * @param ms - Duration in milliseconds (negatives clamp to zero).
 * @returns display number in seconds without unit.
 */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s))
}
