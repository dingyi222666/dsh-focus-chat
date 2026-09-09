/**
 * Local-media-path image resolution for markdown prose, mirroring the chat's
 * AssistantMarkdown rule: an authored absolute POSIX path in closing prose
 * rewrites to the same-origin file API (`/api/file?path=…`), so files the
 * session wrote show inline on an HTTP(S) page. Non-HTTP transports (an
 * Electron `file://` page), protocol-relative, and relative destinations
 * stay inert alt text.
 * @module dsh-focus-chat/client/view/helpers/path-images
 */

import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Map one authored media destination to the same-origin workspace-file URL.
 * @param protocol - `window.location.protocol` at render time.
 * @param origin - `window.location.origin` at render time.
 * @param value - The authored markdown destination, exactly as written.
 * @returns The API URL for an absolute POSIX path on an HTTP(S) page, or
 * undefined when the destination cannot be a Host-served local file.
 */
export function localPathMediaUrl(protocol: string, origin: string, value: string): string | undefined {
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  if (value.length === 0 || !value.startsWith('/') || value.startsWith('//')) return undefined
  return `${origin}/api/file?path=${encodeURIComponent(value)}`
}

/**
 * One reference-stable MarkdownPathImages vocabulary for the page: MarkdownText
 * memoizes on the identity, so the resolver is built once per page load and
 * reused across renders (the chat AssistantMarkdown rule).
 */
export function markdownPathImages(): MarkdownPathImages {
  const { protocol, origin } = window.location
  return { resolve: value => localPathMediaUrl(protocol, origin, value) }
}
