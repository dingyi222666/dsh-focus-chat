/** Text derivations of the focus flow model (React-free). */
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { FocusDeliverablesData } from './types.ts'

export function assistantText(blocks: readonly AssistantBlock[]): string {
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
export function producedForClosing(data: Readonly<FocusDeliverablesData> | undefined, seq: number): readonly string[] {
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
