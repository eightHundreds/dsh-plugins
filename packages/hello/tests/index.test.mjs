import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as hello from '../lib/index.js'

test('host plugin owns its lifecycle and cleanup', async () => {
  const messages = []
  const original = console.info
  console.info = (...args) => messages.push(args.join(' '))
  const ctx = new Context()
  try {
    const fiber = ctx.plugin(hello)
    await fiber.ready
    assert(messages.some((text) => text.includes('loaded')), 'plugin must activate')
    await fiber.dispose()
    assert.equal(messages.filter((text) => text.includes('disposed')).length, 1)
  } finally {
    console.info = original
  }
})
