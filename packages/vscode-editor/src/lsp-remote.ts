import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LspPosition, LspRange } from '@deepseek-ai/dsh-lsp'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { EditorLspRequest, EditorLspResult } from './lsp-contract.ts'

export const EDITOR_LSP_OPERATIONS = ['hover', 'goToDefinition', 'goToImplementation', 'findReferences'] as const

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('expected an object')
  const record = value as Record<string, unknown>
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new TypeError('unexpected or missing object fields')
  }
  return record
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('expected a string')
  return value
}

export function parseEditorLspSessionId(value: unknown): SessionId {
  const id = text(value)
  if (id.trim() === '' || id.includes('\0')) throw new TypeError('sessionId must be nonempty and contain no NUL')
  return id as SessionId
}

function position(value: unknown): LspPosition {
  const p = object(value, ['line', 'character'])
  for (const key of ['line', 'character']) {
    if (!Number.isSafeInteger(p[key]) || (p[key] as number) < 0) throw new TypeError(`${key} must be a nonnegative safe integer`)
  }
  return { line: p.line as number, character: p.character as number }
}

function range(value: unknown): LspRange {
  const r = object(value, ['start', 'end'])
  const start = position(r.start)
  const end = position(r.end)
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) throw new TypeError('range end precedes start')
  return { start, end }
}

export function parseEditorLspRequest(value: unknown): EditorLspRequest {
  const r = object(value, ['operation', 'filePath', 'position'])
  if (!EDITOR_LSP_OPERATIONS.some(operation => operation === r.operation)) throw new TypeError('unsupported LSP operation')
  const filePath = text(r.filePath)
  if (filePath.trim() === '' || filePath.includes('\0')) throw new TypeError('filePath must be nonempty and contain no NUL')
  return { operation: r.operation as EditorLspRequest['operation'], filePath, position: position(r.position) }
}

export function parseEditorLspResult(value: unknown): EditorLspResult {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected LSP result')
  if (Reflect.get(value, 'kind') === 'hover') {
    const r = object(value, ['kind', 'hover'])
    if (r.hover === null) return { kind: 'hover', hover: null }
    const h = object(r.hover, ['contents'], ['range'])
    return { kind: 'hover', hover: { contents: text(h.contents), ...(Object.hasOwn(h, 'range') ? { range: range(h.range) } : {}) } }
  }
  const r = object(value, ['kind', 'locations', 'resolvedWorkspaceUri', 'truncated'])
  if (r.kind !== 'locations' || !Array.isArray(r.locations) || r.locations.length > 200 || typeof r.truncated !== 'boolean') throw new TypeError('invalid location result')
  return {
    kind: 'locations',
    locations: r.locations.map(value => {
      const location = object(value, ['uri', 'range'])
      return { uri: text(location.uri), range: range(location.range) }
    }),
    resolvedWorkspaceUri: text(r.resolvedWorkspaceUri),
    truncated: r.truncated,
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'vscodeEditorLsp/query': (sessionId: SessionId, request: EditorLspRequest, signal?: AbortSignal) => Promise<RemoteResult<EditorLspResult>>
  }
  interface TypertRemoteNamespaceMap {
    vscodeEditorLsp: TypertRemoteNamespace<'vscodeEditorLsp'>
  }
  interface RemoteErrorDetailsMap {
    'vscode-editor-lsp/session-not-found': { readonly sessionId: string }
    'vscode-editor-lsp/workspace-required': { readonly sessionId: string }
    'vscode-editor-lsp/unavailable': {}
    'vscode-editor-lsp/timeout': {}
    'vscode-editor-lsp/disposed': {}
    'vscode-editor-lsp/malformed-response': {}
    'vscode-editor-lsp/query-failed': { readonly lspCode?: string }
  }
}

const editorLspDescriptor: InvocationDescriptor = {
  id: '@dshx/vscode-editor#vscodeEditorLsp/query',
  service: 'vscodeEditorLsp', namespace: 'vscodeEditorLsp', method: 'query', invocation: { kind: 'direct' },
  parameters: [
    { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => ({ parse: parseEditorLspSessionId }) } },
    { name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: '@dshx/vscode-editor#EditorLspRequest', create: () => ({ parse: parseEditorLspRequest }) } },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@dshx/vscode-editor#EditorLspResult', create: () => ({ parse: parseEditorLspResult }) },
}

/** Gateway reads this through `ctx.typert.local`; it is not a consumer registration. */
export const editorLspHostContribution: TypertContribution = {
  package: '@dshx/vscode-editor', face: 'host', schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [editorLspDescriptor],
}

/** Frontend agent mounts this so `ctx.remote.vscodeEditorLsp.query` has the same descriptor. */
export const editorLspContribution: TypertRemoteContribution = {
  package: '@dshx/vscode-editor',
  descriptors: [editorLspDescriptor],
}
