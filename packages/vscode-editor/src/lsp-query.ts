import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { LspService } from '@deepseek-ai/dsh-lsp'
import type { EditorLspRequest, EditorLspResult } from './lsp-contract.ts'
import { parseEditorLspRequest, parseEditorLspResult, parseEditorLspSessionId } from './lsp-remote.ts'

export const EDITOR_LSP_TIMEOUT_MS = 10_000
export const EDITOR_LSP_MAX_LOCATIONS = 200

/** Internal seam: session observation and provider selection never activate an Agent. */
export interface EditorLspQueryDeps {
  resolve(sessionId: string): Promise<{ readonly workspaceRoot?: string; readonly lsp?: Pick<LspService, 'query'> } | undefined>
  readonly disposeSignal?: AbortSignal
  /** Test adapter may supply a shorter budget; production always uses ten seconds. */
  readonly timeoutMs?: number
}

/** Query persisted file content with cancellation, bounded navigation, and stable Remote failures. */
export async function queryEditorLsp(
  deps: EditorLspQueryDeps,
  sessionId: string,
  request: EditorLspRequest,
  signal?: AbortSignal,
): Promise<EditorLspResult> {
  try {
    parseEditorLspSessionId(sessionId)
    request = parseEditorLspRequest(request)
  } catch (cause) {
    throw new RemoteError('gateway/bad-request', 'Invalid editor LSP query', {}, { cause })
  }
  const controller = new AbortController()
  const cancel = () => controller.abort(new RemoteError('gateway/cancelled', 'Editor LSP query cancelled', {}))
  const dispose = () => controller.abort(new RemoteError('vscode-editor-lsp/disposed', 'Editor LSP bridge disposed', {}))
  signal?.addEventListener('abort', cancel, { once: true })
  deps.disposeSignal?.addEventListener('abort', dispose, { once: true })
  if (signal?.aborted) cancel()
  if (deps.disposeSignal?.aborted) dispose()
  const timer = setTimeout(() => controller.abort(new RemoteError('vscode-editor-lsp/timeout', 'Editor LSP query timed out', {})), deps.timeoutMs ?? EDITOR_LSP_TIMEOUT_MS)
  let onAbort: (() => void) | undefined
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) onAbort()
    })
    const work = async (): Promise<EditorLspResult> => {
      controller.signal.throwIfAborted()
      const scope = await deps.resolve(sessionId)
      controller.signal.throwIfAborted()
      if (scope === undefined) throw new RemoteError('vscode-editor-lsp/session-not-found', 'Session not found', { sessionId })
      if (scope.workspaceRoot === undefined || scope.workspaceRoot.trim() === '') throw new RemoteError('vscode-editor-lsp/workspace-required', 'Session has no workspace cwd', { sessionId })
      if (scope.lsp === undefined) throw new RemoteError('vscode-editor-lsp/unavailable', 'No LSP capability is mounted for this session', {})
      const result = await scope.lsp.query({ ...request, workspaceRoot: scope.workspaceRoot }, controller.signal)
      controller.signal.throwIfAborted()
      try {
        const bounded = result.kind === 'locations'
          ? { ...result, locations: result.locations.slice(0, EDITOR_LSP_MAX_LOCATIONS), truncated: result.locations.length > EDITOR_LSP_MAX_LOCATIONS }
          : result
        const parsed = parseEditorLspResult(bounded)
        if ((request.operation === 'hover') !== (parsed.kind === 'hover')) throw new TypeError('operation and result kind disagree')
        return parsed
      } catch (cause) {
        throw new RemoteError('vscode-editor-lsp/malformed-response', 'LSP returned an invalid result', {}, { cause })
      }
    }
    return await Promise.race([work(), aborted])
  } catch (cause) {
    if (controller.signal.aborted) throw controller.signal.reason
    const remote = remoteErrorOf(cause)
    if (remote !== undefined) throw remote
    const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
    if (code === 'LSP_UNAVAILABLE' || code === 'LSP_DISPOSED') throw new RemoteError('vscode-editor-lsp/unavailable', 'LSP capability is unavailable', {}, { cause })
    if (code === 'LSP_MALFORMED_RESPONSE') throw new RemoteError('vscode-editor-lsp/malformed-response', 'LSP returned an invalid result', {}, { cause })
    if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError') throw new RemoteError('gateway/cancelled', 'LSP query cancelled', {}, { cause })
    throw new RemoteError('vscode-editor-lsp/query-failed', 'LSP query failed', code === undefined ? {} : { lspCode: code }, { cause })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    deps.disposeSignal?.removeEventListener('abort', dispose)
    if (onAbort !== undefined) controller.signal.removeEventListener('abort', onAbort)
  }
}
