import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../dist/psmux-send-worker.js', import.meta.url));
const key = '0123456789abcdef';
const payload = Buffer.from('x'.repeat(255) + 'あ' + 'y'.repeat(42));

async function scenario(mode, guarded = false) {
  const base = guarded ? "namespace__fixture" : "fixture";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'psmux-wire-'));
  const commands = [], received = [], sockets = new Set();
  let sends = 0;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', bytes => {
      input += bytes.toString('utf8');
      const lines = input.split('\n');
      if (lines.length < 3) return;
      socket.removeAllListeners('data');
      assert.equal(lines[0], `AUTH ${key}`);
      let command = lines[1]; commands.push(command.split(' ')[0]);
      let refused = false;
      if (command.startsWith('if-shell ')) {
        const matched = /^if-shell -F '([^']+)' '(send -H -t %1 [0-9a-f ]+)' 'display-message -p AITERM_NATIVE_REFUSED'$/.exec(command);
        assert.ok(matched, command);
        for(const identity of ['pid},100','session_id},$1','session_name},fixture','pane_id},%1','pane_pid},200'])assert.ok(matched[1].includes(identity));
        refused = mode === `native-refuse-${sends + 1}`;
        command = matched[2].replace('send -H -t %1 ', 'send -H ');
      }
      let reply;
      if (command.startsWith('send -H ')) {
        sends++;
        if (refused) reply = 'OK\nAITERM_NATIVE_REFUSED\n';
        else if (mode === `reject-${sends}`) reply = 'OK\nERROR: synthetic command refusal\n';
        else {
          received.push(Buffer.from(command.slice(8).replaceAll(' ', ''), 'hex'));
          reply = 'OK\r\n';
          if(mode === 'registry-replaced') {
            fs.writeFileSync(path.join(directory, `${base}.port`),'1');
            fs.writeFileSync(path.join(directory, `${base}.key`),'ffffffffffffffff');
          }
        }
      } else {
        assert.match(command, /^display-message -p AITERM_PSMUX_SEND_DONE_\d+$/);
        const marker = command.split(' ').at(-1);
        reply = mode === 'wrong-marker' ? `OK\nERROR: ${marker} was not executed\n` : `OK\r\n${marker}\r\n`;
      }
      socket.write(reply.slice(0, 1)); setImmediate(() => socket.end(reply.slice(1)));
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(directory, `${base}.port`), String(server.address().port));
    fs.writeFileSync(path.join(directory, `${base}.key`), key);
    const proof = mode === 'wrong-session' ? '$1\tother\t100\t%1\t200' : mode === 'malformed-native' ? '$1\tfixture\t0\t%1\t200' : '$1\tfixture\t100\t%1\t200';
    const child = spawn(process.execPath, [worker, base, ...(guarded ? [proof] : [])], {
      env: { ...process.env, PSMUX_DATA_DIR: directory }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
    let stderr = ''; child.stdout.resume(); child.stderr.on('data', data => { stderr += data; });
    const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => resolve({ status, signal })); });
    child.stdin.end(payload);
    return { ...await ended, stderr, sends, commands, received: Buffer.concat(received) };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('psmux worker accepts fragmented CRLF protocol replies and preserves UTF-8 across chunks', async () => {
  const result = await scenario('success');
  assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  assert.deepEqual(result.received, payload); assert.equal(result.sends, 2);
  assert.deepEqual(result.commands, ['send', 'send', 'display-message']);
});

for (const rejected of [1, 2]) test(`psmux worker rejects command refusal after AUTH OK at chunk ${rejected}, without another send`, async () => {
  const result = await scenario(`reject-${rejected}`);
  assert.equal(result.status, 1, 'AUTH acceptance is not command acceptance');
  assert.match(result.stderr, /command response was not accepted/);
  assert.equal(result.sends, rejected); assert.deepEqual(result.commands, Array(rejected).fill('send'));
  assert.deepEqual(result.received, payload.subarray(0, rejected === 1 ? 0 : 256));
});

test('psmux worker requires the exact completion reply rather than a marker inside an error', async () => {
  const result = await scenario('wrong-marker');
  assert.equal(result.status, 1); assert.deepEqual(result.received, payload);
  assert.match(result.stderr, /command response was not accepted/);
  assert.deepEqual(result.commands, ['send', 'send', 'display-message']);
});

for(const mode of ['success','registry-replaced']) test(`pinned native worker ${mode} keeps the accepted server and explicit pane for every chunk`,async()=>{
 const result=await scenario(mode,true);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(result.received,payload);assert.deepEqual(result.commands,['if-shell','if-shell','display-message']);
});
for(const rejected of [1,2]) test(`pinned native worker refuses changed native identity at chunk ${rejected} without further input`,async()=>{
 const result=await scenario(`native-refuse-${rejected}`,true);assert.equal(result.status,1);
 assert.match(result.stderr,/command response was not accepted/);assert.equal(result.sends,rejected);
 assert.deepEqual(result.received,payload.subarray(0,rejected===1?0:256));assert.deepEqual(result.commands,Array(rejected).fill('if-shell'));
});
for(const mode of ['wrong-session','malformed-native']) test(`pinned native worker rejects ${mode} before connecting`,async()=>{
 const result=await scenario(mode,true);assert.equal(result.status,1);assert.equal(result.sends,0);assert.deepEqual(result.commands,[]);
});
