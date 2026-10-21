import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createExecutionToolHandlers, registerExecutionTools } from '../dist/execution-tools.js';
import { EXECUTION_SOURCE_META_KEY, EXECUTION_ERROR_META_KEY, executionHostSourceFromMeta } from '../dist/execution-wire.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const D = { session_id: 'bot-d', launch_id: 'd'.repeat(32) };
const point = launch => ({ launch, boundary: null });
const meta = source => ({ [EXECUTION_SOURCE_META_KEY]: { schema: 'aiterm.execution-source.v1', source } });
const input = (id, source = A) => ({ action: 'register', source_session_id: source.session_id,
  reservation: { schema: 'aiterm.execution-reservation.v1',
    request: { kind: 'delivery', delivery_id: id, target_session_id: B.session_id },
    source: point(source), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
function fixture(clientName = 'bellteam') {
  const live = new Map([A, B, D].map(value => [value.session_id, value]));
  const runtime = createExecutionRuntime({
    sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    async observeSession(session_id) {
      await Promise.resolve();
      const launch = live.get(session_id);
      return { schema: 'aiterm.pty-observe-result.v1', session_id, exists: !!launch, launch_id: launch?.launch_id ?? null };
    },
    async observeDone() { throw new Error('unused fixture'); },
  });
  const service = new ExecutionService(new FileExecutionStore(mkdtempSync(join(tmpdir(), 'execution-source-'))), runtime);
  const options = { sourceContext: extra => executionHostSourceFromMeta(extra._meta, clientName) };
  const handlers = createExecutionToolHandlers(service, options);
  return { live, runtime, service, options, handlers };
}
test('host context, claim, source seat and current runtime launch must agree before generation adoption', async () => {
  const f = fixture();
  const result = await f.handlers.agent_execution(input('ab'), { _meta: meta(point(A)) });
  assert.equal(result.structuredContent.source.status, 'verified');
  assert.deepEqual(result.structuredContent.relation.source, point(A));
  const conflict = await f.handlers.agent_execution(input('conflict'), { _meta: meta(point(D)) });
  assert.equal(conflict._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_STALE_GENERATION');
  const wrongSeat = { ...input('wrong-seat'), source_session_id: D.session_id };
  assert.equal((await f.handlers.agent_execution(wrongSeat, { _meta: meta(point(A)) }))._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_INVALID');
  f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) });
  const stale = await f.handlers.agent_execution(input('stale'), { _meta: meta(point(A)) });
  assert.equal(stale._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_STALE_GENERATION');
});
test('missing or explicitly null host source never falls back to claims or the host stdio environment', async () => {
  const f = fixture();
  for (const [id, extra] of [['missing', {}], ['null', { _meta: meta(null) }]]) {
    const result = await f.handlers.agent_execution(input(id), extra);
    assert.equal(result.structuredContent.source.status, 'unknown');
    assert.equal(result.structuredContent.relation.source, null);
    let effects = 0;
    await assert.rejects(f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: input(id).reservation.request }, 'send', async () => {
      effects++; throw new Error('must not execute');
    }), value => value.code === 'EXECUTION_UNCONFIRMED');
    assert.equal(effects, 0);
  }
});
test('host metadata is detached at ingress and concurrent requests do not share mutable source context', async () => {
  const f = fixture(), original = meta(point(A));
  const first = f.handlers.agent_execution(input('from-a'), { _meta: original });
  original[EXECUTION_SOURCE_META_KEY].source.launch = D;
  const second = f.handlers.agent_execution(input('from-d', D), { _meta: meta(point(D)) });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.structuredContent.relation.source.launch), [A, D]);
});
test('direct CLI transport cannot replace its environment source with host metadata', async () => {
  const f = fixture('codex');
  const refused = await f.handlers.agent_execution(input('forged', D), { _meta: meta(point(D)) });
  assert.equal(refused._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_UNSUPPORTED');
  assert.equal((await f.handlers.agent_execution(input('direct'))).structuredContent.source.status, 'verified');
  const raw = createExecutionToolHandlers(f.service);
  assert.equal((await raw.agent_execution(input('unconfigured'), { _meta: meta(point(A)) }))._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_UNSUPPORTED');
});
test('the actual in-memory MCP handler receives host metadata outside the register arguments', async t => {
  const f = fixture(), server = new McpServer({ name: 'synthetic-aiterm', version: '0.0.0' });
  registerExecutionTools(server, f.service, { sourceContext: extra => executionHostSourceFromMeta(extra._meta, server.server.getClientVersion()?.name) });
  const client = new Client({ name: 'bellteam', version: '0.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(left); await client.connect(right);
  const result = await client.callTool({ name: 'agent_execution', arguments: input('sdk-host'), _meta: meta(point(A)) });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.source.status, 'verified');
  assert.equal(result.structuredContent.source.point.boundary, null);
});
