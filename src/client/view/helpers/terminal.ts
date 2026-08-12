/** JsonBlock truncation footer and terminal-card labels bound to the focus locale. */
import type { TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'

export function jsonTruncated(t: FocusTranslate): (total: number) => string {
  return total => t('json.truncated', { total })
}

/** Card line caps the chat rows apply (design rhythm). */
export const CHAT_DIFF_MAX_LINES = 8
export const CHAT_READ_MAX_LINES = 8
export const CHAT_SEARCH_MAX_LINES = 8

/** Terminal-card labels bound to the focus locale (the chat label seam). */
export function terminalLabels(t: FocusTranslate): TerminalBlockLabels {
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('copy'),
    copied: t('copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('terminal.collapse'),
    expandAria: hidden => t('terminal.expandAria', { n: hidden }),
    expand: hidden => t('terminal.expand', { n: hidden }),
  }
}

