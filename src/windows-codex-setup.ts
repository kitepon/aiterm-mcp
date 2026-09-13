// gpt-connectorのWindows実装をMIT条件で移植。実行時の外部製品依存は持たない。
// Windows Desktop用の実行file、ユーザー環境変数、親processの接続確認を所有する。
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { relayConfigDirectory, type RelayConfig } from "./codex-relay-config.js";
import { SetupError } from "./setup-platform.js";
import type { CodexSteerAction, CodexSteerResult } from "./setup-codex-relay.js";
import { verifyRelayLauncher } from "./setup-codex-relay.js";
import { withCodexRelay } from "./codex-relay-client.js";
import { windowsPowerShellSync, quotePowerShell } from "./windows-codex-state.js";
import { ensurePrivateDirectory, makeFilePrivate } from "./windows-codex-state.js";
import { windowsDesktopRelay } from "./windows-codex-connection.js";
import { configureRelay, type RelaySetupRuntime } from "./codex-relay-setup.js";
import { windowsLauncherSource } from "./windows-codex-launcher.js";

export function findWindowsCodexCache(resources: string, cache: string): string {
  // Desktopが展開した4実行fileを配布元と照合する。展開・更新はDesktop自身が所有する。
  const names = ["codex.exe", "codex-code-mode-host.exe", "codex-windows-sandbox-setup.exe", "codex-command-runner.exe"];
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const expected = names.map(name => digest(join(resources, name)));
  const found = (existsSync(cache) ? readdirSync(cache, { withFileTypes: true }) : [])
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[0-9a-f]{16}$/.test(entry.name))
    .filter(entry => names.every((name, index) => {
      const file = join(cache, entry.name, name);
      return existsSync(file) && digest(file) === expected[index];
    }));
  if (found.length !== 1) throw new SetupError("codex_desktop_runtime_unavailable", "現在のCodex Desktopが展開した実行fileを特定できません。公式Desktopを起動してからsetupを再実行してください。");
  return join(cache, found[0]!.name, "codex.exe");
}

export function findWindowsCodexBinary(): string {
  const resources = windowsPowerShellSync(`
$packages = @(Get-AppxPackage -Name OpenAI.Codex)
if ($packages.Count -ne 1) { throw '公式Codex Desktopを一つに特定できません' }
Join-Path $packages[0].InstallLocation 'app/resources'`);
  const value = findWindowsCodexCache(resources, join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin"));
  const result = spawnSync(value, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (result.error || result.status !== 0) throw new SetupError("codex_binary_unavailable", "公式Codex Desktopの実行fileを起動できません。");
  const match = /codex-cli (\d+)\.(\d+)\.(\d+)/.exec(result.stdout ?? "");
  if (result.status !== 0 || !match || (Number(match[1]) === 0 && Number(match[2]) < 154)) throw new SetupError("codex_version_unsupported", "公式Codex Desktopの対応CLIを確認できません。");
  return value;
}

function getGui(key: string): string | null {
  return windowsPowerShellSync(`[Environment]::GetEnvironmentVariable(${quotePowerShell(key)}, 'User')`) || null;
}

function setGui(key: string, value: string | null): void {
  windowsPowerShellSync(`
[Environment]::SetEnvironmentVariable(${quotePowerShell(key)}, ${value === null ? "$null" : quotePowerShell(value)}, 'User')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AitermEnvironment {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wparam, string value, uint flags, uint timeout, out UIntPtr result);
}
'@
$result = [UIntPtr]::Zero
[void][AitermEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
`, 10_000);
}

export { windowsLauncherSource } from "./windows-codex-launcher.js";

export function buildWindowsLauncher(directory: string, source: string): string {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const launcher = join(directory, `codex-${digest}.exe`);
  const sourceFile = join(directory, `codex-${digest}.cs`);
  if (existsSync(launcher) && existsSync(sourceFile) && readFileSync(sourceFile, "utf8") === source) return launcher;
  const compiler = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!existsSync(compiler)) throw new SetupError("codex_launcher_compiler_unavailable", "Windows標準.NET Frameworkのコンパイラが見つかりません。");
  writeFileSync(sourceFile, source); makeFilePrivate(sourceFile);
  const result = spawnSync(compiler, ["/nologo", "/target:exe", "/reference:System.Runtime.Serialization.dll", `/out:${launcher}`, sourceFile], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.status !== 0) throw new SetupError("codex_launcher_build_failed", "Windows用のCodex起動fileを作成できません。");
  makeFilePrivate(launcher);
  return launcher;
}

async function live(config: RelayConfig): Promise<boolean> {
  const file = windowsDesktopRelay(config.launcher, undefined, config.socket_root);
  if (!file) return false;
  await withCodexRelay(file, request => request("thread/loaded/list", { limit: 1 }));
  return true;
}

type WindowsRuntime = RelaySetupRuntime & { relay: string; verify: (launcher: string) => Promise<void> };

export function windowsCodexRuntime(overrides: Partial<WindowsRuntime> = {}): RelaySetupRuntime {
  const directory = overrides.directory ?? relayConfigDirectory();
  const runtime: WindowsRuntime = {
    directory, socket_root: join(directory, "sessions"), node: process.execPath,
    relay: fileURLToPath(new URL("./windows-codex-relay.js", import.meta.url)),
    findBinary: findWindowsCodexBinary, getGui, setGui, verify: verifyRelayLauncher, live,
    // User環境変数はsetGuiの一操作で永続化される。
    persist: () => {}, unpersist: () => {}, prepare: ensurePrivateDirectory, save,
    build: async binary => {
      ensurePrivateDirectory(runtime.socket_root);
      const launcher = buildWindowsLauncher(runtime.directory, windowsLauncherSource(runtime.node, runtime.relay, binary, runtime.socket_root));
      await runtime.verify(launcher);
      return launcher;
    }, ...overrides,
  };
  return runtime;
}

export async function configureWindowsCodexSteer(action: CodexSteerAction, overrides: Partial<WindowsRuntime> = {}): Promise<CodexSteerResult> {
  return configureRelay(action, windowsCodexRuntime(overrides));
}

function save(directory: string, config: RelayConfig): void {
  const file = join(directory, `${randomUUID()}.tmp`);
  try {
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { flag: "wx" }); makeFilePrivate(file);
    renameSync(file, join(directory, "config.json"));
  } finally { rmSync(file, { force: true }); }
}
