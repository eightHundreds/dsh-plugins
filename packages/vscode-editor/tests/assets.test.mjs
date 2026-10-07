import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetHandler } from '../lib/assets.js'

test('asset route serves packaged workers and rejects encoded traversal and writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vscode-editor-assets-'))
  try {
    await writeFile(join(root, 'editor.worker.js'), 'worker')
    const handler = assetHandler(root, '/vscode-editor/assets')
    const request = async (url, method = 'GET') => {
      const response = { status: 0, headers: {}, body: undefined, writeHead(status, headers) { this.status = status; this.headers = headers ?? {} }, end(body) { this.body = body } }
      await handler({ url, method }, response)
      return response
    }
    const get = await request('/vscode-editor/assets/editor.worker.js?v=123')
    assert.equal(get.status, 200)
    assert.equal(get.body.toString(), 'worker')
    assert.match(get.headers['content-type'], /javascript/)
    const head = await request('/vscode-editor/assets/editor.worker.js', 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body, undefined)
    assert.equal((await request('/vscode-editor/assets/%2e%2e%2fsecret.js')).status, 403)
    assert.equal((await request('/vscode-editor/assets/%')).status, 400)
    assert.equal((await request('/vscode-editor/assets/missing.js')).status, 404)
    assert.equal((await request('/vscode-editor/assets/editor.worker.js', 'POST')).status, 405)
  } finally { await rm(root, { recursive: true, force: true }) }
})
