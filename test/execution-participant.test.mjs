// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { guardTmuxExecution, bindExecutionNativeTarget, assertExecutionContext, withExecutionPreparation } from '../dist/execution-effect.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { closeExpectedExecution } from '../dist/execution-close.js';
import { currentExecutionIngress } from '../dist/execution-context.js';
import { EXECUTION_BINDING_META_KEY as BINDING, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';
import { registerExecutionTools } from '../dist/execution-tools.js';

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
test('private composition enrolls only its observed actor and missing bounded native reads remain unknown', async t => {
  const f = fixture(t), p = f.create();
  let inventory = p.inventory();
  assert.equal(inventory.participants[0].native_identity, 'unavailable');
  assert.deepEqual(inventory.participants[0].declared_roles, ['parent_producer', 'parent_worker', 'mcp']);
  assert.deepEqual(inventory.participants[0].actor, f.actor);
  assert.equal(JSON.stringify(await p.store.transaction(state => state.participants, { readOnly: true })).includes(A.launch_id), false);
  // Neither the fixed environment nor a declaration gives the inventory a
  // native observation when that complete injected runtime did not supply one.
  assert.equal(inventory.relation_coverage, 'incomplete'); assert.equal(inventory.native_fence, 'unknown');
  const g = fixture(t); g.options.runtime.observeActors = pids => pids.map(pid => ({ pid, started_identity: g.actor.started_identity }));
  const q = g.create(); await g.send(q);
  inventory = q.inventory(); assert.deepEqual(inventory.participants[0].missing, []);
  assert.equal(inventory.participants[0].references[0].request.process_pid, process.pid);
  assert.equal(inventory.relation_coverage, 'incomplete'); assert.equal(inventory.participant_discovery, 'unproven');
});
test('actual participant refuses registration removed between dispatch preflight and native command, without enrolling on use', async t => {
  const f = fixture(t), p = f.create(), raw = new FileExecutionStore(p.store.directory);
  const result = await f.send(p, 'registration-removed', () => raw.transactionSync(state => { state.participants = []; }));
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
  assert.equal(result._meta[ERROR].code, 'EXECUTION_UNSUPPORTED'); assert.equal(f.effects(), 0);
  assert.deepEqual(raw.transactionSync(state => state.slots, { readOnly: true }), []);
  assert.equal(p.inventory().participants[0].missing.includes('unregistered_actor'), true);
  assert.deepEqual(raw.transactionSync(state => state.participants, { readOnly: true }), []);
});
test('lost participant declaration after native issuance preserves the issued slot and reconstruction cannot replay it', async t => {
  const f = fixture(t), p = f.create(), raw = new FileExecutionStore(p.store.directory); let effects = 0;
  const result = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id, key: 'x' }, { requestId: 'issued-registration-loss' }, async () => {
    guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']); effects++;
    raw.transactionSync(state => { state.participants = []; }); return accepted();
  });
  assert.equal(result.isError, undefined); assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal(result.structuredContent.session_id, B.session_id); // preserve the genuine successful native receipt
  assert.equal(raw.transactionSync(state => state.slots, { readOnly: true })[0].state, 'issued');
  const rebuilt = f.create(), blocked = await f.send(rebuilt, 'later-request');
  assert.equal(blocked.isError, true); assert.equal(effects, 1); assert.equal(f.effects(), 0);
  assert.equal(raw.transactionSync(state => state.slots, { readOnly: true })[0].state, 'issued');
  assert.equal(rebuilt.inventory().native_fence, 'unknown');
});
test('stop whose native close completed before registration loss remains possible and retains the issued close slot', async t => {
  const f = fixture(t); let raw;
  const closes = enableClose(f, () => {}, () => raw.transactionSync(state => { state.participants = []; }));
  const p = f.create(); raw = new FileExecutionStore(p.store.directory);
  await assert.rejects(p.service.closeCascade(stop([B])), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'possible');
  assert.deepEqual(closes, [B]); assert.equal(f.live.has(B.session_id), false);
  const slot = raw.transactionSync(state => state.slots, { readOnly: true })[0];
  assert.equal(slot.stage, 'close'); assert.equal(slot.state, 'issued');
  const rebuilt = f.create();
  assert.equal((await f.send(rebuilt, 'after-uncertain-stop')).isError, true); assert.deepEqual(closes, [B]);
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
  for (const change of ['provider', 'partial-provider', 'runtime', 'deps', 'claude-runtime', 'actor', 'native', 'inventory']) {
    const f = fixture(t);
    if (change === 'provider') f.options.provider = undefined;
    if (change === 'partial-provider') delete f.options.provider.submitClaudeParentAnswer;
    if (change === 'runtime') delete f.options.runtime.observeDone;
    if (change === 'deps') delete f.options.parentDependencies.exists;
    if (change === 'claude-runtime') f.options.claudeRuntime = {};
    if (change === 'actor') f.actor.pid++;
    if (change === 'native') f.options.runtime.observeNativeSessions = {};
    if (change === 'inventory') f.options.runtime.observeActors = {};
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
  const result = await p.service.closeCascade(stop([A]));
  assert.deepEqual(effects, [A, B]); assert.deepEqual(f.live.get(D.session_id), D);
  assert.equal(result.status, 'partial'); assert.equal(result.relation_coverage, 'incomplete');
  assert.ok(result.unresolved.some(value => value.reason === 'relation_coverage_incomplete'));
  assert.ok(result.targets.every(value => value.outcome === 'closed'));
  await p.service.closeCascade(stop([A])); assert.equal(effects.length, 2);
});
test('an injected participant without close primitive stays unsupported without a default core fallback', async t => {
  const f = fixture(t), p = f.create();
  const result = await p.service.closeCascade(stop([B]));
  assert.equal(result.targets[0].outcome, 'unsupported'); assert.deepEqual(f.live.get(B.session_id), B);
  assert.deepEqual(await p.store.transaction(state => state.slots, { readOnly: true }), []);
});
test('scope, actor and generation drift after close preflight cannot cross the actual native issuance gate', async t => {
  for (const change of ['scope', 'actor', 'generation']) {
    const f = fixture(t), replacement = { ...B, launch_id: 'e'.repeat(32) };
    const originalScope = structuredClone(f.scope), originalActor = structuredClone(f.actor);
    const effects = enableClose(f, () => {
      if (change === 'scope') f.scope.multiplexer.key = join(f.root, 'changed.sock');
      if (change === 'actor') f.actor.started_identity = '2026-10-21T11:02:00Z';
      if (change === 'generation') f.live.set(B.session_id, replacement);
    });
    const p = f.create();
    if (change !== 'generation') {
      await assert.rejects(p.service.closeCascade(stop([B])), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'possible');
      assert.deepEqual(await p.store.transaction(state => state.slots, { readOnly: true }), [{ session_id: B.session_id,
        expected_launch_id: B.launch_id, stage: 'close', state: 'issued', request: null }]);
      Object.assign(f.scope, originalScope); Object.assign(f.actor, originalActor);
      const rebuilt = f.create(), repeated = await rebuilt.service.closeCascade(stop([B]));
      assert.equal(repeated.targets[0].outcome, 'unknown');
    } else {
      const result = await p.service.closeCascade(stop([B]));
      assert.equal(result.targets[0].outcome, 'replaced');
    }
    assert.equal(effects.length, 0); assert.ok(f.live.has(B.session_id));
  }
});
test('lost close receipt after an effect remains unknown across reconstruction despite observed absence and is never retried', async t => {
  const f = fixture(t), effects = enableClose(f, undefined, () => { throw Error('synthetic lost native receipt'); });
  const p = f.create(), result = await p.service.closeCascade(stop([B]));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].outcome, 'unknown');
  assert.equal(effects.length, 1); assert.equal(f.live.has(B.session_id), false);
  const rebuilt = f.create(), repeated = await rebuilt.service.closeCascade(stop([B]));
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
  const p = f.create(), result = await p.service.closeCascade(stop([B]));
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
  const stopped = await p.service.closeCascade(stop([A]));
  assert.deepEqual(effects, [A, B]); assert.equal(stopped.status, 'partial');
});
test('a guarded participant refuses direct unframed core mutations before native probes, auth, locks or metadata preparation', async t => {
  const f = fixture(t); f.create();
  const core = await import('../dist/core.js');
  for (const operation of [
    () => core.openSession('unframed-new'), () => core.openSession(),
    () => core.openAgent('codex', { session_name: B.session_id }),
    () => core.openAgentWithInitialPrompt('codex', { session_name: B.session_id }),
    () => core.send(B.session_id, 'synthetic'), () => core.sendKey(B.session_id, 'C-c'), () => core.sendKeyResult(B.session_id, 'Escape'),
    () => core.interruptExpectedAgentRun({ launch: B, boundary: null }),
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
test('preparation rechecks source/target/actor/scope after an await without issuing the pending native operation', async t => {
  for (const change of ['stop', 'source', 'target', 'actor', 'scope']) {
    const f = fixture(t); enableClose(f); const p = f.create();
    let enter, release, prepared = 0;
    const entered = new Promise(done => { enter = done; }), held = new Promise(done => { release = done; });
    const pending = p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'preparation-' + change }, async () => {
      enter(); await held; assertExecutionContext(B.session_id); prepared++;
      return accepted();
    });
    await entered;
    if (change === 'stop') {
      const stopped = await p.service.closeCascade(stop([A]));
      assert.equal(stopped.targets[0].outcome, 'closed'); assert.ok(f.live.has(B.session_id));
    }
    if (change === 'source') f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) });
    if (change === 'target') f.live.set(B.session_id, { ...B, launch_id: 'e'.repeat(32) });
    if (change === 'actor') f.actor.started_identity = '2026-10-21T12:30:00Z';
    if (change === 'scope') f.scope.multiplexer.key = join(f.root, 'different.sock');
    release(); const result = await pending;
    assert.equal(prepared, 0, change); assert.equal(result._meta[ERROR].effect, 'not_started', change);
    assert.equal(f.effects(), 0);
  }
});
test('metadata preparation shares the short admission lock without changing preparing phase, native slots or graph bytes', async t => {
  const f = fixture(t), p = f.create(), competitor = new FileExecutionStore(p.store.directory);
  const metadata = join(f.root, 'synthetic-preparation.json');
  const result = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'atomic-prepare' }, async () => {
    const graph = join(p.store.directory, 'relations.json'), before = readFileSync(graph, 'utf8');
    const prepared = withExecutionPreparation(B.session_id, () => {
      assert.equal(existsSync(join(p.store.directory, 'transaction.lock')), true);
      const state = JSON.parse(readFileSync(graph, 'utf8'));
      assert.equal(state.records[0].operations.send, 'preparing'); assert.deepEqual(state.slots, []);
      assert.throws(() => competitor.transactionSync(() => assert.fail('another admission entered the preparation lock')),
        code('EXECUTION_BUSY'));
      // Nested metadata helpers stay inside this exact transaction.
      return withExecutionPreparation(B.session_id, () => {
        assertExecutionContext(B.session_id); writeFileSync(metadata, 'synthetic prepared'); return { prepared: true };
      });
    });
    assert.deepEqual(prepared, { prepared: true }); assert.equal(readFileSync(graph, 'utf8'), before);
    assert.equal(existsSync(join(p.store.directory, 'transaction.lock')), false);
    guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']); return accepted();
  });
  assert.equal(result.isError, undefined); assert.equal(readFileSync(metadata, 'utf8'), 'synthetic prepared');
});
test('a preparation callback cannot issue a native command or borrow a different target, even when refusal is swallowed', async t => {
  for (const change of ['native', 'target']) {
    const f = fixture(t), p = f.create(); let effects = 0;
    const result = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'invalid-prepare-' + change }, async () => {
      try {
        withExecutionPreparation(change === 'target' ? A.session_id : B.session_id, () => {
          guardTmuxExecution(['send-keys', '-t', '=' + B.session_id + ':', 'x']); effects++;
        });
      } catch { /* a caller cannot make a poisoned frame successful */ }
      return accepted();
    });
    assert.equal(effects, 0); assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
    assert.deepEqual(await p.store.transaction(state => state.slots, { readOnly: true }), []);
  }
});
test('async or failed nested preparation poisons the frame without leaving a lock or an unhandled rejection', async t => {
  for (const change of ['async', 'nested']) {
    const f = fixture(t), p = f.create();
    const result = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'failed-prepare-' + change }, async () => {
      try {
        withExecutionPreparation(B.session_id, () => {
          if (change === 'async') return Promise.reject(Error('synthetic invalid async preparation'));
          try { withExecutionPreparation(B.session_id, () => { throw Error('synthetic metadata failure'); }); } catch {}
        });
      } catch {}
      return accepted();
    });
    await tick(); assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
    assert.equal(existsSync(join(p.store.directory, 'transaction.lock')), false); assert.equal(f.effects(), 0);
  }
});
test('an inherited preparation callback cannot write metadata after its original RPC frame has finished', async t => {
  const f = fixture(t), p = f.create(); let release, later, writes = 0;
  const held = new Promise(done => { release = done; });
  const receipt = await p.dispatcher.dispatch('pty_key', { session_id: B.session_id }, { requestId: 'late-prepare' }, async () => {
    later = held.then(() => {
      try { withExecutionPreparation(B.session_id, () => { writes++; }); }
      catch (error) { return error; }
    });
    return accepted();
  });
  assert.equal(receipt.isError, undefined); release(); const error = await later;
  assert.equal(writes, 0); assert.equal(error.code, 'EXECUTION_CONFLICT'); assert.equal(error.effect, 'not_started');
});
test('actual same-server private SDK stop records the composed MCP actor as key caller without inventing a source turn or native fence', async t => {
  const f = fixture(t), run = { launch: B, boundary: { event_cursor: 17, turn_id: 'actual-owned-synthetic-turn', operation_id: null, steer_id: null } };
  const observation = { schema: 'aiterm.native-interruption-observation.v1', run,
    native: { schema: 'aiterm.execution-native.v1', native_id: '$2', server: { pid: 4711, started_identity: '2026-10-21T09:00:00Z' } },
    harness: 'codex-cli', harness_process: { pid: 200, started_identity: '2026-10-21T09:00:01Z' },
    endpoint: { session_id: 'native-conversation', record_file: { device: 1, inode: 2 } }, recorded_state: 'running',
    native_boundary: { type: 'task_started', turn_id: run.boundary.turn_id, reason: null }, invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
  let keys = 0;
  Object.assign(f.options.runtime, { observeInterruptionSync: () => structuredClone(observation), selectInterruptionSync: () => structuredClone(observation),
    interruptKeySync: () => { guardTmuxExecution(['send-keys', '-t', '$2', 'Escape']); keys++;
      return { schema: 'aiterm.pty-key-result.v1', session_id: B.session_id, key: 'Escape', outcome: 'accepted', interruption: 'unconfirmed', session_preserved: 'unconfirmed' }; } });
  const p = f.create(); registerExecutionTools(p.server, p.service, { interruptCurrentRun: true });
  const client = await connect(t, p, 'bellteam'), response = await client.callTool({ name: 'agent_stop', arguments: {
    schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [B],
  } });
  assert.equal(response.isError, undefined); assert.equal(response.structuredContent.status, 'unconfirmed');
  assert.equal(response.structuredContent.targets[0].key_receipt, 'accepted'); assert.equal(response.structuredContent.targets[0].session_preserved, 'unconfirmed');
  const state = await p.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.deepEqual(state.interruptions[0].caller, f.actor); assert.notEqual(state.interruptions[0].caller.pid, observation.harness_process.pid);
  assert.equal(state.interruptions[0].phase, 'accepted'); assert.equal(keys, 1); assert.deepEqual(f.live.get(B.session_id), B);
  const inventory = p.inventory();
  assert.ok(inventory.participants.some(row => row.references.some(reference => reference.kind === 'interruption')));
  assert.equal(inventory.native_fence, 'unknown'); assert.equal(inventory.relation_coverage, 'incomplete');
  assert.deepEqual(state.records, [], 'a stop caller is not a synthetic source invocation/job');
});
