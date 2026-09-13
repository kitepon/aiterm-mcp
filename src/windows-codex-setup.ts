// gpt-connectorのWindows実装をMIT条件で移植。実行時の外部製品依存は持たない。
// Windows Desktop用の実行file、ユーザー環境変数、親processの接続確認を所有する。
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { relayConfigDirectory, readRelayConfig, type RelayConfig } from "./codex-relay-config.js";
import { SetupError } from "./setup-platform.js";
import type { CodexSteerAction, CodexSteerResult } from "./setup-codex-relay.js";
import { verifyRelayLauncher } from "./setup-codex-relay.js";
import { withCodexRelay } from "./codex-relay-client.js";
import { windowsPowerShellSync, quotePowerShell } from "./windows-codex-state.js";
import { ensurePrivateDirectory, makeFilePrivate } from "./windows-codex-state.js";
import { readWindowsRelay, windowsDesktopRelay } from "./windows-codex-connection.js";

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

export function windowsLauncherSource(node: string, relay: string, binary: string, root: string): string {
  return `using System;
using System.Diagnostics;
using System.Text;
public static class AitermLauncher {
  static async System.Threading.Tasks.Task Input(Process child) {
    var input = Console.OpenStandardInput(); var output = child.StandardInput.BaseStream;
    var buffer = new byte[8192]; int count;
    while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) > 0) {
      await output.WriteAsync(buffer, 0, count); await output.FlushAsync();
    }
    child.StandardInput.Close();
  }
  static string Quote(string text) {
    var result = new StringBuilder().Append('"'); int slashes = 0;
    foreach (char c in text) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\\\', slashes * 2 + 1); result.Append(c); }
      else { result.Append('\\\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\\\', slashes * 2); return result.Append('"').ToString();
  }
  public static int Main(string[] args) {
    try {
      var arguments = new StringBuilder();
      foreach (var value in new string[] { ${[relay, binary, root].map(value => JSON.stringify(value)).join(", ")} }) arguments.Append(Quote(value)).Append(' ');
      foreach (var value in args) arguments.Append(Quote(value)).Append(' ');
      var start = new ProcessStartInfo(${JSON.stringify(node)}, arguments.ToString());
      start.UseShellExecute = false; start.CreateNoWindow = true;
      start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
      using (var child = Process.Start(start)) {
        Input(child).ContinueWith(task => { if (task.IsFaulted && !child.HasExited) child.Kill(); });
        var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
        var error = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        child.WaitForExit(); System.Threading.Tasks.Task.WaitAll(output, error); return child.ExitCode;
      }
    } catch { Console.Error.WriteLine("aiterm-mcp: Windows中継を起動できません"); return 1; }
  }
}
`;
}

export function buildWindowsLauncher(directory: string, source: string): string {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const launcher = join(directory, `codex-${digest}.exe`);
  const sourceFile = join(directory, `codex-${digest}.cs`);
  if (existsSync(launcher) && existsSync(sourceFile) && readFileSync(sourceFile, "utf8") === source) return launcher;
  const compiler = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!existsSync(compiler)) throw new SetupError("codex_launcher_compiler_unavailable", "Windows標準.NET Frameworkのコンパイラが見つかりません。");
  writeFileSync(sourceFile, source); makeFilePrivate(sourceFile);
  const result = spawnSync(compiler, ["/nologo", "/target:exe", `/out:${launcher}`, sourceFile], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.status !== 0) throw new SetupError("codex_launcher_build_failed", "Windows用のCodex起動fileを作成できません。");
  makeFilePrivate(launcher);
  return launcher;
}

async function live(config: RelayConfig): Promise<boolean> {
  const file = windowsDesktopRelay(config.launcher);
  if (!file) return false;
  await withCodexRelay(file, request => request("thread/loaded/list", { limit: 1 }));
  return true;
}

type WindowsRuntime = {
  directory: string; node: string; relay: string; findBinary: () => string;
  getGui: (key: string) => string | null; setGui: (key: string, value: string | null) => void;
  verify: (launcher: string) => Promise<void>; live: (config: RelayConfig) => Promise<boolean>;
  shared: (launcher: string) => Promise<{ binary: string; root: string } | null>;
};

export async function configureWindowsCodexSteer(action: CodexSteerAction, overrides: Partial<WindowsRuntime> = {}): Promise<CodexSteerResult> {
  const runtime: WindowsRuntime = { directory: relayConfigDirectory(), node: process.execPath,
    relay: fileURLToPath(new URL("./windows-codex-relay.js", import.meta.url)), findBinary: findWindowsCodexBinary, getGui, setGui,
    verify: verifyRelayLauncher, live,
    shared: async launcher => {
      const file = windowsDesktopRelay(launcher);
      if (!file) return null;
      await withCodexRelay(file, request => request("thread/loaded/list", { limit: 1 }));
      return { binary: readWindowsRelay(file).binary, root: dirname(dirname(file)) };
    }, ...overrides };
  const previous = readRelayConfig(runtime.directory);
  const current = runtime.getGui("CODEX_CLI_PATH");
  if (action === "status") {
    if (!previous?.enabled) return { status: "disabled" };
    if (current !== previous.launcher) return { status: "failed", reason_code: "codex_steer_configuration_changed" };
    return await runtime.live(previous) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
  }
  if (action === "disable") {
    if (!previous?.enabled) return { status: "disabled" };
    if (current !== previous.launcher) throw new SetupError("codex_steer_configuration_changed", "変更されたCodex起動設定は上書きしません。");
    if (previous.launcher !== previous.previous_cli_path) runtime.setGui("CODEX_CLI_PATH", previous.previous_cli_path);
    if (runtime.getGui("CODEX_CLI_PATH") !== previous.previous_cli_path) throw new SetupError("codex_steer_readback_failed", "元の起動設定を確認できません。");
    save(runtime.directory, { ...previous, enabled: false });
    return { status: "restart_required", reason_code: "codex_restart_required" };
  }
  if (previous?.enabled && previous.launcher !== previous.previous_cli_path && ![previous.launcher, previous.previous_cli_path].includes(current)) {
    throw new SetupError("codex_steer_configuration_changed", "変更されたCodex起動設定は上書きしません。");
  }
  if (current && (current !== previous?.launcher || previous.launcher === previous.previous_cli_path)) {
    const shared = await runtime.shared(current);
    if (!shared) throw new SetupError("codex_steer_configuration_conflict", "別のCodex起動設定との互換接続を確認できないため変更していません。");
    ensurePrivateDirectory(runtime.directory);
    save(runtime.directory, { schema: "aiterm.codex-relay.v1", enabled: true, binary: shared.binary,
      node: runtime.node, launcher: current, socket_root: shared.root, previous_cli_path: current });
    return { status: "ready" };
  }
  for (const key of ["CODEX_APP_SERVER_WS_URL", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "CODEX_APP_SERVER_FORCE_CLI"]) {
    if (runtime.getGui(key)) throw new SetupError("codex_steer_configuration_conflict", `${key}が設定されているため変更していません。`);
  }
  ensurePrivateDirectory(runtime.directory);
  const binary = runtime.findBinary();
  const root = join(runtime.directory, "sessions");
  ensurePrivateDirectory(root);
  const launcher = buildWindowsLauncher(runtime.directory, windowsLauncherSource(runtime.node, runtime.relay, binary, root));
  await runtime.verify(launcher);
  const config: RelayConfig = { schema: "aiterm.codex-relay.v1", enabled: true, binary, node: runtime.node, launcher,
    socket_root: root, previous_cli_path: previous?.enabled && previous.launcher !== previous.previous_cli_path ? previous.previous_cli_path : current };
  save(runtime.directory, config);
  runtime.setGui("CODEX_CLI_PATH", launcher);
  if (runtime.getGui("CODEX_CLI_PATH") !== launcher) throw new SetupError("codex_steer_readback_failed", "WindowsのCodex起動設定を確認できません。");
  return await runtime.live(config) ? { status: "ready" } : { status: "restart_required", reason_code: "codex_restart_required" };
}

function save(directory: string, config: RelayConfig): void {
  const file = join(directory, `${randomUUID()}.tmp`);
  try {
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { flag: "wx" }); makeFilePrivate(file);
    renameSync(file, join(directory, "config.json"));
  } finally { rmSync(file, { force: true }); }
}
