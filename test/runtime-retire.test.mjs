import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activationMs, isAitermEntry, retireStale } from "../dist/runtime-retire.js";
import { parseRetireOutput } from "../dist/remote-provision.js";

const since = Date.parse("2026-11-21T10:00:00Z");
const row = (pid, parent_pid, command, started) => ({ pid, parent_pid, command, process_group_id: pid, started_identity: started, argv_digest: String(pid) });
const OLD = "2026-11-19T10:00:00Z", NEW = "2026-11-21T11:00:00Z";

test("isAitermEntry: aiterm-mcp and the machine host, not a command that only names the path", () => {
  assert.equal(isAitermEntry("/home/u/.aiterm/runtime/current/node/bin/node /x/lib/node_modules/aiterm-mcp/dist/index.js"), true);
  assert.equal(isAitermEntry("/home/u/.aiterm/runtime/current/bin/aiterm-mcp"), true);
  assert.equal(isAitermEntry("node /x/aiterm-mcp/dist/claude-machine-host.js --stream-file f -- claude"), true);
  assert.equal(isAitermEntry("ls /home/u/repos/aiterm-mcp"), false);
  assert.equal(isAitermEntry("node /x/aiterm-mcp/dist/aiterm-wait-cli.js"), false);
});

function deps(rows, seats, hibernate, now = Date.parse(NEW) + 3_600_000) {
  const ended = [];
  return { ended, deps: { rows: () => rows, seats: () => seats, hibernate, signal: t => ended.push(t.pid), now: () => now, selfPid: 900 } };
}
const mcp = "node /r/aiterm-mcp/dist/index.js", host = "node /r/aiterm-mcp/dist/claude-machine-host.js -- claude";

test("retireStale: idle old seat hibernated; busy, unavailable and fresh seats kept; the caller's own seat and fresh servers untouched", async () => {
  const rows = [
    row(10, 1, "bash", OLD), row(11, 10, host, OLD),                    // old machine seat
    row(20, 1, "bash", OLD), row(21, 20, "claude", OLD), row(22, 21, mcp, OLD), // old TUI seat, busy
    row(30, 1, "bash", OLD), row(31, 30, host, OLD),                    // old, no recipe
    row(40, 1, "bash", NEW), row(41, 40, host, NEW),                    // started after the swap
    row(50, 1, "bash", OLD), row(51, 50, mcp, OLD), row(52, 51, "bash", OLD), row(900, 52, "node retire", NEW), // the caller runs inside this seat
    row(60, 1, mcp, OLD),                                               // old orphan server
    row(61, 1, mcp, "2026-11-21T11:50:00Z"),                            // fresh (after the swap)
  ];
  const seats = [10, 20, 30, 40, 50].map(pid => ({ session_id: `s${pid}`, pane: { pid }, agent: true }));
  const calls = [];
  const { deps: d, ended } = deps(rows, seats, async name => {
    calls.push(name);
    if (name === "s20") throw new Error("AGENT_BUSY: turn_running: 席は作業中のため休止していません。");
    if (name === "s30") throw new Error("AGENT_HIBERNATE_UNAVAILABLE: resume_unavailable: 席は休止していません。");
  }, Date.parse("2026-11-21T12:30:00Z"));
  const result = await retireStale(since, false, d);
  assert.deepEqual(calls, ["s10", "s20", "s30"], "s40 is fresh, s50 holds the caller");
  assert.deepEqual(result.seats, [
    { session_id: "s10", outcome: "hibernated" },
    { session_id: "s20", outcome: "busy", reason: "turn_running" },
    { session_id: "s30", outcome: "unavailable", reason: "resume_unavailable" },
    { session_id: "s50", outcome: "caller_in_seat" },
  ]);
  assert.deepEqual(ended, [60]);
  assert.equal(result.ended_servers, 1);
});

test("retireStale --force ends the stale processes of a seat that could not be hibernated", async () => {
  const rows = [row(30, 1, "bash", OLD), row(31, 30, host, OLD)];
  const { deps: d, ended } = deps(rows, [{ session_id: "s30", pane: { pid: 30 }, agent: true }], async () => { throw new Error("AGENT_BUSY: turn_running: x"); });
  const result = await retireStale(since, true, d);
  assert.deepEqual(result.seats, [{ session_id: "s30", outcome: "ended" }]);
  assert.deepEqual(ended, [31]);
});

test("a young stale server outside every seat is left (it may serve a warm call)", async () => {
  const rows = [row(60, 1, mcp, OLD)];
  const { deps: d, ended } = deps(rows, [], async () => {}, Date.parse(OLD) + 60_000);
  assert.equal((await retireStale(since, false, d)).ended_servers, 0);
  assert.deepEqual(ended, []);
});

test("activationMs: ACTIVATED first, else the ctime of current", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retire-"));
  fs.mkdirSync(path.join(root, "current"));
  assert.ok(Math.abs(activationMs(root) - fs.lstatSync(path.join(root, "current")).ctimeMs) < 1);
  fs.writeFileSync(path.join(root, "ACTIVATED"), "1763700000 aiterm-runtime-1.0.0-linux-x64\n");
  assert.equal(activationMs(root), 1763700000_000);
});

test("parseRetireOutput reads the line after the result line; garbage and the error line give null", () => {
  const json = '{"schema":"aiterm.retire-stale.v1","since":"s","seats":[],"ended_servers":0}';
  assert.equal(parseRetireOutput(`AITERM_PROVISION PROVISIONED 1.0.0 x64\nAITERM_PROVISION_RETIRE ${json}\n`).ended_servers, 0);
  assert.equal(parseRetireOutput("AITERM_PROVISION_RETIRE_ERROR\n"), null);
  assert.equal(parseRetireOutput("AITERM_PROVISION_RETIRE {not json}\n"), null);
});
