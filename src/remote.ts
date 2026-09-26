// 別端末のAitermをSSH越しに呼ぶ。接続先・鍵・パスフレーズは呼び出しごとに受け取り、Aitermは保存も管理もしない。
// 現地のAitermが起動・hook・transcriptを所有し、ここはMCPとaiterm-waitをSSHのstdioへ中継するだけにする。
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AitermError, observeAgentDone, readAgentTranscriptResult, windowsStartProcessArgumentList, type AgentWaitObservation } from "./core.js";
import { ensureStateRoot } from "./agent-shared.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

// ssh_configの接続名、DNS名、IPv4/IPv6。先頭の`-`はsshのoptionとして解釈されるため受け付けない。
const hostPattern = /^(?!-)[A-Za-z0-9._%:\[\]-]{1,255}$/;
const sshOptionPattern = /^[A-Za-z][A-Za-z0-9]*=[^\r\n]*$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 記録に残してよい接続情報。パスフレーズ本文は含めない。 */
export const remoteTargetSchema = z.object({
  host: z.string().regex(hostPattern),
  user: z.string().regex(/^(?!-)[A-Za-z0-9._@\\-]{1,128}$/).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identity_file: z.string().min(1).optional(),
  passphrase_env: z.string().regex(envNamePattern).optional(),
  ssh_options: z.array(z.string().regex(sshOptionPattern)).max(32).optional(),
}).strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;

export const remoteInputSchema = remoteTargetSchema.extend({
  passphrase: z.string().min(1).optional(),
}).strict().refine((value) => !(value.passphrase && value.passphrase_env), {
  message: "passphraseとpassphrase_envは同時に指定できません",
});
export type RemoteInput = z.infer<typeof remoteInputSchema>;

export const remoteInputDescription =
  "別端末のAitermで実行する時のSSH接続情報。hostだけならssh_configの接続名として使う。" +
  "Aitermは接続情報を保存・管理しない。passphraseは会話記録に残るため、ssh-agentかpassphrase_env（環境変数名）を推奨する。";

// 平文で受け取ったパスフレーズは、このMCP processのメモリにだけ置く。ControlMasterが落ちた後の再接続に使う。
const passphrases = new Map<string, string>();

export function remoteKey(target: RemoteTarget): string {
  return createHash("sha256").update(JSON.stringify([target.host, target.user ?? null, target.port ?? null])).digest("hex").slice(0, 12);
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
  const args = ["-T", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
  // 同じ接続先への後続呼び出しと完了待ちを一本のSSHに相乗りさせる。Windows版OpenSSHはControlMaster非対応。
  if (process.platform !== "win32") {
    args.push("-o", "ControlMaster=auto", "-o", `ControlPath=${path.join(remoteDir(), "cm-%C")}`, "-o", "ControlPersist=600");
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

// POSIX系の非ログイン実行では、~/.local/bin、Homebrew、nvmなどのPATHが入らない端末がある。
// 利用者のログインshellからPATHだけを受け取り、処理は/bin/shで行う。profileの出力やfish等の文法差を
// MCPのstdoutと処理へ持ち込まない。scriptは呼び出し側で検証済みの値だけで組み、単引用符を含めない。
function posixCommand(script: string): string {
  const importPath = 'p=$("${SHELL:-/bin/sh}" -lc env </dev/null 2>/dev/null | sed -n "s/^PATH=//p" | tail -n 1); [ -n "$p" ] && PATH=$p; export PATH';
  return `/bin/sh -c '${importPath}; ${script}'`;
}

/** 現地のaiterm-mcpを起動するコマンド。Windowsはユーザー環境からPATHが入るので、そのまま呼ぶ。 */
export function remoteServerCommand(shell: RemoteShell): string {
  return shell === "posix" ? posixCommand("exec aiterm-mcp") : "aiterm-mcp";
}

export interface RemoteCallResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  remote_version: string | null;
}

/** 現地のaiterm-mcpへ1回だけMCP接続し、指定toolを呼んで閉じる。 */
export async function callRemoteTool(target: RemoteTarget, name: string, args: Record<string, unknown>, timeoutMs = 600_000): Promise<RemoteCallResult> {
  const { args: sshArgs, env } = sshInvocation(target, remoteServerCommand(await remoteShell(target)));
  const transport = new StdioClientTransport({ command: "ssh", args: sshArgs, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
  const client = new Client({ name: "aiterm-remote", version: pkg.version });
  try {
    try { await client.connect(transport, { timeout: 60_000 }); }
    catch (error) {
      const detail = stderr.trim().split("\n").slice(-3).join(" / ") || (error instanceof Error ? error.message : String(error));
      throw new AitermError(`REMOTE_CONNECT_FAILED: ${remoteLabel(target)} のAitermへ接続できません（${detail}）`, 2);
    }
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, resetTimeoutOnProgress: true });
    return {
      content: (result.content as RemoteCallResult["content"]) ?? [],
      ...(result.structuredContent ? { structuredContent: result.structuredContent as Record<string, unknown> } : {}),
      ...(result.isError ? { isError: true } : {}),
      remote_version: client.getServerVersion()?.version ?? null,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_RE = /^sha256:[0-9a-f]{64}$/;

export function remoteWaitCommand(shell: RemoteShell, session: string, cursor: number | null, operationId: string | null, timeout: number): string {
  if (!SESSION_RE.test(session)) throw new AitermError("REMOTE_SESSION_INVALID: session名が不正です", 2);
  if (operationId !== null && !OPERATION_RE.test(operationId)) throw new AitermError("REMOTE_OPERATION_INVALID: operation_idが不正です", 2);
  const parts = ["--session", session, "--timeout", String(timeout)];
  if (cursor !== null) parts.push("--cursor", String(cursor));
  if (operationId !== null) parts.push("--operation", operationId);
  if (shell !== "posix") return `aiterm-wait ${parts.join(" ")}`;
  // npmのbinをPATHへ通さず aiterm-mcp だけリンクしている端末がある。見つからなければ同じpackageのCLIを使う。
  const resolve = 'w=$(command -v aiterm-wait) || w="$(dirname "$(readlink -f "$(command -v aiterm-mcp)")")/aiterm-wait-cli.js"';
  return posixCommand(`${resolve}; exec "$w" ${parts.join(" ")}`);
}

/** 親が別processで起動する完了待ち。ssh越しのaiterm-waitで、exit codeは現地のaiterm-waitをそのまま返す。 */
export async function remoteWaitProcess(target: RemoteTarget, session: string, cursor: number): Promise<{ executable: string; args: string[]; windows_start_process_argument_list: string | null }> {
  // 別processには鍵のパスフレーズを渡せない。ssh-agentか、張ってあるControlMasterの接続に相乗りする。
  const { args } = sshInvocation(target, remoteWaitCommand(await remoteShell(target), session, cursor, null, 600), { passphrase: false });
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
    const command = remoteWaitCommand(await remoteShell(target), session, options.cursor ?? null, options.operation_id ?? null, Math.min(remaining, 86_400));
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
