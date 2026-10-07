import assert from 'node:assert/strict'
import { test } from 'node:test'
import { queryEditorLsp } from '../lib/lsp-query.js'

const request = { operation: 'hover', filePath: 'src/a.ts', position: { line: 2, character: 4 } }
const hover = { kind: 'hover', hover: { contents: 'symbol', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } } } }
const deps = (overrides = {}) => ({ resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => hover } }), ...overrides })
const code = async (work) => {
  try { await work() } catch (error) { return error.code }
  return undefined
}

test('returns bounded hover and truncates locations at 200', async () => {
  assert.deepEqual(await queryEditorLsp(deps(), 'session', request), hover)
  const locations = Array.from({ length: 201 }, (_, index) => ({ uri: `file:///repo/${index}.ts`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }))
  const result = await queryEditorLsp(deps({
    resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => ({ kind: 'locations', locations, resolvedWorkspaceUri: 'file:///repo' }) } }),
  }), 'session', { ...request, operation: 'goToDefinition' }, new AbortController().signal)
  assert.equal(result.locations.length, 200)
  assert.equal(result.truncated, true)
})

test('validates input, session, workspace, capability, and malformed output', async () => {
  assert.equal(await code(() => queryEditorLsp(deps(), ' ', request)), 'gateway/bad-request')
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => undefined }), 'session', request)), 'vscode-editor-lsp/session-not-found')
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => ({ workspaceRoot: '  ', lsp: {} }) }), 'session', request)), 'vscode-editor-lsp/workspace-required')
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => ({ workspaceRoot: '/repo' }) }), 'session', request)), 'vscode-editor-lsp/unavailable')
  assert.equal(await code(() => queryEditorLsp(deps({
    resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => ({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///repo' }) } }),
  }), 'session', request)), 'vscode-editor-lsp/malformed-response')
})

test('maps provider failures and honors caller, timeout, and disposal cancellation', async () => {
  const failure = Object.assign(new Error('missing'), { code: 'LSP_UNAVAILABLE' })
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => { throw failure } } }) }), 'session', request)), 'vscode-editor-lsp/unavailable')
  const malformed = Object.assign(new Error('bad'), { code: 'LSP_MALFORMED_RESPONSE' })
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => { throw malformed } } }) }), 'session', request)), 'vscode-editor-lsp/malformed-response')
  assert.equal(await code(() => queryEditorLsp(deps({ resolve: async () => ({ workspaceRoot: '/repo', lsp: { query: async () => { throw Object.assign(new Error('server'), { code: 'CRASH' }) } } }) }), 'session', request)), 'vscode-editor-lsp/query-failed')
  const caller = new AbortController(); caller.abort()
  assert.equal(await code(() => queryEditorLsp(deps(), 'session', request, caller.signal)), 'gateway/cancelled')
  assert.equal(await code(() => queryEditorLsp(deps({ timeoutMs: 1, resolve: () => new Promise(() => {}) }), 'session', request)), 'vscode-editor-lsp/timeout')
  const dispose = new AbortController()
  const pending = queryEditorLsp(deps({ disposeSignal: dispose.signal, resolve: () => new Promise(() => {}) }), 'session', request)
  dispose.abort()
  assert.equal(await code(() => pending), 'vscode-editor-lsp/disposed')
})
