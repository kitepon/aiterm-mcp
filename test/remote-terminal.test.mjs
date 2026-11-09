import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";

import { ARGV_FIXTURE_DONE, core, readAgentMeta, readArgvFixture, skipAgentDone } from "./core-agent-support.mjs";

const privateEnv = await import("../dist/private-env.js");
const rt = await import("../dist/remote-terminal.js");
const offset = await import("../dist/transcript-offset.js");
const transcript = await import("../dist/transcript-read.js");
const runtime = await import("../dist/tmux-runtime.js");

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR, "remote-terminal-"));

test("private env line: parsed once, the MCP stream keeps the rest, values never enter process.env", async () => {
  const stream = new PassThrough();
  const read = privateEnv.readPrivateEnvLine(stream);
  stream.write('{"schema":"aiterm.private-env.v1","env":{"AITERM_PRIV_FIXTURE":"s3cret"}}\n{"jsonrpc":"2.0"');
  const env = await read;
  assert.deepEqual(env, { AITERM_PRIV_FIXTURE: "s3cret" });
  const rest = [];
  stream.on("data", chunk => rest.push(chunk));
  stream.resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Buffer.concat(rest).toString(), '{"jsonrpc":"2.0"');
  privateEnv.setPrivateEnv(env);
  assert.equal(process.env.AITERM_PRIV_FIXTURE, undefined);
  assert.equal(privateEnv.launchEnvValue("AITERM_PRIV_FIXTURE"), "s3cret");
  assert.throws(() => privateEnv.parsePrivateEnvLine('{"schema":"x","env":{}}'), /PRIVATE_ENV_INVALID/);
  assert.throws(() => privateEnv.parsePrivateEnvLine('{"schema":"aiterm.private-env.v1","env":{"BAD-NAME":"v"}}'), /PRIVATE_ENV_INVALID/);
});

test("ssh failures are classified with a plain action; argv ignores user config and carries no secret", () => {
  assert.equal(rt.classifySshFailure("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@").code, "HOST_KEY_MISMATCH");
  assert.equal(rt.classifySshFailure("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@").action, "confirm the new host key");
  assert.equal(rt.classifySshFailure("No ED25519 host key is known for x and you have requested strict checking.\nHost key verification failed.").code, "HOST_TRUST_MISSING");
  assert.equal(rt.classifySshFailure("kite@x: Permission denied (publickey).").code, "AUTH_FAILED");
  assert.equal(rt.classifySshFailure("ssh: connect to host x port 22: Operation timed out").code, "UNREACHABLE");
  const args = rt.sshArguments({ target: { host: "192.168.1.12", user: "kite", port: 22 }, known_hosts_file: "/k/known_hosts", host_key_alias: "192.168.1.35" },
    "/tmp/aiterm-rt-x/a.sock", "/tmp/aiterm-rt-x/id.pub", "exec aiterm-mcp");
  assert.deepEqual(args.slice(0, 2), ["-F", "/dev/null"]);
  for (const option of ["StrictHostKeyChecking=yes", "UserKnownHostsFile=/k/known_hosts", "GlobalKnownHostsFile=/dev/null", "HostKeyAlias=192.168.1.35",
    "IdentityAgent=/tmp/aiterm-rt-x/a.sock", "IdentitiesOnly=yes", "BatchMode=yes", "ControlPath=none"]) assert.ok(args.includes(option), option);
  assert.deepEqual(args.slice(-3), ["--", "192.168.1.12", "exec aiterm-mcp"]);
});

test("seat MCP forward: the keeper's -R spec, P from ssh stderr, seat URLs get the terminal-local origin, header values leave the config", () => {
  const b = { target: { host: "h", user: "u", port: 22 }, known_hosts_file: "/k" };
  assert.ok(!rt.sshArguments(b, "/s", "/i", "exec x").includes("-R"), "serve's connection carries no forward");
  assert.equal(rt.seatForwardSpec(0, {}), "127.0.0.1:0:127.0.0.1:4182");
  assert.equal(rt.seatForwardSpec(61234, { BELLTEAM_REMOTE_SEAT_PORT: "5000" }), "127.0.0.1:61234:127.0.0.1:5000");
  assert.throws(() => rt.seatForwardSpec(0, { BELLTEAM_REMOTE_SEAT_PORT: "x" }), /SEAT_FORWARD_UNAVAILABLE|not a port/);
  assert.equal(rt.parseSeatForward("Allocated port 65423 for remote forward to 127.0.0.1:4182\n"), 65423);
  assert.equal(rt.parseSeatForward("Warning: remote port forwarding failed for listen port 0\n"), "refused");
  assert.equal(rt.parseSeatForward("Warning: Permanently added x\n"), null);
  const config = { mcpServers: {
    bellteam: { type: "http", url: "http://127.0.0.1:4182/api/seat-mcp", headers: { Authorization: "Bearer ${T}" } },
    "call-bridge": { type: "http", url: "http://192.168.1.2:4180/api/seat-mcp/call-bridge?x=1" },
    other: { type: "http", url: "https://example.com/api/seat-mcpx" }, stdio: { command: "node" } } };
  assert.equal(rt.hasSeatMcpUrl(config), true);
  assert.equal(rt.hasSeatMcpUrl({ mcpServers: { other: config.mcpServers.other } }), false);
  const out = rt.rewriteSeatMcpConfig(config, 65423);
  assert.deepEqual(out.mcpServers.bellteam, { type: "http", url: "http://127.0.0.1:65423/api/seat-mcp", headers: { Authorization: "Bearer ${T}" } });
  assert.equal(out.mcpServers["call-bridge"].url, "http://127.0.0.1:65423/api/seat-mcp/call-bridge?x=1");
  assert.equal(out.mcpServers.other, config.mcpServers.other);
  assert.equal(out.mcpServers.stdio, config.mcpServers.stdio);
  assert.equal(config.mcpServers.bellteam.url, "http://127.0.0.1:4182/api/seat-mcp");
  const secret = "Bearer literal-value-0123";
  const extracted = rt.extractMcpHeaders({ mcpServers: { a: { url: "http://x/api/seat-mcp", headers: { Authorization: secret, "X-Ref": "${KEEP}" } }, b: { command: "node" } } });
  assert.deepEqual(extracted.env, { AITERM_MCP_HEADER_0: secret });
  assert.deepEqual(extracted.config.mcpServers.a.headers, { Authorization: "${AITERM_MCP_HEADER_0}", "X-Ref": "${KEEP}" });
  assert.ok(!JSON.stringify(extracted.config).includes("literal-value"), "no header value stays in the config");
});

test("terminal argument: strict schema with plain messages; trusted ssh ignores user config; seats bind by session", { skip: spawnSync("ssh-keygen", ["-?"]).error !== undefined }, async () => {
  const contract = await import("../dist/remote-contract.js");
  const remote = await import("../dist/remote.js");
  const key = path.join(tmp, "id_terminal");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const known = path.join(tmp, "known_terminal");
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `mac-alias ${type} ${blob}\n`, { mode: 0o600 });
  const status = rt.registerBinding({ target: { host: "10.0.0.7", user: "kite", port: 22 }, keyFile: key, knownHostsFile: known, hostKeyAlias: "mac-alias" });
  const value = { ref: status.ref, target: status.target, trustRevision: status.trust.revision, credentialRevision: status.credential.revision };
  assert.equal(contract.terminalArgumentSchema.safeParse(value).success, true);
  for (const bad of [{ ...value, host: "x" }, { ...value, trustRevision: "latest" }, { ref: "macbook", target: value.target, trustRevision: value.trustRevision, credentialRevision: value.credentialRevision },
    { ...value, target: { host: "10.0.0.7", user: "kite" } }]) {
    const parsed = contract.terminalArgumentSchema.safeParse(bad);
    assert.equal(parsed.success, false, JSON.stringify(bad));
  }
  assert.match(contract.terminalArgumentSchema.safeParse({ ...value, ref: "macbook" }).error.issues[0].message, /binding ref/);
  assert.equal(contract.remoteInputSchema.safeParse({ host: "h", trusted_ref: status.ref }).success, false, "tool input cannot build a trusted target");
  assert.throws(() => rt.terminalRemoteTarget({ ...value, target: { ...value.target, host: "10.0.0.8" } }), /TARGET_MISMATCH/);
  assert.throws(() => rt.terminalRemoteTarget({ ...value, trustRevision: `sha256:${"0".repeat(64)}` }), /HOST_TRUST_STALE/);
  assert.throws(() => rt.terminalRemoteTarget({ ...value, credentialRevision: `sha256:${"0".repeat(64)}` }), /CREDENTIAL_REVISION_STALE/);
  const target = rt.terminalRemoteTarget(value);
  assert.deepEqual(target, { host: "10.0.0.7", user: "kite", port: 22, trusted_ref: status.ref });
  const { args } = remote.sshInvocation(target, "exec aiterm-mcp");
  assert.deepEqual(args.slice(0, 2), ["-F", "/dev/null"]);
  for (const option of ["StrictHostKeyChecking=yes", `UserKnownHostsFile=${known}`, "GlobalKnownHostsFile=/dev/null", "HostKeyAlias=mac-alias",
    "IdentityAgent=none", "IdentitiesOnly=yes", `IdentityFile=${key}`, "BatchMode=yes"]) assert.ok(args.includes(option), option);
  assert.ok(args.some(arg => /^ControlPath=.*\/t-[0-9a-f]{8}-%C$/.test(arg)), "own control master per binding");
  assert.deepEqual(args.slice(-3), ["--", "10.0.0.7", "exec aiterm-mcp"]);
  assert.equal(rt.boundTerminalTarget("seat-x"), null);
  rt.bindTerminalSession("seat-x", status.ref);
  assert.deepEqual(rt.boundTerminalTarget("seat-x"), target);
  rt.unbindTerminalSession("seat-x");
  assert.equal(rt.boundTerminalTarget("seat-x"), null);
});

test("launch tools: terminal is refused clearly before any connection when the harness, cwd or combination is wrong", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createAitermServer } = await import("../dist/index.js");
  const server = createAitermServer();
  const client = new Client({ name: "terminal-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const terminal = { ref: "00000000-0000-4000-8000-000000000000", target: { host: "10.0.0.7", user: "kite", port: 22 },
    trustRevision: `sha256:${"1".repeat(64)}`, credentialRevision: `sha256:${"2".repeat(64)}` };
  const text = result => result.content.map(item => item.text).join("\n");
  const tools = (await client.listTools()).tools;
  for (const name of ["agent_launch", "claude_agent", "codex_agent", "grok_agent"]) {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool.inputSchema.properties.terminal, `${name} takes terminal`);
    assert.match(tool.inputSchema.properties.terminal.description, /copy it unchanged/);
  }
  assert.match(text(await client.callTool({ name: "agent_launch", arguments: { harness: "codex-cli", terminal, cwd: "/x" } })), /TERMINAL_HARNESS_UNSUPPORTED/);
  assert.match(text(await client.callTool({ name: "codex_agent", arguments: { terminal, cwd: "/x" } })), /TERMINAL_HARNESS_UNSUPPORTED/);
  assert.match(text(await client.callTool({ name: "claude_agent", arguments: { terminal } })), /TERMINAL_INVALID: cwd is required/);
  assert.match(text(await client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", terminal, cwd: "relative" } })), /TERMINAL_INVALID/);
  assert.match(text(await client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", terminal, cwd: "/x", remote: { host: "h" } } })), /TERMINAL_INVALID: use terminal or remote/);
  assert.match(text(await client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", terminal, cwd: "/x" } })), /BINDING_UNKNOWN/);
  const malformed = await client.callTool({ name: "claude_agent", arguments: { terminal: { ...terminal, ref: "macbook" }, cwd: "/x" } });
  assert.equal(malformed.isError, true);
  assert.match(text(malformed), /binding ref/);
  await client.close();
});

test("binding status: revisions follow the key and the matching known_hosts entries; missing trust is a status", { skip: spawnSync("ssh-keygen", ["-?"]).error !== undefined }, () => {
  const key = path.join(tmp, "id_test");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const hostKey = path.join(tmp, "host_key");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]).status, 0);
  const known = path.join(tmp, "known_hosts");
  const [type, blob] = fs.readFileSync(`${hostKey}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `other.example ${type} ${blob}\nalias-host,10.0.0.9 ${type} ${blob}\n`, { mode: 0o600 });
  const status = rt.registerBinding({ target: { host: "10.0.0.1", user: "kite", port: 22 }, keyFile: key, knownHostsFile: known, hostKeyAlias: "alias-host" });
  assert.equal(status.schema, "aiterm.remote-binding-status.v1");
  assert.equal(status.credential.available, true);
  assert.match(status.credential.revision, /^sha256:[0-9a-f]{64}$/);
  const expectedFp = spawnSync("ssh-keygen", ["-lf", `${key}.pub`], { encoding: "utf8" }).stdout.split(/\s+/)[1];
  assert.equal(status.credential.fingerprint, expectedFp);
  assert.equal(status.trust.available, true);
  assert.equal(status.trust.fingerprints.length, 1);
  assert.equal(status.trust.fingerprints[0], spawnSync("ssh-keygen", ["-lf", `${hostKey}.pub`], { encoding: "utf8" }).stdout.split(/\s+/)[1]);
  assert.ok(!JSON.stringify(status).includes(tmp), "no path in the public status");
  // An unrelated entry does not change the revision; a different key for the alias does.
  fs.appendFileSync(known, `third.example ${type} ${blob}\n`);
  assert.equal(rt.bindingStatus(status.ref).trust.revision, status.trust.revision);
  const other = path.join(tmp, "host_key2");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", other]);
  const [, blob2] = fs.readFileSync(`${other}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `alias-host ${type} ${blob2}\n`);
  assert.notEqual(rt.bindingStatus(status.ref).trust.revision, status.trust.revision);
  fs.writeFileSync(known, "");
  const missing = rt.bindingStatus(status.ref);
  assert.deepEqual([missing.trust.available, missing.trust.reason, missing.trust.revision], [false, "HOST_TRUST_MISSING", null]);
  const locked = path.join(tmp, "id_locked");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "pass-phrase", "-f", locked]);
  const lockedRef = rt.registerBinding({ target: { host: "10.0.0.2", user: "kite", port: 2222 }, keyFile: locked, knownHostsFile: known }).ref;
  assert.equal(rt.bindingStatus(lockedRef).credential.reason, "KEY_PASSPHRASE_REQUIRED");
  assert.throws(() => rt.bindingStatus("not-a-uuid"), error => error.code === "REF_INVALID");
  assert.throws(() => rt.bindingStatus("00000000-0000-4000-8000-000000000000"), error => error.code === "BINDING_UNKNOWN");
});

test("open refuses a target or revision that differs from the binding before any connection", { skip: spawnSync("ssh-keygen", ["-?"]).error !== undefined }, async () => {
  const key = path.join(tmp, "id_open");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  const known = path.join(tmp, "known_open");
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `10.0.0.3 ${type} ${blob}\n`);
  const status = rt.registerBinding({ target: { host: "10.0.0.3", user: "kite", port: 22 }, keyFile: key, knownHostsFile: known });
  const base = { ref: status.ref, target: { host: "10.0.0.3", user: "kite", port: 22 }, trustRevision: status.trust.revision, credentialRevision: status.credential.revision };
  await assert.rejects(rt.RemoteTerminalConnection.open({ ...base, target: { host: "10.0.0.4", user: "kite", port: 22 } }), error => error.code === "TARGET_MISMATCH");
  await assert.rejects(rt.RemoteTerminalConnection.open({ ...base, trustRevision: "sha256:" + "0".repeat(64) }), error => error.code === "HOST_TRUST_STALE");
  await assert.rejects(rt.RemoteTerminalConnection.open({ ...base, credentialRevision: "sha256:" + "0".repeat(64) }), error => error.code === "CREDENTIAL_REVISION_STALE");
});

test("transcript: the Stop offset ends at the last complete line; reads stop there and resume from the cursor", () => {
  const file = path.join(tmp, "conv.jsonl");
  const lines = ['{"a":1}\n', '{"b":"日本"}\r\n', '{"c":3}\n'];
  fs.writeFileSync(file, lines.join("") + '{"partial":');
  const done = offset.completedTranscriptOffset(file);
  assert.equal(done.offset, Buffer.byteLength(lines.join("")));
  const id = "11111111-2222-4333-8444-555555555555";
  const events = path.join(tmp, "events.jsonl");
  fs.writeFileSync(events, JSON.stringify({ type: "agent_done", vendor_session_id: id, transcript_path: file, transcript_offset: Buffer.byteLength(lines[0] + lines[1]) }) + "\n");
  const first = transcript.readTranscriptRange(events, id, null);
  assert.deepEqual(first.entries, [lines[0], lines[1]]);
  assert.deepEqual(first.cursor, { claudeSessionId: id, offset: Buffer.byteLength(lines[0] + lines[1]) });
  assert.deepEqual(transcript.readTranscriptRange(events, id, first.cursor).entries, [], "nothing past the completed turn");
  fs.appendFileSync(events, JSON.stringify({ type: "agent_done", vendor_session_id: id, transcript_path: file, transcript_offset: done.offset }) + "\n");
  const second = transcript.readTranscriptRange(events, id, first.cursor);
  assert.deepEqual(second.entries, [lines[2]]);
  const paged = transcript.readTranscriptRange(events, id, null, Buffer.byteLength(lines[0]) + 2);
  assert.deepEqual([paged.entries, paged.more], [[lines[0]], true]);
  assert.equal(transcript.readTranscriptRange(events, id, { claudeSessionId: "99999999-2222-4333-8444-555555555555", offset: 999 }).cursor.offset, Buffer.byteLength(lines[0] + lines[1] + lines[2]), "a new conversation starts from 0");
  assert.throws(() => transcript.readTranscriptRange(events, id, { claudeSessionId: id, offset: done.offset + 1 }), /TRANSCRIPT_CURSOR_AHEAD/);
});

const fakeClaude = path.join(tmp, "fake-claude.sh");
const argvOut = path.join(tmp, "argv");
fs.writeFileSync(fakeClaude, [
  "#!/bin/sh",
  "if [ \"$1\" = auth ] && [ \"$2\" = status ]; then printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'; exit 0; fi",
  `for arg do printf '%s\\0' "$arg"; done > '${argvOut}'.args`,
  `printf '%s' "$AITERM_PRIV_FIXTURE" > '${argvOut}'.env`,
  `printf '%s\\n' '${ARGV_FIXTURE_DONE}'`, ""].join("\n"), { mode: 0o700 });

test("claude launch: env values, caller instructions and MCP config stay out of the typed line and the pane log", { skip: skipAgentDone || process.platform === "win32" }, async (t) => {
  const saved = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = fakeClaude;
  privateEnv.setPrivateEnv({ AITERM_PRIV_FIXTURE: "tok-PRIVATE-123" });
  const prompt = "CALLER_RULE_MARKER do the work";
  const mcp = { mcpServers: { bt: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer ${AITERM_PRIV_FIXTURE}" } } } };
  try {
    const [sid] = core.openAgent("claude", { agent_done: true, env_vars: ["AITERM_PRIV_FIXTURE"], append_system_prompt: prompt, mcp_config: mcp });
    try {
      await readArgvFixture(sid, t, `${argvOut}.args`);
      const argv = fs.readFileSync(`${argvOut}.args`, "utf8").split("\0");
      const meta = readAgentMeta(sid);
      assert.equal(argv[argv.indexOf("--append-system-prompt-file") + 1], meta.claude_caller_prompt_file);
      assert.equal(argv[argv.indexOf("--mcp-config") + 1], meta.claude_caller_mcp_file);
      assert.equal(fs.readFileSync(meta.claude_caller_prompt_file, "utf8"), prompt);
      assert.deepEqual(JSON.parse(fs.readFileSync(meta.claude_caller_mcp_file, "utf8")), mcp);
      assert.equal(fs.statSync(meta.claude_caller_prompt_file).mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(`${argvOut}.env`, "utf8"), "tok-PRIVATE-123", "the CLI still receives the value");
      const typed = fs.readFileSync(path.join(runtime.SOCKDIR, `${sid}.lastcmd`), "utf8");
      const log = fs.readFileSync(path.join(runtime.SOCKDIR, `${sid}.log`), "utf8");
      for (const text of [typed, log]) {
        assert.ok(!text.includes("tok-PRIVATE-123"), "no env value");
        assert.ok(!text.includes("CALLER_RULE_MARKER"), "no caller instruction");
        assert.ok(!text.includes("127.0.0.1:1/mcp"), "no MCP config body");
      }
      assert.deepEqual(fs.readdirSync(path.dirname(meta.claude_caller_prompt_file)).filter(f => f.endsWith(".launch-env")), [], "the env file is removed after sourcing");
    } finally {
      core.closeSession(sid);
    }
  } finally {
    process.env.CLAUDE_BIN = saved;
  }
});

test("launch refuses a missing cwd with CWD_UNAVAILABLE before any session exists", () => {
  assert.throws(() => core.openAgent("claude", { agent_done: true, session_name: "cwd_missing_fixture", cwd: path.join(tmp, "nope") }),
    error => /^CWD_UNAVAILABLE:/.test(error.message));
  assert.equal(fs.existsSync(path.join(runtime.SOCKDIR, "cwd_missing_fixture.log")), false);
});

test("aiterm-mcp --private-env-stdin serves MCP after the private line", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [path.resolve("dist/index.js"), "--private-env-stdin"], { stdio: ["pipe", "pipe", "inherit"] });
  try {
    child.stdin.write('{"schema":"aiterm.private-env.v1","env":{"AITERM_PRIV_FIXTURE":"v"}}\n');
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
    const line = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", chunk => { out += chunk; if (out.includes("\n")) resolve(out.split("\n")[0]); });
      child.on("exit", code => reject(new Error(`exited ${code}`)));
    });
    const reply = JSON.parse(line);
    assert.equal(reply.id, 1);
    assert.equal(reply.result.serverInfo.name, "aiterm");
  } finally { child.kill(); }
});

test("remote wait keeps only aiterm-wait's own flag/value pairs from a receipt's wait_process", () => {
  assert.deepEqual(rt.waitArguments(["/usr/lib/node_modules/aiterm-mcp/dist/aiterm-wait-cli.js", "--session", "bot-x", "--cursor", "12", "--input", "a".repeat(32)]),
    ["--session", "bot-x", "--cursor", "12", "--input", "a".repeat(32)]);
  assert.throws(() => rt.waitArguments(["cli.js", "--session", "x; rm -rf ~"]), error => error.code === "WAIT_INVALID");
  assert.throws(() => rt.waitArguments(["cli.js", "--exec", "x"]), error => error.code === "WAIT_INVALID");
  assert.throws(() => rt.waitArguments(["cli.js", "--cursor", "1"]), error => error.code === "WAIT_INVALID");
});

test("keyless binding: Aiterm keeps its own known_hosts, the key must come from a credential handle, exactly one key source", { skip: spawnSync("ssh-keygen", ["-?"]).error !== undefined }, async () => {
  const contract = await import("../dist/remote-contract.js");
  const status = rt.registerBinding({ target: { host: "10.0.0.20", user: "u", port: 2222 } });
  assert.deepEqual(status.credential, { provider: "aiterm.credential-handle.v1", revision: null, fingerprint: null, available: false, reason: "KEY_FROM_CREDENTIAL" });
  assert.equal(status.trust.available, false);
  const store = JSON.parse(fs.readFileSync(rt.storePath(), "utf8")).bindings.find(b => b.ref === status.ref);
  assert.equal(store.key_file, null);
  if (process.platform !== "win32") assert.equal(fs.statSync(store.known_hosts_file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(store.known_hosts_file, "utf8"), "");
  const base = { ref: status.ref, target: status.target, trustRevision: `sha256:${"3".repeat(64)}` };
  const credential = { handle: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", revision: 1 };
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...base, credential }).success, true);
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...base, credential, credentialRevision: `sha256:${"4".repeat(64)}` }).success, false);
  assert.match(contract.terminalArgumentSchema.safeParse(base).error.issues[0].message, /exactly one key source/);
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...base, credential: { handle: "x y", revision: 1 } }).success, false);
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...base, credential: { ...credential, revision: 0 } }).success, false);
  // Trust is checked first; with trust present the key source rule decides.
  assert.throws(() => rt.terminalRemoteTarget({ ...base, credential }), /HOST_TRUST_MISSING/);
  fs.writeFileSync(store.known_hosts_file, "[10.0.0.20]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGg0vJHFq2n8gV6rGq8kq3zQv9Hn3l7rYb2b1o7c3B5Z\n");
  const trusted = { ...base, trustRevision: rt.bindingStatus(status.ref).trust.revision };
  assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credentialRevision: `sha256:${"4".repeat(64)}` }), /CREDENTIAL_REQUIRED/);
  assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credential, credentialRevision: "x" }), /TERMINAL_INVALID/);
  assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credential }), /CREDENTIAL_NOT_LOADED/);
});

test("credential-load: key bytes only from stdin into a private agent; launch checks handle and revision; release empties memory", { skip: process.platform === "win32" || spawnSync("ssh-agent", ["-?"]).error !== undefined }, async () => {
  const status = rt.registerBinding({ target: { host: "10.0.0.21", user: "u", port: 22 } });
  const store = JSON.parse(fs.readFileSync(rt.storePath(), "utf8")).bindings.find(b => b.ref === status.ref);
  const hostKey = path.join(tmp, "host_key_cred");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
  const [htype, hblob] = fs.readFileSync(`${hostKey}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(store.known_hosts_file, `10.0.0.21 ${htype} ${hblob}\n`);
  const keyPath = path.join(tmp, "id_cred");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]).status, 0);
  const handle = "0d6c1f0e-2b8a-4c3d-9e7f-112233445566";
  const load = (extra = {}) => rt.loadCredential({ ref: status.ref, terminalId: "pc-1", handle, revision: "3", purpose: "ssh-key", ...extra }, fs.readFileSync(keyPath));
  await assert.rejects(load({ purpose: "sudo" }), /CREDENTIAL_PURPOSE_UNSUPPORTED/);
  await assert.rejects(rt.loadCredential({ ref: status.ref, terminalId: "pc-1", handle, revision: "3", purpose: "ssh-key" }, Buffer.from("not a key")), /CREDENTIAL_INVALID/);
  try {
    const receipt = await load();
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.revision, 3);
    assert.equal(receipt.fingerprint, spawnSync("ssh-keygen", ["-lf", `${keyPath}.pub`], { encoding: "utf8" }).stdout.split(/\s+/)[1]);
    const meta = rt.readCredential(status.ref);
    const privateBody = fs.readFileSync(keyPath, "utf8").split("\n")[1];
    for (const file of fs.readdirSync(path.dirname(rt.storePath()), { recursive: true }).map(f => path.join(path.dirname(rt.storePath()), f)).filter(f => fs.statSync(f).isFile()))
      assert.ok(!fs.readFileSync(file, "utf8").includes(privateBody), `no private key in ${file}`);
    const args = rt.trustedSshArguments(status.ref, "true", null);
    assert.ok(args.includes(`IdentityAgent=${meta.socket}`) && args.includes(`IdentityFile=${rt.credentialPublicKeyFile(status.ref)}`));
    const trusted = { ref: status.ref, target: status.target, trustRevision: rt.bindingStatus(status.ref).trust.revision };
    assert.equal(rt.terminalRemoteTarget({ ...trusted, credential: { handle, revision: 3 } }).trusted_ref, status.ref);
    assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credential: { handle, revision: 4 } }), /CREDENTIAL_REVISION_STALE/);
    assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credential: { handle: "0d6c1f0e-2b8a-4c3d-9e7f-000000000000", revision: 3 } }), /CREDENTIAL_NOT_LOADED/);
    rt.releaseCredential(status.ref);
    assert.equal(rt.readCredential(status.ref), null);
    assert.ok(!fs.existsSync(meta.socket));
    assert.throws(() => rt.terminalRemoteTarget({ ...trusted, credential: { handle, revision: 3 } }), /CREDENTIAL_NOT_LOADED/);
  } finally { rt.releaseCredential(status.ref); }
});
