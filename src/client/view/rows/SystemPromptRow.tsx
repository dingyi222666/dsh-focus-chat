import { memo, useState } from 'react'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './SystemPromptRow.module.css'

/**
 * One complete system prompt as a collapsed disclosure (the official
 * SystemPromptRow chrome: browse icon, "System prompt" title, and an
 * expanded body holding the full model-visible prompt text with its real
 * line breaks). An in-history prompt update renders under its own title
 * ("System prompt update"), mirroring the chat's system-message surface.
 */
export const SystemPromptRow = memo(function SystemPromptRow({ text, update = false, t }: {
  /** Complete model-visible prompt text. */
  text: string
  /** True when this prompt replaced an earlier one at its history position. */
  update?: boolean
  t: FocusTranslate
}) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      className={css.root}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t(update ? 'systemPromptUpdate' : 'systemPrompt')}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-system-prompt-body>
        <pre className={css.text} data-context-text>{text}</pre>
      </div>
    </DisclosureRow>
  )
})
