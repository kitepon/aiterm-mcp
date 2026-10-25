import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
import { executionStoreDirectory } from '../dist/execution-store.js';

// This file's seat-env owns an empty state/socket scope. Never bootstrap a
// server, CLI or PTY: the actual native listing must encounter ENOENT.
test('native SDK stop is idle before any tmux server or socket has ever existed', {
  skip: process.platform === 'win32' ? 'native socket entry is POSIX-only' : false, timeout: 15000,
}, async t => {
  const scope = localParentWorkerRuntime.scope();
  assert.equal(scope.multiplexer.kind, 'socket');
  const socket = scope.multiplexer.key;
  const graph = join(executionStoreDirectory(scope.state_root, scope.multiplexer), 'relations.json');
  assert.equal(existsSync(socket), false); assert.equal(existsSync(graph), false);
  const require = createRequire(import.meta.url);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../dist/execution-native-server.js', import.meta.url)), '--execution-interrupt',
      '--state-root', scope.state_root, '--socket', socket, '--steer-provider', require.resolve('aiterm-steer-delivery')],
    env: Object.fromEntries(Object.entries(process.env).filter(([,value]) => value !== undefined)), stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'own-cold-stop-fixture', version: 'test' });
  t.after(async () => { await client.close(); await transport.close(); });
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.equal(names.length, 20); // 19 public tools plus the .17 direct leaf stop.
  assert.ok(names.includes('agent_goal')); assert.ok(names.includes('agent_stop'));
  assert.equal(names.includes('agent_execution'), false); assert.equal(names.includes('agent_execution_roots'), false);
  const result = await client.callTool({ name: 'agent_stop', arguments: { session_id: 'cold-never-started' } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { session_id: 'cold-never-started', status: 'idle',
    targets: [{ session_id: 'cold-never-started', status: 'idle' }] });
  assert.equal(existsSync(socket), false, 'stop must not bootstrap a server');
  assert.equal(existsSync(graph), false, 'cold stop must not checkpoint a new graph');
  assert.equal(stderr, '');
});
