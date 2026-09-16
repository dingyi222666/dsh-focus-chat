/**
 * The host's Cordis definition registry as this page last read it.
 *
 * The focus view's cards read frame-wide facts — whether a Plugin is still
 * defined, which Package is active — so the registry cannot be derived from
 * any one session: it is global and the read is a single global call. Rows are
 * re-read rather than patched, because the wire announcements
 * (`cordis/dynamic-package` / `/retract`) carry no labels and a definition can
 * appear or disappear between them.
 *
 * Reads are single-flight: several announcements settling at once must not
 * multiply the call. Single-flight alone would be wrong across a reconnect,
 * though — the in-flight read belongs to the previous connection, so a reset
 * discards its answer and frees the slot for a fresh one.
 *
 * This is the focus view's re-implementation of the ui-cordis inventory
 * (that plugin's own store is not importable from this bundle).
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { FocusCordisInventoryRow, FocusCordisInventorySnapshot } from './types.ts'

/** The RPC seam this store reads through (the runner's `inventory` Remote call). */
export interface FocusCordisInventoryPort {
  /** Read the frame-wide Plugin inventory. */
  inventory(): Promise<readonly FocusCordisInventoryRow[]>
}

/** Inventory source: an observable of the rows plus the read trigger. */
export interface FocusCordisInventory extends HostObservable<FocusCordisInventorySnapshot> {
  /** Read the registry unless a read is already in flight. */
  refresh(): void
  /** Drop what was read; the next refresh starts from nothing (a reconnect may be a new host). */
  reset(): void
}

/**
 * Create the inventory source.
 * @param port - the RPC seam the read goes through.
 * @param onError - reporter for a failed read (console in production, captured in specs).
 * @returns the inventory observable and its read trigger.
 */
export function createFocusCordisInventory(
  port: FocusCordisInventoryPort,
  onError: (error: unknown) => void,
): FocusCordisInventory {
  const listeners = new Set<() => void>()
  let snapshot: FocusCordisInventorySnapshot = { rows: [], removed: new Set(), read: false }
  let inFlight: Promise<void> | undefined
  // Bumped by reset; a read whose generation is stale publishes nothing.
  let generation = 0

  const publish = (next: FocusCordisInventorySnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    refresh: () => {
      if (inFlight !== undefined) return
      const issued = generation
      inFlight = port.inventory().then(
        (rows) => {
          if (issued !== generation) return
          const removed = new Set(snapshot.removed)
          const live = new Set(rows.map(row => row.pluginId))
          for (const previous of snapshot.rows) {
            if (!live.has(previous.pluginId)) removed.add(previous.pluginId)
          }
          publish({ rows, removed, read: true })
        },
        (error: unknown) => {
          if (issued !== generation) return
          onError(error)
          // A failed read keeps whatever was shown and says why: dropping the
          // rows would turn a transient wire failure into "nothing is defined".
          publish({
            rows: snapshot.rows,
            removed: snapshot.removed,
            read: snapshot.read,
            error: error instanceof Error ? error.message : 'reading the cordis inventory failed',
          })
        },
      ).then(() => { if (issued === generation) inFlight = undefined })
    },
    reset: () => {
      generation += 1
      inFlight = undefined
      publish({ rows: [], removed: snapshot.removed, read: false })
    },
  }
}
