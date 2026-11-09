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
import { writeJson0600 } from "./agent-shared.js";
import { posixCommand } from "./remote.js";
import { PRIVATE_ENV_SCHEMA } from "./private-env.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export class RemoteTerminalError extends Error {
  constructor(readonly code: string, message: string, readonly action?: string) { super(`${code}: ${message}`); }
}

export interface RemoteTarget { host: string; user: string; port: number }
interface Binding { ref: string; target: RemoteTarget; key_file: string; known_hosts_file: string; host_key_alias: string | null; created_at: string }

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

function binding(ref: string): Binding {
  if (!REF.test(ref)) throw new RemoteTerminalError("REF_INVALID", "ref must be a UUID");
  const found = readStore().find(item => item.ref === ref);
  if (!found) throw new RemoteTerminalError("BINDING_UNKNOWN", "no binding has this ref");
  return found;
}

export function registerBinding(input: { target: RemoteTarget; keyFile: string; knownHostsFile: string; hostKeyAlias?: string | null }): RemoteBindingStatus {
  const target = validTarget(input.target);
  for (const file of [input.keyFile, input.knownHostsFile]) {
    if (!path.isAbsolute(file)) throw new RemoteTerminalError("PATH_INVALID", "key and known_hosts paths must be absolute");
  }
  if (input.hostKeyAlias != null && !HOST.test(input.hostKeyAlias)) throw new RemoteTerminalError("ALIAS_INVALID", "host key alias is not a host name");
  const bindings = readStore();
  const next: Binding = { ref: randomUUID(), target, key_file: input.keyFile, known_hosts_file: input.knownHostsFile,
    host_key_alias: input.hostKeyAlias ?? null, created_at: new Date().toISOString() };
  writeJson0600(storePath(), { schema: "aiterm.remote-bindings.v1", bindings: [...bindings, next] });
  return bindingStatus(next.ref);
}

// ---- status: public metadata only ----

export interface RemoteBindingStatus {
  schema: "aiterm.remote-binding-status.v1";
  ref: string;
  target: RemoteTarget;
  credential: { provider: "aiterm.native-ssh-key.v1"; revision: string | null; fingerprint: string | null; available: boolean; reason: string | null };
  trust: { provider: "aiterm.known-hosts.v1"; revision: string | null; fingerprints: string[]; available: boolean; reason: string | null };
}

function keyFingerprint(blob: Buffer): string {
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

function publicKey(keyFile: string): { line: string; blob: Buffer } | { reason: string } {
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
  const key = publicKey(b.key_file);
  const trust = trustEntries(b);
  return {
    schema: "aiterm.remote-binding-status.v1", ref, target: b.target,
    credential: "reason" in key
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
  const matched = scan.stdout.split("\n").filter(line => line && !line.startsWith("#")).map(line => line.trim().split(/\s+/))
    .find(fields => fields.length >= 3 && keyFingerprint(Buffer.from(fields[2], "base64")) === fingerprint);
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
  if (/aiterm-mcp: (command )?not found|aiterm-mcp: No such file/i.test(stderr))
    return { code: "REMOTE_AITERM_UNAVAILABLE", message: "Aiterm is not installed on the terminal" };
  if (/Connection refused|timed out|No route to host|Network is unreachable|Could not resolve|Connection closed|Connection reset/i.test(stderr))
    return { code: "UNREACHABLE", message: "the terminal cannot be reached" };
  return { code: "CONNECTION_FAILED", message: "the SSH connection failed" };
}

export function sshArguments(b: Binding, agentSocket: string, identityFile: string, remoteCommand: string): string[] {
  return ["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${b.known_hosts_file}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "CheckHostIP=no",
    ...(b.host_key_alias ? ["-o", `HostKeyAlias=${b.host_key_alias}`] : []),
    "-o", `IdentityAgent=${agentSocket}`, "-o", "IdentitiesOnly=yes", "-o", `IdentityFile=${identityFile}`,
    "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
    "-l", b.target.user, "-p", String(b.target.port), "--", b.target.host, remoteCommand];
}

function sshEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/** MCP over an ssh child whose stdin first carries the private env line (remote-terminal.md R5). */
class SshStdioTransport implements Transport {
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
export type RemoteCommandOp = "claude_version" | "claude_install" | "claude_update";

const COMMANDS: Record<RemoteCommandOp, string> = {
  claude_version: "claude --version",
  claude_install: "curl -fsSL https://claude.ai/install.sh | bash",
  claude_update: "claude update",
};

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

function versionAtLeast(actual: string, required: string): boolean {
  const a = actual.split(/[.-]/).slice(0, 3).map(Number), r = required.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (r[i] ?? 0)) return (a[i] ?? 0) > (r[i] ?? 0);
  return true;
}

// The first release with --private-env-stdin and the transcript reader on the terminal.
export const REMOTE_MINIMUM_VERSION = "0.65.0";

export class RemoteTerminalConnection extends EventEmitter {
  private closing = false;
  private constructor(private readonly b: Binding, private readonly dir: string, private readonly agent: ChildProcess,
    private readonly socket: string, private readonly identity: string, private readonly client: Client, readonly remoteVersion: string) { super(); }

  static async open(input: { ref: string; target: unknown; trustRevision: string; credentialRevision: string; privateEnv?: Record<string, string> }): Promise<RemoteTerminalConnection> {
    const target = validTarget(input.target);
    const b = binding(input.ref);
    if (b.target.host !== target.host || b.target.user !== target.user || b.target.port !== target.port)
      throw new RemoteTerminalError("TARGET_MISMATCH", "the target differs from the registered binding");
    const status = bindingStatus(input.ref);
    if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "host trust is unavailable", "confirm the new host key");
    if (status.trust.revision !== input.trustRevision) throw new RemoteTerminalError("HOST_TRUST_STALE", "the host trust revision changed; re-read status");
    if (!status.credential.available) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", status.credential.reason ?? "the key is unavailable");
    if (status.credential.revision !== input.credentialRevision) throw new RemoteTerminalError("CREDENTIAL_REVISION_STALE", "the key revision changed; re-read status");
    for (const [name, value] of Object.entries(input.privateEnv ?? {}))
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string") throw new RemoteTerminalError("PRIVATE_ENV_INVALID", "invalid private env entry");
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
      const added = spawnSync("ssh-add", ["-q", b.key_file], { env: { ...sshEnvironment(), SSH_AUTH_SOCK: socket }, stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
      if (added.status !== 0) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the key could not be loaded");
      const identity = path.join(dir, "id.pub");
      const key = publicKey(b.key_file);
      if ("reason" in key) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", key.reason);
      fs.writeFileSync(identity, `${key.line}\n`, { mode: 0o600 });
      const transport = new SshStdioTransport(sshArguments(b, socket, identity, posixCommand("exec aiterm-mcp --private-env-stdin")),
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
      const connection = new RemoteTerminalConnection(b, dir, agent, socket, identity, client, remoteVersion);
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

  private exec(script: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("ssh", sshArguments(this.b, this.socket, this.identity, posixCommand(script)), { env: sshEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
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
    const result = await this.exec(`exec aiterm-remote-terminal ${parts.join(" ")}`, 120_000);
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
    const resolve = 'w=$(command -v aiterm-wait) || w="$(dirname "$(readlink -f "$(command -v aiterm-mcp)")")/aiterm-wait-cli.js"';
    const result = await this.exec(`${resolve}; exec "$w" ${flags.join(" ")}`, 90_000_000, signal);
    if (signal?.aborted) throw new RemoteTerminalError("WAIT_CANCELLED", "the wait was cancelled");
    const line = result.stdout.trim().split("\n").pop() ?? "";
    try { return JSON.parse(line); }
    catch {
      if (result.code === 255) { const f = classifySshFailure(result.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
      throw new RemoteTerminalError("COMMAND_FAILED", "aiterm-wait returned no receipt");
    }
  }

  async command(op: RemoteCommandOp): Promise<{ op: RemoteCommandOp; exit_code: number | null; version: string | null; output_tail: string }> {
    if (!Object.hasOwn(COMMANDS, op)) throw new RemoteTerminalError("COMMAND_UNSUPPORTED", "unknown op");
    const run = await this.exec(`${COMMANDS[op]} 2>&1`, op === "claude_version" ? 60_000 : 900_000);
    if (run.code === 255) { const f = classifySshFailure(run.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    const probe = op === "claude_version" ? run : await this.exec("claude --version 2>&1", 60_000);
    const version = probe.code === 0 ? (/\d+\.\d+\.\d+\S*/.exec(probe.stdout)?.[0] ?? null) : null;
    return { op, exit_code: run.code, version, output_tail: run.stdout.slice(-2000) };
  }

  async close(): Promise<{ closed: true }> {
    this.closing = true;
    await this.client.close().catch(() => {});
    return { closed: true };
  }
}
