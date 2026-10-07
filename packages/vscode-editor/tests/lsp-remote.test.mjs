import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editorLspContribution, editorLspHostContribution, parseEditorLspRequest, parseEditorLspResult } from '../lib/lsp-remote.js'

test('shares one strict descriptor between host local and consumer remote registries', () => {
  const [host] = editorLspHostContribution.invocations
  const [consumer] = editorLspContribution.descriptors
  assert.equal(host, consumer)
  assert.equal(editorLspHostContribution.face, 'host')
  assert.equal(`${host.namespace}/${host.method}`, 'vscodeEditorLsp/query')
  assert.deepEqual(host.parameters.map(parameter => parameter.wire), ['sessionId', 'request'])
  assert.equal(host.cancellation.parameter, 'signal')
  assert.equal(host.parameters[0].codec.mode, 'strict')
})

test('strict codecs reject malformed queries and accept bounded results', () => {
  const [descriptor] = editorLspHostContribution.invocations
  const request = descriptor.parameters[1].codec.create()
  assert.throws(() => request.parse({ operation: 'rename', filePath: 'a.ts', position: { line: 0, character: 0 } }))
  assert.throws(() => request.parse({ operation: 'hover', filePath: 'a.ts', position: { line: -1, character: 0 } }))
  const parsed = request.parse({ operation: 'findReferences', filePath: 'src/a.ts', position: { line: 1, character: 2 } })
  assert.equal(parsed.operation, 'findReferences')
  const result = descriptor.result.create()
  assert.deepEqual(result.parse({ kind: 'hover', hover: null }), { kind: 'hover', hover: null })
  assert.throws(() => result.parse({ kind: 'locations', locations: Array.from({ length: 201 }, () => ({ uri: 'file:///a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } })), resolvedWorkspaceUri: 'file:///repo', truncated: false }))
  assert.deepEqual(parseEditorLspRequest(parsed), parsed)
  assert.equal(parseEditorLspResult({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///repo', truncated: false }).truncated, false)
})
