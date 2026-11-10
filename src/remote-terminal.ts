// Bound remote terminal (remote-terminal.md). Runs only as the UID that can read the terminal key:
// the key is loaded into a per-connection private ssh-agent and never leaves this process.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ensureStateRoot, writeJson0600 } from "./agent-shared.js";
import { WAIT_RESOLVE, powershellForShell, remotePlatform, remoteShell, terminalCommand, terminalProgram, type RemotePlatform, type RemoteShell, type TerminalScript } from "./remote.js";
import { PRIVATE_ENV_SCHEMA } from "./private-env.js";
import { checkRemotePath } from "./remote-path.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export class RemoteTerminalError extends Error {
  constructor(readonly code: string, message: string, readonly action?: string) { super(`${code}: ${message}`); }
}

export interface RemoteTarget { host: string; user: string; port: number }
export interface Binding { ref: string; target: RemoteTarget; key_file: string | null; known_hosts_file: string; host_key_alias: string | null; created_at: string; seat_forward_port?: number; seat_ingress_port?: number }

const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST = /^(?!-)[A-Za-z0-9._:\[\]-]{1,255}$/;
const USER = /^(?!-)[A-Za-z0-9._-]{1,64}$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

export function validTarget(value: unknown): RemoteTarget {
  const t = value as RemoteTarget;
  if (!t || typeof t !== "object" || !HOST.test(String(t.host)) || !USER.test(String(t.user))
    || !Number.isInteger(t.port) || t.port < 1 || t.port > 65535 || Object.keys(t).some(key => !["host", "user", "port"].includes(key)))
    throw new RemoteTerminalError("TARGET_INVALID", "target must be {host, user, port}");
  return { host: t.host, user: t.user, port: t.port };
}

// ---- binding store (UID-private) ----

// Durable and independent of the caller's env (the state root follows AITERM_STATE_BASE/TMPDIR, a binding must not).
export function storePath(): string {
  const dir = path.join(os.homedir(), ".config", "aiterm");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "remote-bindings.json");
}

function readStore(): Binding[] {
  let text: string;
  try { text = fs.readFileSync(storePath(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new RemoteTerminalError("BINDING_STORE_UNREADABLE", "the binding store cannot be read");
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schema !== "aiterm.remote-bindings.v1" || !Array.isArray(parsed.bindings)) throw new Error("schema");
    return parsed.bindings;
  } catch { throw new RemoteTerminalError("BINDING_STORE_UNREADABLE", "the binding store is not valid"); }
}

export function binding(ref: string): Binding {
  if (!REF.test(ref)) throw new RemoteTerminalError("REF_INVALID", "ref must be a UUID");
  const found = readStore().find(item => item.ref === ref);
  if (!found) throw new RemoteTerminalError("BINDING_UNKNOWN", "no binding has this ref");
  return found;
}

/** Without keyFile the key comes from a credential handle at open/launch; without knownHostsFile Aiterm keeps an empty one per binding. */
export function registerBinding(input: { target: RemoteTarget; keyFile?: string | null; knownHostsFile?: string | null; hostKeyAlias?: string | null }): RemoteBindingStatus {
  const target = validTarget(input.target);
  for (const file of [input.keyFile, input.knownHostsFile]) {
    if (file && !path.isAbsolute(file)) throw new RemoteTerminalError("PATH_INVALID", "key and known_hosts paths must be absolute");
  }
  if (input.hostKeyAlias != null && !HOST.test(input.hostKeyAlias)) throw new RemoteTerminalError("ALIAS_INVALID", "host key alias is not a host name");
  const bindings = readStore();
  const ref = randomUUID();
  let knownHostsFile = input.knownHostsFile || null;
  if (!knownHostsFile) {
    const dir = path.join(path.dirname(storePath()), "known_hosts.d");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    knownHostsFile = path.join(dir, ref);
    fs.writeFileSync(knownHostsFile, "", { mode: 0o600, flag: "wx" });
  }
  const next: Binding = { ref, target, key_file: input.keyFile || null, known_hosts_file: knownHostsFile,
    host_key_alias: input.hostKeyAlias ?? null, created_at: new Date().toISOString() };
  writeJson0600(storePath(), { schema: "aiterm.remote-bindings.v1", bindings: [...bindings, next] });
  return bindingStatus(next.ref);
}

// ---- status: public metadata only ----

export interface RemoteBindingStatus {
  schema: "aiterm.remote-binding-status.v1";
  ref: string;
  target: RemoteTarget;
  credential: { provider: "aiterm.native-ssh-key.v1" | "aiterm.credential-handle.v1"; revision: string | null; fingerprint: string | null; available: boolean; reason: string | null };
  trust: { provider: "aiterm.known-hosts.v1"; revision: string | null; fingerprints: string[]; available: boolean; reason: string | null };
}

function keyFingerprint(blob: Buffer): string {
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

export function publicKey(keyFile: string): { line: string; blob: Buffer } | { reason: string } {
  if (!fs.existsSync(keyFile)) return { reason: "KEY_MISSING" };
  // Empty passphrase only: a passphrase-protected key cannot be used without a prompt.
  const result = spawnSync("ssh-keygen", ["-y", "-P", "", "-f", keyFile], { encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) return { reason: /passphrase|incorrect/i.test(result.stderr ?? "") ? "KEY_PASSPHRASE_REQUIRED" : "KEY_UNREADABLE" };
  const fields = result.stdout.trim().split(/\s+/);
  return { line: `${fields[0]} ${fields[1]}`, blob: Buffer.from(fields[1] ?? "", "base64") };
}

function knownHostName(b: Binding): string {
  return b.host_key_alias ?? (b.target.port === 22 ? b.target.host : `[${b.target.host}]:${b.target.port}`);
}

/** Matching known_hosts entries, normalized to "keytype blob" (marker kept), sorted. */
export function parseKnownHostsMatches(output: string): string[] {
  return output.split("\n").filter(line => line && !line.startsWith("#")).map(line => {
    const fields = line.trim().split(/\s+/);
    const marker = fields[0].startsWith("@") ? `${fields.shift()} ` : "";
    return `${marker}${fields[1]} ${fields[2]}`;
  }).sort();
}

function trustEntries(b: Binding): string[] | { reason: string } {
  if (!fs.existsSync(b.known_hosts_file)) return { reason: "KNOWN_HOSTS_UNREADABLE" };
  const result = spawnSync("ssh-keygen", ["-F", knownHostName(b), "-f", b.known_hosts_file], { encoding: "utf8", timeout: 10_000 });
  if (result.status === 1) return { reason: "HOST_TRUST_MISSING" };
  if (result.status !== 0) return { reason: "KNOWN_HOSTS_UNREADABLE" };
  const entries = parseKnownHostsMatches(result.stdout);
  return entries.length ? entries : { reason: "HOST_TRUST_MISSING" };
}

const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

export function bindingStatus(ref: string): RemoteBindingStatus {
  const b = binding(ref);
  const key = b.key_file ? publicKey(b.key_file) : null;
  const trust = trustEntries(b);
  return {
    schema: "aiterm.remote-binding-status.v1", ref, target: b.target,
    credential: key === null
      ? { provider: "aiterm.credential-handle.v1", revision: null, fingerprint: null, available: false, reason: "KEY_FROM_CREDENTIAL" }
      : "reason" in key
      ? { provider: "aiterm.native-ssh-key.v1", revision: null, fingerprint: null, available: false, reason: key.reason }
      : { provider: "aiterm.native-ssh-key.v1", revision: digest(key.line), fingerprint: keyFingerprint(key.blob), available: true, reason: null },
    trust: Array.isArray(trust)
      ? { provider: "aiterm.known-hosts.v1", revision: digest(trust.join("\n")), available: true, reason: null,
        fingerprints: trust.map(entry => keyFingerprint(Buffer.from(entry.split(" ").at(-1)!, "base64"))) }
      : { provider: "aiterm.known-hosts.v1", revision: null, fingerprints: [], available: false, reason: trust.reason },
  };
}

/** Scan once; write the key only when it equals the fingerprint the Owner confirmed. A scan alone is never trust. */
export function confirmHostKey(ref: string, fingerprint: string): RemoteBindingStatus {
  if (!FINGERPRINT.test(fingerprint)) throw new RemoteTerminalError("FINGERPRINT_INVALID", "fingerprint must be SHA256:<base64>");
  const b = binding(ref);
  const scan = spawnSync("ssh-keyscan", ["-T", "10", "-p", String(b.target.port), b.target.host], { encoding: "utf8", timeout: 20_000 });
  const keys = (scan.stdout ?? "").split("\n").filter(line => line && !line.startsWith("#")).map(line => line.trim().split(/\s+/))
    .filter(fields => fields.length >= 3);
  // No key at all is an asleep/offline terminal, not another machine.
  if (keys.length === 0) throw new RemoteTerminalError("UNREACHABLE", "the terminal presented no host key (asleep, offline or not accepting SSH)");
  const matched = keys.find(fields => keyFingerprint(Buffer.from(fields[2], "base64")) === fingerprint);
  if (!matched) throw new RemoteTerminalError("HOST_KEY_FINGERPRINT_MISMATCH", "the terminal did not present the confirmed host key");
  const name = knownHostName(b);
  if (fs.existsSync(b.known_hosts_file)) spawnSync("ssh-keygen", ["-R", name, "-f", b.known_hosts_file], { timeout: 10_000 });
  fs.appendFileSync(b.known_hosts_file, `${name} ${matched[1]} ${matched[2]}\n`, { mode: 0o600 });
  fs.rmSync(`${b.known_hosts_file}.old`, { force: true });
  return bindingStatus(ref);
}

// ---- connection ----

export function classifySshFailure(stderr: string): { code: string; message: string; action?: string } {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(stderr))
    return { code: "HOST_KEY_MISMATCH", message: "the terminal presented a different host key", action: "confirm the new host key" };
  if (/Host key verification failed|No .* host key is known/i.test(stderr))
    return { code: "HOST_TRUST_MISSING", message: "the terminal's host key is not trusted", action: "confirm the new host key" };
  if (/Permission denied|Too many authentication failures/i.test(stderr)) return { code: "AUTH_FAILED", message: "the terminal refused the key" };
  // POSIX, our own Windows guard (any language), and the English cmd / PowerShell wording when it names an Aiterm program.
  if (/aiterm-[\w-]+: (command )?not found|aiterm-[\w-]+: No such file|aiterm-[\w-]+['"]? is not recognized as (an internal or external command|(the|a) name of a cmdlet)/i.test(stderr))
    return { code: "REMOTE_AITERM_UNAVAILABLE", message: "Aiterm is not installed on the terminal" };
  if (/Connection refused/i.test(stderr)) return { code: "CONNECTION_REFUSED", message: "the terminal refused the SSH connection" };
  if (/timed out|No route to host|Network is unreachable|Could not resolve|Connection closed|Connection reset/i.test(stderr))
    return { code: "UNREACHABLE", message: "the terminal cannot be reached" };
  return { code: "CONNECTION_FAILED", message: "the SSH connection failed" };
}

/** -R spec for the seats' BellTeam MCP (remote-terminal.md R12). P=0 lets the terminal's sshd pick the port; D comes from the binding. */
export function seatForwardSpec(terminalPort: number, ingressPort: number): string {
  return `127.0.0.1:${terminalPort}:127.0.0.1:${ingressPort}`;
}

/** ssh stderr -> the allocated terminal port, "refused", or null while unknown. */
export function parseSeatForward(stderr: string): number | "refused" | null {
  const allocated = /Allocated port (\d+) for remote forward/.exec(stderr);
  if (allocated) return Number(allocated[1]);
  return /remote port forwarding failed/i.test(stderr) ? "refused" : null;
}

/** Seat MCP URLs (path /api/seat-mcp...) get the forward's terminal-local origin; everything else stays as given. */
export function rewriteSeatMcpConfig(config: Record<string, unknown>, port: number): Record<string, unknown> {
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object") return config;
  const rewritten: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers as Record<string, unknown>)) {
    const url = (server as { url?: unknown } | null)?.url;
    let parsed: URL | null = null;
    try { parsed = typeof url === "string" ? new URL(url) : null; } catch { /* not a URL: unchanged */ }
    rewritten[name] = parsed && /^\/api\/seat-mcp(\/|$)/.test(parsed.pathname)
      ? { ...(server as object), url: `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}` }
      : server;
  }
  return { ...config, mcpServers: rewritten };
}

export function sshArguments(b: Binding, agentSocket: string, identityFile: string, remoteCommand: string): string[] {
  return ["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${b.known_hosts_file}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "CheckHostIP=no",
    ...(b.host_key_alias ? ["-o", `HostKeyAlias=${b.host_key_alias}`] : []),
    "-o", `IdentityAgent=${agentSocket}`, "-o", "IdentitiesOnly=yes", "-o", `IdentityFile=${identityFile}`,
    "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
    "-l", b.target.user, "-p", String(b.target.port), "--", b.target.host, remoteCommand];
}

export function sshEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/** MCP over an ssh child whose stdin first carries the private env line (remote-terminal.md R5). */
export class SshStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  stderr = "";
  private readonly buffer = new ReadBuffer();
  private child: ChildProcess | null = null;
  constructor(private readonly args: string[], private readonly privateLine: string) {}
  async start(): Promise<void> {
    const child = spawn("ssh", this.args, { env: sshEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr!.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4000); });
    child.stdout!.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    });
    child.on("error", error => this.onerror?.(error));
    child.on("close", () => { this.child = null; this.onclose?.(); });
    child.stdin!.on("error", error => this.onerror?.(error));
    child.stdin!.write(this.privateLine);
  }
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child?.stdin) throw new RemoteTerminalError("CONNECTION_LOST", "the terminal connection is closed");
    this.child.stdin.write(serializeMessage(message));
  }
  async close(): Promise<void> { this.child?.kill(); }
}

export const REMOTE_SEAT_TOOLS = new Set(["agent_launch", "pty_send", "pty_observe", "pty_read", "pty_key", "claude_turn", "agent_stop", "pty_close"]);
export type RemoteTerminalEvent = { type: "ready"; at: string; remoteVersion: string } | { type: "lost"; at: string; code: "CONNECTION_LOST" } | { type: "closed"; at: string };
export type RemoteCommandOp = "claude_version" | "claude_install" | "claude_update" | "path_status" | "make_dir" | "list_dirs"
  | "cli_version" | "cli_install" | "cli_update" | "cli_auth_status";
export const REMOTE_COMMAND_OPS = ["claude_version", "claude_install", "claude_update", "path_status", "make_dir", "list_dirs",
  "cli_version", "cli_install", "cli_update", "cli_auth_status"] as const;
export const CLI_HARNESSES = ["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"] as const;
export type CliHarness = typeof CLI_HARNESSES[number];
type CliOp = "cli_version" | "cli_install" | "cli_update" | "cli_auth_status";
const CLAUDE_ALIASES: Record<string, CliOp> = { claude_version: "cli_version", claude_install: "cli_install", claude_update: "cli_update" };

// One entry per CLI (remote-terminal.md R10). Posix scripts sit inside `/bin/sh -c '...'`: no single quote in them.
// `auth` is the official non-interactive status check, `classify` its answer: true / false, null = not a clear answer
// (the same commands and readings as the local agent_auth status in harnesses/*.ts).
interface CliSpec {
  bin: string; posixDir: string; winPath: string; install: { posix: string | null; windows: string | null }; auth: string[];
  classify: (code: number | null, stdout: string, stderr: string) => boolean | null; recheckMs?: number;
}
const posixInstall = (url: string, shell = "bash") => `curl -fsSL ${url} | ${shell} 2>&1`;
// A failure stops with exit 1 and its message (the official installers are `irm | iex`).
const windowsInstall = (url: string) => `& { $ErrorActionPreference = 'Stop'; try { irm ${url} | iex } catch { $_.Exception.Message; exit 1 } } *>&1; exit 0`;
const readJson = (text: string): any => { try { return JSON.parse(text.trim()); } catch { return null; } };

const CLI: Record<CliHarness, CliSpec> = {
  "claude-code": { bin: "claude", posixDir: "$HOME/.local/bin", winPath: "Join-Path $env:USERPROFILE '.local\\bin\\claude.exe'",
    install: { posix: posixInstall("https://claude.ai/install.sh"), windows: windowsInstall("https://claude.ai/install.ps1") },
    auth: ["auth", "status", "--json"],
    classify: (code, out) => { const j = readJson(out); return j?.loggedIn === false ? false : j?.loggedIn === true && code === 0 ? true : null; } },
  "codex-cli": { bin: "codex", posixDir: "$HOME/.local/bin", winPath: "Join-Path $env:LOCALAPPDATA 'Programs\\OpenAI\\Codex\\bin\\codex.exe'",
    install: { posix: posixInstall("https://chatgpt.com/codex/install.sh", "CODEX_NON_INTERACTIVE=true sh"), windows: windowsInstall("https://chatgpt.com/codex/install.ps1") },
    auth: ["login", "status"],
    classify: (code, out, err) => { const t = `${out}\n${err}`; return /Not logged in/i.test(t) ? false : code === 0 && /Logged in/i.test(t) ? true : null; } },
  "grok-cli": { bin: "grok", posixDir: "$HOME/.grok/bin", winPath: "Join-Path $env:USERPROFILE '.grok\\bin\\grok.exe'",
    install: { posix: posixInstall("https://x.ai/cli/install.sh"), windows: windowsInstall("https://x.ai/cli/install.ps1") },
    auth: ["models"], recheckMs: 1500,
    classify: (code, out, err) => { const t = `${out}\n${err}`; return /You are not authenticated|Not signed in/i.test(t) ? false : code === 0 && /Available models/i.test(t) ? true : null; } },
  "cursor-cli": { bin: "cursor-agent", posixDir: "$HOME/.local/bin", winPath: "Join-Path $env:LOCALAPPDATA 'cursor-agent\\cursor-agent.cmd'",
    install: { posix: "curl https://cursor.com/install -fsS | bash 2>&1", windows: "& { $ErrorActionPreference = 'Stop'; try { irm 'https://cursor.com/install?win32=true' | iex } catch { $_.Exception.Message; exit 1 } } *>&1; exit 0" },
    auth: ["status"],
    classify: (code, out, err) => { const t = `${out}\n${err}`;
      return /not logged in|unauthenticated|sign in/i.test(t) ? false : /unable to fetch user details/i.test(t) ? null : code === 0 ? true : null; } },
  "antigravity-cli": { bin: "agy", posixDir: "$HOME/.local/bin", winPath: "Join-Path $env:LOCALAPPDATA 'agy\\bin\\agy.exe'",
    install: { posix: posixInstall("https://antigravity.google/cli/install.sh"), windows: windowsInstall("https://antigravity.google/cli/install.ps1") },
    auth: ["models"],
    classify: (code, out, err) => code === 0 && /^\S+\t.+/m.test(out) ? true : /Please sign in to view available models/.test(err) ? false : null },
};

/** Version of a CLI: on PATH, else in its installer's place (a login shell may not have that on PATH yet). */
const cliVersionScript = (c: CliSpec): TerminalScript => ({
  posix: `${c.bin} --version 2>&1 || "${c.posixDir}/${c.bin}" --version 2>&1`,
  windows: `$p = (Get-Command ${c.bin} -ErrorAction SilentlyContinue).Source; if (-not $p) { $p = ${c.winPath} }; & $p --version 2>&1`,
});
const cliUpdateScript = (c: CliSpec): TerminalScript => ({ posix: `${c.bin} update 2>&1`, windows: `${c.bin} update 2>&1` });
/** Exit 127 when the CLI is in neither place, so "not installed" is told from "not logged in". */
const cliAuthScript = (c: CliSpec): TerminalScript => ({
  posix: `b=$(command -v ${c.bin}) || b="${c.posixDir}/${c.bin}"; [ -x "$b" ] || exit 127; "$b" ${c.auth.join(" ")}`,
  windows: `$p = (Get-Command ${c.bin} -ErrorAction SilentlyContinue).Source; if (-not $p) { $p = ${c.winPath}; if (-not (Test-Path -LiteralPath $p)) { exit 127 } }; & $p ${c.auth.join(" ")}`,
});

/** The remote command the forward keeper holds: it ends exactly when ssh's stdin closes. */
export function keeperCommand(shell: RemoteShell): string {
  return shell === "posix" ? "cat >/dev/null" : powershellForShell(shell, "[Console]::In.ReadToEnd() | Out-Null");
}

const WAIT_FLAGS = new Set(["--session", "--operation", "--timeout", "--cursor", "--steer", "--launch", "--input"]);
const WAIT_VALUE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** wait_process.args minus the CLI path: only aiterm-wait's own flag/value pairs, each value a plain token. */
export function waitArguments(args: unknown): string[] {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new RemoteTerminalError("WAIT_INVALID", "wait_process.args must be strings");
  const rest = args[0]?.startsWith("--") ? args : args.slice(1);
  if (rest.length === 0 || rest.length % 2 !== 0) throw new RemoteTerminalError("WAIT_INVALID", "wait_process has no flags");
  for (let i = 0; i < rest.length; i += 2)
    if (!WAIT_FLAGS.has(rest[i]) || !WAIT_VALUE.test(rest[i + 1])) throw new RemoteTerminalError("WAIT_INVALID", `unsupported wait argument ${rest[i]}`);
  if (!rest.includes("--session")) throw new RemoteTerminalError("WAIT_INVALID", "wait_process needs --session");
  return rest;
}

export function versionAtLeast(actual: string, required: string): boolean {
  const a = actual.split(/[.-]/).slice(0, 3).map(Number), r = required.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (r[i] ?? 0)) return (a[i] ?? 0) > (r[i] ?? 0);
  return true;
}

// The first release with --private-env-stdin and the transcript reader on the terminal.
export const REMOTE_MINIMUM_VERSION = "0.65.0";
// The first release with the terminal's path-status / make-dir (R15).
export const REMOTE_PATH_OPS_VERSION = "0.69.0";
export const REMOTE_LIST_DIRS_VERSION = "0.70.0";
// The first release whose terminal-side path operations know drive paths.
export const REMOTE_WINDOWS_PATH_VERSION = "0.70.8";
// The first release of the harness-generic cli_* ops, and the first a terminal may run Grok, Cursor and Antigravity seats on.
export const REMOTE_CLI_OPS_VERSION = "0.70.9";

export class RemoteTerminalConnection extends EventEmitter {
  private closing = false;
  private constructor(private readonly b: Binding, private readonly dir: string, private readonly agent: ChildProcess,
    private readonly socket: string, private readonly identity: string, private readonly client: Client, readonly remoteVersion: string,
    readonly platform: RemotePlatform, private readonly shell: RemoteShell) { super(); }

  static async open(input: { ref: string; target: unknown; os?: RemotePlatform; trustRevision: string; credentialRevision?: string; credential?: CredentialHandle;
    sudoCredential?: CredentialHandle; privateEnv?: Record<string, string> }): Promise<RemoteTerminalConnection> {
    const target = validTarget(input.target);
    const b = binding(input.ref);
    if (b.target.host !== target.host || b.target.user !== target.user || b.target.port !== target.port)
      throw new RemoteTerminalError("TARGET_MISMATCH", "the target differs from the registered binding");
    const status = bindingStatus(input.ref);
    if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "host trust is unavailable", "confirm the new host key");
    if (status.trust.revision !== input.trustRevision) throw new RemoteTerminalError("HOST_TRUST_STALE", "the host trust revision changed; re-read status");
    checkKeySource(input.ref, status, input);
    for (const [name, value] of Object.entries(input.privateEnv ?? {}))
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string") throw new RemoteTerminalError("PRIVATE_ENV_INVALID", "invalid private env entry");
    // R20: the connect command is shell-specific, so the platform is known (and the declared os checked) before any MCP connection.
    const platform = await checkTerminalPlatform(trustedTarget(b), input.os);
    const shell = await remoteShell(trustedTarget(b));
    // Short path: the agent socket must fit macOS's 104-byte sun_path.
    const dir = fs.mkdtempSync(path.join(os.platform() === "win32" ? os.tmpdir() : "/tmp", "aiterm-rt-"));
    fs.chmodSync(dir, 0o700);
    const socket = path.join(dir, "a.sock");
    const agent = spawn("ssh-agent", ["-D", "-a", socket], { env: sshEnvironment(), stdio: ["ignore", "ignore", "ignore"] });
    const cleanup = () => { agent.kill(); fs.rmSync(dir, { recursive: true, force: true }); };
    try {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(socket)) {
        if (Date.now() > deadline || agent.exitCode !== null) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the private agent did not start");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // A keyless binding authenticates with the credential agent loaded by credential-load (R13); checkKeySource checked it.
      const loaded = b.key_file ? null : readCredential(b.ref)!;
      let agentSocket = socket, identity = path.join(dir, "id.pub");
      if (loaded) { agentSocket = loaded.socket; identity = credentialPublicKeyFile(b.ref); }
      else {
        const keyFile = b.key_file!;
        const added = spawnSync("ssh-add", ["-q", keyFile], { env: { ...sshEnvironment(), SSH_AUTH_SOCK: socket }, stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
        if (added.status !== 0) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the key could not be loaded");
        const key = publicKey(keyFile);
        if ("reason" in key) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", key.reason);
        fs.writeFileSync(identity, `${key.line}\n`, { mode: 0o600 });
      }
      const transport = new SshStdioTransport(sshArguments(b, agentSocket, identity, terminalCommand(shell, terminalProgram(["aiterm-mcp", "--private-env-stdin"]))),
        `${JSON.stringify({ schema: PRIVATE_ENV_SCHEMA, env: input.privateEnv ?? {} })}\n`);
      const client = new Client({ name: "aiterm-remote-terminal", version: pkg.version });
      try { await client.connect(transport, { timeout: 60_000 }); }
      catch {
        const failure = classifySshFailure(transport.stderr);
        throw new RemoteTerminalError(failure.code, failure.message, failure.action);
      }
      const remoteVersion = client.getServerVersion()?.version ?? "0.0.0";
      // An older terminal would ignore the private env line and launch without the private values.
      if (!versionAtLeast(remoteVersion, REMOTE_MINIMUM_VERSION)) {
        await client.close().catch(() => {});
        throw new RemoteTerminalError("REMOTE_AITERM_TOO_OLD", `the terminal runs Aiterm ${remoteVersion}; ${REMOTE_MINIMUM_VERSION} or later is required`);
      }
      const connection = new RemoteTerminalConnection(b, dir, agent, agentSocket, identity, client, remoteVersion, platform, shell);
      client.onclose = () => connection.ended();
      // After the caller has attached its listener to the returned connection.
      setImmediate(() => connection.emit("event", { type: "ready", at: new Date().toISOString(), remoteVersion } satisfies RemoteTerminalEvent));
      return connection;
    } catch (error) { cleanup(); throw error; }
  }

  private ended(): void {
    const at = new Date().toISOString();
    this.agent.kill();
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.emit("event", (this.closing ? { type: "closed", at } : { type: "lost", at, code: "CONNECTION_LOST" }) satisfies RemoteTerminalEvent);
  }

  async call(name: string, args: Record<string, unknown>, options: { private?: { appendSystemPrompt?: string; mcpConfig?: Record<string, unknown> }; timeoutMs?: number } = {}): Promise<unknown> {
    if (!REMOTE_SEAT_TOOLS.has(name)) throw new RemoteTerminalError("TOOL_UNSUPPORTED", `${name} is not a bound seat tool`);
    if (options.private && name !== "agent_launch") throw new RemoteTerminalError("PRIVATE_OPTIONS_UNSUPPORTED", "private options apply to agent_launch only");
    const full = { ...args,
      ...(options.private?.appendSystemPrompt !== undefined ? { append_system_prompt: options.private.appendSystemPrompt } : {}),
      ...(options.private?.mcpConfig !== undefined ? { mcp_config: options.private.mcpConfig } : {}) };
    try {
      return await this.client.callTool({ name, arguments: full }, undefined, { timeout: options.timeoutMs ?? 600_000, resetTimeoutOnProgress: true });
    } catch (error) {
      if (this.client.transport === undefined) throw new RemoteTerminalError("CONNECTION_LOST", "the terminal connection was lost");
      throw error;
    }
  }

  private exec(script: TerminalScript, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("ssh", sshArguments(this.b, this.socket, this.identity, terminalCommand(this.shell, script)), { env: sshEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      signal?.addEventListener("abort", () => child.kill(), { once: true });
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  }

  async transcriptRead(input: { sessionName: string; cursor: { claudeSessionId: string; offset: number } | null; maxBytes?: number }): Promise<unknown> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.sessionName)) throw new RemoteTerminalError("SESSION_INVALID", "invalid session name");
    const parts = ["transcript-read", "--session", input.sessionName];
    if (input.cursor) {
      if (!/^[0-9a-f-]{36}$/i.test(input.cursor.claudeSessionId) || !Number.isSafeInteger(input.cursor.offset) || input.cursor.offset < 0)
        throw new RemoteTerminalError("TRANSCRIPT_CURSOR_INVALID", "invalid cursor");
      parts.push("--cursor-session", input.cursor.claudeSessionId, "--offset", String(input.cursor.offset));
    }
    if (input.maxBytes !== undefined) {
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) throw new RemoteTerminalError("TRANSCRIPT_MAX_INVALID", "invalid maxBytes");
      parts.push("--max-bytes", String(input.maxBytes));
    }
    const result = await this.exec(terminalProgram(["aiterm-remote-terminal", ...parts]), 120_000);
    const line = result.stdout.trim().split("\n").pop() ?? "";
    let parsed: any = null;
    try { parsed = JSON.parse(line); } catch { /* classified below */ }
    if (result.code === 0 && parsed?.schema === "aiterm.transcript-read.v1") return parsed;
    if (parsed?.code) throw new RemoteTerminalError(parsed.code, parsed.message ?? "transcript read failed");
    if (result.code === 255) { const f = classifySshFailure(result.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    throw new RemoteTerminalError("COMMAND_FAILED", "the transcript reader failed on the terminal");
  }

  /** Run the terminal's aiterm-wait with the flags of a receipt's wait_process; its one-line JSON comes back unchanged. */
  async wait(waitProcess: { args: unknown }, signal?: AbortSignal): Promise<unknown> {
    const flags = waitArguments(waitProcess?.args);
    // Same resolution as remoteWaitCommand: npm may link only aiterm-mcp.
    const result = await this.exec({ posix: `${WAIT_RESOLVE}; exec "$w" ${flags.join(" ")}`, windows: terminalProgram(["aiterm-wait", ...flags]).windows }, 90_000_000, signal);
    if (signal?.aborted) throw new RemoteTerminalError("WAIT_CANCELLED", "the wait was cancelled");
    const line = result.stdout.trim().split("\n").pop() ?? "";
    try { return JSON.parse(line); }
    catch {
      if (result.code === 255) { const f = classifySshFailure(result.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
      throw new RemoteTerminalError("COMMAND_FAILED", "aiterm-wait returned no receipt");
    }
  }

  async command(op: RemoteCommandOp, targetPath?: string, harness?: string): Promise<unknown> {
    if (harness !== undefined && !op.startsWith("cli_")) throw new RemoteTerminalError("COMMAND_INVALID", `${op} takes no harness`);
    if (op === "path_status" || op === "make_dir") return this.pathCommand(op, targetPath);
    if (op === "list_dirs") return this.listDirs(targetPath);
    if (targetPath !== undefined) throw new RemoteTerminalError("COMMAND_INVALID", `${op} takes no path`);
    const alias = CLAUDE_ALIASES[op];
    const cliOp = alias ?? op;
    if (!cliOp.startsWith("cli_")) throw new RemoteTerminalError("COMMAND_UNSUPPORTED", "unknown op");
    const h = alias ? "claude-code" : harness;
    if (!h || !Object.hasOwn(CLI, h)) throw new RemoteTerminalError("COMMAND_INVALID", `${op} needs harness: one of ${CLI_HARNESSES.join(", ")}`);
    if (!alias && !versionAtLeast(this.remoteVersion, REMOTE_CLI_OPS_VERSION))
      throw new RemoteTerminalError("REMOTE_AITERM_TOO_OLD", `the terminal runs Aiterm ${this.remoteVersion}; ${REMOTE_CLI_OPS_VERSION} or later is required (update Aiterm on the terminal)`);
    const spec = CLI[h as CliHarness];
    if (cliOp === "cli_auth_status") return this.cliAuthStatus(h as CliHarness, spec);
    const cell = this.shell === "posix" ? "posix" : "windows";
    const installer = spec.install[cell];
    if (cliOp === "cli_install" && installer === null) throw new RemoteTerminalError("CLI_INSTALL_UNSUPPORTED", `no official one-line installer is known for ${h} on ${this.platform}`);
    const script = cliOp === "cli_version" ? cliVersionScript(spec) : cliOp === "cli_update" ? cliUpdateScript(spec) : { posix: spec.install.posix ?? "", windows: spec.install.windows ?? "" };
    const run = await this.exec(script, cliOp === "cli_version" ? 60_000 : 900_000);
    if (run.code === 255) { const f = classifySshFailure(run.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    const probe = cliOp === "cli_version" ? run : await this.exec(cliVersionScript(spec), 60_000);
    const version = probe.code === 0 ? (/\d+\.\d+\.\d+\S*/.exec(probe.stdout)?.[0] ?? null) : null;
    const result = { exit_code: run.code, version, output_tail: run.stdout.slice(-2000) };
    return alias ? { op, ...result } : { op, harness: h, ...result };
  }

  /** The login state and nothing of the CLI's own answer: `{op, harness, logged_in}`. */
  private async cliAuthStatus(h: CliHarness, spec: CliSpec): Promise<{ op: string; harness: string; logged_in: boolean }> {
    const ask = async () => {
      const r = await this.exec(cliAuthScript(spec), 60_000);
      if (r.code === 255) { const f = classifySshFailure(r.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
      if (r.code === 127) throw new RemoteTerminalError("CLI_NOT_INSTALLED", `${h} is not installed on the terminal (neither on PATH nor in its installer's place)`);
      return spec.classify(r.code, r.stdout, r.stderr);
    };
    let answer = await ask();
    // A live login can answer "not authenticated" once while it refreshes an old token (grokAuthStatus asks again the same way).
    if (answer === false && spec.recheckMs) { await new Promise(resolve => setTimeout(resolve, spec.recheckMs)); answer = await ask(); }
    if (answer === null) throw new RemoteTerminalError("AUTH_STATUS_UNCONFIRMED", `the login state of ${h} could not be read from its status answer`);
    return { op: "cli_auth_status", harness: h, logged_in: answer };
  }

  /** R15: the terminal's own fs answers; the path travels as base64 so no shell reads it. */
  private async pathCommand(op: "path_status" | "make_dir", targetPath: string | undefined): Promise<{ op: string; exists: boolean; directory: boolean; writable: boolean }> {
    checkRemotePath(targetPath, this.platform === "windows" ? "windows" : "posix");
    const minimum = this.platform === "windows" ? REMOTE_WINDOWS_PATH_VERSION : REMOTE_PATH_OPS_VERSION;
    if (!versionAtLeast(this.remoteVersion, minimum))
      throw new RemoteTerminalError("REMOTE_AITERM_TOO_OLD", `the terminal runs Aiterm ${this.remoteVersion}; ${minimum} or later is required (provision the terminal)`);
    const sub = op === "path_status" ? "path-status" : "make-dir";
    const result = await this.exec(terminalProgram(["aiterm-remote-terminal", sub, "--path-base64", Buffer.from(targetPath, "utf8").toString("base64")]), 60_000);
    if (result.code === 255) { const f = classifySshFailure(result.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    let parsed: any = null;
    try { parsed = JSON.parse(result.stdout.trim().split("\n").pop() ?? ""); } catch { /* classified below */ }
    if (result.code === 0 && parsed?.schema === "aiterm.remote-path.v1")
      return { op, exists: parsed.exists === true, directory: parsed.directory === true, writable: parsed.writable === true };
    if (parsed?.code) throw new RemoteTerminalError(parsed.code, parsed.message ?? "path operation failed");
    throw new RemoteTerminalError("COMMAND_FAILED", "the path operation failed on the terminal");
  }

  /** R15 list-dirs: read-only folder picker listing; no path lists the SSH user's home. */
  private async listDirs(targetPath: string | undefined): Promise<unknown> {
    if (targetPath !== undefined) checkRemotePath(targetPath, this.platform === "windows" ? "windows" : "posix");
    const minimum = this.platform === "windows" ? REMOTE_WINDOWS_PATH_VERSION : REMOTE_LIST_DIRS_VERSION;
    if (!versionAtLeast(this.remoteVersion, minimum))
      throw new RemoteTerminalError("REMOTE_AITERM_TOO_OLD", `the terminal runs Aiterm ${this.remoteVersion}; ${minimum} or later is required (update or provision the terminal)`);
    const flag = targetPath === undefined ? [] : ["--path-base64", Buffer.from(targetPath, "utf8").toString("base64")];
    const result = await this.exec(terminalProgram(["aiterm-remote-terminal", "list-dirs", ...flag]), 60_000);
    if (result.code === 255) { const f = classifySshFailure(result.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    let parsed: any = null;
    try { parsed = JSON.parse(result.stdout.trim().split("\n").pop() ?? ""); } catch { /* classified below */ }
    if (result.code === 0 && parsed?.schema === "aiterm.remote-dirs.v1") {
      const { home, path: listed, exists, directory, entries, truncated } = parsed;
      return { op: "list_dirs", home, path: listed, exists, directory, entries, truncated };
    }
    if (parsed?.code) throw new RemoteTerminalError(parsed.code, parsed.message ?? "folder listing failed");
    throw new RemoteTerminalError("COMMAND_FAILED", "the folder listing failed on the terminal");
  }

  async close(): Promise<{ closed: true }> {
    this.closing = true;
    await this.client.close().catch(() => {});
    return { closed: true };
  }
}

// ---- terminal seats: the launch tools' `terminal` argument (remote-terminal.md "One launch path") ----

export interface CredentialHandle { handle: string; revision: number }
export interface TerminalArgument { ref: string; target: RemoteTarget; os?: RemotePlatform; trustRevision: string; credentialRevision?: string; credential?: CredentialHandle; sudoCredential?: CredentialHandle }

/** T1 key source: a credential handle (its revision checked by the resolver) or the binding's native key revision, never both. */
function checkKeySource(ref: string, status: RemoteBindingStatus, input: { credentialRevision?: string; credential?: CredentialHandle }): void {
  if (input.credential) {
    if (input.credentialRevision !== undefined)
      throw new RemoteTerminalError("TERMINAL_INVALID", "give credential or credentialRevision, not both: with a credential handle the registry omits credentialRevision");
    if (status.credential.provider !== "aiterm.credential-handle.v1")
      throw new RemoteTerminalError("TERMINAL_INVALID", "this terminal has a native key; pass credentialRevision instead of credential");
    const loaded = readCredential(ref);
    if (!loaded || loaded.handle !== input.credential.handle || !agentAlive(loaded.socket))
      throw new RemoteTerminalError("CREDENTIAL_NOT_LOADED", "the terminal's credential is not loaded; resolve the handle and run credential-load, then launch again");
    if (loaded.revision !== input.credential.revision)
      throw new RemoteTerminalError("CREDENTIAL_REVISION_STALE", "the loaded credential has another revision; run credential-load with the current one, then launch again");
    return;
  }
  if (status.credential.provider === "aiterm.credential-handle.v1")
    throw new RemoteTerminalError("CREDENTIAL_REQUIRED", "this terminal has no native key; pass the terminal's credential handle from the registry");
  if (!status.credential.available) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", status.credential.reason ?? "the key is unavailable");
  if (status.credential.revision !== input.credentialRevision)
    throw new RemoteTerminalError("CREDENTIAL_REVISION_STALE", "the key changed; get the current value from the terminal registry and launch again");
}
/** What remote.ts calls: the binding's own host/user/port and its ref. Built only here, never from tool input. */
export interface TrustedRemoteTarget { host: string; user: string; port: number; trusted_ref: string }

export const trustedTarget = (b: Binding): TrustedRemoteTarget => ({ host: b.target.host, user: b.target.user, port: b.target.port, trusted_ref: b.ref });

/** R20/T4: the terminal's real platform (macOS, Linux or Windows). A declared os that differs is a wrong target; any other system is refused. */
export async function checkTerminalPlatform(target: TrustedRemoteTarget, declared?: RemotePlatform): Promise<RemotePlatform> {
  const actual = await remotePlatform(target);
  if (actual === null) throw new RemoteTerminalError("TERMINAL_PLATFORM_UNSUPPORTED", "the terminal is not a macOS, Linux or Windows system (the platform probe printed nothing recognisable)");
  if (declared !== undefined && declared !== actual)
    throw new RemoteTerminalError("TERMINAL_OS_MISMATCH", `the terminal is registered as ${declared} but runs ${actual}; correct the terminal's os or register the right machine`);
  return actual;
}

/** T1: the binding exists, the target is the binding's, both revisions are current. */
export function terminalRemoteTarget(input: TerminalArgument): TrustedRemoteTarget {
  const b = binding(input.ref);
  const target = validTarget(input.target);
  if (b.target.host !== target.host || b.target.user !== target.user || b.target.port !== target.port)
    throw new RemoteTerminalError("TARGET_MISMATCH", "terminal.target differs from this binding; get the current value from the terminal registry");
  const status = bindingStatus(input.ref);
  if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "the terminal's host key is not trusted (confirm the new host key)");
  if (status.trust.revision !== input.trustRevision) throw new RemoteTerminalError("HOST_TRUST_STALE", "the host trust changed; get the current value from the terminal registry and launch again");
  checkKeySource(input.ref, status, input);
  return trustedTarget(b);
}

/** ssh argv for a trusted target: no user config, the binding's known_hosts only, its key file only. */
export function trustedSshArguments(ref: string, remoteCommand: string | null, controlPath: string | null, extra: string[] = []): string[] {
  const b = binding(ref);
  let identity: string[];
  if (b.key_file) identity = ["-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes", "-o", `IdentityFile=${b.key_file}`];
  else {
    // R13: only the key credential-load put into this terminal's private agent (its public half selects it).
    const loaded = readCredential(ref);
    if (!loaded || !fs.existsSync(loaded.socket))
      throw new RemoteTerminalError("CREDENTIAL_NOT_LOADED", "the terminal's credential is not loaded; resolve the handle and run credential-load");
    identity = ["-o", `IdentityAgent=${loaded.socket}`, "-o", "IdentitiesOnly=yes", "-o", `IdentityFile=${credentialPublicKeyFile(ref)}`];
  }
  return ["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${b.known_hosts_file}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "CheckHostIP=no",
    ...(b.host_key_alias ? ["-o", `HostKeyAlias=${b.host_key_alias}`] : []),
    ...identity,
    ...(controlPath ? ["-o", "ControlMaster=auto", "-o", `ControlPath=${controlPath}`, "-o", "ControlPersist=600"] : ["-o", "ControlMaster=no", "-o", "ControlPath=none"]),
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", ...extra,
    "-l", b.target.user, "-p", String(b.target.port), "--", b.target.host, ...(remoteCommand === null ? [] : [remoteCommand])];
}

// T2: which sessions live on which terminal. Small; read on every call so every Aiterm process sees the same map.
function seatsFile(): string { return path.join(ensureStateRoot(), "terminal-seats.json"); }
function readSeats(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(seatsFile(), "utf8"));
    return parsed?.schema === "aiterm.terminal-seats.v1" && parsed.seats && typeof parsed.seats === "object" ? parsed.seats : {};
  } catch { return {}; }
}
function writeSeats(seats: Record<string, string>): void { writeJson0600(seatsFile(), { schema: "aiterm.terminal-seats.v1", seats }); }
export function bindTerminalSession(session: string, ref: string): void { writeSeats({ ...readSeats(), [session]: ref }); }
export function unbindTerminalSession(session: string): void {
  const seats = readSeats();
  if (!(session in seats)) return;
  delete seats[session];
  writeSeats(seats);
}
/** Bound sessions grouped by terminal, for relaying a session-less call (pty_list seat_turns). An unreadable binding is skipped. */
export function terminalSeatGroups(): Array<{ target: TrustedRemoteTarget; sessions: string[] }> {
  const groups = new Map<string, string[]>();
  for (const [session, ref] of Object.entries(readSeats())) groups.set(ref, [...groups.get(ref) ?? [], session]);
  return [...groups].flatMap(([ref, sessions]) => { try { return [{ target: trustedTarget(binding(ref)), sessions }]; } catch { return []; } });
}
/** A later call's target, by session only. null = a local session. */
export function boundTerminalTarget(session: unknown): TrustedRemoteTarget | null {
  if (typeof session !== "string") return null;
  const ref = readSeats()[session];
  return ref ? trustedTarget(binding(ref)) : null;
}

const SEAT_PATH = /^\/api\/seat-mcp(\/|$)/;
/** The one container port D of the seat URLs (R12), or null without seat URLs. */
export function seatIngressPort(config: Record<string, unknown>): number | null {
  const ports = new Set<number>();
  for (const server of Object.values((config.mcpServers ?? {}) as Record<string, { url?: unknown }>)) {
    let url: URL;
    try { if (typeof server?.url !== "string") continue; url = new URL(server.url); } catch { continue; }
    if (!SEAT_PATH.test(url.pathname)) continue;
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new RemoteTerminalError("SEAT_FORWARD_UNAVAILABLE", "seat MCP URLs must be http://127.0.0.1:<port>/api/seat-mcp");
    ports.add(Number(url.port || 80));
  }
  if (ports.size > 1) throw new RemoteTerminalError("SEAT_FORWARD_UNAVAILABLE", "seat MCP URLs name different ports");
  return ports.size ? [...ports][0] : null;
}

/** Header values leave the config file: each becomes ${AITERM_MCP_HEADER_n}, its value goes to the private env line. */
export function extractMcpHeaders(config: Record<string, unknown>): { config: Record<string, unknown>; env: Record<string, string> } {
  const env: Record<string, string> = {};
  const servers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries((config.mcpServers ?? {}) as Record<string, unknown>)) {
    const headers = (server as { headers?: unknown } | null)?.headers;
    if (!headers || typeof headers !== "object") { servers[name] = server; continue; }
    const moved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      // Already an env reference: Claude expands it from the seat env (the name must be in env_vars).
      if (typeof value !== "string" || value.includes("${")) { moved[key] = value; continue; }
      const envName = `AITERM_MCP_HEADER_${Object.keys(env).length}`;
      env[envName] = value;
      moved[key] = `\${${envName}}`;
    }
    servers[name] = { ...(server as object), headers: moved };
  }
  return { config: config.mcpServers ? { ...config, mcpServers: servers } : config, env };
}

// ---- R12 forward keeper: one Aiterm process per terminal holds the seats' BellTeam MCP route (T3) ----

const FORWARD_RESTART_MS = 15_000, FORWARD_REFUSALS_BEFORE_NEW_PORT = 4, LAUNCH_GRACE_MS = 120_000;
interface Keeper { child: ChildProcess | null; ingress: number; refusals: number; timer: NodeJS.Timeout | null; launchUntil: number; starting?: boolean }
const keepers = new Map<string, Keeper>();
let maintainTimer: NodeJS.Timeout | null = null;
let credentialWatch: fs.FSWatcher | null = null;

function writeBinding(ref: string, change: Partial<Binding>): void {
  const bindings = readStore().map(item => item.ref === ref ? { ...item, ...change } : item);
  writeJson0600(storePath(), { schema: "aiterm.remote-bindings.v1", bindings });
}

function lockFile(ref: string): string { return path.join(ensureStateRoot(), `terminal-forward-${ref}.lock`); }
/** T3: true when this process holds the keeper lock for ref (taking it from a dead owner). */
function holdLock(ref: string): boolean {
  const file = lockFile(ref);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
      let pid = 0;
      try { pid = Number(JSON.parse(fs.readFileSync(file, "utf8")).pid); } catch { /* unreadable: treat as dead */ }
      if (pid === process.pid) return true;
      // shortcut: a reused pid looks alive; the next owner check after that process exits takes over.
      try { if (pid > 0) { process.kill(pid, 0); return false; } } catch { /* owner gone */ }
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}
function releaseLock(ref: string): void {
  try { if (Number(JSON.parse(fs.readFileSync(lockFile(ref), "utf8")).pid) === process.pid) fs.rmSync(lockFile(ref), { force: true }); } catch { /* none */ }
}

function forwardNeeded(ref: string): boolean {
  return (keepers.get(ref)?.launchUntil ?? 0) > Date.now() || Object.values(readSeats()).includes(ref);
}

function storedIngress(ref: string): number | undefined {
  try { return binding(ref).seat_ingress_port; } catch { return undefined; }
}

function keep(ref: string): void {
  const keeper = keepers.get(ref) ?? { child: null, ingress: 0, refusals: 0, timer: null, launchUntil: 0 };
  keepers.set(ref, keeper);
  if (keeper.child) { if (!forwardNeeded(ref) || storedIngress(ref) !== keeper.ingress) keeper.child.kill(); return; }
  if (keeper.timer || keeper.starting) return;
  if (!forwardNeeded(ref)) { releaseLock(ref); keepers.delete(ref); releaseIdleCredential(ref); return; }
  if (!holdLock(ref)) return;
  let b: Binding;
  try { b = binding(ref); } catch { releaseLock(ref); return; }
  // No D in the binding (written before 0.70.3): no forward until a launch writes D; never a default port.
  if (!b.seat_ingress_port) { releaseLock(ref); return; }
  const requested = b.seat_forward_port ?? 0;
  keeper.ingress = b.seat_ingress_port;
  const again = () => {
    keeper.timer = setTimeout(() => { keeper.timer = null; keep(ref); }, FORWARD_RESTART_MS);
    keeper.timer.unref();
  };
  // The remote command depends on the terminal's shell (T4): known from the cache, or probed once by this process.
  // The probe's ssh arguments can refuse synchronously (CREDENTIAL_NOT_LOADED before credential-load): leave like the
  // argument refusal below, never with `starting` set, or no later keep() would ever start the forward (0.70.9).
  let probe: Promise<RemoteShell>;
  try { probe = remoteShell(trustedTarget(b)); } catch { releaseLock(ref); return; }
  keeper.starting = true;
  probe.then(shell => {
    keeper.starting = false;
    let args: string[];
    try {
      // The remote command ends when our stdin closes, so the forward dies with this process even on SIGKILL.
      args = trustedSshArguments(ref, keeperCommand(shell), null, ["-o", "ExitOnForwardFailure=yes", "-R", seatForwardSpec(requested, b.seat_ingress_port!)]);
    } catch { releaseLock(ref); return; }
    const child = spawn("ssh", args, { env: sshEnvironment(), stdio: ["pipe", "ignore", "pipe"] });
    keeper.child = child;
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
      const forward = parseSeatForward(stderr);
      if (typeof forward === "number" && forward !== requested) { writeBinding(ref, { seat_forward_port: forward }); keeper.refusals = 0; }
    });
    child.on("error", () => { /* close follows */ });
    child.on("close", () => {
      keeper.child = null;
      if (parseSeatForward(stderr) === "refused" && requested !== 0 && ++keeper.refusals >= FORWARD_REFUSALS_BEFORE_NEW_PORT) {
        // The old P stays taken on the terminal: let sshd pick a new one (seats launched with the old P need a relaunch).
        writeBinding(ref, { seat_forward_port: undefined });
        keeper.refusals = 0;
      }
      again();
    });
  }, () => { keeper.starting = false; again(); });
}

/** Every 60 s in every active process: keep (or take over from an exited holder) the forwards this state root needs. */
export function maintainSeatForwards(): void {
  const refs = new Set([...Object.values(readSeats()), ...keepers.keys(), ...loadedCredentialRefs()]);
  for (const ref of refs) keep(ref);
  if (!maintainTimer) { maintainTimer = setInterval(maintainSeatForwards, 60_000); maintainTimer.unref(); }
  // credential-load is a one-shot in another process: start the forward when its <ref>.json lands, not at the next 60 s check.
  if (!credentialWatch) try {
    credentialWatch = fs.watch(credentialDir(), (_event, name) => { if (!name || String(name).endsWith(".json")) maintainSeatForwards(); });
    credentialWatch.on("error", () => { credentialWatch?.close(); credentialWatch = null; });
    credentialWatch.unref();
  } catch { credentialWatch = null; /* the 60 s check still covers it */ }
}

/** The terminal-local port for seat URLs reaching container port `ingress`; starts the keeper if no process holds it yet. */
export async function ensureSeatForward(ref: string, ingress: number, timeoutMs = 30_000): Promise<number> {
  // A new D makes the old P (forwarding to the old D) useless: clear it so the wait below sees only a forward to D.
  if (binding(ref).seat_ingress_port !== ingress) writeBinding(ref, { seat_ingress_port: ingress, seat_forward_port: undefined });
  const keeper = keepers.get(ref) ?? { child: null, ingress: 0, refusals: 0, timer: null, launchUntil: 0 };
  keeper.launchUntil = Date.now() + LAUNCH_GRACE_MS;
  keepers.set(ref, keeper);
  maintainSeatForwards();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const port = binding(ref).seat_forward_port;
    if (port) return port;
    if (Date.now() > deadline) throw new RemoteTerminalError("SEAT_FORWARD_UNAVAILABLE", "the seat's MCP route back to this computer is not ready; launch again later");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

// ---- R13 credential agent: a keyless terminal's key, loaded by execution over stdin, held only in a private ssh-agent ----

const LOAD_GRACE_MS = 120_000, MAX_KEY_BYTES = 64 * 1024;
interface CredentialMeta { schema: "aiterm.credential-agent.v1"; ref: string; terminal_id: string; handle: string; revision: number;
  fingerprint: string; agent_pid: number | null; socket: string; loaded_at: string }

function credentialDir(): string {
  const dir = path.join(path.dirname(storePath()), "credentials");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
const credentialMetaFile = (ref: string) => path.join(credentialDir(), `${ref}.json`);
export const credentialPublicKeyFile = (ref: string) => path.join(credentialDir(), `${ref}.pub`);

function agentSocketPath(ref: string): string {
  // Short and stable across processes: macOS-style 104-byte sun_path limits also apply here.
  const dir = path.join("/tmp", `aiterm-ka-${process.getuid?.() ?? 0}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== (process.getuid?.() ?? 0) || (stat.mode & 0o777) !== 0o700)
    throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the credential agent directory is not a private directory of this user");
  return path.join(dir, `${ref.slice(0, 8)}.sock`);
}

function agentEnv(socket: string): NodeJS.ProcessEnv { return { ...sshEnvironment(), SSH_AUTH_SOCK: socket }; }
export function agentAlive(socket: string): boolean {
  if (!fs.existsSync(socket)) return false;
  const listed = spawnSync("ssh-add", ["-l"], { env: agentEnv(socket), stdio: ["ignore", "ignore", "ignore"], timeout: 10_000 });
  return listed.status === 0; // 1 = alive but empty, which cannot authenticate either
}

export function readCredential(ref: string): CredentialMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(credentialMetaFile(ref), "utf8"));
    return meta?.schema === "aiterm.credential-agent.v1" && meta.ref === ref ? meta : null;
  } catch { return null; }
}

function loadedCredentialRefs(): string[] {
  try { return fs.readdirSync(credentialDir()).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5)).filter(ref => REF.test(ref)); }
  catch { return []; }
}

export function releaseCredential(ref: string): void {
  const meta = readCredential(ref);
  if (meta?.agent_pid) try { process.kill(meta.agent_pid); } catch { /* already gone */ }
  for (const file of [credentialMetaFile(ref), credentialPublicKeyFile(ref), meta?.socket].filter((f): f is string => !!f)) fs.rmSync(file, { force: true });
}

/** No terminal seat of this ref and no launch pending: the key leaves memory. */
function releaseIdleCredential(ref: string): void {
  const meta = readCredential(ref);
  if (!meta || Object.values(readSeats()).includes(ref) || Date.now() - Date.parse(meta.loaded_at) < LOAD_GRACE_MS) return;
  releaseCredential(ref);
}

/** credential-load (R13): key bytes only from the caller's stdin; the receipt carries metadata only. */
export async function loadCredential(input: { ref: string; terminalId: string; handle: string; revision: string; purpose: string }, key: Buffer): Promise<Record<string, unknown>> {
  try {
    if (input.purpose !== "ssh-key") throw new RemoteTerminalError("CREDENTIAL_PURPOSE_UNSUPPORTED", "only --purpose ssh-key is loaded; a sudo secret is never loaded here");
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.terminalId)) throw new RemoteTerminalError("TERMINAL_ID_INVALID", "--terminal-id is required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.handle)) throw new RemoteTerminalError("CREDENTIAL_HANDLE_INVALID", "--handle must be a UUID");
    const revision = Number(input.revision);
    if (!/^[1-9]\d{0,15}$/.test(input.revision) || !Number.isSafeInteger(revision)) throw new RemoteTerminalError("CREDENTIAL_REVISION_INVALID", "--revision must be a positive integer");
    const b = binding(input.ref);
    if (b.key_file) throw new RemoteTerminalError("TERMINAL_INVALID", "this terminal has a native key; a credential is loaded only for keyless terminals");
    if (key.length === 0 || key.length > MAX_KEY_BYTES || !key.includes("PRIVATE KEY-----"))
      throw new RemoteTerminalError("CREDENTIAL_INVALID", "stdin is not an OpenSSH private key");
    const socket = agentSocketPath(b.ref);
    let pid = readCredential(b.ref)?.agent_pid ?? null;
    if (!agentAliveOrEmpty(socket)) {
      fs.rmSync(socket, { force: true });
      // Detached: the agent outlives this one-shot and holds the key in memory only.
      const agent = spawn("ssh-agent", ["-D", "-a", socket], { env: sshEnvironment(), stdio: "ignore", detached: true });
      agent.unref();
      pid = agent.pid ?? null;
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(socket)) {
        if (Date.now() > deadline) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the credential agent did not start");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    spawnSync("ssh-add", ["-D"], { env: agentEnv(socket), stdio: ["ignore", "ignore", "ignore"], timeout: 10_000 });
    const added = spawnSync("ssh-add", ["-q", "-"], { env: agentEnv(socket), input: key, stdio: ["pipe", "ignore", "ignore"], timeout: 10_000 });
    if (added.status !== 0) throw new RemoteTerminalError("CREDENTIAL_INVALID", "the agent did not accept the key (passphrase-protected or malformed)");
    const listed = spawnSync("ssh-add", ["-L"], { env: agentEnv(socket), encoding: "utf8", timeout: 10_000 });
    const line = listed.stdout.trim().split("\n")[0]?.split(/\s+/).slice(0, 2).join(" ") ?? "";
    const fingerprint = keyFingerprint(Buffer.from(line.split(" ")[1] ?? "", "base64"));
    fs.writeFileSync(credentialPublicKeyFile(b.ref), `${line}\n`, { mode: 0o600 });
    writeJson0600(credentialMetaFile(b.ref), { schema: "aiterm.credential-agent.v1", ref: b.ref, terminal_id: input.terminalId, handle: input.handle,
      revision, fingerprint, agent_pid: pid, socket, loaded_at: new Date().toISOString() } satisfies CredentialMeta);
    return { schema: "aiterm.credential-load.v1", accepted: true, ref: b.ref, terminal_id: input.terminalId, handle: input.handle, revision, fingerprint };
  } finally { key.fill(0); }
}

function agentAliveOrEmpty(socket: string): boolean {
  if (!fs.existsSync(socket)) return false;
  const listed = spawnSync("ssh-add", ["-l"], { env: agentEnv(socket), stdio: ["ignore", "ignore", "ignore"], timeout: 10_000 });
  return listed.status === 0 || listed.status === 1;
}
