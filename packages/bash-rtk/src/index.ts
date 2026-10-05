/**
 * RTK-aware bash executor using only the published sandbox executor contract.
 * The official executor still owns configuration, confinement and processes.
 * @module @dsk/bash-rtk
 */

import { spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-sandbox'
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell'
import { wrapWithRtk } from './wrap.ts'

export { wrapWithRtk } from './wrap.ts'

export const name = 'bash-rtk'
export const inject = [...SandboxBashExecutor.inject]

/** The official volatile execution knobs plus activation-only RTK options. */
export interface Config extends LocalConfig {
  /** Override binary detection. Omit to probe RTK once when activated. */
  rtkAvailable?: boolean
  /** Maximum duration of the availability probe; defaults to 2 seconds. */
  probeTimeoutMs: number
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

// Schemastery's intersect resolver cannot preserve fixed paths for volatile
// fields. Reuse the published object's public dictionary without mutating it.
type LocalFields = typeof SandboxBashExecutor.Config extends z<
  Schemastery.ObjectS<infer Fields>, Schemastery.ObjectT<infer Fields>, 'plain'
> ? Fields : never
const localSchema = SandboxBashExecutor.Config
if (localSchema.type !== 'object' || !localSchema.dict) {
  throw new Error('bash-rtk: the published bash configuration must be an object schema')
}
const localFields = localSchema.dict as LocalFields
export const Config = z.object({
  ...localFields,
  rtkAvailable: z.boolean(),
  probeTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).step(1).default(2_000),
})

/** Probe PATH once per activation, including a hard kill at the deadline. */
function resolveRtk(timeout: number): boolean {
  const result = spawnSync('rtk', ['--version'], {
    stdio: 'ignore', timeout, killSignal: 'SIGKILL',
  })
  return result.status === 0 && !result.error
}

/** Replaces ctx.shell; do not activate another shell executor in this scope. */
export class RtkBashExecutor extends SandboxBashExecutor {
  static override Config = Config
  static override inject = inject

  // Plain TypeScript privacy is intentional: Cordis binds service methods to
  // caller-context proxies, which cannot receive ECMAScript #private fields.
  private readonly available: boolean

  constructor(ctx: Context, config: Config) {
    const timeout = config.probeTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_TIMER_DELAY_MS) {
      throw new Error(`bash-rtk: probeTimeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
    }
    if (config.rtkAvailable !== undefined && typeof config.rtkAvailable !== 'boolean') {
      throw new Error('bash-rtk: rtkAvailable must be a boolean when supplied')
    }
    const available = config.rtkAvailable ?? resolveRtk(timeout)
    super(ctx, config)
    this.available = available
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    return { ...spec, command: wrapWithRtk(spec.command, this.available) }
  }
}

export default RtkBashExecutor
