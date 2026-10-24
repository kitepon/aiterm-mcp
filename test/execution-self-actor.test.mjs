import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';

const { localParentWorkerRuntime, createExecutionParentEnvironment } = await import('../dist/execution-parent-worker.js');
const provider = { withDeliveryEffect() {}, DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1',
  native_context: true, cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true } };

test('local current actor retains one verified own-process identity through scope checks without repeating OS probes',
  { skip: process.platform === 'win32' ? 'native execution composition requires POSIX' : false }, () => {
  const original = childProcess.spawnSync; let reads = 0, missing = true;
  childProcess.spawnSync = (command, args) => {
    assert.equal(command, '/bin/ps'); assert.ok(args.includes(String(process.pid))); reads++;
    return { status: 0, stdout: missing ? '' : `${process.pid} Sat Oct 24 10:00:00 2026\n`, stderr: '' };
  };
  syncBuiltinESMExports();
  try {
    assert.equal(localParentWorkerRuntime.actor(), null, 'a missing first observation must not be cached');
    missing = false;
    const observed = localParentWorkerRuntime.actor(); assert.equal(observed.pid, process.pid);
    observed.started_identity = 'caller changed its returned object';
    const expected = localParentWorkerRuntime.scope();
    const env = createExecutionParentEnvironment({ profile: { state_root: () => expected.state_root },
      expectedScope: expected, provider, deferEnrollment: true });
    for (let i = 0; i < 10; i++) env.assertScope();
    assert.equal(reads, 2, 'one missing observation then one verified identity; no extra subprocesses at admission');
    assert.equal(env.actor.started_identity, 'Sat Oct 24 10:00:00 2026', 'returned copies cannot alter the retained identity');
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
});

test('injected actor and scope still change dynamically and refuse on the next admission check', () => {
  let reads = 0;
  const actor = { pid: 417, started_identity: '2026-10-24T10:00:00Z' };
  const actual = localParentWorkerRuntime.scope();
  const runtime = { scope: () => actual, actor: () => { reads++; return { ...actor }; },
    observeParentProcess() { assert.fail('not a parent probe'); }, observeSessionGeneration() { assert.fail('not a generation probe'); } };
  const env = createExecutionParentEnvironment({ profile: { state_root: () => actual.state_root },
    expectedScope: structuredClone(actual), provider, runtime, deferEnrollment: true });
  const initial = reads; for (let i = 0; i < 10; i++) env.assertScope(); assert.equal(reads - initial, 10);
  actor.started_identity = '2026-10-24T10:01:00Z';
  assert.throws(env.assertScope, error => error.code === 'EXECUTION_UNSUPPORTED');
  actor.started_identity = '2026-10-24T10:00:00Z'; actual.multiplexer.key += '-changed';
  assert.throws(env.assertScope, error => error.code === 'EXECUTION_UNSUPPORTED');
});

test('retained self identity does not bypass an unknown target slot or restore a deleted participant',
  { skip: process.platform === 'win32' ? 'native execution composition requires POSIX' : false }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'self-actor-admission-'));
  try {
    const actual = { state_root: directory, multiplexer: { kind: 'socket', key: join(directory, 'synthetic.sock') } };
    const env = createExecutionParentEnvironment({ profile: { state_root: () => directory }, expectedScope: actual, provider,
      runtime: { ...localParentWorkerRuntime, scope: () => actual }, deferEnrollment: true });
    env.store.enroll(['mcp']);
    const target = { session_id: 'synthetic-target', launch_id: 'b'.repeat(32) };
    const request = { kind: 'delivery', delivery_id: 'synthetic-old', target_session_id: target.session_id };
    const service = new ExecutionService(env.store, {
      sourceEvidence: async () => ({ runtime_launch: null, caller_bound: false, invocation_boundary: null }),
      observe: async () => ({ state: 'present', launch: target }), observeSync: () => ({ state: 'present', launch: target }),
    });
    const registration = id => ({ action: 'register', source_session_id: null,
      reservation: { schema: 'aiterm.execution-reservation.v1', request: { ...request, delivery_id: id },
        source: { launch: null, boundary: null }, target: { session_id: target.session_id, expected_launch_id: target.launch_id } } });
    await service.execute(registration(request.delivery_id));
    await assert.rejects(service.invokeDeferred({ schema: 'aiterm.execution-ref.v1', request }, 'send', async issue => {
      issue(); throw new Error('synthetic issued uncertainty');
    }, target.session_id), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'possible');
    const raw = new FileExecutionStore(env.store.directory), before = raw.snapshot();
    await assert.rejects(service.execute(registration('synthetic-new')), error => error.code === 'EXECUTION_UNCONFIRMED');
    assert.deepEqual(raw.snapshot(), before, 'unknown original record and slot remain unchanged');
    await raw.transaction(state => { state.participants = []; });
    await assert.rejects(env.store.transaction(() => null, { readOnly: true }), error => error.code === 'EXECUTION_UNSUPPORTED');
    const after = raw.snapshot(); assert.deepEqual(after.slots, before.slots); assert.deepEqual(after.records, before.records);
    assert.deepEqual(after.participants, [], 'self identity retention must not reenroll a missing declaration');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
