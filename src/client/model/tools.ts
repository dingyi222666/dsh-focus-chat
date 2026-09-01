/** Tool classification and row/group derivation (React-free). */
import { abbreviateHomePath, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { DiffHunk, ReadBlockLine } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
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
  web_search: 'webSearches',
  web_fetch: 'fetches',
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
  // The todo row reads its own plan summary (todo.completed counts + the
  // first active item); the skill row's name is the args `name` field.
  todo: ['content'],
  skill: ['name'],
  others: [],
}

/** Locale keys for the row titles per variant (the official tool.title
 *  vocabulary; the view resolves them through its locale seat). The ask and
 *  todo rows read their own row-title keys at the render site instead. */
const VARIANT_TITLE_KEYS: Readonly<Record<FocusToolVariant, string>> = {
  search: 'tool.title.search', read: 'tool.title.read', bash: 'tool.title.bash',
  write: 'tool.title.write', edit: 'tool.title.edit', code: 'tool.title.code',
  question: 'ask.rowTitle', todo: 'todo.rowTitle', skill: 'tool.title.skill', others: 'tool.title.generic',
}

/**
 * Known tool name → row variant (the chat row's classification, rc.7).
 *
 * `cordis_define` stays absent from the table exactly as in the official
 * chat: ui-cordis owns a keyed toolview for it, and a second title here
 * would be a second answer to the same call.
 */
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
  todo_write: 'todo',
  skill: 'skill',
  write: 'write',
  edit: 'edit',
  str_replace_editor: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  // The three run-control verbs take one package id and produce a receipt,
  // so the generic row is the decided intent, not an unclassified default:
  // the id lands in the summary slot and the titles name the act.
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
}

/** Tool-owned title keys that refine a generic row variant without replacing
 *  it (the official tool.title vocabulary for the named tools). */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  cordis_package_inspect: 'tool.title.inspect',
  cordis_runtime_inspect: 'tool.title.inspect',
  cordis_run: 'tool.title.runCordis',
  cordis_stop: 'tool.title.stopCordis',
  cordis_undefine: 'tool.title.removeCordis',
  job_output: 'tool.title.jobOutput',
  job_kill: 'tool.title.jobKill',
  job_list: 'tool.title.jobList',
  send_message: 'tool.title.sendMessage',
  interrupt_agent: 'tool.title.interruptAgent',
  list_agents: 'tool.title.listAgents',
  pwsh: 'tool.title.pwsh',
  // The web row's tool-owned titles: web_fetch reads "Fetch" (网页获取), not
  // the read variant's "Read", and web_search reads "Search" (网页搜索) — the
  // official WebRow's own title keys.
  web_fetch: 'tool.title.webFetch',
  web_search: 'tool.title.webSearch',
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
  // The search card names every query it ran (the chat row's multi-query
  // summary); a single pattern still lands through the preferred key below.
  if (variant === 'search' && Array.isArray(args.queries)) {
    const queries = args.queries.filter((query): query is string => typeof query === 'string' && query !== '')
    if (queries.length > 0) return queries.map(firstLine).join(', ')
  }
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

/** A parsed, in-window Tool call whose arguments are a JSON object. */
interface ParsedCall {
  name: string
  args: Record<string, unknown>
}

/** Parse the call head paired with one immutable Tool block (null when the head or the JSON object is unavailable). */
function parsedCall(block: ToolCallBlock): ParsedCall | null {
  const call = 'kind' in block ? block.call : block
  if (call === null) return null
  const parsed = parseArgs(call.argsRaw)
  if (typeof parsed !== 'object' || parsed === null) return null
  return { name: call.name, args: parsed as Record<string, unknown> }
}

/** The exact single text block the first-party card derivations read. */
function singleResultText(node: ToolResultNode): string | undefined {
  if (node.content.length !== 1) return undefined
  const only = node.content[0]
  return only?.type === 'text' ? only.text : undefined
}

/** Validate the optional escalation pair shared by the shell and file-mutation tools. */
function validEscalationFields(args: Record<string, unknown>): boolean {
  const permission = args.sandbox_permissions
  const justification = args.justification
  if (permission === undefined && justification === undefined) return true
  if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
  return typeof justification === 'string' && justification.trim() !== ''
}

/** A supported shell call's display material, narrowed from its raw args. */
interface ShellCall {
  command: string
  description: string | undefined
  workdir: string | undefined
  /** A persistent shell settles without one process exit status. */
  persistent: boolean
  background: boolean
}

function shellCall(name: string, args: Record<string, unknown>): ShellCall | null {
  if (name !== 'bash' && name !== 'pwsh') return null
  const { command, description, timeoutMs, workdir, run_in_background: background } = args
  if (typeof command !== 'string' || command.trim() === '') return null
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) return null
  if (workdir !== undefined && typeof workdir !== 'string') return null
  if (background !== undefined && typeof background !== 'boolean') return null
  if (!validEscalationFields(args)) return null
  if (description === undefined) {
    // Persistent shell providers omit the description; their parameter roots stay open.
    return { command, description: undefined, workdir: undefined, persistent: true, background: false }
  }
  if (typeof description !== 'string' || description.trim() === '') return null
  return { command, description, workdir, persistent: false, background: background === true }
}

/** A supported `terminal_send` call: the command IS the sent text, verbatim. */
function terminalSendCall(name: string, args: Record<string, unknown>): { command: string; background: boolean } | null {
  if (name !== 'terminal_send') return null
  const { sessionId, text, submit, run_in_background: background } = args
  if (typeof sessionId !== 'string' || sessionId === '' || typeof text !== 'string') return null
  if (submit !== undefined && typeof submit !== 'boolean') return null
  if (background !== undefined && typeof background !== 'boolean') return null
  return { command: text, background: background === true }
}

/** Parse the exit-status marker literals the shell renderer appends to result text. */
function parseExitStatus(text: string): { output: string; exitCode?: number; signal?: string } {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { output: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { output: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { output: text, exitCode: 0 }
}

/** Validate a grep `include` brace alternation: balanced braces, no empty or negated branch. */
function validInclude(include: string): boolean {
  if (include.trim() === '' || include.startsWith('!')) return false
  let braceDepth = 0
  for (const character of include) {
    if (character === '{') braceDepth += 1
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (character === ',' && braceDepth === 0) return false
  }
  return true
}

function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    out.push({ path, oldText, newText })
  }
  return out
}

/** Content lines of one diff side (the official DiffBlock contentLines
 *  rule): every line including blanks, without the terminating newline. */
function contentLineCount(text: string): number {
  if (text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n').length
}

/**
 * Git-style line-change tally over a settled mutation call's diff meta:
 * added lines across the hunks' new text, removed across the old text —
 * the same counts the official diffTotals reads (the official diff card's
 * footer rule), so the row and the card never disagree. Null when the call
 * is not a diff-bearing file mutation.
 *
 * A write call whose meta never persisted diff hunks falls back to the
 * intended content diff, exactly like the diff card — the badge then never
 * disagrees with the card.
 * @param block - the settled call block (for the intended-diff fallback).
 * @param meta - the persisted result meta (the host's diff hunks).
 * @returns the tally, or null when there is nothing to count.
 */
function diffChangeStat(block: ToolCallBlock, meta: unknown): { added: number; removed: number } | null {
  const diffs = narrowDiffs((meta as Record<string, unknown> | null)?.diffs)
  if (diffs === null) {
    // The card renders an errored write call without a diff; the badge must
    // not contradict it.
    if (!('kind' in block) || block.isError) return null
    const intended = intendedDiff(block)
    if (intended === null || intended.tool !== 'write') return null
    const added = contentLineCount(intended.diff.newText)
    const removed = contentLineCount(intended.diff.oldText ?? '')
    return added === 0 && removed === 0 ? null : { added, removed }
  }
  let added = 0
  let removed = 0
  for (const hunk of diffs) {
    added += contentLineCount(hunk.newText)
    removed += contentLineCount(hunk.oldText ?? '')
  }
  return added === 0 && removed === 0 ? null : { added, removed }
}

type IntendedDiff = { tool: 'write' | 'edit' | 'str_replace_editor'; diff: DiffHunk }

function intendedDiff(block: ToolCallBlock): IntendedDiff | null {
  const parsed = parsedCall(block)
  if (parsed === null) return null
  if (parsed.name === 'str_replace_editor') {
    const { command, path, file_text: fileText, old_str: oldText, new_str: newText } = parsed.args
    if (typeof path !== 'string' || path.trim() === '') return null
    if (command === 'create') {
      if (fileText !== undefined && typeof fileText !== 'string') return null
      return { tool: 'str_replace_editor', diff: { path, oldText: null, newText: fileText ?? '' } }
    }
    if (command === 'str_replace') {
      if (oldText !== undefined && typeof oldText !== 'string') return null
      if (newText !== undefined && typeof newText !== 'string') return null
      return { tool: 'str_replace_editor', diff: { path, oldText: oldText ?? null, newText: newText ?? '' } }
    }
    return null
  }
  const { file_path: path } = parsed.args
  if (typeof path !== 'string' || path.trim() === '') return null
  if (!validEscalationFields(parsed.args)) return null
  if (parsed.name === 'write') {
    const { content } = parsed.args
    return typeof content === 'string'
      ? { tool: 'write', diff: { path, oldText: null, newText: content } }
      : null
  }
  if (parsed.name !== 'edit') return null
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = parsed.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null
  return { tool: 'edit', diff: { path, oldText: oldText || null, newText } }
}

function appliedDiffs(meta: unknown): DiffHunk[] | 'empty' | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs)) return null
  if (diffs.length === 0) return 'empty'
  return narrowDiffs(diffs)
}

function diffCard(block: ToolCallBlock): FocusCard | null {
  if (block.parentCallId !== undefined) return null
  const intended = intendedDiff(block)
  if (intended === null) return null
  if (!('kind' in block)) return { kind: 'diff', diffs: [intended.diff] }
  if (intended.tool === 'str_replace_editor') return null
  if (block.isError) return null
  const applied = appliedDiffs(block.meta)
  if (applied === null || applied === 'empty') {
    return intended.tool === 'write' ? { kind: 'diff', diffs: [intended.diff] } : null
  }
  return { kind: 'diff', diffs: applied }
}

function readCard(block: ToolCallBlock, cwd?: string, home?: string): FocusCard | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  const call = parsedCall(block)
  if (call?.name !== 'read') return null
  const { file_path: path, offset, limit } = call.args
  if (typeof path !== 'string' || path.trim() === '') return null
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1)) return null
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) return null
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  const meta = block.meta as Record<string, unknown>
  const { lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof meta.path !== 'string' || typeof meta.offset !== 'number' || !Number.isInteger(meta.offset) || meta.offset < 1) return null
  if (typeof totalLines !== 'number' || !Number.isInteger(totalLines) || totalLines < 0 || !Array.isArray(lines)) return null
  if (lang !== undefined && typeof lang !== 'string') return null
  const narrowed: ReadBlockLine[] = []
  let previous = meta.offset - 1
  for (const line of lines) {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null
    const { number, text } = line as Record<string, unknown>
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number <= previous) return null
    if (number > totalLines || typeof text !== 'string') return null
    previous = number
    narrowed.push({ number, text })
  }
  const text = singleResultText(block)
  if (text === undefined) return null
  const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
  if (body === undefined) return null
  return {
    kind: 'read',
    label: abbreviateHomePath(relativizeToCwd(meta.path, cwd), home),
    lines: narrowed,
    totalLines,
    lang,
  }
}

function searchCard(block: ToolCallBlock): FocusCard | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  const call = parsedCall(block)
  if (call === null) return null
  const { pattern, path } = call.args
  if (typeof pattern !== 'string') return null
  const tool = call.name === 'glob' ? 'glob'
    : call.name === 'grep' && pattern !== '' ? 'grep' : null
  if (tool === null) return null
  if (path !== undefined && (typeof path !== 'string' || path.trim() === '')) return null
  if (tool === 'grep') {
    const { include } = call.args
    if (include !== undefined && (typeof include !== 'string' || !validInclude(include))) return null
  }
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  const meta = block.meta as Record<string, unknown>
  if (typeof meta.truncated !== 'boolean') return null
  if (typeof meta.total !== 'number' || !Number.isInteger(meta.total) || meta.total < 0) return null
  const common = { truncated: meta.truncated, total: meta.total }
  const recovery = meta.truncated ? flattenText(block.content) : undefined
  if (tool === 'grep') {
    if (meta.shape !== 'matches' || !Array.isArray(meta.files)) return null
    const files: { path: string; matches: { lineNumber: number; line: string }[] }[] = []
    for (const file of meta.files) {
      if (typeof file !== 'object' || file === null || Array.isArray(file)) return null
      const { path: filePath, matches } = file as Record<string, unknown>
      if (typeof filePath !== 'string' || !Array.isArray(matches)) return null
      const group: { lineNumber: number; line: string }[] = []
      for (const match of matches) {
        if (typeof match !== 'object' || match === null || Array.isArray(match)) return null
        const { lineNumber, line } = match as Record<string, unknown>
        if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) || lineNumber < 1) return null
        if (typeof line !== 'string') return null
        group.push({ lineNumber, line })
      }
      files.push({ path: filePath, matches: group })
    }
    return { kind: 'search', recovery, props: { kind: 'matches', files, ...common } }
  }
  if (meta.shape !== 'paths' || !Array.isArray(meta.paths)) return null
  if (!meta.paths.every((entry): entry is string => typeof entry === 'string')) return null
  return { kind: 'search', recovery, props: { kind: 'paths', paths: [...meta.paths], ...common } }
}

function webCard(block: ToolCallBlock): FocusCard | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  const call = parsedCall(block)
  if (call === null) return null
  if (call.name === 'web_search') {
    const { queries } = call.args
    if (!Array.isArray(queries) || queries.length === 0
      || !queries.every(query => typeof query === 'string' && query.trim() !== '')) return null
  } else if (call.name === 'web_fetch') {
    const { url } = call.args
    if (typeof url !== 'string' || url.trim() === '') return null
  } else {
    return null
  }
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  const meta = block.meta as Record<string, unknown>
  if (typeof meta.truncated !== 'boolean') return null
  if (call.name === 'web_search') {
    if (!Array.isArray(meta.sources)) return null
    const sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[] = []
    for (const source of meta.sources) {
      if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
      const { url, title, snippet, publishedAt } = source as Record<string, unknown>
      if (typeof url !== 'string') return null
      if (title !== undefined && typeof title !== 'string') return null
      if (snippet !== undefined && typeof snippet !== 'string') return null
      if (publishedAt !== undefined && typeof publishedAt !== 'string') return null
      sources.push({
        url,
        ...title === undefined ? {} : { title },
        ...snippet === undefined ? {} : { snippet },
        ...publishedAt === undefined ? {} : { publishedAt },
      })
    }
    if (meta.answer !== undefined && typeof meta.answer !== 'string') return null
    return { kind: 'web', props: { kind: 'search', answer: meta.answer, sources, truncated: meta.truncated } }
  }
  if (typeof meta.url !== 'string') return null
  if (typeof meta.statusCode !== 'number' || !Number.isInteger(meta.statusCode)) return null
  return { kind: 'web', props: { kind: 'fetch', url: meta.url, statusCode: meta.statusCode, truncated: meta.truncated } }
}

/**
 * Derive the card render material from the raw Tool call and result fields
 * (arguments, persisted result metadata, and the marked result text — the
 * chat tool-row derivations, reimplemented here). A supported shell call
 * renders its pending terminal card while running; a supported file mutation
 * renders its intended diff.
 * @param block - running call or settled result node.
 * @param cwd - session workspace root for terminal cwd resolution.
 * @returns the card material, or null for the generic sections.
 */
function cardOf(block: ToolCallBlock, cwd?: string, home?: string): FocusCard | null {
  if (!('kind' in block)) {
    const parsed = parsedCall(block)
    if (parsed === null) return null
    const shell = shellCall(parsed.name, parsed.args)
    const send = shell === null ? terminalSendCall(parsed.name, parsed.args) : null
    if (shell !== null) {
      if (shell.background) return null
      return {
        kind: 'terminal',
        command: shell.command,
        cwd: resolveTerminalCwd(shell.workdir, cwd),
        output: undefined,
        exitCode: undefined,
        signal: undefined,
        running: true,
        description: shell.description,
      }
    }
    if (send !== null) {
      if (send.background) return null
      return {
        kind: 'terminal',
        command: send.command,
        cwd: undefined,
        output: undefined,
        exitCode: undefined,
        signal: undefined,
        running: true,
        description: undefined,
      }
    }
    const intended = intendedDiff(block)
    return intended === null ? null : { kind: 'diff', diffs: [intended.diff] }
  }
  return settledCardOf(block, cwd, home)
}

/** The settled-call card derivations, in the chat's precedence order. */
function settledCardOf(block: ToolResultNode, cwd?: string, home?: string): FocusCard | null {
  const parsed = parsedCall(block)
  if (parsed !== null && !block.isError) {
    const shell = shellCall(parsed.name, parsed.args)
    const send = shell === null ? terminalSendCall(parsed.name, parsed.args) : null
    // A persistent shell settles without one process exit status, so its
    // result stays on the generic path; background calls never own a card.
    if (shell !== null && !shell.persistent && !shell.background) {
      const output = singleResultText(block)
      if (output !== undefined) {
        const status = parseExitStatus(output)
        return {
          kind: 'terminal',
          command: shell.command,
          cwd: resolveTerminalCwd(shell.workdir, cwd),
          output: status.output,
          exitCode: status.exitCode,
          signal: status.signal,
          running: false,
          description: shell.description,
        }
      }
    }
    if (send !== null && !send.background) {
      const output = singleResultText(block)
      if (output !== undefined) {
        return {
          kind: 'terminal',
          command: send.command,
          cwd: undefined,
          output,
          exitCode: undefined,
          signal: undefined,
          running: false,
          description: undefined,
        }
      }
    }
  }
  return diffCard(block) ?? readCard(block, cwd, home) ?? searchCard(block) ?? webCard(block)
}

/** The durable error codes a user stop lands on a running tool call: the
 *  tool's own `interrupted` code, the ask tool's abort, and the repair pass's
 *  synthetic closers for a call cut mid-execution (`TOOL_OUTCOME_UNKNOWN` /
 *  `TOOL_NOT_STARTED`). These render the stopped state, never a failure. */
const STOPPED_TOOL_CODES: ReadonlySet<string> = new Set([
  'interrupted',
  'ASK_ABORTED',
  'TOOL_OUTCOME_UNKNOWN',
  'TOOL_NOT_STARTED',
])

/**
 * Per-build tool-row cache: the derived row model keyed by call id, kept
 * only while the underlying block reference is unchanged. Settled history
 * dominates long sessions, and its block objects are identity-stable, so
 * cached rows let every flow rebuild skip the args JSON parse, card
 * materialization, and path normalization for settled calls.
 */
export interface ToolRowModelCache {
  readonly rows: Map<string, { block: ToolCallBlock; row: FocusToolRow }>
}

/**
 * Derive the condensed row model from a frozen call slice (the chat row
 * model's derivation, reimplemented here), caching by call id: a repeat
 * build over an unchanged block reference reuses the previous row object —
 * same identity, so memoized rows never re-render.
 * @param block - running call or settled result node.
 * @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @param cache - optional per-session row cache (stable across builds).
 * @returns the row model.
 */
export function toolRowModel(block: ToolCallBlock, cwd?: string, home?: string, cache?: ToolRowModelCache): FocusToolRow {
  const cached = cache?.rows.get(block.callId)
  if (cached !== undefined && cached.block === block) return cached.row
  const row = toolRowModelUncached(block, cwd, home, cache)
  if (cache !== undefined) cache.rows.set(block.callId, { block, row })
  return row
}

/** The uncached row derivation; sub-call rows ride the same cache. */
function toolRowModelUncached(block: ToolCallBlock, cwd?: string, home?: string, cache?: ToolRowModelCache): FocusToolRow {
  const done = 'kind' in block
  const name = done ? block.call?.name ?? '' : block.name
  const argsRaw = done ? block.call?.argsRaw ?? '' : block.argsRaw
  const errorCode = done && block.error !== undefined ? block.error.code : null
  const state: FocusToolState = !done ? 'running'
    : block.error !== undefined && STOPPED_TOOL_CODES.has(block.error.code) ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const variant = TOOL_VARIANTS[name] ?? 'others'
  // The empty string is "no text" for both derived result fields: a settled
  // call with blank content has nothing to expand, and a blank first line
  // would erase the collapsed error row's summary slot.
  const output = done ? (resultText(block) || null) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  const base = argsRaw === ''
    ? block.callId
    : abbreviateHomePath(relativizeToCwd(deriveSummary(variant, argsRaw), cwd), home)
  const toolTitle = TOOL_TITLES[name]
  // Others keeps the static "Tool call" title (figma literal); the real tool
  // name rides the mutable summary slot unless the tool owns a specific title.
  const baseSummary = variant === 'others' && name !== '' && toolTitle === undefined
    ? `${name} · ${base}`
    : base
  const card = cardOf(block, cwd, home)
  // The chat row's outranking: a terminal card's model-authored description
  // (the args' own description field) precedes the args-derived summary.
  const summary = card?.kind === 'terminal' && card.description !== undefined
    ? card.description
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
    title: toolTitle ?? VARIANT_TITLE_KEYS[variant],
    summary,
    filePath: deriveFilePath(variant, argsRaw),
    state: rowState,
    output,
    errorSummary,
    errorCode,
    time: done ? null : block.time,
    body: deriveBody(variant, argsRaw),
    card,
    subcalls: block.subCalls.map(child => toolRowModel(child, cwd, home, cache)),
    changeStat: done ? diffChangeStat(block, block.meta) : null,
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
  home?: string,
  cache?: ToolRowModelCache,
): FocusToolGroup {
  const rows = blocks.map(block => toolRowModel(block, cwd, home, cache))
  const running = rows.some(row => row.state === 'running')
  const metrics: FocusGroupMetrics = {
    commands: 0, edits: 0, searches: 0, webSearches: 0, fetches: 0, files: 0, dirs: 0,
    subagents: 0, todos: 0, goals: 0, workflows: 0,
    skills: 0, questions: 0, plans: 0, jobs: 0,
    commandsFailed: 0, searchesFailed: 0, webSearchesFailed: 0,
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
    // — command execution, pattern/web searches. File operations never
    // annotate failures (the edit count is the outcome); a failing exit
    // status settles a terminal card's row to the error state.
    if (row.state === 'error' && (key === 'commands' || key === 'searches' || key === 'webSearches')) {
      if (key === 'commands') metrics.commandsFailed += 1
      else if (key === 'searches') metrics.searchesFailed += 1
      else metrics.webSearchesFailed += 1
    }
  }
  metrics.edits = editFiles.size
  return { nodeKeys: [], items: [...think, ...rows], running, metrics, thoughtMs, contextCount: 0, context: [] }
}

/** Resolve one node's data into the flow item family, or null to skip (turn-tail chrome). */
