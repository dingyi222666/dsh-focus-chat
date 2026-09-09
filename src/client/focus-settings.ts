/**
 * Host-backed focus-view preferences policy: the live diff-style and
 * markdown-style preferences consumed by the focus view and its Settings
 * rows. Mirrors the ui-chat transcript-view policy shape: the scope's
 * accepted section drives the snapshot stores; explicit user choices persist
 * through the same scope.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_FOCUS_SETTINGS,
  type DiffStyle, type FocusSettings, type MdStyle,
} from '../settings.ts'

/** Live focus-view preferences consumed by the view and its Settings rows. */
export class FocusSettingsPolicy {
  /** Reactive diff renderer; defaults to the official DiffBlock. */
  readonly diffStyle: SnapshotStore<DiffStyle> = createSnapshotStore(DEFAULT_FOCUS_SETTINGS.diffStyle)
  /** Reactive markdown inline-code rendering; defaults to the official box. */
  readonly mdStyle: SnapshotStore<MdStyle> = createSnapshotStore(DEFAULT_FOCUS_SETTINGS.mdStyle)

  /**
   * @param host - durable focus settings scope.
   */
  constructor(private readonly host: SettingsScope<FocusSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist the diff renderer choice.
   * @param style - Default or codex changes-bar diff rendering.
   */
  setDiffStyle(style: DiffStyle): void {
    if (this.diffStyle.getSnapshot() === style) return
    this.diffStyle.set(style)
    void this.host.set('diffStyle', style)
  }

  /**
   * Publish and persist the markdown inline-code rendering choice.
   * @param style - Default or highlight inline-code rendering.
   */
  setMdStyle(style: MdStyle): void {
    if (this.mdStyle.getSnapshot() === style) return
    this.mdStyle.set(style)
    void this.host.set('mdStyle', style)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    if (this.diffStyle.getSnapshot() !== section.diffStyle) this.diffStyle.set(section.diffStyle)
    if (this.mdStyle.getSnapshot() !== section.mdStyle) this.mdStyle.set(section.mdStyle)
  }
}
