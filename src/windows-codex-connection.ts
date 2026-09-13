// gpt-connectorのWindows実装をMIT条件で移植。実行時の外部製品依存は持たない。
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { windowsPowerShellSync, quotePowerShell } from "./windows-codex-state.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { readRuntimeProcesses } from "./process-runtime.js";

export const windowsRelaySchema = z.object({
  schema: z.enum(["aiterm.windows-relay.v1", "gpt-connector.windows-relay.v1"]),
  serverPid: z.number().int().positive(), serverStarted: z.string(), binary: z.string(),
  endpoint: z.string().regex(/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/),
}).strict();
export type WindowsRelay = z.infer<typeof windowsRelaySchema>;

const processSchema = z.object({ pid: z.number(), parent_pid: z.number(), command: z.string(), executable: z.string(), started: z.string() });
export type WindowsProcess = z.infer<typeof processSchema>;

export function readWindowsProcesses(): WindowsProcess[] {
  return readRuntimeProcesses().map(row => ({ pid: row.pid, parent_pid: row.parent_pid, command: row.command, executable: row.executable ?? "", started: row.started_identity }));
}

function invalid(message: string): never { throw new CodexDeliveryError("CODEX_RELAY_CONNECTION_INVALID", message); }

export function readWindowsRelay(file: string, processes = readWindowsProcesses()): WindowsRelay {
  if (!isAbsolute(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) invalid("WindowsのSteer接続記録が不正です。");
  const root = dirname(file);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) invalid("WindowsのSteer保存先が不正です。");
  // 接続情報は外部入力。読む前に所有者とACLを検証し、権限を修復して成功扱いしない。
  windowsPowerShellSync(`
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($entry in @(${quotePowerShell(root)}, ${quotePowerShell(file)}, ${quotePowerShell(join(root, "token"))})) {
  $acl = Get-Acl -LiteralPath $entry
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid, 'S-1-5-32-544')) { throw 'Steer保存先の所有者が一致しません' }
  foreach ($rule in $acl.Access) {
    $identity = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $identity -notin @($sid, 'S-1-5-18', 'S-1-5-32-544')) { throw 'Steer保存先が他userへ公開されています' }
  }
}`);
  const record = windowsRelaySchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const server = processes.find(row => row.pid === record.serverPid);
  if (!server || Date.parse(server.started) !== Date.parse(record.serverStarted) || server.executable.toLowerCase() !== record.binary.toLowerCase()
      || !server.command.includes(record.endpoint) || !server.command.includes(join(root, "token"))) invalid("Windowsの親Codex processを照合できません。");
  return record;
}

export function findWindowsParentSocket(rows = readWindowsProcesses(), callerPid = process.pid, root?: string): string {
  const parents = new Map(rows.map(row => [row.pid, row]));
  const seen = new Set<number>();
  let pid = parents.get(callerPid)?.parent_pid;
  while (pid && !seen.has(pid)) {
    const row = parents.get(pid);
    // 自分が起動した公式CLIの引数から接続先を取得する。MCPへの環境変数継承を前提にしない。
    const token = row && basename(row.executable).toLowerCase() === "codex.exe"
      ? /(?:^|\s)--ws-token-file\s+(?:"([^"]+)"|(\S+))/.exec(row.command) : null;
    const tokenFile = token?.[1] ?? token?.[2];
    if (tokenFile && isAbsolute(tokenFile) && basename(tokenFile) === "token") {
      const file = join(dirname(tokenFile), "connection.json");
      if (root) {
        const location = relative(root, file);
        if (isAbsolute(location) || location === ".." || location.startsWith("..\\")) invalid("親CodexはAitermのSteer起動設定を使っていません。Codexを完全再起動してください。");
      }
      const record = readWindowsRelay(file, rows);
      if (record.serverPid !== pid) invalid("Steer接続記録と親Codexが一致しません。");
      return file;
    }
    seen.add(pid); pid = row?.parent_pid;
  }
  invalid("親CodexのSteer接続がありません。aiterm-setup --codex-steer enableを実行し、Codexを再起動してください。");
}

export function windowsSocketConnection(file: string): { url: string; options: { headers: { Authorization: string } } } {
  const record = readWindowsRelay(file);
  const tokenFile = join(dirname(file), "token");
  if (lstatSync(tokenFile).isSymbolicLink() || !lstatSync(tokenFile).isFile()) invalid("Steer認証fileが不正です。");
  const token = readFileSync(tokenFile, "utf8");
  if (!/^[a-f0-9]{64}$/.test(token)) invalid("Steer認証情報が不正です。");
  return { url: record.endpoint, options: { headers: { Authorization: `Bearer ${token}` } } };
}

/** 公式CLIの直接の親がDesktopであり、選択したlauncherの接続先を使っていることを確認する。 */
export function windowsDesktopRelay(launcher: string, rows = readWindowsProcesses(), root = join(dirname(launcher), "sessions")): string | null {
  const parents = new Map(rows.map(row => [row.pid, row]));
  for (const server of rows) {
    if (basename(server.executable).toLowerCase() !== "codex.exe" || !server.command.includes("--ws-token-file")) continue;
    const desktop = parents.get(server.parent_pid);
    if (!desktop || !/\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$/i.test(desktop.executable)) continue;
    if (!rows.some(row => row.parent_pid === desktop.pid && row.executable.toLowerCase() === launcher.toLowerCase())) continue;
    const token = /(?:^|\s)--ws-token-file\s+(?:"([^"]+)"|(\S+))/.exec(server.command);
    const tokenFile = token?.[1] ?? token?.[2];
    if (!tokenFile || !isAbsolute(tokenFile) || basename(tokenFile) !== "token") continue;
    const file = join(dirname(tokenFile), "connection.json");
    const location = relative(root, file);
    if (isAbsolute(location) || location === ".." || location.startsWith("..\\") || location.startsWith("../")) continue;
    if (readWindowsRelay(file, rows).serverPid !== server.pid) invalid("Steer接続記録と親Codexが一致しません。");
    return file;
  }
  return null;
}
