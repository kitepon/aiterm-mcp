import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { grokSessionDirectory, grokEventsTranscript, grokTranscriptText, latestGrokCompletion } from "../dist/harnesses/grok.js";

test("Grokの完了記録と回答はCLIが正規化した作業パスから読む", () => {
  const directory = path.resolve("grok-session-fixture");
  const variants = process.platform === "win32"
    ? [directory, directory.replaceAll("\\", "/")]
    : [directory, `${directory}/../grok-session-fixture`];
  for (const kind of ["grok", "composer"]) {
    for (const cwd of variants) {
      const meta = { kind, cwd, grok_home: path.resolve("grok-home"), vendor_session_id: "session-id" };
      const expected = path.join(meta.grok_home, "sessions", encodeURIComponent(directory), meta.vendor_session_id);
      assert.equal(grokSessionDirectory(meta), expected);
      assert.equal(grokEventsTranscript(meta), path.join(expected, "events.jsonl"));
      const answer = grokTranscriptText(meta, (file) => {
        assert.equal(file, path.join(expected, "chat_history.jsonl"));
        return ['{"type":"user","content":"調査して"}', '{"type":"assistant","content":"調査完了"}'];
      }, () => { throw new Error("回答取得失敗"); });
      assert.equal(answer, "調査完了");
    }
  }
});

test("次のGrok turn開始後は以前の完了を途中回答へ結び付けない", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "grok-completion-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const meta = { kind: "grok", grok_home: home, cwd: process.cwd(), vendor_session_id: "fixture" };
  mkdirSync(grokSessionDirectory(meta), { recursive: true });
  writeFileSync(grokEventsTranscript(meta), "");
  const records = [{ type: "turn_ended", outcome: "completed", ts: "prior" }];
  const read = () => records.map(v => JSON.stringify(v));
  assert.equal(latestGrokCompletion(meta, read).turn_id, "prior");
  records.push({ type: "turn_started" });
  assert.equal(latestGrokCompletion(meta, read), null);
  records.push({ type: "turn_ended", outcome: "completed", ts: "current" });
  assert.equal(latestGrokCompletion(meta, read).turn_id, "current");
});
