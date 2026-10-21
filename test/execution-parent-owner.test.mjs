import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ParentDeliveryManager } from '../dist/parent-delivery.js';
import { withExecutionRequest } from '../dist/execution-context.js';
import { withExecutionEffectScope } from '../dist/execution-effect.js';
import { ExecutionError } from '../dist/execution-wire.js';
const owner = { pid: process.pid, started_identity: '2026-10-21T21:00:00Z' };
const parent = { thread_id: '00000000-0000-4000-8000-000000000001', codex_home: '/synthetic-parent' };
const boundary = { session_id: 'bot-b', launch_id: 'b'.repeat(32), vendor: 'codex', harness: 'codex-cli', event_cursor: 17, operation_id: null };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'parent-owner-')); let probes = 0, binds = 0, watches = 0, preparing = false, cancelled = false;
  let observeOwner = () => [{ ...owner }];
  const requestActor = options.requestActor ?? owner;
  const request = { kind: 'mcp', process_pid: requestActor.pid, process_started_identity: requestActor.started_identity,
    request_id: 91, tool: 'pty_send', target_session_id: boundary.session_id };
  const proof = { schema: 'aiterm.parent-source.v1', request, source: { launch: { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, boundary: null },
    client_name: 'synthetic-native-client', mcp_process: { ...requestActor },
    harness_process: { pid: 201, started_identity: '2026-10-21T20:59:59Z' }, endpoint: { vendor: 'codex', thread_id: parent.thread_id } };
  const execution = { observeOriginOwner: options.observeOriginOwner, captureEndpointEvidence: () => proof,
    async bind() { binds++; }, async submit() { assert.fail('no owner test queue'); } };
  const dependencies = { processes(pids) {
    probes++; if (probes > 1) assert.equal(preparing, true, 'owner recapture only inside original synchronous preparation');
    assert.deepEqual(pids, [owner.pid]); return observeOwner();
  }, exists: () => true, verify: async () => {}, observe: async (_session, params) => {
    watches++; return new Promise((_resolve, reject) => params.signal.addEventListener('abort', () => reject(Error('synthetic cleanup')), { once: true }));
  }, answer: async () => assert.fail('no answer') };
  const manager = new ParentDeliveryManager({ root, execution, dependencies }); await manager.recover();
  t.after(async () => { await manager.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let delivery;
  const run = (afterRequest = () => {}) => withExecutionEffectScope(boundary.session_id, () => assert.fail('no native input'),
    () => withExecutionRequest(request, async () => { delivery = manager.request(parent); await afterRequest(); await delivery.before_send(boundary); }),
    undefined, body => {
      if (cancelled) throw new ExecutionError('EXECUTION_STOPPING');
      preparing = true; try { return body(); } finally { preparing = false; }
    });
  const records = () => fs.readdirSync(join(root, 'active')).flatMap(name => fs.readdirSync(join(root, 'active', name))
    .filter(file => file !== 'owner.json' && file.endsWith('.json')).map(file => join(root, 'active', name, file)))
    .concat(fs.readdirSync(join(root, 'results')).filter(file => file.endsWith('.json')).map(file => join(root, 'results', file)));
  return { root, manager, execution, request, proof, run, records, delivery: () => delivery,
    setObserver: fn => { observeOwner = fn; }, cancel: () => { cancelled = true; },
    counts: () => ({ probes, binds, watches }) };
}

test('new private origin owner is bound to the original request/proof and saved in record and claim before binding', async t => {
  const f = await fixture(t); const original = structuredClone(f.proof);
  f.execution.bind = async () => {
    const file = f.records()[0], record = JSON.parse(fs.readFileSync(file));
    const claim = JSON.parse(fs.readFileSync(join(f.root, 'claims', boundary.session_id + '.json')));
    assert.deepEqual(record.execution.origin_owner, owner); assert.deepEqual(claim.execution, record.execution);
    assert.deepEqual(record.execution.source_evidence, original); assert.equal(record.state, 'unknown');
  };
  await f.run(() => { f.proof.mcp_process.pid++; });
  assert.equal(f.counts().probes, 2); assert.equal(f.counts().watches, 1);
  const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.equal(result.original_storage_owner, 'recorded'); assert.deepEqual(result.recorded_origin_owner, owner);
  assert.equal(result.graph, null); assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
});

test('missing, reused, ambiguous or rejected native owner read refuses before reserving metadata or binding', async t => {
  for (const observe of [() => [], () => [{ pid: owner.pid, started_identity: null }],
    () => [{ ...owner, started_identity: '2026-10-21T21:01:00Z' }], () => [{ ...owner }, { ...owner }],
    () => { throw Error('synthetic native owner evidence missing'); },
    () => Promise.resolve([{ ...owner }]), () => Promise.reject(Error('synthetic delayed native evidence'))]) {
    const f = await fixture(t); f.setObserver(observe);
    await assert.rejects(f.run(), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'not_started');
    assert.equal(f.delivery().result(), null); assert.equal(f.records().length, 0);
    assert.deepEqual(f.counts(), { probes: 2, binds: 0, watches: 0 });
    assert.equal(fs.readdirSync(join(f.root, 'claims')).length, 0);
  }
});

test('a foreign original actor is not replaced with the current storage owner and never gains a recorded origin', async t => {
  const f = await fixture(t, { requestActor: { ...owner, pid: owner.pid + 1000 } });
  await f.run();
  const record = JSON.parse(fs.readFileSync(f.records()[0])); assert.equal(Object.hasOwn(record.execution, 'origin_owner'), false);
  const diagnostic = await f.manager.diagnoseClaim(boundary.session_id);
  assert.equal(diagnostic.original_storage_owner, 'unproven'); assert.equal(diagnostic.recorded_origin_owner, null);
  assert.equal(diagnostic.storage_owner_matches_request_actor, false); assert.equal(diagnostic.clearance, 'retained');
  assert.equal(f.counts().probes, 1, 'no native owner inference for an unrelated source');
});

test('saved origin survives result relocation while current owner.json cannot replace the native request origin', async t => {
  const f = await fixture(t);
  await f.run(() => {
    const ownerDirectory = fs.readdirSync(join(f.root, 'active'))[0];
    fs.writeFileSync(join(f.root, 'active', ownerDirectory, 'owner.json'), JSON.stringify({ pid: owner.pid + 500,
      started_identity: '2026-10-21T21:02:00Z', closed: false }));
  });
  f.delivery().failed(Error('synthetic input receipt missing'));
  const record = JSON.parse(fs.readFileSync(f.records()[0]));
  assert.equal(dirname(f.records()[0]), join(f.root, 'results')); assert.deepEqual(record.execution.origin_owner, owner);
  assert.deepEqual(record.execution.request, f.request); assert.equal(record.state, 'unknown');
  assert.equal(f.counts().probes, 2);
});

test('older unstamped records are never backfilled from a reconstructed manager and its different native identity', async t => {
  const f = await fixture(t); await f.run(); await f.manager.close();
  const oldFile = f.records()[0], claimFile = join(f.root, 'claims', boundary.session_id + '.json');
  const old = JSON.parse(fs.readFileSync(oldFile)); delete old.execution.origin_owner;
  old.state = 'unknown'; old.error = 'PARENT_DELIVERY_CHECKPOINT_UNCONFIRMED';
  fs.writeFileSync(oldFile, JSON.stringify(old)); fs.writeFileSync(claimFile, JSON.stringify(old));
  const beforeClaim = fs.readFileSync(claimFile, 'utf8');
  const restored = new ParentDeliveryManager({ root: f.root, execution: f.execution, dependencies: {
    processes: () => [{ ...owner, started_identity: '2026-10-21T21:03:00Z' }], exists: () => false,
    observe: async () => assert.fail('no old watcher'), verify: async () => assert.fail('no current endpoint fallback') } });
  try {
    await restored.recover(); const saved = JSON.parse(fs.readFileSync(f.records()[0]));
    assert.equal(Object.hasOwn(saved.execution, 'origin_owner'), false);
    const diagnosis = await restored.diagnoseClaim(boundary.session_id);
    assert.equal(diagnosis.original_storage_owner, 'unproven'); assert.equal(diagnosis.recorded_origin_owner, null);
    assert.equal(fs.readFileSync(claimFile, 'utf8'), beforeClaim); assert.equal(diagnosis.clearance, 'retained');
  } finally { await restored.close(); }
});

test('native origin remains recorded after recovery by a different storage owner without becoming live proof', async t => {
  const f = await fixture(t); await f.run(); await f.manager.close();
  const oldFile = f.records()[0], claimFile = join(f.root, 'claims', boundary.session_id + '.json');
  const old = JSON.parse(fs.readFileSync(oldFile)); old.state = 'unknown'; old.error = 'PARENT_DELIVERY_CHECKPOINT_UNCONFIRMED';
  fs.writeFileSync(oldFile, JSON.stringify(old)); fs.writeFileSync(claimFile, JSON.stringify(old));
  const beforeClaim = fs.readFileSync(claimFile, 'utf8');
  const restored = new ParentDeliveryManager({ root: f.root, dependencies: {
    processes: () => [{ ...owner, started_identity: '2026-10-21T21:03:00Z' }], exists: () => false,
    observe: async () => assert.fail('no old watcher'), verify: async () => assert.fail('no fallback') } });
  try {
    await restored.recover(); const diagnosis = await restored.diagnoseClaim(boundary.session_id);
    assert.equal(diagnosis.original_storage_owner, 'recorded'); assert.deepEqual(diagnosis.recorded_origin_owner, owner);
    assert.equal(diagnosis.storage_owner, null, 'results do not invent their current or original owner.json');
    assert.equal(diagnosis.graph, null); assert.equal(diagnosis.clearance, 'retained');
    assert.equal(fs.readFileSync(claimFile, 'utf8'), beforeClaim);
  } finally { await restored.close(); }
});

test('invalid origin identity or disagreement with the original proof is rejected without native mutation or silent legacy downgrade', async t => {
  const f = await fixture(t); await f.run(); const file = join(f.root, 'claims', boundary.session_id + '.json');
  const saved = JSON.parse(fs.readFileSync(file));
  for (const change of [record => { record.execution.origin_owner.pid++; },
    record => { record.execution.origin_owner.started_identity = 'unknown-native-start'; },
    record => { delete record.execution.source_evidence; }, record => { record.execution.origin_owner.extra = true; }]) {
    const record = structuredClone(saved); change(record); fs.writeFileSync(file, JSON.stringify(record));
    await assert.rejects(f.manager.diagnoseClaim(boundary.session_id));
  }
  fs.writeFileSync(file, JSON.stringify(saved)); assert.equal(f.counts().probes, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.records()[0])).execution.origin_owner, owner);
});

test('stop while the old child preparation waits prevents origin probing and all new record/claim writes', async t => {
  const f = await fixture(t), entered = deferred(), resume = deferred();
  f.manager.beforeChange = async () => { entered.resolve(); await resume.promise; };
  const pending = f.run(); await entered.promise; f.cancel(); resume.resolve();
  await assert.rejects(pending, error => error.code === 'EXECUTION_STOPPING');
  assert.equal(f.delivery().result(), null); assert.deepEqual(f.counts(), { probes: 1, binds: 0, watches: 0 });
  assert.equal(f.records().length, 0); assert.equal(fs.readdirSync(join(f.root, 'claims')).length, 0);
});


test('saved origin native reads are bounded, reference-specific and do not change metadata or release a live owner claim', async t => {
  const pids = [], f = await fixture(t, { observeOriginOwner(pid) { pids.push(pid); return { state: 'present', actor: { ...owner } }; } });
  await f.run(); const files = [f.records()[0], join(f.root, 'claims', boundary.session_id + '.json')];
  const before = files.map(file => fs.readFileSync(file, 'utf8'));
  const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.deepEqual(result.origin_owner_native, { state: 'matched', observations: 2, absent_observations: 0 });
  assert.deepEqual(pids, [owner.pid, owner.pid]); assert.equal(f.counts().probes, 2, 'diagnosis must not recapture manager owner');
  assert.deepEqual(files.map(file => fs.readFileSync(file, 'utf8')), before);
  assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
  result.recorded_origin_owner.pid++;
  assert.deepEqual(JSON.parse(fs.readFileSync(files[0])).execution.origin_owner, owner);
});

test('same PID with two consistent different starts is replaced without adopting the replacement owner', async t => {
  const replacement = { ...owner, started_identity: '2026-10-21T21:07:00Z' };
  const f = await fixture(t, { observeOriginOwner: () => ({ state: 'present', actor: replacement }) }); await f.run();
  const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.deepEqual(result.origin_owner_native, { state: 'replaced', observations: 2, absent_observations: 0 });
  assert.deepEqual(result.recorded_origin_owner, owner); assert.equal(result.clearance, 'retained');
  assert.deepEqual(replacement, { ...owner, started_identity: '2026-10-21T21:07:00Z' });
});

test('original native absence requires two independent absent reads and never proves CLI completion or clears a claim', async t => {
  let reads = 0;
  const f = await fixture(t, { observeOriginOwner(pid) { reads++; return { state: 'absent', pid }; } }); await f.run();
  const claimFile = join(f.root, 'claims', boundary.session_id + '.json'), before = fs.readFileSync(claimFile, 'utf8');
  const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.deepEqual(result.origin_owner_native, { state: 'absent', observations: 2, absent_observations: 2 });
  assert.equal(reads, 2); assert.equal(result.graph, null); assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
  assert.equal(fs.readFileSync(claimFile, 'utf8'), before); assert.equal(f.counts().watches, 1, 'original job is not finished or resubmitted');
});

test('a single absence or native identity transition cannot become confirmed original-owner absence or liveness', async t => {
  for (const sequence of [
    [{ state: 'absent', pid: owner.pid }, { state: 'present', actor: owner }],
    [{ state: 'present', actor: owner }, { state: 'absent', pid: owner.pid }],
    [{ state: 'absent', pid: owner.pid }, { state: 'unknown', pid: owner.pid }],
    [{ state: 'present', actor: owner }, { state: 'present', actor: { ...owner, started_identity: '2026-10-21T21:08:00Z' } }],
  ]) {
    let reads = 0; const f = await fixture(t, { observeOriginOwner: () => sequence[reads++] }); await f.run();
    const result = await f.manager.diagnoseClaim(boundary.session_id);
    assert.equal(result.origin_owner_native.state, 'unknown'); assert.equal(reads, 2);
    assert.ok(result.missing.includes('origin_owner_native_unconfirmed')); assert.equal(result.clearance, 'retained');
  }
});

test('unknown, invalid, mismatched, thrown and asynchronous native observations stay unknown without a fallback or replay', async t => {
  for (const observe of [() => ({ state: 'unknown', pid: owner.pid }), () => null,
    () => ({ state: 'absent', pid: owner.pid + 1 }), () => ({ state: 'present', actor: { ...owner, pid: owner.pid + 1 } }),
    () => ({ state: 'present', actor: { ...owner, started_identity: null } }), () => [],
    () => ({ state: 'absent', pid: owner.pid, extra: true }),
    () => { throw Error('synthetic EPERM or unavailable native probe'); },
    () => Promise.resolve({ state: 'absent', pid: owner.pid }), () => Promise.reject(Error('synthetic delayed probe'))]) {
    const f = await fixture(t, { observeOriginOwner: observe }); await f.run();
    const result = await f.manager.diagnoseClaim(boundary.session_id);
    assert.equal(result.origin_owner_native.state, 'unknown'); assert.equal(result.origin_owner_native.observations, 2);
    assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none'); assert.equal(f.counts().probes, 2);
  }
});

test('missing origin and ambiguous owner records cannot be supplemented or probed using the current process', async t => {
  for (const mode of ['legacy', 'mismatch']) {
    const f = await fixture(t, { observeOriginOwner: () => assert.fail('unproven original owner must not trigger native probe') }); await f.run();
    const file = f.records()[0], claimFile = join(f.root, 'claims', boundary.session_id + '.json');
    const record = JSON.parse(fs.readFileSync(file));
    if (mode === 'legacy') delete record.execution.origin_owner;
    else { record.execution.request.request_id++; record.execution.source_evidence.request.request_id++; }
    if (mode === 'legacy') fs.writeFileSync(claimFile, JSON.stringify(record));
    fs.writeFileSync(file, JSON.stringify(record));
    const result = await f.manager.diagnoseClaim(boundary.session_id);
    assert.deepEqual(result.origin_owner_native, { state: 'unproven', observations: 0, absent_observations: 0 });
    assert.equal(result.recorded_origin_owner, null); assert.equal(f.counts().probes, 2); assert.equal(result.clearance, 'retained');
  }
});

test('missing runtime observer leaves saved origin recorded but native status unknown without a default OS probe', async t => {
  const f = await fixture(t); await f.run(); const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.equal(result.original_storage_owner, 'recorded');
  assert.deepEqual(result.origin_owner_native, { state: 'unknown', observations: 0, absent_observations: 0 });
  assert.ok(result.missing.includes('origin_owner_observer_unavailable')); assert.equal(f.counts().probes, 2);
});

test('metadata replacement while graph diagnosis waits suppresses all subsequent original-owner native probes', async t => {
  const f = await fixture(t, { observeOriginOwner: () => assert.fail('changed metadata is not native evidence') }); await f.run();
  const entered = deferred(), resume = deferred(); f.execution.diagnoseClaim = async () => { entered.resolve(); await resume.promise; return null; };
  const pending = f.manager.diagnoseClaim(boundary.session_id); await entered.promise;
  const file = f.records()[0], before = fs.readFileSync(file, 'utf8'), record = JSON.parse(before); record.state = 'unknown';
  fs.writeFileSync(file, JSON.stringify(record)); resume.resolve(); const result = await pending;
  assert.equal(result.origin_owner_native.state, 'unknown'); assert.equal(result.origin_owner_native.observations, 0);
  assert.ok(result.missing.includes('origin_owner_reference_changed')); assert.equal(result.clearance, 'retained');
  fs.writeFileSync(file, before);
});

test('metadata loss during a synchronous native read overrides two apparent matching observations without recreating the claim', async t => {
  let f, reads = 0; f = await fixture(t, { observeOriginOwner: () => {
    if (++reads === 2) fs.unlinkSync(join(f.root, 'claims', boundary.session_id + '.json'));
    return { state: 'present', actor: { ...owner } };
  } }); await f.run(); const result = await f.manager.diagnoseClaim(boundary.session_id);
  assert.equal(result.origin_owner_native.state, 'unknown'); assert.equal(reads, 2);
  assert.ok(result.missing.includes('origin_owner_reference_changed'));
  assert.equal(fs.existsSync(join(f.root, 'claims', boundary.session_id + '.json')), false); assert.equal(result.clearance, 'retained');
});
