// a442h: a launch whose caller asked for Code Mode (settings_env CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1) gets Code Mode's first-start confirm
// answered "Yes, turn on Code Mode" after the cursor is seen on it; any other launch is refused as before and nothing is typed into the dialog.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasTmux, core, skipAgentDone, readAgentMeta } from "./core-agent-support.mjs";

const RULE = "────────────────────────────────────────";
function makeFakeCodeModeBin({ cursorFirst = "No" } = {}) {
  const stem = `fake-claude-codemode-${Date.now().toString(36)}-${cursorFirst}`;
  const bin = path.join(process.env.TMPDIR, `${stem}.sh`);
  fs.mkdirSync(path.join(process.env.TMPDIR, stem), { mode: 0o700 });
  const driver = path.join(process.env.TMPDIR, stem, "claude");
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)} "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(driver, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status" && args[2] === "--json") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" })); process.exit(0);
}
const out = (lines) => process.stdout.write(lines.join("\\n") + "\\n");
let cursor = ${JSON.stringify(cursorFirst)} === "No" ? 0 : 1, started = false, line = "";
const rows = ["No, start without it", "Yes, turn on Code Mode"];
const draw = () => out(["Welcome to Claude Code v2.1.327", "", "  Code Mode (experimental)", "",
  ...rows.map((r, i) => "  " + (i === cursor ? "❯" : " ") + " " + r), "", "  Tell us how it goes with /feedback", "  Enter to confirm · Esc to start without it"]);
process.stdin.setRawMode(true); process.stdin.resume(); draw();
process.stdin.on("data", (chunk) => {
  const key = chunk.toString("utf8");
  if (started) {
    for (const ch of key) { if (ch === "\\r" || ch === "\\n") { out(["PROMPT:" + line]); line = ""; } else if (ch >= " ") line += ch; }
    return;
  }
  if (key.includes("\\x1b[B")) { cursor = Math.min(cursor + 1, 1); draw(); return; }
  if (key.includes("\\x1b[A")) { cursor = Math.max(cursor - 1, 0); draw(); return; }
  if (key.includes("\\r")) {
    out([cursor === 1 ? "CODE_MODE_ACCEPTED" : "CODE_MODE_DECLINED", "Restarting Claude Code in Code Mode…"]);
    started = true;
    setTimeout(() => out(["Claude Code v2.1.327", "${RULE}", "❯ ", "${RULE}", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"]), 300);
  }
});
`, { mode: 0o700 });
  return bin;
}

async function launch(bin, opts) {
  const saved = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  const sid = `claude_codemode_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  try { return { sid, result: await core.openAgentWithInitialPrompt("claude", { session_name: sid, ready_timeout: 8_000, ...opts }) }; }
  catch (error) { return { sid, error }; }
  finally { if (saved === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = saved; }
}

for (const cursorFirst of ["No", "Yes"]) test(`a launch that asked for Code Mode answers the confirm with Yes (cursor starts on ${cursorFirst}), waits for the restart and delivers the prompt`,
  { skip: skipAgentDone || !hasTmux }, async () => {
    const bin = makeFakeCodeModeBin({ cursorFirst });
    const marker = "AFTER_CODE_MODE_CONFIRM";
    const { sid, result, error } = await launch(bin, { prompt: marker, settings_env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" } });
    try {
      assert.equal(error, undefined, error?.message);
      assert.equal(result[0], sid);
      assert.equal(readAgentMeta(sid).initial_prompt, "pending");
      const screen = await core.readOutput(sid, { full: true, raw: true });
      assert.match(screen, /CODE_MODE_ACCEPTED/);
      assert.doesNotMatch(screen, /CODE_MODE_DECLINED/);
      assert.match(screen, new RegExp(`PROMPT:.*${marker}`));
    } finally { try { core.closeSession(sid); } catch {} fs.rmSync(bin, { force: true }); }
  });

test("a launch that did not ask for Code Mode is refused and nothing is typed into the confirm", { skip: skipAgentDone || !hasTmux }, async () => {
  const bin = makeFakeCodeModeBin();
  const { sid, error } = await launch(bin, { prompt: "MUST_NOT_REACH_THE_DIALOG", ready_timeout: 3_000 });
  try {
    assert.match(error?.message ?? "", /^AGENT_STARTUP_BLOCKED: .*reason=unknown_dialog/u);
    assert.ok(!core.listSessionsResult().sessions.some((row) => row.session_id === sid), "the seat it created is closed");
  } finally { try { core.closeSession(sid); } catch {} fs.rmSync(bin, { force: true }); }
});
