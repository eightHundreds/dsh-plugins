import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Lsp, { LspError, LspProviderId } from '@deepseek-ai/dsh-lsp'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import * as Pack from '../lib/index.js'

async function base() {
  const ctx = new Context()
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalFS, { cwd: process.cwd() })
  await ctx.plugin(LocalSubprocess)
  return ctx
}
const request = (workspaceRoot, operation = 'hover', line = 0, character = 18) => ({
  workspaceRoot, filePath: 'shapes.ts', operation, position: { line, character },
})

test('missing executable loads, honors custom routes, cancels and unregisters', async () => {
  const ctx = await base()
  try {
    const fiber = ctx.plugin(Pack, { command: '/nonexistent/dsk-ts-server', extensionToLanguage: { '.custom': 'typescript' } })
    await fiber
    await assert.rejects(ctx.lsp.query({ ...request(process.cwd()), filePath: 'a.custom' }), e => e instanceof LspError && e.code === 'LSP_UNAVAILABLE' && e.message.includes('/nonexistent/dsk-ts-server'))
    const reason = new Error('cancel')
    await assert.rejects(ctx.lsp.query(request(process.cwd()), AbortSignal.abort(reason)), e => e === reason)
    await fiber.dispose()
    await assert.rejects(ctx.lsp.query(request(process.cwd())), e => e.code === 'LSP_UNAVAILABLE')
  } finally { await ctx.fiber.dispose() }
})

test('official conflicts and invalid config remain errors', async () => {
  const ctx = await base()
  try {
    ctx.lsp.registerProvider({ id: LspProviderId('other'), extensionToLanguage: { '.ts': 'typescript' }, query: async () => { throw new Error('unused') } })
    await assert.rejects(Pack.apply(ctx, { command: process.execPath }), e => e.code === 'LSP_CONFLICT')
    await assert.rejects(Pack.apply(ctx, { command: '/nonexistent/dsk-ts-server', shutdownTimeoutMs: 0 }), /positive integer/)
  } finally { await ctx.fiber.dispose() }
})

test('only typed executable misses degrade; transport failures propagate', async () => {
  const ctx = await base()
  const original = ctx.subprocess.resolveExecutable
  try {
    ctx.subprocess.resolveExecutable = async () => { throw new Error('transport lost') }
    await assert.rejects(Pack.apply(ctx, {}), /transport lost/)
    ctx.subprocess.resolveExecutable = async () => { throw new SubprocessExecutableNotFoundError('missing') }
    await Pack.apply(ctx, {})
    await assert.rejects(ctx.lsp.query(request(process.cwd())), e => e.code === 'LSP_UNAVAILABLE')
  } finally {
    ctx.subprocess.resolveExecutable = original
    await ctx.fiber.dispose()
  }
})

test('real TS server: four operations, canonical sharing, two workspaces, disposal', { timeout: 120000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsk-lsp-ts-')))
  const ctx = await base()
  const handles = []
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  ctx.subprocess.spawn = spec => {
    const handle = spawn(spec)
    assert.deepEqual(spec.argv.slice(1), ['--stdio'])
    handles.push(handle)
    return handle
  }
  try {
    const source = [
      'export interface Shape { area(): number }',
      'export class Circle implements Shape { area() { return 1 } }',
      'export function describe(s: Shape): string { return String(s.area()) }',
      'const c = new Circle()',
      'export const text = describe(c)',
      '',
    ].join('\n')
    for (const ws of ['one', 'two']) {
      await mkdir(join(root, ws))
      await writeFile(join(root, ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }))
      await writeFile(join(root, ws, 'shapes.ts'), source)
    }
    await symlink(join(root, 'one'), join(root, 'alias'))
    const fiber = ctx.plugin(Pack, { command: resolve('node_modules/.bin/typescript-language-server') })
    await fiber
    assert.equal(handles.length, 0, 'load must not spawn')
    const one = join(root, 'one')
    const results = await Promise.all([
      ctx.lsp.query(request(one, 'goToDefinition', 4, 22)),
      ctx.lsp.query(request(join(root, 'alias'), 'findReferences', 2, 18)),
      ctx.lsp.query(request(one, 'goToImplementation', 0, 18)),
      ctx.lsp.query(request(one, 'hover', 3, 15)),
    ])
    assert.equal(handles.length, 1, 'same canonical workspace must spawn exactly once')
    for (const result of results.slice(0, 3)) {
      assert.equal(result.kind, 'locations')
      assert.ok(result.locations.length > 0)
      assert.ok(result.locations.every(l => l.uri.endsWith('/shapes.ts')))
    }
    assert.ok(results[1].locations.length >= 2)
    assert.match(results[3].hover.contents, /Circle/)
    await ctx.lsp.query(request(join(root, 'two'), 'hover', 3, 15))
    assert.equal(handles.length, 2)
    await fiber.dispose()
    await Promise.all(handles.map(h => h.waitForExit()))
    assert.equal(handles.length, 2, 'disposal must not restart')
    await assert.rejects(ctx.lsp.query(request(one)), e => e.code === 'LSP_UNAVAILABLE')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
