/**
 * Prefix proxy / outbound HTTP. Everything here exists because the market's
 * networking is deliberately private — see src/net.ts.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseHostUndiciDispatcher } from '../src/net.ts'

const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
// Importing the module under test in a child needs Node's own TypeScript
// support, which is on by default from 22.18.
const stripsTypes = major > 22 || (major === 22 && minor >= 18)

describe('the market leaves the host its own dispatcher (#861)', () => {
  it('releases only the copy its own import installed', () => {
    // Two classes stand in for the market's undici 7 and a foreign one: the
    // rule is identity against OUR Agent, so another copy's dispatcher — a
    // host's, or a second market's — is never written over.
    class Ours {}
    class Theirs {}
    const symbol = Symbol.for('undici.globalDispatcher.2')

    const ours: Record<symbol, unknown> = { [symbol]: new Ours() }
    releaseHostUndiciDispatcher(ours, Ours)
    expect(ours[symbol]).toBeUndefined()

    const foreign = new Theirs()
    const theirs: Record<symbol, unknown> = { [symbol]: foreign }
    releaseHostUndiciDispatcher(theirs, Ours)
    expect(theirs[symbol]).toBe(foreign)
  })

  it.skipIf(!stripsTypes)('importing the module leaves the other major\'s symbol unset, and Node\'s fetch workable', () => {
    // A fresh process, because the symbols are process-wide and undici only
    // installs on import: in a reused one, `.2` is already decided and the
    // assertion would pass whatever this module does.
    const script = `
      const legacy = Symbol.for('undici.globalDispatcher.1')
      const v8 = Symbol.for('undici.globalDispatcher.2')
      const before = { legacy: globalThis[legacy], v8: globalThis[v8] }
      await import(${JSON.stringify(join(import.meta.dirname, '..', 'src', 'net.ts'))})
      const { Agent } = await import('undici')
      process.stdout.write(JSON.stringify({
        cleanStart: before.legacy === undefined && before.v8 === undefined,
        // undici 8 reads .2 and installs its own when it finds it unset.
        v8Free: !(globalThis[v8] instanceof Agent),
        v8Unset: globalThis[v8] === undefined,
        // Node's built-in fetch reads .1 and asserts it is set, so this one
        // has to stay: clearing it broke global fetch outright in measurement.
        legacySet: globalThis[legacy] !== undefined,
      }))
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    const seen = JSON.parse(result.stdout) as Record<string, boolean>
    // If this is false the run proves nothing, so it fails rather than passes
    // vacuously: something in the process had already claimed a symbol.
    expect(seen.cleanStart).toBe(true)
    expect(seen.v8Unset).toBe(true)
    expect(seen.v8Free).toBe(true)
    expect(seen.legacySet).toBe(true)
  })
})
