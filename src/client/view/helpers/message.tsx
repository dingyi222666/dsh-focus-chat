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
