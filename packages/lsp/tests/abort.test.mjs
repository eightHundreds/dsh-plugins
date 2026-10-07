import assert from 'node:assert/strict'
import test from 'node:test'
import { getEventListeners } from 'node:events'
import { abortable, throwIfAborted } from '../src/abort.ts'

test('preserves abort reasons before work starts and during pending work', async () => {
  const reason = new Error('caller cancelled')
  const signal = AbortSignal.abort(reason)
  assert.throws(() => throwIfAborted(signal), e => e === reason)
  await assert.rejects(abortable(Promise.resolve(1), signal), e => e === reason)
  const controller = new AbortController()
  const pending = abortable(new Promise(() => {}), controller.signal)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
  controller.abort(reason)
  await assert.rejects(pending, e => e === reason)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.throws(() => throwIfAborted(AbortSignal.abort('cancel')), /LSP query aborted/)
})

test('removes abort listeners on resolution and rejection; late abort is harmless', async () => {
  const controller = new AbortController()
  assert.equal(await abortable(Promise.resolve(42), controller.signal), 42)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  await assert.rejects(abortable(Promise.reject('failure'), controller.signal), /failure/)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  controller.abort()
  const work = Promise.resolve(9)
  assert.equal(abortable(work), work)
})
