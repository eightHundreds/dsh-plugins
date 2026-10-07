import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyDesktopInstall } from '../scripts/check/verify-desktop-install.mjs'

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsk-desktop-check-'))
  const profileDir = join(root, 'profile')
  const pkgDir = join(root, 'packages/demo')
  await mkdir(join(pkgDir, 'lib'), { recursive: true })
  await mkdir(join(profileDir, 'node_modules/@dsk'), { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@dsk/demo', exports: { '.': { import: './lib/index.js' }, './client': { default: './lib/client.js' } },
    dsh: { client: { platform: 'web' }, bundle: { patch: options.patchFiles ?? './cordis.patch.yml' } },
  }))
  await writeFile(join(pkgDir, 'cordis.patch.yml'), '- id: builtin\n  disabled: true\n- insert:\n    - id: demo\n      name: "@dsk/demo"\n      config: !!js process.env.SECRET\n')
  if (!options.missingHost) await writeFile(join(pkgDir, 'lib/index.js'), '')
  if (!options.missingClient) await writeFile(join(pkgDir, 'lib/client.js'), '')
  const dependencies = options.missingDependency ? {} : { '@dsk/demo': options.spec ?? `link:${pkgDir}` }
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies, dsh: { profile: { bundles: options.missingBundle ? [] : ['@dsk/demo'] } } }))
  if (!options.missingLink) await symlink(options.wrongLink ? profileDir : pkgDir, join(profileDir, 'node_modules/@dsk/demo'))
  await writeFile(join(profileDir, 'cordis.patch.yml'), options.patch ?? `- id: hmr\n  config:\n    root:\n      - ${join(pkgDir, 'lib')}\n`)
  return { root, profileDir, target: 'demo' }
}
const failed = (result, code) => result.checks.some(check => check.code === code && !check.ok)

test('valid install, exports-only host, inherited conflict disable and !!js dialect', async () => {
  const result = await verifyDesktopInstall(await fixture())
  assert.equal(result.ok, true)
  assert.equal(result.runtimeVerified, false)
})
for (const [label, options, code] of [
  ['missing dependency', { missingDependency: true }, 'dependency'],
  ['tarball dependency', { spec: 'file:demo.tgz' }, 'dependency'],
  ['missing installed link', { missingLink: true }, 'installed-link'],
  ['wrong installed link', { wrongLink: true }, 'installed-link'],
  ['missing bundle selection', { missingBundle: true }, 'bundle'],
  ['missing HMR root', { patch: '[]' }, 'hmr'],
  ['disabled HMR', { patch: '- id: hmr\n  disabled: true' }, 'hmr'],
  ['missing host output', { missingHost: true }, 'host-output'],
  ['missing client output', { missingClient: true }, 'client-output'],
  ['profile reverses conflict disable', { patch: '- id: builtin\n  disabled: false' }, 'conflict'],
  ['last conflict override wins', { patch: '- id: builtin\n  disabled: true\n- id: builtin\n  disabled: false' }, 'conflict'],
  ['malformed patch', { patch: 'config: value' }, 'input'],
  ['missing declared patch', { patchFiles: ['./cordis.patch.yml', './missing.yml'] }, 'input'],
]) {
  test(label, async () => {
    const result = await verifyDesktopInstall(await fixture(options))
    assert.equal(result.ok, false)
    assert.equal(failed(result, code), true)
  })
}
test('last HMR config replaces earlier roots', async () => {
  const context = await fixture()
  await writeFile(join(context.profileDir, 'cordis.patch.yml'), `- id: hmr\n  config:\n    root: [${join(context.root, 'packages/demo/lib')}]\n- id: hmr\n  config:\n    root: []\n`)
  assert.equal(failed(await verifyDesktopInstall(context), 'hmr'), true)
})
test('unknown and empty selections fail rather than silently pass', async () => {
  const context = await fixture({ missingDependency: true, missingBundle: true })
  assert.equal((await verifyDesktopInstall({ ...context, target: undefined })).ok, false)
  assert.equal(failed(await verifyDesktopInstall({ ...context, target: '../demo' }), 'package'), true)
})
