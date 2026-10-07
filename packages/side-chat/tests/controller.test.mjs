import assert from 'node:assert/strict';
import test from 'node:test';
import { SideChatController } from '../lib/controller.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(fork = async () => 'child') {
  const retained = [];
  const dock = [];
  let raw;
  const controller = new SideChatController({
    fork,
    retain(id, options) {
      const ready = deferred();
      const reference = { id, ready: ready.promise, releases: 0, release() { this.releases++; } };
      retained.push({ reference, options, ready });
      return reference;
    },
    storage: { read: () => raw, write: (value) => { raw = value; } },
    dock: { open: (value) => { dock.push(value); } },
    now: () => 1000,
  });
  return { controller, retained, dock, stored: () => JSON.parse(raw) };
}

test('creates a branch and persists plain metadata immediately', async () => {
  let request;
  const pending = deferred();
  const h = harness((options) => { request = options; return pending.promise; });
  h.controller.setMainSelection('main');
  const task = h.controller.branch({ sessionId: 'main', atSeq: 12 });
  assert.equal(Object.hasOwn(request, 'pendingInbox'), false);
  request.onCreated('child');
  assert.deepEqual(h.stored().sources[0].branches, [{ childId: 'child', actualParentId: 'main', atSeq: 12, createdAt: 1000 }]);
  assert.equal(h.controller.getSnapshot().selectedId, 'child');
  pending.resolve('child');
  assert.equal(await task, 'child');
  h.retained[0].ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, h.retained[0].reference);
});

test('rename failure recovers the created child instead of losing persisted branch', async () => {
  const h = harness(async ({ onCreated }) => {
    onCreated('recoverable');
    throw Error('rename unavailable');
  });
  h.controller.setMainSelection('main');
  assert.equal(await h.controller.branch({ sessionId: 'main', atSeq: 2 }), 'recoverable');
  assert.equal(h.controller.getSnapshot().selectedId, 'recoverable');
  assert.equal(h.controller.getSnapshot().error, 'rename unavailable');
  assert.equal(h.stored().sources[0].branches[0].childId, 'recoverable');
});

test('a source shares one in-flight fork while different sources can fork independently', async () => {
  const requests = [];
  const h = harness((options) => {
    const task = deferred();
    requests.push({ options, task });
    return task.promise;
  });
  h.controller.setMainSelection('main');
  const first = h.controller.branch({ sessionId: 'main', atSeq: 3 });
  assert.equal(h.controller.branch({ sessionId: 'main', atSeq: 3 }), first);
  assert.equal(requests.length, 1);
  h.controller.setMainSelection('other');
  const second = h.controller.branch({ sessionId: 'other', atSeq: 4 });
  assert.equal(requests.length, 2);
  requests[0].task.resolve('old-child');
  await first;
  assert.equal(h.controller.getSnapshot().sourceId, 'other');
  assert.equal(h.controller.getSnapshot().selectedId, undefined);
  requests[1].task.resolve('new-child');
  await second;
  assert.equal(h.controller.getSnapshot().selectedId, 'new-child');
  assert.equal(h.stored().sources[0].branches[0].childId, 'old-child');
});

test('late fork cannot reopen a closed dock and close does not cancel or delete the child', async () => {
  let request;
  const task = deferred();
  const h = harness((options) => { request = options; return task.promise; });
  h.controller.setMainSelection('main');
  const result = h.controller.branch({ sessionId: 'main', atSeq: 5 });
  h.controller.close();
  request.onCreated('background-child');
  task.resolve('background-child');
  assert.equal(await result, 'background-child');
  assert.equal(h.controller.getSnapshot().visible, false);
  assert.equal(h.controller.getSnapshot().selectedId, undefined);
  assert.equal(h.retained.length, 0);
  assert.deepEqual(h.dock, [true, false]);
  assert.equal(h.stored().sources[0].branches[0].childId, 'background-child');
  h.controller.select('background-child');
  assert.equal(h.controller.getSnapshot().selectedId, 'background-child');
  assert.equal(h.controller.getSnapshot().visible, true);
});

test('late fork does not override an explicit selection or switching away and back', async () => {
  let count = 0, request;
  const task = deferred();
  const h = harness((options) => {
    if (++count === 1) return Promise.resolve('existing');
    request = options;
    return task.promise;
  });
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  const result = h.controller.branch({ sessionId: 'main', atSeq: 2 });
  h.controller.setMainSelection('other');
  h.controller.setMainSelection('main');
  h.controller.select('existing');
  request.onCreated('late');
  task.resolve('late');
  await result;
  assert.equal(h.controller.getSnapshot().selectedId, 'existing');
  assert.equal(h.controller.getSnapshot().branches.length, 2);
});

test('only the visible selected reference is owned and late ready cannot resurrect released ownership', async () => {
  let count = 0;
  const h = harness(async () => `child-${++count}`);
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  const first = h.retained[0];
  assert.equal(h.controller.getSnapshot().reference, undefined);
  await h.controller.branch({ sessionId: 'main', atSeq: 2 });
  const second = h.retained[1];
  assert.equal(first.reference.releases, 1);
  assert.equal(first.options.signal.aborted, true);
  first.ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, undefined);
  second.ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, second.reference);
  h.controller.close();
  assert.equal(second.reference.releases, 1);
  assert.equal(h.controller.getSnapshot().reference, undefined);
  h.controller.open();
  assert.equal(h.retained.length, 3);
  h.controller.dispose();
  assert.equal(h.retained[2].reference.releases, 1);
  assert.equal(h.stored().sources[0].branches.length, 2);
});

test('ready failure releases reference and activate retries the same child without another fork', async () => {
  let forks = 0;
  const h = harness(async () => { forks++; return 'child'; });
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  h.retained[0].ready.reject(Error('temporary readiness failure'));
  await tick();
  assert.equal(h.controller.getSnapshot().error, 'temporary readiness failure');
  assert.equal(h.retained[0].reference.releases, 1);
  h.controller.activate();
  assert.equal(h.retained.length, 2);
  assert.equal(forks, 1);
  h.retained[1].ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, h.retained[1].reference);
  assert.equal(h.controller.getSnapshot().error, undefined);
});

test('main selection groups descendants under the top source and forbids a duplicate composer', async () => {
  let count = 0;
  const h = harness(async () => `child-${++count}`);
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  await h.controller.branch({ sessionId: 'child-1', atSeq: 2, rootSourceId: 'main' });
  assert.equal(h.controller.getSnapshot().sourceId, 'main');
  assert.equal(h.controller.getSnapshot().branches[1].actualParentId, 'child-1');
  h.controller.setMainSelection('child-2');
  assert.equal(h.controller.getSnapshot().sourceId, 'main');
  assert.equal(h.controller.getSnapshot().composerDisabled, true);
  h.controller.setMainSelection(undefined);
  assert.equal(h.controller.getSnapshot().sourceId, 'main');
  assert.equal(h.controller.getSnapshot().mainSessionId, 'child-2');
  assert.equal(h.controller.getSnapshot().composerDisabled, true);
});

test('uncreated fork failure is recoverable and permits a fresh fork', async () => {
  let requests = 0;
  const h = harness(async () => {
    if (++requests === 1) throw Error('fork unavailable');
    return 'retried';
  });
  h.controller.setMainSelection('main');
  assert.equal(await h.controller.branch({ sessionId: 'main', atSeq: 1 }), undefined);
  assert.equal(h.controller.getSnapshot().pending, false);
  assert.equal(h.controller.getSnapshot().error, 'fork unavailable');
  assert.equal(await h.controller.branch({ sessionId: 'main', atSeq: 1 }), 'retried');
  assert.equal(h.controller.getSnapshot().error, undefined);
});

test('synchronous retain failures can be activated again without duplicating the child', async () => {
  let attempts = 0;
  const controller = new SideChatController({
    fork: async () => 'child',
    retain() {
      if (++attempts === 1) throw Error('retain unavailable');
      return { ready: Promise.resolve(), release() {} };
    },
    dock: { open() {} },
  });
  controller.setMainSelection('main');
  assert.equal(await controller.branch({ sessionId: 'main', atSeq: 1 }), 'child');
  assert.equal(controller.getSnapshot().error, 'retain unavailable');
  controller.activate();
  await tick();
  assert.equal(controller.getSnapshot().error, undefined);
  assert.notEqual(controller.getSnapshot().reference, undefined);
  assert.equal(controller.getSnapshot().branches.length, 1);
  controller.dispose();
});

test('persistence failure remains visible but does not discard a created child', async () => {
  const controller = new SideChatController({
    fork: async ({ onCreated }) => { onCreated('child'); return 'child'; },
    retain: () => ({ ready: Promise.resolve(), release() {} }),
    storage: { read: () => undefined, write() { throw Error('quota exceeded'); } },
    dock: { open() {} },
  });
  controller.setMainSelection('main');
  assert.equal(await controller.branch({ sessionId: 'main', atSeq: 1 }), 'child');
  assert.equal(controller.getSnapshot().selectedId, 'child');
  assert.match(controller.getSnapshot().error, /quota exceeded/);
  controller.dispose();
});

test('restores metadata without retaining until opened and undefined main preserves saved source', async () => {
  const raw = JSON.stringify({ version: 1, lastSourceId: 'main', sources: [
    { sourceId: 'main', selectedId: 'child', branches: [
      { childId: 'child', actualParentId: 'main', atSeq: 2, createdAt: 1000 },
    ] },
  ] });
  let retained = 0;
  const controller = new SideChatController({
    fork: async () => 'unused',
    retain(id) { retained++; return { id, ready: Promise.resolve(), release() {} }; },
    storage: { read: () => raw, write() {} },
    dock: { open() {} },
  });
  assert.equal(controller.getSnapshot().sourceId, 'main');
  controller.setMainSelection(undefined);
  assert.equal(controller.getSnapshot().sourceId, 'main');
  assert.equal(retained, 0);
  controller.open();
  await tick();
  assert.equal(retained, 1);
  assert.equal(controller.getSnapshot().reference.id, 'child');
  controller.dispose();
});

test('disposal does not cancel a pending created child or reacquire ownership', async () => {
  let request;
  const task = deferred();
  const h = harness((options) => { request = options; return task.promise; });
  h.controller.setMainSelection('main');
  const result = h.controller.branch({ sessionId: 'main', atSeq: 1 });
  h.controller.dispose();
  request.onCreated('survivor');
  task.resolve('survivor');
  assert.equal(await result, 'survivor');
  assert.equal(h.retained.length, 0);
  assert.equal(h.stored().sources[0].branches[0].childId, 'survivor');
});

test('effective layout hiding releases ownership and presenting reacquires without closing intent', async () => {
  const h = harness();
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  h.retained[0].ready.resolve();
  await tick();
  h.controller.setPresented(false);
  assert.equal(h.controller.getSnapshot().visible, true);
  assert.equal(h.controller.getSnapshot().reference, undefined);
  assert.equal(h.retained[0].reference.releases, 1);
  h.controller.setPresented(true);
  assert.equal(h.retained.length, 2);
  h.retained[1].ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, h.retained[1].reference);
  h.controller.dispose();
  assert.deepEqual(h.dock, [true, false]);
});

test('same main selection releases the duplicate side reference until main selection changes', async () => {
  const h = harness();
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  h.controller.setMainSelection('child');
  assert.equal(h.controller.getSnapshot().composerDisabled, true);
  assert.equal(h.retained[0].reference.releases, 1);
  h.retained[0].ready.resolve();
  await tick();
  assert.equal(h.controller.getSnapshot().reference, undefined);
  h.controller.setMainSelection('main');
  assert.equal(h.retained.length, 2);
  h.controller.dispose();
});

test('a disposed late fork merges metadata with a successor without overwriting its selection', async () => {
  let raw;
  const storage = { read: () => raw, write: value => { raw = value; } };
  const pending = deferred();
  let request;
  const common = { storage, dock: { open() {} }, retain: () => ({ ready: Promise.resolve(), release() {} }), now: () => 1000 };
  const old = new SideChatController({ ...common, fork: options => { request = options; return pending.promise; } });
  old.setMainSelection('main');
  const task = old.branch({ sessionId: 'main', atSeq: 1 });
  old.dispose();
  const successor = new SideChatController({ ...common, fork: async () => 'new' });
  successor.setMainSelection('other');
  await successor.branch({ sessionId: 'other', atSeq: 2 });
  request.onCreated('late');
  pending.resolve('late');
  await task;
  const stored = JSON.parse(raw);
  assert.equal(stored.lastSourceId, 'other');
  assert.equal(stored.sources.find(source => source.sourceId === 'other').selectedId, 'new');
  assert.equal(stored.sources.find(source => source.sourceId === 'main').branches[0].childId, 'late');
  assert.equal(successor.getSnapshot().selectedId, 'new');
  successor.close();
  successor.open();
  successor.setMainSelection('main');
  assert.equal(successor.getSnapshot().branches[0].childId, 'late');
  assert.equal(JSON.parse(raw).sources.find(source => source.sourceId === 'main').branches[0].childId, 'late');
  successor.dispose();
});

test('late HMR child preserves successor same-source selection through subsequent writes', async () => {
  let raw;
  const storage = { read: () => raw, write: value => { raw = value; } };
  const pending = deferred();
  let request;
  const common = { storage, dock: { open() {} }, retain: () => ({ ready: Promise.resolve(), release() {} }), now: () => 1000 };
  const old = new SideChatController({ ...common, fork: options => { request = options; return pending.promise; } });
  old.setMainSelection('main');
  const task = old.branch({ sessionId: 'main', atSeq: 1 });
  old.dispose();
  const successor = new SideChatController({ ...common, fork: async () => 'successor-child' });
  successor.setMainSelection('main');
  await successor.branch({ sessionId: 'main', atSeq: 2 });
  request.onCreated('late');
  pending.resolve('late');
  await task;
  assert.equal(JSON.parse(raw).sources[0].selectedId, 'successor-child');
  assert.deepEqual(JSON.parse(raw).sources[0].branches.map(branch => branch.childId), ['successor-child', 'late']);
  successor.setMainSelection('other');
  successor.setMainSelection('main');
  assert.equal(successor.getSnapshot().selectedId, 'successor-child');
  assert.deepEqual(successor.getSnapshot().branches.map(branch => branch.childId), ['successor-child', 'late']);
  successor.dispose();
});

test('metadata reconciliation preserves newer stored selection until an explicit side selection', async () => {
  let raw = JSON.stringify({ version: 1, lastSourceId: 'main', sources: [{ sourceId: 'main', selectedId: 'first', branches: [
    { childId: 'first', actualParentId: 'main', atSeq: 1, createdAt: 1000 },
    { childId: 'second', actualParentId: 'main', atSeq: 2, createdAt: 1000 },
  ] }] });
  const controller = new SideChatController({
    storage: { read: () => raw, write: value => { raw = value; } },
    fork: async () => 'unused',
    retain: () => ({ ready: Promise.resolve(), release() {} }),
    dock: { open() {} },
  });
  // A successor may write a newer choice after this instance read storage.
  const latest = JSON.parse(raw);
  latest.sources[0].selectedId = 'second';
  raw = JSON.stringify(latest);
  controller.setMainSelection('main');
  assert.equal(JSON.parse(raw).sources[0].selectedId, 'second');
  assert.equal(controller.getSnapshot().selectedId, 'second');
  controller.select('first');
  assert.equal(JSON.parse(raw).sources[0].selectedId, 'first');
  controller.dispose();
});

test('first main catalog identity for the current source does not stale an in-flight fork', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const task = h.controller.branch({ sessionId: 'main', atSeq: 1 });
  // projectList publication can first reveal mainView during fork creation.
  h.controller.setMainSelection('main');
  pending.resolve('child');
  await task;
  assert.equal(h.controller.getSnapshot().selectedId, 'child');
  h.controller.dispose();
});

test('synchronous retain catalog reentry cannot duplicate ownership', async () => {
  const references = [];
  let controller;
  controller = new SideChatController({
    fork: async () => 'child',
    retain(id) {
      const reference = { id, ready: Promise.resolve(), releases: 0, release() { this.releases++; } };
      references.push(reference);
      // Publishing retainedBy synchronously updates the main catalog observer.
      controller.setMainSelection(undefined);
      return reference;
    },
    dock: { open() {} },
  });
  controller.setMainSelection('main');
  await controller.branch({ sessionId: 'main', atSeq: 1 });
  await tick();
  assert.equal(references.length, 1);
  assert.equal(controller.getSnapshot().reference, references[0]);
  controller.dispose();
  assert.equal(references[0].releases, 1);
});

test('synchronous retain source reentry releases the stale reference without publishing it', async () => {
  const references = [];
  const exposed = [];
  let controller;
  controller = new SideChatController({
    fork: async () => 'child',
    retain(id, { signal }) {
      const reference = { id, ready: Promise.resolve(), signal, releases: 0, release() { this.releases++; } };
      references.push(reference);
      controller.setMainSelection('other');
      return reference;
    },
    dock: { open() {} },
  });
  controller.subscribe(() => { if (controller.getSnapshot().reference) exposed.push(controller.getSnapshot().reference); });
  controller.setMainSelection('main');
  await controller.branch({ sessionId: 'main', atSeq: 1 });
  await tick();
  assert.equal(controller.getSnapshot().sourceId, 'other');
  assert.equal(controller.getSnapshot().reference, undefined);
  assert.equal(references.length, 1);
  assert.equal(references[0].releases, 1);
  assert.equal(references[0].signal.aborted, true);
  assert.deepEqual(exposed, []);
  controller.dispose();
});

test('retain reentry closing or disposing cannot acquire an invisible stale reference', async () => {
  for (const action of ['close', 'dispose']) {
    let controller, reference;
    controller = new SideChatController({
      fork: async () => 'child',
      retain(id, { signal }) {
        reference = { id, signal, ready: Promise.reject(Error('stale ready failure')), releases: 0, release() { this.releases++; } };
        controller[action]();
        return reference;
      },
      dock: { open() {} },
    });
    controller.setMainSelection('main');
    await controller.branch({ sessionId: 'main', atSeq: 1 });
    await tick();
    assert.equal(controller.getSnapshot().visible, false);
    assert.equal(controller.getSnapshot().reference, undefined);
    assert.equal(reference.releases, 1);
    assert.equal(reference.signal.aborted, true);
    controller.dispose();
  }
});

test('transient empty main catalog identity cannot stale a fork or forget the main composer', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  h.controller.setMainSelection('main');
  const task = h.controller.branch({ sessionId: 'main', atSeq: 1 });
  const before = h.controller.getSnapshot();
  h.controller.setMainSelection(undefined);
  assert.equal(h.controller.getSnapshot(), before);
  h.controller.setMainSelection('main');
  pending.resolve('child');
  await task;
  assert.equal(h.controller.getSnapshot().selectedId, 'child');
  assert.equal(h.controller.getSnapshot().mainSessionId, 'main');
  h.controller.dispose();
});

test('retain close/open ABA releases the interrupted acquisition before reacquiring', async () => {
  const references = [];
  let controller;
  controller = new SideChatController({
    fork: async () => 'child',
    retain(id, { signal }) {
      const reference = { id, signal, ready: Promise.resolve(), releases: 0, release() { this.releases++; } };
      references.push(reference);
      if (references.length === 1) {
        controller.close();
        controller.open();
      }
      return reference;
    },
    dock: { open() {} },
  });
  controller.setMainSelection('main');
  await controller.branch({ sessionId: 'main', atSeq: 1 });
  await tick();
  assert.equal(references.length, 2);
  assert.equal(references[0].signal.aborted, true);
  assert.equal(references[0].releases, 1);
  assert.equal(controller.getSnapshot().reference, references[1]);
  controller.dispose();
  assert.equal(references[1].releases, 1);
});

test('retain layout hide/show ABA invalidates its acquisition without leaking a handle', async () => {
  const references = [];
  let controller;
  controller = new SideChatController({
    fork: async () => 'child',
    retain(id, { signal }) {
      const reference = { id, signal, ready: Promise.resolve(), releases: 0, release() { this.releases++; } };
      references.push(reference);
      if (references.length === 1) {
        controller.setPresented(false);
        controller.setPresented(true);
      }
      return reference;
    },
    dock: { open() {} },
  });
  controller.setMainSelection('main');
  await controller.branch({ sessionId: 'main', atSeq: 1 });
  await tick();
  assert.equal(references.length, 2);
  assert.equal(references[0].signal.aborted, true);
  assert.equal(references[0].releases, 1);
  assert.equal(controller.getSnapshot().reference, references[1]);
  controller.dispose();
  assert.equal(references[1].releases, 1);
});

test('workspace attach failure preserves the reported created child without an onCreated callback', async () => {
  const error = Object.assign(Error('workspace unavailable'), {
    rpcError: { code: 'session/workspace-attach-failed', details: { sessionId: 'recoverable' } },
  });
  const h = harness(async () => { throw error; });
  h.controller.setMainSelection('main');
  assert.equal(await h.controller.branch({ sessionId: 'main', atSeq: 1 }), 'recoverable');
  assert.equal(h.controller.getSnapshot().selectedId, 'recoverable');
  assert.equal(h.controller.getSnapshot().error, 'workspace unavailable');
  assert.equal(h.stored().sources[0].branches[0].childId, 'recoverable');
  h.controller.dispose();
});

test('synchronous workspace attach failure is recoverable and callback identity wins', async () => {
  const error = Object.assign(Error('workspace unavailable'), {
    rpcError: { code: 'session/workspace-attach-failed', details: { sessionId: 'reported' } },
  });
  for (const callbackId of [undefined, 'callback-child']) {
    const h = harness(({ onCreated }) => {
      if (callbackId) onCreated(callbackId);
      throw error;
    });
    h.controller.setMainSelection('main');
    assert.equal(await h.controller.branch({ sessionId: 'main', atSeq: 1 }), callbackId ?? 'reported');
    assert.equal(h.controller.getSnapshot().branches.length, 1);
    assert.equal(h.controller.getSnapshot().selectedId, callbackId ?? 'reported');
    h.controller.dispose();
  }
});

test('true absence of the main binding restores a paused side conversation', async () => {
  const h = harness();
  h.controller.setMainSelection('main');
  await h.controller.branch({ sessionId: 'main', atSeq: 1 });
  h.controller.setMainSelection('child');
  assert.equal(h.controller.getSnapshot().composerDisabled, true);
  h.controller.clearMainSelection();
  assert.equal(h.controller.getSnapshot().mainSessionId, undefined);
  assert.equal(h.controller.getSnapshot().composerDisabled, false);
  assert.equal(h.controller.getSnapshot().sourceId, 'main');
  assert.equal(h.retained.length, 2);
  h.controller.dispose();
});

test('store snapshot stays referentially stable between changes and subscribe cleans up', () => {
  const h = harness();
  const getSnapshot = h.controller.getSnapshot;
  const subscribe = h.controller.subscribe;
  assert.equal(getSnapshot(), getSnapshot());
  let notifications = 0;
  const unsubscribe = subscribe(() => { notifications++; });
  h.controller.setMainSelection('main');
  assert.equal(notifications, 1);
  const current = getSnapshot();
  h.controller.setMainSelection('main');
  assert.equal(getSnapshot(), current);
  assert.equal(notifications, 1);
  unsubscribe();
  h.controller.open();
  assert.equal(notifications, 1);
});
