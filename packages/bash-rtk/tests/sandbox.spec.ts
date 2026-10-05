import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import RtkBashExecutor from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(mode: SandboxMode = 'read-only', failure?: Error) {
  const calls: { argv: string[]; policy: SandboxPolicy; signal: AbortSignal | undefined }[] = []
  // This FAKE provider does not enforce an OS sandbox. Its reported enforcement
  // and denial dialect are fixture data, not evidence of real confinement.
  class FakeSandboxProvider extends SandboxProvider {
    async confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
      calls.push({ argv: [...argv], policy, signal })
      if (failure) throw failure
      let prepared = [...argv]
      if (argv[2]?.startsWith('rtk ')) {
        // Capture transformed source, then run a harmless stub. No RTK binary
        // or real git checkout is required by this provider-seam test suite.
        if (!['rtk git --version', 'rtk git status'].includes(argv[2])) {
          throw new Error('unexpected RTK fixture command')
        }
        prepared = ['bash', '-c', 'printf fixture-rtk']
      }
      return {
        argv: prepared, enforcement: 'full',
        denialSignatures: ['fixture permission denied'], runnerFailureRules: [],
      }
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.registry.plugin(RtkBashExecutor, { rtkAvailable: true, graceMs: 40 })
  return { ctx, calls }
}

describe('RTK inherits official sandbox execution (fake provider only)', () => {
  it('hands the transformed command to confinement before spawning the stub', async () => {
    const { ctx, calls } = await setup()
    expect(ctx.shell).toBeInstanceOf(SandboxBashExecutor)
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'git --version' }))
    expect((await execution.result()).stdout.text).toBe('fixture-rtk')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'rtk git --version'])
    expect(calls[0]?.policy).toEqual({ mode: 'read-only', workspaceRoot: resolve(process.cwd()) })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('retains caller policy instead of the deployment fallback', async () => {
    const { ctx, calls } = await setup()
    const sandboxPolicy = { mode: 'workspace-write' as const, workspaceRoot: '/caller-workspace' }
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'git status', sandboxPolicy }))
    const result = await execution.result()
    expect(calls[0]?.policy).toEqual(sandboxPolicy)
    expect(result.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(ctx.shell.sandboxMode).toBe('read-only')
  })

  it('keeps real stdout, stdin and official caller-wins environment handling', async () => {
    const { ctx } = await setup()
    const execution = await ctx.shell.execute(ctx.shell.resolve({
      command: 'printf "%s:%s:%s:%s:" "$NO_COLOR" "$TERM" "$PAGER" "$GIT_PAGER"; cat',
      stdin: 'input', env: { PAGER: 'caller-pager' },
    }))
    const result = await execution.result()
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('1:dumb:caller-pager:cat:input')
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  })

  it('reports provider denial facts on the same process and memoized result', async () => {
    const { ctx } = await setup()
    const execution = await ctx.shell.execute(ctx.shell.resolve({
      command: 'printf "fixture permission denied" >&2; exit 7',
    }))
    const pending = execution.result()
    expect(execution.result()).toBe(pending)
    const result = await pending
    expect(result.exitCode).toBe(7)
    expect(result.stderr.text).toBe('fixture permission denied')
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(execution.sandbox).toEqual(result.sandbox)
  })

  it('fails closed without executing the requested command when confinement rejects', async () => {
    const failure = new Error('fixture confinement unavailable')
    const { ctx, calls } = await setup('read-only', failure)
    await expect(ctx.shell.execute(ctx.shell.resolve({ command: 'printf must-not-run' }))).rejects.toBe(failure)
    expect(calls).toHaveLength(1)
  })

  it('bypasses confinement only for the official explicit full-access policy', async () => {
    const { ctx, calls } = await setup('danger-full-access')
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'printf hello' }))
    const result = await execution.result()
    expect(result.stdout.text).toBe('hello')
    expect(result.sandbox).toEqual({ mode: 'danger-full-access', denied: false })
    expect(calls).toEqual([])
  })

  it('passes complex commands through to confinement unchanged', async () => {
    const { ctx, calls } = await setup()
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'printf a | tr a b' }))
    expect((await execution.result()).stdout.text).toBe('b')
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'printf a | tr a b'])
  })
})
