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
const { createAitermServer } = await import("../dist/index.js");

const skip = process.platform === "win32" || spawnSync("ssh-keygen", ["-?"]).error !== undefined;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-relay-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Fake terminal Aiterm: records what agent_goal received (arguments, client, private line) and answers a v2 result.
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const dist = name => JSON.stringify(new URL(`../dist/${name}`, import.meta.url).href);
const log = path.join(tmp, "calls.jsonl"), serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import fs from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
import { readPrivateEnvLine } from ${dist("private-env.js")};
const privateEnv = process.argv.includes("--private-env-stdin") ? await readPrivateEnvLine(process.stdin) : null;
const s = new Server({ name: "aiterm-mcp", version: "0.70.29" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async request => {
  const slow = request.params.arguments.launch_id === "b".repeat(32), start = Date.now();
  if (slow) await new Promise(done => setTimeout(done, 400));
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: request.params.name, args: request.params.arguments,
    meta: request.params._meta ?? null, client: s.getClientVersion()?.name, privateEnv, start, end: Date.now() }) + "\\n");
  const result = { schema: "aiterm.agent-goal-result.v2", session_id: request.params.arguments.session_id, launch_id: request.params.arguments.launch_id,
    harness: "claude-code", binding: null, availability: "unsupported", capabilities: { inspect: false, create: false, edit: false, pause: false, resume: false, clear: false },
    outcome: "unsupported", mutation: "not_requested", readback: "not_attempted", reason: "claude_code_version_unverified:2.2.0", observed_at: "2026-11-12T00:00:00.000Z" };
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: true };
});
await s.connect(new StdioServerTransport());
process.stdin.resume();
`);
const fakeBin = path.join(tmp, "bin");
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh
case "$*" in *aiterm-probe*) echo posix; exit 0;; esac
case "$*" in *--private-env-stdin*) exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)} --private-env-stdin;; esac
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)}
`, { mode: 0o755 });

function bind(host, sessions) {
  const key = path.join(tmp, `id_${host}`), known = path.join(tmp, `known_${host}`);
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `${host} ${type} ${blob}\n`);
  const { ref } = rt.registerBinding({ target: { host, user: "kite", port: 22 }, keyFile: key, knownHostsFile: known });
  for (const session of sessions) rt.bindTerminalSession(session, ref);
}

async function connect(options) {
  const server = createAitermServer(options), client = new Client({ name: "goal-relay-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  return client;
}

test("agent_goal on a terminal seat is forwarded by session; the terminal's result returns unchanged; only a user origin rides the private line", { skip }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  bind("10.9.0.1", ["goal_seat"]);
  const input = { session_id: "goal_seat", launch_id: "a".repeat(32), action: "inspect" };
  const automatic = await connect();
  try {
    const inspected = await automatic.callTool({ name: "agent_goal", arguments: input, _meta: { "aiterm/caller": "BellTeam" } });
    assert.equal(inspected.isError, true);
    assert.equal(inspected.structuredContent.reason, "claude_code_version_unverified:2.2.0");
    assert.equal(inspected.structuredContent.schema, "aiterm.agent-goal-result.v2");
    const cleared = await automatic.callTool({ name: "agent_goal", arguments: { ...input, action: "clear" } });
    assert.equal(cleared.structuredContent.availability, "unsupported");
  } finally { await automatic.close(); }
  const user = await connect({ goalOrigin: () => "user" });
  try { await user.callTool({ name: "agent_goal", arguments: { ...input, action: "clear" } }); } finally { await user.close(); }
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => [call.name, call.args.action, call.privateEnv]),
    [["agent_goal", "inspect", null], ["agent_goal", "clear", null], ["agent_goal", "clear", { AITERM_GOAL_ORIGIN: "user" }]]);
  assert.deepEqual(calls[0].args, input, "same arguments");
  assert.equal(calls[0].meta?.["aiterm/caller"], "BellTeam", "request _meta passes through");
  assert.ok(calls.every(call => call.client === "aiterm-remote"));
});

test("goal writes forwarded from one process to one terminal seat run one at a time; reads and other seats are not queued", { skip }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  bind("10.9.0.2", ["order_seat", "other_seat"]);
  fs.rmSync(log, { force: true });
  const client = await connect({ goalOrigin: () => "user" });
  const call = (session, action) => client.callTool({ name: "agent_goal", arguments: { session_id: session, launch_id: "b".repeat(32), action } });
  try {
    await Promise.all([call("order_seat", "clear"), call("order_seat", "clear"), call("other_seat", "clear"), call("order_seat", "inspect")]);
  } finally { await client.close(); }
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const span = (session, action) => calls.filter(c => c.args.session_id === session && c.args.action === action).sort((a, b) => a.start - b.start);
  const [first, second] = span("order_seat", "clear");
  assert.ok(second.start >= first.end, "the second write to the same seat starts after the first returned");
  const [other] = span("other_seat", "clear"), [read] = span("order_seat", "inspect");
  assert.ok(other.start < first.end || other.start < second.end, "another seat is not queued behind this seat");
  assert.ok(read.start < second.end, "a read is not queued behind writes");
});
