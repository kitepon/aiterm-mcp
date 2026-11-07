// Opt-in runtime lifecycle: overlap decision, controller, MCP composition, argv. No tmux/CLI/real state.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { decideRuntimeOverlap, RUNTIME_OVERLAP_STORES } from '../dist/runtime-compatibility.js';
import { createRuntimeAdoption, activationRecordPath } from '../dist/runtime-adoption.js';
import { createNativeDeliveryServer, parseNativeExecutionArguments } from '../dist/execution-native-server.js';

const candidate = JSON.parse(readFileSync(new URL('../runtime-overlap.json', import.meta.url), 'utf8'));
const withWrites = (store, writes, reads) => ({ ...structuredClone(candidate), stores: { ...structuredClone(candidate.stores), [store]: { writes, reads } } });
const tmp = t => { const dir = mkdtempSync(join(tmpdir(), 'runtime-adoption-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const code = promise => promise.then(() => assert.fail('expected rejection'), error => error.code ?? error.message);
const codeSync = fn => { try { fn(); } catch (error) { return error.code ?? error.message; } return assert.fail('expected throw'); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const controller = (t, hooks = {}, extra = {}) => {
  const stateRoot = extra.stateRoot ?? tmp(t);
  const config = { mode: 'standby', generation: 'g2', scope: 'scope-a', stateRoot, ...extra };
  return { stateRoot, config, adoption: createRuntimeAdoption(config, { declaration: () => candidate, onRetire: async () => {}, ...hooks }) };
};

test('overlap: candidate file vs legacy-v1 is supported with every store in common_formats', () => {
  const decision = decideRuntimeOverlap(candidate, ['legacy-v1']);
  assert.equal(decision.supported, true);
  assert.deepEqual(Object.keys(decision.common_formats).sort(), [...RUNTIME_OVERLAP_STORES].sort());
  assert.equal(decision.common_formats['provider-hooks'], 'steer-v1');
});

test('overlap: a candidate that writes v2 is unreadable by a legacy peer', () => {
  const decision = decideRuntimeOverlap(withWrites('parent-delivery', 'v2', ['v1', 'v2']), ['legacy-v1']);
  assert.equal(decision.supported, false);
  assert.deepEqual(decision.common_formats, {});
  assert.ok(decision.conflicts.some(c => c.peer === 0 && c.store === 'parent-delivery' && c.reason === 'candidate_unreadable_by_peer'));
});

test('overlap: pairwise-against-latest is not enough, the oldest live peer blocks', () => {
  const g1 = withWrites('parent-delivery', 'v1', ['v1', 'v2']);
  const decision = decideRuntimeOverlap(withWrites('parent-delivery', 'v2', ['v1', 'v2']), [g1, 'legacy-v1']);
  assert.equal(decision.supported, false);
  assert.ok(decision.conflicts.some(c => c.peer === 1 && c.store === 'parent-delivery' && c.reason === 'candidate_unreadable_by_peer'));
  assert.ok(!decision.conflicts.some(c => c.peer === 0));
});

test('overlap: missing store and missing manager_abi are unsupported', () => {
  const noStore = structuredClone(candidate); delete noStore.stores.events;
  const missing = decideRuntimeOverlap(noStore, ['legacy-v1']);
  assert.equal(missing.supported, false);
  assert.ok(missing.conflicts.some(c => c.store === 'events' && c.reason === 'missing'));
  const noAbi = structuredClone(candidate); delete noAbi.manager_abi;
  const abi = decideRuntimeOverlap(noAbi, ['legacy-v1']);
  assert.equal(abi.supported, false);
  assert.ok(abi.conflicts.some(c => c.store === 'manager_abi'));
});

test('overlap: invalid declarations throw RUNTIME_OVERLAP_INVALID', () => {
  const extraKey = { ...structuredClone(candidate), extra: true };
  const writesNotRead = withWrites('events', 'v2', ['v1']);
  const badSchema = { ...structuredClone(candidate), schema: 'other.v1' };
  for (const bad of [extraKey, writesNotRead, badSchema, null, 'nonsense'])
    assert.throws(() => decideRuntimeOverlap(bad, ['legacy-v1']), { message: 'RUNTIME_OVERLAP_INVALID' });
  assert.throws(() => decideRuntimeOverlap(candidate, []), { message: 'RUNTIME_OVERLAP_INVALID' });
  assert.throws(() => decideRuntimeOverlap(candidate, [extraKey]), { message: 'RUNTIME_OVERLAP_INVALID' });
});

// Activation is durable only through the POSIX file+directory fsync checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'activation record requires POSIX directory fsync' : false;
test('controller: on Windows activate is unavailable and the candidate stays standby', { skip: process.platform !== 'win32' && 'Windows-only contract' }, async t => {
  const { adoption } = controller(t);
  await adoption.prepare({ expected: 'g1', live: ['legacy-v1'] });
  assert.equal(await code(adoption.activate({ job_id: 'job-1', expected: 'g1' })), 'RUNTIME_ADOPTION_UNAVAILABLE');
  assert.equal(adoption.state, 'standby');
});

test('controller: standby refuses ordinary work, activate needs a supported prepare', async t => {
  const { adoption, stateRoot } = controller(t);
  assert.equal(codeSync(() => adoption.admit()), 'RUNTIME_ADOPTION_NOT_SERVING');
  assert.equal(await code(adoption.activate({ job_id: 'job-1', expected: 'g1' })), 'RUNTIME_ADOPTION_UNSUPPORTED');
  const unsupported = controller(t, { declaration: () => withWrites('parent-delivery', 'v2', ['v1', 'v2']) }, { stateRoot });
  const prepared = await unsupported.adoption.prepare({ expected: 'g1', live: ['legacy-v1'] });
  assert.equal(prepared.overlap.supported, false);
  assert.equal(await code(unsupported.adoption.activate({ job_id: 'job-1', expected: 'g1' })), 'RUNTIME_ADOPTION_UNSUPPORTED');
  assert.equal(existsSync(activationRecordPath({ stateRoot, scope: 'scope-a' }, 'job-1')), false);
  assert.equal(unsupported.adoption.state, 'standby');
});

test('controller: activation record is durable (0600) before onActivate, then idempotent or conflicting', { skip: posixCheckpoint }, async t => {
  let file, seen;
  const { adoption, stateRoot } = controller(t, { onActivate: () => { seen = existsSync(file); } });
  file = join(stateRoot, 'runtime-adoption', 'scope-a', 'job-1.json');
  assert.equal(activationRecordPath({ stateRoot, scope: 'scope-a' }, 'job-1'), file);
  assert.equal((await adoption.prepare({ expected: 'g1', live: ['legacy-v1'] })).overlap.supported, true);
  const result = await adoption.activate({ job_id: 'job-1', expected: 'g1' });
  assert.equal(seen, true, 'record must exist before onActivate');
  assert.equal(result.disposition, 'activated');
  assert.equal(adoption.state, 'active');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.schema, 'aiterm.runtime-adoption.v1');
  assert.equal(stored.expected, 'g1'); assert.equal(stored.candidate, 'g2');
  assert.equal(stored.common_formats['parent-delivery'], 'v1');
  assert.doesNotThrow(() => adoption.admit());
  const again = await adoption.activate({ job_id: 'job-1', expected: 'g1' });
  assert.deepEqual(again.record, stored);
  assert.equal(await code(adoption.activate({ job_id: 'job-1', expected: 'g0' })), 'RUNTIME_ADOPTION_CONFLICT');
});

test('controller: status distinguishes absent from unreadable and a new active controller reconstructs a lost ACK', { skip: posixCheckpoint }, async t => {
  const { adoption, stateRoot, config } = controller(t);
  assert.equal(adoption.status({ job_id: 'nope' }).disposition, 'absent');
  await adoption.prepare({ expected: 'g1', live: ['legacy-v1'] });
  await adoption.activate({ job_id: 'job-1', expected: 'g1' });
  const corrupt = activationRecordPath({ stateRoot, scope: 'scope-a' }, 'job-bad');
  writeFileSync(corrupt, '{not json');
  assert.throws(() => adoption.status({ job_id: 'job-bad' }), { code: 'RUNTIME_ADOPTION_UNAVAILABLE' });
  const restarted = createRuntimeAdoption({ ...config, mode: 'active' }, { declaration: () => candidate, onRetire: async () => {} });
  assert.equal(restarted.status({ job_id: 'job-1' }).disposition, 'activated');
  assert.equal((await restarted.activate({ job_id: 'job-1', expected: 'g1' })).disposition, 'activated');
  assert.equal(restarted.state, 'active');
});

test('controller: retire waits for tracked work, then closes the owner once', { skip: posixCheckpoint }, async t => {
  const work = deferred(); const calls = [];
  const { adoption } = controller(t, { onRetire: async () => { calls.push('retire'); } });
  await adoption.prepare({ expected: 'g1', live: ['legacy-v1'] });
  await adoption.activate({ job_id: 'job-1', expected: 'g1' });
  adoption.track(work.promise);
  let settled = false;
  const first = adoption.retire().then(r => { settled = true; return r; });
  const second = adoption.retire();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false); assert.deepEqual(calls, []);
  assert.equal(adoption.state, 'retiring');
  assert.equal(codeSync(() => adoption.admit()), 'RUNTIME_ADOPTION_NOT_SERVING');
  work.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.owner_closed, true); assert.equal(a.state, 'retired');
  assert.deepEqual(a, b); assert.deepEqual(calls, ['retire']);
  assert.deepEqual(await adoption.retire(), a); assert.deepEqual(calls, ['retire']);
});

test('controller: a rejected onRetire lets a later retire retry', async t => {
  let attempts = 0;
  const { adoption } = controller(t, { onRetire: async () => { if (++attempts === 1) throw new Error('close failed'); } });
  await assert.rejects(adoption.retire(), { message: 'close failed' });
  assert.notEqual(adoption.state, 'retired');
  const result = await adoption.retire();
  assert.equal(result.owner_closed, true); assert.equal(result.state, 'retired'); assert.equal(attempts, 2);
});

async function connect(t, dependencies) {
  const server = createNativeDeliveryServer(dependencies), client = new Client({ name: 'bellteam', version: 'test' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b); await client.connect(a);
  return client;
}
const call = async (client, name, args = {}) => client.callTool({ name, arguments: args });

test('MCP: default server has no runtime_adoption tool', async t => {
  const client = await connect(t, {});
  assert.ok(!(await client.listTools()).tools.some(tool => tool.name === 'runtime_adoption'));
});

test('MCP: configured standby serves only lifecycle control until activation, then retires', { skip: posixCheckpoint }, async t => {
  const stateRoot = tmp(t);
  const client = await connect(t, { runtimeAdoption: { mode: 'standby', generation: 'g2', scope: 'scope-a', stateRoot } });
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'runtime_adoption'));
  const refused = await call(client, 'pty_list');
  assert.equal(refused.isError, true); assert.equal(JSON.parse(refused.content[0].text).error_code, 'RUNTIME_ADOPTION_NOT_SERVING');
  const prepared = await call(client, 'runtime_adoption', { action: 'prepare', expected: 'g1', live: ['legacy-v1'] });
  assert.equal(prepared.isError, undefined); assert.equal(prepared.structuredContent.overlap.supported, true);
  const activated = await call(client, 'runtime_adoption', { action: 'activate', job_id: 'job-1', expected: 'g1' });
  assert.equal(activated.structuredContent.disposition, 'activated');
  assert.equal((await call(client, 'runtime_adoption', { action: 'status', job_id: 'job-1' })).structuredContent.disposition, 'activated');
  const retired = await call(client, 'runtime_adoption', { action: 'retire' });
  assert.equal(retired.structuredContent.owner_closed, true);
  // Retired: ordinary tools are refused again (never executed).
  assert.equal(JSON.parse((await call(client, 'pty_list')).content[0].text).error_code, 'RUNTIME_ADOPTION_NOT_SERVING');
});

test('argv: runtime lifecycle flags are all-or-nothing and mcp-mode only', () => {
  const base = ['--execution-interrupt', '--state-root', '/synthetic/state', '--socket', '/synthetic/socket', '--steer-provider', '/synthetic/provider.mjs'];
  const flags = ['--runtime-adoption', 'standby', '--runtime-generation', 'g2', '--runtime-scope', 's'];
  assert.deepEqual(parseNativeExecutionArguments([...base, ...flags]).runtimeAdoption,
    { mode: 'standby', generation: 'g2', scope: 's', stateRoot: '/synthetic/state' });
  assert.ok(!('runtimeAdoption' in parseNativeExecutionArguments(base)));
  for (const partial of [flags.slice(0, 2), flags.slice(0, 4), flags.slice(2), [...flags.slice(0, 2), ...flags.slice(4)]])
    assert.throws(() => parseNativeExecutionArguments([...base, ...partial]));
  assert.throws(() => parseNativeExecutionArguments([...base, ...flags, '--mode', 'claude-hook']));
  assert.throws(() => parseNativeExecutionArguments([...base, ...flags.map(v => v === 'standby' ? 'bogus' : v)]));
});
