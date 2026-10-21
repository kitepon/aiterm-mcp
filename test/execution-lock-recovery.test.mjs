// All actors/native PID observations are synthetic; no child, signal effect,
// CLI, live session, network, automatic lock theft or operation replay.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, symlinkSync, utimesSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileExecutionStore, emptyExecutionState } from '../dist/execution-store.js';
import { ParticipantExecutionStore } from '../dist/execution-participant-store.js';
import { ExecutionService } from '../dist/execution-service.js';

const saved = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn }, savedKill = process.kill;
let probeMode = null;
process.kill = (pid, signal) => {
  assert.equal(pid, 7331); assert.equal(signal, 0); assert.ok(probeMode, 'no real PID probe');
  if (probeMode === 'absent' || probeMode === 'io') throw Object.assign(Error('synthetic'), { code: probeMode === 'absent' ? 'ESRCH' : 'EIO' });
  return true;
};
childProcess.spawn = () => assert.fail('no child');
childProcess.spawnSync = (bin, args) => {
  assert.ok(probeMode, 'no native fallback'); assert.equal(bin, '/bin/ps'); assert.deepEqual(args, ['-o', 'pid=,lstart=', '-p', '7331']);
  return { status: probeMode === 'failure' ? 2 : 0,
    stdout: probeMode === 'present' ? '7331 Wed Oct 21 09:00:00 2026\n' : '', stderr: '' };
};
syncBuiltinESMExports();
const { observeExecutionActor } = await import('../dist/process-runtime.js');
test.after(() => { Object.assign(childProcess, saved); process.kill = savedKill; syncBuiltinESMExports(); });
test.afterEach(() => { probeMode = null; });
const old = { pid: 47, started_identity: '2026-10-21T09:00:00Z' }, current = { pid: 49, started_identity: '2026-10-21T09:01:00Z' };
const code = value => error => error.code === value;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'execution-lock-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'relations.json'), lock = join(directory, 'transaction.lock');
  writeFileSync(file, JSON.stringify(emptyExecutionState()) + '\n');
  const raw = new FileExecutionStore(directory, 1), store = new ParticipantExecutionStore(directory, current, () => {});
  const abandoned = (actor = old) => { mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), JSON.stringify({ schema: 'aiterm.execution-lock-owner.v1', actor }) + '\n'); };
  return { directory, file, lock, raw, store, abandoned };
}
test('new private participant locks identify only their existing native actor and release without a new state identifier', { skip: posixCheckpoint }, t => {
  const f = fixture(t); f.store.enroll(['mcp']);
  f.store.transactionSync(() => {
    assert.deepEqual(JSON.parse(readFileSync(join(f.lock, 'owner.json'))), { schema: 'aiterm.execution-lock-owner.v1', actor: current });
  }, { readOnly: true });
  assert.equal(existsSync(f.lock), false);
  assert.equal('lock_owner' in JSON.parse(readFileSync(f.file)), false);
});
test('explicit native PID absence releases only the abandoned mutex, keeping relation bytes and all uncertainty unchanged', { skip: posixCheckpoint }, t => {
  for (const observation of [{ state: 'absent', pid: old.pid }]) {
    const f = fixture(t), before = readFileSync(f.file, 'utf8'); f.abandoned(); let reads = 0;
    const result = f.store.recoverAbandonedLock(old, pid => { assert.equal(pid, old.pid); reads++; return observation; });
    assert.equal(reads, 2); assert.equal(result.outcome, 'released'); assert.equal(result.operation_state, 'unreconciled');
    assert.equal(result.native_fence, 'unknown'); assert.equal(result.relation_coverage, 'incomplete');
    assert.equal(readFileSync(f.file, 'utf8'), before); assert.equal(existsSync(f.lock), false);
    const retained = readdirSync(f.directory).filter(name => name.startsWith('abandoned-transaction-lock-'));
    assert.equal(retained.length, 1); assert.deepEqual(JSON.parse(readFileSync(join(f.directory, retained[0], 'owner.json'))).actor, old);
    assert.equal(result.quarantine, 'retained');
  }
});
test('a matching live owner is never stolen on age, repeated calls, or ordinary store reconstruction', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.abandoned(); const before = readFileSync(join(f.lock, 'owner.json'), 'utf8');
  utimesSync(f.lock, new Date('2000-01-01'), new Date('2000-01-01'));
  for (let i = 0; i < 2; i++) assert.throws(() => f.store.recoverAbandonedLock(old, () => ({ state: 'present', actor: old })), code('EXECUTION_STATE_UNAVAILABLE'));
  assert.throws(() => f.raw.transactionSync(() => assert.fail('not entered')), code('EXECUTION_BUSY'));
  await assert.rejects(new FileExecutionStore(f.directory, 1).transaction(() => assert.fail('not entered')), code('EXECUTION_BUSY'));
  assert.equal(readFileSync(join(f.lock, 'owner.json'), 'utf8'), before);
});
test('missing, malformed, async and wrong-PID native evidence never proves a dead owner', { skip: posixCheckpoint }, async t => {
  for (const observe of [() => undefined, () => [], () => ({ state: 'unknown', pid: old.pid }), () => ({ state: 'absent', pid: 999 }),
    () => ({ state: 'present', actor: { ...old, started_identity: current.started_identity } }),
    () => ({ state: 'present', actor: { ...current, pid: 999 } }), () => ({ state: 'present', actor: { ...old, started_identity: null } }),
    () => Promise.resolve({ state: 'absent', pid: old.pid }), () => Promise.reject(Error('missing')), () => { throw Error('missing'); }]) {
    const f = fixture(t); f.abandoned(); const before = readFileSync(join(f.lock, 'owner.json'), 'utf8');
    assert.throws(() => f.store.recoverAbandonedLock(old, observe), code('EXECUTION_STATE_UNAVAILABLE'));
    assert.equal(readFileSync(join(f.lock, 'owner.json'), 'utf8'), before);
  }
});
test('legacy empty/partial/symlink locks or unexpected contents remain unavailable without repair or deletion', { skip: posixCheckpoint }, t => {
  for (const change of ['empty', 'partial', 'symlink', 'extra', 'different-owner']) {
    const f = fixture(t); f.abandoned(change === 'different-owner' ? current : old);
    if (change === 'empty') rmSync(join(f.lock, 'owner.json'));
    if (change === 'partial') writeFileSync(join(f.lock, 'owner.json'), '{');
    if (change === 'symlink') { rmSync(join(f.lock, 'owner.json')); symlinkSync(f.file, join(f.lock, 'owner.json')); }
    if (change === 'extra') writeFileSync(join(f.lock, 'unknown'), 'must remain');
    assert.throws(() => f.store.recoverAbandonedLock(old, () => ({ state: 'absent', pid: old.pid })), code('EXECUTION_STATE_UNAVAILABLE'));
    assert.equal(existsSync(f.lock), true);
  }
});
test('recovery rechecks owner death and exact filesystem identity instead of deleting a replacement lock', { skip: posixCheckpoint }, t => {
  for (const change of ['replacement-lock', 'owner-alive-on-second-read']) {
    const f = fixture(t); f.abandoned(); let reads = 0;
    assert.throws(() => f.store.recoverAbandonedLock(old, () => {
      reads++;
      if (change === 'replacement-lock' && reads === 1) { renameSync(f.lock, join(f.directory, 'retained-original')); f.abandoned(current); }
      return change === 'owner-alive-on-second-read' && reads === 2 ? { state: 'present', actor: old } : { state: 'absent', pid: old.pid };
    }), code('EXECUTION_STATE_UNAVAILABLE'));
    assert.deepEqual(JSON.parse(readFileSync(join(f.lock, 'owner.json'))).actor, change === 'replacement-lock' ? current : old);
  }
});
test('the old mutex prevents new writers from entering before repair; waiters proceed only after its atomic quarantine', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.abandoned(); let pending, recovered = false, calls = 0;
  f.store.recoverAbandonedLock(old, () => {
    assert.throws(() => f.raw.transactionSync(() => assert.fail('no synchronous entry during recovery')), code('EXECUTION_BUSY'));
    if (!pending) pending = f.raw.transaction(() => { assert.equal(recovered, true); calls++; }, { readOnly: true });
    return { state: 'absent', pid: old.pid };
  });
  recovered = true; await pending; assert.equal(calls, 1);
});
test('an existing quarantine or a participant scope change cannot be silently repaired', { skip: posixCheckpoint }, t => {
  for (const change of ['quarantine', 'scope']) {
    const f = fixture(t); f.abandoned(); let scope = true;
    const store = new ParticipantExecutionStore(f.directory, current, () => { if (!scope) throw Error('scope changed'); });
    if (change === 'quarantine') {
      const stat = lstatSync(f.lock, { bigint: true }), other = join(f.directory, `abandoned-transaction-lock-${stat.dev}-${stat.ino}`);
      mkdirSync(other); writeFileSync(join(other, 'owner.json'), 'retained evidence');
    }
    assert.throws(() => store.recoverAbandonedLock(old, () => {
      if (change === 'scope') scope = false;
      return { state: 'absent', pid: old.pid };
    }));
    assert.equal(existsSync(f.lock), true);
  }
});
test('a competing recovery in the final rename window cannot quarantine the next live owner', { skip: posixCheckpoint }, t => {
  const f = fixture(t); f.abandoned(); const originalRename = fs.renameSync; let armed = true;
  fs.renameSync = (source, target) => {
    if (armed && source === f.lock) {
      armed = false;
      f.store.recoverAbandonedLock(old, () => ({ state: 'absent', pid: old.pid }));
      f.abandoned(current); // a legitimate new writer acquired the now free mutex
    }
    return originalRename(source, target);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => f.store.recoverAbandonedLock(old, () => ({ state: 'absent', pid: old.pid })), code('EXECUTION_STATE_UNAVAILABLE')); }
  finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
  assert.deepEqual(JSON.parse(readFileSync(join(f.lock, 'owner.json'))).actor, current);
  assert.equal(readdirSync(f.directory).filter(name => name.startsWith('abandoned-transaction-lock-')).length, 1);
});
test('releasing a proven abandoned mutex never repairs a corrupt graph or recreates missing execution evidence', { skip: posixCheckpoint }, t => {
  for (const missing of [false, true]) {
    const f = fixture(t); if (missing) rmSync(f.file); else writeFileSync(f.file, '{'); f.abandoned();
    f.store.recoverAbandonedLock(old, () => ({ state: 'absent', pid: old.pid }));
    assert.throws(() => f.raw.transactionSync(() => assert.fail('no lost/corrupt graph callback')), code('EXECUTION_STATE_UNAVAILABLE'));
    assert.throws(() => f.store.enroll(['mcp']), code('EXECUTION_STATE_UNAVAILABLE'));
    if (missing) assert.equal(existsSync(f.file), false); else assert.equal(readFileSync(f.file, 'utf8'), '{');
  }
});
test('normal transaction completion never deletes a replaced mutex owned by another process', { skip: posixCheckpoint }, t => {
  const f = fixture(t); f.store.enroll(['mcp']);
  f.store.transactionSync(() => { renameSync(f.lock, join(f.directory, 'retained-ours')); f.abandoned(old); }, { readOnly: true });
  assert.deepEqual(JSON.parse(readFileSync(join(f.lock, 'owner.json'))).actor, old);
});
test('participant scope is rechecked after asynchronous metadata preparation, before committing', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); let valid = true;
  const store = new ParticipantExecutionStore(f.directory, current, () => { if (!valid) throw Error('scope gone'); });
  store.enroll(['mcp']); const before = readFileSync(f.file, 'utf8');
  await assert.rejects(store.transaction(async state => { state.participants[0].roles.push('parent_worker'); await Promise.resolve(); valid = false; }), /scope gone/);
  assert.equal(readFileSync(f.file, 'utf8'), before); assert.equal(existsSync(f.lock), false);
});
test('a mistakenly async synchronous metadata callback is rejected without committing, leaking a lock, or an unhandled rejection', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.store.enroll(['mcp']); const before = readFileSync(f.file, 'utf8');
  for (const store of [f.raw, f.store]) {
    assert.throws(() => store.transactionSync(async state => {
      state.participants = []; await Promise.resolve(); throw Error('synthetic late metadata rejection');
    }), code('EXECUTION_INVALID'));
    await new Promise(done => setImmediate(done));
    assert.equal(readFileSync(f.file, 'utf8'), before); assert.equal(existsSync(f.lock), false);
  }
});
test('metadata lock recovery does not reconcile uncertain interruption slots or authorize the key to be sent again', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), launch = { session_id: 'lock-interrupt', launch_id: 'a'.repeat(32) };
  const run = { launch, boundary: { event_cursor: 17, turn_id: 'existing-native-turn', operation_id: null, steer_id: null } };
  const state = emptyExecutionState();
  const before = { schema: 'aiterm.native-interruption-observation.v1', run, native: { schema: 'aiterm.execution-native.v1',
    native_id: '$2', server: { pid: 4711, started_identity: '2026-10-21T09:00:00Z' } }, harness: 'codex-cli',
    harness_process: { pid: 200, started_identity: '2026-10-21T09:00:01Z' }, endpoint: { session_id: 'conversation', record_file: { device: 1, inode: 2 } },
    recorded_state: 'running', native_boundary: { type: 'task_started', turn_id: run.boundary.turn_id, reason: null },
    invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
  state.interruptions.push({ before, phase: 'unknown', requests: [], parent_deliveries: [] });
  state.slots.push({ stage: 'interrupt', session_id: launch.session_id, expected_launch_id: launch.launch_id, state: 'unknown', request: null, run });
  writeFileSync(f.file, JSON.stringify(state)); f.abandoned(); const bytes = readFileSync(f.file, 'utf8');
  f.store.recoverAbandonedLock(old, () => ({ state: 'absent', pid: old.pid })); assert.equal(readFileSync(f.file, 'utf8'), bytes);
  f.store.enroll(['mcp']); let keys = 0;
  const service = new ExecutionService(f.store, { observeSync: () => ({ state: 'present', launch }),
    async observe() { return this.observeSync(); }, async coverage() { return 'incomplete'; },
    interruptionSync: () => before, selectInterruptionSync: () => before, interruptKeySync() { keys++; assert.fail('never retry'); } });
  await assert.rejects(service.interruptRun(run, () => { keys++; }));
  const result = await service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [launch] });
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'unknown'); assert.equal(keys, 0);
  const saved = f.store.transactionSync(value => value, { readOnly: true });
  assert.equal(saved.interruptions[0].phase, 'unknown'); assert.equal(saved.slots[0].state, 'unknown');
});
test('native actor reader requires a valid identity or explicit ESRCH; empty reads and other PID-probe failures stay unknown', { skip: process.platform === 'win32' }, () => {
  for (const mode of ['present', 'absent', 'io', 'empty', 'failure']) {
    probeMode = mode; const observed = observeExecutionActor(7331);
    assert.equal(observed.state, mode === 'present' ? 'present' : mode === 'absent' ? 'absent' : 'unknown');
    if (mode === 'present') assert.deepEqual(observed.actor, { pid: 7331, started_identity: 'Wed Oct 21 09:00:00 2026' });
  }
});
