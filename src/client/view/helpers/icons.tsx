/** Tool-family leading icons (the chat GenericToolCard table). */
import type { ReactNode } from 'react'
import { IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16, IconQuestionOutline14, IconSearchOutline16, IconSparkle16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusToolRow } from '../../model/types.ts'

/** Tool-family leading icons, mirroring the chat GenericToolCard table (glyphs at 14). */
export const VARIANT_ICONS: Record<'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'question' | 'others', ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  question: <IconQuestionOutline14 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Tool name → leading-icon family (mirrors the chat row classification). */
export const TOOL_VARIANTS: Readonly<Record<string, keyof typeof VARIANT_ICONS>> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  str_replace_editor: 'edit',
  run_code: 'code',
  cordis_inspect: 'read',
  cordis_inspect_list: 'read',
  cordis_inspect_query: 'read',
  cordis_inspect_self: 'read',
  cordis_define: 'code',
  cordis_run: 'code',
  cordis_stop: 'code',
  cordis_undefine: 'code',
  cordis_mount: 'code',
  ask_user_question: 'question',
}

/** One call's leading glyph: the family icon, or the state dot for failures. */
export function leadingFor(row: FocusToolRow): ReactNode {
  if (row.state === 'error') return <StateDot state="error" />
  if (row.state === 'stopped') return <StateDot state="warning" />
  const variant = TOOL_VARIANTS[row.name] ?? 'others'
  return <span data-tool-icon={variant}>{VARIANT_ICONS[variant]}</span>
}

