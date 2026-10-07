import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeState, encodeState, loadState, saveState } from '../lib/persistence.js';

const state = {
  version: 1,
  lastSourceId: 'main',
  sources: [{ sourceId: 'main', selectedId: 'child', branches: [
    { childId: 'child', actualParentId: 'main', atSeq: 12, createdAt: 1000 },
  ] }],
};

test('round trips plain branch metadata, excluding messages and arbitrary fields', () => {
  const input = structuredClone(state);
  input.sources[0].branches[0].messages = ['never persist transcripts'];
  input.secret = 'extra';
  assert.deepEqual(decodeState(encodeState(input)), state);
  assert.equal(encodeState(input).includes('never persist'), false);
});

test('invalid or unsupported storage returns an empty validated state', () => {
  for (const value of [null, '', '{', '{}', '{"version":2,"sources":[]}',
    JSON.stringify({ ...state, sources: [{ ...state.sources[0], branches: [{ childId: 'bad', actualParentId: 'main', atSeq: -1, createdAt: 1 }] }] }),
    JSON.stringify({ ...state, sources: [state.sources[0], state.sources[0]] }),
    JSON.stringify({ ...state, sources: [{ ...state.sources[0], selectedId: 'absent' }] }),
  ]) assert.deepEqual(decodeState(value), { version: 1, sources: [] });
});

test('storage uses only the injected read/write boundary', () => {
  let raw = null;
  const storage = { read: () => raw, write: (value) => { raw = value; } };
  assert.deepEqual(loadState(storage), { version: 1, sources: [] });
  saveState(storage, state);
  assert.deepEqual(loadState(storage), state);
  assert.deepEqual(loadState({ read() { throw Error('blocked'); } }), { version: 1, sources: [] });
  assert.throws(() => saveState({ write() { throw Error('quota'); } }, state), /quota/);
});
