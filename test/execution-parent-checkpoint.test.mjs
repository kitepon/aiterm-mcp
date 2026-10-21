import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { ParentDeliveryManager } from '../dist/parent-delivery.js';
import { withExecutionRequest } from '../dist/execution-context.js';
const request = { kind: 'delivery', delivery_id: 'original-existing-input', target_session_id: 'bot-b' };
const parent = { thread_id: '00000000-0000-4000-8000-000000000001', codex_home: '/synthetic-parent-home' };
const boundary = { session_id: 'bot-b', launch_id: 'b'.repeat(32), vendor: 'codex', harness: 'codex-cli', event_cursor: 17, operation_id: null };
const until = async check => { const deadline = performance.now() + 1000; while (!check()) {
  assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 2));
} };
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'parent-checkpoint-')); let binds = 0, watches = 0, submits = 0, complete;
  const manager = new ParentDeliveryManager({ root, execution: {
    async bind() { binds++; }, async submit() { submits++; return { queued_submission_id: 'genuine-synthetic-queue-receipt' }; },
  }, dependencies: { processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => true,
    verify: async () => {}, observe: async (_session, options) => { watches++; return new Promise((resolve, reject) => {
      complete = resolve; options.signal.addEventListener('abort', () => reject(Error('synthetic cleanup')), { once: true });
    }); }, answer: async () => ({ text: 'genuine saved synthetic answer' }) } });
  t.after(async () => { await manager.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const delivery = withExecutionRequest(request, () => manager.request(parent));
  const records = () => fs.readdirSync(join(root, 'active')).flatMap(owner => fs.readdirSync(join(root, 'active', owner))
    .filter(file => file !== 'owner.json' && file.endsWith('.json')).map(file => join(root, 'active', owner, file)))
    .concat(fs.readdirSync(join(root, 'results')).filter(file => file.endsWith('.json')).map(file => join(root, 'results', file)));
  return { root, manager, delivery, records, counts: () => ({ binds, watches, submits }),
    done: () => complete({ schema: 'aiterm.agent-wait-result.v1', ...boundary, outcome: 'done', turn_id: 'synthetic-native-turn' }) };
}
function intercept(t, overrides) {
  const original = Object.fromEntries(Object.keys(overrides).map(key => [key, fs[key]]));
  for (const [key, fn] of Object.entries(overrides)) fs[key] = (...args) => fn(original[key], ...args);
  syncBuiltinESMExports();
  const restore = () => { Object.assign(fs, original); syncBuiltinESMExports(); };
  t.after(restore); return restore;
}
function uncertain(error) { return error.code === 'EXECUTION_STATE_UNAVAILABLE' && error.effect === 'possible'; }

test('private reservation and claim directories are flushed before binding and the waiting checkpoint precedes watching', async t => {
  const f = fixture(t), events = [], paths = new Map();
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    fsyncSync(original, fd) { events.push(['sync', paths.get(fd), fs.fstatSync(fd).isDirectory()]); return original(fd); },
    linkSync(original, from, to) { events.push(['claim', to]); return original(from, to); },
  });
  const bind = f.manager.execution.bind;
  f.manager.execution.bind = async (...args) => {
    const claimIndex = events.findIndex(event => event[0] === 'claim'); assert.ok(claimIndex > 0);
    assert.ok(events.slice(0, claimIndex).some(event => event[0] === 'sync' && event[2] === false));
    assert.ok(events.slice(claimIndex + 1).some(event => event[0] === 'sync' && event[1] === join(f.root, 'claims')));
    return bind(...args);
  };
  await f.delivery.before_send(boundary); restore();
  assert.equal(f.delivery.result().state, 'waiting'); assert.deepEqual(f.counts(), { binds: 1, watches: 1, submits: 0 });
  assert.ok(events.filter(event => event[0] === 'sync' && event[2] === false).length >= 2);
});

test('post-reservation rename flush failure retains the original unknown record and blocks bind/watch and later requests', async t => {
  const f = fixture(t); let armed = false, injected = 0;
  const restore = intercept(t, {
    renameSync(original, from, to) { const result = original(from, to); if (to.startsWith(join(f.root, 'active')) && to.endsWith('.json') && !to.endsWith('owner.json')) armed = true; return result; },
    fsyncSync(original, fd) { if (armed && !injected && fs.fstatSync(fd).isDirectory()) { injected++; throw Error('synthetic post-rename ack lost'); } return original(fd); },
  });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore();
  assert.equal(injected, 1); assert.deepEqual(f.counts(), { binds: 0, watches: 0, submits: 0 });
  assert.equal(f.delivery.result().state, 'unknown'); assert.equal(f.records().length, 1);
  const saved = JSON.parse(fs.readFileSync(f.records()[0])); assert.deepEqual(saved.execution.request, request);
  assert.equal(saved.error, 'PARENT_DELIVERY_CHECKPOINT_UNCONFIRMED'); assert.equal(saved.boundary.event_cursor, 17);
  await assert.rejects(f.manager.beforeChange('bot-b'), uncertain);
  await assert.rejects(f.manager.recover(), uncertain);
});

test('claim link acting before response loss retains both same existing references and never repeats the link or bind', async t => {
  const f = fixture(t); let links = 0;
  const restore = intercept(t, { linkSync(original, from, to) { links++; original(from, to); throw Error('synthetic link acted before response loss'); } });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore();
  assert.equal(links, 1); assert.deepEqual(f.counts(), { binds: 0, watches: 0, submits: 0 });
  const claim = JSON.parse(fs.readFileSync(join(f.root, 'claims', 'bot-b.json')));
  const saved = JSON.parse(fs.readFileSync(f.records()[0]));
  assert.equal(claim.delivery_id, saved.delivery_id); assert.deepEqual(claim.execution, saved.execution);
  assert.equal(saved.state, 'unknown'); assert.equal(fs.readdirSync(join(f.root, 'results')).length, 0);
});

test('claim directory flush failure keeps the existing claim and unknown owner without cleaning or replaying', async t => {
  const f = fixture(t); let afterLink = false, injected = 0; const paths = new Map();
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    linkSync(original, ...args) { const result = original(...args); afterLink = true; return result; },
    fsyncSync(original, fd) { if (afterLink && !injected && paths.get(fd) === join(f.root, 'claims')) { injected++; throw Error('synthetic claim flush unavailable'); } return original(fd); },
  });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore();
  assert.equal(injected, 1); assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(f.records()[0])).state, 'unknown'); assert.equal(f.counts().binds, 0);
});

test('finish saves and syncs the result before releasing its matching child claim', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary);
  const events = [], paths = new Map();
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    fsyncSync(original, fd) { events.push(['sync', paths.get(fd)]); return original(fd); },
    renameSync(original, from, to) { events.push(['rename', to]); return original(from, to); },
    unlinkSync(original, file) { events.push(['unlink', file]); return original(file); },
  });
  f.delivery.failed(Error('synthetic input receipt unavailable')); restore();
  const resultIndex = events.findIndex(event => event[0] === 'rename' && dirname(event[1]) === join(f.root, 'results'));
  const claimIndex = events.findIndex(event => event[0] === 'unlink' && dirname(event[1]) === join(f.root, 'claims'));
  assert.ok(resultIndex >= 0); assert.ok(claimIndex > resultIndex);
  assert.ok(events.slice(resultIndex + 1, claimIndex).some(event => event[0] === 'sync' && event[1] === join(f.root, 'results')));
  assert.equal(f.delivery.result().state, 'unknown'); assert.equal(f.counts().submits, 0);
});

test('result rename acting before response loss retains the same inode destination and claim without a second rename', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); let moves = 0;
  const restore = intercept(t, { renameSync(original, from, to) {
    if (dirname(to) === join(f.root, 'results') && from.endsWith('.json')) { moves++; original(from, to); throw Error('synthetic result rename response lost'); }
    return original(from, to);
  } });
  assert.throws(() => f.delivery.failed(Error('synthetic missing receipt')), uncertain); restore();
  assert.equal(moves, 1); assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  const saved = JSON.parse(fs.readFileSync(f.records()[0])); assert.equal(dirname(f.records()[0]), join(f.root, 'results'));
  assert.equal(saved.state, 'unknown'); assert.deepEqual(saved.execution.request, request);
  assert.equal(saved.error, 'PARENT_DELIVERY_CHECKPOINT_UNCONFIRMED'); assert.equal(f.counts().submits, 0);
});

test('result directory flush failure keeps the unknown result and original claim and refuses further admission', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); const paths = new Map(); let moved = false, failed = 0;
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    renameSync(original, from, to) { const result = original(from, to); if (dirname(to) === join(f.root, 'results')) moved = true; return result; },
    fsyncSync(original, fd) { if (moved && !failed && paths.get(fd) === join(f.root, 'results')) { failed++; throw Error('synthetic result directory unavailable'); } return original(fd); },
  });
  assert.throws(() => f.delivery.failed(Error('synthetic missing receipt')), uncertain); restore();
  assert.equal(failed, 1); assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(f.records()[0])).state, 'unknown');
  await assert.rejects(f.manager.prepare(parent), uncertain); assert.equal(f.counts().submits, 0);
});

test('ready checkpoint failure retains the genuine captured answer but cannot submit, infer completion or erase the claim', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); let failNext = false, injected = 0;
  const restore = intercept(t, {
    renameSync(original, from, to) { const result = original(from, to);
      if (to.startsWith(join(f.root, 'active')) && to.endsWith('.json') && JSON.parse(fs.readFileSync(to)).state === 'ready') failNext = true;
      return result; },
    fsyncSync(original, fd) { if (failNext && !injected && fs.fstatSync(fd).isDirectory()) { injected++; throw Error('synthetic ready checkpoint unavailable'); } return original(fd); },
  });
  f.done(); await until(() => injected === 1 && f.delivery.result().state === 'unknown'); restore();
  assert.equal(f.counts().submits, 0); assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  const saved = JSON.parse(fs.readFileSync(f.records()[0])); assert.equal(saved.text, 'genuine saved synthetic answer');
  assert.equal(saved.child_outcome, 'done'); assert.equal(saved.child_turn_id, 'synthetic-native-turn');
  assert.deepEqual(saved.execution.request, request); assert.equal(saved.state, 'unknown');
});

test('waiting checkpoint failure after binding keeps the old claim and references without watch or input', async t => {
  const f = fixture(t); let armed = false, injected = 0;
  const restore = intercept(t, {
    renameSync(original, from, to) { const result = original(from, to);
      if (to.startsWith(join(f.root, 'active')) && to.endsWith('.json') && JSON.parse(fs.readFileSync(to)).state === 'waiting') armed = true;
      return result; },
    fsyncSync(original, fd) { if (armed && !injected && fs.fstatSync(fd).isDirectory()) { injected++; throw Error('synthetic waiting checkpoint failed'); } return original(fd); },
  });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore();
  assert.equal(injected, 1); assert.deepEqual(f.counts(), { binds: 1, watches: 0, submits: 0 });
  assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  const saved = JSON.parse(fs.readFileSync(f.records()[0])); assert.equal(saved.state, 'unknown');
  assert.deepEqual(saved.execution.request, request); assert.equal(saved.boundary.event_cursor, 17);
});

test('lost recovery move acknowledgement preserves the moved unknown record before any receipt callback or watcher', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); await f.manager.close();
  const oldFile = f.records()[0]; let moves = 0, checks = 0, watches = 0;
  const restore = intercept(t, { renameSync(original, from, to) {
    if (from === oldFile) { moves++; original(from, to); throw Error('synthetic recovery move response lost'); }
    return original(from, to);
  } });
  const restored = new ParentDeliveryManager({ root: f.root, execution: { async bind() { assert.fail('no rebind'); },
    async verifyRecovery() { checks++; return true; }, async submit() { assert.fail('no return'); } },
    dependencies: { processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => false,
      verify: async () => assert.fail('no fallback'), observe: async () => { watches++; assert.fail('no wait'); } } });
  try {
    await assert.rejects(restored.recover(), uncertain); restore();
    assert.equal(moves, 1); assert.equal(checks, 0); assert.equal(watches, 0);
    assert.equal(f.records().length, 1); const saved = JSON.parse(fs.readFileSync(f.records()[0]));
    assert.equal(saved.state, 'unknown'); assert.deepEqual(saved.execution.request, request);
    assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), true);
  } finally { restore(); await restored.close(); }
});

test('a definite different claim is kept while only the unbound new reservation is cleaned', async t => {
  const f = fixture(t), other = { delivery_id: '00000000-0000-4000-8000-000000000002' };
  // This is an actual well-formed existing delivery, not a guessed ID or proof.
  const first = withExecutionRequest(request, () => f.manager.request(parent)); await first.before_send(boundary);
  const existing = JSON.parse(fs.readFileSync(f.records()[0]));
  existing.delivery_id = other.delivery_id;
  fs.writeFileSync(join(f.root, 'claims', 'bot-b.json'), JSON.stringify(existing));
  f.manager.beforeChange = async () => {}; // isolate the atomic cross-process claim collision
  const second = withExecutionRequest({ ...request, delivery_id: 'second-existing-input' }, () => f.manager.request(parent));
  await assert.rejects(second.before_send(boundary), error => error.code === 'EXECUTION_BUSY');
  assert.equal(second.result(), null); assert.equal(JSON.parse(fs.readFileSync(join(f.root, 'claims', 'bot-b.json'))).delivery_id, other.delivery_id);
  assert.equal(f.records().length, 1); assert.equal(f.counts().binds, 1);
});

test('persistent file flush failure remains unavailable without bind, a fabricated owner record or native retry', async t => {
  const f = fixture(t); let flushes = 0;
  const restore = intercept(t, { fsyncSync() { flushes++; throw Error('synthetic persistent sync failure'); } });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore();
  assert.equal(flushes, 1); assert.deepEqual(f.counts(), { binds: 0, watches: 0, submits: 0 });
  assert.equal(f.records().length, 0); assert.equal(f.delivery.result().state, 'unknown');
  assert.equal(fs.readdirSync(join(f.root, 'claims')).length, 0);
  await assert.rejects(f.manager.beforeChange('bot-b'), uncertain);
  await assert.rejects(f.manager.recover(), uncertain);
});

test('a later genuine answer cannot queue through another checkpoint failure in the same private manager', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); let armed = false, injected = 0;
  const nextBoundary = { ...boundary, session_id: 'bot-c', launch_id: 'c'.repeat(32) };
  const second = withExecutionRequest({ ...request, delivery_id: 'another-existing-input', target_session_id: 'bot-c' }, () => f.manager.request(parent));
  const restore = intercept(t, {
    renameSync(original, from, to) { const result = original(from, to);
      if (to.startsWith(join(f.root, 'active')) && to.endsWith('.json') && !to.endsWith('owner.json') && JSON.parse(fs.readFileSync(to)).boundary.session_id === 'bot-c') armed = true;
      return result; },
    fsyncSync(original, fd) { if (armed && !injected && fs.fstatSync(fd).isDirectory()) { injected++; throw Error('synthetic other checkpoint failed'); } return original(fd); },
  });
  await assert.rejects(second.before_send(nextBoundary), uncertain); restore();
  f.done(); await until(() => f.delivery.result().state === 'unknown');
  assert.equal(f.counts().submits, 0);
  const saved = f.records().map(file => JSON.parse(fs.readFileSync(file))).find(record => record.boundary.session_id === 'bot-b');
  assert.equal(saved.text, 'genuine saved synthetic answer'); assert.equal(saved.child_outcome, 'done');
  assert.deepEqual(saved.execution.request, request);
});

test('claim unlink response loss retains its result diagnosis without reconstructing or repeating the claim', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); let unlinks = 0;
  const restore = intercept(t, { unlinkSync(original, file) {
    const result = original(file); if (file === join(f.root, 'claims', 'bot-b.json')) { unlinks++; throw Error('synthetic unlink response lost'); }
    return result;
  } });
  assert.throws(() => f.delivery.failed(Error('synthetic missing input receipt')), uncertain); restore();
  assert.equal(unlinks, 1); assert.equal(fs.existsSync(join(f.root, 'claims', 'bot-b.json')), false);
  assert.equal(dirname(f.records()[0]), join(f.root, 'results'));
  const saved = JSON.parse(fs.readFileSync(f.records()[0])); assert.equal(saved.state, 'unknown'); assert.deepEqual(saved.execution.request, request);
  await assert.rejects(f.manager.recover(), uncertain); assert.equal(unlinks, 1); assert.equal(f.counts().submits, 0);
});

test('post-submit result checkpoint loss retains the genuine queue receipt and captured answer without a second submit', async t => {
  const f = fixture(t); await f.delivery.before_send(boundary); let moved = false, injected = 0;
  const paths = new Map();
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    renameSync(original, from, to) { const result = original(from, to); if (dirname(to) === join(f.root, 'results') && from.endsWith('.json')) moved = true; return result; },
    fsyncSync(original, fd) { if (moved && !injected && paths.get(fd) === join(f.root, 'results')) { injected++; throw Error('synthetic post-submit result flush unavailable'); } return original(fd); },
  });
  f.done(); await until(() => injected === 1 && f.delivery.result().state === 'unknown'); restore();
  assert.equal(f.counts().submits, 1); const saved = JSON.parse(fs.readFileSync(f.records()[0]));
  assert.equal(saved.queued_submission_id, 'genuine-synthetic-queue-receipt');
  assert.equal(saved.text, 'genuine saved synthetic answer'); assert.equal(saved.child_outcome, 'done');
  assert.deepEqual(saved.execution.request, request); await assert.rejects(f.manager.recover(), uncertain);
  assert.equal(f.counts().submits, 1);
});

test('reconstruction including a manager without execution adapter preserves the uncertain original claim and diagnosis', async t => {
  const f = fixture(t); let linked = false, failed = 0; const paths = new Map();
  const restore = intercept(t, {
    openSync(original, file, ...args) { const fd = original(file, ...args); paths.set(fd, file); return fd; },
    linkSync(original, ...args) { const result = original(...args); linked = true; return result; },
    fsyncSync(original, fd) { if (linked && !failed && paths.get(fd) === join(f.root, 'claims')) { failed++; throw Error('synthetic claim checkpoint unknown'); } return original(fd); },
  });
  await assert.rejects(f.delivery.before_send(boundary), uncertain); restore(); await f.manager.close();
  const original = JSON.parse(fs.readFileSync(f.records()[0])), claimBefore = fs.readFileSync(join(f.root, 'claims', 'bot-b.json'), 'utf8');
  const restored = new ParentDeliveryManager({ root: f.root, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: 'synthetic-restored-owner' }], exists: () => false,
    verify: async () => assert.fail('no endpoint fallback'), observe: async () => assert.fail('no restored wait'), submit: async () => assert.fail('no restored queue') } });
  try {
    await restored.recover(); const saved = JSON.parse(fs.readFileSync(f.records()[0]));
    assert.equal(saved.state, 'unknown'); assert.equal(saved.error, 'PARENT_DELIVERY_CHECKPOINT_UNCONFIRMED');
    assert.deepEqual(saved.execution, original.execution); assert.deepEqual(saved.boundary, original.boundary);
    assert.equal(fs.readFileSync(join(f.root, 'claims', 'bot-b.json'), 'utf8'), claimBefore);
    assert.equal(f.counts().binds, 0);
  } finally { await restored.close(); }
});
