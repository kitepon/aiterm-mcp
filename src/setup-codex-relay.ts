import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SetupError } from "./setup-platform.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { readRelayConfig, relayConfigDirectory, prepareRelayDirectory, type RelayConfig } from "./codex-relay-config.js";
import { codexRelayLauncher } from "./codex-relay-launcher.js";
import { withCodexRelay } from "./codex-relay-client.js";
import { readRuntimeProcesses } from "./process-runtime.js";
import { installRelayLogin, removeRelayLogin } from "./codex-relay-login.js";

export type CodexSteerAction = "enable" | "disable" | "status";
export type CodexSteerResult = {
  status: "ready" | "disabled" | "restart_required" | "unsupported" | "failed";
  reason_code?: string;
};
type Runtime = {
  platform: string; directory: string; socket_root: string; node: string; relay: string;
  findBinary: () => string;
  getGui: (key: string) => string | null;
  setGui: (key: string, value: string | null) => void;
  persist: (launcher: string) => void;
  unpersist: (launcher: string) => void;
  verify: (launcher: string) => Promise<void>;
  live: (config: RelayConfig) => Promise<boolean>;
};

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0) throw new SetupError("codex_steer_setup_failed", `${path.basename(executable)}を実行できません`);
  return result.stdout.trim();
}

function getGui(key: string): string | null {
  const result = spawnSync("/bin/launchctl", ["getenv", key], { encoding: "utf8", timeout: 5_000 });
  if (result.status === 1 && !result.stderr.trim()) return null;
  if (result.error || result.status !== 0) throw new SetupError("codex_steer_environment_unavailable", "GUIの起動設定を確認できません");
  return result.stdout.trim() || null;
}

function findDesktopBinary(): string {
  const search = spawnSync("/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == 'com.openai.codex'"], { encoding: "utf8", timeout: 10_000 });
  const candidates = [...new Set(["/Applications/Codex.app", "/Applications/ChatGPT.app", ...(search.status === 0 ? search.stdout.trim().split("\n") : [])])];
  const found = candidates.filter(app => {
    if (!app || !fs.existsSync(path.join(app, "Contents", "Resources", "codex"))) return false;
    const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print:CFBundleIdentifier", path.join(app, "Contents", "Info.plist")], { encoding: "utf8", timeout: 5_000 });
    return result.status === 0 && result.stdout.trim() === "com.openai.codex";
  });
  if (found.length !== 1) throw new SetupError("codex_desktop_not_identified", "Codex Desktopのインストール先を一つに特定できません");
  const binary = path.join(found[0], "Contents", "Resources", "codex");
  command("/usr/bin/codesign", ["--verify", "--strict", binary]);
  const version = command(binary, ["--version"]);
  const match = /codex-cli (\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match || (Number(match[1]) === 0 && Number(match[2]) < 154)) {
    throw new SetupError("codex_version_unsupported", "SteerにはCodex CLI 0.154以上を同梱したCodex Desktopが必要です");
  }
  return binary;
}

/** 模擬HOMEで起動・initialize・終了を確認する。利用者の認証やtaskは使わない。 */
export async function verifyRelayLauncher(launcher: string): Promise<void> {
  const temporary = fs.mkdtempSync(path.join(tmpdir(), "aiterm-relay-setup-"));
  fs.mkdirSync(path.join(temporary, ".codex"));
  const child = spawn(launcher, ["-c", 'cli_auth_credentials_store="file"', "-c", 'mcp_oauth_credentials_store="file"', "app-server"], {
    env: { ...process.env, HOME: temporary, CODEX_HOME: path.join(temporary, ".codex") }, stdio: ["pipe", "pipe", "ignore"],
  });
  const reader = createInterface({ input: child.stdout });
  const exited = new Promise<number | null>(resolve => child.once("close", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SetupError("codex_relay_probe_failed", "中継経由の公式受付を確認できません")), 20_000);
      const fail = () => { clearTimeout(timer); reject(new SetupError("codex_relay_probe_failed", "中継経由の公式起動に失敗しました")); };
      child.once("error", fail); child.once("close", fail); child.stdin.once("error", fail);
      reader.on("line", line => {
        try {
          const value = JSON.parse(line);
          if (value.id !== 1 || value.method) return;
          clearTimeout(timer);
          if (!value.result || value.error) fail(); else resolve();
        } catch { fail(); }
      });
      child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "aiterm_setup", version: "1" } } }) + "\n");
    });
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    const code = await exited;
    clearTimeout(timer); reader.close(); fs.rmSync(temporary, { recursive: true, force: true });
    if (code !== 0) throw new SetupError("codex_relay_probe_failed", "中継の終了を確認できません");
  }
}

export async function liveRelay(config: RelayConfig): Promise<boolean> {
  if (!fs.existsSync(config.socket_root)) return false;
  const processes = readRuntimeProcesses();
  const rows = new Map(processes.map(row => [row.pid, row]));
  const desktopPrefix = path.join(path.dirname(path.dirname(config.binary)), "MacOS") + path.sep;
  for (const name of fs.readdirSync(config.socket_root).filter(name => /^\d+\.sock$/.test(name))) {
    const server = rows.get(Number(name.slice(0, -5)));
    const desktop = server && rows.get(server.parent_pid);
    if (!server || !(server.command === config.binary || server.command.startsWith(config.binary + " "))
      || !desktop?.command.startsWith(desktopPrefix)) continue;
    try {
      await withCodexRelay(path.join(config.socket_root, name), async request => { await request("thread/loaded/list", { limit: 1 }); }, 1_000);
      return true;
    } catch (error) {
      // 終了済みsocketだけをreadyの証拠から外す。権限・protocolエラーはそのまま返す。
      if (!(error instanceof CodexDeliveryError) || error.delivery_code !== "CODEX_RELAY_UNAVAILABLE") throw error;
    }
  }
  return false;
}

function writeConfig(directory: string, config: RelayConfig): void {
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, path.join(directory, "config.json"));
}

export async function configureCodexSteer(action: CodexSteerAction = "status", overrides: Partial<Runtime> = {}): Promise<CodexSteerResult> {
  const runtime: Runtime = {
    platform: process.platform, directory: relayConfigDirectory(), socket_root: `/tmp/aiterm-codex-${process.getuid?.() ?? 0}`,
    node: process.execPath, relay: fileURLToPath(new URL("./codex-stdio-relay.js", import.meta.url)),
    findBinary: findDesktopBinary, getGui,
    setGui: (key, value) => { command("/bin/launchctl", value === null ? ["unsetenv", key] : ["setenv", key, value]); },
    persist: installRelayLogin, unpersist: removeRelayLogin,
    verify: verifyRelayLauncher, live: liveRelay, ...overrides,
  };
  if (runtime.platform !== "darwin") {
    return action === "enable" ? { status: "unsupported", reason_code: "codex_steer_platform_unsupported" } : { status: "disabled" };
  }
  const previous = readRelayConfig(runtime.directory);
  if (action === "status") {
    if (!previous?.enabled) return { status: "disabled" };
    if (runtime.getGui("CODEX_CLI_PATH") !== previous.launcher) return { status: "failed", reason_code: "codex_steer_configuration_changed" };
    return await runtime.live(previous) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
  }
  if (action === "disable") {
    if (!previous?.enabled) return { status: "disabled" };
    if (![previous.launcher, previous.previous_cli_path].includes(runtime.getGui("CODEX_CLI_PATH"))) throw new SetupError("codex_steer_configuration_changed", "起動設定が他から変更されています。所有外の値は上書きしません");
    runtime.unpersist(previous.launcher);
    runtime.setGui("CODEX_CLI_PATH", previous.previous_cli_path);
    if (runtime.getGui("CODEX_CLI_PATH") !== previous.previous_cli_path) throw new SetupError("codex_steer_readback_failed", "元の起動設定を確認できません");
    writeConfig(runtime.directory, { ...previous, enabled: false });
    return { status: "restart_required", reason_code: "codex_restart_required" };
  }
  for (const key of ["CODEX_APP_SERVER_WS_URL", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "CODEX_APP_SERVER_FORCE_CLI"]) {
    if (runtime.getGui(key)) throw new SetupError("codex_steer_configuration_conflict", `${key}が設定されています。既存の接続設定は上書きしません`);
  }
  const binary = runtime.findBinary();
  const current = runtime.getGui("CODEX_CLI_PATH");
  if (previous?.enabled && ![previous.launcher, previous.previous_cli_path].includes(current)) throw new SetupError("codex_steer_configuration_changed", "起動設定が他から変更されています");
  prepareRelayDirectory(runtime.directory);
  const launcher = path.join(runtime.directory, "codex");
  const config: RelayConfig = { schema: "aiterm.codex-relay.v1", enabled: true, binary, node: runtime.node,
    launcher, socket_root: runtime.socket_root, previous_cli_path: previous?.enabled ? previous.previous_cli_path : current };
  const candidate = path.join(runtime.directory, `codex-${randomUUID()}`);
  fs.writeFileSync(candidate, codexRelayLauncher({ ...config, relay: runtime.relay }), { mode: 0o700, flag: "wx" });
  try { await runtime.verify(candidate); fs.renameSync(candidate, launcher); }
  finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
  // 起動設定の変更前に復元値を保存する。読戻し不一致を成功扱いしない。
  writeConfig(runtime.directory, config);
  runtime.persist(launcher);
  runtime.setGui("CODEX_CLI_PATH", launcher);
  if (runtime.getGui("CODEX_CLI_PATH") !== launcher) throw new SetupError("codex_steer_readback_failed", "Steerの起動設定を確認できません");
  return await runtime.live(config) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
}
