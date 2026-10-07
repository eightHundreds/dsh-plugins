import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { LspRegistry } from './registry'
import {
  LspError,
  MAX_TIMER_DELAY_MS,
  assertNever,
} from './types'
import type {
  LspProvider,
  LspProviderQuery,
  LspQueryResult,
} from './types'
import { canonicalizeWorkspace, readHostSource } from './host'
import type { HostWorkspace } from './host'
import { LspInstance } from './instance'
import {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  LSP_OPERATIONS,
  formatDiagnostics,
  formatDocumentSymbols,
  formatHover,
  formatLocations,
  parseLspArgs,
  presentLspCall,
} from './render'
import { sessionCwd } from './session-cwd'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lsp: LspRegistry
    fs: FileSystem
    subprocess: SubprocessRuntime
  }
}

export const name = 'lsp'
export const inject = ['fs', 'subprocess', 'tools', 'systemPrompt']

export const DEFAULT_LSP_TOOL_TIMEOUT_MS = 60_000
const DEFAULT_MAX_MESSAGE_BYTES = 16_000_000
const DEFAULT_MAX_STDERR_BYTES = 1_000_000
const DEFAULT_MAX_DOCUMENT_BYTES = 4_000_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_KILL_GRACE_MS = 2_000

export const LSP_PROMPT_TEXT =
  'Use lsp for precise semantic code navigation, analysis and verification. Operations: goToDefinition, goToTypeDefinition, findReferences, goToImplementation, hover, diagnostics (file-wide syntax & type errors), documentSymbols (hierarchical outline of classes, functions, interfaces). Positions are one-based line and character (UTF-16); diagnostics and documentSymbols operate on the whole file without requiring line/character.'

export interface LocalServerConfig {
  command: string
  extensionToLanguage: Record<string, string>
  args?: string[]
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
  maxMessageBytes?: number
  maxStderrBytes?: number
  maxDocumentBytes?: number
  shutdownTimeoutMs?: number
  killGraceMs?: number
}

export interface Config {
  maxLocations?: number
  maxResultChars?: number
  timeoutMs?: number
  servers?: Record<string, LocalServerConfig>
}

const DEFAULT_SERVERS: Record<string, LocalServerConfig> = {}

const LocalServerConfig: z<LocalServerConfig> = z.object({
  command: z.string().required(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  extensionToLanguage: z.dict(String).required(),
  initializationOptions: z.any().default(null),
  configuration: z.any().default(null),
  maxMessageBytes: z.number().default(DEFAULT_MAX_MESSAGE_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  maxDocumentBytes: z.number().default(DEFAULT_MAX_DOCUMENT_BYTES),
  shutdownTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  killGraceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_KILL_GRACE_MS),
})

export const Config: z<Config> = z.object({
  maxLocations: z.number().default(DEFAULT_MAX_LOCATIONS),
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_LSP_TOOL_TIMEOUT_MS),
  servers: z.dict(LocalServerConfig).default(DEFAULT_SERVERS),
})

type ResolvedServerConfig = Required<LocalServerConfig>
type WorkspaceKey = HostWorkspace['target']['targetKey']

class StdioProvider implements LspProvider {
  readonly id: string
  readonly extensionToLanguage: Readonly<Record<string, string>>
  private readonly instances = new Map<WorkspaceKey, LspInstance>()
  private readonly inflight = new Map<WorkspaceKey, Promise<LspInstance>>()

  constructor(
    id: string,
    private readonly server: ResolvedServerConfig,
    private readonly ctx: Context,
  ) {
    this.id = id
    this.extensionToLanguage = { ...server.extensionToLanguage }
  }

  async query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    const workspace = await canonicalizeWorkspace(this.ctx.fs, request.workspaceRoot, signal)
    const source = await readHostSource(this.ctx.fs, request.filePath, workspace, this.server.maxDocumentBytes, signal)
    const instance = await this.instanceFor(workspace, signal)
    try {
      return await instance.query(request, source, signal)
    } catch (error) {
      if (instance.dead) this.dropInstance(workspace.target.targetKey, instance)
      throw error
    }
  }

  private async instanceFor(workspace: HostWorkspace, _signal?: AbortSignal): Promise<LspInstance> {
    const key = workspace.target.targetKey
    const existing = this.instances.get(key)
    if (existing !== undefined && !existing.dead) return existing
    if (existing !== undefined) this.dropInstance(key, existing)

    const pending = this.inflight.get(key)
    if (pending !== undefined) return await pending

    const promise = this.spawnInstance(workspace)
    this.inflight.set(key, promise)
    try {
      const instance = await promise
      this.instances.set(key, instance)
      return instance
    } finally {
      this.inflight.delete(key)
    }
  }

  private async spawnInstance(workspace: HostWorkspace): Promise<LspInstance> {
    const resolvedPath = await this.ctx.subprocess.resolveExecutable(this.server.command, this.server.env)
    return new LspInstance(
      {
        command: resolvedPath,
        args: this.server.args,
        cwd: workspace.canonicalPath,
        workspaceUri: workspace.fileUrl,
        env: this.server.env,
        initializationOptions: this.server.initializationOptions,
        configuration: this.server.configuration,
        maxMessageBytes: this.server.maxMessageBytes,
        maxStderrBytes: this.server.maxStderrBytes,
        shutdownTimeoutMs: this.server.shutdownTimeoutMs,
        killGraceMs: this.server.killGraceMs,
      },
      spec => this.ctx.subprocess.spawn(spec),
    )
  }

  private dropInstance(key: WorkspaceKey, instance: LspInstance): void {
    if (this.instances.get(key) === instance) this.instances.delete(key)
    void instance.dispose()
  }

  async dispose(): Promise<void> {
    const active = [...this.instances.values()]
    this.instances.clear()
    await Promise.allSettled(active.map(i => i.dispose()))
  }
}

export function registerLanguageServer(ctx: Context, serverId: string, rawServer: LocalServerConfig): () => void {
  const lspRegistry = ctx.get('lsp') as LspRegistry
  const serverConfig: ResolvedServerConfig = {
    command: rawServer.command,
    args: rawServer.args ?? [],
    env: rawServer.env ?? {},
    extensionToLanguage: rawServer.extensionToLanguage,
    initializationOptions: rawServer.initializationOptions ?? null,
    configuration: rawServer.configuration ?? null,
    maxMessageBytes: rawServer.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
    maxStderrBytes: rawServer.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
    maxDocumentBytes: rawServer.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
    shutdownTimeoutMs: rawServer.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    killGraceMs: rawServer.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
  }
  const provider = new StdioProvider(serverId, serverConfig, ctx)
  const unregister = lspRegistry.registerProvider(provider)
  return () => {
    unregister()
    void provider.dispose()
  }
}

export function apply(ctx: Context, config: Config): void {
  const maxLocations = config.maxLocations ?? DEFAULT_MAX_LOCATIONS
  const maxResultChars = config.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
  const timeoutMs = config.timeoutMs ?? DEFAULT_LSP_TOOL_TIMEOUT_MS
  const configuredServers = config.servers ?? DEFAULT_SERVERS

  // 1. 初始化 ctx.lsp 路由注册表
  let lspRegistry = ctx.get('lsp') as LspRegistry | undefined
  if (!lspRegistry) {
    lspRegistry = new LspRegistry(ctx)
  }

  // 2. 注册已配置的本地 stdio 语言服务器
  const servers = Object.entries(configuredServers)
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    for (const [serverId, rawServer] of servers) {
      const serverConfig: ResolvedServerConfig = {
        command: rawServer.command,
        args: rawServer.args ?? [],
        env: rawServer.env ?? {},
        extensionToLanguage: rawServer.extensionToLanguage,
        initializationOptions: rawServer.initializationOptions ?? null,
        configuration: rawServer.configuration ?? null,
        maxMessageBytes: rawServer.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
        maxStderrBytes: rawServer.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
        maxDocumentBytes: rawServer.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
        shutdownTimeoutMs: rawServer.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
        killGraceMs: rawServer.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      }
      const provider = new StdioProvider(serverId, serverConfig, ctx)
      const unregister = lspRegistry.registerProvider(provider)
      disposers.push(() => {
        unregister()
        void provider.dispose()
      })
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'lsp.servers')

  // 3. 注册面向模型的系统提示词
  ctx.systemPrompt.section({
    name: 'tool:lsp',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP'),
    text: LSP_PROMPT_TEXT,
  })

  // 4. 注册面向模型的 lsp 工具
  ctx.tools.register(defineTool({
    name: 'lsp',
    description:
      'Query a language server for precise code navigation, diagnostics, and symbol outline. operation is one of goToDefinition, goToTypeDefinition, findReferences, goToImplementation, hover, diagnostics, documentSymbols.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...LSP_OPERATIONS],
        description: 'goToDefinition, goToTypeDefinition, findReferences, goToImplementation, hover, diagnostics, or documentSymbols.',
      },
      file_path: {
        type: 'string',
        required: true,
        description: 'The source file to query, relative to the workspace or absolute.',
      },
      line: {
        type: 'number',
        description: 'One-based line of the cursor (optional for diagnostics and documentSymbols).',
      },
      character: {
        type: 'number',
        description: 'One-based UTF-16 column of the cursor (optional for diagnostics and documentSymbols).',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'locations' },
              locations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        start: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                        end: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'hover' },
              hover: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      contents: { type: 'string', required: true },
                      range: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          start: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              line: { type: 'integer', required: true },
                              character: { type: 'integer', required: true },
                            },
                          },
                          end: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              line: { type: 'integer', required: true },
                              character: { type: 'integer', required: true },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'diagnostics' },
              diagnostics: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    severity: { type: 'string', required: true },
                    message: { type: 'string', required: true },
                    code: { type: 'string' },
                    source: { type: 'string' },
                    range: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        start: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                        end: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'documentSymbols' },
              symbols: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    detail: { type: 'string' },
                    range: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        start: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                        end: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                      },
                    },
                    selectionRange: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        start: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                        end: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            line: { type: 'integer', required: true },
                            character: { type: 'integer', required: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        switch (value.kind) {
          case 'locations':
            return [{ type: 'text', text: formatLocations(value.locations as any, value.resolvedWorkspaceUri, maxLocations, maxResultChars) }]
          case 'hover':
            return [{ type: 'text', text: formatHover(value.hover as any, maxResultChars) }]
          case 'diagnostics':
            return [{ type: 'text', text: formatDiagnostics(value.diagnostics as any, maxResultChars) }]
          case 'documentSymbols':
            return [{ type: 'text', text: formatDocumentSymbols(value.symbols as any, maxResultChars) }]
          default:
            return assertNever(value as never, 'lsp output')
        }
      },
    },
    presentCall: (args: any) => presentLspCall(args),
    timeoutMs,
    async execute(args, exec) {
      const input = parseLspArgs(args as any)
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      const result = await lspRegistry.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, exec.signal)
      switch (result.kind) {
        case 'locations':
          return {
            kind: 'locations' as const,
            locations: result.locations.map(location => ({
              uri: location.uri,
              range: {
                start: { line: location.range.start.line, character: location.range.start.character },
                end: { line: location.range.end.line, character: location.range.end.character },
              },
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        case 'hover':
          return {
            kind: 'hover' as const,
            hover: result.hover === null
              ? null
              : {
                contents: result.hover.contents,
                ...result.hover.range === undefined
                  ? {}
                  : {
                    range: {
                      start: { line: result.hover.range.start.line, character: result.hover.range.start.character },
                      end: { line: result.hover.range.end.line, character: result.hover.range.end.character },
                    },
                  },
              },
          }
        case 'diagnostics':
          return {
            kind: 'diagnostics' as const,
            diagnostics: result.diagnostics.map(d => ({
              severity: d.severity,
              message: d.message,
              ...(d.code !== undefined ? { code: String(d.code) } : {}),
              ...(d.source !== undefined ? { source: d.source } : {}),
              range: {
                start: { line: d.range.start.line, character: d.range.start.character },
                end: { line: d.range.end.line, character: d.range.end.character },
              },
            })),
          }
        case 'documentSymbols':
          return {
            kind: 'documentSymbols' as const,
            symbols: result.symbols.map(s => ({
              name: s.name,
              kind: s.kind,
              ...(s.detail ? { detail: s.detail } : {}),
              range: {
                start: { line: s.range.start.line, character: s.range.start.character },
                end: { line: s.range.end.line, character: s.range.end.character },
              },
              selectionRange: {
                start: { line: s.selectionRange.start.line, character: s.selectionRange.start.character },
                end: { line: s.selectionRange.end.line, character: s.selectionRange.end.character },
              },
            })),
          }
        default:
          return assertNever(result, 'lsp result')
      }
    },
  }))
}

export * from './types'
export * from './registry'
