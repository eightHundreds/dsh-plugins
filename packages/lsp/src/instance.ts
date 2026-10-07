import { LspError } from './types'
import type {
  LspProviderQuery,
  LspQueryResult,
} from './types'
import { abortable, abortError } from './abort'
import { LspConnection } from './connection'
import type { ConnectionSpawner, ConnectionSpec, ConnectionWriter } from './connection'
import type { HostSource } from './host'
import type { WireInitializeResult, WireServerCapabilities } from './protocol'
import {
  negotiatePositionEncoding,
  normalizeDiagnostics,
  normalizeDocumentSymbols,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from './translate'

export interface InstanceSpec extends ConnectionSpec {
  readonly workspaceUri: string
  readonly initializationOptions: unknown
  readonly shutdownTimeoutMs: number
}

const CLIENT_CAPABILITIES = {
  general: {
    positionEncodings: ['utf-16'],
  },
  workspace: {
    configuration: true,
    workspaceFolders: true,
  },
  textDocument: {
    hover: {
      contentFormat: ['markdown', 'plaintext'],
    },
    definition: {
      linkSupport: true,
    },
    typeDefinition: {
      linkSupport: true,
    },
    implementation: {
      linkSupport: true,
    },
    diagnostic: {
      dynamicRegistration: false,
    },
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
    },
  },
} as const

export class LspInstance {
  private readonly connection: LspConnection
  private capabilities: WireServerCapabilities | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private teardownPromise: Promise<void> | undefined
  private processClosed = false
  private readonly ready: Promise<void>

  constructor(private readonly spec: InstanceSpec, spawner: ConnectionSpawner, writer?: ConnectionWriter) {
    this.connection = new LspConnection(spec, spawner, (method, params) => this.answerServerRequest(method, params), writer)
    this.ready = this.initialize()
    this.ready.catch(() => {})
    void this.connection.closed.then(() => { this.processClosed = true })
  }

  get dead(): boolean {
    return this.processClosed || this.disposed || this.connection.failed
  }

  isTransportFailure(error: unknown): boolean {
    return this.connection.failedWith(error)
  }

  query(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    const run = abortable(this.queue, signal)
      .then(() => this.runQuery(request, source, signal))
      .catch(async (error: unknown) => {
        if (this.isTransportFailure(error)) await this.awaitTeardownAttempt()
        throw error
      })
    this.queue = this.queue.then(() => run).then(() => undefined, () => undefined)
    return run
  }

  private async initialize(): Promise<void> {
    const initializeResult = await this.connection.request('initialize', {
      processId: null,
      rootUri: this.spec.workspaceUri,
      workspaceFolders: [{ uri: this.spec.workspaceUri, name: 'workspace' }],
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: this.spec.initializationOptions,
    }) as WireInitializeResult
    const capabilities = initializeResult.capabilities
    negotiatePositionEncoding(capabilities.positionEncoding)
    this.capabilities = capabilities
    await this.connection.notify('initialized', {})
  }

  private async runQuery(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    if (this.disposed) throw new LspError('LSP instance was disposed', 'LSP_DISPOSED')
    if (signal?.aborted) throw abortError(signal)
    try {
      await abortable(this.ready, signal)
    } catch (error) {
      if (!this.dead) {
        await this.awaitTeardownAttempt()
      }
      throw error
    }
    const capabilities = this.capabilities
    if (capabilities === undefined) throw new Error('LSP instance is not initialized')
    if (!supportsOperation(capabilities, request.operation)) {
      throw new LspError(`server does not support ${request.operation}`, 'LSP_UNSUPPORTED_OPERATION')
    }
    if (!supportsTransientOpen(capabilities.textDocumentSync)) {
      throw new LspError('server does not support the transient textDocument/didOpen this host requires', 'LSP_UNSUPPORTED_OPERATION')
    }

    const documentUri = source.fileUrl
    await this.connection.notify('textDocument/didOpen', {
      textDocument: {
        uri: documentUri,
        languageId: request.languageId,
        version: 1,
        text: source.text,
      },
    })

    const method = requestMethod(request.operation)
    const requestId = this.connection.peekNextId()
    const onAbort = (): void => { this.connection.cancel(requestId) }
    signal?.addEventListener('abort', onAbort, { once: true })

    let rawResult: unknown
    let queryError: unknown
    try {
      let params: Record<string, unknown>
      if (request.operation === 'diagnostics' || request.operation === 'documentSymbols') {
        params = { textDocument: { uri: documentUri } }
      } else {
        params = {
          textDocument: { uri: documentUri },
          position: request.position,
          ...(request.operation === 'findReferences' ? { context: { includeDeclaration: true } } : {}),
        }
      }
      const pending = this.connection.request(method, params)
      rawResult = await abortable(pending, signal)
    } catch (error) {
      queryError = error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      await this.connection.notify('textDocument/didClose', {
        textDocument: { uri: documentUri },
      }).catch(() => {})
    }

    if (queryError !== undefined) throw queryError

    if (request.operation === 'hover') {
      return { kind: 'hover', hover: normalizeHover(rawResult) }
    }
    if (request.operation === 'diagnostics') {
      return { kind: 'diagnostics', diagnostics: normalizeDiagnostics(rawResult) }
    }
    if (request.operation === 'documentSymbols') {
      return { kind: 'documentSymbols', symbols: normalizeDocumentSymbols(rawResult) }
    }
    return {
      kind: 'locations',
      locations: normalizeLocations(rawResult),
      resolvedWorkspaceUri: this.spec.workspaceUri,
    }
  }

  private async answerServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'workspace/configuration') {
      const items = (params as { items?: unknown[] })?.items
      const count = Array.isArray(items) ? items.length : 0
      return Array.from({ length: count }, () => this.spec.configuration)
    }
    if (method === 'workspace/workspaceFolders') {
      return [{ uri: this.spec.workspaceUri, name: 'workspace' }]
    }
    throw new Error(`unsupported server request: ${method}`)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.awaitTeardownAttempt()
  }

  private awaitTeardownAttempt(): Promise<void> {
    if (this.teardownPromise !== undefined) return this.teardownPromise
    this.teardownPromise = this.attemptTeardown()
    return this.teardownPromise
  }

  private async attemptTeardown(): Promise<void> {
    try {
      const shutdown = this.connection.request('shutdown', null)
      const budget = new AbortController()
      const timer = setTimeout(() => { budget.abort() }, this.spec.shutdownTimeoutMs)
      try {
        await abortable(shutdown, budget.signal)
        await this.connection.notify('exit', null)
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Escalation handled below
    }
    this.connection.terminate()
    await this.connection.waitForManagedRangeExit()
  }
}
