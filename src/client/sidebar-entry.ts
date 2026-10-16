/**
 * The market's own row in the sidebar (#846), beside the host's Plugins page.
 *
 * Off by default: the sidebar's global rows are the host's own pages, and
 * installing plugins is occasional, so the row is something a user turns on
 * in the market's settings card. The settings entry stays either way.
 *
 * Two facts decide whether the row exists, and they arrive independently:
 * whether the host declares `sidebar.panellist` at all (hosts before the
 * Plugins page moved to the sidebar do not), and what the user chose, which
 * is read from the server. The section gate already owns that ordering
 * problem for the settings entry; this reuses it with the opposite default.
 *
 * Opening the row selects a `main` panel, so the market renders as a page —
 * the only one-click destination the host's public contracts allow. A
 * settings-dialog shortcut is not possible: the dialog's state is private
 * to the host's settings shell.
 */

import { api } from './market-data.ts'
import type { SectionGate } from './section-gate.ts'

/** The `main` key and `sidebar.panellist` id this package registers. */
export const SIDEBAR_PANEL_ID = 'dsh-market'

/**
 * Directly below the host's Plugins row (order 0) and above Scheduled tasks
 * (order 10): the market is where plugins come from, so it sits next to
 * where they are managed.
 */
export const SIDEBAR_PANEL_ORDER = 1

export interface SidebarEntry {
  /** The host declares sidebar panels, so the switch can do something. */
  supported(): boolean
  /** The user's choice as last confirmed by the server. */
  enabled(): boolean
  /**
   * The initial `load()` finished (ok, refused, or failed). Until then
   * `enabled()` is still the default off, and must not be treated as a
   * confirmed choice — the settings tip would otherwise flash for users
   * who already turned the row on.
   */
  ready(): boolean
  /**
   * Persist the choice, then show or hide the row.
   * @returns the value the server accepted.
   */
  set(enabled: boolean): Promise<boolean>
  /** Re-render hook for the settings card. */
  subscribe(listener: () => void): () => void
  /** The slot exists: the gate may register now. */
  markSupported(): void
  /** Read the saved choice once at page load. */
  load(): Promise<void>
}

interface Deps {
  gate: SectionGate
  fetch: typeof globalThis.fetch
}

export function createSidebarEntry({ gate, fetch }: Deps): SidebarEntry {
  let supported = false
  let enabled = false
  let ready = false
  /** Bumped by every `set` so a slow initial `load` cannot overwrite it. */
  let epoch = 0
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  const accept = (next: boolean): void => {
    enabled = next
    gate.setVisible(next)
    notify()
  }

  const settle = (): void => {
    if (ready) return
    ready = true
    notify()
  }

  return {
    supported: () => supported,
    enabled: () => enabled,
    ready: () => ready,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    markSupported: () => {
      supported = true
      gate.available()
      notify()
    },
    load: async () => {
      const at = epoch
      try {
        const response = await fetch(api('/dsh-market/sidebar-entry'), { cache: 'no-store' })
        if (response.ok) {
          const body = (await response.json()) as { enabled?: unknown }
          // A POST that finished while we were in flight already owns the row.
          if (at === epoch) accept(body.enabled === true)
        }
      } catch {
        // No answer means no row: the default is off, and the settings
        // entry is still there.
      } finally {
        settle()
      }
    },
    set: async (next) => {
      const at = ++epoch
      const response = await fetch(api('/dsh-market/sidebar-entry'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      let body: { ok?: boolean; enabled?: unknown; error?: string }
      try {
        body = (await response.json()) as { ok?: boolean; enabled?: unknown; error?: string }
      } catch {
        throw new Error(`sidebar entry: HTTP ${response.status}`)
      }
      if (body.ok !== true || typeof body.enabled !== 'boolean') {
        throw new Error(body.error ?? `sidebar entry: HTTP ${response.status}`)
      }
      // A newer set() started after we did — let that one paint.
      if (at === epoch) accept(body.enabled)
      // A choice the user just made is as settled as a finished load.
      settle()
      return body.enabled
    },
  }
}
