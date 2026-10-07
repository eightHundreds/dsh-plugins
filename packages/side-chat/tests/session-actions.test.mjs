import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionActions, SessionActionError } from '../lib/session-actions.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const emptyInbox = () => ({ 'next-turn': [], 'next-step': [] });
const accepted = () => ({ ok: true, value: { accepted: true } });
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const code = (expected) => (error) => error instanceof SessionActionError && error.code === expected;

function harness(options = {}) {
  const calls = { submissions: [], prompts: [], cancel: 0, older: 0, updates: 0, abandon: 0, releases: 0, bindings: 0 };
  let inbox = Object.hasOwn(options, 'inbox') ? options.inbox : emptyInbox();
  let released = false;
  let request = 0;
  const opening = deferred();
  const session = {
    sessionId: options.id ?? 'child',
    getSnapshot: () => ({ running: options.running ?? false, pendingSubmissions: [] }),
    projections: {
      faceOf(key) {
        assert.equal(key, 'inbox');
        return { getSnapshot: () => inbox };
      },
    },
    beginSubmission(input) {
      calls.submissions.push(input);
      return { requestId: `request-${++request}`, abandon() { calls.abandon++; } };
    },
    async prompt(...args) { calls.prompts.push(args); return accepted(); },
    async cancel() { calls.cancel++; return accepted(); },
    async loadOlder() { calls.older++; },
    async updateQueue() { calls.updates++; return accepted(); },
  };
  const binding = { sessionId: session.sessionId, session };
  const reference = {
    sessionId: session.sessionId,
    ready: opening.promise,
    get binding() {
      calls.bindings++;
      if (released) throw Error('Reference released');
      return binding;
    },
    release() { released = true; calls.releases++; },
  };
  if (!options.wait) opening.resolve(binding);
  return { session, reference, opening, binding, calls, setInbox: (value) => { inbox = value; } };
}

test('send uses queue mode, exact text, submission identity and a caller signal', async () => {
  const h = harness();
  const errors = [];
  const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
  assert.equal(await actions.send('  hello\nworld  '), undefined);
  assert.deepEqual(h.calls.submissions, [{ mode: 'queue', text: '  hello\nworld  ', attachments: [] }]);
  const [content, mode, signal, requestId] = h.calls.prompts[0];
  assert.deepEqual(content, [{ type: 'text', text: '  hello\nworld  ' }]);
  assert.equal(mode, 'queue');
  assert.equal(requestId, 'request-1');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  actions.dispose();
  assert.equal(signal.aborted, false, 'settled admissions no longer belong to actions');
  assert.deepEqual(errors, []);
  assert.equal(h.calls.abandon + h.calls.cancel + h.calls.updates + h.calls.releases, 0);
});

test('send captures the invocation reference even when selection changes while opening', async () => {
  const first = harness({ id: 'first', wait: true });
  const second = harness({ id: 'second' });
  let selected = first.reference;
  let reads = 0;
  const actions = createSessionActions(() => { reads++; return selected; });
  const sending = actions.send('captured');
  selected = second.reference;
  assert.equal(reads, 1);
  assert.equal(first.calls.bindings, 0);
  first.opening.resolve(first.binding);
  await sending;
  assert.equal(first.calls.prompts.length, 1);
  assert.equal(second.calls.prompts.length, 0);
});

test('all operations reject a missing reference and report the same error', async () => {
  const errors = [];
  const actions = createSessionActions(() => undefined, (error) => errors.push(error));
  for (const run of [() => actions.send('hi'), () => actions.stop(), () => actions.loadOlder()]) {
    await assert.rejects(run(), code('reference-missing'));
  }
  assert.equal(errors.length, 3);
  assert.ok(errors.every(code('reference-missing')));
});

for (const target of ['next-turn', 'next-step']) {
  test(`pending ${target} work rejects send without mutating user queue or creating an echo`, async () => {
    const inbox = { ...emptyInbox(), [target]: [{ id: 'inherited', content: 'keep me' }] };
    const h = harness({ inbox, running: true });
    const errors = [];
    const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
    await assert.rejects(actions.send('new text'), code('pending-inbox'));
    assert.deepEqual(inbox[target], [{ id: 'inherited', content: 'keep me' }]);
    assert.equal(h.calls.prompts.length + h.calls.submissions.length + h.calls.updates + h.calls.cancel, 0);
    assert.equal(errors.length, 1);
    assert.ok(code('pending-inbox')(errors[0]));
  });
}

test('inbox guard reads the current projection after ready', async () => {
  const h = harness({ wait: true });
  const actions = createSessionActions(() => h.reference);
  const sending = actions.send('new');
  h.setInbox({ ...emptyInbox(), 'next-turn': [{ id: 'arrived-during-open' }] });
  h.opening.resolve(h.binding);
  await assert.rejects(sending, code('pending-inbox'));
  assert.equal(h.calls.prompts.length + h.calls.submissions.length, 0);
});

test('missing or malformed inbox projection fails closed until a valid empty projection arrives', async () => {
  const h = harness({ inbox: undefined });
  const actions = createSessionActions(() => h.reference);
  for (const value of [undefined, null, [], {}, { 'next-turn': [] }, { 'next-turn': [], 'next-step': 'bad' }]) {
    h.setInbox(value);
    await assert.rejects(actions.send('new'), code('inbox-unavailable'));
  }
  assert.equal(h.calls.prompts.length + h.calls.submissions.length, 0);
  h.setInbox(emptyInbox());
  await actions.send('now ready');
  assert.equal(h.calls.prompts.length, 1);
});

test('running sessions can receive queue prompts if no existing pending work is visible', async () => {
  const h = harness({ running: true });
  await createSessionActions(() => h.reference).send('later');
  assert.equal(h.calls.prompts[0][1], 'queue');
});

test('ready rejection propagates unchanged without borrowing the binding', async () => {
  const h = harness({ wait: true });
  const failure = Error('Opening failed');
  const errors = [];
  const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
  const sending = actions.send('new');
  h.opening.reject(failure);
  await assert.rejects(sending, (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  assert.equal(h.calls.bindings + h.calls.submissions.length + h.calls.prompts.length, 0);
});

test('a released reference is checked after ready rather than using its stale resolved binding', async () => {
  const h = harness();
  const actions = createSessionActions(() => h.reference);
  const sending = actions.send('new');
  h.reference.release();
  await assert.rejects(sending, /Reference released/);
  assert.equal(h.calls.bindings, 1);
  assert.equal(h.calls.prompts.length + h.calls.submissions.length, 0);
});

test('prompt rejection preserves the remote business failure and does not abandon an entered prompt', async () => {
  const h = harness();
  const failure = { code: 'session/denied', message: 'Denied', details: { reason: 'test' } };
  const errors = [];
  h.session.prompt = async () => ({ ok: false, error: failure });
  await assert.rejects(createSessionActions(() => h.reference, (error) => errors.push(error)).send('new'),
    (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  assert.equal(h.calls.abandon, 0);
});

test('thrown prompt failures and beginSubmission failures report their original reason', async () => {
  const h = harness();
  const failure = Error('Transport unavailable');
  const errors = [];
  h.session.prompt = async () => { throw failure; };
  const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
  await assert.rejects(actions.send('new'), (error) => error === failure);
  assert.equal(h.calls.abandon, 0);
  h.session.beginSubmission = () => { throw failure; };
  await assert.rejects(actions.send('another'), (error) => error === failure);
  assert.deepEqual(errors, [failure, failure]);
});

test('pre-prompt failure abandons the registered submission exactly once', async () => {
  const h = harness();
  const failure = Error('Cannot serialize request identity');
  h.session.beginSubmission = () => ({
    get requestId() { throw failure; },
    abandon() { h.calls.abandon++; },
  });
  await assert.rejects(createSessionActions(() => h.reference).send('new'), (error) => error === failure);
  assert.equal(h.calls.abandon, 1);
  assert.equal(h.calls.prompts.length, 0);
});

test('notification failure cannot replace the action rejection', async () => {
  await assert.rejects(createSessionActions(() => undefined, () => { throw Error('Notification failed'); }).send('hi'),
    code('reference-missing'));
});

test('stop only cancels the captured session; loadOlder also captures its invocation reference', async () => {
  const first = harness({ wait: true, inbox: { ...emptyInbox(), 'next-turn': [{ id: 'keep' }] } });
  const second = harness();
  let selected = first.reference;
  const actions = createSessionActions(() => selected);
  const stopping = actions.stop();
  const loading = actions.loadOlder();
  selected = second.reference;
  first.opening.resolve(first.binding);
  await Promise.all([stopping, loading]);
  assert.equal(first.calls.cancel, 1);
  assert.equal(first.calls.older, 1);
  assert.equal(first.calls.updates + first.calls.prompts.length + first.calls.submissions.length + first.calls.releases, 0);
  assert.equal(second.calls.cancel + second.calls.older, 0);
});

test('stop and history failures propagate to the caller and error callback', async () => {
  const h = harness();
  const failure = { code: 'session/cancel-failed', message: 'Failed' };
  const olderFailure = Error('History unavailable');
  h.session.cancel = async () => ({ ok: false, error: failure });
  h.session.loadOlder = async () => { throw olderFailure; };
  const errors = [];
  const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
  await assert.rejects(actions.stop(), (error) => error === failure);
  await assert.rejects(actions.loadOlder(), (error) => error === olderFailure);
  assert.deepEqual(errors, [failure, olderFailure]);
});

test('dispose promptly rejects an unresolved ready wait without host cancellation or reference release', async () => {
  const h = harness({ wait: true });
  const errors = [];
  const actions = createSessionActions(() => h.reference, (error) => errors.push(error));
  const sending = actions.send('new');
  actions.dispose();
  actions.dispose();
  await assert.rejects(sending, code('disposed'));
  assert.equal(h.calls.bindings + h.calls.cancel + h.calls.updates + h.calls.releases, 0);
  assert.deepEqual(errors, [], 'disposed actions do not notify a removed owner');
  h.opening.resolve(h.binding);
  await tick();
  assert.equal(h.calls.prompts.length + h.calls.submissions.length, 0);
  for (const run of [() => actions.send('new'), () => actions.stop(), () => actions.loadOlder()]) {
    await assert.rejects(run(), code('disposed'));
  }
});

test('dispose aborts every local in-flight prompt signal but does not ask the host to stop', async () => {
  const h = harness();
  h.session.prompt = (...args) => {
    h.calls.prompts.push(args);
    const signal = args[2];
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const actions = createSessionActions(() => h.reference);
  const first = actions.send('one');
  const second = actions.send('two');
  await tick();
  assert.equal(h.calls.prompts.length, 2);
  assert.notEqual(h.calls.prompts[0][2], h.calls.prompts[1][2]);
  actions.dispose();
  await assert.rejects(first, code('disposed'));
  await assert.rejects(second, code('disposed'));
  assert.ok(h.calls.prompts.every((args) => args[2].aborted));
  assert.equal(h.calls.cancel + h.calls.updates + h.calls.releases + h.calls.abandon, 0);
});

test('independent actions sharing a reference keep separate request lifetimes', async () => {
  const h = harness();
  const admitted = deferred();
  h.session.prompt = (...args) => {
    h.calls.prompts.push(args);
    const signal = args[2];
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      admitted.promise.then(resolve, reject);
    });
  };
  const first = createSessionActions(() => h.reference);
  const second = createSessionActions(() => h.reference);
  const firstSend = first.send('one');
  const secondSend = second.send('two');
  await tick();
  first.dispose();
  await assert.rejects(firstSend, code('disposed'));
  assert.equal(h.calls.prompts[0][2].aborted, true);
  assert.equal(h.calls.prompts[1][2].aborted, false);
  admitted.resolve(accepted());
  await secondSend;
  second.dispose();
  assert.equal(h.calls.prompts[1][2].aborted, false);
  assert.equal(h.calls.releases + h.calls.cancel, 0);
});
