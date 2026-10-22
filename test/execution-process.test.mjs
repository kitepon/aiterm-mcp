import './seat-env.mjs';
import test from 'node:test';
const posixCheckpoint = process.platform === 'win32' ? 'cross-process private graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionStoreDirectory } from '../dist/execution-store.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const C = { session_id: 'bot-c', launch_id: 'c'.repeat(32) };
const point = launch => ({ launch, boundary: { event_cursor: 1, operation_id: null, turn_id: null, steer_id: null } });
const register = (id, source = A, target = B) => ({ action: 'register', source_session_id: source.session_id,
  reservation: { schema: 'aiterm.execution-reservation.v1',
    request: { kind: 'delivery', delivery_id: id, target_session_id: target.session_id },
    source: { launch: source, boundary: null }, target: { session_id: target.session_id, expected_launch_id: target.launch_id } } });
const stop = roots => ({ schema: 'aiterm.cascade-stop-request.v1', roots });
const ref = record => ({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request });
async function until(check) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    assert.ok(performance.now() < deadline, 'fixture synchronization timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function worker(t, root, scope) {
  const child = fork(new URL('./fixtures/execution-process-worker.mjs', import.meta.url), [root, scope],
    { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const events = [], pending = new Map();
  let serial = 0, output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('message', message => {
    events.push(message);
    if (message.event === 'result') { pending.get(message.id)?.(message); pending.delete(message.id); }
  });
  const ended = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
    assert.equal(output, '', 'fixture worker must not leak stdout/stderr');
  });
  await until(() => events.some(event => event.event === 'ready'));
  return {
    events, directory: events.find(event => event.event === 'ready').directory,
    call(action, args) {
      const id = ++serial;
      const result = new Promise(resolve => pending.set(id, resolve));
      child.send({ id, action, ...args });
      return { id, result };
    },
    release(id) { child.send({ action: 'release', id }); },
    async kill() { child.kill(); await ended; },
  };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'execution-process-'));
  writeFileSync(join(root, 'synthetic-live.json'), JSON.stringify(Object.fromEntries([A, B, C].map(item => [item.session_id, item]))));
  return { root, scope: join(root, 'synthetic.sock') };
}
const parentId = '00000000-0000-4000-8000-000000000001';
const parentEndpoint = { thread_id: 'synthetic-existing-parent-thread' };
const seedParent = worker => worker.call('seedParent', { input: register('parent-ab'), delivery: parentId,
  endpoint: parentEndpoint, child: point(B) }).result;
const state = worker => JSON.parse(readFileSync(join(worker.directory, 'relations.json'), 'utf8'));

test('storage scopes share only the same existing state and multiplexer identity', () => {
  const { root, scope } = fixture();
  const first = executionStoreDirectory(root, { kind: 'socket', key: scope });
  assert.equal(first, executionStoreDirectory(root, { kind: 'socket', key: scope }));
  assert.notEqual(first, executionStoreDirectory(root, { kind: 'namespace', key: scope }));
  assert.notEqual(first, executionStoreDirectory(root, { kind: 'socket', key: scope + '-other' }));
  assert.throws(() => executionStoreDirectory('relative', { kind: 'socket', key: scope }));
});

test('a different process cancels an unissued parent emit without waiting for its receiver', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  assert.equal((await seedParent(one)).error, undefined);
  const emit = one.call('parentNative', { delivery: parentId, endpoint: parentEndpoint, stage: 'emit' });
  await until(() => one.events.some(value => value.event === 'entered' && value.id === emit.id));
  const result = (await two.call('stop', { input: stop([B]) }).result).value;
  assert.equal(result.status, 'stopped');
  one.release(emit.id);
  assert.equal((await emit.result).value.error.effect, 'not_started');
  assert.equal(one.events.filter(value => value.event === 'native-effect').length, 0);
});

test('separate native receiver and stopper share an issued parent-phase slot and drain only that emission', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  await seedParent(one);
  const emit = one.call('parentNative', { delivery: parentId, endpoint: parentEndpoint, stage: 'emit', issueBeforeGate: true });
  await until(() => one.events.some(value => value.event === 'entered' && value.id === emit.id));
  const stopping = two.call('stop', { input: stop([B]) });
  await until(() => state(one).stopping.some(value => value.launch_id === B.launch_id));
  assert.equal(state(one).slots[0].stage, 'parent_emit');
  one.release(emit.id); assert.equal((await emit.result).value.value, 'synthetic-parent-native-receipt');
  assert.equal((await stopping.result).value.status, 'stopped');
  assert.equal(one.events.filter(value => value.event === 'native-effect').length, 1);
});

test('loss of a native receiver keeps its old actor and unknown phase instead of replaying wake', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope);
  await seedParent(one);
  const wake = one.call('parentNative', { delivery: parentId, endpoint: parentEndpoint, stage: 'wake', issueBeforeGate: true });
  await until(() => one.events.some(value => value.event === 'entered' && value.id === wake.id));
  const actor = state(one).parent_effects[0].actor; await one.kill();
  const two = await worker(t, root, scope);
  const retry = (await two.call('parentNative', { delivery: parentId, endpoint: parentEndpoint, stage: 'wake' }).result).value;
  assert.equal(retry.error.effect, 'possible');
  assert.deepEqual(state(two).parent_effects[0].actor, actor);
  assert.equal(two.events.filter(value => value.event === 'native-effect').length, 0);
  assert.equal((await two.call('stop', { input: stop([B]) }).result).value.status, 'partial');
});

test('separate MCP processes share the fence, drain the issued effect and close its late target once', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  assert.equal(one.directory, two.directory);
  const record = (await one.call('execute', { input: register('ab') }).result).value;
  const send = one.call('invoke', { ref: ref(record), target: point(B) });
  await until(() => one.events.some(event => event.event === 'entered' && event.id === send.id));
  const stopping = two.call('stop', { input: stop([A]) });
  await until(() => state(one).stopping.some(value => value.launch_id === A.launch_id));
  const refused = await two.call('execute', { input: register('ac', A, C) }).result;
  assert.equal(refused.error.code, 'EXECUTION_STOPPING');
  const duplicate = await two.call('invoke', { ref: ref(record), target: point(B) }).result;
  assert.ok(duplicate.error);
  one.release(send.id);
  assert.equal((await send.result).value.value, 'synthetic receipt');
  const result = (await stopping.result).value;
  assert.equal(result.status, 'stopped');
  assert.deepEqual(two.events.filter(event => event.event === 'close').map(event => event.launch.session_id).sort(), [A.session_id, B.session_id]);
  assert.equal(one.events.filter(event => event.event === 'entered').length, 1);
});

test('a process lost after issuance remains unconfirmed after reconstruction and never resends', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope);
  const record = (await one.call('execute', { input: register('lost-ab') }).result).value;
  const send = one.call('invoke', { ref: ref(record), target: point(B) });
  await until(() => one.events.some(event => event.event === 'entered' && event.id === send.id));
  await one.kill();
  const two = await worker(t, root, scope);
  const result = (await two.call('stop', { input: stop([A]) }).result).value;
  assert.equal(result.status, 'partial');
  assert.ok(result.unresolved.some(item => item.reason === 'issued_operation_unconfirmed'));
  assert.ok(state(two).slots.some(slot => slot.session_id === B.session_id));
  const retry = await two.call('invoke', { ref: ref(record), target: point(B) }).result;
  assert.ok(retry.error);
  assert.equal(two.events.filter(event => event.event === 'entered').length, 0);
  const fresh = await two.call('execute', { input: register('fresh-cb', C, B) }).result;
  assert.equal(fresh.error.code, 'EXECUTION_UNCONFIRMED');
});

test('a different process cannot cross an issued configuration or erase its unknown response', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  const change = one.call('change', { expected: B, reject: true });
  await until(() => one.events.some(event => event.event === 'entered' && event.id === change.id));
  const before = await two.call('execute', { input: register('before-bc', B, C) }).result;
  assert.equal(before.error.code, 'EXECUTION_UNCONFIRMED');
  one.release(change.id);
  assert.equal((await change.result).error.code, 'EXECUTION_UNCONFIRMED');
  const result = (await two.call('stop', { input: stop([B]) }).result).value;
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.targets[0].outcome, 'unknown');
  assert.equal(two.events.filter(event => event.event === 'close').length, 0);
  assert.equal(state(two).slots[0].state, 'unknown');
});
test('a different MCP process cancels preparing work without waiting for its preflight or sending later', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  const record = (await one.call('execute', { input: register('preparing-ab') }).result).value;
  const send = one.call('invokeDeferred', { ref: ref(record), target: point(B) });
  await until(() => one.events.some(event => event.event === 'entered' && event.id === send.id));
  const result = (await two.call('stop', { input: stop([A]) }).result).value;
  assert.equal(result.status, 'stopped');
  assert.deepEqual(two.events.filter(event => event.event === 'close').map(event => event.launch.session_id), [A.session_id]);
  one.release(send.id);
  assert.equal((await send.result).error.effect, 'not_started');
  assert.equal(one.events.filter(event => event.event === 'native-effect').length, 0);
});
test('a different MCP process drains work that crossed its synchronous native gate', { skip: posixCheckpoint }, async t => {
  const { root, scope } = fixture(), one = await worker(t, root, scope), two = await worker(t, root, scope);
  const record = (await one.call('execute', { input: register('issued-ab') }).result).value;
  const send = one.call('invokeDeferred', { ref: ref(record), target: point(B), issueBeforeGate: true });
  await until(() => one.events.some(event => event.event === 'entered' && event.id === send.id));
  assert.equal(state(one).records[0].operations.send, 'issued');
  const stopping = two.call('stop', { input: stop([A]) });
  await until(() => state(one).stopping.some(value => value.launch_id === A.launch_id));
  assert.equal(two.events.filter(event => event.event === 'close').length, 0);
  one.release(send.id); assert.equal((await send.result).value.value, 'synthetic receipt');
  assert.equal((await stopping.result).value.status, 'stopped');
  assert.equal(one.events.filter(event => event.event === 'native-effect').length, 1);
});
