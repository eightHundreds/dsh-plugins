import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

test('generator creates a valid standalone package and refuses overwrite/traversal', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'dsh-plugin-generator-'))
  try {
    await mkdir(resolve(dir, 'scripts'))
    await mkdir(resolve(dir, 'packages'))
    await cp(new URL('../scripts/new-plugin.mjs', import.meta.url), resolve(dir, 'scripts/new-plugin.mjs'))
    await cp(new URL('../packages/hello', import.meta.url), resolve(dir, 'packages/hello'), { recursive: true })
    const run = (slug) => spawnSync(process.execPath, [resolve(dir, 'scripts/new-plugin.mjs'), slug], { encoding: 'utf8' })
    const generated = run('test-feature')
    assert.equal(generated.status, 0, generated.stderr)
    const manifest = JSON.parse(await readFile(resolve(dir, 'packages/test-feature/package.json'), 'utf8'))
    assert.equal(manifest.name, '@dsk/test-feature')
    const source = await readFile(resolve(dir, 'packages/test-feature/src/index.ts'), 'utf8')
    assert(source.includes("name = 'test-feature'"))
    assert.notEqual(run('test-feature').status, 0, 'Existing package must not be overwritten')
    assert.notEqual(run('../escape').status, 0, 'Path traversal must be refused')
    assert.equal(await readFile(resolve(dir, 'packages/test-feature/src/index.ts'), 'utf8'), source)
  } finally {
    // Only remove the verified mkdtemp-created test fixture, never user packages.
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})
