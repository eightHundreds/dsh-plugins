import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { LspConnection } from '../src/connection.ts'
import { LspInstance } from '../src/instance.ts'
import { encodeMessage } from '../src/framing.ts'

const spec = {
  command: 'fixture-server', args: ['--stdio'], cwd: '/workspace', env: {},
  workspaceUri: 'file:///workspace', configuration: { strict: true }, initializationOptions: null,
  maxMessageBytes: 1024, maxStderrBytes: 1024, killGraceMs: 10, shutdownTimeoutMs: 50,
}
function server() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const messages = []
  let onWrite = () => {}
  let terminations = 0
  return {
    messages, stdout, finish,
    get terminations() { return terminations },
    set onWrite(value) { onWrite = value },
    respond(id, result) { stdout.write(encodeMessage({ jsonrpc: '2.0', id, result })) },
    writer(_stdin, message, callback) { messages.push(message); callback(); onWrite(message) },
    spawn(spawnSpec) {
      assert.deepEqual(spawnSpec.argv, ['fixture-server', '--stdio'])
      return { stdin, stdout, done, collected: {}, terminate() { terminations++; finish() }, waitForExit: async () => true }
    },
  }
}

test('routes out-of-order responses, error responses and cancellation by request id', async () => {
  const mock = server()
  const connection = new LspConnection(spec, mock.spawn, async () => null, mock.writer)
  const first = connection.request('first', {})
  const second = connection.request('second', {})
  connection.cancel(1)
  assert.deepEqual(mock.messages[2], { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } })
  mock.respond(2, 'second result')
  assert.equal(await second, 'second result')
  mock.stdout.write(encodeMessage({ id: 1, error: { code: -1, message: 'server error' } }))
  await assert.rejects(first, /server error/)
  mock.finish()
  await connection.closed
  await assert.rejects(connection.request('after-close', {}), /language server exited/)
})

test('write failures reject all pending requests with the original error', async () => {
  const mock = server()
  const failure = new Error('pipe closed')
  let writes = 0
  const connection = new LspConnection(spec, mock.spawn, async () => null, (_stdin, _message, callback) => {
    callback(++writes === 2 ? failure : undefined)
  })
  const first = connection.request('first', {})
  const second = connection.request('second', {})
  await assert.rejects(first, e => e === failure)
  await assert.rejects(second, e => e === failure)
  assert.equal(connection.failedWith(failure), true)
  mock.finish()
  await connection.closed
})

test('malformed protocol output terminates the process and rejects pending work', async () => {
  const mock = server()
  const connection = new LspConnection(spec, mock.spawn, async () => null, mock.writer)
  const pending = connection.request('hover', {})
  mock.stdout.write(Buffer.from('Content-Length: 1\r\n\r\n{'))
  await assert.rejects(pending, /not valid JSON/)
  await connection.closed
  assert.equal(mock.terminations, 1)
})

test('active query cancellation sends cancel and didClose, then permits the next query', async () => {
  const mock = server()
  let queryStarted
  const started = new Promise(resolve => { queryStarted = resolve })
  mock.onWrite = message => {
    if (message.method === 'initialize') mock.respond(message.id, { capabilities: { hoverProvider: true, textDocumentSync: 1 } })
    if (message.method === 'textDocument/hover') queryStarted(message.id)
    if (message.method === 'shutdown') mock.respond(message.id, null)
  }
  const instance = new LspInstance(spec, mock.spawn, mock.writer)
  const request = { workspaceRoot: '/workspace', filePath: 'a.ts', languageId: 'typescript', operation: 'hover', position: { line: 0, character: 0 } }
  const source = { fileUrl: 'file:///workspace/a.ts', text: 'const value = 1' }
  const controller = new AbortController()
  const pending = instance.query(request, source, controller.signal)
  const id = await started
  const reason = new Error('stop query')
  controller.abort(reason)
  await assert.rejects(pending, e => e === reason)
  assert.deepEqual(mock.messages.find(m => m.method === '$/cancelRequest').params, { id })
  assert.ok(mock.messages.some(m => m.method === 'textDocument/didClose'))
  mock.respond(id, { contents: 'late result' })
  mock.onWrite = message => {
    if (message.method === 'textDocument/hover') mock.respond(message.id, { contents: 'next result' })
    if (message.method === 'shutdown') mock.respond(message.id, null)
  }
  assert.deepEqual(await instance.query(request, source), { kind: 'hover', hover: { contents: 'next result' } })
  await instance.dispose()
  await instance.dispose()
  assert.equal(mock.terminations, 1, 'disposal must be idempotent')
  assert.deepEqual(mock.messages.filter(m => m.method === 'textDocument/didOpen').map(m => m.params.textDocument.text), [source.text, source.text])
  assert.equal(mock.messages.filter(m => m.method === 'textDocument/didClose').length, 2)
})
