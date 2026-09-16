/**
 * Cordis lifecycle cards: pure block → card derivation, the shared package
 * status reading, and the per-session "latest successful run card" index.
 *
 * This is the focus view's re-implementation of the ui-cordis client card
 * model (`card-model.ts` / `status.ts` / `run-card-index.ts`): the focus view
 * owns its rows and cannot register into the official `tool.call.toolview`
 * keyed slot, so the derivation lives here and the view paints the cards
 * itself. Nothing imports the ui-cordis client bundle at runtime.
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FocusCordisActionCard, FocusCordisCard, FocusCordisDefineCard, FocusCordisInventoryRow,
  FocusCordisLivePackage, FocusCordisRunCard, FocusCordisRunCardPointer, FocusCordisToolState,
  FocusCordisToolViewKey,
} from './types.ts'

/** First line of a multi-line string; the text itself when single-line. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** One non-empty string field, or null. */
function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** One object field, or null (arrays pass, as in the official derivation). */
function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

/** Parse args as a JSON object; null when truncated or not an object. */
function parseArgs(argsRaw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    // Running calls can expose a truncated JSON prefix.
    return null
  }
}

/** Flatten a settled result to display text; the structured error line when empty. */
function resultText(block: Extract<ToolCallBlock, { kind: 'tool-result' }>): string | null {
  const text = block.content
    .map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
    .join('\n')
  if (text !== '') return text
  return block.error === undefined ? null : `${block.error.name}: ${block.error.code}`
}

/** The official CordisToolState derivation (distinct from the generic row state). */
function stateOf(block: ToolCallBlock): FocusCordisToolState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/** Result metadata for a successful settled call; null while running or failed. */
function metaObject(block: ToolCallBlock): Record<string, unknown> | null {
  if (!('kind' in block) || block.isError || typeof block.meta !== 'object' || block.meta === null) return null
  return block.meta as Record<string, unknown>
}

/** The call's raw args for either lifecycle form. */
function argsRawOf(block: ToolCallBlock): string {
  return ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
}

/** Derive one Define card from its frozen call/result slice. */
export function cordisDefineCard(block: ToolCallBlock): FocusCordisDefineCard {
  const settled = 'kind' in block
  const argsRaw = argsRawOf(block)
  const args = parseArgs(argsRaw)
  const code = args === null ? null : objectAt(args, 'code')
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  const meta = metaObject(block)
  const rawName = argsRaw === '' ? null : firstLine(argsRaw)
  return {
    kind: 'define',
    pluginId: meta === null ? null : stringAt(meta, 'pluginId'),
    packageId: meta === null ? null : stringAt(meta, 'packageId'),
    name: args === null ? rawName : stringAt(args, 'name') ?? rawName,
    purpose: args === null ? null : stringAt(args, 'purpose'),
    hostCode: code === null ? null : stringAt(code, 'host'),
    clientCode: code === null ? null : stringAt(code, 'client'),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** Derive one Run card and its successful activation metadata. */
export function cordisRunCard(block: ToolCallBlock): FocusCordisRunCard {
  const settled = 'kind' in block
  const args = parseArgs(argsRawOf(block))
  const meta = metaObject(block)
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  const rawMode = args === null ? null : stringAt(args, 'mode')
  const argsPluginId = args === null ? null : stringAt(args, 'pluginId')
  const argsPackageId = args === null ? null : stringAt(args, 'packageId')
  return {
    kind: 'run',
    pluginId: meta === null ? argsPluginId : stringAt(meta, 'pluginId') ?? argsPluginId,
    packageId: meta === null ? argsPackageId : stringAt(meta, 'packageId') ?? argsPackageId,
    pluginRunId: meta === null ? null : stringAt(meta, 'pluginRunId'),
    mode: rawMode === 'run' || rawMode === 'update' ? rawMode : null,
    seq: settled ? block.seq : null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** Derive one Stop or Remove card from its frozen call/result slice. */
export function cordisActionCard(block: ToolCallBlock): FocusCordisActionCard {
  const settled = 'kind' in block
  const args = parseArgs(argsRawOf(block))
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  return {
    kind: 'action',
    pluginId: args === null ? null : stringAt(args, 'pluginId') ?? stringAt(args, 'id'),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/**
 * Derive the Cordis card for one wire tool name, or null for every other call.
 * The four names mirror the official keyed-toolview registrations; the generic
 * row tables stay untouched for them, because the card replaces the chrome.
 * @param name - wire Tool name.
 * @param block - running call or settled result node.
 * @returns the derived card, or null when the call is not a Cordis lifecycle tool.
 */
export function cordisCardOf(name: string, block: ToolCallBlock): FocusCordisCard | null {
  switch (name) {
    case 'cordis_define': return cordisDefineCard(block)
    case 'cordis_run': return cordisRunCard(block)
    case 'cordis_stop':
    case 'cordis_undefine': return cordisActionCard(block)
    default: return null
  }
}

/** Locate one immutable Package inside a Plugin row. */
function packageOf(
  row: FocusCordisInventoryRow,
  packageId: string,
): FocusCordisInventoryRow['packages'][number] | undefined {
  return row.packages.find(pkg => pkg.packageId === packageId)
}

/** The three product-visible lifecycle readings. */
export type FocusCordisVisibleStatus = 'idle' | 'client-pending' | 'running'

/**
 * Derive the visible state of one Package (the official cordisVisibleStatus).
 * @param row - owning Plugin inventory row.
 * @param packageId - Package being described.
 * @param loaded - Client activations loaded in this page.
 * @returns idle, Host-running/Client-pending, or fully running.
 */
export function cordisVisibleStatus(
  row: FocusCordisInventoryRow,
  packageId: string,
  loaded: readonly FocusCordisLivePackage[],
): FocusCordisVisibleStatus {
  const run = row.activeRun
  if (run === undefined || run.packageId !== packageId) return 'idle'
  const pkg = packageOf(row, packageId)
  if (pkg?.hasClientHalf !== true) return 'running'
  return loaded.some(live => live.pluginId === row.pluginId
    && live.packageId === packageId
    && live.pluginRunId === run.pluginRunId)
    ? 'running'
    : 'client-pending'
}

/** Build the Package business-view key shared by registrations and Run cards. */
export function cordisToolViewKey(pluginId: string, packageId: string): FocusCordisToolViewKey {
  return `${pluginId}.${packageId}`
}

/** Per-session observable index consumed by every mounted Run card. */
export interface FocusCordisRunCardStore extends HostObservable<ReadonlyMap<FocusCordisToolViewKey, FocusCordisRunCardPointer>> {
  /** Publish one successful Run result; only a greater log sequence replaces it. */
  observe(pointer: FocusCordisRunCardPointer): void
}

function createStore(): FocusCordisRunCardStore {
  const pointers = new Map<FocusCordisToolViewKey, FocusCordisRunCardPointer>()
  const listeners = new Set<() => void>()
  let cache: ReadonlyMap<FocusCordisToolViewKey, FocusCordisRunCardPointer> | undefined
  return {
    getSnapshot: () => cache ??= new Map(pointers),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    observe: (pointer) => {
      const current = pointers.get(pointer.key)
      if (current !== undefined && current.seq >= pointer.seq) return
      pointers.set(pointer.key, pointer)
      cache = undefined
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Page-lifetime registry that gives all cards of one session the same Store. */
export class CordisRunCardRegistry {
  private readonly sessions = new Map<string, FocusCordisRunCardStore>()

  /**
   * Return the persistent page-local Store for a session.
   * @param sessionId - session whose cards share supersession state.
   * @returns the page-local Store retained for that session.
   */
  forSession(sessionId: string): FocusCordisRunCardStore {
    let store = this.sessions.get(sessionId)
    if (store === undefined) {
      store = createStore()
      this.sessions.set(sessionId, store)
    }
    return store
  }
}
