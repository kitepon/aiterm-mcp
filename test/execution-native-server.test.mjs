import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeExecutionArguments, createNativeDeliveryServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';

test('native stdio args require explicit opt-in, exact absolute scope and explicit candidate provider before any runtime construction', () => {
  const args = ['--execution-interrupt', '--state-root', '/synthetic/state', '--socket', '/synthetic/socket', '--steer-provider', '/synthetic/provider.mjs'];
  assert.deepEqual(parseNativeExecutionArguments(args), { mode: 'mcp', codexHome: undefined, hookDirectory: undefined, expectedScope: { state_root: '/synthetic/state', multiplexer: { kind: 'socket', key: '/synthetic/socket' } }, providerFile: '/synthetic/provider.mjs' });
  for (const bad of [[], args.slice(1), args.slice(0,-2), args.map(value => value === '/synthetic/state' ? 'relative' : value), [...args, '--unknown']])
    assert.throws(() => parseNativeExecutionArguments(bad));
});
test('MCP and hook command variants share one explicit scope/provider prefix without treating hook JSON as MCP stdio', () => {
  const prefix = ['--execution-interrupt','--state-root','/synthetic/state','--socket','/synthetic/socket','--steer-provider','/synthetic/provider.mjs'];
  for (const mode of ['mcp','claude-hook','cursor-hook']) {
    const value = parseNativeExecutionArguments([...prefix,'--mode',mode]); assert.equal(value.mode, mode);
    assert.equal(value.expectedScope.state_root, '/synthetic/state'); assert.equal(value.providerFile, '/synthetic/provider.mjs');
  }
  assert.throws(() => parseNativeExecutionArguments([...prefix,'--mode','codex-hook']));
  const codex = parseNativeExecutionArguments([...prefix,'--mode','codex-hook','--codex-home','/synthetic/codex','--hook-directory','/synthetic/hook']);
  assert.equal(codex.codexHome, '/synthetic/codex'); assert.equal(codex.hookDirectory, '/synthetic/hook');
  assert.throws(() => parseNativeExecutionArguments([...prefix,'--mode','unknown']));
});

// The two exports BellTeam's aiterm-hooks.mjs still reads after the execution store was removed (0.70.104, a532b2 1b).
test('the live exports answer: the worker scope, and a delivery server with agent_stop and no execution tools', async () => {
  const scope = localParentWorkerRuntime.scope();
  assert.ok(scope.state_root.startsWith('/') || /^[A-Za-z]:/.test(scope.state_root));
  assert.ok(['socket', 'namespace'].includes(scope.multiplexer.kind) && scope.multiplexer.key.length > 0);
  assert.deepEqual(Object.keys(localParentWorkerRuntime), ['scope']);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createNativeDeliveryServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'live-exports', version: 'test' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes('agent_stop'));
    assert.ok(!names.some(name => name === 'agent_execution' || name === 'agent_execution_roots'));
  } finally { await client.close(); await server.close(); }
});
