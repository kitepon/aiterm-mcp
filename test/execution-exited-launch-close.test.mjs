import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import * as core from '../dist/core.js';
import { agentMetadataPath } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { ExecutionError } from '../dist/execution-wire.js';

test('explicit native close retires only a proven empty exited unknown launch and preserves its failed record', {
  skip: process.platform === 'win32' ? 'POSIX native participant' : false, timeout: 15000,
}, async t => {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  t.after(() => { try { tmux('kill-server'); } catch {} });
  // An unrelated shell survives the explicit target close and keeps the fixture server alive.
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'fixture-unaffected');
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
  const close = () => client.callTool({ name: 'pty_close', arguments: { session_id: session } });
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
  assert.equal(closed.structuredContent.outcome, 'closed');
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
});
