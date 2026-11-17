import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeAgentMetadata, agentsDir, agentEventPath } from '../dist/agent-shared.js';
import { createAitermServer } from '../dist/index.js';

const launch_id = 'd'.repeat(32);
const meta = { aiterm_session: 'lock-fixture', kind: 'cursor', launch_id, event_file: agentEventPath('lock-fixture', launch_id), created_at: '', cwd: null,
  vendor_session_id: null, hook_route: 'shared_cursor_home', completion_route: 'cursor_transcript', cursor_home: '/tmp/cursor-home',
  agent_role: 'subagent', delegation_allowed: true, parent_session_id: 'parent', delegation_depth: 1, lineage: 'host-root>cursor:lock-fixture' };
const key = 'launcher-secret-key-0123456789';
const lockFile = path.join(agentsDir(), `${meta.aiterm_session}.${meta.launch_id}.configuration-lock.json`);

test('a locked seat refuses AI model/effort changes and still takes the launcher key, fast and plain text', async () => {
  writeAgentMetadata(meta);
  const server = createAitermServer(), client = new Client({ name: 'configuration-lock', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = (name, args) => client.callTool({ name, arguments: { session_id: meta.aiterm_session, ...args } });
  const locked = r => r.isError && /AGENT_CONFIGURATION_LOCKED/.test(r.content[0].text);
  try {
    assert.equal(locked(await call('pty_send', { text: '/model sonnet' })), false, 'unlocked seat: not this guard');
    const set = await call('agent_configure', { configuration_lock: 'lock', configuration_lock_key: key });
    assert.equal(set.structuredContent?.configuration_lock, 'locked', JSON.stringify(set));
    assert.doesNotMatch(fs.readFileSync(lockFile, 'utf8'), new RegExp(key), 'only the hash is stored');
    for (const args of [{ model: 'sonnet' }, { reasoning_effort: 'high' }, { model: 'sonnet', configuration_lock_key: 'x'.repeat(20) }]) {
      const r = await call('agent_configure', args);
      assert.ok(locked(r)); assert.equal(r._meta['aiterm/configure_error'].code, 'AGENT_CONFIGURATION_LOCKED');
      assert.equal(r.structuredContent.outcome, 'not_applied');
    }
    for (const text of ['/model sonnet', '  /effort high', '/models', 'x'.repeat(0) + '/reasoning low'])
      for (const force of [false, true]) assert.ok(locked(await call('pty_send', { text, force })), text);
    assert.ok(locked(await call('pty_send', { text: 'hello', preface: '/model opus' })));
    for (const k of ['M-p', 'Alt+P', 'a-p']) assert.ok(locked(await call('pty_key', { key: k })), k);
    assert.equal(locked(await call('pty_send', { text: 'hello /model' })), false);
    assert.equal(locked(await call('pty_send', { text: '/fast on' })), false, 'fast is out of scope');
    assert.equal(locked(await call('pty_key', { key: 'Enter' })), false);
    assert.equal(locked(await call('agent_configure', { fast: true })), false);
    assert.equal(locked(await call('agent_configure', { model: 'sonnet', configuration_lock_key: key })), false, 'launcher key passes the guard');
    assert.ok(locked(await call('agent_configure', { configuration_lock: 'unlock', configuration_lock_key: 'y'.repeat(20) })));
    assert.equal(fs.existsSync(lockFile), true);
    assert.equal((await call('agent_configure', { configuration_lock: 'unlock', configuration_lock_key: key })).structuredContent.configuration_lock, 'unlocked');
    assert.equal(fs.existsSync(lockFile), false);
    assert.equal(locked(await call('agent_configure', { model: 'sonnet' })), false);
    const invalid = await call('agent_configure', { configuration_lock: 'lock', configuration_lock_key: 'short' });
    assert.match(invalid.content[0].text, /CONFIGURATION_LOCK_KEY_INVALID/);
  } finally { await client.close(); await server.close(); }
});
