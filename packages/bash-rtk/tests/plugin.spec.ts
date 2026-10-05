import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import RtkBashExecutor, * as Rtk from '../src/index.ts'

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: probe,
}))

const contexts: Context[] = []
beforeEach(() => probe.mockReset())
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(config: Record<string, unknown> = {}) {
  class UnusedSandbox extends SandboxProvider {
    async confine(): Promise<never> { throw new Error('not used in resolve-only tests') }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(UnusedSandbox)
  await ctx.plugin(SandboxPolicyService, {})
  await ctx.plugin(LocalSubprocessRuntime)
  // The public registry accepts raw user configuration and validates it once.
  const fiber = await ctx.registry.plugin(RtkBashExecutor, config)
  return { ctx, fiber }
}

const invalidTimeouts = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2_147_483_648]

describe('public RTK executor plugin', () => {
  it('exports the default/named subclass, inherited execution and dependencies', () => {
    probe.mockImplementation((_cmd, args) => {
      if (args?.[0] === 'hook' && args?.[1] === 'check') {
        const cmd = args[2] as string
        if (cmd?.startsWith('git ')) return { status: 0, stdout: `rtk ${cmd}` }
      }
      return { status: 1 }
    })
    expect(Rtk.default).toBe(Rtk.RtkBashExecutor)
    expect(Rtk.name).toBe('bash-rtk')
    expect(Rtk.inject).toEqual(['subprocess', 'sandbox', 'sandboxPolicy'])
    expect(RtkBashExecutor.inject).toEqual(SandboxBashExecutor.inject)
    expect(RtkBashExecutor.Config).toBe(Rtk.Config)
    expect(RtkBashExecutor.prototype).toBeInstanceOf(SandboxBashExecutor)
    expect(Object.hasOwn(RtkBashExecutor.prototype, 'execute')).toBe(true)
    expect(Rtk.wrapWithRtk('git status', true)).toBe('rtk git status')
  })

  it('preserves every official volatile schema field and its defaults', () => {
    const config = Rtk.Config({})
    expect(config.rtkAvailable).toBeUndefined()
    expect(config.probeTimeoutMs).toBe(2000)
    expect(config.cwd.get()).toBeUndefined()
    expect(config.timeoutMs.get()).toBe(120_000)
    expect(config.maxTimeoutMs.get()).toBe(600_000)
    expect(config.maxOutputBytes.get()).toBe(64_000)
    expect(config.maxSpillBytes.get()).toBe(64 * 1024 * 1024)
    expect(config.graceMs.get()).toBe(3000)
    for (const [key, field] of Object.entries(LocalBashExecutor.Config.dict!)) {
      expect(Rtk.Config.dict?.[key]).toBe(field)
    }
    expect(Rtk.Config.dict).not.toHaveProperty('order')
    expect(LocalBashExecutor.Config.dict).not.toHaveProperty('rtkAvailable')
    const custom = Rtk.Config({ cwd: '/workspace', timeoutMs: 37, maxOutputBytes: 128 })
    expect(custom.cwd.get()).toBe('/workspace')
    expect(custom.timeoutMs.get()).toBe(37)
    expect(custom.maxOutputBytes.get()).toBe(128)
  })

  it('rejects invalid probe values and nonboolean overrides in its schema', () => {
    for (const probeTimeoutMs of invalidTimeouts) {
      expect(() => Rtk.Config({ probeTimeoutMs })).toThrow()
    }
    for (const rtkAvailable of ['true', 1, {}]) {
      const input: unknown = { rtkAvailable }
      expect(() => Rtk.Config(input as Parameters<typeof Rtk.Config>[0])).toThrow()
    }
    expect(Rtk.Config({ probeTimeoutMs: 1 }).probeTimeoutMs).toBe(1)
    expect(Rtk.Config({ probeTimeoutMs: 2_147_483_647 }).probeTimeoutMs).toBe(2_147_483_647)
  })

  it('validates direct constructor inputs before registering a service or probing', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const config = Rtk.Config({})
    for (const probeTimeoutMs of invalidTimeouts) {
      expect(() => new RtkBashExecutor(ctx, { ...config, probeTimeoutMs })).toThrow('positive safe integer')
      expect(ctx.get('shell')).toBeUndefined()
    }
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes once per activation with a bounded hard-kill subprocess', async () => {
    probe.mockImplementation((_cmd, args) => {
      if (args?.[0] === '--version') return { status: 0 }
      if (args?.[0] === 'hook' && args?.[1] === 'check') {
        const cmd = args[2] as string
        if (cmd?.startsWith('git ')) return { status: 0, stdout: `rtk ${cmd}` }
      }
      return { status: 1 }
    })
    const { ctx, fiber } = await setup({ probeTimeoutMs: 75 })
    expect(ctx.shell).toBeInstanceOf(RtkBashExecutor)
    expect(probe).toHaveBeenCalledWith('rtk', ['--version'], {
      stdio: 'ignore', timeout: 75, killSignal: 'SIGKILL',
    })
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('rtk git status')
    expect(ctx.shell.resolve({ command: 'git diff' }).command).toBe('rtk git diff')
    expect(probe.mock.calls.filter(c => c[1]?.[0] === '--version')).toHaveLength(1)
    await fiber.restart()
    expect(probe.mock.calls.filter(c => c[1]?.[0] === '--version')).toHaveLength(2)
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('rtk git status')
  })

  it.each([
    ['missing', { status: null, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }],
    ['timeout', { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }],
    ['nonzero', { status: 1 }],
    ['failed despite status zero', { status: 0, error: new Error('failed') }],
  ])('falls back without repeated probes when %s', async (_label, result) => {
    probe.mockReturnValue(result)
    const { ctx } = await setup()
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe('git status')
    expect(ctx.shell.resolve({ command: 'git diff' }).command).toBe('git diff')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('skips probing for explicit availability %s', async rtkAvailable => {
    probe.mockImplementation((_cmd, args) => {
      if (args?.[0] === 'hook' && args?.[1] === 'check') {
        const cmd = args[2] as string
        if (cmd?.startsWith('git ')) return { status: 0, stdout: `rtk ${cmd}` }
      }
      return { status: 1 }
    })
    const { ctx } = await setup({ rtkAvailable })
    expect(ctx.shell.resolve({ command: 'git status' }).command).toBe(rtkAvailable ? 'rtk git status' : 'git status')
    expect(probe).not.toHaveBeenCalledWith('rtk', ['--version'], expect.anything())
  })

  it('does not register the shell when the probe throws before super', () => {
    const ctx = new Context()
    contexts.push(ctx)
    probe.mockImplementationOnce(() => { throw new Error('probe infrastructure failure') })
    expect(() => new RtkBashExecutor(ctx, Rtk.Config({}))).toThrow('probe infrastructure failure')
    expect(ctx.get('shell')).toBeUndefined()
  })
})
