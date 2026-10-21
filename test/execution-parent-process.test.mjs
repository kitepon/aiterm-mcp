import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readExecutionParentProcess } from '../dist/execution-parent-process.js';

const launch_id = 'a'.repeat(32);
const row = (pid, parent_pid) => ({ pid, parent_pid, started_identity: `2026-10-21T07:00:${pid}Z`,
  process_group_id: 10, argv_digest: '1'.repeat(64), cpu_seconds: 0, stopped: false, command: 'not returned' });
function fixture() {
  const rows = [row(10, 9), row(11, 10), row(12, 11)]; let paneCalls = 0;
  const bindings = { present: () => true, metadata: () => ({ launch_id }),
    pane: () => { paneCalls++; return { code: 0, stdout: '10\t0\n' }; }, processes: () => rows,
    select: (_, actual, pid) => { assert.equal(actual, rows); assert.equal(pid, 10);
      return { harness: 'codex-cli', processes: [rows[1]] }; } };
  return { rows, bindings, calls: () => paneCalls, read: () => readExecutionParentProcess('bot-a', bindings) };
}
test('private core adapter snapshot has a unique native harness and retains only nonsecret lineage fields', () => {
  const f = fixture(), value = f.read();
  assert.deepEqual(value.source, { launch: { session_id: 'bot-a', launch_id }, boundary: null });
  assert.deepEqual(value.harness_process, { pid: 11, started_identity: f.rows[1].started_identity });
  assert.equal(value.processes.length, 3); assert.equal(f.calls(), 2);
  assert.equal(JSON.stringify(value).includes('not returned'), false);
  assert.deepEqual(Object.keys(value.processes[0]).sort(), ['parent_pid', 'pid', 'started_identity']);
});
test('missing session, unmanaged metadata, dead/malformed pane and missing process never choose a latest harness', () => {
  for (const change of ['absent', 'unmanaged', 'dead', 'badpid', 'extrafield', 'missingroot', 'ambiguous']) {
    const f = fixture();
    if (change === 'absent') f.bindings.present = () => false;
    if (change === 'unmanaged') f.bindings.metadata = () => null;
    if (change === 'dead') f.bindings.pane = () => ({ code: 0, stdout: '10\t1\n' });
    if (change === 'badpid') f.bindings.pane = () => ({ code: 0, stdout: '1e1\t0\n' });
    if (change === 'extrafield') f.bindings.pane = () => ({ code: 0, stdout: '10\t0\textra\n' });
    if (change === 'missingroot') f.rows.shift();
    if (change === 'ambiguous') f.bindings.select = () => ({ harness: 'codex-cli', processes: f.rows });
    assert.equal(f.read(), null, change);
  }
});
test('native pane or launch replacement during the observation refuses the complete snapshot', () => {
  for (const change of ['pane', 'generation', 'metadata-gone', 'error']) {
    const f = fixture(); let calls = 0;
    if (change === 'pane') f.bindings.pane = () => ({ code: 0, stdout: (++calls === 1 ? '10' : '12') + '\t0\n' });
    if (change === 'generation') f.bindings.metadata = () => ({ launch_id: ++calls === 1 ? launch_id : 'b'.repeat(32) });
    if (change === 'metadata-gone') f.bindings.metadata = () => ++calls === 1 ? { launch_id } : null;
    if (change === 'error') f.bindings.pane = () => ({ code: ++calls === 1 ? 0 : 1, stdout: '10\t0\n' });
    assert.equal(f.read(), null, change);
  }
});
test('process acquisition failure remains missing evidence rather than an empty successful snapshot', () => {
  const f = fixture(); f.bindings.processes = () => { throw Error('synthetic process table unavailable'); };
  assert.throws(f.read, /synthetic process table unavailable/);
});
