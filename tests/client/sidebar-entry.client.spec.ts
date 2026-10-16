/**
 * The opt-in sidebar row (#846): what reaches the gate, and when.
 *
 * The row exists only when the host has sidebar panels AND the user turned
 * it on. Those two facts arrive in either order — the slot may appear before
 * or after the saved choice is read — and a failed save must leave the row
 * exactly as it was.
 */

import { describe, expect, it, vi } from 'vitest'
import { createSectionGate } from '../../src/client/section-gate.ts'
import { createSidebarEntry } from '../../src/client/sidebar-entry.ts'

function harness(answer: (init?: RequestInit) => { status?: number; body: unknown }) {
  let live = 0
  const gate = createSectionGate(() => {
    live += 1
    return () => { live -= 1 }
  }, false)
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const { status = 200, body } = answer(init)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  const entry = createSidebarEntry({ gate, fetch })
  return { entry, calls, live: () => live }
}

describe('createSidebarEntry', () => {
  it('registers nothing for a user who never turned it on', async () => {
    const { entry, live } = harness(() => ({ body: { enabled: false } }))
    entry.markSupported()
    await entry.load()
    expect(entry.enabled()).toBe(false)
    expect(live()).toBe(0)
  })

  it('shows the row when the saved choice arrives before the slot', async () => {
    const { entry, live } = harness(() => ({ body: { enabled: true } }))
    await entry.load()
    expect(live()).toBe(0)
    entry.markSupported()
    expect(live()).toBe(1)
  })

  it('shows the row when the slot arrives before the saved choice', async () => {
    const { entry, live } = harness(() => ({ body: { enabled: true } }))
    entry.markSupported()
    expect(live()).toBe(0)
    await entry.load()
    expect(live()).toBe(1)
  })

  it('treats an unreadable answer as off', async () => {
    const { entry, live } = harness(() => ({ status: 500, body: { error: 'boom' } }))
    entry.markSupported()
    await entry.load()
    expect(entry.enabled()).toBe(false)
    expect(live()).toBe(0)
  })

  it('posts the choice and applies what the server accepted', async () => {
    const { entry, calls, live } = harness(init => (init?.method === 'POST'
      ? { body: { ok: true, enabled: true } }
      : { body: { enabled: false } }))
    entry.markSupported()
    const seen = vi.fn()
    entry.subscribe(seen)
    await expect(entry.set(true)).resolves.toBe(true)
    expect(calls.at(-1)?.url).toMatch(/\/dsh-market\/sidebar-entry$/)
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ enabled: true })
    expect(entry.enabled()).toBe(true)
    expect(live()).toBe(1)
    expect(seen).toHaveBeenCalled()
  })

  it('leaves the row as it was when the save is refused', async () => {
    const { entry, live } = harness(init => (init?.method === 'POST'
      ? { status: 403, body: { error: 'untrusted origin' } }
      : { body: { enabled: true } }))
    entry.markSupported()
    await entry.load()
    await expect(entry.set(false)).rejects.toThrow('untrusted origin')
    expect(entry.enabled()).toBe(true)
    expect(live()).toBe(1)
  })

  it('reports support only once the host declares the slot', () => {
    const { entry } = harness(() => ({ body: { enabled: false } }))
    expect(entry.supported()).toBe(false)
    entry.markSupported()
    expect(entry.supported()).toBe(true)
  })

  it('is not ready until load settles, success or failure', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetch = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify({ enabled: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const entry = createSidebarEntry({
      gate: createSectionGate(() => () => {}, false),
      fetch,
    })
    expect(entry.ready()).toBe(false)
    const loading = entry.load()
    expect(entry.ready()).toBe(false)
    release()
    await loading
    expect(entry.ready()).toBe(true)
    expect(entry.enabled()).toBe(true)

    const failed = createSidebarEntry({
      gate: createSectionGate(() => () => {}, false),
      fetch: vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof globalThis.fetch,
    })
    await failed.load()
    expect(failed.ready()).toBe(true)
    expect(failed.enabled()).toBe(false)
  })

  it('does not let a slow load overwrite a choice the user just saved', async () => {
    let releaseLoad!: () => void
    const loadGate = new Promise<void>(resolve => { releaseLoad = resolve })
    let live = 0
    const gate = createSectionGate(() => {
      live += 1
      return () => { live -= 1 }
    }, false)
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        return new Response(JSON.stringify({ ok: true, enabled: true }), { status: 200 })
      }
      await loadGate
      return new Response(JSON.stringify({ enabled: false }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const entry = createSidebarEntry({ gate, fetch })
    entry.markSupported()
    const loading = entry.load()
    await expect(entry.set(true)).resolves.toBe(true)
    expect(entry.enabled()).toBe(true)
    expect(live).toBe(1)
    releaseLoad()
    await loading
    expect(entry.enabled()).toBe(true)
    expect(live).toBe(1)
  })
})
