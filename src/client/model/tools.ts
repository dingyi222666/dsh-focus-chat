/** Tool classification and row/group derivation (React-free). */
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { FocusCard, FocusGroupMetrics, FocusGroupThink, FocusMetricKey, FocusToolGroup, FocusToolRow, FocusToolState, FocusToolVariant } from './types.ts'
import { flattenText, relativizeToCwd } from './text.ts'

export const METRIC_BY_TOOL: Readonly<Record<string, FocusMetricKey>> = {
  bash: 'commands',
  pwsh: 'commands',
  sh: 'commands',
  cmd: 'commands',
  terminal: 'commands',
  shell: 'commands',
  write: 'edits',
  save: 'edits',
  edit: 'edits',
  replace: 'edits',
  patch: 'edits',
  apply_patch: 'edits',
  web_search: 'searches',
  grep: 'searches',
  search: 'searches',
  read: 'files',
  glob: 'dirs',
  subagent: 'subagents',
  subagent_fork: 'subagents',
  todo_write: 'todos',
  create_goal: 'goals',
  update_goal: 'goals',
  get_goal: 'goals',
  workflow: 'workflows',
  ralph: 'workflows',
  skill: 'skills',
  ask_user_question: 'questions',
  plan: 'plans',
  job_output: 'jobs',
  job_kill: 'jobs',
  job_list: 'jobs',
  read_image: 'files',
  str_replace_editor: 'edits',
}

/** Per-family call counts and their error rows ("Ran N commands (M failed)"). */
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
  // The question rows read their interaction outcome, not the args; the
  // generic derivation still needs a key for the summary fallback.
  question: ['question', 'header'],
  others: [],
}

/** Figma row titles per variant (design literals, not translatable copy). */
const VARIANT_TITLES: Readonly<Record<FocusToolVariant, string>> = {
  search: 'Search', read: 'Read', bash: 'Bash',
  write: 'Write', edit: 'Edit', code: 'Code', question: 'Ask question', others: 'Tool call',
}

/** Known tool name → row variant (the chat row's classification). */
const TOOL_VARIANTS: Readonly<Record<string, FocusToolVariant>> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  ask_user_question: 'question',
  write: 'write',
  edit: 'edit',
  str_replace_editor: 'edit',
  run_code: 'code',
  cordis_inspect: 'read',
  cordis_inspect_list: 'read',
  cordis_inspect_query: 'read',
  cordis_inspect_self: 'read',
  cordis_define: 'code',
  cordis_run: 'code',
  cordis_stop: 'code',
  cordis_undefine: 'code',
  cordis_mount: 'code',
  cordis_unmount: 'others',
}

/** Tool-owned titles that refine a generic row variant without replacing it. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  cordis_inspect: 'Inspect',
  cordis_inspect_list: 'Inspect',
  cordis_inspect_query: 'Inspect',
  cordis_inspect_self: 'Inspect',
  cordis_define: 'Define Plugin',
  cordis_run: 'Run Plugin',
  cordis_stop: 'Stop Plugin',
  cordis_undefine: 'Undefine Plugin',
  cordis_mount: 'Mount temporary Plugin',
  cordis_unmount: 'Unmount temporary Plugin',
  job_output: 'Job output',
  job_kill: 'Kill job',
  job_list: 'List jobs',
  send_message: 'Send message',
  interrupt_agent: 'Interrupt agent',
  list_agents: 'List agents',
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

/** Filesystem path from a settled file-mutation call's args (`path` /
 *  file_path) for the edit family's distinct-file count. The row variant
 *  gates filePath on read/write/edit only, so the family's other tools
 *  (replace, patch, apply_patch, save) derive their path here.
 * @param block - the settled call block.
 * @returns the first path value, or undefined when the call is running or
 *  carries no path. */
function fileMutationPath(block: ToolCallBlock): string | undefined {
  if (!('kind' in block)) return undefined
  const name = block.call?.name ?? ''
  if (METRIC_BY_TOOL[name] !== 'edits') return undefined
  const raw = block.call?.argsRaw ?? ''
  if (raw === '') return undefined
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
  const errorCode = done && block.error !== undefined ? block.error.code : null
  const state: FocusToolState = !done ? 'running'
    : block.error?.code === 'interrupted' || block.error?.code === 'ASK_ABORTED' ? 'stopped'
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
    errorCode,
    time: done ? null : block.time,
    body: deriveBody(variant, argsRaw),
    card,
    subcalls: block.subCalls.map(child => toolRowModel(child, cwd)),
  }
}

/** A running call paints no live row until it has run this long: fast
 *  calls (a few hundred ms) would otherwise flash a live row that settles
 *  into the summary a moment later — the debounce skips the flash. */
export const LIVE_ROW_THRESHOLD_MS = 400

/** Fold one consecutive run of root calls into a group model. */
export function toolGroup(
  blocks: readonly ToolCallBlock[],
  cwd: string | undefined,
  thoughtMs: number | null,
  think: readonly FocusGroupThink[],
): FocusToolGroup {
  const rows = blocks.map(block => toolRowModel(block, cwd))
  const running = rows.some(row => row.state === 'running')
  const metrics: FocusGroupMetrics = {
    commands: 0, edits: 0, searches: 0, files: 0, dirs: 0,
    subagents: 0, todos: 0, goals: 0, workflows: 0,
    skills: 0, questions: 0, plans: 0, jobs: 0,
    commandsFailed: 0, searchesFailed: 0,
  }
  // The edit family counts the distinct files ACTUALLY edited — a file with
  // at least one successful call — so the summary line reads "edited N
  // files" (the chat copy) as an outcome. A failed attempt followed by a
  // successful retry counts the file once; a file whose only calls failed
  // never counts, because the file-level count cannot carry a call-level
  // failure tally without lying ("all failed" after a successful retry). A
  // call whose args carry no derivable path counts as its own entry; a
  // running call joins only once it settles (the think metric's lifecycle:
  // "完成了才收进去摘要行"), rendering as the flow-end live row meanwhile.
  const editFiles = new Set<string>()
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.state === 'running') continue
    const key = METRIC_BY_TOOL[row.name]
    if (key === undefined) continue
    if (key === 'edits') {
      if (row.state === 'ok') editFiles.add(fileMutationPath(blocks[i]) ?? row.callId)
    } else {
      metrics[key] += 1
    }
    // Failure tallies only for the families whose summary line carries them
    // — command execution and other tools. File operations never annotate
    // failures (the edit count is the outcome); a failing exit status
    // settles a terminal card's row to the error state.
    if (row.state === 'error' && (key === 'commands' || key === 'searches')) {
      if (key === 'commands') metrics.commandsFailed += 1
      else metrics.searchesFailed += 1
    }
  }
  metrics.edits = editFiles.size
  return { nodeKeys: [], items: [...think, ...rows], running, metrics, thoughtMs, contextCount: 0, context: [] }
}

/** Resolve one node's data into the flow item family, or null to skip (turn-tail chrome). */
