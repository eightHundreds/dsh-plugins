import { mkdir, mkdtemp, lstat, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import RtkBashExecutor from '../src/index.ts'

const contexts: Context[] = []
const workspaces: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const path of workspaces.splice(0)) {
    // Remove only this test's own physical temporary directory.
    if (!basename(path).startsWith('dsk-rtk-real-') || await realpath(path) !== path) {
      throw new Error('Refusing unexpected test cleanup path')
    }
    await rm(path, { recursive: true })
  }
})

async function setup() {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'dsk-rtk-real-')))
  workspaces.push(workspace)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: workspace })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.registry.plugin(RtkBashExecutor, { cwd: workspace, timeoutMs: 5_000, graceMs: 200 })
  return { ctx, workspace }
}

// macOS exercises the actual built-in Seatbelt backend. Other platforms still
// run portable fake-backend lifecycle tests; this suite makes no claim for them.
describe.skipIf(process.platform !== 'darwin')('published SDK real macOS sandbox', () => {
  it('denies a real write without creating the target', async () => {
    const { ctx, workspace } = await setup()
    const target = join(workspace, 'must-not-exist.txt')
    const ex = await ctx.shell.execute(ctx.shell.resolve({ command: 'printf denied > must-not-exist.txt' }))
    const result = await ex.result()
    expect(result.exitCode).not.toBe(0)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('permits workspace writes but rejects writes outside the workspace', async () => {
    const { ctx, workspace } = await setup()
    // The official workspace-write policy also allows host temp roots.
    // Use this repository's ignored artifacts directory, not os.tmpdir().
    const artifacts = join(process.cwd(), '../../artifacts')
    await mkdir(artifacts, { recursive: true })
    const outside = await realpath(await mkdtemp(join(artifacts, 'dsk-rtk-real-')))
    workspaces.push(outside)
    const sandboxPolicy = { mode: 'workspace-write' as const, workspaceRoot: workspace }
    const allowed = await (await ctx.shell.execute(ctx.shell.resolve({
      command: 'printf allowed > allowed.txt', sandboxPolicy,
    }))).result()
    expect(allowed.exitCode).toBe(0)
    expect(allowed.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(await readFile(join(workspace, 'allowed.txt'), 'utf8')).toBe('allowed')
    const target = join(outside, 'must-not-exist.txt')
    const denied = await (await ctx.shell.execute(ctx.shell.resolve({
      command: `printf denied > '${target}'`, sandboxPolicy,
    }))).result()
    expect(denied.exitCode).not.toBe(0)
    expect(denied.sandbox).toEqual({ mode: 'workspace-write', denied: true, enforcement: 'full' })
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(spawnSync('rtk', ['--version'], { timeout: 2_000, killSignal: 'SIGKILL', stdio: 'ignore' }).status !== 0)(
    'executes a real RTK-transformed command with the default activation probe', async () => {
      const { ctx } = await setup()
      const spec = ctx.shell.resolve({ command: 'ls -al' })
      expect(spec.command).toBe('rtk ls -al')
      const result = await (await ctx.shell.execute(spec)).result()
      expect(result.exitCode).toBe(0)
      expect(result.stdout.text).toMatch(/\[rtk: rtk ls -al\]/u)
      expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
    },
  )
})
