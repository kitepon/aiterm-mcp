// Real temporary filesystem metadata; all native actors/harnesses/key effects
// are synthetic. No live CLI, PID probe, process/network or seat operation.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { writeExecutionCheckpoint } from '../dist/execution-checkpoint.js';
import { FileExecutionStore, executionStateSchema, emptyExecutionState } from '../dist/execution-store.js';
import { ParticipantExecutionStore } from '../dist/execution-participant-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { interruptionBlocksLaunch, assertInterruptionSource } from '../dist/execution-interruption.js';
import { ExecutionError } from '../dist/execution-wire.js';
const protocol = 'file_and_directory_sync.v1';
const actor = { pid: 47, started_identity: '2026-10-21T09:00:00Z' };
const launch = { session_id: 'checkpoint-target', launch_id: 'a'.repeat(32) }, run = { launch,
  boundary: { event_cursor: 17, turn_id: 'original-native-turn', operation_id: null, steer_id: null } };
function temporary(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'execution-checkpoint-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function intercept(t, overrides) {
  const original = Object.fromEntries(Object.keys(overrides).map(name => [name, fs[name]]));
  for (const [name, fn] of Object.entries(overrides)) fs[name] = (...args) => fn(original[name], ...args);
  syncBuiltinESMExports();
  t.after(() => { Object.assign(fs, original); syncBuiltinESMExports(); });
}
function fixture(t) {
  let scope = true;
  const dir = temporary(t), raw = new FileExecutionStore(dir), store = new ParticipantExecutionStore(dir, actor,
    () => { if (!scope) throw new ExecutionError('EXECUTION_UNSUPPORTED'); });
  store.enroll(['mcp']); let keys = 0;
  const observation = { schema: 'aiterm.native-interruption-observation.v1', run,
    native: { schema: 'aiterm.execution-native.v1', native_id: '$2', server: { pid: 4711, started_identity: actor.started_identity } },
    harness: 'codex-cli', harness_process: { pid: 200, started_identity: actor.started_identity },
    endpoint: { session_id: 'native-conversation', record_file: { device: 1, inode: 2 } }, recorded_state: 'running',
    native_boundary: { type: 'task_started', turn_id: run.boundary.turn_id, reason: null }, invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
  const runtime = { observeSync: () => ({ state: 'present', launch }), async observe() { return this.observeSync(); },
    interruptionSync: () => structuredClone(observation), selectInterruptionSync: () => structuredClone(observation),
    async coverage() { return 'incomplete'; } };
  const key = () => { guardTmuxExecution(['send-keys', '-t', '$2', 'Escape']); keys++;
    return { schema: 'aiterm.pty-key-result.v1', session_id: launch.session_id, key: 'Escape', outcome: 'accepted',
      interruption: 'unconfirmed', session_preserved: 'unconfirmed' }; };
  runtime.interruptKeySync = key;
  const state = () => raw.transactionSync(state => structuredClone(state), { readOnly: true });
  return { dir, raw, store, runtime, service: new ExecutionService(store, runtime), key, keys: () => keys, state,
    loseScope() { scope = false; } };
}
test('checkpoint syncs private file before rename and each directory entry through the filesystem root before returning', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), file = join(dir, 'relations.json'), events = [], paths = new Map();
  intercept(t, {
    openSync(original, path, ...args) { const fd = original(path, ...args); paths.set(fd, path); return fd; },
    fsyncSync(original, fd) { events.push(['sync', paths.get(fd), fs.fstatSync(fd).isDirectory()]); return original(fd); },
    renameSync(original, from, to) { events.push(['rename', to]); return original(from, to); },
  });
  writeExecutionCheckpoint(file, { saved: 1 });
  assert.equal(events[0][0], 'sync'); assert.equal(events[0][2], false); assert.equal(events[1][0], 'rename');
  let directory = dir;
  for (const event of events.slice(2)) { assert.deepEqual(event, ['sync', directory, true]); directory = dirname(directory); }
  assert.equal(events.at(-1)[1], dirname(directory));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.deepEqual(fs.readdirSync(dir), ['relations.json']);
});
test('file flush failure leaves the previous state and removes only the uncommitted temporary file', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), file = join(dir, 'relations.json'); writeExecutionCheckpoint(file, { old: 1 });
  intercept(t, { fsyncSync() { throw Error('synthetic file sync failure'); } });
  assert.throws(() => writeExecutionCheckpoint(file, { new: 2 }), error => error.code === 'EXECUTION_STATE_UNAVAILABLE' && error.effect === 'possible');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { old: 1 }); assert.deepEqual(fs.readdirSync(dir), ['relations.json']);
});
test('post-rename directory flush failure is not rolled back or treated as checkpoint success', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), file = join(dir, 'relations.json'); writeExecutionCheckpoint(file, { old: 1 });
  intercept(t, { fsyncSync(original, fd) { if (fs.fstatSync(fd).isDirectory()) throw Error('synthetic directory sync failure'); return original(fd); } });
  assert.throws(() => writeExecutionCheckpoint(file, { new: 2 }), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { new: 2 }); assert.deepEqual(fs.readdirSync(dir), ['relations.json']);
});
test('scoped preparing and issued checkpoints finish before the first synthetic key; receipt retains unknown fence', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), flushed = [];
  await f.service.beginInterruption(run);
  intercept(t, { fsyncSync(original, fd) {
    if (fs.fstatSync(fd).isDirectory()) flushed.push(JSON.parse(fs.readFileSync(join(f.dir, 'relations.json'))).interruptions[0]?.phase);
    return original(fd);
  } });
  await f.service.interruptRun(run, () => {
    assert.ok(flushed.includes('preparing'));
    const receipt = f.key(); assert.ok(flushed.includes('issued')); return receipt;
  });
  assert.equal(f.keys(), 1); const row = f.state().interruptions[0];
  assert.equal(row.checkpoint, protocol); assert.deepEqual(row.caller, actor); assert.equal(row.phase, 'accepted');
  assert.equal(row.before.invocation_fence, 'unknown');
});
test('a failed issued directory flush keeps the visible issued slot, prevents the key and is never retried by reconstruction', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); let failed = false;
  intercept(t, { fsyncSync(original, fd) {
    if (!failed && fs.fstatSync(fd).isDirectory() && JSON.parse(fs.readFileSync(join(f.dir, 'relations.json'))).interruptions[0]?.phase === 'issued') {
      failed = true; throw Error('synthetic issued directory sync failure');
    }
    return original(fd);
  } });
  await assert.rejects(f.service.interruptRun(run, f.key), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(f.keys(), 0); assert.equal(f.state().interruptions[0].phase, 'issued'); assert.equal(f.state().slots[0].state, 'issued');
  await assert.rejects(new ExecutionService(f.store, f.runtime).interruptRun(run, f.key));
  assert.equal(f.keys(), 0); assert.equal(f.state().interruptions[0].phase, 'issued');
});
test('a failed preparing flush retains its caller checkpoint and cannot be promoted to a native receipt', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); let failed = false;
  intercept(t, { fsyncSync(original, fd) {
    if (!failed && fs.fstatSync(fd).isDirectory()) { failed = true; throw Error('synthetic preparing sync failure'); }
    return original(fd);
  } });
  await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 0);
  assert.equal(f.state().interruptions[0].phase, 'preparing'); assert.equal(f.state().interruptions[0].checkpoint, protocol);
  await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 0);
});
test('a scoped actor without the durable store protocol is refused before claiming the run', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  f.store.interruptionCheckpoint = undefined;
  await assert.rejects(f.service.interruptRun(run, f.key), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(f.state().interruptions[0].phase, 'draining'); assert.equal(f.keys(), 0);
});
test('a checkpoint marker is tied to the original caller and cannot be attached to an unclaimed or callerless row', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  const state = f.state(); state.interruptions[0].checkpoint = protocol;
  assert.equal(executionStateSchema.safeParse(state).success, false);
  state.interruptions[0].phase = 'preparing'; assert.equal(executionStateSchema.safeParse(state).success, false);
});

async function abandoned(t) {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => { f.loseScope(); return f.key(); }));
  assert.equal(f.state().interruptions[0].phase, 'preparing');
  const nextActor = { pid: 49, started_identity: '2026-10-21T09:01:00Z' };
  const nextStore = new ParticipantExecutionStore(f.dir, nextActor, () => {}); nextStore.enroll(['mcp']);
  return { ...f, nextActor, nextStore, next: new ExecutionService(nextStore, f.runtime) };
}
test('explicit preparing reconciliation proves only the unissued key and retains the original run barrier and references', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t), before = f.state(), probes = [];
  const result = f.next.reconcilePreparingInterruption(run, actor, pid => { probes.push(pid); return { state: 'absent', pid }; });
  assert.deepEqual(probes, [47, 47]); assert.equal(result.key, 'not_sent'); assert.equal(result.admission, 'retained');
  assert.equal(result.native_fence, 'unknown'); assert.equal(result.interruption, 'unconfirmed'); assert.equal(result.session_preserved, 'unconfirmed');
  const state = f.state(), row = state.interruptions[0];
  assert.equal(row.phase, 'preparing'); assert.deepEqual(row.caller, actor); assert.equal(row.preparing_resolution, 'key_not_sent');
  assert.equal(interruptionBlocksLaunch(state, launch), true);
  assert.throws(() => assertInterruptionSource(state, run, launch.session_id));
  assert.deepEqual(state.records, before.records); assert.deepEqual(state.parent_deliveries, before.parent_deliveries);
  assert.deepEqual(row.requests, before.interruptions[0].requests); assert.deepEqual(row.parent_deliveries, before.interruptions[0].parent_deliveries);
  await assert.rejects(f.next.interruptRun(run, f.key));
  const resultAfter = await f.next.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [launch] });
  assert.equal(resultAfter.targets[0].key_receipt, 'not_sent'); assert.equal(resultAfter.targets[0].key, null);
  assert.equal(resultAfter.targets[0].interruption, 'unconfirmed'); assert.equal(resultAfter.targets[0].session_preserved, 'unconfirmed');
  assert.equal(f.keys(), 0); assert.deepEqual(f.state().interruptions[0], row);
});
test('missing, unknown, reused/present PID, wrong PID and asynchronous absence observations cannot reconcile preparing', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t), before = f.state().interruptions[0];
  for (const observe of [() => null, () => ({ state: 'unknown', pid: 47 }),
    () => ({ state: 'present', actor }), () => ({ state: 'present', actor: { ...actor, started_identity: f.nextActor.started_identity } }),
    () => ({ state: 'absent', pid: 48 }), () => Promise.reject(Error('synthetic asynchronous probe'))]) {
    assert.throws(() => f.next.reconcilePreparingInterruption(run, actor, observe));
    assert.deepEqual(f.state().interruptions[0], before);
  }
  let count = 0;
  assert.throws(() => f.next.reconcilePreparingInterruption(run, actor, pid => ++count === 1 ? { state: 'absent', pid } : { state: 'unknown', pid }));
  assert.deepEqual(f.state().interruptions[0], before); assert.equal(f.keys(), 0);
});
test('legacy preparing metadata without this durable writer marker is not filled or reconciled by the new process', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t); f.raw.transactionSync(state => { delete state.interruptions[0].checkpoint; });
  const before = f.state().interruptions[0]; let probes = 0;
  assert.throws(() => f.next.reconcilePreparingInterruption(run, actor, () => { probes++; return { state: 'absent', pid: 47 }; }));
  assert.equal(probes, 0); assert.deepEqual(f.state().interruptions[0], before); assert.equal(f.keys(), 0);
});
test('issued, accepted and unknown key attempts are never reconciled from native caller absence', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t);
  for (const phase of ['issued', 'accepted', 'unknown']) {
    f.raw.transactionSync(state => { state.interruptions[0].phase = phase;
      state.slots = [{ session_id: launch.session_id, expected_launch_id: launch.launch_id, stage: 'interrupt', state: 'unknown', request: null, run }]; });
    const before = f.state(); let probes = 0;
    assert.throws(() => f.next.reconcilePreparingInterruption(run, actor, () => { probes++; return { state: 'absent', pid: 47 }; }));
    assert.equal(probes, 0); assert.deepEqual(f.state(), before);
  }
  assert.equal(f.keys(), 0);
});
test('a preparing row with any interrupt slot for its session cannot be diagnosed as key-not-sent', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t);
  f.raw.transactionSync(state => { state.slots.push({ session_id: launch.session_id, expected_launch_id: launch.launch_id,
    stage: 'interrupt', state: 'issued', request: null, run: { ...run, boundary: { ...run.boundary, turn_id: 'other-native-turn' } } }); });
  const before = f.state(); assert.throws(() => f.next.reconcilePreparingInterruption(run, actor, pid => ({ state: 'absent', pid })));
  assert.deepEqual(f.state(), before); assert.equal(f.keys(), 0);
});
test('scope loss during the absence probes cannot commit preparing reconciliation', { skip: posixCheckpoint }, async t => {
  const f = await abandoned(t); let scope = true;
  const store = new ParticipantExecutionStore(f.dir, { pid: 51, started_identity: actor.started_identity },
    () => { if (!scope) throw new ExecutionError('EXECUTION_UNSUPPORTED'); }); store.enroll(['mcp']);
  const service = new ExecutionService(store, f.runtime), before = f.state().interruptions[0];
  assert.throws(() => service.reconcilePreparingInterruption(run, actor, pid => { scope = false; return { state: 'absent', pid }; }));
  assert.deepEqual(f.state().interruptions[0], before); assert.equal(f.keys(), 0);
});
test('a late old caller frame cannot issue or clear the retained barrier after explicit preparing diagnosis', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  const nextStore = new ParticipantExecutionStore(f.dir, { pid: 49, started_identity: actor.started_identity }, () => {}); nextStore.enroll(['mcp']);
  const next = new ExecutionService(nextStore, f.runtime);
  await assert.rejects(f.service.interruptRun(run, () => {
    // Synthetic absence makes the otherwise-unreachable late-callback race
    // observable. No real native absence or current process death is claimed.
    next.reconcilePreparingInterruption(run, actor, pid => ({ state: 'absent', pid })); return f.key();
  }));
  assert.equal(f.keys(), 0); assert.equal(f.state().interruptions[0].preparing_resolution, 'key_not_sent');
  assert.equal(f.state().interruptions[0].phase, 'preparing'); assert.equal(interruptionBlocksLaunch(f.state(), launch), true);
});
test('loss of an initialized graph without any lock recovery evidence cannot bootstrap an empty scope or native key', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); await f.service.interruptRun(run, f.key);
  assert.equal(f.keys(), 1); fs.unlinkSync(join(f.dir, 'relations.json'));
  const next = new FileExecutionStore(f.dir);
  assert.throws(() => next.transactionSync(() => assert.fail('no empty graph callback')), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  await assert.rejects(next.transaction(() => assert.fail('no empty graph callback')), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(fs.existsSync(join(f.dir, 'relations.json')), false); assert.equal(f.keys(), 1);
});
test('first graph checkpoint failure after a durable initialization marker remains unavailable on reconstruction', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), store = new FileExecutionStore(dir);
  intercept(t, { renameSync(original, from, to) {
    if (to === join(dir, 'relations.json')) throw Error('synthetic first graph rename failure'); return original(from, to);
  } });
  assert.throws(() => store.transactionSync(() => {}), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(fs.existsSync(join(dir, 'relations.initialized.json')), true); assert.equal(fs.existsSync(join(dir, 'relations.json')), false);
  assert.throws(() => new FileExecutionStore(dir).transactionSync(() => assert.fail('no empty reconstruction')), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
});
test('invalid or symlink initialization metadata refuses even an otherwise valid graph rather than resetting the marker', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), store = new FileExecutionStore(dir); store.transactionSync(() => {});
  const marker = join(dir, 'relations.initialized.json'), graph = fs.readFileSync(join(dir, 'relations.json'), 'utf8');
  for (const invalid of ['{', '{}', '"unsupported-marker"']) {
    fs.writeFileSync(marker, invalid);
    assert.throws(() => store.transactionSync(() => assert.fail('no invalid marker callback')), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
    assert.equal(fs.readFileSync(marker, 'utf8'), invalid); assert.equal(fs.readFileSync(join(dir, 'relations.json'), 'utf8'), graph);
  }
  fs.unlinkSync(marker); const target = join(dir, 'marker-target'); fs.writeFileSync(target, '"aiterm.execution-store.v1"'); fs.symlinkSync(target, marker);
  assert.throws(() => store.transactionSync(() => assert.fail('no symlink marker callback')), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(fs.lstatSync(marker).isSymbolicLink(), true);
});
test('a valid legacy graph can gain only store continuity metadata on write, never retroactive caller checkpoint evidence', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), state = emptyExecutionState(), graph = join(dir, 'relations.json'), marker = join(dir, 'relations.initialized.json');
  fs.writeFileSync(graph, JSON.stringify(state)); const store = new FileExecutionStore(dir);
  assert.deepEqual(store.transactionSync(state => state, { readOnly: true }), state); assert.equal(fs.existsSync(marker), false);
  store.transactionSync(() => {}); assert.equal(JSON.parse(fs.readFileSync(marker)), 'aiterm.execution-store.v1');
  assert.deepEqual(JSON.parse(fs.readFileSync(graph)), state);
});
test('invalid bootstrap state is refused before initialization and a read-only empty lookup never enrolls a scope', { skip: posixCheckpoint }, t => {
  const dir = temporary(t), store = new FileExecutionStore(dir);
  assert.throws(() => store.transactionSync(state => { state.schema = 'invalid'; }));
  assert.equal(fs.existsSync(join(dir, 'relations.initialized.json')), false);
  assert.deepEqual(store.transactionSync(state => state, { readOnly: true }), emptyExecutionState());
  assert.equal(fs.existsSync(join(dir, 'relations.initialized.json')), false);
});

test('Windows explicitly rejects the private POSIX checkpoint before writing state', { skip: process.platform !== 'win32' }, t => {
  const dir = temporary(t), file = join(dir, 'relations.json');
  assert.throws(() => writeExecutionCheckpoint(file, { saved: 1 }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.deepEqual(fs.readdirSync(dir), []);
});
