import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import * as core from '../dist/core.js';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';

// Real tmux, native factory/store and SDK over this file's seat-env scope.
// Both terminals are empty fixture shells. No AI CLI, real seat, credentials,
// user input, live socket or production state is used.
test('native management close of an unknown send keeps another session and permits a fresh reservation without replay', {
  skip: process.platform === 'win32' ? 'native graph entry is POSIX-only' : false, timeout: 15000,
}, async t => {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  assert.equal(scope.multiplexer.kind, 'socket'); assert.equal(existsSync(socket), false);
  mkdirSync(dirname(socket), { recursive: true });
  const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
  t.after(() => { try { tmux('kill-server'); } catch {} });
  const session = 'fixture-unknown-send', other = 'fixture-unaffected', launch = 'b'.repeat(32);
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', session, '/bin/bash', '--noprofile', '--norc');
  tmux('new-session', '-d', '-s', other, '/bin/bash', '--noprofile', '--norc');
  const native = core.observeExecutionNativeCreationScope();
  assert.equal(native.state, 'known'); assert.ok(native.server);
  const nativeId = native.sessions.find(value => value.session_id === session).native_id;
  writeFileSync(agentMetadataPath(session, launch), JSON.stringify({ kind: 'codex', aiterm_session: session,
    launch_id: launch, event_file: agentEventPath(session, launch), created_at: new Date().toISOString(), cwd: process.cwd(),
    initial_prompt: 'none', agent_role: 'subagent', parent_session_id: 'fixture-parent', delegation_depth: 1,
    lineage: 'fixture-parent>codex:fixture', delegation_allowed: true,
    hook_route: 'shared_codex_home', completion_route: 'codex_transcript', codex_home: process.env.CODEX_HOME,
    execution_native: { schema: 'aiterm.execution-native.v1', native_id: nativeId, server: native.server } }));
  writeFileSync(agentEventPath(session, launch), '');
  const participant = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: scope, provider });
  t.after(() => participant.server.close());
  const request = { kind: 'delivery', delivery_id: '00000000-0000-4000-8000-000000000001', target_session_id: session };
  await participant.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: session, expected_launch_id: launch } } });
  const failed = await runDeferredBoundExecution(participant.service, { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } },
    'send', session, async () => {
      core.send(session, 'synthetic partial input', { force: true, enter: false, raw: true });
      throw Error('fixture native effect completed; no submit');
    });
  assert.equal(failed.isError, true);
  const original = await participant.service.execute({ action: 'status', request });
  assert.equal(original.operations.send, 'unknown'); assert.equal(original.relation.target.boundary, null);
  const client = new Client({ name: 'bellteam', version: 'fixture' }), [a, b] = InMemoryTransport.createLinkedPair();
  await participant.server.connect(b); await client.connect(a); t.after(() => client.close());
  const result = await client.callTool({ name: 'pty_close', arguments: { session_id: session } });
  assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal(result.structuredContent.outcome, 'closed');
  assert.equal(tmux('list-sessions', '-F', '#{session_name}').trim(), other);
  assert.deepEqual(await participant.service.execute({ action: 'status', request }), original);
  assert.deepEqual(participant.store.snapshot().slots, []);
  // BellTeam restart_session next calls a promptless agent_launch without a
  // delivery ref. Exercise that same host SDK entry, not a separate reservation.
  const binary = join(process.env.HOME, 'fixture-codex');
  writeFileSync(binary, '#!/bin/sh\nprintf "OpenAI Codex\\n› ready\\n"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done\n', { mode: 0o700 });
  const oldBinary = process.env.CODEX_BIN; process.env.CODEX_BIN = binary;
  t.after(() => { process.env.CODEX_BIN = oldBinary; });
  core.__testSetAgentTuiReadyStableSamples(1);
  t.after(() => core.__testSetAgentTuiReadyStableSamples(null));
  const opened = await client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: session, cwd: process.env.HOME, trust_project: true } });
  assert.equal(opened.isError, undefined, JSON.stringify(opened));
  assert.equal(opened.structuredContent.startup.status, 'ready');
  assert.equal(opened.structuredContent.initial_prompt.status, 'not_requested');
  assert.equal(opened._meta['aiterm/execution_binding'].request.kind, 'mcp');
  assert.notEqual(core.observeExecutionSessionGeneration(session).launch_id, launch);
  assert.deepEqual(await participant.service.execute({ action: 'status', request }), original);
  const closedAgain = await client.callTool({ name: 'pty_close', arguments: { session_id: session } });
  assert.equal(closedAgain.isError, undefined, JSON.stringify(closedAgain));
  assert.equal(tmux('list-sessions', '-F', '#{session_name}').trim(), other);
  const next = await participant.service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request: { ...request, delivery_id: '00000000-0000-4000-8000-000000000002' },
    source: { launch: null, boundary: null }, target: { session_id: session, expected_launch_id: null } } });
  assert.equal(next.operations.launch, 'not_issued'); assert.equal(next.operations.send, 'not_issued');
});
