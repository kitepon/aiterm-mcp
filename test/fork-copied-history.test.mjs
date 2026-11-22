// A fork's transcript starts with the main's copied conversation (a533): nothing stamped before the turn's dispatch is this turn.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { core, skipAgentDone, markFakeAgentReady, readAgentMeta } from "./core-agent-support.mjs";

test("Claude fork: a copied API error and copied interim words never end or colour the fork's turn; the fork's own error still does", { skip: skipAgentDone }, async () => {
  const { claudeSessionTranscriptPath } = await import("../dist/harnesses/claude.js");
  const { readInterimWords } = await import("../dist/interim-words.js");
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await markFakeAgentReady(sid, "claude");
    const meta = readAgentMeta(sid), transcript = claudeSessionTranscriptPath(meta);
    fs.mkdirSync(path.dirname(transcript), { recursive: true }); // the fork's file does not exist at dispatch (cursor 0)
    const row = (value, msAgo) => JSON.stringify({ sessionId: meta.vendor_session_id, timestamp: new Date(Date.now() - msAgo).toISOString(), ...value }) + "\n";
    const limit = "You've hit your weekly limit · resets 3pm";
    const receipt = await core.dispatchAgentTurn(sid, "FORK_QUESTION");
    // claude --fork-session then writes the main's conversation under the fork's own sessionId, stamped hours earlier
    fs.writeFileSync(transcript,
      row({ type: "user", uuid: "h1", parentUuid: null, message: { content: "old question" } }, 3 * 3600_000)
      + row({ type: "assistant", uuid: "h2", parentUuid: "h1", message: { stop_reason: "tool_use", content: [{ type: "text", text: "OLD INTERIM" }] } }, 3 * 3600_000 - 1000)
      + row({ type: "assistant", uuid: "h3", parentUuid: "h2", isApiErrorMessage: true, error: "rate_limit", message: { content: [{ type: "text", text: limit }] } }, 3 * 3600_000 - 2000));
    const wait = () => core.observeAgentDone(sid, { cursor: receipt.event_cursor, input_id: receipt.input_id, timeout: 0 });
    assert.equal((await wait()).outcome, "running", "the copied error is history, not this turn");
    const words = readInterimWords(meta, 0).words.map(word => word.text);
    assert.deepEqual(words, [], "copied interim words and the copied error are not this turn's");
    // the fork's own turn: a new user record, an interim word, then a real error
    await new Promise(resolve => setTimeout(resolve, 20));
    fs.appendFileSync(transcript, row({ type: "user", uuid: "n1", parentUuid: "h3", message: { content: "FORK_QUESTION" } }, 0)
      + row({ type: "assistant", uuid: "n2", parentUuid: "n1", message: { stop_reason: "tool_use", content: [{ type: "text", text: "NEW INTERIM" }] } }, 0));
    assert.equal((await wait()).outcome, "running");
    assert.deepEqual(readInterimWords(meta, 0).words.map(word => word.text), ["NEW INTERIM"]);
    fs.appendFileSync(transcript, row({ type: "assistant", uuid: "n3", parentUuid: "n2", isApiErrorMessage: true, error: "rate_limit", apiErrorStatus: 429, message: { content: [{ type: "text", text: limit }] } }, 0));
    assert.equal((await wait()).outcome, "rate_limited", "a limit this fork really hit still ends its turn");
  } finally { core.closeSession(sid); }
});
