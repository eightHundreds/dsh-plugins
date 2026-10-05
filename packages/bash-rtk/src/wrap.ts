/**
 * Command wrapping using RTK (Rust Token Killer)'s native rewrite engine.
 *
 * Rather than maintaining a fragile, static whitelist and regular expression
 * checks, this module delegates rewrite decisions directly to RTK's official
 * `rtk hook check <cmd>` command (RTK's single source of truth for AI agents).
 *
 * RTK intelligently rewrites commands (including subcommands, pipes, arguments,
 * e.g. `ls -al` -> `rtk ls -al`, `cat foo` -> `rtk read foo`), while safely
 * preserving non-rewriteable commands (shell builtins, echo, etc.) by returning
 * non-zero exit code.
 *
 * @module @dsk/bash-rtk/wrap
 */

import { spawnSync } from 'node:child_process'

/** Default timeout for rewrite probing in milliseconds. */
const DEFAULT_REWRITE_TIMEOUT_MS = 1_000

/**
 * Decide whether `command` should be routed through `rtk`, using RTK's
 * native rewrite engine (`rtk hook check <command>`).
 *
 * Returns the rewritten command if supported by RTK, or the original command
 * unchanged if RTK is absent, returns non-zero, or times out.
 *
 * @param command - the raw shell command requested by the caller.
 * @param rtkAvailable - whether the `rtk` binary is available on PATH.
 * @param timeoutMs - optional timeout for the check process (defaults to 1000ms).
 * @returns the command to execute (rewritten or unchanged original).
 */
export function wrapWithRtk(command: string, rtkAvailable: boolean, timeoutMs = DEFAULT_REWRITE_TIMEOUT_MS): string {
  if (!rtkAvailable) return command
  if (!command.trim()) return command

  try {
    const result = spawnSync('rtk', ['hook', 'check', command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      encoding: 'utf-8',
      killSignal: 'SIGKILL',
    })

    if (result.status === 0 && result.stdout) {
      const rewritten = result.stdout.trim()
      if (rewritten.length > 0) {
        return rewritten
      }
    }
  } catch {
    // On any unexpected failure or timeout, fall back safely to original command.
  }

  return command
}

