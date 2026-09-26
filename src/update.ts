// Aitermの更新。npmのglobal導入を新しい版へ入れ替え、新しい版のaiterm-setupで登録と実動作を確かめ直す。
// 別端末はSSHで同じ手順を現地に実行させる。接続先は呼び出しごとに受け取り、保存しない。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import { powershellInvocation } from "./setup-platform.js";
import { remoteLabel, remoteShell, sshInvocation, type RemoteShell, type RemoteTarget } from "./remote.js";

export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SPEC_RE = /^(?:latest|next|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export type UpdateStatus = "updated" | "already_current" | "checked" | "permission_required" | "failed";

export interface UpdateResult {
  schema: "aiterm.update-result.v1";
  target: string;
  status: UpdateStatus;
  from_version: string | null;
  to_version: string | null;
  setup_status: string | null;
  setup_reason_code?: string;
  // 更新前から動いているaiterm-mcp。MCP clientが起動し直すまで旧版のcodeで動く。tmux／psmuxのsessionは残る。
  running_servers: number | null;
  reason_code?: string;
  message?: string;
}

export interface CommandResult { status: number | null; stdout: string; stderr: string; error?: string }
export type UpdateRun = (command: string, args: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv) => CommandResult;

export const runUpdateCommand: UpdateRun = (command, args, timeoutMs = 600_000, env = process.env) => {
  const batch = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);
  const result = spawnSync(batch ? resolveWindowsPowerShell7() : command,
    batch ? powershellInvocation(command, args) : args,
    { encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...(result.error ? { error: result.error.message } : {}) };
};

const npm = () => process.platform === "win32" ? "npm.cmd" : "npm";
const tail = (text: string) => text.trim().split(/\r?\n/u).slice(-3).join(" / ");

function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function installedVersion(root = packageRoot()): string {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
}

/** npm registryで版指定（latest等）を具体的な版へ解決する。 */
export function resolveTargetVersion(spec: string, run: UpdateRun = runUpdateCommand): string {
  if (!SPEC_RE.test(spec)) throw new UpdateError("version_invalid", `版の指定が不正です: ${spec}`);
  const result = run(npm(), ["view", `aiterm-mcp@${spec}`, "version", "--json"], 120_000);
  if (result.status !== 0) throw new UpdateError("registry_unreachable", `npm view が失敗しました: ${tail(result.stderr) || result.error || `exit ${result.status}`}`);
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }
  const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (typeof version !== "string" || !VERSION_RE.test(version)) throw new UpdateError("version_not_found", `aiterm-mcp@${spec} がnpm registryにありません`);
  return version;
}

export class UpdateError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** このprefixから動いているaiterm-mcp（この更新process自身を除く）を数える。数えられない時はnull。 */
export function countRunningServers(prefix: string, run: UpdateRun = runUpdateCommand): number | null {
  if (process.platform === "win32") {
    const literal = `'${join(prefix, "node_modules", "aiterm-mcp", "dist", "index.js").replaceAll("'", "''")}'`;
    const script = `@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${literal}) }).Count`;
    const result = run(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], 30_000);
    const count = Number(result.stdout.trim());
    return result.status === 0 && Number.isInteger(count) ? count : null;
  }
  const result = run("ps", ["-A", "-o", "pid=,args="], 30_000);
  if (result.status !== 0) return null;
  // binのリンク経由（<prefix>/bin/aiterm-mcp）と実体（<prefix>/lib/node_modules/aiterm-mcp/dist/index.js）の両方を数える。
  const paths = [join(prefix, "bin", "aiterm-mcp"), join(prefix, "lib", "node_modules", "aiterm-mcp", "dist", "index.js")];
  return result.stdout.split("\n").filter((line) => {
    const [pid] = line.trim().split(/\s+/u, 1);
    return pid !== "" && Number(pid) !== process.pid && paths.some((path) => line.includes(`${path} `) || line.trimEnd().endsWith(path));
  }).length;
}

function parseLastJson(text: string): Record<string, unknown> | null {
  for (const line of text.trim().split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch { /* setupの途中経過はstderrへ出る。stdoutの最後のJSON行だけを結果とする */ }
  }
  return null;
}

/**
 * npm global導入のprefixを、package自身の場所から求める。POSIXは<prefix>/lib/node_modules、Windowsは
 * <prefix>/node_modulesに入り、binのリンクがprefix側にある。source checkoutや一時cacheはnullを返す。
 * `npm root -g`は使わない（npmはUUIDに見えるpath要素を***へ伏せて出力する）。
 */
export function globalPrefixOf(root: string, platform: NodeJS.Platform = process.platform): string | null {
  let real: string;
  try { real = realpathSync(root); } catch { return null; }
  if (basename(real) !== "aiterm-mcp") return null;
  const modules = dirname(real);
  if (basename(modules) !== "node_modules") return null;
  if (platform === "win32") {
    const prefix = dirname(modules);
    return existsSync(join(prefix, "aiterm-mcp.cmd")) ? prefix : null;
  }
  if (basename(dirname(modules)) !== "lib") return null;
  const prefix = dirname(dirname(modules));
  return existsSync(join(prefix, "bin", "aiterm-mcp")) ? prefix : null;
}

/**
 * この端末のAitermを更新する。npm global以外（source checkout、一時cache）は更新しない。
 * 新しい版の`aiterm-setup --json`を別processで走らせ、登録の張り直しと実動作確認を新しいcodeで行う。
 */
export function updateLocal(options: { version: string; check?: boolean; run?: UpdateRun; root?: string } ): UpdateResult {
  const run = options.run ?? runUpdateCommand;
  const root = options.root ?? packageRoot();
  const base: UpdateResult = {
    schema: "aiterm.update-result.v1", target: "local", status: "failed",
    from_version: null, to_version: null, setup_status: null, running_servers: null,
  };
  try {
    base.from_version = installedVersion(root);
    const prefix = globalPrefixOf(root);
    if (!prefix) {
      throw new UpdateError("global_package_required", `npm install -g aiterm-mcp で入れたAitermだけを更新します（現在: ${root}）`);
    }
    const installed = root;
    const target = VERSION_RE.test(options.version) ? options.version : resolveTargetVersion(options.version, run);
    base.to_version = target;
    base.running_servers = countRunningServers(prefix, run);
    if (options.check) return { ...base, status: "checked" };
    let status: UpdateStatus = "already_current";
    if (target !== base.from_version) {
      // 導入先は動いているAitermの場所から決める。環境変数やnpmrcのprefixが別を指していても、同じ場所を入れ替える。
      const install = run(npm(), ["install", "-g", "--prefix", prefix, `aiterm-mcp@${target}`, "--no-audit", "--no-fund"]);
      if (install.status !== 0) {
        const detail = tail(install.stderr) || install.error || `exit ${install.status}`;
        if (/EACCES|EPERM|permission denied/iu.test(detail)) {
          return { ...base, status: "permission_required", reason_code: "npm_global_not_writable",
            message: `npmのglobal導入先へ書き込めません。管理者権限で npm install -g aiterm-mcp@${target} を実行してから、もう一度 aiterm-update を実行してください（${detail}）` };
        }
        throw new UpdateError("npm_install_failed", `npm install -g aiterm-mcp@${target} が失敗しました: ${detail}`);
      }
      const now = installedVersion(installed);
      if (now !== target) throw new UpdateError("npm_install_unverified", `導入後の版が ${now} です（期待: ${target}）`);
      status = "updated";
    }
    // aiterm-setupは`npm root -g`で自分がglobal導入かを確かめる。環境のprefix設定が別を指していても、更新した場所を見せる。
    const setup = run(process.execPath, [join(installed, "dist", "setup-cli.js"), "--json"], 600_000,
      { ...process.env, npm_config_prefix: prefix, NPM_CONFIG_PREFIX: prefix });
    const setupResult = parseLastJson(setup.stdout);
    base.setup_status = typeof setupResult?.status === "string" ? setupResult.status : null;
    if (typeof setupResult?.reason_code === "string") base.setup_reason_code = setupResult.reason_code;
    if (!base.setup_status) {
      return { ...base, status, reason_code: "setup_failed", message: `aiterm-setup --json が結果を返しません: ${tail(setup.stderr) || setup.error || `exit ${setup.status}`}` };
    }
    return { ...base, status };
  } catch (error) {
    return { ...base, status: "failed", reason_code: error instanceof UpdateError ? error.code : "unexpected",
      message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 現地で実行する1行。現地に`aiterm-update`があればそれを使い、無い（更新機能より古い版）ならnpmで
 * 指定の版を入れてから新しい`aiterm-update`へ渡す。versionは検証済みの具体的な版だけを埋め込む。
 */
export function remoteUpdateCommand(shell: RemoteShell, version: string, check: boolean): string {
  if (!VERSION_RE.test(version)) throw new UpdateError("version_invalid", `版の指定が不正です: ${version}`);
  const args = `--json --version ${version}${check ? " --check" : ""}`;
  const install = `npm install -g aiterm-mcp@${version} --no-audit --no-fund`;
  if (shell === "powershell") {
    return `if (-not (Get-Command aiterm-update -ErrorAction SilentlyContinue)) { ${check ? "Write-Output '{\"schema\":\"aiterm.update-result.v1\",\"status\":\"checked\",\"reason_code\":\"update_command_missing\"}'; exit 0" : `${install} 2>&1 | ForEach-Object { [Console]::Error.WriteLine($_) }; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`} }; aiterm-update ${args}; exit $LASTEXITCODE`;
  }
  if (shell === "cmd") {
    return check
      ? `where aiterm-update >nul 2>nul && aiterm-update ${args} || echo {"schema":"aiterm.update-result.v1","status":"checked","reason_code":"update_command_missing"}`
      : `(where aiterm-update >nul 2>nul || ${install} 1>&2) && aiterm-update ${args}`;
  }
  // POSIXはログインshellのPATHだけを取り込む（remote.tsのposixCommandと同じ理由）。単引用符を含めない。
  const importPath = 'p=$("${SHELL:-/bin/sh}" -lc env </dev/null 2>/dev/null | sed -n "s/^PATH=//p" | tail -n 1); [ -n "$p" ] && PATH=$p; export PATH';
  const missing = check
    ? 'echo "{\\"schema\\":\\"aiterm.update-result.v1\\",\\"status\\":\\"checked\\",\\"reason_code\\":\\"update_command_missing\\"}"; exit 0'
    : `${install} 1>&2 || exit $?`;
  return `/bin/sh -c '${importPath}; command -v aiterm-update >/dev/null 2>&1 || { ${missing}; }; exec aiterm-update ${args}'`;
}

/** 別端末のAitermを同じ版へ更新する。現地の結果JSONへ接続先の表示名を付けて返す。 */
export async function updateRemote(target: RemoteTarget, version: string, check: boolean): Promise<UpdateResult> {
  const label = remoteLabel(target);
  const failed = (reason_code: string, message: string): UpdateResult => ({
    schema: "aiterm.update-result.v1", target: label, status: "failed", from_version: null, to_version: version,
    setup_status: null, running_servers: null, reason_code, message,
  });
  let shell: RemoteShell;
  try { shell = await remoteShell(target); }
  catch (error) { return failed("remote_connect_failed", error instanceof Error ? error.message : String(error)); }
  const { args, env } = sshInvocation(target, remoteUpdateCommand(shell, version, check));
  const outcome = await new Promise<CommandResult>((resolve) => {
    const child = spawn("ssh", args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    child.on("error", (error) => resolve({ status: null, stdout, stderr, error: error.message }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const result = parseLastJson(outcome.stdout);
  if (!result || result.schema !== "aiterm.update-result.v1") {
    return failed("remote_update_failed", `現地の更新が結果を返しません: ${tail(outcome.stderr) || outcome.error || `exit ${outcome.status}`}`);
  }
  return {
    from_version: null, to_version: version, setup_status: null, running_servers: null,
    ...(result as unknown as Partial<UpdateResult>), schema: "aiterm.update-result.v1", target: label,
  } as UpdateResult;
}
