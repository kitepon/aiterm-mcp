import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { agentManagedClaudeSettingsPath, agentClaudeResultPath, agentClaudeOperationPath } from '../dist/harnesses/claude.js';
import { requireExecutionEffectScope, withExecutionEffectScope } from '../dist/execution-effect.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';

// Every native/server/harness identity and command result is synthetic. No
// tmux/ps, CLI, live session or process signal can reach the host.
const saved = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn }, savedKill = process.kill;
let run;
childProcess.spawnSync = (...args) => { assert.ok(run, 'no native fallback'); return run(...args); };
childProcess.spawn = () => assert.fail('no native child');
process.kill = (pid, signal) => { assert.equal(pid, 4711); assert.equal(signal, 0); return true; };
syncBuiltinESMExports();
const core = await import('../dist/core.js');
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
  const control = { failKey: false, afterFirstTable: null };
  const ok = stdout => ({ status: 0, stdout: stdout ?? '', stderr: '' });
  run = (bin, args) => {
    if (bin === '/bin/ps') {
      if (args[0] === '-axww') {
        tableReads++; if (tableReads > 1) control.afterFirstTable?.();
        return ok(`200 1 200 S Wed Oct 21 09:00:01 2026 00:00:00 bash\n201 200 200 S ${actor.started_identity} 00:00:00 ${kind} --launch ${launch_id}\n`);
      }
      assert.deepEqual(args, ['-o', 'pid=,lstart=', '-p', '4711']); return ok('4711 ' + server.started_identity + '\n');
    }
    assert.equal(bin, 'tmux');
    if (args.length === 1 && args[0] === '-V') return ok('tmux synthetic');
    assert.equal(args[0], '-S'); const command = args.slice(2), format = command.at(-1);
    if (command[0] === 'list-sessions') {
      if (!native.present) return ok('');
      if (format === '#{pid}\t#{session_id}\t#{session_name}') return ok(`4711\t${native.id}\t${name}\n`);
      if (format === '#{session_name}\t#{pane_current_command}\t#{session_attached}\t#{window_width}\t#{window_height}') return ok(`${name}\tbash\t0\t80\t24\n`);
    }
    if (command[0] === 'display-message' && format === '#{pane_pid}\t#{pane_dead}') return ok('200\t0\n');
    if (command[0] === 'has-session') return { ...ok(''), status: native.present ? 0 : 1 };
    assert.equal(command[0], 'send-keys'); assert.equal(command[2], '$9'); assert.equal(command[3], 'Escape');
    keys.push(command[3]); return { ...ok(''), status: control.failKey ? 1 : 0 };
  };
  const point = { launch: { session_id: name, launch_id }, boundary: { event_cursor: 0, operation_id: kind === 'claude' ? operation : null,
    turn_id: kind === 'codex' ? 'native-current-turn' : null, steer_id: null } };
  const apply = (input = point, issue = () => {}) => withExecutionEffectScope(name, issue, () => core.interruptExpectedAgentRun(input));
  return { name, point, metadata, marker, meta, actor, server, native, keys, control, writeTurn, apply };
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
