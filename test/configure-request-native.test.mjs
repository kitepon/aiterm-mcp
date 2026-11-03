import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { core, skipAgentDone, withFakeCodexHome, makeFakeCodexRateLimitTuiBin, removeFakeCodexRateLimitTuiBin } from './core-agent-support.mjs';
import { configurationRequestDigest } from '../dist/configure-request.js';
import { createAitermServer } from '../dist/index.js';

test('tracked MCP configure binds expected launch and persists success/unknown without a second native selection', {
  skip: process.platform === 'win32' ? 'durable tracked configuration is POSIX-only' : skipAgentDone,
}, async t => {
  const server = createAitermServer(), client = new Client({ name: 'tracked-config-native', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  for (const mode of ['recover', 'catalog-label-wrong-result']) {
    const savedBin = process.env.CODEX_BIN, fake = makeFakeCodexRateLimitTuiBin(3, mode);
    process.env.CODEX_BIN = fake.bin;
    let session;
    try {
      await withFakeCodexHome(async () => {
        [session] = core.openAgent('codex', { session_name: `tracked_${randomUUID().slice(0, 8)}`, agent_done: true });
        const launch = core.observeSession(session).launch_id;
        const settings = { model: mode === 'recover' ? 'gpt-5.6-sol' : 'account-model-42', reasoning_effort: 'low' };
        const request = { id: randomUUID(), launch_id: launch, digest: configurationRequestDigest(settings) };
        const inputs = () => fs.readFileSync(fake.input, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const before = inputs();
        const stale = await client.callTool({ name: 'agent_configure', arguments: { session_id: session, request: { ...request, id: randomUUID(), launch_id: 'f'.repeat(32) }, ...settings } });
        assert.equal(stale.isError, true); assert.equal(stale.structuredContent.outcome, 'not_applied');
        assert.equal(stale.structuredContent.later_effect, 'excluded'); assert.deepEqual(inputs(), before);
        const result = await client.callTool({ name: 'agent_configure', arguments: { session_id: session, request, ...settings } });
        assert.equal(result.structuredContent.outcome, mode === 'recover' ? 'applied' : 'outcome_unknown');
        assert.equal(result.structuredContent.later_effect, 'unconfirmed', 'native receipt is not proof that no issued input remains');
        assert.equal(result.structuredContent.request_state, 'terminal');
        assert.equal(core.observeSession(session).launch_id, launch);
        const selections = inputs().filter(entry => entry.phase === 'effort' && entry.text === '1').length;
        assert.equal(selections, 1);
        const query = await client.callTool({ name: 'agent_configure', arguments: { action: 'reconcile', session_id: session, request } });
        assert.equal(query.structuredContent.terminal_at, result.structuredContent.terminal_at);
        const duplicate = await client.callTool({ name: 'agent_configure', arguments: { session_id: session, request, ...settings } });
        assert.equal(duplicate.structuredContent.outcome, result.structuredContent.outcome);
        assert.equal(inputs().filter(entry => entry.phase === 'effort' && entry.text === '1').length, selections);
      });
    } finally {
      if (session) core.closeSession(session);
      if (savedBin === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = savedBin;
      removeFakeCodexRateLimitTuiBin(fake);
    }
  }
});
