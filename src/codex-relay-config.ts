// Aitermの選択設定と、同じ親processが所有する公式socketの識別。
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { readRuntimeProcesses, type RuntimeProcess } from "./process-runtime.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";

export const relayConfigSchema = z.object({
  schema: z.literal("aiterm.codex-relay.v1"),
  enabled: z.boolean(),
  binary: z.string(), node: z.string(), launcher: z.string(), socket_root: z.string(),
  previous_cli_path: z.string().nullable(),
}).strict();
export type RelayConfig = z.infer<typeof relayConfigSchema>;

export function relayConfigDirectory(home = process.env.HOME ?? homedir()): string {
  return path.join(home, ".config", "aiterm-mcp", "codex-relay");
}

export function readRelayConfig(directory = relayConfigDirectory()): RelayConfig | null {
  const file = path.join(directory, "config.json");
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try { return relayConfigSchema.parse(JSON.parse(text)); }
  catch { throw new CodexDeliveryError("CODEX_RELAY_CONFIG_INVALID", "Steerの設定を読めません。aiterm-setup --codex-steer statusで確認してください"); }
}

export function prepareRelayDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new CodexDeliveryError("CODEX_RELAY_PATH_INVALID", "socketディレクトリが絶対pathではありません");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new CodexDeliveryError("CODEX_RELAY_PATH_INVALID", "socketディレクトリは本人所有の0700である必要があります");
  }
}

export function verifyRelaySocket(socket: string): void {
  const directory = fs.lstatSync(path.dirname(socket));
  const stat = fs.lstatSync(socket);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700
    || !stat.isSocket() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) {
    throw new CodexDeliveryError("CODEX_RELAY_PATH_INVALID", "本人所有の公式socketを確認できません");
  }
}

export function parentRelaySocket(config: RelayConfig, processes: RuntimeProcess[] = readRuntimeProcesses(), pid = process.pid): string {
  const rows = new Map(processes.map(row => [row.pid, row]));
  const seen = new Set<number>();
  let current = rows.get(pid)?.parent_pid;
  while (current && !seen.has(current)) {
    seen.add(current);
    const socket = path.join(config.socket_root, `${current}.sock`);
    if (fs.existsSync(socket)) { verifyRelaySocket(socket); return socket; }
    current = rows.get(current)?.parent_pid;
  }
  throw new CodexDeliveryError("CODEX_STEER_RESTART_REQUIRED", "Steerを有効にしたCodex Desktopの親接続がありません。aiterm-setupの結果を確認し、Codexを再起動してください");
}
