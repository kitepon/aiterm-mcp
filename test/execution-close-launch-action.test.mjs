import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import * as core from '../dist/core.js';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { ExecutionError } from '../dist/execution-wire.js';
import { executionClosedLaunchSchema } from '../dist/execution-wire.js';

test('close_launch binds the original request and expected generation to the serving SDK close receipt', {
  skip: process.platform === 'win32' ? 'POSIX native participant' : false, timeout: 30000,
}, async t => {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  t.after(() => { try { tmux('kill-server'); } catch {} });
  // An unrelated shell survives the explicit target close and keeps the fixture server alive.
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'fixture-unaffected', '/bin/bash', '--noprofile', '--norc');
  const binary = join(process.env.HOME, 'fixture-codex');
  writeFileSync(binary, '#!/bin/sh\nprintf "OpenAI Codex\\n› ready\\n"\nwhile IFS= read -r line; do [ "$line" = "fixture-exit" ] && break; printf "%s\\n" "$line"; done\n', { mode: 0o700 });
  process.env.CODEX_BIN = binary;
  const p = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: scope, provider });
  t.after(() => p.server.close());
  const client = new Client({ name: 'bellteam', version: 'fixture' }), [a, b] = InMemoryTransport.createLinkedPair();
  await p.server.connect(b); await client.connect(a); t.after(() => client.close());
  const session = 'fixture-exited-launch';
  const request = { kind: 'delivery', delivery_id: 'fixture-failed-launch', target_session_id: session };
  await p.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: session, expected_launch_id: null } } });
  const bind = p.service.bindCreatedLaunch.bind(p.service);
  p.service.bindCreatedLaunch = (...args) => { bind(...args); throw new ExecutionError('EXECUTION_BUSY', 'possible'); };
  const failed = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true,
  }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
  assert.equal(failed.isError, true);
  const original = await p.service.execute({ action: 'status', request });
  assert.deepEqual(original.operations, { launch: 'unknown', send: 'not_issued' });
  const target = original.relation.target.launch;
  const observation = core.observeSession(session);
  assert.equal(observation.harness_alive, false); assert.equal(observation.reason, 'harness_exited');
  const file = agentMetadataPath(session, target.launch_id), text = readFileSync(file, 'utf8'), raw = JSON.parse(text);
  const close = (args = {}) => client.callTool({ name: 'agent_execution', arguments: { action: 'close_launch', request, target, ...args } });
  assert.equal((await close({ request: { ...request, delivery_id: 'different-failed-request' } })).isError, true);
  assert.equal((await close({ target: { ...target, launch_id: 'f'.repeat(32) } })).isError, true);
  assert.deepEqual(await p.service.execute({ action: 'status', request }), original);
  for (const changes of [{ initial_prompt: 'sent' }, { initial_prompt: undefined },
    { initial_prompt_delivery: { status: 'submitted_unconfirmed' } },
    { execution_native: { ...raw.execution_native, native_id: '$999999' } }]) {
    writeFileSync(file, JSON.stringify({ ...raw, ...changes }));
    const denied = await close(); assert.equal(denied.isError, true, JSON.stringify(denied));
    assert.equal(core.observeSessionGeneration(session).exists, true);
    assert.deepEqual(await p.service.execute({ action: 'status', request }), original);
    assert.equal(p.store.snapshot().slots.filter(slot => slot.session_id === session).length, 1);
  }
  writeFileSync(file, text);
  await p.store.transaction(state => {
    state.records.find(row => row.reservation.request.delivery_id === request.delivery_id).operations.launch = 'issued';
    state.slots.find(row => row.session_id === session).state = 'issued';
  });
  assert.equal((await close()).isError, true, 'an RPC that may still be issuing cannot be displaced');
  await p.store.transaction(state => {
    state.records.find(row => row.reservation.request.delivery_id === request.delivery_id).operations.launch = 'unknown';
    state.slots.find(row => row.session_id === session).state = 'unknown';
  });
  // Fixture control: prove a live harness is refused even with the exact
  // unknown slot and raw empty metadata. No real CLI or real seat is used.
  tmux('send-keys', '-t', session, binary, 'Enter');
  let deadline = performance.now() + 5000;
  while (core.observeSession(session).harness_alive !== true) {
    assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await close()).isError, true);
  assert.equal(core.observeSession(session).harness_alive, true);
  tmux('send-keys', '-t', session, 'fixture-exit', 'Enter');
  deadline = performance.now() + 5000;
  while (core.observeSession(session).harness_alive !== false) {
    assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const closed = await close();
  assert.equal(closed.isError, undefined, JSON.stringify(closed));
  const receipt = executionClosedLaunchSchema.parse(closed._meta['aiterm/closed_launch']);
  assert.equal(receipt.outcome, 'closed'); assert.equal(receipt.action, 'close_launch');
  assert.equal(receipt.version, 1); assert.deepEqual(receipt.request, request); assert.deepEqual(receipt.target, target);
  assert.equal(receipt.management_ref.kind, 'mcp'); assert.equal(receipt.management_ref.tool, 'pty_close');
  assert.notDeepEqual(receipt.management_ref, request);
  assert.deepEqual(closed.structuredContent.reservation.request, receipt.management_ref);
  assert.deepEqual(closed._meta['aiterm/execution_binding'].target.launch, target);
  assert.equal(receipt.evidence.absence_confirmed, true); assert.equal(receipt.evidence.metadata_committed, true);
  assert.equal(tmux('list-sessions', '-F', '#{session_name}').trim(), 'fixture-unaffected');
  assert.deepEqual(await p.service.execute({ action: 'status', request }), original);
  assert.equal(p.store.snapshot().slots.filter(slot => slot.session_id === session).length, 0);
  const replay = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true,
  }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
  assert.equal(replay.isError, true);
  assert.equal(core.observeSessionGeneration(session).exists, false);
  const fresh = await p.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request: { ...request, delivery_id: 'fixture-new-delivery' },
    source: { launch: null, boundary: null }, target: { session_id: session, expected_launch_id: null } } });
  assert.deepEqual(fresh.operations, { launch: 'not_issued', send: 'not_issued' });
  // The former successful close is history. It cannot close a later C or
  // produce another closed certificate for the old original request.
  p.service.bindCreatedLaunch = bind;
  core.__testSetAgentTuiReadyStableSamples(1); t.after(() => core.__testSetAgentTuiReadyStableSamples(null));
  const opened = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true,
  }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request: fresh.reservation.request } } });
  assert.equal(opened.isError, undefined, JSON.stringify(opened));
  const replacement = core.observeSessionGeneration(session); assert.notEqual(replacement.launch_id, target.launch_id);
  const staleClose = await close(); assert.equal(staleClose.isError, true); assert.equal(staleClose._meta['aiterm/closed_launch'], undefined);
  assert.deepEqual(core.observeSessionGeneration(session), replacement);

  async function failedShell(name, harness = 'codex-cli') {
    const request = { kind: 'delivery', delivery_id: 'failed-' + name, target_session_id: name };
    await p.service.execute({ action: 'register', source_session_id: null, reservation: {
      schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
      target: { session_id: name, expected_launch_id: null } } });
    p.service.bindCreatedLaunch = (...args) => { bind(...args); throw new ExecutionError('EXECUTION_BUSY', 'possible'); };
    try {
      const result = await client.callTool({ name: 'agent_launch', arguments: {
        harness, session_name: name, cwd: process.env.HOME, trust_project: true,
      }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
      assert.equal(result.isError, true);
    } finally { p.service.bindCreatedLaunch = bind; }
    const record = await p.service.execute({ action: 'status', request });
    return { request, record, target: record.relation.target.launch };
  }
  await t.test('Claude empty exited launch uses the same guarded close contract', async () => {
    const claude = join(process.env.HOME, 'fixture-claude');
    writeFileSync(claude, '#!/bin/sh\nif [ "$1" = auth ] && [ "$2" = status ]; then\n  printf \'%s\\n\' \'{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}\'\n  exit 0\nfi\nprintf "Claude Code\\n❯ ready\\n"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done\n', { mode: 0o700 });
    process.env.CLAUDE_BIN = claude;
    const f = await failedShell('fixture-close-claude', 'claude-code');
    assert.deepEqual(f.record.operations, { launch: 'unknown', send: 'not_issued' });
    const observation = core.observeSession(f.target.session_id);
    assert.equal(observation.harness, 'claude-code');
    assert.equal(observation.reason, 'harness_exited');
    const closed = await client.callTool({ name: 'agent_execution', arguments: {
      action: 'close_launch', request: f.request, target: f.target,
    } });
    assert.equal(closed.isError, undefined, JSON.stringify(closed));
    const receipt = executionClosedLaunchSchema.parse(closed._meta['aiterm/closed_launch']);
    assert.deepEqual(receipt.request, f.request); assert.deepEqual(receipt.target, f.target);
    assert.equal(receipt.evidence.initial_prompt, 'none');
    assert.equal(core.observeSessionGeneration(f.target.session_id).exists, false);
    assert.deepEqual(await p.service.execute({ action: 'status', request: f.request }), f.record);
    assert.equal(p.store.snapshot().slots.filter(slot => slot.session_id === f.target.session_id).length, 0);
  });
  await t.test('replacement after metadata admission is fenced before the close primitive', async () => {
    const f = await failedShell('fixture-close-replaced');
    const file = agentMetadataPath(f.target.session_id, f.target.launch_id), raw = JSON.parse(readFileSync(file, 'utf8'));
    const admit = p.service.admitNative.bind(p.service); let replaced = false, nativeCalls = 0;
    const primitive = p.service.runtime.closeCreatedLaunchSync;
    p.service.runtime.closeCreatedLaunchSync = target => { nativeCalls++; return primitive(target); };
    p.service.admitNative = async body => {
      if (!replaced) {
        replaced = true;
        // Fixture-owned external generation C appears after registration and
        // preparing, before native admission. No real seat is involved.
        tmux('kill-session', '-t', f.target.session_id);
        tmux('new-session', '-d', '-s', f.target.session_id);
        const observed = core.observeExecutionNativeCreationScope();
        const native = observed.sessions.find(row => row.session_id === f.target.session_id);
        const launch = 'c'.repeat(32); unlinkSync(file);
        writeFileSync(agentMetadataPath(f.target.session_id, launch), JSON.stringify({ ...raw, launch_id: launch,
          event_file: agentEventPath(f.target.session_id, launch),
          execution_native: { schema: 'aiterm.execution-native.v1', native_id: native.native_id, server: observed.server } }));
        writeFileSync(agentEventPath(f.target.session_id, launch), '');
      }
      return admit(body);
    };
    try {
      const denied = await client.callTool({ name: 'agent_execution', arguments: { action: 'close_launch', request: f.request, target: f.target } });
      assert.equal(denied.isError, true); assert.equal(denied._meta['aiterm/closed_launch'], undefined);
      assert.equal(replaced, true); assert.equal(nativeCalls, 0);
      assert.equal(core.observeExecutionSessionGeneration(f.target.session_id).launch_id, 'c'.repeat(32));
      assert.deepEqual(await p.service.execute({ action: 'status', request: f.request }), f.record);
    } finally { p.service.admitNative = admit; p.service.runtime.closeCreatedLaunchSync = primitive; }
  });
  await t.test('native close followed by failed metadata commit returns uncertainty without a closed certificate', async () => {
    const f = await failedShell('fixture-close-commit-failure');
    const transaction = p.store.transaction.bind(p.store), primitive = p.service.runtime.closeCreatedLaunchSync;
    let failCommit = false, nativeCalls = 0, injected = false;
    p.service.runtime.closeCreatedLaunchSync = target => {
      const value = primitive(target); nativeCalls++; failCommit = true; return value;
    };
    p.store.transaction = (...args) => {
      if (failCommit) { failCommit = false; injected = true; return Promise.reject(new ExecutionError('EXECUTION_STATE_UNAVAILABLE', 'possible')); }
      return transaction(...args);
    };
    try {
      const args = { action: 'close_launch', request: f.request, target: f.target };
      const unknown = await client.callTool({ name: 'agent_execution', arguments: args });
      assert.equal(unknown.isError, true); assert.equal(unknown._meta['aiterm/closed_launch'], undefined);
      assert.equal(unknown._meta['aiterm/execution_error'].effect, 'possible');
      assert.equal(injected, true); assert.equal(nativeCalls, 1);
      assert.equal(core.observeSessionGeneration(f.target.session_id).exists, false);
      assert.deepEqual(await p.service.execute({ action: 'status', request: f.request }), f.record);
      assert.equal((await client.callTool({ name: 'agent_execution', arguments: args })).isError, true);
      assert.equal(nativeCalls, 1, 'an unknown close result cannot replay the native close');
    } finally { p.store.transaction = transaction; p.service.runtime.closeCreatedLaunchSync = primitive; }
  });
});
