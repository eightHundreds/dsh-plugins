import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('the published web client exposes the supported lazy factory envelope', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.exports['./client'].import, undefined)
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  let registration
  // No document, React, or Cordis exists here: loading must register only,
  // without executing browser-only module bodies or plugin effects.
  vm.runInNewContext(bundle, {
    window: { __ModuleLoader__: { load(value) {
      assert.equal(registration, undefined)
      registration = value
    } } },
  })
  assert.equal(registration.id, manifest.name)
  assert.equal(typeof registration.factory, 'function')
  const requests = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1])
  assert(requests.length > 0)
  const baseline = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
  for (const request of requests) assert(baseline.includes(request), request)
})

test('the released client payload does not depend on locally patched DSH capabilities', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  for (const token of ['shell.sidechat', 'setSideChatOpen', 'onComposerFocusReady', 'focusPolicy']) {
    assert.equal(bundle.includes(token), false, token)
  }
  assert.doesNotMatch(bundle, /pendingInbox\s*:\s*["']discard/)
  assert.doesNotMatch(bundle, /\/Users\//)
  const config = JSON.parse(await readFile(new URL('tsconfig.json', root), 'utf8'))
  assert.equal(config.extends, '../../tsconfig.base.json')
  assert.equal(config.compilerOptions.paths, undefined)
})
