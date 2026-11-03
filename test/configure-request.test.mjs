import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { applyConfigurationRequest, reconcileConfigurationRequest, configurationRequestDigest } from '../dist/configure-request.js';
import { beforeConfigurationEffect } from '../dist/configuration-effect.js';
import { stateRoot } from '../dist/agent-shared.js';
import { createAitermServer } from '../dist/index.js';

const launch = '1'.repeat(32), settings = { model: 'fixture-model', reasoning_effort: 'high', fast: false };
const binding = () => ({ id: randomUUID(), launch_id: launch, session_id: 'configure-fixture', digest: configurationRequestDigest(settings) });
const file = b => join(stateRoot(), 'configuration-requests', b.id, 'receipt.json');
const done = b => ({ schema: 'aiterm.agent-configure-result.v1', session_id: b.session_id, provider: 'codex', harness: 'codex-cli',
  model: settings.model, reasoning_effort: settings.reasoning_effort, fast: false });
const posix = { skip: process.platform === 'win32' ? 'directory-sync checkpoint is explicitly unsupported' : false };

test('reconcile absent original request neither creates state nor claims no future effect', () => {
  const b = binding(), before = fs.existsSync(stateRoot());
  const r = reconcileConfigurationRequest(b);
  assert.equal(r.request_state, 'not_recorded'); assert.equal(r.later_effect, 'unconfirmed');
  assert.equal(r.outcome, 'outcome_unknown'); assert.equal(r.current.availability, 'unsupported');
  assert.equal(fs.existsSync(stateRoot()), before); assert.equal(fs.existsSync(file(b)), false);
});
test('digest mismatch and unsupported platform never enter apply', async () => {
  let calls = 0; const b = binding();
  await assert.rejects(applyConfigurationRequest({ ...b, digest: 'a'.repeat(64) }, settings, async () => { calls++; return done(b); }), /DIGEST_MISMATCH/);
  if (process.platform === 'win32') await assert.rejects(applyConfigurationRequest(b, settings, async () => { calls++; return done(b); }), /UNSUPPORTED/);
  assert.equal(calls, 0); assert.equal(fs.existsSync(file(b)), false);
});
test('original terminal result survives reconnect and duplicate apply cannot execute again', posix, async () => {
  const b = binding(); let calls = 0;
  const applied = await applyConfigurationRequest(b, settings, async () => { calls++; return done(b); });
  assert.equal(applied.receipt.request_state, 'terminal'); assert.equal(applied.receipt.later_effect, 'excluded');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {reconcileConfigurationRequest} from './dist/configure-request.js';process.stdout.write(JSON.stringify(reconcileConfigurationRequest(${JSON.stringify(b)})));`],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout).result, done(b));
  const second = await applyConfigurationRequest(b, settings, async () => { calls++; return done(b); });
  assert.equal(calls, 1); assert.equal(second.receipt.terminal_at, applied.receipt.terminal_at);
  for (const replacement of [{ launch_id: '2'.repeat(32) }, { session_id: 'different' }])
    assert.throws(() => reconcileConfigurationRequest({ ...b, ...replacement }), /CONFLICT/);
  await assert.rejects(applyConfigurationRequest({ ...b, digest: configurationRequestDigest({ fast: true }) }, { fast: true }, async () => { calls++; return done(b); }), /CONFLICT/);
  assert.equal(calls, 1);
});
test('pending accepted request is not terminal and duplicate cannot wake it', posix, async () => {
  const b = binding(); let finish, entered, calls = 0;
  const admitted = new Promise(resolve => { entered = resolve; });
  const pending = applyConfigurationRequest(b, settings, async () => { calls++; entered(); await new Promise(resolve => { finish = resolve; }); return done(b); });
  await admitted;
  const read = reconcileConfigurationRequest(b), duplicate = await applyConfigurationRequest(b, settings, async () => { calls++; return done(b); });
  assert.equal(read.request_state, 'pending_or_unknown'); assert.equal(read.later_effect, 'unconfirmed');
  assert.equal(duplicate.receipt.request_state, 'pending_or_unknown'); assert.equal(calls, 1);
  finish(); await pending;
});
test('handler exit and matching current target never exclude issued native input', posix, async () => {
  for (const failed of [false, true]) {
    const b = binding();
    const r = await applyConfigurationRequest(b, settings, async () => {
      beforeConfigurationEffect();
      assert.equal(JSON.parse(fs.readFileSync(file(b), 'utf8')).native_effect, 'possible', 'issue marker is durable before input');
      if (failed) throw new Error('native consumption unknown');
      return done(b);
    });
    assert.equal(r.receipt.request_state, 'terminal'); assert.equal(r.receipt.later_effect, 'unconfirmed');
    assert.equal(r.receipt.outcome, failed ? 'outcome_unknown' : 'applied');
    assert.equal(reconcileConfigurationRequest(b).later_effect, 'unconfirmed');
  }
});
test('post-terminal continuation is refused before any native input', posix, async () => {
  const b = binding(); let release, late, effects = 0;
  const trigger = new Promise(resolve => { release = resolve; });
  await applyConfigurationRequest(b, settings, async () => {
    late = trigger.then(() => { beforeConfigurationEffect(); effects++; }); late.catch(() => {});
    return done(b);
  });
  assert.equal(reconcileConfigurationRequest(b).later_effect, 'excluded');
  release(); await assert.rejects(late, /REQUEST_TERMINAL/); assert.equal(effects, 0);
});
test('checkpoint failure before native issue denies input and retains uncertainty', posix, async () => {
  const b = binding(); let effects = 0;
  const r = await applyConfigurationRequest(b, settings, async () => {
    const rename = fs.renameSync;
    fs.renameSync = () => { throw new Error('synthetic storage failure'); };
    syncBuiltinESMExports();
    try { beforeConfigurationEffect(); effects++; }
    catch (error) {
      fs.renameSync = rename; syncBuiltinESMExports();
      assert.throws(() => { beforeConfigurationEffect(); effects++; });
      throw error;
    } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
    return done(b);
  });
  assert.equal(effects, 0); assert.equal(r.receipt.later_effect, 'unconfirmed'); assert.ok(r.error);
});
test('truncated and replaced receipt is unavailable, never replayed', posix, async () => {
  const b = binding(); await applyConfigurationRequest(b, settings, async () => done(b));
  fs.writeFileSync(file(b), '{');
  const r = await applyConfigurationRequest(b, settings, async () => assert.fail('corrupt original cannot replay'));
  assert.equal(r.receipt.request_state, 'unavailable'); assert.equal(r.receipt.later_effect, 'unconfirmed');
  fs.unlinkSync(file(b)); fs.mkdirSync(file(b));
  assert.equal(reconcileConfigurationRequest(b).request_state, 'unavailable');
});
test('process exit after admission is not evidence of native termination', posix, () => {
  const b = binding();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {applyConfigurationRequest} from './dist/configure-request.js';await applyConfigurationRequest(${JSON.stringify(b)},${JSON.stringify(settings)},async()=>{process.exit(0)});`],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(reconcileConfigurationRequest(b).request_state, 'pending_or_unknown');
  assert.equal(reconcileConfigurationRequest(b).later_effect, 'unconfirmed');
});
test('normal MCP advertises tracked contract, preserves legacy failure and reconciles without native input', async t => {
  const server = createAitermServer(), client = new Client({ name: 'configuration-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools(), tool = tools.tools.find(item => item.name === 'agent_configure');
  assert.deepEqual(tool.inputSchema.properties.action.enum, ['apply', 'reconcile']);
  assert.ok(tool.inputSchema.properties.request.properties.digest);
  if (process.platform !== 'win32') {
    const successful = binding(); await applyConfigurationRequest(successful, settings, async () => done(successful));
    const result = await client.callTool({ name: 'agent_configure', arguments: { action: 'reconcile', session_id: successful.session_id,
      request: { id: successful.id, launch_id: successful.launch_id, digest: successful.digest } } });
    assert.equal(result.structuredContent.outcome, 'applied');
  }
  const old = await client.callTool({ name: 'agent_configure', arguments: { session_id: 'absent-original', fast: false } });
  assert.deepEqual(old.structuredContent, { schema: 'aiterm.agent-configure-error.v1', session_id: 'absent-original', outcome: 'not_applied', effect: 'not_started' });
  const original = { ...binding(), session_id: 'absent-original', digest: configurationRequestDigest({ fast: false }) };
  const request = { id: original.id, launch_id: original.launch_id, digest: original.digest };
  const result = await client.callTool({ name: 'agent_configure', arguments: { action: 'apply', request, session_id: original.session_id, fast: false } });
  assert.equal(result.isError, true);
  if (process.platform !== 'win32') {
    assert.equal(result.structuredContent.request_state, 'terminal'); assert.equal(result.structuredContent.outcome, 'not_applied');
    assert.equal(result.structuredContent.later_effect, 'excluded');
  }
  const read = await client.callTool({ name: 'agent_configure', arguments: { action: 'reconcile', request, session_id: original.session_id } });
  assert.equal(read.isError, undefined); assert.equal(read.structuredContent.schema, 'aiterm.agent-configure-request-result.v1');
  assert.equal(read.structuredContent.current.availability, 'unsupported');
  const invalid = await client.callTool({ name: 'agent_configure', arguments: { action: 'reconcile', request, session_id: original.session_id, fast: false } });
  assert.equal(invalid.isError, true);
  const remote = await client.callTool({ name: 'agent_configure', arguments: { action: 'reconcile', request, session_id: original.session_id,
    remote: { host: 'never-connect.invalid' } } });
  assert.equal(remote.isError, true); assert.match(remote.content[0].text, /REMOTE_UNSUPPORTED/);
});
