// gpt-connectorのWindows実装をMIT条件で移植。実行時の外部製品依存は持たない。
// Windowsの起動processと認証付きloopback接続を所有する。JSON-RPC本文は変更しない。
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { ensurePrivateDirectory, makeFilePrivate } from "./windows-codex-state.js";
import { readWindowsProcesses, type WindowsRelay } from "./windows-codex-connection.js";

export function windowsServerArguments(args: string[]): string[] | null {
  let server = false;
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["-c", "--config", "--enable", "--disable"].includes(arg)) { result.push(arg, args[++i]!); continue; }
    if (/^(?:--config=|--enable=|--disable=|-c.)/.test(arg)) { result.push(arg); continue; }
    if (!server) {
      if (arg !== "app-server") return null;
      server = true; result.push(arg); continue;
    }
    if (["proxy", "daemon", "start", "stop", "status", "generate-ts", "generate-json-schema", "--help", "-h", "--version", "-V"].includes(arg)) return null;
    if (arg === "--stdio" || arg === "--listen=stdio://") continue;
    if (arg === "--listen") {
      if (args[++i] !== "stdio://") throw new Error("stdio以外の接続指定は変更できません");
      continue;
    }
    if (arg.startsWith("--listen=") || arg.startsWith("--ws-")) throw new Error("既存の接続・認証指定は変更できません");
    result.push(arg);
  }
  return server ? result : null;
}

export async function runWindowsCodexRelay(binary: string, root: string, args: string[]): Promise<number> {
  const serverArgs = windowsServerArguments(args);
  if (!serverArgs) {
    const child = spawn(binary, args, { stdio: "inherit", windowsHide: true });
    return (await once(child, "close"))[0] ?? 1;
  }
  const directory = join(root, randomUUID());
  ensurePrivateDirectory(directory);
  const file = join(directory, "connection.json");
  const tokenFile = join(directory, "token");
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenFile, token, { flag: "wx" }); makeFilePrivate(tokenFile);
  // OSが割り当てた空きportを使い、取得競合は公式serverの起動失敗として明示する。
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const endpoint = `ws://127.0.0.1:${port}`;
  const child = spawn(binary, [...serverArgs, "--listen", endpoint, "--ws-auth", "capability-token", "--ws-token-file", tokenFile], {
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  let failed: Error | undefined;
  child.on("error", error => { failed = error; });
  // WebSocketの定型起動案内だけを除き、公式CLIの診断はDesktopへそのまま返す。
  const diagnostics = createInterface({ input: child.stderr });
  diagnostics.on("line", line => {
    if (!/^(?:\s*|codex app-server \(WebSockets\)| {2}(?:listening on:|readyz:|healthz:|note:).*)$/.test(line)) process.stderr.write(line + "\n");
  });
  let socket: WebSocket | undefined;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  let ending = false;
  const stop = () => { ending = true; child.kill(); socket?.terminate(); input.close(); process.stdin.destroy(); };
  input.once("close", stop);
  process.stdout.once("error", stop);
  try {
    const deadline = Date.now() + 15_000;
    while (!socket) {
      if (failed || child.exitCode !== null || child.signalCode !== null) throw new Error("公式Codexの起動に失敗しました", { cause: failed });
      const candidate = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 1_000 });
      try { await once(candidate, "open"); socket = candidate; }
      catch (error) {
        candidate.on("error", () => {}); candidate.terminate();
        if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED" || Date.now() >= deadline) throw error;
        await delay(50);
      }
    }
    const server = readWindowsProcesses().find(row => row.pid === child.pid);
    if (!server) throw new Error("公式Codexのprocess情報がありません");
    const record: WindowsRelay = { schema: "aiterm.windows-relay.v1", serverPid: server.pid, serverStarted: server.started, binary, endpoint };
    writeFileSync(file, JSON.stringify(record), { flag: "wx" }); makeFilePrivate(file);
    const connected = socket;
    connected.on("message", (data, binary) => {
      if (binary) { failed = new Error("公式Codexから予期しないバイナリ応答を受信しました"); stop(); return; }
      if (!process.stdout.write(data.toString() + "\n")) connected.pause();
    });
    process.stdout.on("drain", () => connected.resume());
    connected.on("error", () => { failed = new Error("公式Codexとの接続に失敗しました"); stop(); });
    connected.on("close", () => { if (!ending) { failed = new Error("公式Codexとの接続が終了しました"); stop(); } });
    // initializeが接続準備前に届いても失わないよう、iteratorを接続前から保持する。
    for await (const line of lines) await new Promise<void>((resolve, reject) => connected.send(line, error => error ? reject(error) : resolve()));
    if (failed) throw failed;
    return 0;
  } finally {
    stop(); await exited; diagnostics.close(); rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [binary, root, ...args] = process.argv.slice(2);
  try {
    if (!binary || !root) throw new Error("Windows中継の起動指定がありません");
    process.exitCode = await runWindowsCodexRelay(binary, root, args);
  } catch (error) {
    process.stderr.write(`aiterm-mcp: ${error instanceof Error ? error.message : "Windows中継が失敗しました"}\n`); process.exitCode = 1;
  }
}
