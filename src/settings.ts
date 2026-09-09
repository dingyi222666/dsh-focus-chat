/**
 * Durable focus-view preferences shared by the Host schema and the browser
 * scope. This module is deliberately free of schemastery so the browser half
 * and the test suite can import it without a Host dependency; the schemastery
 * wire schema lives in `schema.ts` (Host half only).
 *
 * Both preferences keep the default rendering as their first option: the
 * focus view renders the official primitives unless the user opts into the
 * plugin's alternate style, so upstream dsh changes keep flowing through.
 */

/** Settings namespace owned by the focus-view plugin. */
export const FOCUS_SETTINGS_NS = 'dsh-focus-chat'

/** The file-mutation diff renderers the focus view can draw. */
export const DIFF_STYLES = ['default', 'codex-bar'] as const

/** One selectable file-mutation diff renderer. */
export type DiffStyle = typeof DIFF_STYLES[number]

/** The markdown inline-code renderings the focus view can draw. */
export const MD_STYLES = ['default', 'highlight'] as const

/** One selectable markdown inline-code rendering. */
export type MdStyle = typeof MD_STYLES[number]

/** The completed-turn transcript layouts the focus view can draw. */
export const TRANSCRIPT_VIEW_MODES = ['compact', 'normal'] as const

/** One selectable completed-turn transcript layout. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Durable focus-view preferences. */
export interface FocusSettings {
  /** Which diff renderer file-mutation cards use. */
  diffStyle: DiffStyle
  /** Which inline-code rendering markdown text uses. */
  mdStyle: MdStyle
  /** Whether completed turns fold into one worked-for line or stay expanded. */
  transcriptView: TranscriptViewMode
}

/** Default preferences applied when the user document holds no override. */
export const DEFAULT_FOCUS_SETTINGS: FocusSettings = Object.freeze({
  // The official DiffBlock, untouched.
  diffStyle: 'default',
  // The official markdown inline-code box, untouched.
  mdStyle: 'default',
  // The official compact transcript: completed turns fold.
  transcriptView: 'compact',
})

/**
 * Narrow one candidate to a diff style.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether the value is a selectable diff style.
 */
export function isDiffStyle(value: unknown): value is DiffStyle {
  return DIFF_STYLES.some(style => style === value)
}

/**
 * Narrow one candidate to a markdown style.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether the value is a selectable markdown style.
 */
export function isMdStyle(value: unknown): value is MdStyle {
  return MD_STYLES.some(style => style === value)
}

/**
 * Narrow one candidate to a transcript layout.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether the value is a selectable transcript layout.
 */
export function isTranscriptView(value: unknown): value is TranscriptViewMode {
  return TRANSCRIPT_VIEW_MODES.some(mode => mode === value)
}

/**
 * Merge an unknown wire section over the defaults, dropping malformed fields
 * so a hand-edited user document degrades to the default rather than to a
 * broken view configuration.
 * @param raw - the raw user-layer section (or undefined when absent).
 * @returns a complete, valid settings object.
 */
export function resolveFocusSettings(raw: unknown): FocusSettings {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    diffStyle: isDiffStyle(source.diffStyle) ? source.diffStyle : DEFAULT_FOCUS_SETTINGS.diffStyle,
    mdStyle: isMdStyle(source.mdStyle) ? source.mdStyle : DEFAULT_FOCUS_SETTINGS.mdStyle,
    transcriptView: isTranscriptView(source.transcriptView)
      ? source.transcriptView
      : DEFAULT_FOCUS_SETTINGS.transcriptView,
  }
}
