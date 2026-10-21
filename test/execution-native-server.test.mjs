// Native entry composition, all process/runtime/key evidence injected fake.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createNativeExecutionServer, createNativeExecutionWorker, parseNativeExecutionArguments } from '../dist/execution-native-server.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
const A = { session_id: 'native-entry-a', launch_id: 'a'.repeat(32) };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-entry-')), servers = [], actor = { pid: process.pid, started_identity: '2026-10-21T22:00:01Z' };
  t.after(async () => { for (const p of servers) await p.server.close(); rmSync(root, { recursive: true, force: true }); });
  const scope = { state_root: root, multiplexer: { kind: 'socket', key: join(root, 'native.sock') } };
  const point = { launch: A, boundary: { event_cursor: 7, turn_id: 'original-native-turn', operation_id: null, steer_id: null } };
  const observation = { schema: 'aiterm.native-interruption-observation.v1', run: point,
    native: { schema: 'aiterm.execution-native.v1', native_id: '$1', server: { pid: 401, started_identity: '2026-10-21T22:00:00Z' } },
    harness: 'codex-cli', harness_process: { pid: 402, started_identity: '2026-10-21T22:00:01Z' },
    endpoint: { session_id: 'synthetic-conversation', record_file: { device: 1, inode: 2 } },
    recorded_state: 'running', native_boundary: { type: 'task_started', turn_id: point.boundary.turn_id, reason: null },
    invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
  let keys = 0, selections = 0;
  const provider = { DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
    cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true }, withDeliveryEffect() {},
    submitCodexParentAnswer: () => assert.fail('no native queue'), submitClaudeParentAnswer: () => assert.fail('no native queue'),
    submitCursorParentAnswer: () => assert.fail('no native queue'), codexParentFromRequest: () => null,
    claudeParentFromRequest: () => null, cursorParentFromRequest: () => null, verifyCodexParent() {}, verifyClaudeParent() {}, verifyCursorParent() {} };
  const runtime = { scope: () => structuredClone(scope), actor: () => ({ ...actor }),
    observeActors: pids => pids.map(pid => ({ pid, started_identity: actor.started_identity })),
    observeSessionGeneration: session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: session_id === A.session_id,
      launch_id: session_id === A.session_id ? A.launch_id : null }),
    observeParentProcess: () => assert.fail('no parent proof'), sourceEnvironment: () => ({}), decodeParent: () => null,
    observeDone: async () => assert.fail('no completion fallback'), observeInterruptionSync: () => structuredClone(observation),
    selectInterruptionSync: () => { selections++; return structuredClone(observation); },
    interruptKeySync: run => { assert.deepEqual(run, point); guardTmuxExecution(['send-keys', '-t', '$1', 'Escape']); keys++;
      return { schema: 'aiterm.pty-key-result.v1', session_id: A.session_id, key: 'Escape', outcome: 'accepted', interruption: 'unconfirmed', session_preserved: 'unconfirmed' }; } };
  const options = { interruptCurrentRun: true, expectedScope: structuredClone(scope), provider, runtime,
    parentDependencies: { observe: async () => assert.fail('no wait'), answer: async () => assert.fail('no body'), verify: async () => {},
      processes: pids => pids.map(pid => ({ pid, started_identity: actor.started_identity })), exists: () => true, now: () => 0, wall: () => Date.now() },
    claudeRuntime: { running: () => true } };
  return { root, scope, actor, options, point, keys: () => keys, selections: () => selections,
    create() { const p = createNativeExecutionServer(options); servers.push(p); return p; } };
}
test('native stdio args require explicit opt-in, exact absolute scope and explicit candidate provider before any runtime construction', () => {
  const args = ['--execution-interrupt', '--state-root', '/synthetic/state', '--socket', '/synthetic/socket', '--steer-provider', '/synthetic/provider.mjs'];
  assert.deepEqual(parseNativeExecutionArguments(args), { mode: 'mcp', codexHome: undefined, hookDirectory: undefined, expectedScope: { state_root: '/synthetic/state', multiplexer: { kind: 'socket', key: '/synthetic/socket' } }, providerFile: '/synthetic/provider.mjs' });
  for (const bad of [[], args.slice(1), args.slice(0,-2), args.map(value => value === '/synthetic/state' ? 'relative' : value), [...args, '--unknown']])
    assert.throws(() => parseNativeExecutionArguments(bad));
});
test('native factory refuses missing opt-in, namespace and an old provider before native actor reads or graph creation', t => {
  for (const change of [f => { f.options.interruptCurrentRun = false; }, f => { f.options.expectedScope.multiplexer.kind = 'namespace'; },
    f => { delete f.options.provider.claudeParentFromRequest; }, f => { f.options.provider.DELIVERY_ADMISSION_CONTRACT = {}; }]) {
    const f = fixture(t); change(f); f.options.runtime.actor = () => assert.fail('must refuse before native actor');
    assert.throws(f.create); assert.equal(existsSync(join(f.root, 'execution')), false);
  }
});
test('partial injected runtime never inherits default native interruption functions', t => {
  for (const name of ['selectInterruptionSync', 'observeInterruptionSync', 'interruptKeySync']) {
    const f = fixture(t); delete f.options.runtime[name];
    f.options.runtime.actor = () => assert.fail('missing primitive must fail before native reads'); assert.throws(f.create);
  }
});
test('regular SDK entry lists controls and routes v2 through the shared controller/key slot while key receipt stays unconfirmed', async t => {
  const f = fixture(t), p = f.create(); const client = new Client({ name: 'synthetic-owner', version: 'test' });
  const [a,b] = InMemoryTransport.createLinkedPair(); await p.server.connect(b); await client.connect(a); t.after(() => client.close());
  const list = await client.listTools(); assert.equal(list.tools.length, 21);
  for (const name of ['agent_stop','agent_execution','agent_execution_roots']) assert.ok(list.tools.some(tool => tool.name === name));
  const receipt = await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [A] } });
  assert.equal(receipt.isError, undefined); assert.equal(f.keys(), 1); assert.equal(f.selections(), 1);
  assert.equal(receipt.structuredContent.status, 'unconfirmed'); assert.equal(receipt.structuredContent.targets[0].key_receipt, 'accepted');
  assert.equal(receipt.structuredContent.targets[0].session_preserved, 'unconfirmed');
  const graph = await p.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(graph.interruptions[0].phase, 'accepted'); assert.equal(graph.slots[0].stage, 'interrupt'); assert.equal(graph.slots[0].state, 'unknown');
  await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [A] } });
  assert.equal(f.keys(), 1, 'native receipt must not be replayed');
});
test('scope/caller swap after factory construction rejects stop before an injected key can be sent', async t => {
  const f = fixture(t), p = f.create(); f.actor.started_identity = '2026-10-21T22:00:02Z';
  await assert.rejects(p.service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [A] }));
  assert.equal(f.keys(), 0);
});


test('MCP and hook command variants share one explicit scope/provider prefix without treating hook JSON as MCP stdio', () => {
  const prefix = ['--execution-interrupt','--state-root','/synthetic/state','--socket','/synthetic/socket','--steer-provider','/synthetic/provider.mjs'];
  for (const mode of ['mcp','claude-hook','cursor-hook']) {
    const value = parseNativeExecutionArguments([...prefix,'--mode',mode]); assert.equal(value.mode, mode);
    assert.equal(value.expectedScope.state_root, '/synthetic/state'); assert.equal(value.providerFile, '/synthetic/provider.mjs');
  }
  assert.throws(() => parseNativeExecutionArguments([...prefix,'--mode','codex-hook']));
  const codex = parseNativeExecutionArguments([...prefix,'--mode','codex-hook','--codex-home','/synthetic/codex','--hook-directory','/synthetic/hook']);
  assert.equal(codex.codexHome, '/synthetic/codex'); assert.equal(codex.hookDirectory, '/synthetic/hook');
  assert.throws(() => parseNativeExecutionArguments([...prefix,'--mode','unknown']));
});

test('separate hook worker uses its own scoped actor and admission profile instead of inheriting the MCP actor', async t => {
  const f = fixture(t), hookActor = { pid: process.pid + 1000, started_identity: '2026-10-21T22:00:03Z' };
  const worker = createNativeExecutionWorker({ interruptCurrentRun: true, expectedScope: f.options.expectedScope, provider: f.options.provider,
    runtime: { ...f.options.runtime, actor: () => ({ ...hookActor }) } });
  const graph = await worker.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.deepEqual(graph.participants[0].actor, hookActor); assert.deepEqual(graph.participants[0].roles, ['parent_worker']);
  assert.equal(typeof worker.profile.delivery_admission.run, 'function'); assert.equal(worker.relation_coverage, 'incomplete');
  f.scope.multiplexer.key += '-changed'; await assert.rejects(worker.store.transaction(() => null));
});
