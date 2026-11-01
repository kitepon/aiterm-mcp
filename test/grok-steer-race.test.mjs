import "./seat-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { recordSteer, observeSteerDone } from "../dist/steer-follow.js";
import { interimFromNow } from "../dist/interim-words.js";
import { agentMetadataPath } from "../dist/agent-shared.js";

const TEXT = "追加の頼み：表を3つ付けてください";
let serial = 0;
function seat(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-steer-"));
  const meta = { kind: "grok", aiterm_session: `grok_race_${++serial}`, launch_id: serial.toString(16).padStart(32, "0"),
    cwd: home, grok_home: home, vendor_session_id: "fixture" };
  const dir = path.join(home, "sessions", encodeURIComponent(home), "fixture");
  fs.mkdirSync(dir, { recursive: true });
  const events = path.join(dir, "events.jsonl"), history = path.join(dir, "chat_history.jsonl");
  const append = (file, ...rows) => fs.appendFileSync(file, rows.map(JSON.stringify).join("\n") + "\n");
  append(events, { type: "turn_started", turn_number: 0 });
  append(history, { type: "user", content: TEXT, prompt_index: 0 });
  const metadata = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  fs.writeFileSync(metadata, "{}\n");
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(metadata, { force: true }); });
  const entry = recordSteer(meta, interimFromNow(meta, fs.statSync(events).size), TEXT);
  const handed = [];
  const wait = (timeout = 0) => observeSteerDone(meta, entry, timeout, {
    plain: async cursor => { handed.push(cursor); return { outcome: "done", turn_id: "accepted" }; },
    parseDone: () => null, rateLimit: () => null,
  });
  return { meta, events, history, append, entry, handed, wait };
}

test("Grok: old completion and repeated old text cannot complete the new input", async t => {
  const s = seat(t);
  s.append(s.events, { type: "turn_ended", outcome: "completed", ts: "old" });
  assert.equal((await s.wait()).outcome, "running");
  assert.deepEqual(s.handed, []);
  s.append(s.history, { type: "user", content: TEXT, prompt_index: 1 });
  const cursor = fs.statSync(s.events).size;
  s.append(s.events, { type: "turn_started", turn_number: 1 });
  assert.equal((await s.wait()).steer.placement, "next_turn");
  assert.deepEqual(s.handed, [cursor]);
});

test("Grok: unrelated, synthetic, and unmatched native turn records remain unknown", async t => {
  for (const row of [
    { type: "user", content: TEXT + "other", prompt_index: 1 },
    { type: "user", content: TEXT, prompt_index: 1, synthetic_reason: "reminder" },
    { type: "user", content: TEXT, prompt_index: 0 },
  ]) {
    const s = seat(t);
    s.append(s.history, row);
    s.append(s.events, { type: "turn_ended", outcome: "completed", ts: "old" }, { type: "turn_started", turn_number: 1 });
    const result = await s.wait();
    assert.equal(result.outcome, "running");
    assert.equal(result.steer.placement, "unknown");
    assert.deepEqual(s.handed, []);
  }
});

test("Grok: accepted text without a matching native start remains unknown", async t => {
  const s = seat(t);
  s.append(s.history, { type: "user", content: TEXT, prompt_index: 1 });
  s.append(s.events, { type: "turn_ended", outcome: "completed", ts: "old" });
  assert.equal((await s.wait()).outcome, "running");
  assert.deepEqual(s.handed, []);
});

test("Grok: partial or ambiguous records never produce a completion handle", async t => {
  for (const mode of ["partial", "duplicate", "truncated"]) {
    const s = seat(t);
    s.append(s.events, { type: "turn_started", turn_number: 1 });
    const row = { type: "user", content: TEXT, prompt_index: 1 };
    if (mode === "partial") fs.appendFileSync(s.history, JSON.stringify(row));
    else if (mode === "duplicate") s.append(s.history, row, row);
    else fs.writeFileSync(s.history, "");
    assert.equal((await s.wait()).steer.placement, "unknown");
    assert.deepEqual(s.handed, []);
  }
});

test("Grok: send_now cancellation follows the accepted continuation", async t => {
  const s = seat(t);
  s.append(s.events, { type: "turn_ended", outcome: "cancelled", cancellation_context: { trigger: "send_now" }, ts: "cancel" });
  const cursor = fs.statSync(s.events).size;
  s.append(s.events, { type: "turn_started", turn_number: 1 });
  s.append(s.history, { type: "user", content: TEXT, prompt_index: 1 });
  assert.equal((await s.wait()).steer.placement, "same_turn");
  assert.deepEqual(s.handed, [cursor]);
});

test("Grok: another input's send_now cannot classify this input as the same turn", async t => {
  const s = seat(t);
  s.append(s.events, { type: "turn_ended", outcome: "cancelled", cancellation_context: { trigger: "send_now" } },
    { type: "turn_started", turn_number: 1 }, { type: "turn_ended", outcome: "completed", ts: "other" });
  const cursor = fs.statSync(s.events).size;
  s.append(s.events, { type: "turn_started", turn_number: 2 });
  s.append(s.history, { type: "user", content: TEXT, prompt_index: 2 });
  assert.equal((await s.wait()).steer.placement, "next_turn");
  assert.deepEqual(s.handed, [cursor]);
});
