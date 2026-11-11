import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

// The sweep runs only outside test fixtures (AGENT_IDLE_ENABLED reads NODE_TEST_CONTEXT at import).
delete process.env.NODE_TEST_CONTEXT;
const tmux = `${process.env.HOME}/tmux-fixture`; fs.writeFileSync(tmux, '', { mode: 0o700 });
process.env.AITERM_TMUX = tmux; process.env.AITERM_PSMUX = tmux;
const { agentEventPath, writeAgentMetadata } = await import('../dist/agent-shared.js');
const { writeAgentIdleClock, writeAgentResumeNative } = await import('../dist/agent-lifecycle.js');
const { maintainAgentIdleClocks } = await import('../dist/core.js');
const { agentManagedClaudeSettingsPath, agentClaudeResultPath } = await import('../dist/harnesses/claude.js');

test('idle sweep: only live seats, one process read for all clocks, a checker only where the owner is gone', { skip: process.platform === 'win32' }, async t => {
  const seat = (name, launch) => {
    const meta = { kind: 'claude', aiterm_session: name, launch_id: launch, event_file: agentEventPath(name, launch), created_at: new Date().toISOString(),
      cwd: process.env.HOME, vendor_session_id: '11111111-2222-4333-8444-555555555555', initial_prompt: 'none', node_platform: process.platform, agent_executable: 'claude',
      agent_role: 'subagent', parent_session_id: 'fixture_parent', delegation_depth: 1, lineage: 'host-root>x', delegation_allowed: true,
      hook_route: 'shared_claude_settings', claude_home: process.env.HOME,
      claude_settings: agentManagedClaudeSettingsPath(name, launch), result_file: agentClaudeResultPath(name, launch) };
    writeAgentMetadata(meta);
    writeAgentResumeNative(meta, { schema: 'aiterm.agent-resume-native.v1', launch_id: launch, native_id: '$1', session_id: name,
      server_pid: 1, server_started_identity: 'x', pane_id: '%1', pane_pid: 1, pane_started_identity: 'x' });
    return meta;
  };
  const live = seat('sweep_live', 'a'.repeat(32)), timed = seat('sweep_timed', 'b'.repeat(32));
  seat('sweep_hibernated', 'c'.repeat(32));
  const oldSync = childProcess.spawnSync, oldSpawn = childProcess.spawn, ps = [], started = [];
  childProcess.spawnSync = (command, args, options) => {
    if (command === tmux && args.includes('list-sessions')) return { status: 0, stdout: 'sweep_live\nsweep_timed\nunrelated\n', stderr: '', output: [] };
    if (command.endsWith('ps')) { ps.push(args.at(-1)); return { status: 0, stdout: `${process.pid} Wed Nov 11 00:00:00 2026\n`, stderr: '', output: [] }; }
    return oldSync(command, args, options);
  };
  childProcess.spawn = (command, args) => {
    started.push(args.join(' ')); const child = new EventEmitter(); child.pid = undefined; child.exitCode = 0; child.unref = () => {};
    setImmediate(() => child.emit('spawn')); return child;
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawnSync = oldSync; childProcess.spawn = oldSpawn; syncBuiltinESMExports(); });
  // The live clock owner's identity is what ps prints for it.
  writeAgentIdleClock(timed, { schema: 'aiterm.agent-idle-clock.v1', launch_id: timed.launch_id, token: 'd'.repeat(32),
    owner: { pid: process.pid, started_identity: 'Wed Nov 11 00:00:00 2026' }, anchor: null, wake_at: new Date(Date.now() + 60_000).toISOString() });
  await maintainAgentIdleClocks();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ps.length, 1, 'one process read for the whole sweep');
  assert.equal(started.length, 1, 'a checker only for the live seat without a clock');
  assert.match(started[0], new RegExp(`--session ${live.aiterm_session} --launch ${live.launch_id}`));
  assert.ok(!started.some(line => line.includes('sweep_hibernated')), 'a seat without a live session gets no checker');
});
