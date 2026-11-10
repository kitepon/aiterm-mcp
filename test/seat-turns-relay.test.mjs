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
    { session_id: "not_bound_here", launch_id: "c".repeat(32), harness: "claude-code", turn: { state: "idle" } }] } } }));
await s.connect(new StdioServerTransport());
`);
const fakeBin = path.join(tmp, "bin");
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh
case "$*" in *10.8.0.2*) echo "ssh: connect to host 10.8.0.2 port 22: No route to host" >&2; exit 255;; esac
case "$*" in *aiterm-probe*) echo posix; exit 0;; esac
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

test("seat turns relay: an unreachable terminal's sessions are unread, an answering terminal's missing session is absent", { skip }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  bind("10.8.0.1", ["relay_a", "relay_b", "relay_gone"]);
  bind("10.8.0.2", ["relay_x", "relay_y"]);
  const server = createAitermServer(), client = new Client({ name: "seat-relay-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const listed = await client.callTool({ name: "pty_list", arguments: {}, _meta: { "aiterm/caller": "BellTeam" } });
    const turns = listed._meta["aiterm/seat_turns"];
    assert.deepEqual(turns.seats.map(seat => [seat.session_id, seat.turn]), [["relay_a", { state: "idle" }], ["relay_b", null]]);
    assert.deepEqual(turns.unread, ["relay_x", "relay_y"]);
  } finally { await client.close(); }
});
