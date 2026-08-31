/** JsonBlock truncation footer and card-primitive label sets bound to the focus locale. */
import type {
  DiffBlockLabels, MarkdownLabels, ReadBlockLabels, SearchBlockLabels, TerminalBlockLabels,
  WebBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'

export function jsonTruncated(t: FocusTranslate): (total: number) => string {
  return total => t('json.truncated', { total })
}

/** Card line caps the chat rows apply (design rhythm). */
export const CHAT_DIFF_MAX_LINES = 8
export const CHAT_READ_MAX_LINES = 8
export const CHAT_SEARCH_MAX_LINES = 8

/** Markdown chrome for the primitive's document renderer (code fences + footnotes). */
export function markdownLabels(t: FocusTranslate): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

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

/** Diff-card labels bound to the focus locale. */
export function diffLabels(t: FocusTranslate): DiffBlockLabels {
  return {
    copy: t('copy'),
    copied: t('copied'),
    collapseAria: t('diff.collapseAria'),
    expandAria: count => t('diff.expandAria', { count }),
    collapse: t('terminal.collapse'),
    expand: hidden => t('terminal.expand', { n: hidden }),
    files: count => t('diff.files', { count }),
  }
}

/** Context-collapse chrome for the changes-bar diff (unchanged-run separators). */
export function changesBarExpandLabels(t: FocusTranslate): {
  unchangedLines: (count: number) => string
  expandUp: string
  expandDown: string
  expandBoth: string
} {
  return {
    unchangedLines: count => t('diff.unchanged', { count }),
    expandUp: t('diff.expandUp'),
    expandDown: t('diff.expandDown'),
    expandBoth: t('diff.expandBoth'),
  }
}

/** Read-card labels bound to the focus locale. */
export function readLabels(t: FocusTranslate): ReadBlockLabels {
  return {
    window: (shown, total) => t('read.window', { shown, total }),
    copy: t('copy'),
    copied: t('copied'),
    collapseAria: t('read.collapseAria'),
    expandAria: count => t('read.expandAria', { count }),
    collapse: t('terminal.collapse'),
    expand: hidden => t('terminal.expand', { n: hidden }),
  }
}

/** Search-card labels bound to the focus locale. */
export function searchLabels(t: FocusTranslate): SearchBlockLabels {
  return {
    pathsSummary: (shown, total, truncated) => truncated
      ? t('search.paths.truncated', { shown, total })
      : t('search.paths', { shown }),
    matchesSummary: (shown, total, files, truncated) => truncated
      ? t('search.matches.truncated', { shown, total, files })
      : t('search.matches', { shown, files }),
    copy: t('copy'),
    copied: t('copied'),
    noResults: t('search.noResults'),
    collapseAria: t('search.collapseAria'),
    expandAria: count => t('search.expandAria', { count }),
    collapse: t('terminal.collapse'),
    expand: hidden => t('terminal.expand', { n: hidden }),
  }
}

/** Web-card labels bound to the focus locale. */
export function webLabels(t: FocusTranslate): WebBlockLabels {
  return {
    noResults: t('web.noResults'),
    sourcesTruncated: t('web.sourcesTruncated'),
    http: t('web.http'),
    contentTruncated: t('web.contentTruncated'),
    markdown: markdownLabels(t),
  }
}

