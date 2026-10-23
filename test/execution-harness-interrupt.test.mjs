import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, symlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { agentManagedClaudeSettingsPath, agentClaudeResultPath, agentClaudeOperationPath, agentClaudeDispatchReceiptPath } from '../dist/harnesses/claude.js';
import { nativeInterruptionObservationSchema, sameInterruptionRun } from '../dist/execution-interruption.js';
import { requireExecutionEffectScope, withExecutionEffectScope, withExecutionInterruptEffectScope } from '../dist/execution-effect.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ParticipantExecutionStore } from '../dist/execution-participant-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';
import { registerExecutionTools } from '../dist/execution-tools.js';
import { SOCKDIR, SOCK } from '../dist/tmux-runtime.js';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Every native/server/harness identity and command result is synthetic. No
// tmux/ps, CLI, live session or process signal can reach the host.
const saved = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn }, savedKill = process.kill;
let run;
childProcess.spawnSync = (...args) => { assert.ok(run, 'no native fallback'); return run(...args); };
childProcess.spawn = () => assert.fail('no native child');
process.kill = (pid, signal) => { assert.equal(pid, 4711); assert.equal(signal, 0); return true; };
syncBuiltinESMExports();
const core = await import('../dist/core.js');
const { createAitermServer } = await import('../dist/index.js');
test.after(() => { Object.assign(childProcess, saved); process.kill = savedKill; syncBuiltinESMExports(); });
test.afterEach(() => { run = null; requireExecutionEffectScope(false); });
let serial = 0;
function fixture(t, kind = 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'harness-interrupt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const name = 'native-interrupt-' + (++serial), launch_id = serial.toString(16).padStart(32, '0');
  const actor = { pid: 201, started_identity: 'Wed Oct 21 09:00:02 2026' }, server = { pid: 4711, started_identity: 'Wed Oct 21 09:00:00 2026' };
  const native = { id: '$9', present: true }, keys = []; let tableReads = 0;
  const meta = { kind, aiterm_session: name, launch_id, event_file: agentEventPath(name, launch_id), created_at: new Date(Date.now() - 60000).toISOString(),
    cwd: root, initial_prompt: 'none', agent_role: 'subagent', parent_session_id: 'host-root', delegation_depth: 1,
    lineage: 'host-root>codex:' + name, delegation_allowed: true,
    execution_native: { schema: 'aiterm.execution-native.v1', native_id: native.id, server } };
  const operation = 'sha256:' + '7'.repeat(64), home = join(root, 'native-home');
  mkdirSync(home, { recursive: true });
  if (kind === 'claude') Object.assign(meta, { hook_route: 'shared_claude_settings', vendor_session_id: '00000000-0000-4000-8000-000000000001',
    claude_settings: agentManagedClaudeSettingsPath(name, launch_id), result_file: agentClaudeResultPath(name, launch_id) });
  else if (kind === 'cursor') Object.assign(meta, { hook_route: 'shared_cursor_home', completion_route: 'cursor_transcript', cursor_home: home, vendor_session_id: null });
  else if (kind === 'grok') Object.assign(meta, { hook_route: 'shared_grok_home', completion_route: 'grok_events', grok_home: home, vendor_session_id: '00000000-0000-4000-8000-000000000001' });
  else Object.assign(meta, { hook_route: 'shared_codex_home', completion_route: 'codex_transcript', codex_home: home, vendor_session_id: null });
  const metadata = agentMetadataPath(name, launch_id), marker = agentClaudeOperationPath(name, launch_id);
  writeFileSync(metadata, JSON.stringify(meta)); writeFileSync(meta.event_file, '');
  if (kind === 'claude') writeFileSync(marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: operation }));
  const dir = join(home, 'sessions', '2026', '10', '21'); mkdirSync(dir, { recursive: true });
  const transcript = join(dir, 'rollout-2026-10-21T09-00-00-00000000-0000-4000-8000-000000000002.jsonl');
  const head = [JSON.stringify({ type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000002', originator: 'codex-tui', source: 'cli' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'AITERM_AGENT_LAUNCH_ID=' + launch_id }] } })];
  const writeTurn = (type = 'task_started', turn_id = 'native-current-turn') => writeFileSync(transcript, [...head,
    JSON.stringify({ type: 'event_msg', payload: { type, turn_id, reason: type === 'turn_aborted' ? 'interrupted' : undefined } })].join('\n') + '\n');
  writeTurn();
  const control = { expectedKey: 'Escape', immediateScreen: undefined, failKey: false, afterFirstTable: null, allowInput: false, inputCommands: [] };
  const ok = stdout => ({ status: 0, stdout: stdout ?? '', stderr: '' });
  run = (bin, args) => {
    if (bin === '/bin/ps') {
      if (control.allowInput && args[0] === '-t') {
        assert.deepEqual(args, ['-t', 'synthetic-target', '-o', 'stat=,command=']); return ok('S+ claude\n');
      }
      if (args[0] === '-axww') {
        tableReads++; if (tableReads > 1) control.afterFirstTable?.();
        return ok(`200 1 200 S Wed Oct 21 09:00:01 2026 00:00:00 bash\n201 200 200 S ${actor.started_identity} 00:00:00 ${kind} --launch ${launch_id}\n`);
      }
      assert.deepEqual(args, ['-o', 'pid=,lstart=', '-p', '4711']); return ok('4711 ' + server.started_identity + '\n');
    }
    if (control.allowInput && bin === '/bin/stty') {
      assert.deepEqual(args, [process.platform === 'linux' ? '-F' : '-f', '/dev/synthetic-target', '-a']); return ok('-icanon -echo');
    }
    assert.equal(bin, 'tmux');
    if (args.length === 1 && args[0] === '-V') return ok('tmux synthetic');
    assert.equal(args[0], '-S'); const command = args.slice(2), format = command.at(-1);
    if (command[0] === 'list-sessions') {
      const reply = typeof control.listReply === 'function' ? control.listReply(format) : control.listReply;
      if (reply) return reply;
      if (!native.present) return ok('');
      if (format === '#{session_id}\t#{session_name}') return ok(`${native.id}\t${name}\n`);
      if (format === '#{pid}\t#{session_id}\t#{session_name}') return ok(`4711\t${native.id}\t${name}\n`);
      if (format === '#{session_name}\t#{pane_current_command}\t#{session_attached}\t#{window_width}\t#{window_height}') return ok(`${name}\tbash\t0\t80\t24\n`);
    }
    if (command[0] === 'capture-pane' && control.immediateScreen !== undefined) return ok(control.immediateScreen);
    if (command[0] === 'display-message' && format === '#{pane_pid}\t#{pane_dead}') return ok('200\t0\n');
    if (control.allowInput && command[0] === 'display-message' && format === '#{pane_tty}') return ok('/dev/synthetic-target');
    if (command[0] === 'has-session') return { ...ok(''), status: native.present ? 0 : 1 };
    if (control.allowClose && command[0] === 'kill-session') {
      assert.equal(command[2], native.id + ':'); control.closeCalls = (control.closeCalls ?? 0) + 1;
      if (control.closeFails) return { ...ok(''), status: 1, stderr: 'synthetic close failure' };
      native.present = false; return ok('');
    }
    if (control.allowInput && ['load-buffer', 'set-buffer', 'paste-buffer', 'delete-buffer', 'capture-pane'].includes(command[0])) {
      control.inputCommands.push(command[0]); return ok(command[0] === 'capture-pane' ? '❯\n' : '');
    }
    if (control.allowInput && command[0] === 'list-commands') return ok('paste-buffer [-dpr] [-b buffer-name] [-t target-pane]');
    if (control.allowInput && command[0] === 'send-keys' && command[3] !== 'Escape') {
      control.inputCommands.push('send-keys-input'); return ok('');
    }
    assert.equal(command[0], 'send-keys'); assert.equal(command[2], '$9'); assert.equal(command[3], control.expectedKey);
    keys.push(command[3]); return { ...ok(''), status: control.failKey ? 1 : 0 };
  };
  const point = { launch: { session_id: name, launch_id }, boundary: { event_cursor: 0, operation_id: kind === 'claude' ? operation : null,
    turn_id: kind === 'codex' ? 'native-current-turn' : null, steer_id: null } };
  const apply = (input = point, issue = () => {}) => withExecutionEffectScope(name, issue, () => core.interruptExpectedAgentRun(input));
  return { name, point, metadata, marker, meta, actor, server, native, keys, control, writeTurn, apply, transcript, head };
}
const posix = { skip: process.platform === 'win32' ? 'POSIX native-identity fixture' : false };
test('actual Codex and Claude core primitives send one expected-native Esc and leave metadata/correlation untouched, without confirming interruption', posix, t => {
  for (const kind of ['codex', 'claude']) {
    const f = fixture(t, kind), before = readFileSync(f.metadata, 'utf8'); let issued = 0;
    const oldMarker = kind === 'claude' ? readFileSync(f.marker, 'utf8') : null;
    const result = f.apply(f.point, () => { issued++; });
    assert.deepEqual(f.keys, ['Escape']); assert.ok(issued > 0); assert.equal(f.native.present, true);
    assert.equal(result.outcome, 'accepted'); assert.equal(result.interruption, 'unconfirmed'); assert.equal(result.session_preserved, 'unconfirmed');
    assert.equal(readFileSync(f.metadata, 'utf8'), before);
    if (oldMarker) assert.equal(readFileSync(f.marker, 'utf8'), oldMarker);
  }
});
test('real service/native admission commits the one Esc receipt while the run completion and fence remain open', posix, async t => {
  for (const kind of ['codex', 'claude']) {
    const f = fixture(t, kind), dir = mkdtempSync(join(tmpdir(), 'harness-interrupt-service-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = new FileExecutionStore(dir), runtime = createExecutionRuntime({
      observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
      async observeDone() { assert.fail('no native interruption/finish proof'); },
      async guardedClose() { assert.fail('never close'); } });
    const service = new ExecutionService(store, runtime), request = { kind: 'mcp', process_pid: 22,
      process_started_identity: '2026-10-21T09:00:03Z', request_id: 'existing-key-rpc', tool: 'pty_key', target_session_id: f.name };
    await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1', request,
      source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
    const result = await runDeferredBoundExecution(service, { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } }, 'send', f.name, async () => ({
      result: { content: [], structuredContent: { ...core.interruptExpectedAgentRun(f.point) } }, target: f.point,
    }));
    assert.equal(result.isError, undefined); assert.deepEqual(f.keys, ['Escape']); assert.equal(result.structuredContent.outcome, 'accepted');
    assert.equal(result.structuredContent.interruption, 'unconfirmed'); assert.equal(f.native.present, true);
    const state = await store.transaction(state => structuredClone(state), { readOnly: true });
    assert.equal(state.records[0].operations.send, 'accepted'); assert.equal(state.records[0].relation.completion, 'open');
    assert.equal(state.records[0].relation.target_fence, 'open'); assert.deepEqual(state.slots, []);
  }
});
test('missing/mismatched run and already-ended Codex turn cannot issue an Esc against another current computation', posix, t => {
  for (const change of ['missing-boundary', 'missing-turn', 'different-turn', 'done', 'claude-operation']) {
    const f = fixture(t, change === 'claude-operation' ? 'claude' : 'codex'), point = structuredClone(f.point);
    if (change === 'missing-boundary') point.boundary = null;
    if (change === 'missing-turn') point.boundary.turn_id = null;
    if (change === 'different-turn') point.boundary.turn_id = 'other-turn';
    if (change === 'done') f.writeTurn('task_complete');
    if (change === 'claude-operation') point.boundary.operation_id = 'sha256:' + '8'.repeat(64);
    assert.throws(() => f.apply(point)); assert.deepEqual(f.keys, []);
  }
});
test('generation/native ID/harness identity change during preflight refuses before a key instead of selecting the same name', posix, t => {
  for (const change of ['generation', 'native', 'actor', 'server', 'run', 'claude-run']) {
    const f = fixture(t, change === 'claude-run' ? 'claude' : 'codex');
    f.control.afterFirstTable = () => {
      if (change === 'generation') { const meta = JSON.parse(readFileSync(f.metadata)); meta.launch_id = 'f'.repeat(32); writeFileSync(f.metadata, JSON.stringify(meta)); }
      if (change === 'native') f.native.id = '$10';
      if (change === 'actor') f.actor.started_identity = 'Wed Oct 21 09:00:03 2026';
      if (change === 'server') f.server.started_identity = 'Wed Oct 21 09:00:01 2026';
      if (change === 'run') f.writeTurn('task_complete');
      if (change === 'claude-run') writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: 'sha256:' + '8'.repeat(64) }));
    };
    assert.throws(() => f.apply(), undefined, change); assert.deepEqual(f.keys, []);
  }
});
test('public Claude Escape remains guarded while its private exact-operation primitive preserves the marker', posix, t => {
  const f = fixture(t, 'claude');
  assert.throws(() => withExecutionEffectScope(f.name, () => {}, () => core.sendKeyResult(f.name, 'Escape')), /C-c/);
  assert.deepEqual(f.keys, []); assert.equal(f.apply().outcome, 'accepted'); assert.deepEqual(f.keys, ['Escape']);
});
test('Cursor/Grok stay unsupported, unknown native stamp and missing frame are refused, native failure never retries or closes', posix, t => {
  for (const kind of ['cursor', 'grok']) { const f = fixture(t, kind); assert.throws(() => f.apply()); assert.deepEqual(f.keys, []); }
  const old = fixture(t); delete old.meta.execution_native; writeFileSync(old.metadata, JSON.stringify(old.meta));
  assert.throws(() => old.apply()); assert.deepEqual(old.keys, []);
  const f = fixture(t); requireExecutionEffectScope(true);
  assert.throws(() => core.interruptExpectedAgentRun(f.point), error => error.code === 'EXECUTION_UNSUPPORTED');
  f.control.failKey = true; assert.throws(() => f.apply(), error => error.effect === 'possible'); assert.deepEqual(f.keys, ['Escape']);
});
test('read-only exact Codex abort evidence retains the original point and native conversation/harness, without implying a stop fence', posix, t => {
  const f = fixture(t), metadata = readFileSync(f.metadata, 'utf8');
  const before = core.observeExpectedAgentRunInterruption(f.point);
  assert.equal(before.recorded_state, 'running'); assert.deepEqual(f.keys, []);
  f.apply(); f.writeTurn('turn_aborted');
  const after = core.observeExpectedAgentRunInterruption(f.point);
  assert.equal(after.recorded_state, 'interrupted'); assert.deepEqual(after.run, f.point);
  assert.deepEqual(after.native, before.native); assert.deepEqual(after.harness_process, before.harness_process);
  assert.deepEqual(after.endpoint, before.endpoint); assert.equal(after.native_boundary.reason, 'interrupted');
  assert.equal(after.invocation_fence, 'unknown'); assert.equal(after.session_preserved, 'unconfirmed');
  assert.equal(readFileSync(f.metadata, 'utf8'), metadata); assert.deepEqual(f.keys, ['Escape']);
});
test('normal completion, another turn and cancellation for another reason never become the expected run interruption', posix, t => {
  for (const change of ['completed', 'other-abort', 'other-start', 'reason']) {
    const f = fixture(t);
    f.writeTurn(change === 'completed' ? 'task_complete' : change === 'other-start' ? 'task_started' : 'turn_aborted',
      change.startsWith('other-') ? 'another-native-turn' : 'native-current-turn');
    if (change === 'reason') writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8').replace('"reason":"interrupted"', '"reason":"superseded"'));
    const result = core.observeExpectedAgentRunInterruption(f.point);
    assert.equal(result.recorded_state, change === 'completed' ? 'completed' : change.startsWith('other-') ? 'other_run' : 'unconfirmed');
    assert.equal(result.session_preserved, 'unconfirmed'); assert.deepEqual(f.keys, []);
  }
});
test('strict record reading refuses partial, corrupt, missing turn and unbound metadata without a key or metadata repair', posix, t => {
  for (const change of ['partial', 'corrupt', 'turn', 'legacy', 'marker-prefix', 'header-mismatch']) {
    const f = fixture(t);
    if (change === 'partial') writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8') + '{');
    if (change === 'corrupt') writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8') + '{"type":"event_msg","payload":{"type":"turn_aborted"}\n');
    if (change === 'turn') f.writeTurn('turn_aborted', '');
    if (change === 'legacy') { f.meta.hook_route = undefined; writeFileSync(f.metadata, JSON.stringify(f.meta)); }
    if (change === 'marker-prefix') writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8').replace('AITERM_AGENT_LAUNCH_ID=' + f.point.launch.launch_id, 'AITERM_AGENT_LAUNCH_ID=' + f.point.launch.launch_id + 'f'));
    if (change === 'header-mismatch') writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8').replace('"id":"00000000-0000-4000-8000-000000000002"', '"id":"00000000-0000-4000-8000-000000000003"'));
    const metadata = readFileSync(f.metadata, 'utf8');
    assert.throws(() => core.observeExpectedAgentRunInterruption(f.point), undefined, change);
    assert.throws(() => f.apply(), undefined, change); assert.deepEqual(f.keys, []);
    assert.equal(readFileSync(f.metadata, 'utf8'), metadata);
  }
});
test('cached conversation IDs and latest mtime cannot disambiguate multiple native root endpoints', posix, t => {
  const f = fixture(t);
  f.meta.vendor_session_id = '00000000-0000-4000-8000-000000000002'; writeFileSync(f.metadata, JSON.stringify(f.meta));
  const other = f.transcript.replace('000000000002.jsonl', '000000000003.jsonl');
  copyFileSync(f.transcript, other);
  writeFileSync(other, readFileSync(other, 'utf8').replace('"id":"00000000-0000-4000-8000-000000000002"', '"id":"00000000-0000-4000-8000-000000000003"'));
  assert.throws(() => core.observeExpectedAgentRunInterruption(f.point)); assert.throws(() => f.apply()); assert.deepEqual(f.keys, []);
  const ambiguous = fixture(t);
  symlinkSync(ambiguous.transcript, ambiguous.transcript + '.alias');
  assert.throws(() => core.observeExpectedAgentRunInterruption(ambiguous.point));
  assert.throws(() => ambiguous.apply()); assert.deepEqual(ambiguous.keys, []);
});
test('forked transcripts and arbitrary cached vendor IDs cannot supply native interruption evidence', posix, t => {
  const f = fixture(t);
  f.meta.vendor_session_id = 'cached-unrelated-id'; writeFileSync(f.metadata, JSON.stringify(f.meta));
  // The actual native header wins over the cached value, without rewriting it.
  assert.equal(core.observeExpectedAgentRunInterruption(f.point).endpoint.session_id, '00000000-0000-4000-8000-000000000002');
  writeFileSync(f.transcript, readFileSync(f.transcript, 'utf8').replace('"source":"cli"', '"source":"cli","forked_from_id":"another-root"'));
  assert.throws(() => core.observeExpectedAgentRunInterruption(f.point)); assert.throws(() => f.apply()); assert.deepEqual(f.keys, []);
});
test('read-only observation rechecks native generation, actor and run while collecting evidence, and refuses Claude/Cursor/Grok', posix, t => {
  for (const change of ['generation', 'native', 'run', 'actor']) {
    const f = fixture(t); let n = 0;
    f.control.afterFirstTable = () => {
      n++;
      if (change === 'generation') { f.meta.launch_id = 'f'.repeat(32); writeFileSync(f.metadata, JSON.stringify(f.meta)); }
      if (change === 'native') f.native.id = '$10';
      if (change === 'run' && n === 1) f.writeTurn('turn_aborted');
      if (change === 'actor') f.actor.started_identity = n % 2 ? 'Wed Oct 21 09:00:03 2026' : 'Wed Oct 21 09:00:04 2026';
    };
    assert.throws(() => core.observeExpectedAgentRunInterruption(f.point), undefined, change); assert.deepEqual(f.keys, []);
  }
  for (const kind of ['claude', 'cursor', 'grok']) {
    const f = fixture(t, kind); assert.throws(() => core.observeExpectedAgentRunInterruption(f.point)); assert.deepEqual(f.keys, []);
  }
});
test('actual private core primitive runs inside the stop-owned one-Esc frame with no service invocation/close or completion claim', posix, t => {
  for (const kind of ['codex', 'claude']) {
    const f = fixture(t, kind), before = readFileSync(f.metadata, 'utf8'); let admissions = 0;
    requireExecutionEffectScope(true);
    const receipt = withExecutionInterruptEffectScope(f.name, '$9', () => { admissions++; }, () => core.interruptExpectedAgentRun(f.point));
    assert.ok(admissions > 0); assert.deepEqual(f.keys, ['Escape']);
    assert.equal(receipt.interruption, 'unconfirmed'); assert.equal(receipt.session_preserved, 'unconfirmed');
    assert.equal(readFileSync(f.metadata, 'utf8'), before); assert.equal(f.native.present, true);
  }
});
test('real core native run evidence and one Esc join the shared per-run journal, but absent native fence/preservation never reopen admission', posix, async t => {
  const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'native-run-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption,
    async observeDone() { assert.fail('no generic completion proof'); }, async guardedClose() { assert.fail('never close'); },
  });
  const service = new ExecutionService(store, runtime); requireExecutionEffectScope(true);
  await service.beginInterruption(f.point);
  const result = await service.interruptRun(f.point, () => core.interruptExpectedAgentRun(f.point));
  assert.equal(result.outcome, 'accepted'); assert.deepEqual(f.keys, ['Escape']);
  f.writeTurn('turn_aborted');
  assert.equal(core.observeExpectedAgentRunInterruption(f.point).recorded_state, 'interrupted');
  await assert.rejects(service.settleInterruption(f.point));
  const state = await store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.interruptions[0].phase, 'accepted'); assert.equal(state.slots[0].stage, 'interrupt');
  assert.deepEqual(state.records, []); assert.deepEqual(state.stopping, []); assert.equal(f.native.present, true);
  await assert.rejects(service.interruptRun(f.point, () => core.interruptExpectedAgentRun(f.point)));
  assert.deepEqual(f.keys, ['Escape']);
});
test('native selector uses the task_started byte boundary in the native rollout, independently of the common event log', posix, t => {
  const f = fixture(t), metadata = readFileSync(f.metadata, 'utf8');
  const expectedOffset = Buffer.byteLength(f.head.join('\n') + '\n');
  const selected = core.selectExpectedAgentRunInterruption(f.point.launch);
  assert.equal(selected.run.boundary.event_cursor, expectedOffset);
  assert.equal(selected.run.boundary.turn_id, f.point.boundary.turn_id);
  assert.equal(selected.recorded_state, 'running');
  assert.equal(selected.invocation_fence, 'unknown'); assert.equal(selected.session_preserved, 'unconfirmed');
  assert.equal(readFileSync(f.metadata, 'utf8'), metadata); assert.deepEqual(f.keys, []);
  writeFileSync(f.meta.event_file, 'unrelated共通event log\n');
  assert.deepEqual(core.selectExpectedAgentRunInterruption(f.point.launch), selected);
  rmSync(f.meta.event_file);
  assert.deepEqual(core.selectExpectedAgentRunInterruption(f.point.launch), selected, 'common event file is not the Codex cursor source');
  assert.equal(f.point.boundary.event_cursor, 0, 'do not overwrite the original dispatch reference');
  const prelude = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '別の記録🚀' }] } }) + '\n';
  writeFileSync(f.transcript, f.head.join('\n') + '\n' + prelude + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'next-native-turn' } }) + '\n');
  const next = core.selectExpectedAgentRunInterruption(f.point.launch);
  assert.equal(next.run.boundary.event_cursor, expectedOffset + Buffer.byteLength(prelude), 'byte count, not JS character count');
  assert.equal(next.run.boundary.turn_id, 'next-native-turn');
});
test('native selector refuses missing/symlink native refs, native boundary mutation during proof, ended turn, other CLI and replacement launch', posix, t => {
  for (const change of ['missing', 'symlink', 'native-race', 'same-turn-offset-race', 'done', 'other-kind', 'generation']) {
    const f = fixture(t, change === 'other-kind' ? 'claude' : 'codex');
    if (change === 'missing') rmSync(f.transcript);
    if (change === 'symlink') { rmSync(f.transcript); symlinkSync(f.meta.event_file, f.transcript); }
    if (change === 'native-race') f.control.afterFirstTable = () => f.writeTurn('task_started', 'new-turn');
    if (change === 'same-turn-offset-race') f.control.afterFirstTable = () => {
      const text = readFileSync(f.transcript, 'utf8');
      if (!text.includes('unrelated')) writeFileSync(f.transcript, text.replace('"type":"event_msg"', '"padding":"unrelated","type":"event_msg"')
        .replace('\n{"padding"', '\n{}\n{"padding"'));
    };
    if (change === 'done') f.writeTurn('task_complete');
    const expected = change === 'generation' ? { ...f.point.launch, launch_id: 'f'.repeat(32) } : f.point.launch;
    assert.throws(() => core.selectExpectedAgentRunInterruption(expected), undefined, change); assert.deepEqual(f.keys, []);
  }
});
test('actual native selector/runtime/controller sends the one expected Esc privately while endpoint/fence remain unknown', posix, async t => {
  const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'native-controller-selector-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption,
    selectInterruptionSync: core.selectExpectedAgentRunInterruption, interruptKeySync: core.interruptExpectedAgentRun,
    async observeDone() { assert.fail('no generic completion'); },
  });
  const service = new ExecutionService(store, runtime); requireExecutionEffectScope(true);
  const request = { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] };
  assert.equal((await service.stop(request)).targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
  const result = await service.interruptCascade(request);
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.equal(result.targets[0].session_preserved, 'unconfirmed'); assert.deepEqual(f.keys, ['Escape']); assert.equal(f.native.present, true);
});
test('a current native run selector does not supply a native caller-turn alias for an incoming stdio request', posix, async t => {
  const f = fixture(t), runtime = createExecutionRuntime({
    sourceEnvironment: { AITERM_SESSION_ID: f.name, AITERM_AGENT_LAUNCH_ID: f.point.launch.launch_id },
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption,
    selectInterruptionSync() { assert.fail('current processing is not native request provenance'); },
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('no generic completion'); },
  });
  const evidence = await runtime.sourceEvidence({ source_session_id: f.name,
    reservation: { source: { launch: f.point.launch, boundary: f.point.boundary } } });
  assert.deepEqual(evidence.runtime_launch, f.point.launch); assert.equal(evidence.caller_bound, true);
  assert.equal(evidence.invocation_boundary, null); assert.deepEqual(f.keys, []);
});
test('actual native selector/controller preserves an already native-bound receipt and leaves turn-null dispatches unresolved', posix, async t => {
  for (const knownTurn of [true, false]) {
    const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'native-controller-canonical-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
      observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
      observeInterruptionSync: core.observeExpectedAgentRunInterruption,
      selectInterruptionSync: core.selectExpectedAgentRunInterruption, interruptKeySync: core.interruptExpectedAgentRun,
      async observeDone() { assert.fail('native abort is not generic completion'); },
    });
    const service = new ExecutionService(store, runtime), canonical = structuredClone(f.point);
    if (!knownTurn) canonical.boundary.turn_id = null;
    const record = await service.execute({ action: 'register', source_session_id: null,
      reservation: { schema: 'aiterm.execution-reservation.v1', request: { kind: 'delivery', delivery_id: 'existing-native-bound-' + knownTurn,
        target_session_id: f.name }, source: { launch: null, boundary: null },
      target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
    await service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => ({
      value: 'previous accepted receipt; native turn known only in the explicit fixture case', target: canonical,
    }));
    const result = await service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] });
    assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'accepted'); assert.deepEqual(f.keys, ['Escape']);
    if (knownTurn) {
      assert.deepEqual(result.targets[0].run, canonical, 'original dispatch cursor stays intact after native re-observation');
      assert.equal(result.unresolved.some(value => value.reason === 'native_canonical_alias_missing'), false);
    } else {
      assert.notDeepEqual(result.targets[0].run, canonical);
      assert.ok(result.unresolved.some(value => value.reason === 'native_canonical_alias_missing'));
    }
    const saved = await service.execute({ action: 'status', request: record.reservation.request });
    assert.deepEqual(saved.relation.target, canonical); assert.equal(saved.relation.completion, 'open');
    assert.equal(saved.relation.lifecycle, 'tracking'); assert.equal(result.targets[0].session_preserved, 'unconfirmed');
  }
});
test('same-server SDK control reaches the native controller only with fixed explicit host injection, without closing or confirming from key acceptance', posix, async t => {
  for (const enabled of [false, true]) {
    const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'native-controller-sdk-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
      observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
      observeInterruptionSync: core.observeExpectedAgentRunInterruption,
      selectInterruptionSync: core.selectExpectedAgentRunInterruption, interruptKeySync: core.interruptExpectedAgentRun,
      async observeDone() { assert.fail('no generic completion proof'); }, async guardedClose() { assert.fail('never close'); },
    }), service = new ExecutionService(store, runtime);
    const parent = { parentFromIngress: () => null, captureEndpointEvidence() { assert.fail('no parent endpoint'); },
      async bind() { assert.fail('no parent bind'); }, async submit() { assert.fail('no parent submit'); } };
    const server = createAitermServer({ execution: server => ({ parentExecution: parent,
      parentStateRoot: join(directory, 'parent'), parentDependencies: { processes: () => [], exists: () => true,
        async verify() {}, async observe() { assert.fail('no parent waiter'); }, async answer() { assert.fail('no parent answer'); } },
      dispatcher: createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
        sourceEnvironment: {}, initializedClientName: () => server.server.getClientVersion()?.name,
        observeSessionGeneration: core.observeExecutionSessionGeneration }),
    }) });
    const options = { interruptCurrentRun: enabled }; registerExecutionTools(server, service, options);
    options.interruptCurrentRun = !enabled; // later mutable host object cannot change this registration
    const client = new Client({ name: 'bellteam', version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide); await client.connect(clientSide);
    try {
      const response = await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2',
        mode: 'interrupt', roots: [f.point.launch] } });
      assert.equal(response.isError, undefined); const result = response.structuredContent;
      assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].session_preserved, 'unconfirmed');
      assert.equal(result.targets[0].key_receipt, enabled ? 'accepted' : 'not_sent');
      assert.deepEqual(f.keys, enabled ? ['Escape'] : []); assert.equal(f.native.present, true);
      const state = await store.transaction(state => structuredClone(state), { readOnly: true });
      assert.deepEqual(state.stopping, []); assert.equal(state.interruptions.length, enabled ? 1 : 0);
    } finally { await client.close(); await server.close(); }
  }
});
function managedFixture(t) {
  const f = fixture(t, 'claude');
  const receipt = agentClaudeDispatchReceiptPath(f.name, f.point.launch.launch_id, f.point.boundary.operation_id);
  writeFileSync(receipt, ''); f.point.boundary.event_cursor = 7;
  writeFileSync(f.meta.event_file, 'synthetic earlier control metadata\n'.repeat(5));
  return { ...f, receipt };
}
test('Claude observation keeps the canonical operation/cursor and reservation identities without inventing native acceptance or a live conversation', posix, t => {
  const f = managedFixture(t), before = [f.metadata, f.marker, f.receipt].map(file => readFileSync(file, 'utf8'));
  const result = core.observeExpectedAgentRunInterruption(f.point);
  assert.equal(nativeInterruptionObservationSchema.safeParse(result).success, true);
  assert.equal(result.schema, 'aiterm.claude-managed-interruption-observation.v1'); assert.deepEqual(result.run, f.point);
  assert.equal(result.recorded_state, 'unconfirmed'); assert.equal(result.native_boundary.type, 'managed_operation_reserved');
  assert.equal(result.native_boundary.operation_id, f.point.boundary.operation_id);
  assert.equal(result.endpoint.session_id, null, 'cached vendor_session_id is not a live endpoint proof');
  assert.equal(result.session_preserved, 'unconfirmed'); assert.equal(result.invocation_fence, 'unknown');
  assert.deepEqual(core.selectExpectedAgentRunInterruption(f.point.launch, f.point), result);
  assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.deepEqual([f.metadata, f.marker, f.receipt].map(file => readFileSync(file, 'utf8')), before); assert.deepEqual(f.keys, []);
});
test('managed reservation observations cannot be promoted to running/interrupted/fence-closed or rekeyed as a Codex turn', posix, t => {
  const f = managedFixture(t), result = core.observeExpectedAgentRunInterruption(f.point);
  for (const changes of [{ recorded_state: 'running' }, { recorded_state: 'interrupted' }, { invocation_fence: 'closed' },
    { session_preserved: 'confirmed' }, { run: { ...f.point, boundary: { ...f.point.boundary, turn_id: 'invented-turn' } } },
    { native_boundary: { ...result.native_boundary, operation_id: 'sha256:' + 'f'.repeat(64) } }])
    assert.equal(nativeInterruptionObservationSchema.safeParse({ ...result, ...changes }).success, false);
  assert.deepEqual(f.keys, []);
});
test('missing, anonymous, different or malformed Claude reservation/receipt cannot select a known managed operation', posix, t => {
  for (const change of ['missing-marker', 'anonymous', 'different-operation', 'bad-marker', 'missing-receipt', 'nonempty-receipt', 'receipt-symlink']) {
    const f = managedFixture(t);
    if (change === 'missing-marker') rmSync(f.marker);
    if (change === 'anonymous') writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: null }));
    if (change === 'different-operation') writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: 'sha256:' + '8'.repeat(64) }));
    if (change === 'bad-marker') writeFileSync(f.marker, '{}');
    if (change === 'missing-receipt') rmSync(f.receipt);
    if (change === 'nonempty-receipt') writeFileSync(f.receipt, 'not a reservation receipt');
    if (change === 'receipt-symlink') { rmSync(f.receipt); writeFileSync(f.receipt + '.target', ''); symlinkSync(f.receipt + '.target', f.receipt); }
    assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch, f.point), undefined, change); assert.deepEqual(f.keys, []);
  }
});
test('Claude observer refuses replaced marker/receipt, generation/native server and harness identities during its native read', posix, t => {
  for (const change of ['marker-replaced', 'receipt-replaced', 'generation', 'native', 'actor', 'server']) {
    const f = managedFixture(t); let changed = false;
    f.control.afterFirstTable = () => {
      if (changed) return; changed = true;
      if (change === 'marker-replaced') { writeFileSync(f.marker + '.next', readFileSync(f.marker)); renameSync(f.marker + '.next', f.marker); }
      if (change === 'receipt-replaced') { writeFileSync(f.receipt + '.next', ''); renameSync(f.receipt + '.next', f.receipt); }
      if (change === 'generation') { const meta = JSON.parse(readFileSync(f.metadata)); meta.launch_id = 'f'.repeat(32); writeFileSync(f.metadata, JSON.stringify(meta)); }
      if (change === 'native') f.native.id = '$10';
      if (change === 'actor') f.actor.started_identity = 'Wed Oct 21 09:00:03 2026';
      if (change === 'server') f.server.started_identity = 'Wed Oct 21 09:00:01 2026';
    };
    assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch, f.point), undefined, change); assert.deepEqual(f.keys, []);
  }
});
test('Claude selector refuses absent/different/mixed canonical references instead of choosing the latest operation or current event length', posix, t => {
  const f = managedFixture(t);
  for (const candidate of [null, { ...f.point, boundary: null }, { ...f.point, launch: { ...f.point.launch, session_id: 'other-seat' } },
    { ...f.point, boundary: { ...f.point.boundary, operation_id: null } },
    { ...f.point, boundary: { ...f.point.boundary, turn_id: 'native-turn-from-another-harness' } }])
    assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch, candidate));
  assert.deepEqual(f.keys, []);
});
test('different Claude operations are distinct existing run references even when their native turn IDs are both null', posix, t => {
  const f = managedFixture(t), other = { ...f.point, boundary: { ...f.point.boundary, operation_id: 'sha256:' + '8'.repeat(64) } };
  assert.equal(sameInterruptionRun(f.point, f.point), true); assert.equal(sameInterruptionRun(f.point, other), false);
  assert.equal(sameInterruptionRun(f.point, { ...f.point, boundary: { ...f.point.boundary, operation_id: null } }), false);
});
test('real Claude controller uses an existing operation receipt for one Esc only, retaining uncertainty, canonical binding and public key guard', posix, async t => {
  const f = managedFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-managed-controller-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('Stop/marker not native finish proof'); },
  }), service = new ExecutionService(store, runtime);
  const record = await service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request: { kind: 'delivery', delivery_id: 'existing-claude-operation', target_session_id: f.name },
    source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => ({ value: 'existing receipt', target: f.point }));
  const input = { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] };
  assert.equal((await service.stop(input)).targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
  const result = await service.interruptCascade(input);
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(result.targets[0].run, f.point); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.equal(result.targets[0].interruption, 'unconfirmed'); assert.equal(result.targets[0].session_preserved, 'unconfirmed');
  assert.deepEqual(f.keys, ['Escape']); assert.equal(f.native.present, true);
  const state = await store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.interruptions[0].before.recorded_state, 'unconfirmed'); assert.equal(state.interruptions[0].phase, 'accepted');
  assert.equal(state.records[0].relation.completion, 'open'); assert.equal(state.records[0].relation.lifecycle, 'tracking');
  assert.deepEqual(state.records[0].relation.target, f.point); assert.equal(state.slots[0].state, 'unknown');
  await assert.rejects(service.settleInterruption(f.point)); await service.interruptCascade(input); assert.deepEqual(f.keys, ['Escape']);
  assert.ok(result.unresolved.some(value => value.reason === 'managed_operation_native_acceptance_unconfirmed'));
  writeFileSync(f.meta.event_file, JSON.stringify({ type: 'agent_done', reason: 'Stop', operation_id: f.point.boundary.operation_id }) + '\n');
  assert.equal(core.observeExpectedAgentRunInterruption(f.point).recorded_state, 'unconfirmed', 'generic Stop is not native interrupted evidence');
  rmSync(f.marker); await service.interruptCascade(input); assert.deepEqual(f.keys, ['Escape']);
  assert.equal((await store.transaction(state => state.interruptions[0], { readOnly: true })).phase, 'accepted');
  writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: f.point.boundary.operation_id }));
  assert.throws(() => withExecutionEffectScope(f.name, () => {}, () => core.sendKeyResult(f.name, 'Escape')), /C-c/);
});
test('Claude controller with no matching operation-bearing receipt performs no key and leaves missing provenance unresolved', posix, async t => {
  for (const mode of ['absent', 'operation-null', 'different-operation']) {
    const f = managedFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-managed-missing-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
      observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
      observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
      interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('not a finish proof'); },
    }));
    if (mode !== 'absent') for (let i = 0; i < 1; i++) {
      const target = structuredClone(f.point); if (mode === 'operation-null') target.boundary.operation_id = null;
      if (mode === 'different-operation') target.boundary.operation_id = 'sha256:' + '8'.repeat(64);
      const record = await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1',
        request: { kind: 'delivery', delivery_id: 'existing-claude-' + i, target_session_id: f.name }, source: { launch: null, boundary: null },
        target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
      await service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => ({ value: 'existing', target }));
    }
    const result = await service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] });
    assert.equal(result.targets[0].interruption, 'unsupported'); assert.equal(result.targets[0].key_receipt, 'not_sent');
    assert.deepEqual(f.keys, []); assert.deepEqual(await store.transaction(state => state.interruptions, { readOnly: true }), []);
  }
});
test('mixed old jobs and multiple cursors do not exclude a reachable Claude launch from mechanical Esc, and unmatched aliases remain unresolved', posix, async t => {
  const f = managedFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-managed-mixed-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('no completion proof'); },
  }));
  const originals = [];
  for (let i = 0; i < 3; i++) {
    const target = structuredClone(f.point); target.boundary.event_cursor += i;
    if (i === 0) target.boundary.operation_id = 'sha256:' + '8'.repeat(64); // earlier other operation is not current
    const request = { kind: 'delivery', delivery_id: 'existing-mixed-' + i, target_session_id: f.name };
    await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1', request,
      source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
    await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: 'existing', target })); originals.push({ request, target });
  }
  const result = await service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] });
  assert.deepEqual(f.keys, ['Escape']); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.deepEqual(result.targets[0].run, originals[1].target, 'matching existing reference; never a newest job or fabricated cursor');
  assert.ok(result.unresolved.some(value => value.reason === 'native_canonical_alias_missing'));
  for (const { request, target } of originals) {
    const saved = await service.execute({ action: 'status', request }); assert.deepEqual(saved.relation.target, target);
    assert.equal(saved.relation.lifecycle, 'tracking'); assert.equal(saved.relation.completion, 'open');
  }
});
test('same-server SDK/scoped caller/core Claude operation Esc remains unconfirmed and leaves the accepted job binding intact', posix, async t => {
  const f = managedFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-managed-sdk-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const actor = { pid: 202, started_identity: '2026-10-21T09:00:03Z' };
  const store = new ParticipantExecutionStore(directory, actor, () => {}); store.enroll(['mcp']);
  const runtime = createExecutionRuntime({ observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('no native completion adapter'); } });
  const service = new ExecutionService(store, runtime), request = { kind: 'delivery', delivery_id: 'sdk-existing-claude', target_session_id: f.name };
  await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1', request,
    source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: 'old accepted receipt', target: f.point }));
  const parent = { parentFromIngress: () => null, captureEndpointEvidence() { assert.fail('no new parent'); }, async bind() { assert.fail('no bind'); }, async submit() { assert.fail('no submit'); } };
  const server = createAitermServer({ execution: server => ({ parentExecution: parent, parentStateRoot: join(directory, 'parent'),
    parentDependencies: { processes: () => [], exists: () => true, async verify() {}, async observe() { assert.fail('no parent wait'); }, async answer() { assert.fail('no parent answer'); } },
    dispatcher: createExecutionDispatcher({ service, nativeIdentity: actor, sourceEnvironment: {},
      initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration: core.observeExecutionSessionGeneration }),
  }) });
  registerExecutionTools(server, service, { interruptCurrentRun: true });
  const client = new Client({ name: 'bellteam', version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  try {
    const response = await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] } });
    assert.equal(response.isError, undefined); const result = response.structuredContent;
    assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'accepted'); assert.deepEqual(result.targets[0].run, f.point);
    assert.equal(result.targets[0].interruption, 'unconfirmed'); assert.equal(result.targets[0].session_preserved, 'unconfirmed');
    const state = await store.transaction(state => structuredClone(state), { readOnly: true });
    assert.deepEqual(state.interruptions[0].caller, actor); assert.notEqual(state.interruptions[0].caller.pid, f.actor.pid);
    assert.equal(state.interruptions[0].before.recorded_state, 'unconfirmed'); assert.deepEqual(state.records[0].relation.target, f.point);
    assert.equal(state.records[0].relation.lifecycle, 'tracking'); assert.equal(state.slots[0].state, 'unknown');
    assert.deepEqual(f.keys, ['Escape']); assert.equal(f.native.present, true);
  } finally { await client.close(); await server.close(); }
});
test('Claude native Esc failure after issuance keeps the original operation and unknown slot without replay or closed/idle success', posix, async t => {
  const f = managedFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-managed-key-failure-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('not native abort proof'); },
  })), request = { kind: 'delivery', delivery_id: 'existing-claude-key-failure', target_session_id: f.name };
  await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1', request,
    source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: 'existing', target: f.point }));
  f.control.failKey = true;
  const input = { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] };
  const first = await service.interruptCascade(input), second = await service.interruptCascade(input);
  assert.deepEqual(f.keys, ['Escape']); assert.equal(first.targets[0].key_receipt, 'unknown');
  assert.equal(second.targets[0].key_receipt, 'unknown'); assert.equal(second.targets[0].session_preserved, 'unconfirmed');
  const state = await store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.interruptions[0].phase, 'unknown'); assert.deepEqual(state.interruptions[0].before.run, f.point);
  assert.equal(state.slots[0].state, 'unknown'); assert.equal(state.records[0].relation.lifecycle, 'tracking');
  assert.deepEqual(state.records[0].relation.target, f.point); assert.equal(f.native.present, true);
});
test('actual core Codex steer traverses every repeated native admission and binds the original receipt', posix, async t => {
  const f = fixture(t, 'codex'), directory = mkdtempSync(join(tmpdir(), 'codex-actual-steer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  f.control.allowInput = true; f.control.immediateScreen = '◦ Working (5s • esc to interrupt)';
  mkdirSync(SOCKDIR, { recursive: true });
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    async observeDone() { assert.fail('no completion proof'); },
  }));
  const dispatcher = createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
    sourceEnvironment: {}, initializedClientName: () => 'codex', observeSessionGeneration: core.observeExecutionSessionGeneration });
  let coreError;
  const result = await dispatcher.dispatch('pty_send', { session_id: f.name, text: 'synthetic steer' }, { requestId: 'actual-core-steer' }, async () => {
    let receipt;
    try { receipt = await core.sendAgentMessage(f.name, 'synthetic steer', { follow: true }); }
    catch (error) { coreError = error; throw error; }
    return { content: [], structuredContent: { schema: 'aiterm.pty-send-result.v1', mode: 'agent_steer',
      session_id: f.name, launch_id: receipt.launch_id, event_cursor: receipt.follow.event_cursor },
      _meta: { 'aiterm/steer': { schema: 'aiterm.steer-ref.v1', steer_id: receipt.follow.steer_id, interim_from: receipt.follow.interim_from } } };
  });
  assert.equal(result.isError, undefined, coreError?.stack ?? JSON.stringify(result));
  assert.ok(f.control.inputCommands.includes('paste-buffer')); assert.ok(f.control.inputCommands.includes('send-keys-input'));
  const state = store.snapshot(); assert.deepEqual(state.slots, []); assert.equal(state.records[0].operations.send, 'accepted');
  assert.ok(state.records[0].relation.target.boundary.steer_id);
});
test('real SDK BellTeam pty_close recovers one failed send through the actual core handler and keeps its original unknown record', posix, async t => {
  for (const outcome of ['closed', 'close-failed', 'server-exit', 'server-exit-timeout']) {
  const failed = outcome === 'close-failed';
  const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'management-close-real-handler-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  f.control.allowClose = true; f.control.closeFails = failed;
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeNativeSessionsSync: core.observeExecutionNativeCreationScope,
    async observeDone() { assert.fail('no completion proof'); },
  }));
  const request = { kind: 'delivery', delivery_id: '0e6e3674-8c76-40d5-9dcc-3ffdcba00402', target_session_id: f.name };
  const original = await service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
  await assert.rejects(service.invokeDeferred({ schema: 'aiterm.execution-ref.v1', request }, 'send', async issue => {
    issue(); throw Error('synthetic original native failure');
  }, f.name));
  const before = await service.execute({ action: 'status', request });
  const parent = { parentFromIngress: () => null, captureEndpointEvidence() { assert.fail('no parent source'); },
    async bind() { assert.fail('no parent binding'); }, async submit() { assert.fail('no parent submission'); } };
  const server = createAitermServer({ execution: server => ({ parentExecution: parent, parentStateRoot: join(directory, 'parent'),
    parentDependencies: { processes: () => [], exists: () => true, async verify() {}, async observe() { assert.fail('no wait'); }, async answer() { assert.fail('no answer'); } },
    dispatcher: createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
      sourceEnvironment: {}, initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration: core.observeExecutionSessionGeneration }),
  }) });
  registerExecutionTools(server, service);
  let postCloseReads = 0;
  if (outcome.startsWith('server-exit')) f.control.listReply = () => {
    if (!f.control.closeCalls) return null;
    postCloseReads++;
    const slot = store.snapshot().slots.find(slot => slot.request?.tool === 'pty_close');
    assert.equal(slot?.state, 'issued', 're-observation stays inside the same issued management slot');
    return { status: 1, stdout: '', stderr: outcome === 'server-exit-timeout' || postCloseReads < 3
      ? 'server exited unexpectedly' : `no server running on ${SOCK}` };
  };
  const client = new Client({ name: 'bellteam', version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  try {
    const result = await client.callTool({ name: 'pty_close', arguments: { session_id: f.name } });
    assert.equal(f.control.closeCalls, 1); assert.equal(f.native.present, failed);
    if (failed || outcome === 'server-exit-timeout') {
      if (failed) {
        assert.equal(result.isError, true, JSON.stringify(result));
        assert.match(result.content[0].text, /synthetic close failure/);
        assert.equal(JSON.parse(readFileSync(f.metadata)).launch_id, f.point.launch.launch_id);
      } else {
        assert.equal(result.isError, undefined, 'preserve the observed native close receipt');
        assert.equal(result._meta['aiterm/execution_error'].effect, 'possible');
        assert.ok(postCloseReads > 1);
        assert.ok(store.snapshot().slots.some(slot => slot.request?.tool === 'pty_close' && slot.state === 'unknown'));
      }
      assert.equal(store.snapshot().slots.length, 2);
    } else {
      assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal(result.structuredContent.outcome, 'closed');
      assert.deepEqual(store.snapshot().slots, []);
      if (outcome === 'server-exit') assert.equal(postCloseReads, 3);
    }
    assert.deepEqual(await service.execute({ action: 'status', request }), before);
    assert.equal(before.operations.send, 'unknown');
    assert.equal(original.operations.send, 'not_issued');
  } finally { await client.close(); await server.close(); }
  }
});
test('actual core Claude before_send reaches the real dispatcher binding without sourcing an operation/cursor from its output or arguments', posix, async t => {
  const f = fixture(t, 'claude'), directory = mkdtempSync(join(tmpdir(), 'claude-actual-send-boundary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  rmSync(f.marker); writeFileSync(f.meta.event_file, '\n'); f.control.allowInput = true;
  mkdirSync(SOCKDIR, { recursive: true }); // the synthetic tmux never creates its fixture directory
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('not native acceptance proof'); },
  }));
  const dispatcher = createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
    sourceEnvironment: {}, initializedClientName: () => 'claude-code', observeSessionGeneration: core.observeExecutionSessionGeneration });
  let before, coreError;
  const result = await dispatcher.dispatch('claude_turn', { action: 'issue', session_id: f.name, operation_id: f.point.boundary.operation_id }, { requestId: 'actual-core-send' }, async () => {
    let receipt;
    try { receipt = await core.dispatchAgentTurn(f.name, 'synthetic input', { operation_id: f.point.boundary.operation_id,
      raw: true, pane_input_recovery: [], before_send: async boundary => { before = structuredClone(boundary); } }); }
    catch (error) { coreError = error; throw error; }
    // Public claude_turn result does not carry a dispatch event_cursor. Only
    // the actual product core boundary may supply it to the private binding.
    return { content: [], structuredContent: { schema: 'aiterm.claude-operation-result.v1', action: 'issue', status: 'accepted',
      session_id: f.name, operation_id: receipt.operation_id, raw_output: null, reason: null, submit_residue: null } };
  });
  assert.equal(result.isError, undefined, coreError?.stack ?? JSON.stringify(result)); assert.ok(before); assert.ok(f.control.inputCommands.length);
  const target = result._meta['aiterm/execution_binding'].target;
  assert.equal(target.boundary.event_cursor, before.event_cursor); assert.equal(target.boundary.operation_id, before.operation_id);
  assert.equal(target.boundary.turn_id, null); assert.equal(result.structuredContent.event_cursor, undefined);
  const stop = await service.interruptCascade({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] });
  assert.equal(stop.targets[0].key_receipt, 'accepted'); assert.deepEqual(stop.targets[0].run, target);
  assert.equal(stop.targets[0].session_preserved, 'unconfirmed'); assert.deepEqual(f.keys, ['Escape']);
});
test('real SDK claude_turn handler preserves its actual core boundary into the same private stop control without a fake input handler', posix, async t => {
  const f = fixture(t, 'claude'), directory = mkdtempSync(join(tmpdir(), 'claude-real-handler-boundary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  rmSync(f.marker); writeFileSync(f.meta.event_file, '\n'); f.control.allowInput = true; mkdirSync(SOCKDIR, { recursive: true });
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('generic done is not native abort'); },
  }));
  const parent = { parentFromIngress: () => null, captureEndpointEvidence() { assert.fail('no parent source'); }, async bind() { assert.fail('no parent binding'); }, async submit() { assert.fail('no parent submission'); } };
  const server = createAitermServer({ execution: server => ({ parentExecution: parent, parentStateRoot: join(directory, 'parent'),
    parentDependencies: { processes: () => [], exists: () => true, async verify() {}, async observe() { assert.fail('no parent wait'); }, async answer() { assert.fail('no parent answer'); } },
    dispatcher: createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
      sourceEnvironment: {}, initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration: core.observeExecutionSessionGeneration }),
  }) });
  registerExecutionTools(server, service, { interruptCurrentRun: true });
  const client = new Client({ name: 'synthetic-operator', version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  try {
    const submitted = await client.callTool({ name: 'claude_turn', arguments: { action: 'issue', session_id: f.name,
      operation_id: f.point.boundary.operation_id, text: 'synthetic input' } });
    assert.equal(submitted.isError, undefined, JSON.stringify(submitted));
    assert.equal(submitted.structuredContent.status, 'accepted'); assert.equal(submitted.structuredContent.event_cursor, undefined);
    const target = submitted._meta['aiterm/execution_binding'].target;
    assert.equal(target.boundary.operation_id, f.point.boundary.operation_id); assert.equal(target.boundary.event_cursor, 1);
    const stopped = await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] } });
    assert.equal(stopped.isError, undefined); assert.deepEqual(stopped.structuredContent.targets[0].run, target);
    assert.equal(stopped.structuredContent.targets[0].key_receipt, 'accepted'); assert.equal(stopped.structuredContent.targets[0].interruption, 'unconfirmed');
    assert.equal(stopped.structuredContent.targets[0].session_preserved, 'unconfirmed'); assert.deepEqual(f.keys, ['Escape']);
    const record = await service.execute({ action: 'status', request: submitted._meta['aiterm/execution_binding'].request });
    assert.deepEqual(record.relation.target, target); assert.equal(record.relation.lifecycle, 'tracking');
  } finally { await client.close(); await server.close(); }
});

function anonymousFixture(t) {
  const f = fixture(t, 'claude'); f.point.boundary.operation_id = null; f.point.boundary.event_cursor = 7;
  writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v2', operation_id: null, event_cursor: 7 }));
  writeFileSync(f.meta.event_file, 'synthetic later output; never the original cursor\n'); return f;
}
test('anonymous Claude keeps the marker-bound original cursor, leaves hook/native evidence unknown and refuses legacy or inferred cursors', posix, t => {
  const f = anonymousFixture(t), before = readFileSync(f.marker, 'utf8');
  const observation = nativeInterruptionObservationSchema.parse(core.selectExpectedAgentRunInterruption(f.point.launch, [
    { ...f.point, boundary: { ...f.point.boundary, event_cursor: 6 } }, f.point,
    { ...f.point, boundary: { ...f.point.boundary, event_cursor: 99 } },
  ]));
  assert.deepEqual(observation.run, f.point); assert.equal(observation.schema, 'aiterm.claude-anonymous-interruption-observation.v1');
  assert.equal(observation.loaded_hook, 'unconfirmed'); assert.equal(observation.endpoint.dispatch_receipt, null);
  assert.equal(observation.endpoint.session_id, null); assert.equal(observation.recorded_state, 'unconfirmed');
  assert.equal(sameInterruptionRun(f.point, f.point), false, 'cursor is not a generic native run/source alias');
  for (const mutate of [x => x.loaded_hook = 'confirmed', x => x.recorded_state = 'running', x => x.native_boundary.event_cursor++,
    x => x.run.boundary.operation_id = 'sha256:' + 'a'.repeat(64), x => x.invocation_fence = 'closed']) {
    const forged = structuredClone(observation); mutate(forged); assert.equal(nativeInterruptionObservationSchema.safeParse(forged).success, false);
  }
  assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch, [{ ...f.point, boundary: { ...f.point.boundary, event_cursor: 8 } }]));
  assert.equal(f.apply().outcome, 'accepted'); assert.deepEqual(f.keys, ['Escape']); assert.equal(readFileSync(f.marker, 'utf8'), before);
  writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v1', operation_id: null }));
  assert.throws(() => core.observeExpectedAgentRunInterruption(f.point)); assert.throws(() => f.apply()); assert.deepEqual(f.keys, ['Escape']);
});
test('anonymous Claude marker replacement, cursor change and launch/actor changes during observation refuse Esc', posix, t => {
  for (const change of ['marker', 'cursor', 'generation', 'actor']) {
    const f = anonymousFixture(t); let changed = false;
    f.control.afterFirstTable = () => {
      if (changed) return; changed = true;
      if (change === 'marker') { writeFileSync(f.marker + '.new', readFileSync(f.marker)); renameSync(f.marker + '.new', f.marker); }
      if (change === 'cursor') writeFileSync(f.marker, JSON.stringify({ schema: 'aiterm.claude-operation-marker.v2', operation_id: null, event_cursor: 8 }));
      if (change === 'generation') { const meta = JSON.parse(readFileSync(f.metadata)); meta.launch_id = 'f'.repeat(32); writeFileSync(f.metadata, JSON.stringify(meta)); }
      if (change === 'actor') f.actor.started_identity = 'Wed Oct 21 09:00:03 2026';
    };
    assert.throws(() => core.selectExpectedAgentRunInterruption(f.point.launch, [f.point]), undefined, change); assert.deepEqual(f.keys, []);
  }
});
test('anonymous Claude accepted Esc survives service reconstruction without retry, receipt rebinding or finish on marker consumption', posix, async t => {
  const f = anonymousFixture(t), directory = mkdtempSync(join(tmpdir(), 'claude-anonymous-controller-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), runtime = createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('no native finish proof'); },
  }), service = new ExecutionService(store, runtime);
  const request = { kind: 'delivery', delivery_id: 'existing-anonymous-claude', target_session_id: f.name };
  await service.execute({ action: 'register', source_session_id: null, reservation: { schema: 'aiterm.execution-reservation.v1', request,
    source: { launch: null, boundary: null }, target: { session_id: f.name, expected_launch_id: f.point.launch.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: 'existing receipt', target: f.point }));
  const input = { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] };
  const result = await service.interruptCascade(input);
  assert.deepEqual(result.targets[0].run, f.point); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.equal(result.targets[0].session_preserved, 'unconfirmed'); assert.equal(result.targets[0].interruption, 'unconfirmed');
  assert.ok(result.unresolved.some(x => x.reason === 'claude_hook_version_unconfirmed')); assert.deepEqual(f.keys, ['Escape']);
  const original = await service.execute({ action: 'status', request });
  rmSync(f.marker); writeFileSync(f.meta.event_file, JSON.stringify({ type: 'agent_done', reason: 'Stop', operation_id: null }) + '\n');
  const rebuilt = new ExecutionService(new FileExecutionStore(directory), runtime); await rebuilt.interruptCascade(input);
  await assert.rejects(rebuilt.settleInterruption(f.point)); assert.deepEqual(f.keys, ['Escape']);
  assert.deepEqual(await rebuilt.execute({ action: 'status', request }), original);
  const state = await store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.interruptions.length, 1); assert.equal(state.interruptions[0].phase, 'accepted'); assert.equal(state.slots[0].state, 'unknown');
});
test('actual anonymous core before_send writes private v2 with the original cursor; unmounted input keeps legacy v1', posix, async t => {
  for (const injected of [false, true]) {
    const f = fixture(t, 'claude'); rmSync(f.marker); writeFileSync(f.meta.event_file, '\n');
    f.control.allowInput = true; mkdirSync(SOCKDIR, { recursive: true });
    let target;
    if (injected) {
      const directory = mkdtempSync(join(tmpdir(), 'claude-anonymous-actual-send-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
      const service = new ExecutionService(new FileExecutionStore(directory), createExecutionRuntime({
        observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
        async observeDone() { assert.fail('no finish proof'); },
      }));
      const dispatcher = createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
        sourceEnvironment: {}, initializedClientName: () => 'synthetic-operator', observeSessionGeneration: core.observeExecutionSessionGeneration });
      const response = await dispatcher.dispatch('pty_send', { session_id: f.name }, { requestId: 'anonymous-before-send' }, async () => {
        const receipt = await core.dispatchAgentTurn(f.name, 'synthetic input', { raw: true, pane_input_recovery: [] });
        return { content: [], structuredContent: { schema: 'aiterm.pty-send-result.v1', mode: 'agent_dispatch', session_id: f.name,
          event_cursor: receipt.event_cursor, operation_id: null } };
      });
      assert.equal(response.isError, undefined, JSON.stringify(response)); target = response._meta['aiterm/execution_binding'].target;
      assert.ok(target); assert.equal(target.boundary.operation_id, null); assert.equal(target.boundary.turn_id, null);
    } else await core.dispatchAgentTurn(f.name, 'synthetic input', { raw: true, pane_input_recovery: [] });
    const marker = JSON.parse(readFileSync(f.marker));
    assert.deepEqual(marker, injected ? { schema: 'aiterm.claude-operation-marker.v2', operation_id: null, event_cursor: target.boundary.event_cursor }
      : { schema: 'aiterm.claude-operation-marker.v1', operation_id: null });
    assert.ok(f.control.inputCommands.length); assert.deepEqual(f.keys, []);
  }
});

test('anonymous marker replacement at the physical core gate cannot receive Esc even with unchanged contents', posix, t => {
  const f = anonymousFixture(t); let replaced = false;
  f.control.afterFirstTable = () => {
    if (replaced) return; replaced = true;
    writeFileSync(f.marker + '.new', readFileSync(f.marker)); renameSync(f.marker + '.new', f.marker);
  };
  assert.throws(() => f.apply()); assert.equal(replaced, true); assert.deepEqual(f.keys, []);
});

test('real SDK anonymous pty_send binds the v2 original cursor into the same private stop control while leaving native completion unknown', posix, async t => {
  const f = fixture(t, 'claude'), directory = mkdtempSync(join(tmpdir(), 'claude-real-handler-boundary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  rmSync(f.marker); writeFileSync(f.meta.event_file, '\n'); f.control.allowInput = true; mkdirSync(SOCKDIR, { recursive: true });
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('generic done is not native abort'); },
  }));
  const parent = { parentFromIngress: () => null, captureEndpointEvidence() { assert.fail('no parent source'); }, async bind() { assert.fail('no parent binding'); }, async submit() { assert.fail('no parent submission'); } };
  const server = createAitermServer({ execution: server => ({ parentExecution: parent, parentStateRoot: join(directory, 'parent'),
    parentDependencies: { processes: () => [], exists: () => true, async verify() {}, async observe() { assert.fail('no parent wait'); }, async answer() { assert.fail('no parent answer'); } },
    dispatcher: createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
      sourceEnvironment: {}, initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration: core.observeExecutionSessionGeneration }),
  }) });
  registerExecutionTools(server, service, { interruptCurrentRun: true });
  const client = new Client({ name: 'synthetic-operator', version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  try {
    const submitted = await client.callTool({ name: 'pty_send', arguments: { session_id: f.name, raw: true, text: 'synthetic input' } });
    assert.equal(submitted.isError, undefined, JSON.stringify(submitted));
    assert.equal(submitted.structuredContent.mode, 'agent_dispatch'); assert.equal(submitted.structuredContent.event_cursor, 1);
    const target = submitted._meta['aiterm/execution_binding'].target;
    assert.equal(target.boundary.operation_id, null); assert.equal(target.boundary.event_cursor, 1);
    const stopped = await client.callTool({ name: 'agent_stop', arguments: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] } });
    assert.equal(stopped.isError, undefined); assert.deepEqual(stopped.structuredContent.targets[0].run, target);
    assert.equal(stopped.structuredContent.targets[0].key_receipt, 'accepted'); assert.equal(stopped.structuredContent.targets[0].interruption, 'unconfirmed');
    assert.equal(stopped.structuredContent.targets[0].session_preserved, 'unconfirmed'); assert.deepEqual(f.keys, ['Escape']);
    const record = await service.execute({ action: 'status', request: submitted._meta['aiterm/execution_binding'].request });
    assert.deepEqual(record.relation.target, target); assert.equal(record.relation.lifecycle, 'tracking');
    assert.equal(JSON.parse(readFileSync(f.marker)).schema, 'aiterm.claude-operation-marker.v2');
    assert.ok(stopped.structuredContent.unresolved.some(x => x.reason === 'claude_hook_version_unconfirmed'));
  } finally { await client.close(); await server.close(); }
});

function anonymousRaceService(t, f, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'claude-anonymous-stop-race-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), service = new ExecutionService(store, createExecutionRuntime({
    observeSession: core.observeExecutionSessionGeneration, observeSessionSync: core.observeExecutionSessionGeneration,
    observeInterruptionSync: core.observeExpectedAgentRunInterruption, selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun, async observeDone() { assert.fail('no native completion'); }, ...overrides,
  }), 150);
  const dispatcher = createExecutionDispatcher({ service, nativeIdentity: { pid: 202, started_identity: '2026-10-21T09:00:03Z' },
    sourceEnvironment: {}, initializedClientName: () => 'synthetic-operator', observeSessionGeneration: core.observeExecutionSessionGeneration });
  rmSync(f.marker); writeFileSync(f.meta.event_file, '\n'); f.control.allowInput = true; mkdirSync(SOCKDIR, { recursive: true });
  const dispatch = (id, before_send, afterReceipt) => dispatcher.dispatch('pty_send', { session_id: f.name }, { requestId: id }, async () => {
    const receipt = await core.dispatchAgentTurn(f.name, 'synthetic input', { raw: true, pane_input_recovery: [], before_send });
    await afterReceipt?.();
    return { content: [], structuredContent: { schema: 'aiterm.pty-send-result.v1', mode: 'agent_dispatch',
      session_id: f.name, event_cursor: receipt.event_cursor, launch_id: receipt.launch_id } };
  });
  return { store, service, dispatcher, dispatch, input: { schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [f.point.launch] } };
}
test('stop during actual anonymous before_send cancels only the old unissued request even when no native run/marker can yet be selected', posix, async t => {
  const f = fixture(t, 'claude'), x = anonymousRaceService(t, f); let stop;
  const result = await x.dispatch('anonymous-stop-before-capture', async () => { stop = await x.service.interruptCascade(x.input); });
  assert.equal(stop.status, 'unconfirmed'); assert.equal(stop.targets[0].key_receipt, 'not_sent');
  assert.equal(result.isError, true, 'old unissued input must not cross the native gate after stop');
  assert.deepEqual(f.control.inputCommands.filter(command => command !== 'capture-pane'), []); assert.deepEqual(f.keys, []);
  assert.throws(() => readFileSync(f.marker), { code: 'ENOENT' });
  const state = await x.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].operations.send, 'not_sent'); assert.equal(state.records[0].relation.phase, 'unsent');
  assert.deepEqual(state.slots, []); assert.deepEqual(state.stopping, []); assert.deepEqual(state.interruptions, []);
  assert.ok(stop.unresolved.some(row => row.reason === 'native_current_run_unavailable'), 'cancelled input is not native idle/interruption proof');
  const retry = await x.dispatch('anonymous-stop-before-capture'); assert.equal(retry.isError, true);
  assert.deepEqual(f.control.inputCommands.filter(command => command !== 'capture-pane'), []);
  const next = await x.dispatch('independent-same-launch-next-request'); assert.equal(next.isError, undefined, JSON.stringify(next));
  assert.equal(next._meta['aiterm/execution_binding'].target.launch.launch_id, f.point.launch.launch_id); assert.deepEqual(f.keys, []);
});
test('actual issued anonymous input receipt arriving during stop is retained then reselected at its original Point before a single Esc', posix, async t => {
  const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const f = fixture(t, 'claude'), issued = pause(), release = pause(), selected = pause(); let selections = 0;
  const x = anonymousRaceService(t, f, { selectInterruptionSync(launch, candidates) {
    selections++; selected.resolve(); return core.selectExpectedAgentRunInterruption(launch, candidates);
  } });
  const pending = x.dispatch('anonymous-issued-receipt-late', undefined, async () => { issued.resolve(); await release.promise; });
  await issued.promise;
  const stopping = x.service.interruptCascade(x.input); await selected.promise; release.resolve();
  const [receipt, stop] = await Promise.all([pending, stopping]);
  assert.equal(receipt.isError, undefined, JSON.stringify(receipt));
  const binding = receipt._meta['aiterm/execution_binding']; assert.ok(binding.target); assert.equal(binding.target.boundary.turn_id, null);
  assert.equal(binding.target.boundary.operation_id, null); assert.equal(binding.target.boundary.event_cursor, 1);
  assert.equal(stop.targets[0].key_receipt, 'accepted', 'readonly selector must reconsider the newly bound real receipt');
  assert.ok(selections >= 2); assert.deepEqual(stop.targets[0].run, binding.target); assert.deepEqual(f.keys, ['Escape']);
  assert.equal(stop.targets[0].interruption, 'unconfirmed'); assert.equal(stop.targets[0].session_preserved, 'unconfirmed');
  const saved = await x.service.execute({ action: 'status', request: binding.request });
  assert.equal(saved.operations.send, 'accepted'); assert.deepEqual(saved.relation.target, binding.target); assert.equal(saved.relation.lifecycle, 'tracking');
  await x.service.interruptCascade(x.input); assert.deepEqual(f.keys, ['Escape']);
});

test('a stop with missing anonymous canonical receipt suppresses further native effects of the issued old frame without claiming the first input was not sent', posix, async t => {
  const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const f = fixture(t, 'claude'), issued = pause(), release = pause(), x = anonymousRaceService(t, f); let extraEffect = 0;
  const pending = x.dispatcher.dispatch('pty_send', { session_id: f.name }, { requestId: 'issued-frame-followup-after-stop' }, async () => {
    const receipt = await core.dispatchAgentTurn(f.name, 'synthetic input', { raw: true, pane_input_recovery: [] });
    issued.resolve(); await release.promise;
    // A second actual core action from this same old RPC must pass admission.
    core.sendKeyResult(f.name, 'C-c'); extraEffect++;
    return { content: [], structuredContent: { mode: 'agent_dispatch', session_id: f.name, event_cursor: receipt.event_cursor } };
  });
  await issued.promise; const stopped = await x.service.interruptCascade(x.input); release.resolve(); const result = await pending;
  assert.equal(stopped.status, 'unconfirmed'); assert.equal(stopped.targets[0].key_receipt, 'not_sent'); assert.equal(result.isError, true);
  assert.equal(result._meta['aiterm/execution_error'].effect, 'possible'); assert.equal(extraEffect, 0); assert.deepEqual(f.keys, []);
  const state = await x.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].stopping, true); assert.equal(state.records[0].operations.send, 'unknown'); assert.equal(state.slots[0].state, 'unknown');
});

test('immediate normal keys select harness gesture, preserve session metadata, and ignore missing completion proofs', posix, t => {
  for(const kind of ['codex','claude','cursor','grok']) {
    const f=fixture(t,kind), before=readFileSync(f.metadata,'utf8');
    f.control.expectedKey=['cursor','grok'].includes(kind)?'C-c':'Escape';
    if(kind==='cursor') f.control.immediateScreen='Working\nctrl+c to stop\n';
    if(kind==='grok') f.control.immediateScreen='Responding...\n';
    requireExecutionEffectScope(true);
    const receipt=core.interruptSessionNow(f.name,f.point.launch.launch_id);
    assert.equal(receipt.outcome,'accepted');assert.deepEqual(f.keys,[f.control.expectedKey]);
    assert.equal(readFileSync(f.metadata,'utf8'),before);assert.equal(f.native.present,true);
    assert.equal(receipt.interruption,'unconfirmed');
  }
});

test('normal Ctrl+C is omitted for idle or unknown Cursor/Grok panes; failed key has no close fallback', posix, t => {
  for(const kind of ['cursor','grok']) {
    const f=fixture(t,kind);f.control.expectedKey='C-c';
    f.control.immediateScreen=kind==='cursor'?'unrecognized screen':'unknown';
    assert.throws(()=>core.interruptSessionNow(f.name),error=>error.code==='EXECUTION_UNCONFIRMED');assert.deepEqual(f.keys,[]);
    f.control.immediateScreen=kind==='cursor'?'ctrl+c to stop':'Responding...';f.control.failKey=true;
    assert.throws(()=>core.interruptSessionNow(f.name),error=>error.effect==='possible');assert.deepEqual(f.keys,['C-c']);assert.equal(f.native.present,true);
  }
});

test('normal successful listing with absent session returns idle without a key or metadata prerequisite', posix, t => {
  const f=fixture(t);f.native.present=false;
  assert.deepEqual(core.interruptSessionNow(f.name),{session_id:f.name,outcome:'idle'});assert.deepEqual(f.keys,[]);
});

test('exact scoped no-server and never-created socket diagnostics are idle without any key', posix, t => {
  const f = fixture(t);
  for (const stderr of [`no server running on ${SOCK}\n`, `error connecting to ${SOCK} (No such file or directory)\n`]) {
    f.control.listReply = { status: 1, stdout: '', stderr };
    assert.deepEqual(core.observeExecutionNativeSessions(), { state: 'known', sessions: [] });
    assert.deepEqual(core.observeExecutionNativeCreationScope(), { state: 'known', sessions: [], server: null });
    assert.deepEqual(core.observeExecutionSessionGeneration(f.name), {
      schema: 'aiterm.pty-observe-result.v1', session_id: f.name, exists: false, launch_id: null,
    });
    assert.deepEqual(core.interruptSessionNow(f.name), { session_id: f.name, outcome: 'idle' });
  }
  assert.deepEqual(f.keys, []);
});
test('unrelated socket, permission, transport, malformed and conflicting listing failures remain unknown', posix, t => {
  const f = fixture(t), absent = `error connecting to ${SOCK} (No such file or directory)`;
  for (const reply of [
    { status: 1, stdout: '', stderr: 'error connecting to /other/socket (No such file or directory)' },
    { status: 1, stdout: '', stderr: 'no server running on /other/socket' },
    { status: 1, stdout: '', stderr: `error connecting to ${SOCK} (Permission denied)` },
    { status: 1, stdout: '', stderr: `error connecting to ${SOCK} (Connection refused)` },
    { status: 1, stdout: '', stderr: 'failed to connect: unknown' },
    { status: 1, stdout: '', stderr: absent+'\nadditional diagnostic' },
    { status: 2, stdout: '', stderr: absent },
    { status: 1, stdout: '$9\tunexpected', stderr: absent },
    { status: 0, stdout: 'malformed listing', stderr: '' },
  ]) {
    f.control.listReply = reply;
    assert.deepEqual(core.observeExecutionNativeSessions(), { state: 'unknown' });
    assert.deepEqual(core.observeExecutionNativeCreationScope(), { state: 'unknown' });
    assert.throws(() => core.interruptSessionNow(f.name), error => error.code === 'EXECUTION_UNCONFIRMED');
  }
  assert.deepEqual(f.keys, []);
});


const nativeListingReaders = [core.observeExecutionNativeSessions, core.observeExecutionNativeCreationScope];
test('native listing re-observes only an exiting server and requires exact scoped absence evidence', posix, t => {
  const f = fixture(t), exiting = { status: 1, stdout: '', stderr: 'server exited unexpectedly' };
  for (const read of nativeListingReaders) for (const stderr of [
    `no server running on ${SOCK}`, `error connecting to ${SOCK} (No such file or directory)`,
  ]) {
    let calls = 0;
    f.control.listReply = () => ++calls < 3 ? exiting : { status: 1, stdout: '', stderr };
    const result = read();
    assert.equal(result.state, 'known'); assert.deepEqual(result.sessions, []); assert.equal(calls, 3);
    assert.deepEqual(f.keys, []); assert.equal(f.control.closeCalls, undefined);
  }
});
test('native re-observation stops on ambiguous/other-socket evidence and never treats it as empty', posix, t => {
  const f = fixture(t), exiting = { status: 1, stdout: '', stderr: 'server exited unexpectedly' };
  for (const read of nativeListingReaders) for (const reply of [
    { status: 1, stdout: '', stderr: 'no server running on /other/socket' },
    { status: 1, stdout: '', stderr: `error connecting to ${SOCK} (Permission denied)` },
    { status: 1, stdout: '', stderr: `no server running on ${SOCK}\nextra diagnostic` },
    { status: 2, stdout: '', stderr: `no server running on ${SOCK}` },
    { status: 1, stdout: '$9\tconflicting', stderr: `no server running on ${SOCK}` },
    { status: 1, stdout: '', stderr: 'server exited unexpectedly\nother error' },
    { status: 2, stdout: '', stderr: 'server exited unexpectedly' },
    { status: 1, stdout: '$9\tconflicting', stderr: 'server exited unexpectedly' },
    { status: 0, stdout: 'malformed', stderr: '' },
  ]) {
    let calls = 0;
    f.control.listReply = () => ++calls === 1 ? exiting : reply;
    assert.deepEqual(read(), { state: 'unknown' }); assert.equal(calls, 2);
    calls = 0; f.control.listReply = () => { calls++; return reply; };
    assert.deepEqual(read(), { state: 'unknown' }); assert.equal(calls, 1);
  }
  assert.deepEqual(f.keys, []); assert.equal(f.control.closeCalls, undefined);
});
test('native listing retains unknown after the bounded server-exit re-observation', posix, t => {
  const f = fixture(t);
  for (const read of nativeListingReaders) {
    let calls = 0;
    f.control.listReply = () => { calls++; return { status: 1, stdout: '', stderr: 'server exited unexpectedly' }; };
    const start = performance.now();
    assert.deepEqual(read(), { state: 'unknown' });
    assert.ok(calls > 1); assert.ok(calls <= 26, '500ms with 20ms pauses limits native reads');
    assert.ok(performance.now() - start >= 450);
  }
  assert.deepEqual(f.keys, []); assert.equal(f.control.closeCalls, undefined);
});
test('generation replaced during native re-observation refuses expected close without acting on replacement', posix, t => {
  for (const replacement of ['managed', 'native', 'server']) {
    const f = fixture(t); let detailedReads = 0;
    f.control.listReply = format => {
      if (format !== '#{pid}\t#{session_id}\t#{session_name}') return null;
      detailedReads++;
      if (detailedReads === 1) return { status: 1, stdout: '', stderr: 'server exited unexpectedly' };
      if (detailedReads === 2) {
        if (replacement === 'managed') writeFileSync(f.metadata, JSON.stringify({ ...f.meta, launch_id: 'f'.repeat(32) }));
        if (replacement === 'native') f.native.id = '$10';
        if (replacement === 'server') f.server.started_identity = 'Wed Oct 21 09:01:00 2026';
      }
      // Change native/server identity again between the two close snapshots.
      if (detailedReads === 4 && replacement === 'native') f.native.id = '$11';
      if (detailedReads === 3 && replacement === 'server') f.server.started_identity = 'Wed Oct 21 09:02:00 2026';
      return null;
    };
    assert.throws(() => core.closeExpectedAgentSession(f.point.launch), error =>
      ['EXECUTION_STALE_GENERATION', 'EXECUTION_UNCONFIRMED', 'EXECUTION_UNSUPPORTED'].includes(error.code));
    assert.ok(detailedReads >= 2); assert.equal(f.control.closeCalls, undefined); assert.deepEqual(f.keys, []);
    assert.equal(f.native.present, true);
  }
});
