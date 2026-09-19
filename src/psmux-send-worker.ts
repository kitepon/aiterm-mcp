import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

// 公開本文64KiBをPowerShellの一括入力へBase64化した長さと構文・paste markerを含む。
const MAX_PAYLOAD_BYTES = Math.ceil(64 * 1024 / 3) * 4 + 128;
const PTY_CHUNK_BYTES = 256;
const MAX_FINAL_DRAIN_MS = 3_000;
const SESSION_BASE_RE = /^[A-Za-z0-9_-]{1,160}$/;
const KEY_RE = /^[0-9a-f]{16}$/i;

async function readPayload(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += bytes.length;
    if (total > MAX_PAYLOAD_BYTES) throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function psmuxDataDir(): string {
  const override = process.env.PSMUX_DATA_DIR;
  if (override) {
    if (!path.isAbsolute(override)) throw new Error("PSMUX_DATA_DIR must be absolute");
    return override;
  }
  return path.join(process.env.USERPROFILE || os.homedir(), ".psmux");
}

async function sendCommand(port: number, key: string, command: string, expectedResponse?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let response = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(2_000, () => finish(new Error("psmux command timed out")));
    socket.on("connect", () => socket.end(`AUTH ${key}\n${command}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => {
      if (
        response.split(/\r?\n/).includes("OK") &&
        (expectedResponse == null || response.includes(expectedResponse))
      ) finish();
      else finish(new Error(`psmux authentication failed: ${response.trim() || "empty response"}`));
    });
    socket.on("error", (error) => finish(error));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(): Promise<void> {
  const sessionBase = process.argv[2] ?? "";
  if (!SESSION_BASE_RE.test(sessionBase)) throw new Error("invalid psmux session base");
  const payload = await readPayload();
  const dir = psmuxDataDir();
  const portText = fs.readFileSync(path.join(dir, `${sessionBase}.port`), "utf8").trim();
  const key = fs.readFileSync(path.join(dir, `${sessionBase}.key`), "utf8").trim();
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid psmux port");
  if (!KEY_RE.test(key)) throw new Error("invalid psmux auth key");
  const subcommands: string[] = [];
  for (let offset = 0; offset < payload.length; offset += PTY_CHUNK_BYTES) {
    const chunk = payload.subarray(offset, offset + PTY_CHUNK_BYTES);
    const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    subcommands.push(`send -H ${hex}`);
  }
  const chunkDrainMs = payload.length > 1024 ? 300 : 100;
  for (const command of subcommands) {
    await sendCommand(port, key, command);
    await delay(chunkDrainMs);
  }
  const completionMarker = `AITERM_PSMUX_SEND_DONE_${process.pid}`;
  await sendCommand(port, key, `display-message -p ${completionMarker}`, completionMarker);
  const finalDrainMs = Math.min(MAX_FINAL_DRAIN_MS, Math.max(200, Math.ceil(payload.length / 1024) * 500));
  await delay(finalDrainMs);
  if (process.env.AITERM_PSMUX_DEBUG === "1") {
    process.stderr.write(`psmux-send-worker debug: chunks=${subcommands.length} sent=${subcommands.length}\n`);
  }
}

send().catch((error) => {
  process.stderr.write(`psmux-send-worker: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
