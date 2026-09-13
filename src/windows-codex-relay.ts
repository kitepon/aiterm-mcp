// Windowsの認証付きloopback接続と接続情報だけを所有する。起動・stdio中継の契約は共通。
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync, realpathSync } from "node:fs";
import WebSocket from "ws";
import { ensurePrivateDirectory, makeFilePrivate } from "./windows-codex-state.js";
import { readWindowsProcesses, type WindowsRelay } from "./windows-codex-connection.js";
import { codexServerArguments } from "./codex-relay-arguments.js";
import { relayCodexStdio } from "./codex-relay-stdio.js";

export { codexServerArguments as windowsServerArguments } from "./codex-relay-arguments.js";

export async function prepareWindowsRelay(root: string, args: string[]) {
  const serverArgs = codexServerArguments(args);
  if (!serverArgs) return { directory: null, endpoint: null, arguments: args };
  // MSIXの仮想AppData名はnative子から見えないため、起動済みの自身の実体を渡す。
  const relay = realpathSync.native(fileURLToPath(import.meta.url));
  const directory = join(root, randomUUID());
  ensurePrivateDirectory(directory);
  try {
    const tokenFile = join(directory, "token");
    writeFileSync(tokenFile, randomBytes(32).toString("hex"), { flag: "wx" }); makeFilePrivate(tokenFile);
    // port取得後の競合は公式serverの起動失敗として明示する。
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const endpoint = "ws://127.0.0.1:" + port;
    return { directory, endpoint, relay, arguments: [...serverArgs, "--listen", endpoint, "--ws-auth", "capability-token", "--ws-token-file", tokenFile] };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}

export async function serveWindowsRelay(binary: string, directory: string, endpoint: string, serverPid: number): Promise<void> {
  if (process.ppid !== serverPid) throw new Error("公式Codexの子として中継を起動してください");
  const { readFileSync } = await import("node:fs");
  const token = readFileSync(join(directory, "token"), "utf8");
  try {
    await relayCodexStdio({
      alive: () => { try { process.kill(serverPid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } },
      socket: () => new WebSocket(endpoint, { headers: { Authorization: "Bearer " + token }, handshakeTimeout: 1_000, perMessageDeflate: false }),
      stop: async () => {
        // launcherが保持するprocess handleにより、このPIDは終了確認まで再利用されない。
        try { process.kill(serverPid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      },
      connected: () => {
        const server = readWindowsProcesses().find(row => row.pid === serverPid);
        if (!server || server.executable.toLowerCase() !== binary.toLowerCase()) throw new Error("公式Codexの起動を確認できません");
        const record: WindowsRelay = { schema: "aiterm.windows-relay.v1", serverPid, serverStarted: server.started, binary, endpoint };
        const file = join(directory, "connection.json");
        writeFileSync(file, JSON.stringify(record), { flag: "wx" }); makeFilePrivate(file);
      },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === "--prepare" && args[0]) process.stdout.write(JSON.stringify(await prepareWindowsRelay(args[0], args.slice(1))));
    else if (mode === "--serve" && args.length === 4 && /^[1-9][0-9]*$/.test(args[3]!)) await serveWindowsRelay(args[0]!, args[1]!, args[2]!, Number(args[3]));
    else throw new Error("Windows中継の起動指定が不正です");
  } catch (error) {
    process.stderr.write("aiterm-mcp: " + (error instanceof Error ? error.message : "Windows中継が失敗しました") + "\n"); process.exitCode = 1;
  }
}
