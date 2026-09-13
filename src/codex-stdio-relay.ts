#!/usr/bin/env node
// Unix socketとPOSIX signalのadapter。中継するJSONLと終了契約はWindowsと共通。
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { preparePosixRelayLaunch } from "./codex-relay-launcher.js";
import { relayCodexStdio } from "./codex-relay-stdio.js";

export async function runCodexStdioRelay(socketPath: string, serverPid: number): Promise<void> {
  await relayCodexStdio({
    alive: () => process.ppid === serverPid,
    socket: () => new WebSocket("ws://localhost/rpc", {
      createConnection: () => createConnection(socketPath), handshakeTimeout: 10_000, perMessageDeflate: false,
    }),
    stop: async () => {
      // 公式Unix受付は1回目でturn完了待ち、2回目で終了する。
      for (let i = 0; i < 2; i++) {
        if (process.ppid !== serverPid) return;
        try { process.kill(serverPid, "SIGTERM"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
        if (i === 0) await delay(100);
      }
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [socket, pid, ...args] = process.argv.slice(2);
  try {
    if (socket === "--prepare") {
      if (process.platform === "win32") throw new Error("POSIX launcherはこのOSで利用できません");
      if (!pid || args.length < 4) throw new Error("中継の起動指定がありません");
      process.stdout.write(preparePosixRelayLaunch(pid, args[0]!, args[1]!, args[2]!, args[3]!, args.slice(4)));
    } else if (!socket || !/^[1-9][0-9]*$/.test(pid ?? "") || Number(pid) !== process.ppid) throw new Error("親processの指定が不正です");
    else await runCodexStdioRelay(socket, Number(pid));
  } catch (error) {
    process.stderr.write("aiterm-relay: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1;
  }
}
