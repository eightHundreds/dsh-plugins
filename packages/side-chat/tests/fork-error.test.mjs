import assert from 'node:assert/strict';
import test from 'node:test';
import { createdForkId } from '../lib/fork-error.js';

const failure = details => ({ rpcError: { code: 'session/workspace-attach-failed', details } });

test('decodes only the workspace attach failure identity from Host RPC details', () => {
  assert.equal(createdForkId(failure({ sessionId: 'created' })), 'created');
  for (const error of [undefined, null, 'created', {}, { sessionId: 'created' },
    { rpcError: { code: 'other', details: { sessionId: 'created' } } },
    { rpcError: { code: 'session/workspace-attach-failed', data: { sessionId: 'created' } } },
    failure(undefined), failure(null), failure({}), failure({ sessionId: '' }),
    failure({ sessionId: '  ' }), failure({ sessionId: 1 }),
  ]) assert.equal(createdForkId(error), undefined);
});
