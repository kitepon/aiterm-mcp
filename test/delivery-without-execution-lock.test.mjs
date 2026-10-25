import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createNativeDeliveryServer } from '../dist/execution-native-server.js';
import { executionStoreDirectory } from '../dist/execution-store.js';
import { ensureStateRoot } from '../dist/agent-shared.js';
import { SOCK } from '../dist/tmux-runtime.js';
import { closeSession } from '../dist/core.js';
import { configureNativeExecutionHooks } from '../dist/execution-native-setup.js';

const skip = process.platform === 'win32' ? 'isolated POSIX native CLI fixture' : false;
const entry = fileURLToPath(new URL('../dist/execution-native-server.js', import.meta.url));
const graph = () => executionStoreDirectory(ensureStateRoot(), { kind: 'socket', key: SOCK });
function heldGraph() {
  const directory = graph(); mkdirSync(join(directory, 'transaction.lock'), { recursive: true });
  writeFileSync(join(directory, 'relations.json'), 'unreadable tracking is not delivery admission');
  return () => { assert.equal(readFileSync(join(directory, 'relations.json'), 'utf8'), 'unreadable tracking is not delivery admission'); assert(existsSync(join(directory, 'transaction.lock'))); };
}
async function connection(t, dependencies) {
  const server = createNativeDeliveryServer(dependencies), client = new Client({ name: 'delivery-unlocked', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); }); return client;
}

test('delivery server exposes ordinary tools and direct stop without execution registration', { skip }, async t => {
  const unchanged = heldGraph(), client = await connection(t);
  const list = await client.listTools(); assert.equal(list.tools.length, 20);
  assert(list.tools.some(tool => tool.name === 'pty_send')); assert(list.tools.some(tool => tool.name === 'agent_stop'));
  assert(!list.tools.some(tool => ['agent_execution', 'agent_execution_roots'].includes(tool.name))); unchanged();
});

test('eleven ordinary native terminal deliveries proceed while old tracking is locked and corrupt', { skip }, async t => {
  const unchanged = heldGraph(), client = await connection(t), names = Array.from({ length: 11 }, (_, i) => `unlocked-${i}`);
  t.after(() => { for (const session_id of names) closeSession(session_id); });
  for (const name of names) { const opened = await client.callTool({ name: 'pty_open', arguments: { name, shell: '/bin/sh' } }); assert(!opened.isError); }
  const results = await Promise.all(names.map((session_id, i) => client.callTool({ name: 'pty_send', arguments: { session_id, text: `printf 'delivery_${i}\\n'`, mark: false } })));
  assert(results.every(result => !result.isError && result.structuredContent?.mode === 'sent'));
  for (let i = 0; i < names.length; i++) {
    const deadline = performance.now() + 3000; let seen = false;
    do {
      const result = await client.callTool({ name: 'pty_read', arguments: { session_id: names[i] } });
      seen = result.content.some(item => item.type === 'text' && item.text.includes(`delivery_${i}`));
      if (!seen) await new Promise(resolve => setTimeout(resolve, 10));
    } while (!seen && performance.now() < deadline);
    assert(seen, names[i]);
  }
  unchanged();
});

test('direct stop forwards leaves before parents while the execution graph is unavailable', { skip }, async t => {
  const unchanged = heldGraph(), keys = [], client = await connection(t, {
    children: () => [{ parent: 'root', child: 'middle' }, { parent: 'middle', child: 'leaf' }],
    currentLaunchId: () => null, sendKey: session_id => { keys.push(session_id); return { session_id, outcome: 'accepted' }; },
  });
  const result = await client.callTool({ name: 'agent_stop', arguments: { session_id: 'root' } });
  assert(!result.isError); assert.equal(result.structuredContent.status, 'sent'); assert.deepEqual(keys, ['leaf', 'middle', 'root']); unchanged();
});

test('a lineage read failure still forwards the explicit stop command', { skip }, async t => {
  const keys = [], client = await connection(t, { children: () => { throw new Error('tracking unavailable'); },
    currentLaunchId: () => null, sendKey: session_id => { keys.push(session_id); return { session_id, outcome: 'accepted' }; } });
  const result = await client.callTool({ name: 'agent_stop', arguments: { session_id: 'root' } });
  assert.deepEqual(keys, ['root']); assert.equal(result.structuredContent.targets[0].status, 'sent');
});

test('legacy native MCP entry no longer loads a tracking provider or enrolls an actor', { skip }, async t => {
  const unchanged = heldGraph(), client = new Client({ name: 'delivery-entry', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--execution-interrupt', '--state-root', ensureStateRoot(), '--socket', SOCK, '--steer-provider', '/synthetic/missing-provider.mjs'] });
  await client.connect(transport); t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 20); unchanged();
});

test('all parent hook entry modes call the ordinary provider without graph admission', { skip }, t => {
  const unchanged = heldGraph(), root = mkdtempSync(join(tmpdir(), 'unlocked-hooks-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = join(root, 'provider.mjs'), receipt = join(root, 'receipt.json');
  writeFileSync(provider, `import {writeFileSync} from 'node:fs';\nconst run=(profile)=>{if(profile.delivery_admission)throw new Error('tracking admission');writeFileSync(${JSON.stringify(receipt)},JSON.stringify({id:profile.id,admission:false}));};\nexport const runClaudeHookMain=run,runCursorHookMain=run,runCodexHookMain=run;\n`);
  for (const mode of ['claude-hook', 'cursor-hook', 'codex-hook']) {
    const result = spawnSync(process.execPath, [entry, '--execution-interrupt', '--state-root', ensureStateRoot(), '--socket', SOCK, '--steer-provider', provider, '--mode', mode, '--codex-home', root, '--hook-directory', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { id: 'aiterm', admission: false });
  }
  unchanged();
});

test('native hook migration installs standard parent hooks without tracking admission', { skip }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'standard-hooks-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [], scope = { state_root: join(root, 'state'), multiplexer: { kind: 'socket', key: join(root, 'socket') } };
  const providerFile = join(root, 'provider.mjs'), provider = {
    removeClaudeParentHooks: profile => { events.push(['remove-claude', profile.hooks.claude]); return 'removed'; },
    removeCursorParentHooks: profile => { events.push(['remove-cursor', profile.hooks.cursor]); return 'removed'; },
    mergeClaudeParentHooks: (profile, file, runtime) => { assert.equal(profile.delivery_admission, undefined); events.push(['claude', runtime.script]); return 'configured'; },
    mergeCursorParentHooks: (profile, file, runtime) => { assert.equal(profile.delivery_admission, undefined); events.push(['cursor', runtime.script]); return 'configured'; },
    configureCodexSteer: async (profile, action, runtime) => { assert.equal(profile.delivery_admission, undefined); assert.equal(runtime.hookCommand, undefined); events.push(['codex', runtime.hook]); return { status: 'ready' }; },
  };
  const result = await configureNativeExecutionHooks(root, { registration: { command: process.execPath, args: [entry, '--execution-interrupt', '--state-root', scope.state_root, '--socket', scope.multiplexer.key, '--steer-provider', providerFile] }, expectedScope: scope, providerFile, provider, codexBinary: process.execPath });
  assert.equal(result.relation_scope, 'untracked'); assert(result.registration.args[0].endsWith('/index.js'));
  assert.deepEqual(events.filter(x => x[0].startsWith('remove-')).map(x => x[1]), ['execution-native-server.js', 'execution-native-server.js']);
  for (const name of ['claude', 'cursor', 'codex']) assert(events.find(x => x[0] === name)[1].endsWith(`/${name}-parent-hook.js`));
});
