import { memo } from 'react'
import { projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import css from './CommandInputRow.module.css'

/** The command whose run this node echoes (the goal plugin's own command). */
const GOAL_COMMAND = 'goal'

/**
 * A human-entered slash command echoed above its own result row (the chat
 * command-input node): a right-aligned bubble with no message actions. The
 * leading `/name` token is the executed command — decorated as a command chip
 * — while the rest of the line stays plain text, mentions included.
 */
export const CommandInputRow = memo(function CommandInputRow({ item, t }: {
  item: Extract<FocusFlowItem, { kind: 'command-input' }>
  t: FocusTranslate
}) {
  // Only the leading token is the executed command; the rest of the line is
  // the objective, where a further `/goal` is prose.
  const split = item.text.search(/\s/u)
  const head = split === -1 ? item.text : item.text.slice(0, split)
  const rest = split === -1 ? '' : item.text.slice(split)
  return (
    <div className={css.row} data-command-input="" role="group" aria-label={t('commandInput.aria')}>
      <div className={css.stack}>
        <div className={css.bubble}>
          {projectUserText(head, [], [GOAL_COMMAND], 'command')}
          {rest !== '' && projectUserText(rest, [])}
        </div>
      </div>
    </div>
  )
})
