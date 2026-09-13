import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

for (const mode of ['startup-eof', 'binary', 'immediate-binary']) test(`共通中継: ${mode === 'startup-eof' ? '接続前の入力とEOFを順序どおり処理する' : mode === 'binary' ? '不正な応答は失敗として終了する' : '接続通知と同時の応答も受信する'}`, { timeout: 10_000 }, async t => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', verifyClient: (_info, done) => setTimeout(() => done(true), 60) });
  await once(server, 'listening');
  const messages = [];
  server.on('connection', socket => {
    socket.on('message', data => messages.push(data.toString()));
    if (mode === 'binary') socket.send(Buffer.from('不正な応答'));
  });
  const module = new URL('../dist/codex-relay-stdio.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import WebSocket from 'ws';
    import { relayCodexStdio } from ${JSON.stringify(module)};
    let stopped = 0;
    try {
      await relayCodexStdio({ alive: () => true,
        socket: () => {
          const socket = new WebSocket('ws://127.0.0.1:${server.address().port}');
          // upgradeと最初のframeが一度に届く順序をOSによらず再現する。
          if (${JSON.stringify(mode)} === 'immediate-binary') socket.once('open', () => socket.emit('message', Buffer.from('不正な応答'), true));
          return socket;
        },
        stop: async () => { stopped++; },
      });
    } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
    if (stopped !== 1) process.exitCode = 2;
  `], { windowsHide: true });
  const exited = once(child, 'close');
  let error = '';
  child.stderr.on('data', data => { error += data; });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  if (mode === 'startup-eof') child.stdin.end('{"id":1,"method":"initialize"}\n');
  const [code] = await exited;
  assert.equal(code, mode === 'startup-eof' ? 0 : 1, error);
  if (mode === 'startup-eof') assert.deepEqual(messages, ['{"id":1,"method":"initialize"}']);
  else assert.match(error, /バイナリ応答/);
});
