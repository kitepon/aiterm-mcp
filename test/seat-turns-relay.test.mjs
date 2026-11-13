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

const skip = process.platform === "win32" || spawnSync("ssh-keygen", ["-?"]).error !== undefined
  || spawnSync("tmux", ["-V"]).status !== 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seat-relay-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Fake terminals: 10.8.0.1 answers pty_list with two of its three bound sessions; 10.8.0.2 cannot be reached.
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
const s = new Server({ name: "aiterm-mcp", version: "0.70.7" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { sessions: [] },
  _meta: { "aiterm/seat_turns": { schema: "aiterm.seat-turns.v1", seats: [
    { session_id: "relay_a", launch_id: "a".repeat(32), harness: "claude-code", turn: { state: "idle" } },
    { session_id: "relay_b", launch_id: "b".repeat(32), harness: "codex-cli", turn: null },
    { session_id: "not_bound_here", launch_id: "c".repeat(32), harness: "claude-code", turn: { state: "idle" } }],
    unread: ["relay_held", "held_not_bound_here"] } } }));
await s.connect(new StdioServerTransport());
`);
// 10.8.0.3 answers like 10.8.0.1 but only after 5 s (a busy terminal, Lumani's build on fox 11/14).
const slowFile = path.join(tmp, "slow.mjs");
fs.writeFileSync(slowFile, fs.readFileSync(serverFile, "utf8").replace("async () => ({ content", "async () => (await new Promise(r => setTimeout(r, 5000)), { content"));
const fakeBin = path.join(tmp, "bin");
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh
case "$*" in *10.8.0.2*) echo "ssh: connect to host 10.8.0.2 port 22: No route to host" >&2; exit 255;; esac
case "$*" in *aiterm-probe*) echo posix; exit 0;; esac
case "$*" in *10.8.0.3*) exec ${JSON.stringify(process.execPath)} ${JSON.stringify(slowFile)};; esac
echo relay >> ${JSON.stringify(path.join(tmp, "relays.log"))}
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

test("seat turns relay: an unreachable terminal's sessions are unread, an answering terminal's missing session is absent, its held seats stay unread", { skip }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  bind("10.8.0.1", ["relay_a", "relay_b", "relay_gone", "relay_held"]);
  bind("10.8.0.2", ["relay_x", "relay_y"]);
  const server = createAitermServer(), client = new Client({ name: "seat-relay-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const listed = await client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } });
    const turns = listed._meta["aiterm/seat_turns"];
    assert.deepEqual(turns.seats.map(seat => [seat.session_id, seat.turn]), [["relay_a", { state: "idle" }], ["relay_b", null]]);
    assert.deepEqual(turns.unread, ["relay_held", "relay_x", "relay_y"]);
    // Overlapping callers share the one in-flight relay to a terminal instead of starting a reader each.
    const log = path.join(tmp, "relays.log");
    fs.rmSync(log, { force: true });
    const both = await Promise.all([0, 1].map(() => client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } })));
    for (const result of both) assert.deepEqual(result._meta["aiterm/seat_turns"].seats.map(seat => seat.session_id), ["relay_a", "relay_b"]);
    // a37: the terminal's warm session (opened by the first call) serves both callers without a new ssh.
    assert.equal(fs.existsSync(log), false, "no new ssh for later calls");
    // E9: route_since is null without a ready forward, and the keeper's ready_at while its live owner holds the binding's P.
    assert.deepEqual(turns.seats.map(seat => seat.route_since), [null, null]);
    const store = JSON.parse(fs.readFileSync(rt.storePath(), "utf8"));
    const ref = store.bindings.find(item => item.target.host === "10.8.0.1").ref;
    store.bindings = store.bindings.map(item => item.ref === ref ? { ...item, seat_forward_port: 41234 } : item);
    fs.writeFileSync(rt.storePath(), JSON.stringify(store));
    const owner = (await import("node:child_process")).spawn("sleep", ["30"]);
    t.after(() => owner.kill());
    const lock = path.join((await import("../dist/agent-shared.js")).ensureStateRoot(), `terminal-forward-${ref}.lock`), readyAt = "2026-11-13T00:00:00.000Z";
    const start = process.platform === "linux" ? fs.readFileSync(`/proc/${owner.pid}/stat`, "utf8").split(") ").pop().split(" ")[19] : undefined;
    fs.writeFileSync(lock, JSON.stringify({ pid: owner.pid, boot: Math.round(Date.now() / 1000 - os.uptime()), start, ready: 41234, ready_at: readyAt }));
    const routed = await client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } });
    assert.deepEqual(routed._meta["aiterm/seat_turns"].seats.map(seat => seat.route_since), [readyAt, readyAt]);
    owner.kill(); await new Promise(resolve => owner.once("exit", resolve));
    const lost = await client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } });
    assert.deepEqual(lost._meta["aiterm/seat_turns"].seats.map(seat => seat.route_since), [null, null], "a dead keeper is no route");
    fs.rmSync(lock, { force: true });
  } finally { await client.close(); }
});

test("loopDeadline: a loop blocked past the budget still takes an answer that is ready when it frees", async () => {
  const { loopDeadline } = await import("../dist/remote.js");
  const { spawn } = await import("node:child_process");
  const race = async (deadline) => {
    // The relay's answer comes over a pipe while the loop is blocked; it is read in the poll phase, after due timers.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.stdout.write('rows'), 50)"]);
    const hold = setInterval(() => {}, 50); // as above: the relay's pipe is not the only handle in a real server
    child.once("exit", () => setTimeout(() => clearInterval(hold), 2_000));
    await new Promise(resolve => child.once("spawn", resolve));
    const answer = new Promise(resolve => child.stdout.once("data", data => resolve(data.toString())));
    const timer = deadline();
    const until = performance.now() + 1_000;
    while (performance.now() < until) { /* a synchronous local read */ }
    return Promise.race([answer, timer]);
  };
  assert.equal(await race(() => new Promise(resolve => setTimeout(resolve, 300, "unread"))), "unread", "a wall-clock timer wins after a block");
  assert.equal(await race(() => loopDeadline(300, "unread")), "rows");
  // Its timers are unref'd like the relay's (the ssh child keeps the loop alive there): hold the loop open here.
  const hold = setInterval(() => {}, 50);
  try {
    const started = performance.now();
    assert.equal(await loopDeadline(300, "unread"), "unread");
    assert.ok(performance.now() - started >= 290, "a free loop waits the whole budget");
  } finally { clearInterval(hold); }
});

test("seat turns relay: a terminal that answers after the 4 s budget hands that answer to the next poll, with its read time", { skip, timeout: 30_000 }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  bind("10.8.0.3", ["relay_a", "relay_b"]);
  const server = createAitermServer(), client = new Client({ name: "seat-relay-slow", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const poll = async () => (await client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } }))._meta["aiterm/seat_turns"];
  try {
    const first = await poll();
    assert.deepEqual(first.unread.filter(name => ["relay_a", "relay_b"].includes(name)), ["relay_a", "relay_b"], "too slow for this poll");
    await new Promise(resolve => setTimeout(resolve, 8000));
    const second = await poll();
    const rows = second.seats.filter(seat => ["relay_a", "relay_b"].includes(seat.session_id));
    assert.deepEqual(rows.map(seat => seat.session_id), ["relay_a", "relay_b"], "the late answer, not unread again");
    for (const seat of rows) assert.ok(Date.now() - Date.parse(seat.observed_at) < 20_000, "with the time its terminal answered");
  } finally { await client.close(); }
});
