import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';

const skip = process.platform === 'win32' ? 'POSIX durable execution store' : false;
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const seats = Array.from({ length: 11 }, (_, i) => ({ session_id: `synthetic-${i}`, launch_id: (i + 1).toString(16).padStart(32, '0') }));
const registration = (i, id = 'synthetic-room', present = true) => ({ action: 'register', source_session_id: null,
  reservation: { schema: 'aiterm.execution-reservation.v1',
    request: { kind: 'room', message_id: id, target_session_id: seats[i].session_id },
    source: { launch: null, boundary: null }, target: { session_id: seats[i].session_id, expected_launch_id: present ? seats[i].launch_id : null } } });
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory, 60), other = new FileExecutionStore(directory, 60);
  const entered = deferred(), release = deferred();
  let held = false, effectCount = 0;
  const current = new Map(seats.map(seat => [seat.session_id, seat]));
  const runtime = {
    sourceEvidence: async () => ({ runtime_launch: null, caller_bound: false, invocation_boundary: null }),
    observeSync: session => current.has(session) ? { state: 'present', launch: current.get(session) } : { state: 'absent' },
    async observe(session) {
      if (held && session === seats[0].session_id) { entered.resolve(); await release.promise; }
      return this.observeSync(session);
    },
  };
  const service = new ExecutionService(store, runtime), peer = new ExecutionService(other, runtime);
  const invoke = (i, stage = 'send') => service.invokeDeferred({ schema: 'aiterm.execution-ref.v1', request: registration(i).reservation.request }, stage, async issue => {
    await service.admitNative(() => { issue(); effectCount++; if (stage === 'launch') current.set(seats[i].session_id, seats[i]); });
    return { value: `accepted-${i}`, target: { launch: seats[i], boundary: stage === 'launch' ? null : { event_cursor: i + 1, operation_id: null, turn_id: null, steer_id: null } } };
  }, seats[i].session_id);
  return { store, other, runtime, service, peer, entered, release, invoke,
    current, hold: () => { held = true; }, effects: () => effectCount };
}

test('a slow registration observation does not block another registered room target invoke', { skip }, async t => {
  const f = await fixture(t); await f.service.execute(registration(1)); f.hold();
  const pending = f.service.execute(registration(0)); await f.entered.promise;
  try { const result = await f.invoke(1); assert.equal(result.record.operations.send, 'accepted'); }
  finally { f.release.resolve(); await pending; }
  assert.equal(f.effects(), 1);
});

test('a held room receipt observation allows the other ten targets to issue and bind once', { skip }, async t => {
  const f = await fixture(t);
  for (let i = 0; i < seats.length; i++) await f.service.execute(registration(i));
  f.hold(); const pending = f.invoke(0); await f.entered.promise;
  let results;
  try { results = await Promise.allSettled(seats.slice(1).map((_, i) => f.invoke(i + 1))); }
  finally { f.release.resolve(); await pending; }
  assert.deepEqual(results.map(r => r.status === 'fulfilled' ? r.value.record.operations.send : r.reason.code), Array(10).fill('accepted'));
  assert.equal(f.effects(), 11); assert.equal(f.store.snapshot().slots.length, 0);
});

test('a result observed outside the mutex cannot overwrite a concurrently uncertain original slot', { skip }, async t => {
  const f = await fixture(t); await f.service.execute(registration(0)); f.hold();
  const pending = f.invoke(0); await f.entered.promise; let changed = false;
  try {
    await f.other.transaction(state => { state.records[0].operations.send = 'unknown'; state.records[0].relation.completion = 'unknown'; state.slots[0].state = 'unknown'; });
    changed = true;
  } finally { f.release.resolve(); if (!changed) await pending; }
  await assert.rejects(pending, e => e.code === 'EXECUTION_UNCONFIRMED' && e.effect === 'possible');
  assert.equal(f.store.snapshot().records[0].operations.send, 'unknown');
  assert.equal(f.store.snapshot().slots[0].state, 'unknown'); assert.equal(f.effects(), 1);
});

test('registration rechecks a target blocker created while its native observation was pending', { skip }, async t => {
  const f = await fixture(t); f.hold(); const pending = f.service.execute(registration(0)); await f.entered.promise; let changed = false;
  try { await f.other.transaction(state => { state.slots.push({ session_id: seats[0].session_id, expected_launch_id: seats[0].launch_id, stage: 'send', state: 'unknown', request: null }); }); changed = true; }
  finally { f.release.resolve(); if (!changed) await pending; }
  await assert.rejects(pending, e => e.code === 'EXECUTION_UNCONFIRMED');
  assert.equal(f.store.snapshot().records.length, 0); assert.equal(f.store.snapshot().slots[0].state, 'unknown'); assert.equal(f.effects(), 0);
});

test('source evidence observation during registration does not block another target invoke', { skip }, async t => {
  const f = await fixture(t); await f.service.execute(registration(1));
  const sourceEvidence = f.runtime.sourceEvidence;
  f.runtime.sourceEvidence = async args => { if (args.reservation.target.session_id === seats[0].session_id) { f.entered.resolve(); await f.release.promise; } return sourceEvidence(); };
  const pending = f.service.execute(registration(0)); await f.entered.promise;
  try { assert.equal((await f.invoke(1)).record.operations.send, 'accepted'); }
  finally { f.release.resolve(); await pending; }
  assert.equal(f.effects(), 1);
});

test('a changed native generation cannot receive the original action receipt', { skip }, async t => {
  const f = await fixture(t); await f.service.execute(registration(0)); f.hold();
  const pending = f.invoke(0); await f.entered.promise;
  f.current.set(seats[0].session_id, { ...seats[0], launch_id: 'f'.repeat(32) }); f.release.resolve();
  await assert.rejects(pending, e => e.code === 'EXECUTION_UNCONFIRMED' && e.effect === 'possible');
  const state = f.store.snapshot(); assert.equal(state.records[0].operations.send, 'unknown');
  assert.equal(state.slots[0].expected_launch_id, seats[0].launch_id); assert.equal(state.slots[0].state, 'unknown'); assert.equal(f.effects(), 1);
});

test('a late request cancellation preserves the genuine returned action receipt', { skip }, async t => {
  const f = await fixture(t); await f.service.execute(registration(0)); f.hold();
  const pending = f.invoke(0); await f.entered.promise; let changed = false;
  try { await f.service.cancelRequestActions(registration(0).reservation.request); changed = true; }
  finally { f.release.resolve(); if (!changed) await pending; }
  const result = await pending; assert.equal(result.value, 'accepted-0'); assert.equal(result.record.operations.send, 'accepted');
  assert.equal(result.record.stopping, true); assert.equal(f.store.snapshot().slots.length, 0); assert.equal(f.effects(), 1);
});

test('a held empty launch receipt allows ten other room targets to launch once', { skip }, async t => {
  const f = await fixture(t); f.current.clear();
  for (let i = 0; i < seats.length; i++) await f.service.execute(registration(i, 'synthetic-room', false));
  f.hold(); const pending = f.invoke(0, 'launch'); await f.entered.promise;
  let results;
  try { results = await Promise.allSettled(seats.slice(1).map((_, i) => f.invoke(i + 1, 'launch'))); }
  finally { f.release.resolve(); await pending; }
  assert.deepEqual(results.map(r => r.status === 'fulfilled' ? r.value.record.operations.launch : r.reason.code), Array(10).fill('accepted'));
  assert.equal(f.effects(), 11); assert.equal(f.store.snapshot().slots.length, 0);
  assert(f.store.snapshot().records.every(record => record.operations.send === 'not_issued'));
});
