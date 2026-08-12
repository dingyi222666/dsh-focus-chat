import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusToolGroup } from '../../model/types.ts'
import { METRIC_BY_TOOL } from '../../model/tools.ts'
import { formatSeconds } from '../../model/text.ts'

/** The step-summary line parts (pre-casing): the thinking duration leads,
 *  then the absorbed context count, any injected notice summaries (a
 *  tool-tasks settlement's own one-line account), the metric families with
 *  per-family failure tallies, and the metric-less tool calls as a "called
 *  N tools" segment. While the run executes the line is replaced by the
 *  running call's own row title. */
/** One summary-line segment: plain text plus an optional failure tally
 *  (parentheses included) rendered in the error color. */
export interface GroupTitleSegment {
  text: string
  failed?: string | undefined
}

export function groupTitleParts(group: FocusToolGroup, t: FocusTranslate): GroupTitleSegment[] {
  const { commands, edits, searches, files, dirs } = group.metrics
  const { subagents, todos, goals, workflows } = group.metrics
  const { skills, questions, plans } = group.metrics
  const { commandsFailed, editsFailed, searchesFailed } = group.metrics
  const parts: GroupTitleSegment[] = []
  if (group.thoughtMs !== null) {
    parts.push({ text: t('tool.thought', { n: formatSeconds(group.thoughtMs) }) })
  }
  if (group.contextCount > 0) {
    parts.push({ text: t(group.contextCount === 1 ? 'tool.context.one' : 'tool.context', {
      n: group.contextCount,
    }) })
  }
  // A notice-form injection (a tool-tasks settlement) carries its own
  // one-line account: surface each such summary as its own segment so the
  // line reads the injected content, not just the count.
  for (const item of group.context) {
    if (item.context?.form !== 'notice') continue
    const summary = noticeSummary(item.context.source)
    if (summary !== null) parts.push({ text: t('tool.context.notice', { summary }) })
  }
  metricPart(parts, commands, commandsFailed, 'commands', t)
  metricPart(parts, edits, editsFailed, 'edits', t)
  metricPart(parts, searches, searchesFailed, 'searches', t)
  // The agentic families replace the generic "called N tools" remainder for
  // their own tools: delegation, todo, goal, workflow, skill, question, and
  // plan calls read their own segments.
  agentPart(parts, subagents, 'subagents', t)
  agentPart(parts, todos, 'todos', t)
  agentPart(parts, goals, 'goals', t)
  agentPart(parts, workflows, 'workflows', t)
  agentPart(parts, skills, 'skills', t)
  agentPart(parts, questions, 'questions', t)
  agentPart(parts, plans, 'plans', t)
  if (files > 0 && dirs > 0) {
    parts.push({ text: t('tool.explored.both', { files, dirs }) })
  } else if (files > 0) {
    parts.push({ text: t(files === 1 ? 'tool.explored.files.one' : 'tool.explored.files', { n: files }) })
  } else if (dirs > 0) {
    parts.push({ text: t(dirs === 1 ? 'tool.explored.dirs.one' : 'tool.explored.dirs', { n: dirs }) })
  }
  // The metric-less remainder counts the settled calls whose tool has no
  // metric family directly (the edit family's metric reads distinct files,
  // not calls, so a subtractive remainder would leak family members).
  const others = group.items.reduce((count, item) => {
    if (!('callId' in item) || item.state === 'running') return count
    return METRIC_BY_TOOL[item.name] === undefined ? count + 1 : count
  }, 0)
  if (others > 0) {
    parts.push({ text: t(others === 1 ? 'tool.others.one' : 'tool.others', { n: others }) })
  }
  // A group whose calls are all still running reads no line: the running
  // call itself renders once as the live row at the end of the flow (the
  // chat live row's position) — painting its row title here too would show
  // the same call twice.
  return parts
}

/** PR67 sentence style: the first visible segment is capitalized, every
 *  later segment starts lowercase (a no-op for the zh line). */
export function caseSegments(segments: GroupTitleSegment[]): GroupTitleSegment[] {
  let first = true
  return segments.map(segment => {
    if (segment.text === '') return segment
    const text = first
      ? segment.text.charAt(0).toUpperCase() + segment.text.slice(1)
      : segment.text.charAt(0).toLowerCase() + segment.text.slice(1)
    first = false
    return { ...segment, text }
  })
}

/** One metric family's summary segment with PR67 failure semantics: the
 *  count reads successful calls, a mixed family appends its failure tally
 *  (red, parentheses included), and a family that failed outright reads its
 *  singular failed phrase or the count with an all-failed suffix. */
export function metricPart(
  parts: GroupTitleSegment[],
  total: number,
  failed: number,
  family: MetricFamily,
  t: FocusTranslate,
): void {
  const ok = total - failed
  if (ok === 0 && failed === 0) return
  if (ok > 0 && failed === 0) {
    parts.push({ text: countSegment(family, ok, t) })
    return
  }
  if (ok > 0) {
    parts.push({ text: countSegment(family, ok, t), failed: t('tool.failedSuffix', { n: failed }) })
    return
  }
  if (failed === 1) {
    parts.push({ text: '', failed: t(`tool.failed.${family}.one`) })
    return
  }
  parts.push({ text: countSegment(family, failed, t), failed: t('tool.failedAll') })
}

/** A metric family the summary line aggregates (locale key stem). */
export type MetricFamily = 'commands' | 'edits' | 'searches'

/** One agentic family's count segment (delegation / todo / goal / workflow /
 *  skill / question / plan): plain count, no failure tally (the chat's
 *  family literals; the todo and goal literals drop the count). */
export function agentPart(
  parts: GroupTitleSegment[],
  n: number,
  family: 'subagents' | 'todos' | 'goals' | 'workflows' | 'skills' | 'questions' | 'plans',
  t: FocusTranslate,
): void {
  if (n === 0) return
  parts.push({ text: t(n === 1 ? `tool.${family}.one` : `tool.${family}`, { n }) })
}

/** The count segment of one metric family, with the singular form for one. */
export function countSegment(family: MetricFamily, n: number, t: FocusTranslate): string {
  return t(n === 1 ? `tool.${family}.one` : `tool.${family}`, { n })
}

/** The one-line account a `notice` form's source records (the notice body's
 *  collapsed summary), or null when the record carries none. A tool-tasks
 *  settlement injects one — "bash pnpm install [status: completed]" — and the
 *  summary line surfaces it instead of burying it behind the count. */
function noticeSummary(source: unknown): string | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  const summary = (source as Record<string, unknown>)['summary']
  return typeof summary === 'string' && summary !== '' ? summary : null
}

