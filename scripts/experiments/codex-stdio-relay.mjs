// DesktopのJSONLと公式App ServerのWebSocketを変換する試作。
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import WebSocket from 'ws';

const [socketPath, serverPidText] = process.argv.slice(2);
const serverPid = Number(serverPidText);
let socket;
let ending = false;
let stopping;

function stopServer() {
  if (stopping) return stopping;
  stopping = (async () => {
    // 本人の直接の親へ送る。公式Unix transportは1回目で完了待ち、2回目で終了する。
    if (process.ppid !== serverPid) return;
    process.kill(serverPid, 'SIGTERM');
    await delay(100);
    if (process.ppid === serverPid) process.kill(serverPid, 'SIGTERM');
  })();
  return stopping;
}

async function connectDuringStartup() {
  const deadline = Date.now() + 15_000;
  while (true) {
    if (process.ppid !== serverPid) throw new Error('公式App Serverが起動中に終了しました');
    const candidate = new WebSocket('ws://localhost/rpc', {
      createConnection: () => createConnection(socketPath),
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
    });
    try {
      await once(candidate, 'open');
      return candidate;
    } catch (error) {
      candidate.on('error', () => {});
      candidate.terminate();
      // exec後の受付開始だけを待つ。送信済みRPCや認証の再試行はしない。
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) || Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
}

try {
  socket = await connectDuringStartup();
  socket.on('message', (data, binary) => {
    if (binary) {
      process.stderr.write('aiterm-relay: 予期しないバイナリ応答\n');
      process.exitCode = 1;
      void stopServer();
      socket.terminate();
      return;
    }
    if (!process.stdout.write(`${data.toString()}\n`)) socket.pause();
  });
  process.stdout.on('drain', () => socket.resume());
  socket.on('error', error => {
    process.stderr.write(`aiterm-relay: 通信失敗: ${error.code ?? error.name}\n`);
    process.exitCode = 1;
    void stopServer();
  });
  socket.on('close', () => {
    if (!ending) {
      process.stderr.write('aiterm-relay: 公式App Serverとの接続が終了しました\n');
      process.exitCode = 1;
    }
    process.stdin.destroy();
  });
  process.stdout.on('error', () => {
    ending = true;
    void stopServer();
    socket.terminate();
    process.stdin.destroy();
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    await new Promise((resolve, reject) => socket.send(line, error => error ? reject(error) : resolve()));
  }
  ending = true;
  // Desktopのstdio終了を公式サーバーの終了へ伝える。
  await stopServer();
  socket.terminate();
} catch (error) {
  process.stderr.write(`aiterm-relay: 中継失敗: ${error.code ?? error.name}: ${error.message}\n`);
  process.exitCode = 1;
  await stopServer();
  socket?.terminate();
  process.stdin.destroy();
}
