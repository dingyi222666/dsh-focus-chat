import { memo, useState } from 'react'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './SystemPromptRow.module.css'

/**
 * One complete system prompt as a collapsed disclosure (the official
 * SystemPromptRow chrome: browse icon, "System prompt" title, and an
 * expanded body holding the full model-visible prompt text with its real
 * line breaks).
 */
export const SystemPromptRow = memo(function SystemPromptRow({ text, t }: {
  /** Complete model-visible prompt text. */
  text: string
  t: FocusTranslate
}) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      className={css.root}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t('systemPrompt')}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-system-prompt-body>
        <pre className={css.text}>{text}</pre>
      </div>
    </DisclosureRow>
  )
})
