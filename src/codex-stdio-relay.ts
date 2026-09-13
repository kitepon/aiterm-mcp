#!/usr/bin/env node
// DesktopのJSONLと公式App ServerのUnix WebSocketの中継。RPCの内容は変更しない。
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { prepareRelayDirectory } from "./codex-relay-config.js";

export async function runCodexStdioRelay(socketPath: string, serverPid: number): Promise<void> {
  let socket: WebSocket | undefined;
  let ending = false;
  let stopping: Promise<void> | undefined;
  function stopServer(): Promise<void> {
    return stopping ??= (async () => {
      // 公式Unix受付は1回目でturn完了待ち、2回目で終了する。
      for (let i = 0; i < 2; i++) {
        if (process.ppid !== serverPid) return;
        try { process.kill(serverPid, "SIGTERM"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
        if (i === 0) await delay(100);
      }
    })();
  }
  async function connectDuringStartup(): Promise<WebSocket> {
    const deadline = Date.now() + 15_000;
    while (true) {
      if (process.ppid !== serverPid) throw new Error("公式App Serverが起動中に終了しました");
      const candidate = new WebSocket("ws://localhost/rpc", {
        createConnection: () => createConnection(socketPath), handshakeTimeout: 10_000, perMessageDeflate: false,
      });
      try { await once(candidate, "open"); return candidate; }
      catch (error) {
        candidate.on("error", () => {});
        candidate.terminate();
        // exec直後のsocket作成だけを待つ。送信済みRPCは再送しない。
        if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error;
        await delay(25);
      }
    }
  }
  try {
    socket = await connectDuringStartup();
    const connected = socket;
    connected.on("message", (data, binary) => {
      if (binary) {
        process.stderr.write("aiterm-relay: 予期しないバイナリ応答\n"); process.exitCode = 1;
        void stopServer(); connected.terminate(); return;
      }
      if (!process.stdout.write(`${data.toString()}\n`)) connected.pause();
    });
    process.stdout.on("drain", () => connected.resume());
    connected.on("error", () => {
      process.stderr.write("aiterm-relay: 通信に失敗しました\n"); process.exitCode = 1; void stopServer();
    });
    connected.on("close", () => {
      if (!ending) { process.stderr.write("aiterm-relay: 公式App Serverとの接続が終了しました\n"); process.exitCode = 1; }
      process.stdin.destroy();
    });
    process.stdout.on("error", () => { ending = true; void stopServer(); connected.terminate(); process.stdin.destroy(); });
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      await new Promise<void>((resolve, reject) => connected.send(line, error => error ? reject(error) : resolve()));
    }
    ending = true;
    await stopServer();
    connected.terminate();
  } catch (error) {
    process.stderr.write(`aiterm-relay: 中継失敗: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    await stopServer();
    socket?.terminate();
    process.stdin.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [socket, pid] = process.argv.slice(2);
  if (socket === "--prepare") {
    try {
      if (process.platform === "win32") throw new Error("WindowsのAF_UNIX中継は未対応です");
      if (!pid || Buffer.byteLength(`${pid}/9999999999.sock`) >= 104) throw new Error("socketのpathが長すぎます");
      prepareRelayDirectory(pid);
    } catch (error) { process.stderr.write(`aiterm-relay: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
  } else if (!socket || !/^\d+$/.test(pid ?? "") || Number(pid) <= 1 || Number(pid) !== process.ppid) {
    process.stderr.write("aiterm-relay: 親processの指定が不正です\n"); process.exitCode = 2;
  } else await runCodexStdioRelay(socket, Number(pid));
}
