import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const rt = await import("../dist/remote-terminal.js");
const codex = await import("../dist/harnesses/codex.js");
const { createAitermServer } = await import("../dist/index.js");

const skip = process.platform === "win32" || spawnSync("ssh-keygen", ["-?"]).error !== undefined;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-terminal-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A fake terminal: `ssh` runs a small MCP server that records every call (and the private env line) and reports FAKE_VERSION.
const calls = path.join(tmp, "calls.jsonl");
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import fs from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
import { readPrivateEnvLine } from ${JSON.stringify(new URL("../dist/private-env.js", import.meta.url).href)};
const record = entry => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + "\\n");
const env = process.env.FAKE_PRIVATE ? await readPrivateEnvLine(process.stdin) : null;
const s = new Server({ name: "aiterm-mcp", version: process.env.FAKE_VERSION }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async r => {
  record({ name: r.params.name, arguments: r.params.arguments, private_env: env });
  if (r.params.arguments?.session_name === "needs-login") return { isError: true, content: [{ type: "text", text: "aiterm: AGENT_LAUNCH_NOT_STARTED: AGENT_AUTH_REQUIRED: not logged in" }] };
  if (r.params.name !== "agent_launch") return { content: [{ type: "text", text: "ok" }], structuredContent: { schema: "aiterm.pty-list-result.v1", sessions: [] } };
  return { content: [{ type: "text", text: "session_id: fake_codex" }], structuredContent: { schema: "aiterm.agent-launch-result.v1", session_id: "fake_codex",
    harness: "codex-cli", provider: "codex", managed_completion: true, event_cursor: null, wait_process: null, wait_command: null, submit_residue: null,
    startup: { status: "ready", reason: "" }, initial_prompt: { status: "not_requested", reason: "", turn_started: null } } };
});
await s.connect(new StdioServerTransport());
if (env) process.stdin.resume();
`);
const fakeBin = path.join(tmp, "bin");
fs.mkdirSync(fakeBin);
const fakeSsh = version => fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh
case "$*" in *uname*) printf 'aiterm-probe %%OS%%\\nDarwin\\n'; exit 0;; *aiterm-probe*) echo posix; exit 0;; esac
case "$*" in *--private-env-stdin*) export FAKE_PRIVATE=1;; esac
FAKE_VERSION=${version} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)}
`, { mode: 0o755 });

let counter = 0;
/** A registered binding on its own host, so the per-terminal version cache never crosses cases. */
function terminalFor() {
  const host = `10.9.0.${++counter}`, key = path.join(tmp, `id_${counter}`), known = path.join(tmp, `known_${counter}`);
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `${host} ${type} ${blob}\n`);
  const status = rt.registerBinding({ target: { host, user: "kite", port: 22 }, keyFile: key, knownHostsFile: known });
  return { ref: status.ref, target: { host, user: "kite", port: 22 }, trustRevision: status.trust.revision, credentialRevision: status.credential.revision };
}

async function withClient(run) {
  const server = createAitermServer(), client = new Client({ name: "codex-terminal-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try { return await run(client); } finally { await client.close(); }
}
const recorded = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []);
const text = result => result.content.map(item => item.text).join("\n");

const mcp_config = { mcpServers: {
  bellteam: { type: "http", url: "http://127.0.0.1:4181/mcp", headers: { Authorization: "Bearer ${BELLTEAM_MCP_TOKEN}", "X-Bellteam-Seat": "${AITERM_SESSION_ID}" } },
  literal: { type: "http", url: "http://127.0.0.1:4181/mcp/x", headers: { Authorization: "Bearer plain-secret" } } } };

test("terminal harness gate: every one of the five harnesses reaches the binding check (TERMINAL_HARNESS_UNSUPPORTED is only a guard for another name)", { skip }, async () => {
  const terminal = { ref: "00000000-0000-4000-8000-000000000000", target: { host: "10.0.0.7", user: "kite", port: 22 }, trustRevision: `sha256:${"1".repeat(64)}`, credentialRevision: `sha256:${"2".repeat(64)}` };
  await withClient(async client => {
    for (const harness of ["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"]) {
      const result = await client.callTool({ name: "agent_launch", arguments: { harness, terminal, cwd: "/x" } });
      assert.match(text(result), /BINDING_UNKNOWN/, harness);
      assert.equal(result._meta["aiterm/launch_error"].harness, harness);
    }
  });
});

test("grok, cursor and antigravity terminal launch: need Aiterm 0.70.9 (refused before any private value), then go to the terminal's agent_launch like codex; a CLI that is not logged in is AGENT_AUTH_REQUIRED", { skip }, async t => {
  const savedPath = process.env.PATH, savedToken = process.env.BELLTEAM_MCP_TOKEN;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  process.env.BELLTEAM_MCP_TOKEN = "tok-123";
  t.after(() => { process.env.PATH = savedPath; if (savedToken === undefined) delete process.env.BELLTEAM_MCP_TOKEN; else process.env.BELLTEAM_MCP_TOKEN = savedToken; });
  await withClient(async client => {
    for (const harness of ["grok-cli", "cursor-cli", "antigravity-cli"]) {
      const args = terminal => ({ harness, terminal, cwd: "/Users/k/p", prompt: "hi", env_vars: ["BELLTEAM_MCP_TOKEN"] });
      fakeSsh("0.70.8");
      const before = recorded().length;
      const old = await client.callTool({ name: "agent_launch", arguments: args(terminalFor()) });
      assert.equal(old.isError, true);
      assert.match(text(old), /REMOTE_AITERM_TOO_OLD: the terminal runs Aiterm 0\.70\.8; 0\.70\.9 or later is required/, harness);
      assert.deepEqual([old._meta["aiterm/launch_error"].code, old._meta["aiterm/launch_error"].harness], ["REMOTE_AITERM_TOO_OLD", harness]);
      assert.ok(recorded().slice(before).every(call => call.name === "pty_list"), "only the version probe reached the terminal");

      fakeSsh("0.70.9");
      const terminal = terminalFor();
      const ok = await client.callTool({ name: "agent_launch", arguments: args(terminal) });
      assert.equal(ok.isError, undefined, text(ok));
      const launch = recorded().slice(before).find(call => call.name === "agent_launch");
      assert.equal(launch.arguments.harness, harness);
      // The private line carries the named env value, as for Codex (append_system_prompt / mcp_config for these three are accepted by another change).
      assert.deepEqual(launch.private_env, { BELLTEAM_MCP_TOKEN: "tok-123" });
      assert.ok(!JSON.stringify(launch.arguments).includes("tok-123"));
      rt.unbindTerminalSession("fake_codex");

      const login = await client.callTool({ name: "agent_launch", arguments: { harness, terminal, cwd: "/Users/k/p", session_name: "needs-login" } });
      assert.equal(login.isError, true);
      assert.deepEqual({ ...login._meta["aiterm/launch_error"], action: typeof login._meta["aiterm/launch_error"].action },
        { schema: "aiterm.agent-launch-error.v1", harness, code: "AGENT_AUTH_REQUIRED", phase: "input", effect: "not_started", session_created: false, action: "string" });
    }
  });
});

test("codex terminal launch: needs Aiterm 0.70.7 on the terminal, then goes to its agent_launch with the caller fields and private header values", { skip }, async t => {
  const savedPath = process.env.PATH, savedToken = process.env.BELLTEAM_MCP_TOKEN;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  process.env.BELLTEAM_MCP_TOKEN = "tok-123";
  t.after(() => { process.env.PATH = savedPath; if (savedToken === undefined) delete process.env.BELLTEAM_MCP_TOKEN; else process.env.BELLTEAM_MCP_TOKEN = savedToken; });
  const args = terminal => ({ harness: "codex-cli", terminal, cwd: "/Users/k/p", prompt: "hi", append_system_prompt: "CALLER RULES", mcp_config, env_vars: ["BELLTEAM_MCP_TOKEN"] });
  await withClient(async client => {
    // Terminal on 0.70.6: refused before any private value or launch call is sent.
    fakeSsh("0.70.6");
    const start = recorded().length;
    const old = await client.callTool({ name: "agent_launch", arguments: args(terminalFor()) });
    assert.equal(old.isError, true);
    assert.match(text(old), /REMOTE_AITERM_TOO_OLD: the terminal runs Aiterm 0\.70\.6; 0\.70\.7 or later is required/);
    assert.equal(old._meta["aiterm/launch_error"].code, "REMOTE_AITERM_TOO_OLD");
    assert.equal(old._meta["aiterm/launch_error"].harness, "codex-cli");
    assert.ok(recorded().slice(start).every(call => call.name === "pty_list"), "only the version probe reached the terminal");

    fakeSsh("0.70.7");
    const terminal = terminalFor();
    const ok = await client.callTool({ name: "agent_launch", arguments: args(terminal) });
    assert.equal(ok.isError, undefined, text(ok));
    assert.equal(ok.structuredContent.session_id, "fake_codex");
    const launch = recorded().slice(start).find(call => call.name === "agent_launch");
    assert.equal(launch.arguments.harness, "codex-cli");
    assert.equal(launch.arguments.append_system_prompt, "CALLER RULES");
    // The literal 'Bearer plain-secret' left the config as an env reference; the value travelled on the private line only.
    assert.equal(launch.arguments.mcp_config.mcpServers.literal.headers.Authorization, "${AITERM_MCP_HEADER_0}");
    assert.equal(launch.arguments.mcp_config.mcpServers.bellteam.headers.Authorization, "Bearer ${BELLTEAM_MCP_TOKEN}");
    assert.deepEqual(launch.arguments.env_vars.sort(), ["AITERM_MCP_HEADER_0", "BELLTEAM_MCP_TOKEN"]);
    assert.deepEqual(launch.private_env, { BELLTEAM_MCP_TOKEN: "tok-123", AITERM_MCP_HEADER_0: "Bearer plain-secret" });
    assert.ok(!JSON.stringify(launch.arguments).includes("plain-secret") && !JSON.stringify(launch.arguments).includes("tok-123"));
    // What the terminal's Codex then builds from it:
    assert.deepEqual(codex.codexMcpOverrides(launch.arguments.mcp_config), [
      'mcp_servers.bellteam={url="http://127.0.0.1:4181/mcp",bearer_token_env_var="BELLTEAM_MCP_TOKEN",env_http_headers={"X-Bellteam-Seat"="AITERM_SESSION_ID"}}',
      'mcp_servers.literal={url="http://127.0.0.1:4181/mcp/x",env_http_headers={"Authorization"="AITERM_MCP_HEADER_0"}}']);
    // The session is bound to the terminal like a Claude seat, so pty_list seat_turns rows are relayed for it (index.ts seatTurnsMeta).
    assert.deepEqual(rt.terminalSeatGroups().find(group => group.sessions.includes("fake_codex"))?.sessions.includes("fake_codex"), true);
    rt.unbindTerminalSession("fake_codex");

    // A shape Codex cannot say is refused here as an input refusal, without sending anything to launch.
    const before = recorded().length;
    const sse = await client.callTool({ name: "agent_launch", arguments: { ...args(terminal), mcp_config: { mcpServers: { s: { type: "sse", url: "http://127.0.0.1:1/m" } } } } });
    assert.equal(sse.isError, true);
    assert.match(text(sse), /AGENT_LAUNCH_NOT_STARTED: CODEX_MCP_CONFIG_UNSUPPORTED/);
    const meta = sse._meta["aiterm/launch_error"];
    assert.deepEqual([meta.code, meta.harness, meta.phase, meta.effect, meta.session_created], ["AGENT_LAUNCH_NOT_STARTED", "codex-cli", "input", "not_started", false]);
    assert.ok(recorded().slice(before).every(call => call.name === "pty_list"), "nothing but the version probe was sent");
  });
});
