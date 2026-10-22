import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { agentMetadataPath } from '../dist/agent-shared.js';
const original = cp.spawnSync;
let trace;
cp.spawnSync = (...args) => { const value = original(...args); trace?.(...args); return value; };
syncBuiltinESMExports();
const core = await import('../dist/core.js');
test.after(() => { cp.spawnSync = original; syncBuiltinESMExports(); });
test('native MCP reconciles an empty created launch without input or replacement and refuses raw unknown prompt state',
  { skip: process.platform === 'win32' ? 'POSIX native participant' : false, timeout: 20000 }, async t => {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => cp.execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  t.after(() => { trace = null; try { tmux('kill-server'); } catch {} });
  const binary = join(process.env.HOME, 'fixture-reconcile-codex');
  writeFileSync(binary, '#!/bin/sh\nprintf "OpenAI Codex\\n› ready\\n"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done\n', { mode: 0o700 });
  process.env.CODEX_BIN = binary;
  const p = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: scope, provider });
  t.after(() => p.server.close());
  const client = new Client({ name: 'bellteam', version: 'fixture' }), [a,b] = InMemoryTransport.createLinkedPair();
  await p.server.connect(b); await client.connect(a); t.after(() => client.close());
  const session = 'fixture-reconcile-native', request = { kind: 'delivery', delivery_id: 'fixture-reconcile-original', target_session_id: session };
  await p.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: session, expected_launch_id: null } } });
  let creates = 0, inputs = 0, fail = true, writer;
  trace = (bin,args) => {
    if (!args?.includes('-S') || args[args.indexOf('-S')+1] !== socket) return;
    const command = args[args.indexOf('-S')+2];
    if (command === 'new-session') creates++;
    if (command === 'send-keys') { inputs++; if (fail && args.at(-1) === 'Enter') { fail = false; queueMicrotask(() => { writer = p.store.transaction(async state => { state.slots.find(row => row.session_id === session).state = 'unknown'; await new Promise(resolve => setTimeout(resolve, 80)); }); }); } }
  };
  const launched = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true,
  }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
  await writer;
  assert.equal(launched.isError, true);
  const before = p.store.snapshot(), originalRecord = before.records.find(r => r.reservation.request.delivery_id === request.delivery_id);
  assert.equal(originalRecord.operations.launch, 'unknown'); assert.equal(originalRecord.operations.send, 'not_issued');
  const generation = core.observeExecutionSessionGeneration(session), target = { session_id: session, launch_id: generation.launch_id };
  assert.ok(target.launch_id, JSON.stringify({launched, originalRecord, generation, slots: before.slots}));
  for (let i = 0; i < 20; i++) { if (core.observeSession(session).state === 'idle') break; await new Promise(resolve => setTimeout(resolve, 50)); }
  const file = agentMetadataPath(session, target.launch_id), text = readFileSync(file, 'utf8'), raw = JSON.parse(text);
  assert.equal(raw.initial_prompt, 'none');
  const counts = { creates, inputs }, action = { action: 'reconcile_launch', request, target };
  for (const value of [undefined, 'sent']) {
    const bad = { ...raw, initial_prompt: value }; writeFileSync(file, JSON.stringify(bad));
    const denied = await client.callTool({ name: 'agent_execution', arguments: action });
    assert.equal(denied.isError, true); assert.deepEqual(p.store.snapshot(), before);
  }
  writeFileSync(file, text);
  const result = await client.callTool({ name: 'agent_execution', arguments: action });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.structuredContent.operations.launch, 'accepted');
  assert.equal(result.structuredContent.operations.send, 'not_issued');
  assert.deepEqual(result.structuredContent.reservation, originalRecord.reservation);
  assert.deepEqual(result._meta['aiterm/execution_binding'].target, { launch: target, boundary: null });
  assert.deepEqual(p.store.snapshot().slots, []); assert.deepEqual({ creates, inputs }, counts); assert.equal(creates, 1);
  assert.deepEqual(core.observeExecutionSessionGeneration(session), generation);
  assert.equal(readFileSync(file, 'utf8'), text);
});
