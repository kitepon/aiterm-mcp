// a535 (Anis, fox 11-28): a seat's hooks must survive the update that deletes the versioned runtime folder, and a machine turn whose
// Stop hook failed must still settle from the host's idle state.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stableRuntimePath, stabilizeClaudeSettingsHooks, pruneRuntimes } from "../dist/runtime-path.js";
import { settleMachineTurnWithoutStop } from "../dist/claude-machine-settle.js";
import { agentsDir } from "../dist/agent-shared.js";
import { agentClaudeMachineFilePath } from "../dist/harnesses/claude-machine.js";
import { agentClaudeOperationPath } from "../dist/harnesses/claude.js";

test("a hook path inside a versioned runtime folder is rewritten through current, and only then", () => {
  const exists = () => true;
  assert.equal(stableRuntimePath("C:\\Users\\kite_\\.aiterm\\runtime\\aiterm-runtime-0.70.118-win32-x64\\lib\\node_modules\\aiterm-mcp\\dist\\claude-stop-hook.js", exists),
    "C:\\Users\\kite_\\.aiterm\\runtime\\current\\lib\\node_modules\\aiterm-mcp\\dist\\claude-stop-hook.js");
  assert.equal(stableRuntimePath("/home/u/.aiterm/runtime/aiterm-runtime-0.70.118-linux-x64/node/bin/node", exists), "/home/u/.aiterm/runtime/current/node/bin/node");
  assert.equal(stableRuntimePath("/opt/homebrew/lib/node_modules/aiterm-mcp/dist/claude-stop-hook.js", exists), "/opt/homebrew/lib/node_modules/aiterm-mcp/dist/claude-stop-hook.js");
  assert.equal(stableRuntimePath("/home/u/.aiterm/runtime/current/x.js", exists), "/home/u/.aiterm/runtime/current/x.js");
  assert.equal(stableRuntimePath("/home/u/.aiterm/runtime/aiterm-runtime-1/x.js", () => false), "/home/u/.aiterm/runtime/aiterm-runtime-1/x.js", "no current file: keep the original");
});

test("a saved settings file from before is rewritten for the resume; the rest of the settings stay", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-a535-"));
  try {
    const runtime = path.join(root, ".aiterm", "runtime");
    fs.mkdirSync(path.join(runtime, "aiterm-runtime-0.70.118-linux-x64", "dist"), { recursive: true });
    fs.mkdirSync(path.join(runtime, "current", "dist"), { recursive: true });
    for (const dir of ["aiterm-runtime-0.70.118-linux-x64", "current"]) fs.writeFileSync(path.join(runtime, dir, "dist", "h.js"), "");
    const file = path.join(root, "settings.json");
    const old = path.join(runtime, "aiterm-runtime-0.70.118-linux-x64", "dist", "h.js");
    fs.writeFileSync(file, JSON.stringify({ model: "m", hooks: { Stop: [{ hooks: [{ type: "command", command: `'node' '${old}'`, timeout: 10 }] }] } }));
    assert.equal(stabilizeClaudeSettingsHooks(file), true);
    const next = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(next.model, "m");
    assert.equal(next.hooks.Stop[0].hooks[0].command, `'node' '${path.join(runtime, "current", "dist", "h.js")}'`);
    assert.equal(stabilizeClaudeSettingsHooks(file), false, "already stable");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("prune keeps current, previous and any folder a seat's saved settings names; it removes the rest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-a535-"));
  try {
    const runtime = path.join(root, "runtime"), agents = path.join(root, "agents");
    fs.mkdirSync(agents, { recursive: true });
    for (const name of ["aiterm-runtime-1", "aiterm-runtime-2", "aiterm-runtime-3", "aiterm-runtime-4", "aiterm-runtime-5"]) fs.mkdirSync(path.join(runtime, name), { recursive: true });
    fs.symlinkSync(path.join(runtime, "aiterm-runtime-5"), path.join(runtime, "current"), "junction");
    fs.symlinkSync(path.join(runtime, "aiterm-runtime-4"), path.join(runtime, "previous"), "junction");
    fs.writeFileSync(path.join(agents, "bot.0123.claude-settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "'node' '/x/.aiterm/runtime/aiterm-runtime-2/h.js'" }] }] } }));
    const result = pruneRuntimes(runtime, agents);
    assert.deepEqual(result.removed, ["aiterm-runtime-1", "aiterm-runtime-3"]);
    assert.deepEqual(result.kept.map(k => [k.dir, k.reason]).sort(), [["aiterm-runtime-2", "named_by_seat_settings"], ["aiterm-runtime-4", "active"], ["aiterm-runtime-5", "active"]]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function machineSeat(tag, { state = "idle", resultAgoMs = 5000, stateAgoMs = 10_000, markerAgoMs = 20_000, withResult = true } = {}) {
  fs.mkdirSync(agentsDir(), { recursive: true, mode: 0o700 });
  const meta = { aiterm_session: `a535${tag}`, launch_id: "0123456789abcdef0123456789abcdef", kind: "claude", claude_harness: "claude-machine", vendor_session_id: "65e19932-0000-4000-8000-000000000000" };
  const iso = ms => new Date(Date.now() - ms).toISOString();
  fs.writeFileSync(agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, "state"), JSON.stringify({ schema: "aiterm.claude-machine-state.v1", state, reason: null, pending: [],
    input_bytes_consumed: 0, last_result: { at: iso(resultAgoMs), subtype: "success", terminal_reason: null, is_error: false }, exited: false, at: iso(stateAgoMs) }));
  fs.writeFileSync(agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, "stream"),
    (withResult ? JSON.stringify({ type: "result", subtype: "success", result: "the answer", session_id: meta.vendor_session_id }) + "\n" : ""));
  const marker = agentClaudeOperationPath(meta.aiterm_session, meta.launch_id);
  fs.writeFileSync(marker, JSON.stringify({ schema: "aiterm.claude-operation-marker.v1", operation_id: `sha256:${"b".repeat(64)}` }) + "\n", { mode: 0o600 });
  const at = new Date(Date.now() - markerAgoMs);
  fs.utimesSync(marker, at, at);
  return { meta, marker, events: path.join(agentsDir(), `${meta.aiterm_session}.${meta.launch_id}.events.jsonl`) };
}

test("a machine turn with result + idle and an open marker is settled through the Stop hook once; the marker is consumed", () => {
  const seat = machineSeat("ok");
  assert.equal(settleMachineTurnWithoutStop(seat.meta, () => false), true);
  assert.equal(fs.existsSync(seat.marker), false);
  const event = JSON.parse(fs.readFileSync(seat.events, "utf8").trim());
  assert.equal(event.type, "agent_done");
  assert.equal(event.operation_id, `sha256:${"b".repeat(64)}`);
  assert.equal(settleMachineTurnWithoutStop(seat.meta, () => false), false, "marker gone: nothing to settle");
});

test("a machine turn is not settled while it could still be a live Stop, a new turn, or has nothing to say", () => {
  for (const [tag, options] of [["busy", { state: "busy" }], ["grace", { stateAgoMs: 500 }], ["newturn", { resultAgoMs: 60_000, markerAgoMs: 20_000 }], ["noresult", { withResult: false }]]) {
    const seat = machineSeat(tag, options);
    assert.equal(settleMachineTurnWithoutStop(seat.meta, () => false), false, tag);
    assert.equal(fs.existsSync(seat.marker), true, tag);
  }
  const done = machineSeat("done");
  assert.equal(settleMachineTurnWithoutStop(done.meta, () => true), false, "the event already exists");
  const tui = machineSeat("tui");
  assert.equal(settleMachineTurnWithoutStop({ ...tui.meta, claude_harness: undefined }, () => false), false, "only machine seats");
});
