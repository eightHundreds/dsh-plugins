import assert from 'node:assert/strict'
import test from 'node:test'
import { messageModel, messageParts, sameDraft, shouldSubmitOnEnter } from '../src/client/message-model.ts'

const node = (kind, data, visibility = 'visible') => ({ kind, data, visibility })

test('projects current assistant text and reasoning without duplicating tool calls', () => {
  assert.deepEqual(messageModel(node('assistant-step', {
    status: 'running', blocks: [
      { kind: 'reasoning', text: 'thinking' }, { kind: 'text', text: 'hel' },
      { kind: 'tool-call', name: 'bash', argsRaw: '{}' },
    ],
  })), { role: 'assistant', status: 'running', parts: [
    { kind: 'reasoning', text: 'thinking' }, { kind: 'text', text: 'hel' },
  ] })
  assert.equal(messageModel(node('assistant-step', {
    status: 'settled', blocks: [{ kind: 'text', text: 'hello' }],
  })).parts[0].text, 'hello')
})

test('accepts content block types and handles unknown payloads without stringifying them', () => {
  assert.deepEqual(messageParts([
    null, 'raw', { type: 'text', text: 'user prompt' }, { type: 'image', source: {} },
    { type: 'opaque', secret: 'not rendered' }, { type: 'text', text: 42 },
  ]), [
    { kind: 'text', text: 'user prompt' }, { kind: 'image' },
    { kind: 'unsupported' }, { kind: 'unsupported' },
  ])
  assert.deepEqual(messageModel(node('user', { content: [{ type: 'text', text: 'hi' }] })), {
    role: 'user', parts: [{ kind: 'text', text: 'hi' }],
  })
  assert.deepEqual(messageParts({ text: 'not an array' }), [])
})

test('reports actual tool lifecycle and safe text results', () => {
  assert.deepEqual(messageModel(node('tool-call', { root: { phase: 'preparing', name: 'bash' } })), {
    role: 'tool', name: 'bash', status: 'running', parts: [],
  })
  const settled = { kind: 'tool-result', call: { name: 'bash', argsRaw: 'private' },
    isError: false, content: [{ type: 'text', text: 'done' }] }
  assert.deepEqual(messageModel(node('tool-call', { root: settled })), {
    role: 'tool', name: 'bash', status: 'settled', parts: [{ kind: 'text', text: 'done' }],
  })
  assert.equal(messageModel(node('tool-call', { root: { ...settled, isError: true } })).status, 'failed')
  assert.equal(messageModel(node('tool-call', { root: { ...settled, isError: true,
    error: { name: 'Interrupted', code: 'interrupted' } } })).status, 'interrupted')
  assert.equal(messageModel(node('tool-call', { root: {} })).name, undefined)
  assert.equal(messageModel(node('tool-call', { root: null })), null)
})

test('omits hidden/control nodes and preserves terminal failure evidence', () => {
  for (const kind of ['turn-tail', 'turn-process', 'request-prompt']) {
    assert.equal(messageModel(node(kind, {})), null)
  }
  assert.equal(messageModel(node('user', { content: [] }, 'hidden')), null)
  assert.equal(messageModel(undefined), null)
  assert.deepEqual(messageModel(node('turn-error', { message: 'provider rejected' })), {
    role: 'context', status: 'failed', parts: [{ kind: 'text', text: 'provider rejected' }],
  })
})

test('accepted sends only clear the exact submitted revision', () => {
  const submitted = { text: 'first', revision: 1 }
  assert.equal(sameDraft({ ...submitted }, submitted), true)
  assert.equal(sameDraft({ text: 'later', revision: 2 }, submitted), false)
  assert.equal(sameDraft({ text: 'first', revision: 3 }, submitted), false)
  assert.equal(sameDraft(undefined, submitted), false)
})

test('Enter excludes IME confirmation, modifier keys, and repeated keydowns', () => {
  const enter = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false,
    altKey: false, repeat: false, composing: false, keyCode: 13 }
  assert.equal(shouldSubmitOnEnter(enter), true)
  for (const flag of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey', 'repeat', 'composing']) {
    assert.equal(shouldSubmitOnEnter({ ...enter, [flag]: true }), false, flag)
  }
  assert.equal(shouldSubmitOnEnter({ ...enter, keyCode: 229 }), false)
  assert.equal(shouldSubmitOnEnter({ ...enter, key: 'a' }), false)
})
