// Fake native identities and key/fence evidence only. The caller is the MCP
// process that issues Esc, not the target CLI, source turn or an inferred job.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ParticipantExecutionStore } from '../dist/execution-participant-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { ExecutionError } from '../dist/execution-wire.js';
const actor = { pid: 47, started_identity: '2026-10-21T09:00:00Z' }, other = { pid: 49, started_identity: '2026-10-21T09:01:00Z' };
const launch = { session_id: 'caller-target', launch_id: 'a'.repeat(32) }, run = { launch,
  boundary: { event_cursor: 17, turn_id: 'original-native-turn', operation_id: null, steer_id: null } };
const input = { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [launch] };
function fixture(t, roles = ['mcp']) {
  const dir = mkdtempSync(join(tmpdir(), 'interruption-caller-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let scope = true, keys = 0;
  const raw = new FileExecutionStore(dir), store = new ParticipantExecutionStore(dir, actor, () => { if (!scope) throw new ExecutionError('EXECUTION_UNSUPPORTED'); });
  store.enroll(roles);
  const observation = { schema: 'aiterm.native-interruption-observation.v1', run,
    native: { schema: 'aiterm.execution-native.v1', native_id: '$2', server: { pid: 4711, started_identity: '2026-10-21T09:00:00Z' } },
    harness: 'codex-cli', harness_process: { pid: 200, started_identity: '2026-10-21T09:00:01Z' },
    endpoint: { session_id: 'native-conversation', record_file: { device: 1, inode: 2 } }, recorded_state: 'running',
    native_boundary: { type: 'task_started', turn_id: run.boundary.turn_id, reason: null }, invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
  const key = () => { guardTmuxExecution(['send-keys', '-t', '$2', 'Escape']); keys++;
    return { schema: 'aiterm.pty-key-result.v1', session_id: launch.session_id, key: 'Escape', outcome: 'accepted',
      interruption: 'unconfirmed', session_preserved: 'unconfirmed' }; };
  const runtime = { observeSync: () => ({ state: 'present', launch }), async observe() { return this.observeSync(); },
    interruptionSync: () => structuredClone(observation), selectInterruptionSync: () => structuredClone(observation), interruptKeySync: key,
    async coverage() { return 'incomplete'; } };
  const service = new ExecutionService(store, runtime), state = () => raw.transactionSync(state => structuredClone(state), { readOnly: true });
  return { dir, raw, store, service, runtime, observation, key, keys: () => keys, state,
    loseScope() { scope = false; }, proof() { Object.assign(observation, { recorded_state: 'interrupted',
      native_boundary: { type: 'turn_aborted', turn_id: run.boundary.turn_id, reason: 'interrupted' },
      invocation_fence: 'closed', session_preserved: 'confirmed' }); } };
}
test('the scoped key frame records its MCP native actor, and inventory retains this existing run without inventing a request ID', async t => {
  const f = fixture(t); await f.service.beginInterruption(run); assert.equal('caller' in f.state().interruptions[0], false);
  await f.service.interruptRun(run, f.key); const state = f.state();
  assert.deepEqual(state.interruptions[0].caller, actor); assert.equal(state.interruptions[0].phase, 'accepted'); assert.equal(f.keys(), 1);
  const inventory = f.store.inventory(() => [actor]);
  assert.deepEqual(inventory.participants[0].references, [{ kind: 'interruption', run, phase: 'accepted' }]);
  assert.equal(inventory.native_fence, 'unknown'); assert.equal(inventory.relation_coverage, 'incomplete');
});
test('only an enrolled MCP role can supply the interruption caller; a worker cannot silently borrow that authority', async t => {
  const f = fixture(t, ['parent_worker']); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, f.key), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(f.keys(), 0); assert.equal(f.state().interruptions[0].phase, 'draining'); assert.equal('caller' in f.state().interruptions[0], false);
});
test('scope loss after claim retains the original preparing caller; another actor cannot take it over or infer key absence from disappearance', async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => { f.loseScope(); return f.key(); }));
  const before = f.state().interruptions[0]; assert.equal(before.phase, 'preparing'); assert.deepEqual(before.caller, actor); assert.equal(f.keys(), 0);
  const nextStore = new ParticipantExecutionStore(f.dir, other, () => {}); nextStore.enroll(['mcp']);
  const next = new ExecutionService(nextStore, f.runtime);
  await assert.rejects(next.interruptRun(run, f.key));
  await next.interruptCascade(input); assert.equal(f.keys(), 0); assert.deepEqual(f.state().interruptions[0], before);
  const inventory = nextStore.inventory(() => [other]);
  const old = inventory.participants.find(row => row.actor.pid === actor.pid);
  assert.equal(old.native_identity, 'unavailable'); assert.equal(old.references[0].phase, 'preparing');
});
test('a changed journal caller cannot issue the old frame, and its late cleanup cannot erase the replacement reference', async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => {
    f.raw.transactionSync(state => { state.interruptions[0].caller = other; }); return f.key();
  }));
  assert.equal(f.keys(), 0); assert.deepEqual(f.state().interruptions[0].caller, other); assert.equal(f.state().interruptions[0].phase, 'preparing');
  const missing = f.store.inventory(() => [actor, other]).participants.find(row => row.actor.pid === other.pid);
  assert.ok(missing.missing.includes('unregistered_actor'));
});
test('caller loss after a genuine key effect preserves the issued slot and cannot downgrade to not_sent or replay the key', async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => {
    const receipt = f.key(); f.raw.transactionSync(state => { state.interruptions[0].caller = other; }); return receipt;
  }), error => error.effect === 'possible');
  assert.equal(f.keys(), 1); assert.equal(f.state().interruptions[0].phase, 'issued'); assert.equal(f.state().slots[0].state, 'issued');
  await f.service.interruptCascade(input); assert.equal(f.keys(), 1); assert.deepEqual(f.state().interruptions[0].caller, other);
});
test('a reused PID remains a different inventory actor and never inherits the old interruption frame', async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => { f.loseScope(); return f.key(); }));
  const replacement = { ...actor, started_identity: other.started_identity }, nextStore = new ParticipantExecutionStore(f.dir, replacement, () => {});
  nextStore.enroll(['mcp']); await assert.rejects(new ExecutionService(nextStore, f.runtime).interruptRun(run, f.key));
  const inventory = nextStore.inventory(() => [replacement]), previous = inventory.participants.find(row => row.actor.started_identity === actor.started_identity);
  assert.equal(previous.native_identity, 'replaced'); assert.equal(previous.references[0].kind, 'interruption');
  assert.deepEqual(f.state().interruptions[0].caller, actor); assert.equal(f.keys(), 0);
});
test('legacy callerless journals are not filled from the current MCP and cannot be settled as a native participant fence', async t => {
  const f = fixture(t), legacy = new ExecutionService(f.raw, f.runtime);
  await legacy.beginInterruption(run); await legacy.interruptRun(run, f.key); f.proof();
  await assert.rejects(f.service.settleInterruption(run), error => error.code === 'EXECUTION_UNCONFIRMED');
  assert.equal('caller' in f.state().interruptions[0], false); assert.equal(f.state().interruptions[0].phase, 'accepted');
  await f.service.interruptCascade(input); assert.equal(f.keys(), 1); assert.equal('caller' in f.state().interruptions[0], false);
});
test('a settled native-proven frame retains its caller as history without reviving the actor run reference', async t => {
  const f = fixture(t); await f.service.beginInterruption(run); await f.service.interruptRun(run, f.key); f.proof();
  await f.service.settleInterruption(run);
  assert.equal(f.state().interruptions[0].phase, 'settled'); assert.deepEqual(f.state().interruptions[0].caller, actor);
  assert.deepEqual(f.store.inventory(() => [actor]).participants[0].references, []);
});
