// 0.70.108 (a532b2 stage 3): pty_list({include: ["turn", "own_work"]}) puts the seat's turn and own work in its row of sessions[].
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-pli-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

// An idle Claude-like seat: shows its ready prompt and waits.
const bin = path.join(process.env.TMPDIR, "claude-fake.sh");
fs.writeFileSync(bin, [
  "#!/bin/sh",
  "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
  "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
  "  exit 0",
  "fi",
  `exec '${process.execPath}' -e "process.stdout.write('Claude Code\\\\n❯ ready\\\\n'); setInterval(() => {}, 60000)"`,
  "",
].join("\n"), { mode: 0o700 });

const core = await import(new URL("../dist/core.js", import.meta.url).href);
const { createAitermServer } = await import(new URL("../dist/index.js", import.meta.url).href);
core.__testSetAgentTuiReadyStableSamples(1);
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "POSIX shell fixture" : undefined;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});

test("pty_list include: turn and own_work are plain fields of the agent row, and a call without include does not compute them", { skip, timeout: 60_000 }, async () => {
  process.env.CLAUDE_BIN = bin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  const server = createAitermServer(), client = new Client({ name: "pty-list-include", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    for (let waited = 0; waited < 3000 && core.observeSession(sid).state !== "idle"; waited += 100) await sleep(100); // the shape is what is tested, not the seat reaching idle
    const row = result => result.structuredContent.sessions.find(session => session.session_id === sid);

    const plain = await client.callTool({ name: "pty_list", arguments: {} });
    assert.ok(row(plain), "the seat is listed");
    assert.equal("turn" in row(plain), false, "no include: nothing is computed or added");
    assert.equal("own_work" in row(plain), false);

    const asked = await client.callTool({ name: "pty_list", arguments: { include: ["turn", "own_work"] } });
    const r = row(asked);
    assert.ok("turn" in r, "turn is present (null = not readable now)");
    assert.ok(r.turn === null || r.turn.state === "idle" || r.turn.state === "running", JSON.stringify(r.turn));
    assert.ok(r.own_work && typeof r.own_work === "object", "own_work is present");
    for (const key of ["processes", "excluded", "child_results", "exclusions_digest", "oldest", "tasks", "task"]) assert.ok(key in r.own_work, `own_work.${key}`);
    assert.equal(r.own_work.exclusions_digest, null, "no exclusion list was sent");

    const onlyTurn = await client.callTool({ name: "pty_list", arguments: { include: ["turn"] } });
    assert.ok("turn" in row(onlyTurn) && !("own_work" in row(onlyTurn)));

    // The caller's exclusion list is still the input _meta, and its digest comes back.
    const filtered = await client.callTool({ name: "pty_list", arguments: { include: ["own_work"] },
      _meta: { "aiterm/own_work_exclusions": { digest: "d1", entries: [] } } });
    assert.equal(row(filtered).own_work.exclusions_digest, "d1");

    // Both ways in one call share one read of the seat: no row falls out as unread.
    const both = await client.callTool({ name: "pty_list", arguments: { include: ["turn"] }, _meta: { "aiterm/caller": "BellTeam" } });
    assert.ok("turn" in row(both));

    const bad = await client.callTool({ name: "pty_list", arguments: { include: ["nope"] } });
    assert.equal(bad.isError, true, "an unknown include is refused");
  } finally { await client.close(); try { core.closeSession(sid); } catch { /* noop */ } }
});
