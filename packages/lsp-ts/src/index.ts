// Adapted from dsh-lsp-packs 258bb6409c504fa1eed20b6f70d13009522ca0ce (MIT).
/**
 * dsh-lsp-ts — TypeScript / JavaScript language configuration pack for DeepSeek Harness.
 *
 * One language pack = one npm package that registers a configured
 * `@deepseek-ai/dsh-lsp-stdio` instance on `ctx.lsp`. The pack ships the
 * server command, launch arguments, and the extension → language-id table
 * for its language; the deployment composes the shared LSP base once (the
 * `lsp` service, the `lsp` tool, and a filesystem/subprocess pair for the
 * same execution world) and every language pack reuses it unchanged.
 *
 * The server is NOT launched at load: `lsp-stdio` starts processes lazily on
 * the first matching query. When the server executable cannot be resolved,
 * the pack still loads and every query fails with a structured
 * `LSP_UNAVAILABLE` error naming the missing command, so the rest of the
 * session keeps working.
 *
 * Namespace plugin (named exports, no default export).
 * @module @dshx/lsp-ts
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { LspError, LspProviderId } from '@deepseek-ai/dsh-lsp'
import type { LspProvider, LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import * as LspStdio from '@deepseek-ai/dsh-lsp-stdio'
import type { LspLocalServerConfig } from '@deepseek-ai/dsh-lsp-stdio'

/** Cordis plugin name for loader diagnostics. */
export const name = 'lsp-ts'

/** Services required by the shared LSP base this pack assembles. */
export const inject = ['fs', 'lsp', 'subprocess']

/** Stable provider id reserved on `ctx.lsp` by this pack. */
export const PROVIDER_ID = 'ts'

/** Default server command (absolute path or PATH-resolved executable, no shell). */
export const DEFAULT_COMMAND = 'tsc'

/** Default launch arguments. */
export const DEFAULT_ARGS: readonly string[] = ['--lsp', '--stdio']

/** Default lowercase leading-dot extension → LSP language id table. */
export const DEFAULT_EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact"
}

/**
 * Pack configuration. Every field is optional and overrides the pack default;
 * leaving a field unset keeps the README-documented default. This is how a
 * user points the pack at a server installed at a non-standard path.
 */
export interface Config {
  /** Override the server command (absolute path or PATH name). */
  command?: string
  /** Override the launch arguments (replaces the default list entirely). */
  args?: string[]
  /** Extra environment variables merged on top of the scrubbed ambient env. */
  env?: Record<string, string>
  /** Extra extension → language-id entries merged on top of the defaults. */
  extensionToLanguage?: Record<string, string>
  /** Static `initialize` options forwarded to the server. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. */
  configuration?: unknown
  /** Largest single framed message accepted from the server (bytes). */
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). */
  maxStderrBytes?: number
  /** Largest source file this host will open (bytes). */
  maxDocumentBytes?: number
  /** Graceful shutdown/exit budget before escalation (ms). */
  shutdownTimeoutMs?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). */
  killGraceMs?: number
}

export const Config: z<Config> = z.object({
  command: z.string(),
  args: z.array(String).default([...DEFAULT_ARGS]),
  env: z.dict(String),
  extensionToLanguage: z.dict(String),
  initializationOptions: z.any(),
  configuration: z.any(),
  maxMessageBytes: z.number(),
  maxStderrBytes: z.number(),
  maxDocumentBytes: z.number(),
  shutdownTimeoutMs: z.number(),
  killGraceMs: z.number(),
})

/**
 * The server entry this pack always fills completely: `command`, `args`, and
 * `extensionToLanguage` are guaranteed present (defaults or user overrides).
 */
export type ResolvedServerConfig = LspLocalServerConfig & {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
}

/** Merge the pack defaults with the user overrides into one stdio server entry. */
export function resolveServerConfig(config: Config): ResolvedServerConfig {
  const server: ResolvedServerConfig = {
    command: config.command ?? DEFAULT_COMMAND,
    args: config.args ?? [...DEFAULT_ARGS],
    extensionToLanguage: { ...DEFAULT_EXTENSION_TO_LANGUAGE, ...(config.extensionToLanguage ?? {}) },
  }
  if (config.env !== undefined) server.env = config.env
  if (config.initializationOptions !== undefined) server.initializationOptions = config.initializationOptions
  if (config.configuration !== undefined) server.configuration = config.configuration
  if (config.maxMessageBytes !== undefined) server.maxMessageBytes = config.maxMessageBytes
  if (config.maxStderrBytes !== undefined) server.maxStderrBytes = config.maxStderrBytes
  if (config.maxDocumentBytes !== undefined) server.maxDocumentBytes = config.maxDocumentBytes
  if (config.shutdownTimeoutMs !== undefined) server.shutdownTimeoutMs = config.shutdownTimeoutMs
  if (config.killGraceMs !== undefined) server.killGraceMs = config.killGraceMs
  return server
}

/** A provider that keeps extension routing alive while the server is missing. */
class UnavailableProvider implements LspProvider {
  readonly id = LspProviderId(PROVIDER_ID)
  readonly extensionToLanguage: Readonly<Record<string, string>>

  constructor(extensions: Readonly<Record<string, string>>, private readonly reason: string) {
    this.extensionToLanguage = { ...extensions }
  }

  query(_request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const message =
      'language server for ' + PROVIDER_ID + ' is unavailable: ' + this.reason + '. '
      + 'Install the language server (see the pack README) and reload the profile or session.'
    return Promise.reject(new LspError(message, 'LSP_UNAVAILABLE'))
  }
}

/** Extract a stable message from an unknown load-time failure. */
function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Register the configured stdio provider for the language, or a structured
 * no-server fallback when the executable cannot be resolved at load.
 *
 * A missing executable disables this language routing and surfaces
 * `LSP_UNAVAILABLE` on queries. Other setup errors retain official behavior.
 * @param ctx - the plugin context (must inject `fs`, `lsp`, `subprocess`).
 * @param config - the resolved pack configuration.
 */
import { registerLanguageServer } from '@dshx/lsp'

export async function apply(ctx: Context, config: Config): Promise<void> {
  const server = resolveServerConfig(config)
  try {
    ctx.effect(() => {
      return registerLanguageServer(ctx, PROVIDER_ID, server)
    }, name + '.server')
    return
  } catch (error) {
    if (!(error instanceof SubprocessExecutableNotFoundError)) throw error
    const reason = failureMessage(error)
    console.warn('[' + name + '] ' + server.command + ' unavailable at load: ' + reason)
    ctx.effect(() => {
      const dispose = ctx.lsp.registerProvider(
        new UnavailableProvider(server.extensionToLanguage, server.command + ": " + reason),
      )
      return () => dispose()
    }, name + '.unavailableFallback')
  }
}
