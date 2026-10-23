import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as provider from 'aiterm-steer-delivery';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';

const spawnSync = cp.spawnSync;
let trace;
cp.spawnSync = (...args) => { const value = spawnSync(...args); trace?.(...args); return value; };
syncBuiltinESMExports();
const core = await import('../dist/core.js');
test.after(() => {
  trace = null;
  // Both cases share this file's isolated socket. macOS can still be tearing
  // down a killed server when the next case tries to start it on that socket.
  // Keep the fixture server until both cases finish; never retry native input.
  if (process.platform !== 'win32') {
    try { cp.execFileSync('tmux', ['-S', localParentWorkerRuntime.scope().multiplexer.key, 'kill-server']); } catch {}
  }
  cp.spawnSync = spawnSync; syncBuiltinESMExports();
});

const options = {
  skip: process.platform === 'win32' ? 'POSIX native graph' : false, timeout: 15000,
};
test('real tmux Codex steer finishes its first input once when another graph writer runs between paste and Enter', options,
  t => runCase(t, 'writer'));
test('real SDK Codex steer finishes once when its verified source receives another message during paste/Enter', options,
  t => runCase(t, 'source'));
async function runCase(t, scenario) {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => cp.execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  const script = join(process.env.HOME, 'fake-codex-input.sh');
  writeFileSync(script, '#!/bin/sh\nprintf "OpenAI Codex\\n(1s • esc to interrupt)\\n"\nwhile IFS= read -r line; do printf "fixture-input:%s\\n" "$line"; done\n');
  const session = 'fixture-contention-' + scenario, launch = 'b'.repeat(32);
  const source = scenario === 'source' ? { session_id: 'fixture-source', launch_id: 'a'.repeat(32) } : null;
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', session, 'sh', script);
  if (source) tmux('new-session', '-d', '-s', source.session_id, 'sh', script);
  t.after(() => { trace = null; });
  // Wait for the fixture's busy TUI; no vendor CLI or credentials are used.
  const deadline = performance.now() + 3000;
  while (!tmux('capture-pane', '-p', '-t', session).includes('esc to interrupt')) {
    assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
  }
  const native = core.observeExecutionNativeCreationScope();
  const nativeId = native.sessions.find(value => value.session_id === session).native_id;
  writeFileSync(agentMetadataPath(session, launch), JSON.stringify({ kind: 'codex', aiterm_session: session,
    launch_id: launch, event_file: agentEventPath(session, launch), created_at: new Date().toISOString(), cwd: process.cwd(),
    initial_prompt: 'none', agent_role: 'subagent', parent_session_id: 'fixture-parent', delegation_depth: 1,
    lineage: 'fixture-parent>codex:fixture', delegation_allowed: true,
    hook_route: 'shared_codex_home', completion_route: 'codex_transcript', codex_home: process.env.CODEX_HOME,
    execution_native: { schema: 'aiterm.execution-native.v1', native_id: nativeId, server: native.server } }));
  writeFileSync(agentEventPath(session, launch), '');
  if (source) {
    const meta = JSON.parse((await import('node:fs')).readFileSync(agentMetadataPath(session, launch), 'utf8'));
    Object.assign(meta, { aiterm_session: source.session_id, launch_id: source.launch_id, event_file: agentEventPath(source.session_id, source.launch_id),
      execution_native: { schema: 'aiterm.execution-native.v1', native_id: native.sessions.find(v => v.session_id === source.session_id).native_id, server: native.server } });
    writeFileSync(agentMetadataPath(source.session_id, source.launch_id), JSON.stringify(meta)); writeFileSync(meta.event_file, '');
  }
  const p = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: scope, provider });
  t.after(() => p.server.close());
  const client = new Client({ name: 'bellteam', version: 'fixture' }), [a, b] = InMemoryTransport.createLinkedPair();
  await p.server.connect(b); await client.connect(a); t.after(() => client.close());
  const request = { kind: 'delivery', delivery_id: 'fixture-contention-once', target_session_id: session };
  await p.service.execute({ action: 'register', source_session_id: source?.session_id ?? null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: source, boundary: null },
    target: { session_id: session, expected_launch_id: launch } } }, { schema: 'aiterm.execution-source.v1', source: source ? { launch: source, boundary: null } : null });
  const incoming = source && { kind: 'delivery', delivery_id: 'fixture-incoming', target_session_id: source.session_id };
  if (incoming) await p.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request: incoming, source: { launch: null, boundary: null },
    target: { session_id: source.session_id, expected_launch_id: source.launch_id } } });
  const effects = []; let writer, scheduled = false;
  trace = (bin, args) => {
    if (!args?.includes('-S')) return;
    const command = args[args.indexOf('-S') + 2];
    const target = args[args.indexOf('-t') + 1];
    const original = target === '=' + session + ':';
    if (original && (command === 'paste-buffer' || (command === 'send-keys' && args.at(-1) === 'Enter'))) effects.push(command);
    if (original && command === 'paste-buffer' && !scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        writer = incoming ? runDeferredBoundExecution(p.service,
          { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request: incoming } }, 'send', source.session_id, async () => {
            core.send(source.session_id, 'synthetic incoming', { raw: true, force: true, enter: false });
            await new Promise(resolve => setTimeout(resolve, 450));
            return { result: { content: [] }, target: { launch: source, boundary: null } };
          }) : p.store.transaction(async () => {
          // Span the existing 250ms submit delay, then release from this event loop.
          await new Promise(resolve => setTimeout(resolve, 450));
        });
      });
    }
  };
  const result = await client.callTool({ name: 'pty_send', arguments: {
    session_id: session, text: 'fixture synthetic input', require_agent: true },
    _meta: { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } } });
  trace = null; await writer;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.deepEqual(effects, ['paste-buffer', 'send-keys']);
  const record = await p.service.execute({ action: 'status', request });
  assert.equal(record.operations.send, 'accepted'); assert.deepEqual(p.store.snapshot().slots, []);
}
