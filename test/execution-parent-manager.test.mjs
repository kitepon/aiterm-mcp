import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParentDeliveryManager } from '../dist/parent-delivery.js';
import { withExecutionRequest, currentExecutionRequest } from '../dist/execution-context.js';
import { createParentManagerExecution } from '../dist/execution-parent-manager.js';

const parent = { thread_id: '00000000-0000-4000-8000-000000000001', codex_home: '/synthetic/parent-home' };
const boundary = session_id => ({ session_id, launch_id: 'b'.repeat(32), vendor: 'codex', harness: 'codex-cli', event_cursor: 17, operation_id: null });
const request = session => ({ kind: 'delivery', delivery_id: 'existing-' + session, target_session_id: session });
const until = async check => { const end = performance.now() + 1000; while (!check()) {
  assert.ok(performance.now() < end); await new Promise(resolve => setTimeout(resolve, 2));
} };
function fixture(t, failFirst = false, capture, tracking) {
  const root = mkdtempSync(join(tmpdir(), 'execution-manager-')), binds = [], submits = [], completions = new Map();
  const execution = {
    ...(capture ? { captureEndpointEvidence: capture } : {}),
    ...(tracking ? { recordChildCompletion: tracking } : {}),
    async bind(id, request, child, endpoint, evidence) {
      if (failFirst) { failFirst = false; throw Object.assign(Error('synthetic binding unavailable'), { code: 'EXECUTION_UNCONFIRMED' }); }
      binds.push({ id, request, child, endpoint, ...(evidence === undefined ? {} : { evidence }) });
    },
    async submit(endpoint, id, text) { submits.push({ endpoint, id, text }); return { queued_submission_id: 'native-existing-queue-id' }; },
  };
  const manager = new ParentDeliveryManager({ root, execution, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => true,
    verify: async () => {}, answer: async () => ({ text: 'synthetic answer' }),
    observe: async (session, options) => new Promise((resolve, reject) => {
      completions.set(session, resolve); options.signal?.addEventListener('abort', () => reject(Error('synthetic abort')), { once: true });
    }),
    submit: async () => { assert.fail('execution mode must not use a legacy submit fallback'); },
  } });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  return { manager, binds, submits, finish(session) {
    completions.get(session)({ schema: 'aiterm.agent-wait-result.v1', ...boundary(session), outcome: 'done', turn_id: 'native-turn' });
  } };
}
test('public old steer without native callbacks is refused before any manager execution can be mounted', () => {
  assert.throws(() => createParentManagerExecution({ profile: {}, parent: {}, native: {} }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('real manager captures the existing request and parent before_send, then uses the guarded submit exactly once', async t => {
  const f = fixture(t), original = request('bot-b'), endpoint = { ...parent };
  const delivery = withExecutionRequest(original, () => f.manager.request(endpoint));
  original.delivery_id = 'mutated'; endpoint.thread_id = 'different-thread';
  await delivery.before_send(boundary('bot-b'));
  assert.deepEqual(f.binds[0].request, request('bot-b')); assert.deepEqual(f.binds[0].endpoint, parent);
  assert.equal(f.binds[0].id, delivery.result().delivery_id);
  f.finish('bot-b'); await until(() => f.manager.status('bot-b')[0]?.state === 'submitted');
  assert.equal(f.submits.length, 1); assert.equal(f.submits[0].id, f.binds[0].id);
  assert.match(f.submits[0].text, /synthetic answer$/); assert.deepEqual(f.submits[0].endpoint, parent);
  assert.equal(currentExecutionRequest(), null);
});
test('concurrent manager requests retain their own original refs and missing context or remote cannot fabricate one', async t => {
  const f = fixture(t);
  const one = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  const two = withExecutionRequest(request('bot-c'), () => f.manager.request(parent));
  await Promise.all([one.before_send(boundary('bot-b')), two.before_send(boundary('bot-c'))]);
  assert.deepEqual(f.binds.map(value => value.request.delivery_id).sort(), ['existing-bot-b', 'existing-bot-c']);
  await assert.rejects(f.manager.request(parent).before_send(boundary('bot-d')), error => error.code === 'EXECUTION_UNSUPPORTED');
  const remote = withExecutionRequest(request('bot-d'), () => f.manager.request(parent));
  await assert.rejects(remote.before_send({ ...boundary('bot-d'), remote: {} }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(f.binds.length, 2); assert.equal(f.submits.length, 0);
});
test('failed generation binding releases the existing child claim rather than leaving an untracked delivery', async t => {
  const f = fixture(t, true);
  const failed = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await assert.rejects(failed.before_send(boundary('bot-b')), error => error.code === 'EXECUTION_UNCONFIRMED');
  assert.equal(failed.result(), null); assert.equal(f.manager.status('bot-b').length, 0);
  const next = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await next.before_send(boundary('bot-b')); assert.equal(next.result().state, 'waiting');
});
test('manager captures and detaches native evidence at request time rather than a later registration continuation', async t => {
  const original = { native_tool_id: 'existing-native-tool', request: request('bot-b') };
  const f = fixture(t, false, () => original);
  const delivery = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  original.native_tool_id = 'late-tool'; original.request.delivery_id = 'late-ref';
  await delivery.before_send(boundary('bot-b'));
  assert.deepEqual(f.binds[0].evidence, { native_tool_id: 'existing-native-tool', request: request('bot-b') });
});
test('execution uses the actual provider error class to distinguish a refusal from missing RPC outcome', () => {
  class ProviderError extends Error { constructor(outcome_unknown) { super('synthetic vendor error'); this.outcome_unknown = outcome_unknown; } }
  const execution = createParentManagerExecution({ parent: {}, native: {}, profile: {}, provider: {
    withDeliveryEffect() {}, SteerDeliveryError: ProviderError,
    DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
      cursor_profile_parameter: true, multi_delivery_emit: true, serialized_required: true },
    submitCodexParentAnswer() {}, submitClaudeParentAnswer() {}, submitCursorParentAnswer() {},
  } });
  assert.equal(execution.outcomeUnknown(new ProviderError(false)), false);
  assert.equal(execution.outcomeUnknown(new ProviderError(true)), true);
  assert.equal(execution.outcomeUnknown(Object.assign(Error('RPC reject'), { outcome_unknown: false })), null);
});
test('missing execution completion proof preserves the real saved answer and keeps normal delivery', async t => {
  let observed = 0;
  const f = fixture(t, false, undefined, async () => { observed++; throw Error('synthetic native done proof unavailable'); });
  const delivery = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await delivery.before_send(boundary('bot-b')); f.finish('bot-b');
  await until(() => f.manager.status('bot-b')[0]?.state === 'submitted');
  assert.equal(observed, 1); assert.equal(f.submits.length, 1); assert.match(f.submits[0].text, /synthetic answer/);
});
test('durable answer releases its old child claim while execution metadata waits for the original receipt', async t => {
  const entered = { done: false }; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, false, undefined, async () => { entered.done = true; await pending; });
  const one = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await one.before_send(boundary('bot-b')); f.finish('bot-b'); await until(() => entered.done);
  const two = withExecutionRequest({ ...request('bot-b'), delivery_id: 'new-existing-request' }, () => f.manager.request(parent));
  try { await two.before_send(boundary('bot-b')); }
  finally { release(); }
  assert.notEqual(two.result().delivery_id, one.result().delivery_id);
});

test('cancel after execution binding refuses old Claude/Cursor companion writes and retains the bound delivery for diagnosis', async t => {
  const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const { stateRoot } = await import('../dist/agent-shared.js');
  const { withExecutionEffectScope } = await import('../dist/execution-effect.js');
  const { ExecutionError } = await import('../dist/execution-wire.js');
  const { bindClaudeParentDelivery, prepareCursorDelivery } = await import('aiterm-steer-delivery');
  const root = mkdtempSync(join(tmpdir(), 'execution-companion-'));
  const profile = { id: 'aiterm', state_root: () => stateRoot() };
  for (const kind of ['claude', 'cursor']) {
    const entered = deferred(), resume = deferred(); let cancelled = false, binds = 0, companion = 0, watched = 0;
    const endpoint = kind === 'claude' ? { kind, session_id: '00000000-0000-4000-8000-000000000001',
      request_id: 'toolu_companion_cancel', hook_root: join(stateRoot(), 'claude-parent-hooks') }
      : { kind, hook_root: join(root, 'cursor-parent-hooks') };
    if (kind === 'claude') {
      const dir = join(endpoint.hook_root, endpoint.request_id); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'request.json'), JSON.stringify({ request_id: endpoint.request_id, session_id: endpoint.session_id,
        agent_id: null, parent_pid: 20, parent_started_identity: 'synthetic-harness' }));
    }
    const manager = new ParentDeliveryManager({ root: join(root, kind), execution: {
      async bind() { binds++; entered.resolve(); await resume.promise; },
      prepareCompanion(id, parent) { companion++; if (kind === 'claude') bindClaudeParentDelivery(profile, parent, id); else prepareCursorDelivery(parent, id); },
      async submit() { assert.fail('no old queue'); },
    }, dependencies: { processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => true,
      verify: async () => {}, answer: async () => assert.fail('no old answer'),
      observe: async (_session, options) => { watched++; return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Error('synthetic fixture abort')), { once: true });
      }); } } });
    t.after(() => manager.close());
    let delivery;
    const pending = withExecutionEffectScope('bot-b', () => assert.fail('no native input'), () => withExecutionRequest(request('bot-b'), async () => {
      delivery = manager.request(endpoint); await delivery.before_send(boundary('bot-b'));
    }), undefined, body => { if (cancelled) throw new ExecutionError('EXECUTION_STOPPING'); return body(); });
    await entered.promise; cancelled = true; resume.resolve();
    await assert.rejects(pending, error => error.code === 'EXECUTION_STOPPING');
    assert.equal(binds, 1); assert.equal(companion, 0); assert.equal(watched, 0);
    const saved = delivery.result(); assert.equal(saved.state, 'unknown'); assert.equal(manager.status('bot-b')[0].state, 'unknown');
    assert.equal(existsSync(kind === 'claude' ? join(endpoint.hook_root, endpoint.request_id, 'delivery.json')
      : join(endpoint.hook_root, 'deliveries', saved.delivery_id)), false);
    const diagnostic = JSON.parse(readFileSync(join(root, kind, 'results', saved.delivery_id + '.json')));
    assert.equal(diagnostic.boundary.event_cursor, 17); assert.equal(diagnostic.child_outcome, null); assert.equal(diagnostic.state, 'unknown');
  }
});
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }


test('cancel while manager waits for an old child prevents even the new reservation/claim metadata', async t => {
  const { withExecutionEffectScope } = await import('../dist/execution-effect.js');
  const { ExecutionError } = await import('../dist/execution-wire.js');
  const f = fixture(t), entered = deferred(), resume = deferred(); let cancelled = false;
  f.manager.beforeChange = async () => { entered.resolve(); await resume.promise; };
  let delivery;
  const pending = withExecutionEffectScope('bot-b', () => assert.fail('no native'), () => withExecutionRequest(request('bot-b'), async () => {
    delivery = f.manager.request(parent); await delivery.before_send(boundary('bot-b'));
  }), undefined, body => { if (cancelled) throw new ExecutionError('EXECUTION_STOPPING'); return body(); });
  await entered.promise; cancelled = true; resume.resolve();
  await assert.rejects(pending, error => error.code === 'EXECUTION_STOPPING');
  assert.equal(delivery.result(), null); assert.equal(f.binds.length, 0); assert.equal(f.submits.length, 0);
  assert.deepEqual(f.manager.status('bot-b'), []);
});

test('execution Claude/Cursor without a private companion adapter cannot fall back to legacy helpers', async t => {
  const f = fixture(t);
  for (const endpoint of [{ kind: 'claude', hook_root: '/synthetic', request_id: 'toolu_missing', session_id: parent.thread_id },
    { kind: 'cursor', hook_root: '/synthetic' }]) {
    const delivery = withExecutionRequest(request('bot-b'), () => f.manager.request(endpoint));
    await assert.rejects(delivery.before_send(boundary('bot-b')), error => error.code === 'EXECUTION_UNSUPPORTED');
    assert.equal(delivery.result(), null);
  }
  assert.equal(f.binds.length, 0); assert.deepEqual(f.manager.status('bot-b'), []);
});

function companionProvider(overrides = {}) {
  return { DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
    cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true }, withDeliveryEffect() {},
    submitCodexParentAnswer() {}, submitClaudeParentAnswer() {}, submitCursorParentAnswer() {}, ...overrides };
}

test('companion factory uses its selected profile/provider and rejects replaced owner evidence before writing', async () => {
  let verified = false, calls = 0;
  const proof = { original: true }, parent = { kind: 'claude', request_id: 'toolu_selected', session_id: '00000000-0000-4000-8000-000000000001', hook_root: '/synthetic-selected' };
  const provider = companionProvider({ bindClaudeParentDelivery(profile, endpoint, id) {
    assert.equal(verified, true); assert.equal(profile.state_root(), '/synthetic-selected'); assert.deepEqual(endpoint, parent); assert.equal(id, 'existing-delivery'); calls++;
  } });
  const execution = createParentManagerExecution({ parent: {}, native: {}, provider, profile: { state_root: () => '/synthetic-selected' },
    verifyCompanion(_id, endpoint, evidence) { assert.deepEqual(endpoint, parent); assert.deepEqual(evidence, proof); verified = true; } });
  provider.bindClaudeParentDelivery = () => assert.fail('mutated provider function');
  execution.prepareCompanion('existing-delivery', parent, proof); assert.equal(calls, 1);
  const lost = createParentManagerExecution({ parent: {}, native: {}, provider, profile: {}, verifyCompanion() { throw Error('synthetic owner changed'); } });
  assert.throws(() => lost.prepareCompanion('existing-delivery', parent, proof), /owner changed/); assert.equal(calls, 1);
});

test('missing or asynchronous companion evidence cannot become a late proof and call a metadata writer', async () => {
  let calls = 0;
  const provider = companionProvider({ bindClaudeParentDelivery() { calls++; } });
  const endpoint = { kind: 'claude', request_id: 'toolu_bad', hook_root: '/synthetic', session_id: parent.thread_id };
  for (const verifyCompanion of [undefined, () => Promise.resolve(true)]) {
    const execution = createParentManagerExecution({ parent: {}, native: {}, provider, profile: {}, verifyCompanion });
    assert.throws(() => execution.prepareCompanion('existing-id', endpoint, {}), error => error.code === 'EXECUTION_UNSUPPORTED');
  }
  assert.equal(calls, 0);
});

test('a companion failure after a partial metadata write keeps the original bound record without a watcher or implicit retry', async t => {
  const { withExecutionEffectScope } = await import('../dist/execution-effect.js');
  const root = mkdtempSync(join(tmpdir(), 'execution-companion-partial-')), proof = { original: true };
  let binds = 0, writes = 0, watchers = 0;
  const execution = { captureEndpointEvidence: () => proof, async bind() { binds++; },
    prepareCompanion(id) { writes++; writeFileSync(join(root, 'partial.json'), JSON.stringify({ delivery_id: id })); throw Error('synthetic rename acknowledgement missing'); },
    async submit() { assert.fail('no queue'); } };
  const manager = new ParentDeliveryManager({ root: join(root, 'manager'), execution, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => true, verify: async () => {},
    observe: async () => { watchers++; assert.fail('no watcher'); }, answer: async () => assert.fail('no answer') } });
  t.after(() => manager.close());
  let delivery;
  await assert.rejects(withExecutionEffectScope('bot-b', () => assert.fail('no input'), () => withExecutionRequest(request('bot-b'), async () => {
    delivery = manager.request({ kind: 'cursor', hook_root: join(root, 'cursor-parent-hooks') }); await delivery.before_send(boundary('bot-b'));
  }), undefined, body => body()), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'not_started');
  const saved = delivery.result(); assert.equal(saved.state, 'unknown');
  assert.equal(JSON.parse(readFileSync(join(root, 'partial.json'))).delivery_id, saved.delivery_id);
  assert.equal(binds, 1); assert.equal(writes, 1); assert.equal(watchers, 0);
  const diagnostic = JSON.parse(readFileSync(join(root, 'manager', 'results', saved.delivery_id + '.json')));
  assert.equal(diagnostic.boundary.event_cursor, 17); assert.equal(diagnostic.state, 'unknown'); assert.equal(diagnostic.child_outcome, null);
});


test('factory parent selector is mandatory and synchronous, detached and fixed independently of later option changes', () => {
  const endpoint = { kind: 'claude', request_id: 'toolu_frozen', session_id: parent.thread_id, hook_root: '/synthetic-fixed-root' };
  const input = { parent: {}, native: {}, provider: companionProvider(), profile: {}, parentFromIngress: () => endpoint };
  const execution = createParentManagerExecution(input); input.parentFromIngress = () => null;
  const selected = execution.parentFromIngress(); selected.request_id = 'mutated';
  assert.deepEqual(execution.parentFromIngress(), endpoint);
  for (const parentFromIngress of [undefined, () => undefined, () => Promise.resolve(endpoint), () => ({ ...endpoint, unexpected: true })]) {
    const missing = createParentManagerExecution({ ...input, parentFromIngress });
    assert.throws(() => missing.parentFromIngress(), error => error.code === 'EXECUTION_UNSUPPORTED');
  }
  assert.equal(createParentManagerExecution({ ...input, parentFromIngress: () => null }).parentFromIngress(), null);
});
