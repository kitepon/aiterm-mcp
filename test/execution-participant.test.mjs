import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { guardTmuxExecution, bindExecutionNativeTarget } from '../dist/execution-effect.js';
import { closeExpectedExecution } from '../dist/execution-close.js';
import { currentExecutionIngress } from '../dist/execution-context.js';
import { EXECUTION_BINDING_META_KEY as BINDING, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';

const original = { spawn: childProcess.spawn, spawnSync: childProcess.spawnSync };
let nativeRunner;
childProcess.spawn = () => assert.fail('participant fixtures must never spawn a native process');
childProcess.spawnSync = (...args) => {
  assert.ok(nativeRunner, 'no native fallback outside the explicitly synthetic core runner'); return nativeRunner(...args);
};
syncBuiltinESMExports();
const { createExecutionParticipant } = await import('../dist/execution-participant.js');
test.after(() => { Object.assign(childProcess, original); syncBuiltinESMExports(); });
test.afterEach(() => { nativeRunner = null; });
const A = { session_id: 'participant-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'participant-b', launch_id: 'b'.repeat(32) };
const D = { session_id: 'participant-d', launch_id: 'd'.repeat(32) };
const point = launch => ({ launch: { ...launch }, boundary: null });
const code = name => value => value.code === name;
const accepted = () => ({ content: [{ type: 'text', text: 'synthetic accepted receipt' }],
  structuredContent: { session_id: B.session_id, launch_id: B.launch_id } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'execution-participant-'));
  const participants = [];
  t.after(async () => {
    for (const p of participants) await p.server.close();
    await tick(); rmSync(root, { recursive: true, force: true });
  });
  const scope = { state_root: root, multiplexer: { kind: 'socket', key: join(root, 'synthetic.sock') } };
  const actor = { pid: process.pid, started_identity: '2026-10-21T11:00:00Z' };
  const env = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id,
    AITERM_STATE_BASE: root, TMPDIR: root, XDG_RUNTIME_DIR: root, TEMP: root, TMP: root,
    PRIVATE_UNREQUESTED_VALUE: 'not copied' };
  let sourceReads = 0, effects = 0;
  const live = new Map([A, B, D].map(launch => [launch.session_id, { ...launch }]));
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: live.has(session_id),
    launch_id: live.get(session_id)?.launch_id ?? null });
  const provider = { withDeliveryEffect() {}, DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
    cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true },
    submitCodexParentAnswer() { assert.fail('no native queue fixture'); },
    submitClaudeParentAnswer() { assert.fail('no native queue fixture'); },
    submitCursorParentAnswer() { assert.fail('no native queue fixture'); } };
  const runtime = { scope: () => structuredClone(scope), actor: () => ({ ...actor }),
    observeParentProcess() { assert.fail('no independent native parent evidence fixture'); },
    observeSessionGeneration: observe, sourceEnvironment() { sourceReads++; return env; },
    decodeParent: () => null, async observeDone() { assert.fail('no native completion evidence fixture'); } };
  const deps = { processes: pids => pids.map(pid => ({ pid, started_identity: actor.started_identity })),
    exists: () => true, now: () => 0, wall: () => Date.parse('2026-10-21T11:00:00Z'),
    async observe() { assert.fail('no child waiter fixture'); }, async answer() { assert.fail('no answer fixture'); }, async verify() {} };
  const options = { runtime, provider, profile: { id: 'synthetic-participant', state_root: () => root },
    expectedScope: structuredClone(scope), parentDependencies: deps, claudeRuntime: { running: () => true } };
  const create = () => { const p = createExecutionParticipant(options); participants.push(p); return p; };
  const send = (participant, requestId = 1, beforeIssue = () => {}) => participant.dispatcher.dispatch('pty_key',
    { session_id: B.session_id, key: 'x' }, { requestId }, async () => {
      beforeIssue(); guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']); effects++; return accepted();
    });
  return { root, actor, env, scope, live, options, create, send, reads: () => sourceReads, effects: () => effects };
}
function enableClose(f, beforeEffect = () => {}, afterEffect = () => {}) {
  const effects = [], native = new Map([A, B, D].map((launch, i) => [launch.session_id, '$' + (i + 1)]));
  f.options.runtime.closeExpectedSession = expected => closeExpectedExecution(expected, {
    sessions: () => ({ state: 'known', sessions: [...f.live.keys()].map(session_id => ({ session_id, native_id: native.get(session_id) })) }),
    launch: name => f.live.get(name) ?? null,
    kill: nativeId => {
      beforeEffect(expected);
      bindExecutionNativeTarget(expected.session_id, nativeId);
      guardTmuxExecution(['kill-session', '-t', nativeId]);
      effects.push({ ...expected }); f.live.delete(expected.session_id); afterEffect(expected); return { code: 0 };
    },
  });
  return effects;
}
const stop = roots => ({ schema: 'aiterm.cascade-stop-request.v1', roots });
async function connect(t, participant, name = 'synthetic-native-client') {
  const client = new Client({ name, version: 'synthetic' }), [a, b] = InMemoryTransport.createLinkedPair();
  await participant.server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await participant.server.close(); await tick(); });
  return client;
}
test('one detached startup environment feeds real producer/service and dispatcher without a second supplier read', async t => {
  const f = fixture(t), p = f.create();
  f.env.AITERM_SESSION_ID = D.session_id; f.env.AITERM_AGENT_LAUNCH_ID = D.launch_id;
  f.env.TMPDIR = 'changed after startup';
  f.options.runtime.sourceEnvironment = () => assert.fail('must not reread caller runtime');
  const result = await f.send(p);
  assert.equal(result.isError, undefined); assert.equal(f.effects(), 1); assert.equal(f.reads(), 1);
  assert.deepEqual(result._meta[BINDING].source.point, point(A));
  assert.equal(p.startup.sourceEnvironment.TMPDIR, f.root);
  assert.equal('PRIVATE_UNREQUESTED_VALUE' in p.startup.sourceEnvironment, false);
  assert.equal(p.relation_coverage, 'incomplete'); assert.equal(p.worker.relation_coverage, 'incomplete');
  assert.equal(p.worker.store, p.store); assert.equal(p.worker.native, p.native);
});
test('a time-varying env supplier cannot split dispatcher source from service source', async t => {
  const f = fixture(t); let calls = 0;
  f.options.runtime.sourceEnvironment = () => ++calls === 1 ? f.env
    : { AITERM_SESSION_ID: D.session_id, AITERM_AGENT_LAUNCH_ID: D.launch_id };
  const p = f.create(), result = await f.send(p);
  assert.equal(result.isError, undefined); assert.deepEqual(result._meta[BINDING].source.point, point(A)); assert.equal(calls, 1);
});
test('provider, profile, expected scope and runtime method replacement cannot rewrite a constructed participant', async t => {
  const f = fixture(t), p = f.create();
  f.options.provider.DELIVERY_ADMISSION_CONTRACT.serialized_required = false;
  f.options.provider.submitClaudeParentAnswer = () => assert.fail('replacement provider callback');
  f.options.profile.state_root = () => join(f.root, 'different-root');
  f.options.expectedScope.state_root = join(f.root, 'different-root');
  f.options.runtime.observeSessionGeneration = () => assert.fail('replacement observer');
  f.options.runtime.actor = () => ({ pid: 1, started_identity: 'changed actor method' });
  const result = await f.send(p);
  assert.equal(result.isError, undefined); assert.equal(f.effects(), 1);
  assert.equal(result._meta[BINDING].request.process_pid, process.pid);
  assert.equal(result._meta[BINDING].request.process_started_identity, '2026-10-21T11:00:00Z');
});
test('actual scope or native actor drift during preflight refuses before a synthetic native effect', async t => {
  for (const change of ['scope', 'actor']) {
    const f = fixture(t), p = f.create();
    const result = await f.send(p, 2, () => {
      if (change === 'scope') f.scope.multiplexer.key = join(f.root, 'other.sock');
      else f.actor.started_identity = '2026-10-21T11:01:00Z';
    });
    assert.equal(result.isError, true); assert.equal(f.effects(), 0);
    assert.equal(result._meta[ERROR].effect, 'not_started');
  }
});
test('old provider, partial runtime/dependencies and a different serving PID are rejected without native fallback', t => {
  for (const change of ['provider', 'partial-provider', 'runtime', 'deps', 'claude-runtime', 'actor', 'native']) {
    const f = fixture(t);
    if (change === 'provider') f.options.provider = undefined;
    if (change === 'partial-provider') delete f.options.provider.submitClaudeParentAnswer;
    if (change === 'runtime') delete f.options.runtime.observeDone;
    if (change === 'deps') delete f.options.parentDependencies.exists;
    if (change === 'claude-runtime') f.options.claudeRuntime = {};
    if (change === 'actor') f.actor.pid++;
    if (change === 'native') f.options.runtime.observeNativeSessions = {};
    assert.throws(f.create, code('EXECUTION_UNSUPPORTED'));
  }
});
test('another socket cannot join the requested state, and malformed source environment never means independent operator', t => {
  for (const change of ['socket', 'root', 'null-env', 'array-env', 'non-string-env']) {
    const f = fixture(t);
    if (change === 'socket') f.scope.multiplexer.key = join(f.root, 'other.sock');
    if (change === 'root') f.scope.state_root = join(f.root, 'other');
    if (change === 'null-env') f.options.runtime.sourceEnvironment = () => null;
    if (change === 'array-env') f.options.runtime.sourceEnvironment = () => [];
    if (change === 'non-string-env') f.env.AITERM_SESSION_ID = 3;
    assert.throws(f.create, code('EXECUTION_UNSUPPORTED'));
  }
});
test('actual SDK exposes the unchanged 18 tools and native ingress keeps the fixed process/source context', async t => {
  const f = fixture(t), p = f.create(), client = await connect(t, p);
  assert.equal((await client.listTools()).tools.length, 18);
  let ingress;
  const result = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'existing-sdk-request' }, async () => {
    ingress = structuredClone(currentExecutionIngress());
    guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']); return accepted();
  });
  assert.equal(result.isError, undefined); assert.deepEqual(ingress.ingress.source, point(A));
  assert.deepEqual(ingress.ingress.native_identity, f.actor); assert.equal(ingress.ingress.client_name, 'synthetic-native-client');
});
test('actual initialized Claude manager uses participant state root and the same native owner without global state fallback', async t => {
  const f = fixture(t), p = f.create();
  await connect(t, p, 'claude-code'); await tick();
  const active = join(f.root, 'claude-parent-deliveries', 'active');
  assert.equal(existsSync(active), true);
  const owners = readdirSync(active).map(name => JSON.parse(readFileSync(join(active, name, 'owner.json'))));
  assert.equal(owners.length, 1); assert.equal(owners[0].pid, f.actor.pid);
  assert.equal(owners[0].started_identity, f.actor.started_identity);
});
test('read-only MCP routes also refuse participant drift before invoking a handler', async t => {
  const f = fixture(t), p = f.create(); f.scope.multiplexer.key = join(f.root, 'different.sock');
  const result = await p.dispatcher.dispatch('pty_list', {}, { requestId: 1 }, async () => assert.fail('scope drift reached a native read'));
  assert.equal(result._meta[ERROR].code, 'EXECUTION_UNSUPPORTED');
});
test('real SDK tools/call reaches the actual core key through the composed participant and original source binding',
  { skip: process.platform === 'win32' ? 'POSIX command fixture only' : false }, async t => {
  const f = fixture(t), p = f.create(), client = await connect(t, p); let keys = 0;
  nativeRunner = (bin, args) => {
    assert.equal(bin, 'tmux');
    const ok = stdout => ({ status: 0, stdout, stderr: '' });
    if (args[0] === '-V') return ok('tmux synthetic');
    assert.equal(args[0], '-S'); args = args.slice(2);
    if (args[0] === 'has-session') return ok('');
    if (args[0] === 'send-keys') {
      assert.equal(args[args.indexOf('-t') + 1], '=' + B.session_id + ':'); keys++; return ok('');
    }
    assert.fail('unexpected synthetic core command: ' + args[0]);
  };
  f.env.AITERM_AGENT_LAUNCH_ID = D.launch_id;
  const result = await client.callTool({ name: 'pty_key', arguments: { session_id: B.session_id, key: 'C-c' } });
  assert.equal(result.isError, undefined); assert.equal(keys, 1); assert.equal(f.reads(), 1);
  assert.deepEqual(result._meta[BINDING].source.point, point(A)); assert.deepEqual(result._meta[BINDING].target.launch, B);
});
test('composed stop closes each reached expected launch once and keeps an unrelated generation alive', async t => {
  const f = fixture(t), effects = enableClose(f), p = f.create(); await f.send(p);
  const result = await p.service.stop(stop([A]));
  assert.deepEqual(effects, [A, B]); assert.deepEqual(f.live.get(D.session_id), D);
  assert.equal(result.status, 'partial'); assert.equal(result.relation_coverage, 'incomplete');
  assert.ok(result.unresolved.some(value => value.reason === 'relation_coverage_incomplete'));
  assert.ok(result.targets.every(value => value.outcome === 'closed'));
  await p.service.stop(stop([A])); assert.equal(effects.length, 2);
});
test('an injected participant without close primitive stays unsupported without a default core fallback', async t => {
  const f = fixture(t), p = f.create();
  const result = await p.service.stop(stop([B]));
  assert.equal(result.targets[0].outcome, 'unsupported'); assert.deepEqual(f.live.get(B.session_id), B);
  assert.deepEqual(await p.store.transaction(state => state.slots, { readOnly: true }), []);
});
test('scope, actor and generation drift after close preflight cannot cross the actual native issuance gate', async t => {
  for (const change of ['scope', 'actor', 'generation']) {
    const f = fixture(t), replacement = { ...B, launch_id: 'e'.repeat(32) };
    const effects = enableClose(f, () => {
      if (change === 'scope') f.scope.multiplexer.key = join(f.root, 'changed.sock');
      if (change === 'actor') f.actor.started_identity = '2026-10-21T11:02:00Z';
      if (change === 'generation') f.live.set(B.session_id, replacement);
    });
    const p = f.create(), result = await p.service.stop(stop([B]));
    assert.equal(effects.length, 0); assert.ok(f.live.has(B.session_id));
    assert.equal(result.targets[0].outcome, change === 'generation' ? 'replaced' : 'unknown');
  }
});
test('lost close receipt after an effect remains unknown across reconstruction despite observed absence and is never retried', async t => {
  const f = fixture(t), effects = enableClose(f, undefined, () => { throw Error('synthetic lost native receipt'); });
  const p = f.create(), result = await p.service.stop(stop([B]));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].outcome, 'unknown');
  assert.equal(effects.length, 1); assert.equal(f.live.has(B.session_id), false);
  const rebuilt = f.create(), repeated = await rebuilt.service.stop(stop([B]));
  assert.equal(repeated.targets[0].outcome, 'unknown'); assert.equal(effects.length, 1);
  const slots = await rebuilt.store.transaction(state => state.slots, { readOnly: true });
  assert.equal(slots[0].state, 'unknown'); assert.equal(slots[0].expected_launch_id, B.launch_id);
});
test('an injected async close cannot issue a late native effect outside its synchronous close frame', async t => {
  const f = fixture(t); let effects = 0;
  f.options.runtime.closeExpectedSession = async expected => {
    await tick(); bindExecutionNativeTarget(expected.session_id, '$2');
    guardTmuxExecution(['kill-session', '-t', '$2']); effects++; f.live.delete(expected.session_id);
  };
  const p = f.create(), result = await p.service.stop(stop([B]));
  assert.equal(result.targets[0].outcome, 'unknown'); assert.equal(effects, 0); assert.ok(f.live.has(B.session_id));
});
test('local native done cannot retire a composed branch without an invocation fence or complete participant evidence', async t => {
  const f = fixture(t), effects = enableClose(f);
  f.options.runtime.observeDone = async session_id => ({ schema: 'aiterm.agent-wait-result.v1', session_id,
    launch_id: B.launch_id, outcome: 'done', operation_id: null, turn_id: 'synthetic-native-turn' });
  const p = f.create(), receipt = await p.dispatcher.dispatch('pty_send', { session_id: B.session_id, text: 'synthetic' }, { requestId: 77 }, async () => {
    guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']);
    return { ...accepted(), structuredContent: { ...accepted().structuredContent, mode: 'agent_dispatch', event_cursor: 17 } };
  });
  const binding = receipt._meta[BINDING];
  const finished = await p.service.execute({ action: 'finish', request: binding.request,
    evidence: { kind: 'completion', target: binding.target } });
  assert.equal(finished.relation.completion, 'completed'); assert.equal(finished.relation.target_fence, 'unknown');
  assert.equal(finished.relation.lifecycle, 'tracking');
  const stopped = await p.service.stop(stop([A]));
  assert.deepEqual(effects, [A, B]); assert.equal(stopped.status, 'partial');
});
test('a guarded participant refuses direct unframed core mutations before native probes, auth, locks or metadata preparation', async t => {
  const f = fixture(t); f.create();
  const core = await import('../dist/core.js');
  for (const operation of [
    () => core.openSession('unframed-new'), () => core.openSession(),
    () => core.openAgent('codex', { session_name: B.session_id }),
    () => core.openAgentWithInitialPrompt('codex', { session_name: B.session_id }),
    () => core.send(B.session_id, 'synthetic'), () => core.sendKey(B.session_id, 'C-c'),
    () => core.closeSession(B.session_id), () => core.closeSessionResult(B.session_id),
    () => core.closeExpectedAgentSession(B), () => core.killAll(),
    () => core.sendInitialAgentPrompt(B.session_id, 'synthetic'), () => core.dispatchAgentTurn(B.session_id, 'synthetic'),
    () => core.sendAgentMessage(B.session_id, 'synthetic'), () => core.configureAgent(B.session_id, { fast: false }),
    ...['start', 'cancel', 'status'].map(action => () => core.authenticateAgent('codex', { action, session_id: B.session_id })),
    () => core.authenticateAgent('codex', { action: 'start' }),
    () => core.runAgentApproval({ action: 'respond', session_id: B.session_id }),
    () => core.runClaudeApproval({ action: 'respond', session_id: B.session_id }),
    () => core.runClaudeOperation({ action: 'issue', session_id: B.session_id, operation_id: 'synthetic' }),
    () => core.ensureAgentOwnsPaneInput(B.session_id, 'codex'),
  ]) await assert.rejects(async () => operation(), code('EXECUTION_UNSUPPORTED'));
});
