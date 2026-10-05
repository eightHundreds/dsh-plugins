import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'
import RtkBashExecutor from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(config: Record<string, unknown> = {}) {
  // This test double exercises the provider seam, NOT actual OS confinement.
  class FakeSandboxProvider extends SandboxProvider {
    async confine(argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
      if (argv[2]?.startsWith('rtk ')) throw new Error('resolve-only RTK command unexpectedly executed')
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only' })
  const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
  const fiber = await ctx.registry.plugin(RtkBashExecutor, { rtkAvailable: true, graceMs: 40, ...config })
  return { ctx, fiber, subprocessFiber }
}

describe('RTK published executor contract', () => {
  it('registers the sandbox subclass with official defaults', async () => {
    const { ctx } = await setup()
    expect(ctx.shell).toBeInstanceOf(RtkBashExecutor)
    expect(ctx.shell).toBeInstanceOf(SandboxBashExecutor)
    expect(ctx.shell).toBeInstanceOf(LocalBashExecutor)
    expect(ctx.shell.resolve({ command: 'git status' })).toEqual({
      command: 'rtk git status', workdir: process.cwd(), timeoutMs: 120_000,
      onExpiry: 'kill', stdoutMaxBytes: 64_000,
      sandboxPolicy: { mode: 'read-only', workspaceRoot: resolve(process.cwd()) },
    })
  })

  it('inherits configured defaults, timeout caps and request validation', async () => {
    const { ctx } = await setup({ cwd: '/workspace', timeoutMs: 1234, maxTimeoutMs: 2345, maxOutputBytes: 256 })
    expect(ctx.shell.resolve({ command: 'git status' })).toMatchObject({
      workdir: '/workspace', timeoutMs: 1234, stdoutMaxBytes: 256,
    })
    expect(ctx.shell.resolve({ command: 'git status', timeoutMs: 10_000 }).timeoutMs).toBe(2345)
    expect(ctx.shell.resolve({ command: 'git status', stdoutMaxBytes: 32 }).stdoutMaxBytes).toBe(32)
    expect(() => ctx.shell.resolve({ command: 'git status', timeoutMs: 0 })).toThrow()
    expect(() => ctx.shell.resolve({ command: 'git status', stdoutMaxBytes: 0 })).toThrow()
  })

  it('changes only the command, retaining frozen caller metadata and references', async () => {
    const { ctx } = await setup()
    const signal = new AbortController().signal
    const env = { CUSTOM: 'value' }
    const dshEnv = { DSH_TEST: 'value' }
    const sandboxPolicy = { mode: 'workspace-write' as const, workspaceRoot: '/caller-root' }
    const request: ShellExecRequest = Object.freeze({
      command: 'git status', workdir: '/caller-workdir', timeoutMs: 19,
      onExpiry: 'none', stdoutMaxBytes: 41, signal, stdin: 'input', env, dshEnv, sandboxPolicy,
    })
    const spec = ctx.shell.resolve(request)
    expect(spec).toEqual({ ...request, command: 'rtk git status' })
    expect(spec).not.toBe(request)
    expect(request.command).toBe('git status')
    expect(spec.signal).toBe(signal)
    expect(spec.env).toBe(env)
    expect(spec.dshEnv).toBe(dshEnv)
    expect(spec.sandboxPolicy).toBe(sandboxPolicy)
  })

  it('passes complex, unknown and already wrapped commands through', async () => {
    const { ctx } = await setup()
    for (const command of ['git status | grep x', 'ls -la', 'rtk git status', 'git status && git diff', 'printf hello']) {
      expect(ctx.shell.resolve({ command }).command).toBe(command)
    }
  })

  it('falls back to plain commands for explicit unavailable RTK', async () => {
    const { ctx } = await setup({ rtkAvailable: false })
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('git status')
  })

  it('uses the calling context policy through Cordis service proxies', async () => {
    const { ctx } = await setup()
    const caller = ctx.isolate('sandboxPolicy')
    await caller.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/caller-root' })
    expect(caller.shell.resolve({ command: 'git status' })).toMatchObject({
      command: 'rtk git status', sandboxPolicy: { mode: 'workspace-write', workspaceRoot: '/caller-root' },
    })
    expect(ctx.shell.resolve({ command: 'git status' }).sandboxPolicy?.mode).toBe('read-only')
  })

  it('unloads the service and can activate again with fresh options', async () => {
    const { ctx, fiber } = await setup()
    await fiber.dispose()
    expect(ctx.get('shell')).toBeUndefined()
    await ctx.registry.plugin(RtkBashExecutor, { rtkAvailable: false, timeoutMs: 42 })
    expect(ctx.shell.resolve({ command: 'git status' })).toMatchObject({ command: 'git status', timeoutMs: 42 })
  })

  it('rejects duplicate shell activation without replacing the existing service', async () => {
    const { ctx } = await setup()
    await expect(ctx.registry.plugin(SandboxBashExecutor, {})).rejects.toThrow()
    expect(ctx.shell).toBeInstanceOf(RtkBashExecutor)
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('rtk git status')
    await expect(ctx.registry.plugin(RtkBashExecutor, { rtkAvailable: false })).rejects.toThrow()
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('rtk git status')
  })

  it('retains the official real foreground handle and memoized projection', async () => {
    const { ctx } = await setup()
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'printf hello' }))
    const first = execution.result()
    expect(execution.result()).toBe(first)
    const result = await first
    expect(execution.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('hello')
    expect(result.timedOut).toBe(false)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  })

  it('preserves background cancellation and timeout classification', async () => {
    const { ctx } = await setup()
    const background = await ctx.shell.execute(ctx.shell.resolve({ command: 'exec sleep 30', onExpiry: 'none' }))
    try {
      expect(background.status).toBe('running')
      expect(background.kill()).toBe(true)
      await background.done
      expect(background.status).toBe('killed')
      expect((await background.result()).timedOut).toBe(false)
    } finally {
      background.kill()
    }
    const expired = await ctx.shell.execute(ctx.shell.resolve({ command: 'exec sleep 30', timeoutMs: 30 }))
    const result = await expired.result()
    expect(expired.status).toBe('killed')
    expect(result).toMatchObject({ timedOut: true, aborted: false, timeoutMs: 30 })
  })

  it('keeps background work managed across executor reload, then joins on owner teardown', async () => {
    const { ctx, fiber, subprocessFiber } = await setup()
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: 'exec sleep 30', onExpiry: 'none' }))
    try {
      await fiber.restart()
      expect(ctx.shell).toBeInstanceOf(RtkBashExecutor)
      expect(execution.status).toBe('running')
      await fiber.dispose()
      expect(ctx.get('shell')).toBeUndefined()
      expect(execution.status).toBe('running')
      await subprocessFiber.dispose()
      await execution.done
      expect(execution.status).toBe('killed')
      expect((await execution.result()).timedOut).toBe(false)
    } finally {
      execution.kill()
    }
  })
})
