// Desktopと公式App Serverを結ぶ共通のJSONL中継。OS adapterは接続先とprocess終了だけを供給する。
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type WebSocket from "ws";

export async function relayCodexStdio(adapter: {
  socket: () => WebSocket;
  alive: () => boolean;
  stop: () => Promise<void>;
  connected?: () => void;
}): Promise<void> {
  let socket: WebSocket | undefined;
  let ending = false;
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= adapter.stop();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // 接続準備中に届いたinitializeとEOFも同じ順序で扱う。
  const lines = input[Symbol.asyncIterator]();
  const end = () => { ending = true; void stop().catch(error => { failure = error; }); socket?.terminate(); input.close(); process.stdin.destroy(); };
  const outputFailed = (error: Error) => { failure = error; end(); };
  process.stdout.once("error", outputFailed);
  const drain = () => socket?.resume();
  process.stdout.on("drain", drain);
  try {
    const deadline = Date.now() + 15_000;
    while (!ending) {
      if (!adapter.alive()) throw new Error("公式App Serverが起動中に終了しました");
      socket = adapter.socket();
      const candidate = socket;
      let opened = false;
      candidate.once("open", () => { opened = true; });
      // upgradeと最初のframeが同じ受信単位でも、openのawaitより先に受け付ける。
      candidate.on("message", (data, binary) => {
        if (binary) { failure = new Error("公式App Serverから予期しないバイナリ応答を受信しました"); end(); return; }
        if (!process.stdout.write(data.toString() + "\n")) candidate.pause();
      });
      candidate.on("error", error => { if (opened) { failure = error; end(); } });
      candidate.on("close", () => {
        if (opened && !ending) { failure = new Error("公式App Serverとの接続が終了しました"); end(); }
      });
      try { await once(socket, "open"); break; }
      catch (error) {
        socket.on("error", () => {}); socket.terminate();
        if (ending) break;
        // 公式受付の作成だけを待つ。送信済みRPCは再送しない。
        if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error;
        await delay(25);
      }
    }
    if (ending) { if (failure) throw failure; return; }
    const connected = socket!;
    adapter.connected?.();
    for await (const line of lines) await new Promise<void>((resolve, reject) => connected.send(line, error => error ? reject(error) : resolve()));
    if (failure) throw failure;
  } finally {
    end(); await stop(); process.stdout.off("error", outputFailed); process.stdout.off("drain", drain);
  }
}
