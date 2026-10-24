// core-agentの試験のうち、起動時prompt・portable fork・動いている席への差し込み。準備は core-agent-support.mjs。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

test("openAgentWithInitialPrompt: TUI ready 失敗は明示エラーにし prompt を送らず session を残す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    let sid = null;
    try {
      await assert.rejects(
        core.openAgentWithInitialPrompt("codex", {
          prompt: "Reply READY.",
          agent_done: true,
          ready_timeout: 0,
        }),
        (e) => {
          assert.equal(e.initial_prompt.status, "not_sent");
          assert.equal(e.initial_prompt.turn_started, false);
          assert.equal(typeof e.session_id, "string");
          assert.match(e.message, /initial_prompt=not_sent/, `ready failure error: ${e.message}`);
          assert.match(e.message, /session は調査\/復旧用に残しています/, `session保全の明示: ${e.message}`);
          sid = e.message.match(/session_id: (\S+)/)?.[1] ?? null;
          return true;
        },
      );
      assert.ok(sid, "エラーメッセージに session_id を含める");
      assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "session は調査用に残す");
      const meta = readAgentMeta(sid);
      assert.equal(meta.initial_prompt, "not_sent");
    } finally {
      if (sid) core.closeSession(sid);
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
      "while IFS= read -r line; do printf 'PROMPT:%s\\n' \"$line\"; done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

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
        assert.equal(error.initial_prompt.reason, "vendor_onboarding_required");
        assert.match(error.message, /初回案内/);
        return true;
      },
    );
    assert.ok(performance.now() - started < 15_000, "ready timeoutまで待たない");
    const screen = await core.readOutput(sid, { screen: true, raw: true });
    assert.doesNotMatch(screen, new RegExp(marker), "ログイン方法の選択へpromptを送らない");
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
        assert.equal(error.initial_prompt.status, "not_sent");
        assert.equal(error.initial_prompt.reason, "harness_exited");
        return true;
      });
      const output = await core.readOutput(sid, { screen: true, raw: true });
      assert.ok(!output.includes("SHOULD_NOT_REACH_SHELL"));
    });
  } finally {
    core.closeSession(sid);
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

test("sendInitialAgentPrompt: 初回 prompt の内容を評価せず専用 boundary で送信する", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const out = await core.sendInitialAgentPrompt(sid, "explain what rm -rf / does");
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
      core.send(sid, "printf 'OpenAI Codex\\n• Working (1s • esc to interrupt)\\n'", {
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
      core.send(sid, "printf 'OpenAI Codex\\n• Working (1s • esc to interrupt)\\n'", {
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
    core.send(sid, "printf 'Claude Code\\n* Herding… (3s · esc to interrupt)\\n'", {
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
    core.send(sid, "printf 'Claude Code\\n❯\\n'", {
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
    core.send(sid, "printf 'Claude Code\\n* Running stop hooks… (esc to interrupt)\\n'", {
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
function makeFakeGrokSteerTuiBin(queueDelayMs = 0) {
  const stem = `fake-grok-steer-${Date.now().toString(36)}`;
  const bin = path.join(process.env.TMPDIR, `${stem}.cjs`);
  const log = path.join(process.env.TMPDIR, `${stem}.log`);
  fs.writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "models") { console.log("Available models:\\n  * grok-4.5 (default)"); process.exit(0); }
const out = (s) => process.stdout.write(s + "\\n");
let line = ""; let queued = null;
process.stdin.setRawMode(true); process.stdin.resume();
out("Grok Build"); out("    ◆ Run sleep 5 (1 of 9)"); out("    ⠋ Run sleep 5… 0.8s  18s ⇣27.3k [stop]");
process.stdin.on("data", (chunk) => {
  for (const ch of chunk.toString("utf8").replace(/\\x1b\\[20[01]~/g, "")) {
    if (ch !== "\\r") { if (ch >= " ") line += ch; continue; }
    if (line) { queued = line; line = ""; fs.appendFileSync(${JSON.stringify(log)}, "queued:" + queued + "\\n"); const shown = queued; setTimeout(() => { out("    #1 " + shown); out("   Queued · Enter to send now"); }, ${queueDelayMs}); continue; }
    if (queued) { fs.appendFileSync(${JSON.stringify(log)}, "send_now:" + queued + "\\n"); out("     ❯ " + queued); for (let i = 0; i < 12; i++) out("    ◆ Run sleep 5 (" + (i + 2) + " of 9)"); out("    ⠋ Thinking… 1.7s  4.0s ⇣28.4k [stop]"); queued = null; }
  }
});
`,
    { mode: 0o700 },
  );
  return { bin, log };
}

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
