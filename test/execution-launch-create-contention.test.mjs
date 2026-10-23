import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { agentMetadataPath } from '../dist/agent-shared.js';
import { FileExecutionStore } from '../dist/execution-store.js';

const original = cp.spawnSync;
let trace;
cp.spawnSync = (...args) => { const result = original(...args); trace?.(...args); return result; };
syncBuiltinESMExports();
const core = await import('../dist/core.js');
test.after(() => {
  trace = null;
  try { cp.execFileSync('tmux', ['-S', localParentWorkerRuntime.scope().multiplexer.key, 'kill-server']); } catch {}
  cp.spawnSync = original; syncBuiltinESMExports();
});

const options = { skip: process.platform === 'win32' ? 'POSIX native participant' : false, timeout: 15000 };
test('promptless launch admits CLI input after a concurrent writer starts at managed generation binding', options,
  t => runCase(t, 'writer'));
test('promptless launch waits for a writer at its initial asynchronous handler admission', options,
  t => runCase(t, 'entry'));
for (const change of ['stop', 'unknown-slot', 'wrong-generation'])
  test(`the writer after generation binding still fences ${change} before any further input`, options, t => runCase(t, change));
async function runCase(t, change) {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => cp.execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  t.after(() => { trace = null; });
  const binary = join(process.env.HOME, 'fixture-codex');
  writeFileSync(binary, '#!/bin/sh\nprintf "OpenAI Codex\\n› ready\\n"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done\n', { mode: 0o700 });
  process.env.CODEX_BIN = binary;
  core.__testSetAgentTuiReadyStableSamples(1);
  t.after(() => core.__testSetAgentTuiReadyStableSamples(null));
  const p = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: scope, provider });
  t.after(() => p.server.close());
  const client = new Client({ name: 'bellteam', version: 'fixture' }), [a, b] = InMemoryTransport.createLinkedPair();
  await p.server.connect(b); await client.connect(a); t.after(() => client.close());
  const session = 'fixture-launch-after-create-' + change;
  const request = { kind: 'delivery', delivery_id: 'fixture-launch-once-' + change, target_session_id: session };
  await p.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: session, expected_launch_id: null } } });
  let injected = false, writer, creates = 0, submits = 0;
  const contender = new FileExecutionStore(p.store.directory);
  let acquired = false;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const admit = p.service.admitNative.bind(p.service);
  p.service.admitNative = async body => {
    // Coordinate the next asynchronous segment with actual writer ownership;
    // never infer it from an 80ms timer or the writer promise being queued.
    if (injected && !acquired) await enteredPromise;
    return admit(body);
  };
  const startWriter = () => {
    injected = true;
    writer = contender.transaction(async state => {
      acquired = true;
      entered();
      const slot = state.slots.find(row => row.session_id === session);
      if (change === 'stop') state.stopping.push({ session_id: session, launch_id: slot.expected_launch_id });
      if (change === 'unknown-slot') slot.state = 'unknown';
      if (change === 'wrong-generation') slot.expected_launch_id = 'f'.repeat(32);
      await new Promise(resolve => setTimeout(resolve, 80));
    });
  };
  const bind = p.service.bindCreatedLaunch.bind(p.service);
  p.service.bindCreatedLaunch = (...args) => {
    const result = bind(...args);
    if (change !== 'entry') startWriter();
    return result;
  };
  if (change === 'entry') {
    const invoke = p.service.invokeDeferred.bind(p.service);
    p.service.invokeDeferred = (meta, stage, body, ...args) => invoke(meta, stage, (...gate) => {
      startWriter();
      return body(...gate);
    }, ...args);
  }
  trace = (bin, args) => {
    if (!args?.includes('-S') || args[args.indexOf('-S') + 1] !== socket) return;
    const command = args[args.indexOf('-S') + 2];
    if (args.includes('new-session')) creates++;
    if (command === 'send-keys' && args.at(-1) === 'Enter') {
      submits++;
    }
  };
  const result = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true,
  }, _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
  trace = null; await writer;
  assert.equal(acquired, true);
  assert.equal(existsSync(join(p.store.directory, 'transaction.lock')), false);
  const graph = p.store.snapshot(), record = graph.records.find(row => row.reservation.request.delivery_id === request.delivery_id);
  const slots = graph.slots.filter(row => row.session_id === session);
  const generation = core.observeExecutionSessionGeneration(session);
  const metadata = generation.launch_id && JSON.parse(readFileSync(agentMetadataPath(session, generation.launch_id), 'utf8'));
  console.log(JSON.stringify({ change, injected, creates, submits, error: result._meta?.['aiterm/execution_error'] ?? null,
    operations: record.operations, slots, initial_prompt: metadata?.initial_prompt ?? null }));
  assert.equal(injected, true); assert.equal(creates, 1); assert.equal(submits, 1);
  assert.equal(record.operations.send, 'not_issued'); assert.equal(metadata.initial_prompt, 'none');
  if (['writer', 'entry'].includes(change)) {
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(record.operations.launch, 'accepted'); assert.deepEqual(slots, []);
  } else {
    assert.equal(result.isError, true);
    assert.equal(record.operations.launch, 'unknown'); assert.equal(slots.length, 1);
    assert.equal(slots[0].state, 'unknown');
  }
}
