// runtime-error-store の OS 依存部分の所有者: パス規約（LOCALAPPDATA / XDG）、
// Windows DACL（PowerShell）、host profile 判定、安全な bounded read、
// process start identity 観測、force kill。store 本体は OS 非依存ロジックに保つ。
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveWindowsPowerShell7, windowsPowerShell7Command } from "./windows-powershell.js";

export function defaultRuntimeErrorPaths(options: {
  platform?: NodeJS.Platform; home?: string; localAppData?: string; xdgConfigHome?: string; xdgStateHome?: string;
} = {}): { configPath: string; storePath: string } {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  if (platform === "win32") {
    const base = options.localAppData ?? process.env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return {
      configPath: path.win32.join(base, "dotagents", "factory-reporter", "config.json"),
      storePath: path.win32.join(base, "aiterm-mcp", "runtime-errors.json"),
    };
  }
  const configHome = options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  const stateHome = options.xdgStateHome ?? process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
  return {
    configPath: path.join(configHome, "dotagents", "factory-reporter.json"),
    storePath: path.join(stateHome, "aiterm-mcp", "runtime-errors.json"),
  };
}

// BugHubへの報告で使う場所。有効スイッチはAiterm自身の設定、合鍵はBugHubの持ち主が端末へ置くファイル。
export function defaultRuntimeErrorReportPaths(options: {
  platform?: NodeJS.Platform; home?: string; localAppData?: string; xdgConfigHome?: string; xdgStateHome?: string;
} = {}): { reportingConfigPath: string; credentialPath: string; reportStatePath: string } {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  if (platform === "win32") {
    const base = options.localAppData ?? process.env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return {
      reportingConfigPath: path.win32.join(base, "aiterm-mcp", "runtime-error-reporting.json"),
      credentialPath: path.win32.join(base, "bughub", "product-credentials", "aiterm-mcp.json"),
      reportStatePath: path.win32.join(base, "aiterm-mcp", "runtime-errors-report.json"),
    };
  }
  const configHome = options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  const stateHome = options.xdgStateHome ?? process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
  return {
    reportingConfigPath: path.join(configHome, "aiterm-mcp", "runtime-error-reporting.json"),
    credentialPath: path.join(configHome, "bughub", "product-credentials", "aiterm-mcp.json"),
    reportStatePath: path.join(stateHome, "aiterm-mcp", "runtime-errors-report.json"),
  };
}

const MAX_REPORTING_CONFIG_BYTES = 4 * 1024;

/** 報告の有効スイッチの状態。ファイルが無ければ無効（既定）。形が違うファイルは有効とみなさない。 */
export function runtimeErrorReportingStatus(file: string, platform: NodeJS.Platform = process.platform): "enabled" | "disabled" | "malformed" {
  let text: string;
  try { text = readBoundedFile(file, MAX_REPORTING_CONFIG_BYTES, platform, false); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "disabled" : "malformed"; }
  try {
    const config: unknown = JSON.parse(text);
    if (typeof config !== "object" || config === null || Array.isArray(config)) return "malformed";
    const keys = Object.keys(config);
    const value = config as { schema_version?: unknown; enabled?: unknown };
    if (keys.length !== 2 || value.schema_version !== "1.0" || typeof value.enabled !== "boolean") return "malformed";
    return value.enabled ? "enabled" : "disabled";
  } catch { return "malformed"; }
}

const WINDOWS_DACL_VERIFY_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$target=$env:AITERMMCP_ACL_PATH; $kind=$env:AITERMMCP_ACL_KIND
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$item=Get-Item -LiteralPath $target
$sections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
$check=[IO.FileSystemAclExtensions]::GetAccessControl($item,$sections)
$ownerSid=$check.GetOwner([Security.Principal.SecurityIdentifier]).Value
$rules=@($check.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($ownerSid -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited -or (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)){exit 9}
`;
const WINDOWS_DACL_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$target=$env:AITERMMCP_ACL_PATH; $kind=$env:AITERMMCP_ACL_KIND
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
if($kind -eq 'directory'){$acl=New-Object Security.AccessControl.DirectorySecurity;$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object Security.AccessControl.FileSecurity;$inherit=[Security.AccessControl.InheritanceFlags]::None}
$acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule); $item=Get-Item -LiteralPath $target; [IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)
` + WINDOWS_DACL_VERIFY_SCRIPT;

export function windowsPrivateDaclCommand(target: string, kind: "directory" | "file" = "directory"):
  { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    command: windowsPowerShell7Command(),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_DACL_SCRIPT],
    env: { ...process.env, AITERMMCP_ACL_PATH: target, AITERMMCP_ACL_KIND: kind },
  };
}
export function windowsPrivateDaclVerifyCommand(target: string, kind: "directory" | "file" = "file"):
  { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    command: windowsPowerShell7Command(),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_DACL_VERIFY_SCRIPT],
    env: { ...process.env, AITERMMCP_ACL_PATH: target, AITERMMCP_ACL_KIND: kind },
  };
}

export function expectedHostProfiles(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  release: string = os.release(),
): readonly string[] {
  if (platform === "darwin") return ["mac"];
  if (platform === "win32") return ["windows-native"];
  return env.WSL_DISTRO_NAME || /microsoft/i.test(release) ? ["wsl"] : ["server", "linux"];
}

function assertPrivatePosixStat(info: fs.Stats, expectedMode: number, label: string): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`${label} が安全な regular file ではありません`);
  if (typeof process.getuid !== "function" || info.uid !== process.getuid()) throw new Error(`${label} owner が不正です`);
  if ((info.mode & 0o777) !== expectedMode) throw new Error(`${label} mode が不正です`);
}

export function readBoundedFile(file: string, maxBytes: number, platform: NodeJS.Platform, requirePrivate: boolean): string {
  if (platform === "win32") {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("file shape/size が不正です");
    if (requirePrivate) { const command = windowsPrivateDaclVerifyCommand(file); const verified = spawnSync(command.command, command.args, { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024, env: command.env }); if (verified.error || verified.status !== 0) throw new Error("file DACL が不正です"); }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); try { const after = fs.fstatSync(fd); if (before.dev !== after.dev || before.ino !== after.ino || after.size > maxBytes) throw new Error("file が read 中に置換されました"); return fs.readFileSync(fd, "utf8"); } finally { fs.closeSync(fd); }
  }
  const before = fs.lstatSync(file);
  if (requirePrivate) assertPrivatePosixStat(before, 0o600, "runtime store/config");
  else if (!before.isFile() || before.isSymbolicLink()) throw new Error("file が regular ではありません");
  if (before.size > maxBytes) throw new Error("file が大きすぎます");
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | noFollow);
  try {
    const after = fs.fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error("file が read 中に置換されました");
    if (requirePrivate) assertPrivatePosixStat(after, 0o600, "runtime store/config");
    return fs.readFileSync(fd, "utf8");
  } finally { fs.closeSync(fd); }
}

export function processStartIdentity(pid: number, platform: NodeJS.Platform, timeoutMs = 1000): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      return fields[19] ? `linux:${fields[19]}` : null;
    } catch { return null; }
  }
  if (platform === "win32") {
    const script = "$p=Get-Process -Id $env:AITERMMCP_PROCESS_ID -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks";
    const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: timeoutMs, maxBuffer: 4096, windowsHide: true,
      env: { ...process.env, AITERMMCP_PROCESS_ID: String(pid) },
    });
    const value = result.status === 0 ? (result.stdout ?? "").trim() : "";
    return /^\d+$/.test(value) ? `win32:${value}` : null;
  }
  // lstart の日付書式は LC_TIME で変わり、locale の違う観測者間で identity が割れる
  // （caveat: ps-locale-lstart-lc-time-ascii-argv-lc-ctype-digest。Lattice 0.63.4 と同じ固定）
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8", timeout: 1000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" },
  });
  const value = result.status === 0 ? (result.stdout ?? "").trim() : "";
  return value ? `${platform}:${value}` : null;
}

export function forceKill(child: ReturnType<typeof spawn>): void {
  if (!Number.isSafeInteger(child.pid) || !child.pid) return;
  if (process.platform !== "win32") {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
    return;
  }
  // taskkill 自体の起動が混雑した Windows runner で遅れても、deadline を越えた
  // worker 本体の副作用を許さない。まず Node のハンドルから即時停止し、その後に
  // taskkill /T で worker が残した子孫だけを回収する。
  try { child.kill("SIGKILL"); } catch { /* already exited */ }
  const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore", windowsHide: true,
  });
  killer.once("error", () => { /* parent は上で停止済み。子孫回収失敗は記録側の固定診断へ集約する */ });
  killer.unref();
}
