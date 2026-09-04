/** User message text projection (the chat bubble join and reference chips). */
import type { ReactNode } from 'react'
import type { FocusTranslate } from '../../contract/props.ts'
import css from '../rows/UserBubble.module.css'

export function messageText(content: readonly { type?: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('')
}

/** One literal plain-run segment (the chat bubble's pre-wrap text face). */
function plainRun(text: string, key: number): ReactNode {
  return <span key={key} className={css.plainRun}>{text}</span>
}

/**
 * Display projection of reference forms in a user bubble: `/name` / `@name`
 * word-boundary tokens decorate as chips, everything else stays plain text
 * (the chat bubble's projection — sent tokens were validated at compose time,
 * so shape alone decorates).
 */
export function projectUserText(text: string): ReactNode {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const label = m[2] ?? ''
    if (tokenStart > cursor) parts.push(plainRun(text.slice(cursor, tokenStart), cursor))
    parts.push(
      <span key={tokenStart} className={css.refChip} data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}>
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return plainRun(text, 0)
  if (cursor < text.length) parts.push(plainRun(text.slice(cursor), cursor))
  return <>{parts}</>
}
