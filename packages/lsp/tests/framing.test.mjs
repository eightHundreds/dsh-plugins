import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeMessage, MessageDecoder } from '../src/framing.ts'

 test('frames use UTF-8 byte length and decode across every split boundary', () => {
  const message = { jsonrpc: '2.0', result: '你好 👋' }
  const frame = encodeMessage(message)
  assert.ok(frame.toString().startsWith(`Content-Length: ${Buffer.byteLength(JSON.stringify(message))}\r\n\r\n`))
  for (let split = 1; split < frame.length; split++) {
    const decoder = new MessageDecoder(1024)
    assert.deepEqual(decoder.push(frame.subarray(0, split)), [])
    assert.deepEqual(decoder.push(frame.subarray(split)), [message])
  }
})

test('decodes coalesced messages and retains an incomplete trailing body', () => {
  const frames = [encodeMessage({ id: 1 }), encodeMessage({ id: 2 }), encodeMessage({ id: 3 })]
  const decoder = new MessageDecoder(1024)
  assert.deepEqual(decoder.push(Buffer.concat([...frames.slice(0, 2), frames[2].subarray(0, -1)])), [{ id: 1 }, { id: 2 }])
  assert.deepEqual(decoder.push(frames[2].subarray(-1)), [{ id: 3 }])
  assert.deepEqual(decoder.push(Buffer.from('content-length: 4\r\nContent-Type: application/json\r\n\r\nnull')), [null])
})

test('rejects missing/invalid lengths, oversized headers/bodies, and invalid JSON', () => {
  for (const value of ['-1', '1.5', 'NaN']) {
    assert.throws(() => new MessageDecoder(16).push(Buffer.from(`Content-Length: ${value}\r\n\r\n`)), /invalid Content-Length/)
  }
  assert.throws(() => new MessageDecoder(16).push(Buffer.from('Other: 3\r\n\r\n')), /missing Content-Length/)
  assert.throws(() => new MessageDecoder(16).push(Buffer.from('Content-Length: 17\r\n\r\n')), /exceeds the 16-byte limit/)
  assert.throws(() => new MessageDecoder(16).push(Buffer.alloc(65537, 65)), /header exceeded/)
  assert.throws(() => new MessageDecoder(16).push(Buffer.from('Content-Length: 1\r\n\r\n{')), /not valid JSON/)
})
