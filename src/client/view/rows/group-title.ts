import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusToolGroup, FocusToolRow } from '../../model/types.ts'
import { formatSeconds } from '../../model/text.ts'

/** The step-summary line parts (pre-casing): the thinking duration leads,
 *  then the absorbed context count, the metric families with per-family
 *  failure tallies, and the metric-less tool calls as a "called N tools"
 *  segment. While the run executes the line is replaced by the running
 *  call's own row title. */
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
  // Settled calls only: a running call is not in the summary line yet ("完成了
  // 才收进去摘要行"), so the metric-less remainder cannot count it either.
  const callCount = group.items.reduce((count, item) =>
    count + ('callId' in item && item.state !== 'running' ? 1 : 0), 0)
  const others = callCount - commands - edits - searches - files - dirs
    - subagents - todos - goals - workflows - skills - questions - plans
  if (others > 0) {
    parts.push({ text: t(others === 1 ? 'tool.others.one' : 'tool.others', { n: others }) })
  }
  if (parts.length === 0) {
    // A group whose calls all still run reads as its live call's own row
    // (the chat running row's title); the settled metrics replace the line
    // once a call completes.
    const running = group.items.find((item): item is FocusToolRow =>
      'callId' in item && item.state === 'running')
    if (running !== undefined) {
      parts.push({
        text: running.summary === '' ? running.title : `${running.title} · ${running.summary}`,
      })
    } else {
      // Unreachable: a tools group always folds at least one call, so an
      // empty part list means every call is still running.
      parts.push({ text: t('tool.group', { n: 0 }) })
    }
  }
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

