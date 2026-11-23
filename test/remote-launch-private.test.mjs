import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { createAitermServer } = await import("../dist/index.js");

const skip = process.platform === "win32" || spawnSync("sh", ["-c", "true"]).error !== undefined;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-launch-private-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// R30: `remote` + `ssh` carries private values like a terminal; mcp_config is passed as written. `ssh` is a fake that runs a recording MCP server.
const calls = path.join(tmp, "calls.jsonl");
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import fs from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
import { readPrivateEnvLine } from ${JSON.stringify(new URL("../dist/private-env.js", import.meta.url).href)};
const env = process.env.FAKE_PRIVATE ? await readPrivateEnvLine(process.stdin) : null;
const s = new Server({ name: "aiterm-mcp", version: process.env.FAKE_VERSION }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async r => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name: r.params.name, arguments: r.params.arguments, private_env: env }) + "\\n");
  if (r.params.name === "pty_observe") return { content: [{ type: "text", text: "ok" }], structuredContent: { state: "busy" } };
  if (r.params.name !== "agent_launch") return { content: [{ type: "text", text: "ok" }], structuredContent: { schema: "aiterm.pty-list-result.v1", sessions: [] } };
  return { content: [{ type: "text", text: "session_id: fake_remote" }], structuredContent: { schema: "aiterm.agent-launch-result.v1", session_id: "fake_remote",
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
process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH}`;

const pin = { known_hosts_file: "/k/known_hosts", host_key_alias: "seat.example", identity_agent: "/run/agent.sock" };
let counter = 0;
const host = () => `10.8.0.${++counter}`;
async function withClient(run) {
  const server = createAitermServer(), client = new Client({ name: "remote-launch-private-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try { return await run(client); } finally { await client.close(); }
}
const recorded = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []);
const reset = () => fs.rmSync(calls, { force: true });
const mcp_config = { mcpServers: {
  bellteam: { type: "http", url: "http://127.0.0.1:41999/api/seat-mcp", headers: { Authorization: "Bearer ${SEAT_TOKEN_R30}", "X-Plain": "plain-secret" } } } };

test("remote+ssh launch: private values on the private line, mcp_config passed with its port untouched", { skip }, async () => {
  fakeSsh("0.70.110"); reset();
  process.env.SEAT_TOKEN_R30 = "tok-r30"; process.env.AITERM_SEAT_FORWARD_PORT = "41999";
  await withClient(async client => {
    const result = await client.callTool({ name: "agent_launch", arguments: { harness: "codex-cli", cwd: "/x", remote: { host: host(), user: "kite", ssh: pin },
      env_vars: ["SEAT_TOKEN_R30", "AITERM_SEAT_FORWARD_PORT"], mcp_config } });
    assert.ok(!result.isError, JSON.stringify(result.content));
  });
  const launch = recorded().find(call => call.name === "agent_launch");
  assert.ok(launch, "agent_launch reached the remote");
  assert.equal(launch.private_env.SEAT_TOKEN_R30, "tok-r30");
  assert.equal(launch.private_env.AITERM_SEAT_FORWARD_PORT, "41999");
  assert.equal(launch.private_env.AITERM_MCP_HEADER_0, "plain-secret");
  const server = launch.arguments.mcp_config.mcpServers.bellteam;
  assert.equal(server.url, "http://127.0.0.1:41999/api/seat-mcp", "no D->P rewrite");
  assert.equal(server.headers.Authorization, "Bearer ${SEAT_TOKEN_R30}");
  assert.equal(server.headers["X-Plain"], "${AITERM_MCP_HEADER_0}");
  assert.ok(!JSON.stringify(launch.arguments).includes("tok-r30") && !JSON.stringify(launch.arguments).includes("plain-secret"), "no value in the arguments");
  assert.ok(launch.arguments.env_vars.includes("AITERM_MCP_HEADER_0"));
});

test("remote+ssh launch to a too-old remote is refused before the private line", { skip }, async () => {
  fakeSsh("0.70.5"); reset();
  await withClient(async client => {
    const result = await client.callTool({ name: "agent_launch", arguments: { harness: "codex-cli", cwd: "/x", remote: { host: host(), ssh: pin }, env_vars: ["SEAT_TOKEN_R30"], mcp_config } });
    assert.ok(result.isError);
    assert.match(result.content.map(item => item.text).join("\n"), /REMOTE_AITERM_TOO_OLD/);
  });
  assert.ok(recorded().every(call => call.private_env === null && call.name !== "agent_launch"));
});

test("a remote without ssh never carries private values", { skip }, async () => {
  fakeSsh("0.70.110"); reset();
  await withClient(async client => {
    await client.callTool({ name: "agent_launch", arguments: { harness: "codex-cli", cwd: "/x", remote: { host: host(), user: "kite" }, env_vars: ["SEAT_TOKEN_R30"], mcp_config } });
  });
  const launch = recorded().find(call => call.name === "agent_launch");
  assert.equal(launch?.private_env ?? null, null);
  assert.ok(!JSON.stringify(launch?.arguments ?? {}).includes("tok-r30"));
});

test("agent_stop with remote sends one stop key over that ssh while the seat is busy", { skip }, async () => {
  fakeSsh("0.70.110"); reset();
  await withClient(async client => {
    const result = await client.callTool({ name: "agent_stop", arguments: { session_id: "fake_remote", remote: { host: host(), ssh: pin } } });
    assert.equal(result.structuredContent.status, "sent", JSON.stringify(result));
    assert.deepEqual(result.structuredContent.targets.map(target => [target.session_id, target.status]), [["fake_remote", "sent"]]);
  });
  const keys = recorded().filter(call => call.name === "pty_key");
  assert.deepEqual(keys.map(call => call.arguments.key), ["C-c"]);
});
