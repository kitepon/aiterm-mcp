// core-agentの試験のうち、起動時prompt・portable fork・動いている席への差し込み。準備は core-agent-support.mjs。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAgentActivity } from "../dist/agent-activity.js";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentFixturePrint } from "./agent-fixture-shell.mjs";
import {
  hasTmux, savedHome, fakeHome, argvPrinterBin, fakeClaudeBin, fakeGrokBin, core, codexHarness, skip,
  testUid, skipAgentDone, skipGrokFakeBin, agentStateDir, makeFakeCodexHome, makeFakeGrokHome,
  makeGrokHomeWithoutAuth, withFakeCodexHome, withFakeCodexTuiHome, withFakeGrokHome,
  withGrokHomeWithoutAuth, agentStateFiles, readAgentMeta, writeAgentMeta, bindTranscriptTurn,
  writeCodexTranscript, appendCodexTranscript, appendCodexDone, scheduleCodexDone, writeGrokTranscript,
  sessionLogPath, makeFakeCodexTuiBin, makeFakeCodexRateLimitTuiBin, makeFakeThroughlineBin,
  makeBrokenThroughlineBin, FAKE_TUI_STRIP_PASTE_MARKERS, makeFakeGrokTuiBin, makeFakeGrokFooterOnlyTuiBin,
  makeGrokCatalogBin, makeFailingGrokCatalogBin, makeFakeClaudeTuiBin, makeFakeClaudeTrustTuiBin,
  appendAgentDoneWhenLogContains, agentDoneLine, appendAgentDone, scheduleAgentDone, writeClaudeDone,
  invokeClaudeStopHook, claudeDispatchReceiptPath, appendClaudeDoneWhenLogContains, markFakeAgentReady,
  fileSnapshot,
} from "./core-agent-support.mjs";

// v0.16.0: wait/timeout/screen/lines オプションは openAgentWithInitialPrompt から削除された
// （旧 "openAgentWithInitialPrompt: wait agent_done は prompt と agent_done:true を必須にする" は
// 概念ごと消滅したため削除）。

// 0.70.36 (Kiro a15): a launch whose seat is not ready before any prompt byte closes that seat and refuses
// (AGENT_STARTUP_BLOCKED, R18). It never leaves a seat the caller would wait on.
test("openAgentWithInitialPrompt: TUI ready 失敗はpromptを送らず、作った席を閉じてAGENT_STARTUP_BLOCKEDで断る", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const sid = `initial_unready_${Date.now().toString(36)}`;
    try {
      await assert.rejects(
        core.openAgentWithInitialPrompt("codex", { session_name: sid, prompt: "Reply READY.", agent_done: true, ready_timeout: 0 }),
        (e) => {
          assert.match(e.message, /^AGENT_STARTUP_BLOCKED: .*reason=/u, `ready failure error: ${e.message}`);
          assert.equal(e.launchNotStarted.code, "AGENT_STARTUP_BLOCKED");
          assert.equal(e.launchNotStarted.harness, "codex-cli");
          return true;
        },
      );
      assert.ok(!core.listSessionsResult().sessions.some((row) => row.session_id === sid), "the seat it created is closed");
    } finally {
      try { core.closeSession(sid); } catch {}
    }
  });
});

for (const dropFirstDown of [false, true]) test(`openAgentWithInitialPrompt: Claudeの無人起動確認とworkspace trustを、選択の移動を確かめてから承認する（最初のDown取り落とし=${dropFirstDown}）`, { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTrustTuiBin({ dropFirstDown });
  const sid = `claude_trust_${Date.now().toString(36)}`;
  const marker = "SHOULD_NOT_BE_SENT_TO_TRUST_MENU";
  process.env.CLAUDE_BIN = fakeBin;
  try {
    const result = await core.openAgentWithInitialPrompt("claude", {
      session_name: sid,
      prompt: marker,
      ready_timeout: 5_000,
    });
    assert.equal(result[0], sid);
    const meta = readAgentMeta(sid);
    assert.equal(meta.initial_prompt, "pending");
    assert.equal(fs.statSync(meta.event_file).size, 0, "completion eventを偽造しない");
    assert.equal(fs.statSync(meta.result_file).size, 0, "Claude resultを偽造しない");
    // 偽Claudeは確認画面を描き直すので、画面ではなく全出力で確かめる。
    const screen = await core.readOutput(sid, { full: true, raw: true });
    assert.match(screen, /THEME_ACCEPTED:/);
    assert.match(screen, /BYPASS_ACCEPTED:/);
    assert.match(screen, /TRUST_ACCEPTED:Yes, I trust this folder/);
    assert.doesNotMatch(screen, /EXITED_BY:/);
    assert.match(screen, new RegExp(marker));
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
    fs.rmSync(`${fakeBin}.prompts`, { force: true });
  }
});

function makeFakeClaudeOnboardingTuiBin() {
  const bin = path.join(process.env.TMPDIR, `fake-claude-onboarding-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
      "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
      "  exit 0",
      "fi",
      "printf '%s\\n' 'Welcome to Claude Code v2.1.282' 'Choose the text style that looks best with your terminal' '  1. Auto (match terminal)' '❯ 2. Dark mode ✔' '  3. Light mode'",
      "IFS= read -r theme_response",
      "printf '%s\\n' 'Select login method:' ' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise' '   2. Anthropic Console account · API usage billing' '   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI'",
      "while IFS= read -r line; do printf 'PROMPT:%s\\n' \"$line\" >> \"$0.prompts\"; printf 'PROMPT:%s\\n' \"$line\"; done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

// Centi train W F2 (2026-11-14): agy drew its login screen for 3 s right after a login, then went on by itself, but the launch
// had already closed the seat. A screen Aiterm does not answer is watched until the ready budget ends.
test("openAgentWithInitialPrompt: an unanswered startup screen that leaves by itself goes on to the prompt", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const bin = path.join(process.env.TMPDIR, `fake-claude-transient-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(bin, ["#!/bin/sh",
    "if [ \"$1\" = auth ]; then printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'; exit 0; fi",
    "printf '%s\\n' '3 new MCP servers found in this project' 'Press Enter to continue'", "sleep 2", "printf '\\033[2J\\033[H'",
    "printf 'Claude Code\\n❯ ready\\n'", "while IFS= read -r line; do printf '%s\\n' \"$line\" >> \"$0.prompts\"; done", ""].join("\n"), { mode: 0o700 });
  const sid = `claude_transient_${Date.now().toString(36)}`;
  process.env.CLAUDE_BIN = bin;
  try {
    const outcome = await core.openAgentWithInitialPrompt("claude", { session_name: sid, prompt: "TRANSIENT_SCREEN_PROMPT", ready_timeout: 20_000 })
      .then(() => "sent", (error) => error.message);
    assert.doesNotMatch(outcome, /AGENT_STARTUP_BLOCKED/u);
    const sent = () => fs.existsSync(`${bin}.prompts`) && fs.readFileSync(`${bin}.prompts`, "utf8").includes("TRANSIENT_SCREEN_PROMPT");
    for (let i = 0; i < 50 && !sent(); i++) await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(sent(), `the prompt reached the seat after the screen left (${outcome})`);
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(bin, { force: true }); fs.rmSync(`${bin}.prompts`, { force: true });
  }
});

// Kiro rabbit-linux (2026-11-14): agy drew an `esc to dismiss` notice on its first start after a self-update; the frame right
// after Aiterm's one Escape still showed it and the launch refused 0.84 s later. The notice is answered again while it stays.
// POSIX only: the fake is a shebang script on a raw tty; the loop it checks is shared by every platform.
test("openAgentWithInitialPrompt: agy's notice that outlives the first Escape is answered again, then the prompt goes", { skip: skipAgentDone || process.platform === "win32" }, async () => {
  const saved = process.env.ANTIGRAVITY_BIN;
  const bin = path.join(process.env.TMPDIR, `fake-agy-notice-${Date.now().toString(36)}.js`);
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require("node:fs"), out = s => process.stdout.write(s);
if (process.argv[2] === "models" || process.argv[2] === "-p") { out("gemini-3.8-flash-medium\\tGemini 3.8 Flash (Medium)\\n"); process.exit(0); }
if (process.argv[2] === "--version") { out("1.5.8\\n"); process.exit(0); }
const notice = () => out("\\x1b[2J\\x1b[HAntigravity CLI 1.5.8\\n\\n  What's new  esc to dismiss\\n");
let escapes = 0, line = "";
out("\\x1b[?1049h"); // agy draws on the alternate screen
notice();
process.stdin.setRawMode(true);
process.stdin.on("data", data => {
  for (const ch of data.toString()) {
    if (ch === "\\x1b" && ++escapes === 1) notice();  // the first Escape is lost in the redraw
    else if (ch === "\\x1b") out("\\x1b[2J\\x1b[H────\\n>\\n────\\n? for shortcuts\\n");
    else if (ch === "\\r") { fs.appendFileSync(process.argv[1] + ".prompts", line + "\\n"); line = ""; }
    else line += ch;
  }
});
`, { mode: 0o700 });
  const sid = `agy_notice_${Date.now().toString(36)}`;
  process.env.ANTIGRAVITY_BIN = bin;
  try {
    const outcome = await core.openAgentWithInitialPrompt("antigravity", { session_name: sid, prompt: "NOTICE_PROMPT", ready_timeout: 20_000 })
      .then(() => "sent", (error) => error.message);
    assert.doesNotMatch(outcome, /AGENT_STARTUP_BLOCKED/u);
    const sent = () => fs.existsSync(`${bin}.prompts`) && fs.readFileSync(`${bin}.prompts`, "utf8").includes("NOTICE_PROMPT");
    for (let i = 0; i < 50 && !sent(); i++) await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(sent(), `the prompt reached the seat after the notice left (${outcome})`);
  } finally {
    try { core.closeSession(sid); } catch {}
    if (saved === undefined) delete process.env.ANTIGRAVITY_BIN;
    else process.env.ANTIGRAVITY_BIN = saved;
    fs.rmSync(bin, { force: true }); fs.rmSync(`${bin}.prompts`, { force: true });
  }
});

// 実被弾 2026-09-26 rabbit（Claude Code 2.1.282）: ログイン済みでも初回案内が未完了だと
// ログイン方法の選択で止まる。ready timeoutを待たずに理由と直し方を返す。
test("openAgentWithInitialPrompt: Claudeの初回案内が未完了ならtimeoutを待たず理由と直し方を返す", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeOnboardingTuiBin();
  const sid = `claude_onboarding_${Date.now().toString(36)}`;
  const marker = "SHOULD_NOT_BE_SENT_TO_LOGIN_MENU";
  process.env.CLAUDE_BIN = fakeBin;
  const started = performance.now();
  try {
    await assert.rejects(
      core.openAgentWithInitialPrompt("claude", { session_name: sid, prompt: marker, ready_timeout: 20_000 }),
      (error) => {
        // 0.70.36: blocked before any prompt byte -> the launch closes its seat and refuses (R18 AGENT_STARTUP_BLOCKED).
        assert.match(error.message, /^AGENT_STARTUP_BLOCKED: .*reason=vendor_onboarding_required/u);
        assert.match(error.message, /初回案内/);
        assert.deepEqual({ ...error.launchNotStarted, action: typeof error.launchNotStarted.action },
          { harness: "claude-code", phase: "input", code: "AGENT_STARTUP_BLOCKED", action: "string" });
        return true;
      },
    );
    assert.ok(performance.now() - started < 15_000, "ready timeoutまで待たない");
    assert.ok(!fs.existsSync(`${fakeBin}.prompts`) || !fs.readFileSync(`${fakeBin}.prompts`, "utf8").includes(marker), "ログイン方法の選択へpromptを送らない");
    assert.ok(!core.listSessionsResult().sessions.some((row) => row.session_id === sid), "the seat it created is closed");
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

// 実被弾 2026-08-25 の実機capture逐語（Codex v0.149.0）。ダイアログ表示中はheader/footerが
// 描かれないため、codexTuiReady では拾えず codexLaunchBlockingDialog が種別を特定する。
test("codexLaunchBlockingDialog: 起動前modalの実機画面を種別付きで検知する", () => {
  const updateScreen = [
    "  ✨ Update available! 0.149.0 -> 0.149.1",
    "",
    "  Release notes: https://github.com/openai/codex/releases/latest",
    "",
    "› 1. Update now (runs `npm install -g @openai/codex`)",
    "  2. Skip",
    "  3. Skip until next version",
    "",
    "  Press enter to continue",
  ].join("\n");
  assert.match(codexHarness.codexLaunchBlockingDialog(updateScreen), /update確認/);
  assert.equal(codexHarness.codexLaunchBlockingDialog([
    "✨ Update available! 0.151.0 -> 0.152.1",
    "Run npm install -g @openai/codex to update.",
    "OpenAI Codex (v0.151.0)",
    "› Ask Codex to do anything",
  ].join("\n")), null);
  const trustScreen = [
    "You are in /Users/kite/Developer/poly",
    "Do you trust the contents of this directory?",
    "Working with untrusted contents comes with higher risk of prompt injection.",
    "› 1. Yes, continue",
    "  2. No, quit",
    "Press enter to continue",
  ].join("\n");
  assert.match(codexHarness.codexLaunchBlockingDialog(trustScreen), /trust確認/);
  assert.match(codexHarness.codexLaunchBlockingDialog("something\nPress enter to continue"), /種別未特定/);
  assert.equal(codexHarness.codexLaunchBlockingDialog("› Ask Codex to do anything\n  gpt-5.6-luna low · ~/x"), null);
});

test("codexTuiReady: 現行Codexのdefault effort footerを入力待ちとして認識する", () => {
  const screen = [
    "• 承知しました。次のメッセージをお待ちしています。",
    "",
    "› Ask Codex to do anything",
    "",
    "  gpt-5.6-sol default · /srv/bellteam/bots/bot-93433892",
  ].join("\n");
  assert.equal(codexHarness.codexTuiReady(screen), true);
});

test("openAgentWithInitialPrompt: 終了したharnessの残画面へpromptを送らない", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin(false, true);
  process.env.CODEX_BIN = fakeBin;
  const sid = `initial_exited_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await assert.rejects(core.openAgentWithInitialPrompt("codex", { session_name: sid, prompt: "SHOULD_NOT_REACH_SHELL" }), error => {
        // The prompt is never typed into the leftover shell; the seat is closed and the launch refused (0.70.36).
        assert.match(error.message, /^AGENT_STARTUP_BLOCKED: .*reason=harness_exited/u);
        return true;
      });
      assert.ok(!core.listSessionsResult().sessions.some((row) => row.session_id === sid), "the seat it created is closed");
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("observeSession: SIGSTOPしたharnessを残画面に関係なくblockedにする", { skip: skipAgentDone || process.platform === "win32" }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  const sid = `observe_stopped_${Date.now().toString(36)}`;
  let pid;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", { session_name: sid, trust_project: true });
      pid = core.observeSession(sid).harness_process.pid;
      process.kill(pid, "SIGSTOP");
      await new Promise(resolve => setTimeout(resolve, 100));
      const stopped = core.observeSession(sid);
      assert.equal(stopped.harness_alive, true);
      assert.equal(stopped.state, "blocked");
      assert.equal(stopped.reason, "harness_stopped");
    });
  } finally {
    if (pid) process.kill(pid, "SIGCONT");
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: 送信後の実行表示だけを開始確認に使う", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin(true);
  process.env.CODEX_BIN = fakeBin;
  const sid = `initial_started_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      const result = await core.openAgentWithInitialPrompt("codex", { session_name: sid, prompt: "開始確認" });
      assert.deepEqual(result[4], { status: "started", reason: "turn_running", turn_started: true });
    });
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: prompt を shell argv に載せず pending event_cursor を返す", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  try {
    await withFakeCodexHome(async () => {
      const sid = `initial_success_${Date.now().toString(36)}`;
      const marker = "AITERM_OPEN_AGENT_INITIAL_OK";
      try {
        const [actualSid, out, launchCursor, submitResidue, initialDelivery] = await core.openAgentWithInitialPrompt("codex", {
          session_name: sid,
          prompt: `日本語の複数行 prompt です。\n${marker}\nこの token だけを返してください。`,
          agent_done: true,
        });
        assert.equal(actualSid, sid);
        assert.equal(initialDelivery.status, "submitted_unconfirmed");
        assert.equal(initialDelivery.turn_started, null);
        assert.match(out, /initial_prompt=pending vendor=codex event_cursor=\d+/, `pending hint: ${out}`);
        assert.ok(
          submitResidue === null || typeof submitResidue === "boolean",
          `submit_residue を構造化して返す: ${JSON.stringify(submitResidue)}`,
        );
        assert.doesNotMatch(out, /> .*AITERM_OPEN_AGENT_INITIAL_OK/, `shell continuation に prompt を載せない: ${out}`);
        const meta = readAgentMeta(sid);
        assert.equal(meta.initial_prompt, "pending");
        assert.equal(typeof launchCursor, "number", "構造化 event_cursor を返す");
        assert.ok(readAgentActivity(meta).last_input_at);
        assert.equal(readAgentActivity(meta).last_turn_end_at, null);
        assert.match(out, new RegExp(`event_cursor=${launchCursor}\\b`), "hint と構造化 cursor が一致する");
        appendCodexDone(meta, { turn_id: "open-agent-initial", vendor_session_id: "open-agent-vendor" });
        const observation = await core.observeAgentDone(sid, { cursor: launchCursor, timeout: 3 });
        assert.equal(observation.outcome, "done");
        assert.equal(observation.turn_id, "open-agent-initial");
        assert.equal(observation.vendor_session_id, "open-agent-vendor");
      } finally {
        try {
          core.closeSession(sid);
        } catch {
          /* noop */
        }
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("portable fork: Codex TUIへThroughline contextをmissionより前に一度だけ送る", { skip: skipAgentDone }, async () => {
  const savedCodexBin = process.env.CODEX_BIN;
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const inputFile = path.join(process.env.TMPDIR, `portable-codex-input-${Date.now().toString(36)}.txt`);
  fs.writeFileSync(inputFile, "");
  const fakeCodex = makeFakeCodexTuiBin(false, false, inputFile);
  const fakeThroughline = makeFakeThroughlineBin();
  process.env.CODEX_BIN = fakeCodex;
  process.env.THROUGHLINE_BIN = fakeThroughline;
  const sid = `portable_codex_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", {
        session_name: sid,
        prompt: "MISSION_MARKER を実行してください。",
        throughline_source_session: "source-session",
      });
      // Inspect logical submits from the paste-aware fake TUI. LF inside one
      // paste is content, while Enter outside the paste is the submit boundary.
      const deadline = performance.now() + 5000;
      let submissions = [];
      do {
        try { submissions = fs.readFileSync(inputFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
        if (submissions.some(input => input.text.includes("MISSION_MARKER"))) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (performance.now() < deadline);
      assert.equal(submissions.length, 1, JSON.stringify(submissions));
      assert.equal(submissions[0].paste_frames, 1);
      const output = submissions[0].text;
      assert.equal(output.split("SOURCE_CONTEXT_MARKER").length - 1, 1, output);
      assert.equal(output.split("MISSION_MARKER").length - 1, 1, output);
      assert.ok(output.indexOf("SOURCE_CONTEXT_MARKER") < output.indexOf("MISSION_MARKER"), output);
      assert.match(output, /---\n\n## Portable fork mission/);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedCodexBin;
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    fs.rmSync(fakeCodex, { force: true });
    fs.rmSync(fakeCodex + ".cjs", { force: true });
    fs.rmSync(inputFile, { force: true });
    fs.rmSync(fakeThroughline, { force: true });
  }
});

test("portable fork: 補足JSON pathを解釈せずThroughlineへ渡す", { skip: skipAgentDone }, async () => {
  const savedCodexBin = process.env.CODEX_BIN;
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const fakeCodex = makeFakeCodexTuiBin();
  const fakeThroughline = makeFakeThroughlineBin(undefined, "SUPPLEMENT_MARKER_PATH");
  process.env.CODEX_BIN = fakeCodex;
  process.env.THROUGHLINE_BIN = fakeThroughline;
  const sid = `portable_supplement_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", {
        session_name: sid,
        prompt: "MISSION_MARKER",
        throughline_source_session: "source-session",
        throughline_supplement_file: "SUPPLEMENT_MARKER_PATH",
      });
      const output = await core.readOutput(sid, {
        wait: true,
        until: "MISSION_MARKER",
        timeout: 5,
        full: true,
        raw: true,
      });
      assert.match(output, /SOURCE_CONTEXT_MARKER/);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedCodexBin;
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    fs.rmSync(fakeCodex, { force: true });
    fs.rmSync(fakeThroughline, { force: true });
  }
});

test("portable fork: Grok TUI promptも同じcontext→mission順で合成する", { skip: skipGrokFakeBin }, async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const savedGrokBin = process.env.GROK_BIN;
  const fakeThroughline = makeFakeThroughlineBin();
  const fakeGrok = makeFakeGrokTuiBin();
  process.env.THROUGHLINE_BIN = fakeThroughline;
  process.env.GROK_BIN = fakeGrok;
  let sid = null;
  try {
    await withFakeGrokHome(async () => {
      [sid] = await core.openAgentWithInitialPrompt("grok", {
        prompt: "MISSION_MARKER を実行してください。",
        throughline_source_session: "source-session",
      });
      const output = await core.readOutput(sid, { wait: true, timeout: 5, full: true, raw: true });
      assert.ok(output.indexOf("SOURCE_CONTEXT_MARKER") < output.indexOf("MISSION_MARKER"), output);
      assert.match(output, /Portable fork mission/);
    });
  } finally {
    if (sid) {
      try { core.closeSession(sid); } catch {}
    }
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    if (savedGrokBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedGrokBin;
    fs.rmSync(fakeThroughline, { force: true });
    fs.rmSync(fakeGrok, { force: true });
  }
});

test("portable fork: contextは加工せず一度だけmissionの前へ合成する", () => {
  const context = "CONTEXT_MARKER\n記憶本文";
  const mission = "MISSION_MARKER\n実装してください";
  const prompt = core.composePortableForkPrompt(context, mission);
  assert.equal(prompt, `${context}\n\n---\n\n## Portable fork mission\n\n${mission}`);
  assert.equal(prompt.split("CONTEXT_MARKER").length - 1, 1);
  assert.ok(prompt.indexOf("CONTEXT_MARKER") < prompt.indexOf("MISSION_MARKER"));
});

test("portable fork: Throughline外部境界の失敗はPTY作成前に明示拒否する", async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const invalidSchema = makeBrokenThroughlineBin("{}");
  const emptyContext = makeBrokenThroughlineBin(JSON.stringify({
    schema: "throughline.handoff_context.v1",
    status: "ready",
    sessionId: "source-session",
    context: "",
  }));
  const nonzero = makeBrokenThroughlineBin("", 7);
  const cases = [
    path.join(process.env.TMPDIR, "missing-throughline"),
    invalidSchema,
    emptyContext,
    nonzero,
  ];
  try {
    for (const bin of cases) {
      process.env.THROUGHLINE_BIN = bin;
      const before = core.listSessions();
      await assert.rejects(
        core.openAgentWithInitialPrompt("codex", {
          prompt: "MISSION_MARKER",
          throughline_source_session: "source-session",
        }),
        /Throughline/,
      );
      assert.equal(core.listSessions(), before, `${bin}: 外部失敗でsessionを作らない`);
    }
  } finally {
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    for (const bin of [invalidSchema, emptyContext, nonzero]) fs.rmSync(bin, { force: true });
  }
});

test("portable fork: source省略時はThroughlineを起動せず既存clean launchを維持する", { skip: skipGrokFakeBin }, async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const savedGrokBin = process.env.GROK_BIN;
  const broken = makeBrokenThroughlineBin("", 7);
  const fakeGrok = makeFakeGrokTuiBin();
  process.env.THROUGHLINE_BIN = broken;
  process.env.GROK_BIN = fakeGrok;
  let sid = null;
  try {
    await withFakeGrokHome(async () => {
      [sid] = await core.openAgentWithInitialPrompt("grok", { prompt: "CLEAN_MISSION_MARKER" });
      const output = await core.readOutput(sid, { wait: true, timeout: 5, full: true, raw: true });
      assert.match(output, /CLEAN_MISSION_MARKER/);
      assert.doesNotMatch(output, /Portable fork mission/);
    });
  } finally {
    if (sid) {
      try { core.closeSession(sid); } catch {}
    }
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    if (savedGrokBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedGrokBin;
    fs.rmSync(broken, { force: true });
    fs.rmSync(fakeGrok, { force: true });
  }
});

test("openAgentWithInitialPrompt: Grokもargv queueでなくTUI dispatchのpending cursorを返す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fakeBin = makeFakeGrokTuiBin();
  process.env.GROK_BIN = fakeBin;
  let sid = null;
  let launchCursor = null;
  let submitResidue = null;
  try {
    await withFakeGrokHome(async () => {
      [sid, , launchCursor, submitResidue] = await core.openAgentWithInitialPrompt("grok", {
        session_name: `initial_grok_${Date.now().toString(36)}`,
        model: "grok-4.6",
        reasoning_effort: "medium",
        prompt: "GROK_TUI_DISPATCH_MARKER",
      });
      assert.equal(typeof launchCursor, "number");
      assert.ok(submitResidue === null || typeof submitResidue === "boolean");
      assert.equal(readAgentMeta(sid).initial_prompt, "pending");
      const output = await core.readOutput(sid, { wait: true, until: "GROK_TUI_DISPATCH_MARKER", timeout: 5, full: true, raw: true });
      assert.match(output, /GROK_TUI_DISPATCH_MARKER/);
    });
  } finally {
    if (sid) { try { core.closeSession(sid); } catch {} }
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("portable fork: mission必須かつlaunch_operation_idとは排他", async () => {
  const before = core.listSessions();
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", { throughline_source_session: "source-session" }),
    /promptにmissionが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      prompt: "MISSION_MARKER",
      throughline_supplement_file: "SUPPLEMENT_MARKER_PATH",
    }),
    /throughline_source_sessionが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      prompt: "MISSION_MARKER",
      throughline_source_session: "source-session",
      launch_operation_id: `sha256:${"a".repeat(64)}`,
    }),
    /launch_operation_idと併用できません/,
  );
  assert.equal(core.listSessions(), before);
});

test("openAgentWithInitialPrompt: Claude初回promptを対話PTYへ送りpending event_cursorを返す", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin();
  process.env.CLAUDE_BIN = fakeBin;
  const sid = `claude_initial_${Date.now().toString(36)}`;
  const marker = "AITERM_CLAUDE_INITIAL_OK";
  try {
    const [actualSid, out] = await core.openAgentWithInitialPrompt("claude", {
      session_name: sid,
      prompt: `日本語の初回promptです。\n${marker}`,
      agent_done: true,
    });
    assert.equal(actualSid, sid);
    assert.match(out, /initial_prompt=pending vendor=claude event_cursor=\d+/, `pending hint: ${out}`);
    const meta = readAgentMeta(sid);
    assert.equal(meta.initial_prompt, "pending");
    writeClaudeDone(meta, "Claude initial answer", { vendor_session_id: meta.vendor_session_id });
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude initial answer/);
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    try {
      core.closeSession(sid);
    } catch {
      /* noop */
    }
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: 起動後 error でも session_id を失わない", { skip: skipAgentDone }, async () => {
  // v0.16.0: sendInitialAgentPrompt はevent到着を待たないfire-and-forgetになったため、旧来の
  // 「Stop eventの複数vendor_session_id混在」は初回prompt処理中にはもう起こらない
  // （bindCompletedInitialPromptは次回follow-upのdispatchAgentTurn時にしか走らない）。
  // 新契約でも決定的に再現できる送信前拒否（MAX_SEND_BYTES超過）へ置き換える。
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  try {
    await withFakeCodexHome(async () => {
      const sid = `initial_error_${Date.now().toString(36)}`;
      const oversizedPrompt = "x".repeat(70 * 1024);
      try {
        await assert.rejects(
          () =>
            core.openAgentWithInitialPrompt("codex", {
              session_name: sid,
              prompt: oversizedPrompt,
              agent_done: true,
            }),
          (e) => e.code === 2 && e.message.includes(`session_id: ${sid}`) && /bytesを超えています/.test(e.message),
        );
        assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "失敗後も session は残す");
        assert.equal(readAgentMeta(sid).initial_prompt, "failed");
      } finally {
        try {
          core.closeSession(sid);
        } catch {
          /* noop */
        }
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("sendInitialAgentPrompt: 初回 prompt の内容を評価せず専用 boundary で送信する", { skip: skipAgentDone }, async t => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const out = await core.sendInitialAgentPrompt(sid, "explain what rm -rf / does").catch(async error => {
        const { readRuntimeProcesses, processSubtree } = await import("../dist/process-runtime.js");
        const live = core.observeSession(sid), rows = readRuntimeProcesses();
        const candidates = core.selectHarnessProcesses(meta, rows, live.pane_process ? processSubtree(rows, live.pane_process.pid) : []);
        t.diagnostic(JSON.stringify({ state: live.state, reason: live.reason, harness_alive: live.harness_alive,
          same_launch: live.launch_id === meta.launch_id, pane_pid: live.pane_process?.pid,
          harness_pid: live.harness_process?.pid, candidates: candidates.map(row => row.pid),
          declared_processes: rows.filter(row => row.command.includes(meta.agent_executable)).map(row => ({
            pid: row.pid, parent_pid: row.parent_pid, stopped: row.stopped,
          })),
        }));
        throw error;
      });
      assert.match(out.text, /initial_prompt=pending vendor=codex event_cursor=\d+/, `pending hint: ${out.text}`);
      assert.equal(typeof out.event_cursor, "number", "構造化 event_cursor を返す");
      appendCodexDone(meta, { turn_id: "initial-turn", vendor_session_id: "initial-vendor" });
      const observation = await core.observeAgentDone(sid, { cursor: out.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done");
      assert.equal(observation.turn_id, "initial-turn");
      const updated = readAgentMeta(sid);
      assert.equal(updated.initial_prompt, "pending");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("sendInitialAgentPrompt: 送信後は pending にし follow-up を送信前に拒否する", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const hint = await core.sendInitialAgentPrompt(sid, "Reply READY.");
      assert.match(hint.text, /initial_prompt=pending/, `pending hint: ${hint.text}`);
      const meta = readAgentMeta(sid);
      assert.equal(meta.initial_prompt, "pending");
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /起動時 prompt/.test(e.message),
      );
      assert.throws(
        () => core.send(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /混入防止/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: agent event は補助 metadata に出すが completion には昇格しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, { turn_id: "stale-read-turn", vendor_session_id: "stale-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent vendor=codex harness=codex-cli/, `agent metadata: ${out}`);
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /completion_attribution=none/, `agent attribution: ${out}`);
      assert.match(out, /last_turn_id=stale-read-turn/, `agent turn id: ${out}`);
      assert.doesNotMatch(out, /is_complete=True via agent_done/, `stale event を completion にしない: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: 1MB 超の agent event tail でも最新 metadata を表示する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "tail-vendor", []);
      fs.appendFileSync(transcript, "not-json\n".repeat(140_000));
      appendCodexDone(meta, { turn_id: "tail-read-turn", vendor_session_id: "tail-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /last_turn_id=tail-read-turn/, `agent turn id: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: 非 agent metadata negative-cache は close/openAgent で無効化される", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const session = "negativecache";
    core.openSession(session);
    // screen 内容はプロンプト描画タイミングで揺れるため同一比較しない（CI 実測 flake）。
    // 不変条件は「非 agent read には agent suffix が付かない（cache 有無に関わらず）」の方。
    const first = await core.readOutput(session, { screen: true, timeout: 0 });
    const second = await core.readOutput(session, { screen: true, timeout: 0 });
    assert.doesNotMatch(first, /\[agent /, "非 agent read に agent suffix は付かない（cache 前）");
    assert.doesNotMatch(second, /\[agent /, "非 agent read に agent suffix は付かない（cache 中）");
    core.closeSession(session);

    const [sid] = core.openAgent("codex", { session_name: session, agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, { turn_id: "cache-cleared-turn", vendor_session_id: "cache-cleared-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /last_turn_id=cache-cleared-turn/, `agent turn id: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: agent TUI ready 前は送信前に拒否し文字を流さない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT", { ready_timeout: 0 }),
        (e) => e.code === 2 && /入力受付状態/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: 起動直後のClaudeはcomposer描画前に送信せず、初回dispatchもready gateを通す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_COLD_START_PROMPT", { ready_timeout: 0 }),
      (e) => e.code === 2 && /入力受付状態/.test(e.message),
    );
    const out = await core.readOutput(sid, { screen: true, raw: true });
    assert.doesNotMatch(out, /CLAUDE_COLD_START_PROMPT/);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_COLD_START_PROMPT", { ready_timeout: 1000 });
    assert.equal(receipt.harness, "claude-code");
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /CLAUDE_COLD_START_PROMPT/);
  } finally {
    core.closeSession(sid);
  }
});

test("sendAgentMessage: 実行中のCodexへは現在ターンへ差し込む", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      core.send(sid, agentFixturePrint("OpenAI Codex\n• Working (1s • esc to interrupt)\n"), {
        force: true,
        raw: true,
        preserveAgentOperation: true,
      });
      await core.readOutput(sid, { wait: true, until: "esc to interrupt", timeout: 5, raw: true });
      const receipt = await core.sendAgentMessage(sid, "echo STEER_BODY");
      assert.equal(receipt.schema, "aiterm.agent-steer.v1");
      assert.equal(receipt.vendor, "codex");
      assert.equal(receipt.harness, "codex-cli");
      assert.equal("follow" in receipt, false, "頼まれていない差し込みには、追う手がかりを足さない");
      assert.equal(fs.existsSync(path.join(agentStateDir(), `${sid}.${readAgentMeta(sid).launch_id}.steers.jsonl`)), false);
      const out = await core.readOutput(sid, { wait: true, until: "STEER_BODY", timeout: 5, raw: true });
      assert.match(out, /STEER_BODY/);
    } finally {
      core.closeSession(sid);
    }
  });
});

// BellTeamのため（ADR 0122）。待ちが記録の中から文を見つける所は test/steer-follow.test.mjs が持つ。ここは、送信の道が控えを取って返す所。
test("sendAgentMessage: followを頼んだ差し込みは、打つ直前の位置と控えのIDを返し、その控えで待てる", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    let closed = false;
    try {
      core.send(sid, agentFixturePrint("OpenAI Codex\n• Working (1s • esc to interrupt)\n"), {
        force: true,
        raw: true,
        preserveAgentOperation: true,
      });
      await core.readOutput(sid, { wait: true, until: "esc to interrupt", timeout: 5, raw: true });
      const receipt = await core.sendAgentMessage(sid, "echo STEER_FOLLOWED", { follow: true });
      assert.equal(receipt.schema, "aiterm.agent-steer.v1");
      assert.match(receipt.follow.steer_id, /^[0-9a-f]{16}$/);
      // 偽の席には記録がまだ無いので、位置は頭。
      assert.equal(receipt.follow.event_cursor, 0);
      assert.equal(receipt.follow.interim_from, "v1:0:b:0");
      const ledger = path.join(agentStateDir(), `${sid}.${receipt.launch_id}.steers.jsonl`);
      const entries = fs.readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].steer_id, receipt.follow.steer_id);
      assert.equal(entries[0].needle, "echoSTEER_FOLLOWED");
      assert.deepEqual(core.agentWaitProcess(sid, receipt.follow.event_cursor, {}, receipt.follow.steer_id).args.slice(-6),
        ["--session", sid, "--cursor", "0", "--steer", receipt.follow.steer_id]);
      const observed = await core.observeAgentDone(sid, { steer: receipt.follow.steer_id, cursor: 0, timeout: 0 });
      assert.equal(observed.outcome, "running");
      assert.deepEqual(observed.steer, { placement: "unknown", taken_at: null });
      // 控えが無いIDは、位置が渡されていれば今までの待ちで返し、無ければ断る。
      const unknown = await core.observeAgentDone(sid, { steer: "ffffffffffffffff", cursor: 0, timeout: 0 });
      assert.deepEqual(unknown.steer, { placement: "unknown", taken_at: null });
      await assert.rejects(core.observeAgentDone(sid, { steer: "ffffffffffffffff", timeout: 0 }), /STEER_NOT_FOUND/);
      core.closeSession(sid);
      closed = true;
      assert.equal(fs.existsSync(ledger), false, "控えは、席を閉じる時に片付ける");
    } finally {
      if (!closed) core.closeSession(sid);
    }
  });
});

test("sendAgentMessage: 実行中のClaudeへはturn相関を変えずに差し込む", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    core.send(sid, agentFixturePrint("Claude Code\n* Herding… (3s · esc to interrupt)\n"), {
      force: true,
      raw: true,
      preserveAgentOperation: true,
    });
    await core.readOutput(sid, { wait: true, until: "esc to interrupt", timeout: 5, raw: true });
    const meta = readAgentMeta(sid);
    const stateDir = path.dirname(meta.event_file);
    // Aitermが送ったturnの印。Stop hookが消すまでturnは実行中。
    fs.writeFileSync(path.join(stateDir, `${sid}.${meta.launch_id}.claude-operation.json`),
      JSON.stringify({ schema: "aiterm.claude-operation-marker.v1", operation_id: null }), { mode: 0o600 });
    const before = fs.readdirSync(stateDir).sort();
    const receipt = await core.sendAgentMessage(sid, "echo CLAUDE_STEER_BODY");
    assert.equal(receipt.schema, "aiterm.agent-steer.v1");
    assert.equal(receipt.harness, "claude-code");
    assert.deepEqual(fs.readdirSync(stateDir).sort(), before, "差し込みで新しいoperationやreceiptを作らない");
    const out = await core.readOutput(sid, { wait: true, until: "CLAUDE_STEER_BODY", timeout: 5, raw: true });
    assert.match(out, /CLAUDE_STEER_BODY/);
  } finally {
    core.closeSession(sid);
  }
});

test("sendAgentMessage: Claudeのtool処理中に画面のbusy表示が消えても同じturnへ差し込む", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    core.send(sid, agentFixturePrint("Claude Code\n❯\n"), {
      force: true,
      raw: true,
      preserveAgentOperation: true,
    });
    await core.readOutput(sid, { wait: true, until: "Claude Code", timeout: 5, raw: true });
    const meta = readAgentMeta(sid);
    const marker = path.join(path.dirname(meta.event_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    fs.writeFileSync(marker, JSON.stringify({ schema: "aiterm.claude-operation-marker.v1", operation_id: null }), { mode: 0o600 });
    const receipt = await core.sendAgentMessage(sid, "echo CLAUDE_TOOL_STEER_BODY");
    assert.equal(receipt.schema, "aiterm.agent-steer.v1");
    assert.equal(fs.existsSync(marker), true, "差し込みは実行中turnの印を保持する");
  } finally {
    core.closeSession(sid);
  }
});

test("sendAgentMessage: ClaudeのAPIエラー終了後は古いturnの印を消して次のturnを送る", { skip: skipAgentDone }, async () => {
  const claudeHarness = await import("../dist/harnesses/claude.js");
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await markFakeAgentReady(sid, "claude");
    const meta = readAgentMeta(sid);
    const marker = path.join(path.dirname(meta.event_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    fs.writeFileSync(marker, JSON.stringify({ schema: "aiterm.claude-operation-marker.v1", operation_id: null }), { mode: 0o600 });
    const earlier = new Date(Date.now() - 1000);
    fs.utimesSync(marker, earlier, earlier);
    const transcript = claudeHarness.claudeSessionTranscriptPath(meta);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, JSON.stringify({
      type: "assistant", isApiErrorMessage: true, timestamp: new Date().toISOString(),
      message: { content: [{ type: "text", text: "API Error: reasoning_extraction" }] },
    }) + "\n");
    const receipt = await core.sendAgentMessage(sid, "echo CLAUDE_AFTER_ERROR");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
    assert.ok(fs.statSync(marker).mtimeMs > earlier.getTime(), "次のturnの印で完了を追跡する");
    const next = await core.sendAgentMessage(sid, "echo CLAUDE_AFTER_ERROR_STEER");
    assert.equal(next.schema, "aiterm.agent-steer.v1", "前のAPIエラーで新しいturnの印を消さない");
  } finally {
    core.closeSession(sid);
  }
});

test("sendAgentMessage: Claudeが実行中の表示でもturnの印が無ければ新しいturnとして送る", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    // Stop hookの実行中はturnの印が消えた後も実行中の表示が残る。
    core.send(sid, agentFixturePrint("Claude Code\n* Running stop hooks… (esc to interrupt)\n"), {
      force: true,
      raw: true,
      preserveAgentOperation: true,
    });
    await core.readOutput(sid, { wait: true, until: "esc to interrupt", timeout: 5, raw: true });
    fs.appendFileSync(readAgentMeta(sid).event_file, JSON.stringify({ type: "agent_done", vendor: "claude", done_status: "turn_done" }) + "\n");
    const receipt = await core.sendAgentMessage(sid, "echo CLAUDE_NEXT_TURN_BODY");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
    const meta = readAgentMeta(sid);
    const marker = path.join(path.dirname(meta.event_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    assert.ok(fs.existsSync(marker), "新しいturnの印を付け、Stopで完了を追える");
  } finally {
    core.closeSession(sid);
  }
});

// 実行中の送信を待ち行列へ入れ、2回目のEnterで現在turnへ送る偽Grok。
function makeFakeGrokSteerTuiBin(queueDelayMs = 0, race = false) {
  const stem = `fake-grok-steer-${Date.now().toString(36)}`;
  const bin = path.join(process.env.TMPDIR, `${stem}.cjs`);
  const log = path.join(process.env.TMPDIR, `${stem}.log`);
  fs.writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
if (process.argv[2] === "models") { console.log("Available models:\\n  * grok-4.5 (default)"); process.exit(0); }
const race = ${JSON.stringify(race)};
let events, history;
if (race) {
 const session = process.argv[process.argv.indexOf("--session-id") + 1];
 const dir = path.join(process.env.GROK_HOME, "sessions", encodeURIComponent(process.cwd()), session);
 fs.mkdirSync(dir, { recursive: true }); events = path.join(dir, "events.jsonl"); history = path.join(dir, "chat_history.jsonl");
 fs.writeFileSync(events, JSON.stringify({type:"turn_started",turn_number:0}) + "\\n"); fs.writeFileSync(history, "");
}
const emit = row => fs.appendFileSync(events, JSON.stringify(row) + "\\n");
const out = (s) => process.stdout.write(s + "\\n");
let line = ""; let queued = null;
process.stdin.setRawMode(true); process.stdin.resume();
out("Grok Build"); out("    ◆ Run sleep 5 (1 of 9)"); out("    ⠋ Run sleep 5… 0.8s  18s ⇣27.3k [stop]");
process.stdin.on("data", (chunk) => {
  for (const ch of chunk.toString("utf8").replace(/\\x1b\\[20[01]~/g, "")) {
    if (ch !== "\\r") { if (ch >= " ") line += ch; continue; }
    if (race && line) {
      const body = line; line = ""; fs.appendFileSync(${JSON.stringify(log)}, "accepted:" + body + "\\n");
      emit({type:"turn_ended",outcome:"completed",ts:"old"});
      if (race !== "unknown") {
        fs.appendFileSync(history, JSON.stringify({type:"user",content:body,prompt_index:1}) + "\\n");
        emit({type:"turn_started",turn_number:1});
        setTimeout(() => emit({type:"turn_ended",outcome:"completed",ts:"new"}), 150);
      }
      process.stdout.write("\\x1b[2J\\x1b[H"); out("Grok Build"); out("Grok 4.6 (high)"); out("❯ "); continue;
    }
    if (line) { queued = line; line = ""; fs.appendFileSync(${JSON.stringify(log)}, "queued:" + queued + "\\n"); const shown = queued; setTimeout(() => { out("    #1 " + shown); out("   Queued · Enter to send now"); }, ${queueDelayMs}); continue; }
    if (queued) { fs.appendFileSync(${JSON.stringify(log)}, "send_now:" + queued + "\\n"); out("     ❯ " + queued); for (let i = 0; i < 12; i++) out("    ◆ Run sleep 5 (" + (i + 2) + " of 9)"); out("    ⠋ Thinking… 1.7s  4.0s ⇣28.4k [stop]"); queued = null; }
  }
});
`,
    { mode: 0o700 },
  );
  return { bin, log };
}

for (const race of ["accepted", "unknown", "delivery-failure"]) test(`Grok busy/end race: ${race}`, { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN, fake = makeFakeGrokSteerTuiBin(0, race);
  process.env.GROK_BIN = fake.bin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        await core.readOutput(sid, { wait: true, until: "[stop]", timeout: 5, raw: true });
        if (race === "accepted") {
          const registered = [];
          const receipt = await core.sendAgentMessage(sid, "GROK_RACE_BODY", { follow: true, before_send: async boundary => { registered.push(boundary); } });
          assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
          assert.equal(registered.length, 1);
          assert.equal(registered[0].event_cursor, receipt.event_cursor);
          const result = await core.observeAgentDone(sid, { timeout: 2, cursor: receipt.event_cursor,
            expected_launch_id: receipt.launch_id });
          assert.equal(result.turn_id, "new");
          await assert.rejects(core.observeAgentDone(sid, { timeout: 0, cursor: receipt.event_cursor,
            expected_launch_id: "f".repeat(32) }), /EXECUTION_STALE_GENERATION/);
          await assert.rejects(core.observeAgentDone(sid, { timeout: 0, cursor: 0, steer: "f".repeat(16),
            expected_launch_id: receipt.launch_id }), /STEER_NOT_FOUND/);
        } else if (race === "delivery-failure") {
          let failure;
          await assert.rejects(core.sendAgentMessage(sid, "GROK_RACE_BODY", { before_send: async () => { throw new Error("fixture delivery failure"); } }), error => {
            assert.match(error.message, /^STEER_NOT_QUEUED vendor=grok/);
            assert.equal(error.code, 2);
            assert.equal(error.cause.message, "fixture delivery failure");
            failure = error.sendFailure;
            return true;
          });
          const result = await core.observeAgentDone(sid, { timeout: 2, cursor: failure.event_cursor, steer: failure.steer_id, expected_launch_id: failure.launch_id });
          assert.equal(result.turn_id, "new");
        } else {
          const client = new Client({ name: "steer-race-regression", version: "1" });
          const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/index.js")], env: { ...process.env }, stderr: "pipe" });
          try {
            await client.connect(transport);
            const result = await client.callTool({ name: "pty_send", arguments: { session_id: sid, text: "GROK_RACE_BODY", require_agent: true },
              _meta: { "aiterm/caller": "BellTeam" } });
            assert.equal(result.isError, true);
            assert.match(result.content[0].text, /^aiterm: STEER_NOT_QUEUED vendor=grok/);
            assert.equal(result.structuredContent, undefined, "outside pty_send outputSchema (0.70.43)");
            assert.equal(result._meta["aiterm/error_code"].code, "STEER_NOT_QUEUED");
            const failure = result._meta["aiterm/send_error"];
            assert.equal(failure.code, "STEER_NOT_QUEUED");
            assert.equal(failure.effect, "possible");
            assert.equal(failure.outcome, "outcome_unknown");
            assert.equal(failure.launch_id, readAgentMeta(sid).launch_id);
            assert.equal(typeof failure.steer_id, "string");
            assert.ok(failure.wait_process.args.includes(failure.launch_id));
            const waited = spawnSync(failure.wait_process.executable, [...failure.wait_process.args, "--timeout", "0"], { env: process.env, encoding: "utf8" });
            assert.equal(waited.status, 5, waited.stderr);
            assert.equal(JSON.parse(waited.stdout).outcome, "running");
          } finally { await client.close(); }
        }
        assert.deepEqual(fs.readFileSync(fake.log, "utf8").trim().split("\n"), ["accepted:GROK_RACE_BODY"]);
      } finally { core.closeSession(sid); }
    });
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = saved;
    fs.rmSync(fake.bin, { force: true }); fs.rmSync(fake.log, { force: true });
  }
});

test("sendAgentMessage: 実行中のGrokへは待ち行列へ入れた後にsend nowで現在turnへ送る", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fake = makeFakeGrokSteerTuiBin();
  process.env.GROK_BIN = fake.bin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        await core.readOutput(sid, { wait: true, until: "[stop]", timeout: 5, raw: true });
        const receipt = await core.sendAgentMessage(sid, "GROK_STEER_BODY");
        assert.equal(receipt.schema, "aiterm.agent-steer.v1");
        assert.deepEqual(fs.readFileSync(fake.log, "utf8").trim().split("\n"), ["queued:GROK_STEER_BODY", "send_now:GROK_STEER_BODY"]);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fake.bin, { force: true });
    fs.rmSync(fake.log, { force: true });
  }
});

// fox 2026-10-03: Cursorの待ち行列の表示が送ってから8〜9秒後に出て、5秒の待ちで3回とも失敗した。
test("sendAgentMessage: 待ち行列の表示が5秒より遅くても、子のturnが続いている間は待って現在turnへ送る", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fake = makeFakeGrokSteerTuiBin(7000);
  process.env.GROK_BIN = fake.bin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        await core.readOutput(sid, { wait: true, until: "[stop]", timeout: 5, raw: true });
        const started = Date.now();
        const receipt = await core.sendAgentMessage(sid, "GROK_SLOW_QUEUE_BODY");
        assert.equal(receipt.schema, "aiterm.agent-steer.v1");
        assert.ok(Date.now() - started >= 6500, "表示が出るまで待っている");
        assert.deepEqual(fs.readFileSync(fake.log, "utf8").trim().split("\n"), ["queued:GROK_SLOW_QUEUE_BODY", "send_now:GROK_SLOW_QUEUE_BODY"]);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fake.bin, { force: true });
    fs.rmSync(fake.log, { force: true });
  }
});

test("sendAgentMessage: idle中は新しいターンとしてdispatchする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.sendAgentMessage(sid, "echo IDLE_DISPATCH_BODY");
      assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
      assert.equal(typeof receipt.event_cursor, "number");
      const out = await core.readOutput(sid, { wait: true, until: "IDLE_DISPATCH_BODY", timeout: 5, raw: true });
      assert.match(out, /IDLE_DISPATCH_BODY/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: Grokは現在のidle composerが見えればtranscript初期化eventを要求しない", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fakeBin = makeFakeGrokTuiBin();
  process.env.GROK_BIN = fakeBin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        await core.readOutput(sid, { wait: true, until: "ready", timeout: 5, raw: true });
        const receipt = await core.dispatchAgentTurn(sid, "SEND_WITH_VISIBLE_IDLE_COMPOSER", { ready_timeout: 1000 });
        assert.equal(typeof receipt.event_cursor, "number");
        const out = await core.readOutput(sid, { wait: true, until: "SEND_WITH_VISIBLE_IDLE_COMPOSER", timeout: 5, raw: true });
        assert.match(out, /SEND_WITH_VISIBLE_IDLE_COMPOSER/);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});
