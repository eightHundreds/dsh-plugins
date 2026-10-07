import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { collectOfficialEntryIds } from '../scripts/scaffold/official-entry-ids.mjs'

const script = resolve(import.meta.dirname, '../scripts/scaffold/new-plugin.mjs')

async function fixtureRoot() {
  const dir = await mkdtemp(resolve(tmpdir(), 'dsh-plugin-generator-'))
  const harness = resolve(dir, 'harness')
  await mkdir(resolve(dir, 'packages'))
  await mkdir(resolve(harness, 'packages/bundle/base'), { recursive: true })
  await cp(new URL('../packages/hello', import.meta.url), resolve(dir, 'packages/hello'), { recursive: true })
  await writeFile(
    resolve(harness, 'packages/bundle/base/cordis.patch.yml'),
    [
      '- insert:',
      '    - id: session-title',
      "      name: '@deepseek-ai/dsh-session-title'",
      '    - id: bash-sandbox',
      "      name: '@deepseek-ai/dsh-bash-sandbox'",
      '',
    ].join('\n'),
  )
  return { dir, harness }
}

function run(dir, harness, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_PLUGIN_ROOT: dir, DSH_HARNESS: harness },
  })
}

test('collects official insert and override ids from bundle patches', () => {
  const ids = collectOfficialEntryIds([
    [
      {
        insert: [
          { id: 'session-title', name: '@deepseek-ai/dsh-session-title' },
        ],
      },
      { id: 'session-title-llm', name: '@deepseek-ai/dsh-session-title-first-prompt-llm', disabled: true },
    ],
  ])
  assert.deepEqual([...ids].sort(), ['session-title', 'session-title-llm'])
})

test('generator creates a valid standalone package and refuses overwrite/traversal', async () => {
  const { dir, harness } = await fixtureRoot()
  try {
    const generated = run(dir, harness, 'test-feature')
    assert.equal(generated.status, 0, generated.stderr)
    const manifest = JSON.parse(await readFile(resolve(dir, 'packages/test-feature/package.json'), 'utf8'))
    assert.equal(manifest.name, '@dshx/test-feature')
    const source = await readFile(resolve(dir, 'packages/test-feature/src/index.ts'), 'utf8')
    assert(source.includes("name = 'test-feature'"))
    const tsdownConfig = await readFile(resolve(dir, 'packages/test-feature/tsdown.config.ts'), 'utf8')
    assert(tsdownConfig.includes('entry: { index: \'src/index.ts\' }'))
    const testFile = await readFile(resolve(dir, 'packages/test-feature/tests/index.test.mjs'), 'utf8')
    assert(testFile.includes('test-feature plugin lifecycle'))
    assert.notEqual(run(dir, harness, 'test-feature').status, 0, 'Existing package must not be overwritten')
    assert.notEqual(run(dir, harness, '../escape').status, 0, 'Path traversal must be refused')
    assert.equal(await readFile(resolve(dir, 'packages/test-feature/src/index.ts'), 'utf8'), source)
  } finally {
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})

test('generator creates a valid UI package with --ui flag', async () => {
  const { dir, harness } = await fixtureRoot()
  try {
    const generated = run(dir, harness, 'test-ui-plugin', '--ui')
    assert.equal(generated.status, 0, generated.stderr)
    const manifest = JSON.parse(await readFile(resolve(dir, 'packages/test-ui-plugin/package.json'), 'utf8'))
    assert.equal(manifest.name, '@dshx/test-ui-plugin')
    assert.equal(manifest.exports['./client'].default, './lib/client.js')
    assert.equal(manifest.dsh?.client?.platform, 'web')
    const clientSource = await readFile(resolve(dir, 'packages/test-ui-plugin/src/client/index.tsx'), 'utf8')
    assert(clientSource.includes("name = 'test-ui-plugin'"))
    assert(clientSource.includes("styles.module.css"))
    const tsdownConfig = await readFile(resolve(dir, 'packages/test-ui-plugin/tsdown.config.ts'), 'utf8')
    assert(tsdownConfig.includes('entryFileNames: \'client.js\''))
    assert(tsdownConfig.includes('dshCssAssetBridge'))
    const cssFile = await readFile(resolve(dir, 'packages/test-ui-plugin/src/client/styles.module.css'), 'utf8')
    assert(cssFile.includes('.container'))
  } finally {
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})

test('generator refuses a slug that matches an official DSH entry id', async () => {
  const { dir, harness } = await fixtureRoot()
  try {
    const generated = run(dir, harness, 'session-title')
    assert.notEqual(generated.status, 0)
    assert.match(generated.stderr, /official/)
    assert.match(generated.stderr, /session-title/)
    await assert.rejects(readFile(resolve(dir, 'packages/session-title/package.json'), 'utf8'))
  } finally {
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})

test('generator refuses to create a package when official ids cannot be loaded', async () => {
  const { dir } = await fixtureRoot()
  try {
    const generated = run(dir, resolve(dir, 'missing-harness'), 'test-feature')
    assert.notEqual(generated.status, 0)
    assert.match(generated.stderr, /Official DSH checkout not found|No official bundle patches/)
    await assert.rejects(readFile(resolve(dir, 'packages/test-feature/package.json'), 'utf8'))
  } finally {
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})

test('verify-packages catches invalid icon contracts and missing test scripts', async () => {
  const verifyScript = resolve(import.meta.dirname, '../scripts/check/verify-packages.mjs')
  const { dir, harness } = await fixtureRoot()
  try {
    // Scaffold valid package
    const generated = run(dir, harness, 'check-target')
    assert.equal(generated.status, 0)
    const pkgDir = resolve(dir, 'packages/check-target')
    await mkdir(resolve(pkgDir, 'lib'), { recursive: true })
    await writeFile(resolve(pkgDir, 'lib/index.js'), 'export {}\n')
    await writeFile(resolve(pkgDir, 'lib/index.d.ts'), 'export {}\n')
    const pkgJsonPath = resolve(pkgDir, 'package.json')
    const raw = JSON.parse(await readFile(pkgJsonPath, 'utf8'))

    // 1. Missing test script fails verification
    delete raw.scripts.test
    await writeFile(pkgJsonPath, JSON.stringify(raw, null, 2))
    let res = spawnSync(process.execPath, [verifyScript], { cwd: dir, encoding: 'utf8', env: { ...process.env, DSH_PLUGIN_ROOT: dir } })
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /must declare a "test" script/)

    // Restore test script
    raw.scripts.test = 'node --test'

    // 2. Icon missing export fails verification
    raw.icon = './icon.png'
    raw.files = ['lib', 'cordis.patch.yml', 'icon.png']
    await writeFile(resolve(dir, 'packages/check-target/icon.png'), Buffer.alloc(10))
    await writeFile(pkgJsonPath, JSON.stringify(raw, null, 2))
    res = spawnSync(process.execPath, [verifyScript], { cwd: dir, encoding: 'utf8', env: { ...process.env, DSH_PLUGIN_ROOT: dir } })
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /must explicitly export the icon/)

    // 3. Icon exceeding size limit fails verification
    raw.exports['./icon.png'] = './icon.png'
    await writeFile(resolve(dir, 'packages/check-target/icon.png'), Buffer.alloc(300 * 1024))
    await writeFile(pkgJsonPath, JSON.stringify(raw, null, 2))
    res = spawnSync(process.execPath, [verifyScript], { cwd: dir, encoding: 'utf8', env: { ...process.env, DSH_PLUGIN_ROOT: dir } })
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /exceeds 256 KiB limit/)
  } finally {
    assert(dir.startsWith(resolve(tmpdir(), 'dsh-plugin-generator-')))
    await rm(dir, { recursive: true, force: true })
  }
})
