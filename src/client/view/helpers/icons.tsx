/** Tool-family leading icons (the chat GenericToolCard table). */
import type { ReactNode } from 'react'
import { IconApiOutline14, IconBrowseOutline16, IconChecklistOutline14, IconCodeOutline16, IconEditOutline16, IconGlobeOutline14, IconQuestionOutline14, IconSearchOutline16, IconSkillOutline16, IconSparkle16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FocusToolRow } from '../../model/types.ts'

/** Tool-family leading icons, mirroring the chat GenericToolCard table (glyphs at 14). */
export const VARIANT_ICONS: Record<'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'question' | 'todo' | 'skill' | 'others', ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  question: <IconQuestionOutline14 size={14} />,
  todo: <IconChecklistOutline14 size={14} />,
  skill: <IconSkillOutline16 size={14} />,
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
  todo_write: 'todo',
  skill: 'skill',
  write: 'write',
  edit: 'edit',
  str_replace_editor: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
  ask_user_question: 'question',
}

/** Tool name → leading-icon override (the chat WebRow's own glyphs: web_fetch
 *  keeps the browse glyph, web_search switches to the globe). */
const TOOL_ICONS: Readonly<Record<string, ReactNode>> = {
  web_fetch: <IconBrowseOutline16 size={14} />,
  web_search: <IconGlobeOutline14 size={14} />,
}

/** One call's leading glyph: the family icon, or the state dot for failures. */
export function leadingFor(row: FocusToolRow): ReactNode {
  if (row.state === 'error') return <StateDot state="error" />
  if (row.state === 'stopped') return <StateDot state="warning" />
  const override = TOOL_ICONS[row.name]
  if (override !== undefined) return <span data-tool-icon={row.name}>{override}</span>
  const variant = TOOL_VARIANTS[row.name] ?? 'others'
  return <span data-tool-icon={variant}>{VARIANT_ICONS[variant]}</span>
}

