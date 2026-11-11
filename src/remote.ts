// 別端末のAitermをSSH越しに呼ぶ。接続先・鍵・パスフレーズは呼び出しごとに受け取り、Aitermは保存も管理もしない。
// 現地のAitermが起動・hook・transcriptを所有し、ここはMCPとaiterm-waitをSSHのstdioへ中継するだけにする。
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AitermError, observeAgentDone, readAgentTranscriptResult, windowsStartProcessArgumentList, type AgentWaitObservation } from "./core.js";
import { ensureStateRoot, stateRoot } from "./agent-shared.js";
import { currentUid } from "./state-root.js";
import { PRIVATE_ENV_SCHEMA } from "./private-env.js";
import { RemoteTerminalError, SshStdioTransport, classifySshFailure, trustedSshArguments } from "./remote-terminal.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string; bin: Record<string, string> };

import { remoteTargetSchema, remoteInputSchema, remoteInputDescription, type RemoteTarget, type RemoteInput } from "./remote-contract.js";
export { remoteTargetSchema, remoteInputSchema, remoteInputDescription, type RemoteTarget, type RemoteInput } from "./remote-contract.js";

// 平文で受け取ったパスフレーズは、このMCP processのメモリにだけ置く。ControlMasterが落ちた後の再接続に使う。
const passphrases = new Map<string, string>();

export function remoteKey(target: RemoteTarget): string {
  return createHash("sha256").update(JSON.stringify([target.host, target.user ?? null, target.port ?? null, target.trusted_ref ?? null])).digest("hex").slice(0, 12);
}

export function remoteLabel(target: RemoteTarget): string {
  return `${target.user ? `${target.user}@` : ""}${target.host}${target.port ? `:${target.port}` : ""}`;
}

/** 入力から記録用の接続情報を取り出し、平文パスフレーズはメモリへ退避する。 */
export function acceptRemote(input: RemoteInput): RemoteTarget {
  const { passphrase, ...target } = input;
  if (passphrase) passphrases.set(remoteKey(target), passphrase);
  return target;
}

function remoteDir(): string {
  const dir = path.join(ensureStateRoot(), "remote");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function controlPath(trustedRef?: string): string {
  // TMPDIRやXDG_RUNTIME_DIRは長くなり得る。%Cの40字とOpenSSHの一時suffix（17字）を含めても
  // macOSの104 byte制限に収まる短い領域へ、state rootごとに共有ソケットだけを置く。
  const namespace = createHash("sha256").update(stateRoot()).digest("hex").slice(0, 20);
  const dir = path.join("/tmp", `aiterm-ssh-${namespace}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // 共有/tmpに先に作られた他者の領域やsymlinkを使わず、既存領域の権限も変更しない。
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== currentUid() || (stat.mode & 0o777) !== 0o700) {
    throw new AitermError("REMOTE_CONTROL_DIR_INVALID: SSH共有ソケットの領域が自分所有の0700ディレクトリではありません", 2);
  }
  // A trusted binding never shares a master opened by an ad-hoc target to the same host.
  return path.join(dir, trustedRef ? `t-${trustedRef.slice(0, 8)}-%C` : "cm-%C");
}

function askpassScript(): string {
  const file = path.join(remoteDir(), "askpass.sh");
  const body = "#!/bin/sh\nprintf '%s\\n' \"$AITERM_SSH_PASSPHRASE\"\n";
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== body) {
    fs.writeFileSync(file, body, { mode: 0o700 });
    fs.chmodSync(file, 0o700);
  }
  return file;
}

function passphraseFor(target: RemoteTarget): string | null {
  if (target.passphrase_env) {
    const value = process.env[target.passphrase_env];
    if (!value) throw new AitermError(`REMOTE_PASSPHRASE_ENV_MISSING: 環境変数 ${target.passphrase_env} がありません`, 2);
    return value;
  }
  return passphrases.get(remoteKey(target)) ?? null;
}

/** sshへ渡す引数と環境。remoteCommandは現地のログインshellで実行する。 */
export function sshInvocation(target: RemoteTarget, remoteCommand: string, options: { passphrase?: boolean } = {}): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string" && !key.startsWith("AITERM_SSH_")) env[key] = value;
  if (target.trusted_ref) return { args: trustedSshArguments(target.trusted_ref, remoteCommand, process.platform === "win32" ? null : controlPath(target.trusted_ref)), env };
  const args = ["-T", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
  // 同じ接続先への後続呼び出しと完了待ちを一本のSSHに相乗りさせる。Windows版OpenSSHはControlMaster非対応。
  if (process.platform !== "win32") {
    args.push("-o", "ControlMaster=auto", "-o", `ControlPath=${controlPath()}`, "-o", "ControlPersist=600");
  }
  const passphrase = options.passphrase === false ? null : passphraseFor(target);
  if (passphrase) {
    if (process.platform === "win32") throw new AitermError("REMOTE_PASSPHRASE_UNSUPPORTED: Windowsの呼び出し元ではssh-agentを使ってください", 2);
    env.SSH_ASKPASS = askpassScript();
    env.SSH_ASKPASS_REQUIRE = "force";
    env.AITERM_SSH_PASSPHRASE = passphrase;
    env.DISPLAY ??= "aiterm:0";
    args.push("-o", "NumberOfPasswordPrompts=1");
  } else {
    args.push("-o", "BatchMode=yes");
  }
  if (target.user) args.push("-l", target.user);
  if (target.port) args.push("-p", String(target.port));
  if (target.identity_file) args.push("-i", target.identity_file, "-o", "IdentitiesOnly=yes");
  for (const option of target.ssh_options ?? []) args.push("-o", option);
  args.push("--", target.host, remoteCommand);
  return { args, env };
}

/** 接続先でsshdが起動するshellの系統。コマンドの書式だけがここで分かれる。 */
export type RemoteShell = "posix" | "powershell" | "cmd";

// どのshellでも実行できる1行で系統を見分ける。cmdは%OS%を、PowerShellは$PSHOMEを展開し、POSIX系はどちらも展開しない。
export const REMOTE_SHELL_PROBE = "echo aiterm-probe %OS% $PSHOME";

export function classifyRemoteShell(output: string): RemoteShell {
  const tokens = output.split(/\s+/).filter(Boolean);
  if (tokens.includes("Windows_NT")) return "cmd";
  const marker = tokens.indexOf("aiterm-probe");
  if (marker >= 0 && tokens.length > marker + 2 && tokens[marker + 1] === "%OS%") return "powershell";
  return "posix";
}

// 判定結果はこのMCP processの間だけ覚える。接続先の一覧としては保存しない。
const shells = new Map<string, Promise<RemoteShell>>();

export function remoteShell(target: RemoteTarget): Promise<RemoteShell> {
  const key = remoteKey(target);
  let shell = shells.get(key);
  if (!shell) {
    shell = runSsh(target, REMOTE_SHELL_PROBE).then(({ code, stdout, stderr }) => {
      if (code === 255) {
        if (target.trusted_ref) { const failure = classifySshFailure(stderr); throw new RemoteTerminalError(failure.code, failure.message, failure.action); }
        const detail = stderr.trim().split("\n").slice(-3).join(" / ") || "exit 255";
        throw new AitermError(`REMOTE_CONNECT_FAILED: ${remoteLabel(target)} へ接続できません（${detail}）`, 2);
      }
      return classifyRemoteShell(stdout);
    });
    shell.catch(() => shells.delete(key));
    shells.set(key, shell);
  }
  return shell;
}

/** 端末のOS（remote-terminal.md R20）。 */
export type RemotePlatform = "macos" | "linux" | "windows";

// 上のshell判定に続けて`uname -s`を流す。POSIX系は最後の行がDarwin/Linux。cmdは行全体が1つのechoになり、PowerShellでは`uname`が無く何も出ない。
export const REMOTE_PLATFORM_PROBE = `${REMOTE_SHELL_PROBE}; uname -s`;

/** probeの出力からOSを決める。Windows・macOS・Linuxのどれとも言えない出力はnull（推測しない）。 */
export function classifyRemotePlatform(output: string): RemotePlatform | null {
  const shell = classifyRemoteShell(output);
  if (shell === "cmd") return "windows";
  const last = output.trim().split(/\r?\n/).pop()?.trim();
  if (last === "Darwin") return "macos";
  if (last === "Linux") return "linux";
  // POSIX系のprobe行は`aiterm-probe %OS%`で1行目が終わる（unameの行が付くので、classifyRemoteShellはPowerShellと数える）。それ以外のDarwin/Linuxでない出力は未知のOS。
  return shell === "powershell" && output.trim().split(/\r?\n/)[0].trim() !== "aiterm-probe %OS%" ? "windows" : null;
}

const platforms = new Map<string, Promise<RemotePlatform | null>>();

/** 端末のOSを1回だけ調べて、このprocessの間 接続先ごとに覚える。 */
export function remotePlatform(target: RemoteTarget): Promise<RemotePlatform | null> {
  const key = remoteKey(target);
  let platform = platforms.get(key);
  if (!platform) {
    platform = runSsh(target, REMOTE_PLATFORM_PROBE).then(({ code, stdout, stderr }) => {
      if (code === 255) {
        if (target.trusted_ref) { const failure = classifySshFailure(stderr); throw new RemoteTerminalError(failure.code, failure.message, failure.action); }
        const detail = stderr.trim().split("\n").slice(-3).join(" / ") || "exit 255";
        throw new AitermError(`REMOTE_CONNECT_FAILED: ${remoteLabel(target)} へ接続できません（${detail}）`, 2);
      }
      const found = classifyRemotePlatform(stdout);
      // The same run tells which shell sshd starts, so a command build needs no second probe (T4).
      if (found && !shells.has(key)) shells.set(key, Promise.resolve(found !== "windows" ? "posix" : classifyRemoteShell(stdout) === "cmd" ? "cmd" : "powershell"));
      return found;
    });
    platform.catch(() => platforms.delete(key));
    platforms.set(key, platform);
  }
  return platform;
}

// POSIX系の非ログイン実行では、~/.local/bin、Homebrew、nvmなどのPATHが入らない端末がある。
// 利用者のログインshellからPATHだけを受け取り、処理は/bin/shで行う。profileの出力やfish等の文法差を
// MCPのstdoutと処理へ持ち込まない。scriptは呼び出し側で検証済みの値だけで組み、単引用符を含めない。
// provisionで入れた製品のruntime（remote-terminal.md R16）があれば、利用者のPATH上の別のaiterm-mcp・tmuxより先に使う。
export function posixCommand(script: string): string {
  const importPath = 'p=$("${SHELL:-/bin/sh}" -lc env </dev/null 2>/dev/null | sed -n "s/^PATH=//p" | tail -n 1); [ -n "$p" ] && PATH=$p; ' +
    'r="$HOME/.aiterm/runtime/current/bin"; [ -x "$r/aiterm-mcp" ] && PATH="$r:$PATH"; export PATH';
  return `/bin/sh -c '${importPath}; ${script}'`;
}

// ---- 信頼済み端末のコマンド（remote-terminal.md R21）。固定の操作を、sshdが起動するshellの書式へ直す。 ----

/** 端末のshellごとの同じ操作。posixは/bin/shの1行、windowsはPowerShell 5.1・7のどちらでも通る本文。 */
export interface TerminalScript { posix: string; windows: string }

/** PowerShellの単引用符literal。`'`だけが特別で、`$`・空白・二重引用符・非ASCIIはそのまま文字になる。 */
export const powershellQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** `& 'prog' 'arg'...`。引数は全て単引用符で包む。 */
export const powershellInvoke = (argv: string[]): string => `& ${argv.map(powershellQuote).join(" ")}`;

/** 固定のプログラム呼び出し。windowsのaiterm-*は、無い時に言語によらず読める`command not found`を出す。 */
export function terminalProgram(argv: string[]): TerminalScript {
  const [program] = argv;
  const file = program.startsWith("aiterm-") ? pkg.bin[program]?.replace(/^dist\//, "") : undefined;
  return {
    // npm may link only aiterm-mcp onto PATH: then the program runs from the same package; else the shell's exit 127.
    posix: file ? `p=$(command -v ${program}) || p="$(dirname "$(readlink -f "$(command -v aiterm-mcp)")")/${file}"; [ -x "$p" ] || p=${program}; exec "$p" ${argv.slice(1).join(" ")}`.trimEnd()
      : `exec ${argv.join(" ")}`,
    windows: `${program.startsWith("aiterm-") ? `if (-not (Get-Command ${powershellQuote(program)} -ErrorAction SilentlyContinue)) { [Console]::Error.WriteLine(${powershellQuote(`${program}: command not found`)}); exit 127 }; ` : ""}${powershellInvoke(argv)}`,
  };
}

// 製品のruntime（remote-terminal.md R16）があれば、利用者のPATH上の別のaiterm-mcpより先に使う。
// npm's .ps1 shims win over .cmd in PowerShell, and Windows PowerShell 5.1 is Restricted by default: allow scripts for this process only.
const WINDOWS_PREAMBLE = "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue; $r = Join-Path $env:USERPROFILE '.aiterm\\runtime\\current\\bin'; if (Test-Path -LiteralPath (Join-Path $r 'aiterm-mcp.cmd')) { $env:PATH = $r + ';' + $env:PATH }; ";
// `pwsh -c`は最後のnative commandの失敗を全て1にする。ここで本物の終了codeを返す。
const WINDOWS_EPILOGUE = "; $ok = $?; $code = $LASTEXITCODE; if ($code) { exit $code }; if ($ok) { exit 0 }; exit 1";

/** PowerShell本文を、shellが`cmd`の時だけ`powershell -EncodedCommand`で包む（引用符の書式がcmdとPowerShellで違うため）。 */
export function powershellForShell(shell: "powershell" | "cmd", body: string): string {
  return shell === "powershell" ? body
    : `powershell -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ${Buffer.from(body, "utf16le").toString("base64")}`;
}

/** 端末のshellに合う1つのコマンド文字列。userの文字列はここへ入れない（固定文・検証済みtoken・base64だけ）。 */
export function terminalCommand(shell: RemoteShell, script: TerminalScript): string {
  return shell === "posix" ? posixCommand(script.posix) : powershellForShell(shell, `${WINDOWS_PREAMBLE}${script.windows}${WINDOWS_EPILOGUE}`);
}

/** stdinに載せたPowerShell scriptを丸ごと実行する入口（authorize-key・Windows provision）。scriptは多行・ASCIIだけ。 */
export const WINDOWS_STDIN_SCRIPT_COMMAND = powershellForShell("cmd", "Invoke-Expression ([Console]::In.ReadToEnd())");

/** 現地のaiterm-mcpを起動するコマンド。Windowsはユーザー環境からPATHが入るので、そのまま呼ぶ。 */
export function remoteServerCommand(shell: RemoteShell): string {
  return shell === "posix" ? posixCommand("exec aiterm-mcp") : "aiterm-mcp";
}

export interface RemoteCallResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  remote_version: string | null;
}

export const REMOTE_CLIENT_NAME = "aiterm-remote";
/** 現地のaiterm-mcpへ1回だけMCP接続し、指定toolを呼んで閉じる。privateEnvは暗号化されたstdinの先頭行だけで渡す（remote-terminal.md R5）。 */
export async function callRemoteTool(target: RemoteTarget, name: string, args: Record<string, unknown>, timeoutMs = 600_000,
  privateEnv?: Record<string, string>, meta?: Record<string, unknown>): Promise<RemoteCallResult> {
  if (privateEnv && !target.trusted_ref) throw new AitermError("REMOTE_PRIVATE_ENV_UNSUPPORTED: private values travel only to a terminal binding", 2);
  const shell = await remoteShell(target);
  // 信頼済み端末はshellごとの正規のコマンド（runtimeの優先と終了codeを含む）。個別指定のremoteは従来のまま。
  const command = target.trusted_ref ? terminalCommand(shell, terminalProgram(privateEnv ? ["aiterm-mcp", "--private-env-stdin"] : ["aiterm-mcp"]))
    : privateEnv ? posixCommand("exec aiterm-mcp --private-env-stdin") : remoteServerCommand(shell);
  const { args: sshArgs, env } = sshInvocation(target, command);
  const transport = privateEnv
    ? new SshStdioTransport(sshArgs, `${JSON.stringify({ schema: PRIVATE_ENV_SCHEMA, env: privateEnv })}\n`)
    : new StdioClientTransport({ command: "ssh", args: sshArgs, env, stderr: "pipe" });
  let stderr = "";
  if (transport instanceof StdioClientTransport) transport.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
  const client = new Client({ name: REMOTE_CLIENT_NAME, version: pkg.version });
  try {
    try { await client.connect(transport, { timeout: 60_000 }); }
    catch (error) {
      if (transport instanceof SshStdioTransport) stderr = transport.stderr;
      if (target.trusted_ref) {
        const failure = classifySshFailure(stderr);
        throw new AitermError(`${failure.code}: ${failure.message}${failure.action ? ` (${failure.action})` : ""}`, 2);
      }
      const detail = stderr.trim().split("\n").slice(-3).join(" / ") || (error instanceof Error ? error.message : String(error));
      throw new AitermError(`REMOTE_CONNECT_FAILED: ${remoteLabel(target)} のAitermへ接続できません（${detail}）`, 2);
    }
    // Request _meta is opaque to the relay; progressToken belongs to this hop's client, not the caller's.
    const { progressToken: _hop, ...forwarded } = meta ?? {};
    const request = Object.keys(forwarded).length ? { name, arguments: args, _meta: forwarded } : { name, arguments: args };
    const result = await client.callTool(request, undefined, { timeout: timeoutMs, resetTimeoutOnProgress: true });
    return {
      content: (result.content as RemoteCallResult["content"]) ?? [],
      ...(result.structuredContent ? { structuredContent: result.structuredContent as Record<string, unknown> } : {}),
      ...(result.isError ? { isError: true } : {}),
      ...(result._meta ? { _meta: result._meta as Record<string, unknown> } : {}),
      remote_version: client.getServerVersion()?.version ?? null,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_RE = /^sha256:[0-9a-f]{64}$/;

export function remoteWaitCommand(shell: RemoteShell, session: string, cursor: number | null, operationId: string | null, timeout: number, inputId?: string, trusted = false, steerId?: string): string {
  if (!SESSION_RE.test(session)) throw new AitermError("REMOTE_SESSION_INVALID: session名が不正です", 2);
  if (operationId !== null && !OPERATION_RE.test(operationId)) throw new AitermError("REMOTE_OPERATION_INVALID: operation_idが不正です", 2);
  if (inputId !== undefined && (!/^[a-f0-9]{32}$/.test(inputId) || cursor === null)) throw new AitermError("REMOTE_INPUT_INVALID: input_id requires its original cursor", 2);
  if (steerId !== undefined && (!/^[0-9a-f]{16}$/.test(steerId) || cursor === null || inputId !== undefined || operationId !== null)) throw new AitermError("REMOTE_STEER_INVALID: steer_id requires its cursor alone", 2);
  const parts = ["--session", session, "--timeout", String(timeout)];
  if (cursor !== null) parts.push("--cursor", String(cursor));
  if (operationId !== null) parts.push("--operation", operationId);
  if (inputId !== undefined) parts.push("--input", inputId);
  if (steerId !== undefined) parts.push("--steer", steerId);
  if (trusted) return terminalCommand(shell, terminalProgram(["aiterm-wait", ...parts]));
  if (shell !== "posix") return `aiterm-wait ${parts.join(" ")}`;
  return posixCommand(terminalProgram(["aiterm-wait", ...parts]).posix);
}

/** 親が別processで起動する完了待ち。ssh越しのaiterm-waitで、exit codeは現地のaiterm-waitをそのまま返す。 */
export async function remoteWaitProcess(target: RemoteTarget, session: string, cursor: number, inputId?: string, steerId?: string): Promise<{ executable: string; args: string[]; windows_start_process_argument_list: string | null }> {
  // 別processには鍵のパスフレーズを渡せない。ssh-agentか、張ってあるControlMasterの接続に相乗りする。
  const { args } = sshInvocation(target, remoteWaitCommand(await remoteShell(target), session, cursor, null, 600, inputId, !!target.trusted_ref, steerId), { passphrase: false });
  return { executable: "ssh", args, windows_start_process_argument_list: process.platform === "win32" ? windowsStartProcessArgumentList(args) : null };
}

type ObserveOptions = Parameters<typeof observeAgentDone>[1] & { remote?: RemoteTarget };

function runSsh(target: RemoteTarget, command: string, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { args, env } = sshInvocation(target, command);
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => { signal?.removeEventListener("abort", abort); resolve({ code, stdout, stderr }); });
  });
}

const RECONNECT_DELAY_MS = 15_000;

/** 現地のaiterm-waitで子の完了を観測する。SSHが切れた時は同じcursorで観測し直す。 */
export async function observeRemoteAgentDone(target: RemoteTarget, session: string, options: ObserveOptions): Promise<AgentWaitObservation> {
  const infinite = options.timeout === Infinity || options.timeout === undefined;
  const deadline = infinite ? Infinity : Date.now() + (options.timeout ?? 0) * 1000;
  for (;;) {
    if (options.signal?.aborted) throw new AitermError("REMOTE_OBSERVE_ABORTED: 観測を停止しました", 2);
    const remaining = infinite ? 86_400 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const command = remoteWaitCommand(await remoteShell(target), session, options.cursor ?? null, options.operation_id ?? null, Math.min(remaining, 86_400), options.input_id, !!target.trusted_ref);
    const { code, stdout, stderr } = await runSsh(target, command, options.signal);
    if (options.signal?.aborted) throw new AitermError("REMOTE_OBSERVE_ABORTED: 観測を停止しました", 2);
    const line = stdout.trim().split("\n").pop() ?? "";
    let parsed: any = null;
    try { parsed = line ? JSON.parse(line) : null; } catch { parsed = null; }
    if (parsed && parsed.schema === "aiterm.agent-wait-result.v1") {
      const observation = parsed as AgentWaitObservation;
      if (observation.outcome === "timeout" && (infinite || Date.now() < deadline)) continue;
      return observation;
    }
    if (parsed && parsed.ok === false) {
      throw new AitermError(`REMOTE_WAIT_FAILED: ${remoteLabel(target)} の完了観測が失敗しました（${parsed.code}: ${parsed.message}）`, 2);
    }
    // 255はssh自身の失敗。現地のセッションは生きているので、同じcursorでつなぎ直す。
    if (code === 255 && (infinite || Date.now() < deadline)) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      continue;
    }
    const detail = stderr.trim().split("\n").slice(-3).join(" / ") || `exit ${code}`;
    throw new AitermError(`REMOTE_WAIT_FAILED: ${remoteLabel(target)} の完了観測が失敗しました（${detail}）`, 2);
  }
}

/** 配送用の回答本文を現地のharness記録から取る。完了と別のturnの本文は渡さない。 */
export async function readRemoteAgentAnswer(target: RemoteTarget, session: string, options: { completion?: AgentWaitObservation; operation_id?: string | null }): Promise<{ text: string }> {
  const result = await callRemoteTool(target, "pty_read", {
    session_id: session, agent_transcript: true, raw: true,
    ...(options.operation_id ? { operation_id: options.operation_id } : {}),
  }, 120_000);
  const structured = result.structuredContent as { text?: unknown; turn_id?: unknown } | undefined;
  if (result.isError || !structured || typeof structured.text !== "string") {
    const message = result.content.map((item) => item.text).join("\n").slice(0, 500);
    throw new AitermError(`REMOTE_ANSWER_UNAVAILABLE: ${remoteLabel(target)} から回答を取得できません（${message}）`, 2);
  }
  const expected = options.completion?.turn_id ?? null;
  if (expected && structured.turn_id && structured.turn_id !== expected) {
    throw new AitermError("REMOTE_ANSWER_REPLACED: 回収対象の完了情報が置換されました。別の回答は配送しません", 2);
  }
  return { text: structured.text };
}

/** 配送managerが使う観測。remoteがあれば現地へ、なければ従来どおりこの端末で観測する。 */
export function observeAnywhere(session: string, options: ObserveOptions): Promise<AgentWaitObservation> {
  const { remote, ...rest } = options;
  return remote ? observeRemoteAgentDone(remote, session, rest) : observeAgentDone(session, rest);
}

export async function answerAnywhere(
  session: string,
  options: Parameters<typeof readAgentTranscriptResult>[1] & { remote?: RemoteTarget },
): Promise<{ text: string }> {
  const { remote, ...rest } = options ?? {};
  return remote ? readRemoteAgentAnswer(remote, session, rest) : readAgentTranscriptResult(session, rest);
}

/** Resolves with `value` after `ms` of event-loop time: a stretch the loop spent blocked counts at most 150 ms. */
export function loopDeadline<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => {
    let left = ms, last = performance.now();
    const step = () => {
      const now = performance.now();
      left -= Math.min(now - last, 150);
      last = now;
      if (left <= 0) resolve(value); else setTimeout(step, 100).unref();
    };
    setTimeout(step, 100).unref();
  });
}
