import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { verifyCodexParent, submitCodexParentAnswer } from '../dist/codex-parent-receiver.js';
import { liveRelay } from '../dist/setup-codex-relay.js';

const parent = { thread_id: '11111111-2222-4333-8444-555555555555', codex_home: '/unused' };
async function receiver(t, mode = 'normal') {
  const root = mkdtempSync('/tmp/aiterm-rpc-');
  chmodSync(root, 0o700);
  const socket = join(root, `${process.pid}.sock`);
  const http = createServer();
  const ws = new WebSocketServer({ server: http });
  const requests = [];
  ws.on('connection', client => client.on('message', data => {
    const call = JSON.parse(data.toString()); requests.push(call);
    if (!call.id) return;
    const send = result => client.send(JSON.stringify({ id: call.id, result }));
    if (call.method === 'initialize') send({ userAgent: 'fixture' });
    else if (call.method === 'thread/loaded/list') send({ data: mode === 'unloaded' ? [] : [parent.thread_id], nextCursor: null });
    else if (call.method === 'thread/read') send({ thread: { id: parent.thread_id, source: mode === 'native' ? { subAgent: { thread_spawn: {} } } : 'vscode' } });
    else if (call.method === 'turn/start') {
      if (mode === 'timeout') return;
      if (mode === 'disconnect') { client.terminate(); return; }
      if (mode === 'reject') { client.send(JSON.stringify({ id: call.id, error: { code: -32600, message: '入力が上限を超えました' } })); return; }
      if (mode === 'no-result') { client.send(JSON.stringify({ id: call.id })); return; }
      if (mode === 'bad-turn') { send({ turn: {} }); return; }
      // 追加接続に来たserver requestを、同じIDの応答と取り違えない。
      client.send(JSON.stringify({ id: call.id, method: 'item/commandExecution/requestApproval', params: {} }));
      send({ turn: { id: 'active-or-new-turn' } });
    } else throw new Error(`想定外のRPC: ${call.method}`);
  }));
  http.listen(socket); await once(http, 'listening'); chmodSync(socket, 0o600);
  t.after(async () => { for (const client of ws.clients) client.terminate(); await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => http.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  return { runtime: { socket_path: socket, timeout_ms: 150 }, requests, socket, root };
}

test('Steer選択時は同じ公式受付へ一度だけ送り、queueやresumeを呼ばない', { skip: process.platform === 'win32' }, async t => {
  const fixture = await receiver(t);
  await verifyCodexParent(parent, fixture.runtime);
  const text = '日本語\n引用符"と\\、🐱'.repeat(5000);
  assert.deepEqual(await submitCodexParentAnswer(parent, 'delivery-correlation', text, fixture.runtime), { queued_submission_id: null });
  const writes = fixture.requests.filter(call => call.method === 'turn/start');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].params, { threadId: parent.thread_id, input: [{ type: 'text', text, text_elements: [] }], clientUserMessageId: 'delivery-correlation' });
  assert(fixture.requests.every(call => call.method && !/queue|resume/.test(call.method)));
});

test('別processにしかないtaskやnative子は子への依頼前に拒否する', { skip: process.platform === 'win32' }, async t => {
  for (const mode of ['unloaded', 'native']) {
    const fixture = await receiver(t, mode);
    await assert.rejects(verifyCodexParent(parent, fixture.runtime), error => error.delivery_code === (mode === 'native' ? 'CODEX_PARENT_UNSUPPORTED' : 'CODEX_PARENT_UNAVAILABLE'));
    assert(!fixture.requests.some(call => call.method === 'turn/start'));
  }
});

test('明確な拒否と送信後の結果不明を区別し、どちらも再送しない', { skip: process.platform === 'win32' }, async t => {
  for (const mode of ['reject', 'timeout', 'disconnect', 'no-result', 'bad-turn']) {
    const fixture = await receiver(t, mode);
    await assert.rejects(submitCodexParentAnswer(parent, 'id', '本文', fixture.runtime), error => error.outcome_unknown === (mode !== 'reject'));
    assert.equal(fixture.requests.filter(call => call.method === 'turn/start').length, 1);
  }
});

test('本人以外に書込可能なsocketには接続しない', { skip: process.platform === 'win32' }, async t => {
  const fixture = await receiver(t);
  chmodSync(fixture.socket, 0o666);
  await assert.rejects(verifyCodexParent(parent, fixture.runtime), error => error.delivery_code === 'CODEX_RELAY_PATH_INVALID');
  assert.equal(fixture.requests.length, 0);
});

test('socketのRPCが通ってもDesktopの公式子processでなければreadyにしない', { skip: process.platform === 'win32' }, async t => {
  const fixture = await receiver(t);
  assert.equal(await liveRelay({ socket_root: fixture.root, binary: '/Applications/Codex.app/Contents/Resources/codex' }), false);
  assert.equal(fixture.requests.length, 0);
});
