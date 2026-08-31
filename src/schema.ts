/**
 * Schemastery wire schema for the `dsh-focus-chat` settings namespace.
 * Host-half only: the browser scope validates against the serialized wire
 * schema served by the Host, never this module.
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_FOCUS_SETTINGS, DIFF_STYLES, MD_STYLES, type FocusSettings } from './settings.ts'

/** Durable focus-view preferences schema shared by the settings seam. */
export const FocusSettingsSchema: z<FocusSettings> = z.object({
  diffStyle: z.union([...DIFF_STYLES]).default(DEFAULT_FOCUS_SETTINGS.diffStyle),
  mdStyle: z.union([...MD_STYLES]).default(DEFAULT_FOCUS_SETTINGS.mdStyle),
})
