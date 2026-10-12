// openAgent の前提検証と残骸ゼロ保証の characterization。
// - model/effort 検証は bin 解決より先＝CLI 不在の端末でも同じ結果（環境非依存）。
// - CODEX_BIN 環境変数で bin を無害コマンドに偽装し、CLI 未導入環境でも cwd 検証・残骸テストを回す。
// - tmux 実機を使うケースは core-tmux.test.mjs と同じ隔離ソケット方式（TMPDIR 退避・skip 制御）。
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

test("GrokはMCP初期化表示中でも現在のidle composerが安定していればready", () => {
  const screen = [
    "≡ main / MCP (6/11) │ 3.8K / 500K",
    "╭────────────────────────╮",
    "│ >                      │",
    "╰──────── Grok 4.6 (medium) · always-approve ─╯",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("grok", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("grok", screen), true);
});

test("Grokの応答中表示はcomposerが残っていてもidle readyにしない", () => {
  const screen = [
    "Waiting for response… 12s [stop]",
    "│ >                      │",
    "╰──────── Grok 4.6 (medium) · always-approve ─╯",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("grok", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("grok", screen), false);
});

test("target contract: Grokは対話TUIへreasoning_effortを渡す", { skip: skipGrokFakeBin }, async () => {
  for (const kind of ["grok"]) {
    const [sid] = core.openAgent(kind, { reasoning_effort: "high" });
    try {
      const out = await core.readOutput(sid, {
        wait: true,
        timeout: 5,
        until: '<arg>high</arg>',
        raw: true,
      });
      assert.match(out, /<arg>--reasoning-effort<\/arg>/, `${kind} effort flag: ${out}`);
      assert.match(out, /<arg>high<\/arg>/, `${kind} effort value: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  }
});

test("target contract: catalogにないGrok modelはsession作成前に拒否する", { skip: skipGrokFakeBin }, () => {
  for (const kind of ["grok"]) {
    const sessionName = `missing_${kind}_model`;
    assert.throws(
      () => core.openAgent(kind, { session_name: sessionName, model: "not-in-live-catalog" }),
      (error) => error.code === 2 && /model catalog/.test(error.message) && /not-in-live-catalog/.test(error.message) && !/cursor-cli/.test(error.message),
    );
    assert.doesNotMatch(core.listSessions(), new RegExp(`(^|\\n)${sessionName}\\t`));
  }
});

test(
  "target contract: Grok catalogにComposer modelを指定するとCursorを案内してsession作成前に拒否する",
  { skip: process.platform === "win32" ? "POSIX shell fixture" : undefined },
  () => {
    const savedBin = process.env.GROK_BIN;
    const catalogBin = makeGrokCatalogBin(["grok-4.6", "grok-4.5"]);
    process.env.GROK_BIN = catalogBin;
    try {
      const sessionName = "missing_composer_model";
      assert.throws(
        () => core.openAgent("grok", { session_name: sessionName, model: "grok-composer-2.5-fast" }),
        (error) => error.code === 2 && /grok-composer-2\.5-fast/.test(error.message) && /model catalog/.test(error.message) && /harness=cursor-cli, model=composer-2\.5-fast/.test(error.message),
      );
      assert.doesNotMatch(core.listSessions(), new RegExp(`(^|\\n)${sessionName}\\t`));
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(catalogBin, { force: true });
    }
  },
);

test(
  "target contract: Grok model catalog取得失敗はexit付きでsession作成前に拒否する",
  { skip: process.platform === "win32" ? "POSIX shell fixture" : undefined },
  () => {
    const savedBin = process.env.GROK_BIN;
    const failingBin = makeFailingGrokCatalogBin();
    process.env.GROK_BIN = failingBin;
    try {
      assert.throws(
        () => core.openAgent("grok", { session_name: "catalog_failure", model: "grok-4.6" }),
        (error) => error.code === 2 && /catalog を取得できません/.test(error.message) && /exit=17/.test(error.message),
      );
      assert.doesNotMatch(core.listSessions(), /(^|\n)catalog_failure\t/);
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(failingBin, { force: true });
    }
  },
);

test("openAgent: codex の effort は縛らない（CLI 版差があるため送信まで到達する）", { skip }, () => {
  // 偽 bin(/bin/echo) なので実起動はしない。effort が事前拒否されないことだけ確認。
  const [sid] = core.openAgent("codex", { reasoning_effort: "minimal" });
  core.closeSession(sid);
});

test("agent_configure: Codexのmodel／effort選択肢を現在の/model画面から解決する", () => {
  const screen = [
    "  Select Model and Effort",
    "  1. gpt-5.6-sol (default)     Latest frontier agentic coding model.",
    "› 2. gpt-5.6-terra (current)  Balanced agentic coding model.",
    "  3. gpt-5.6-luna             Fast agentic coding model.",
    "",
    "  Select Reasoning Level for gpt-5.6-terra",
    "  1. Low               Fast responses",
    "› 2. Medium (default)  Balanced reasoning",
    "  3. High              Greater reasoning depth",
    "  4. Extra high        Extra reasoning depth",
    "  5. More reasoning…   Max and Ultra",
  ].join("\n");
  assert.deepEqual(core.__testCodexConfigureChoices(screen, "gpt-5.6-luna", "xhigh"), {
    model: "3",
    effort: "4",
    more: "5",
  });
  const advanced = "  Advanced Reasoning\n› 1. Max  For difficult problems when quality matters more than speed";
  assert.equal(core.__testCodexConfigureChoices(advanced, "missing", "max").effort, "1");
});


function readFakeTuiInput(input) {
  const content = fs.readFileSync(input, "utf8").trim();
  return content ? content.split("\n").map((line) => JSON.parse(line)) : [];
}

test("Codex上限接近modal: 版とcursor位置を問わず一時keepだけで同じsessionへ本文を一度送る", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  try {
    for (const [version, cursor] of [["0.155.1", 1], ["0.155.1", 2], ["0.155.1", 3], ["0.157.0", 1]]) {
      const fake = makeFakeCodexRateLimitTuiBin(cursor, "recover", version);
      const sid = `codex_rate_limit_${cursor}_${Date.now().toString(36)}`;
      process.env.CODEX_BIN = fake.bin;
      try {
        await withFakeCodexHome(async () => {
          const [actualSid] = core.openAgent("codex", { session_name: sid, agent_done: true });
          // 待ちは上限で、入力待ちへ戻ればすぐ進む。2秒では、混んだWindowsの端末で模擬のTUIの描き直しが間に合わず、
          // 「入力受付状態になりません」「RECOVERY_FAILED」で落ちた（2026-10-12、CPU 68%・node 233個のfoxで2回続けて）。
          const receipt = await core.dispatchAgentTurn(actualSid, "RATE_LIMIT_BODY", { ready_timeout: 10_000 });
          assert.equal(receipt.session_id, actualSid);
          assert.ok(receipt.pane_input_recovery.includes("codex_rate_limit_model_switch_kept_current"));
          assert.match(core.listSessions(), new RegExp(`(^|\\n)${actualSid}\\t`), "同じsessionを保つ");
          const input = readFakeTuiInput(fake.input);
          assert.deepEqual(input.filter((entry) => entry.phase === "modal").map((entry) => entry.text), ["2"]);
          assert.equal(input.filter((entry) => entry.text.includes("RATE_LIMIT_BODY")).length, 1, "本文は一度だけ送る");
        });
      } finally {
        try { core.closeSession(sid); } catch {}
        fs.rmSync(fake.bin, { force: true });
        fs.rmSync(fake.driverDir, { recursive: true, force: true });
        fs.rmSync(fake.input, { force: true });
      }
    }
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
  }
});

test("Codex上限接近modal: agent_approvalはreasonだけを返し選択肢を公開しない", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fake = makeFakeCodexRateLimitTuiBin(2, "recover");
  const sid = `codex_rate_limit_inspect_${Date.now().toString(36)}`;
  process.env.CODEX_BIN = fake.bin;
  try {
    await withFakeCodexHome(async () => {
      const [actualSid] = core.openAgent("codex", { session_name: sid, agent_done: true });
      await core.readOutput(actualSid, { wait: true, until: "Approaching rate limits", timeout: 5, raw: true });
      const inspected = core.runAgentApproval({ action: "inspect", session_id: actualSid });
      assert.deepEqual(inspected, {
        schema: "aiterm.agent-approval-result.v1",
        action: "inspect",
        status: "blocked",
        session_id: actualSid,
        harness: "codex-cli",
        launch_id: readAgentMeta(actualSid).launch_id,
        reason: "rate_limit_model_switch",
        kind: null,
        prompt: null,
        prompt_digest: null,
        choices: [],
        selected_choice: null,
        at: inspected.at,
      });
      assert.match(inspected.at, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(readFakeTuiInput(fake.input), []);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fake.bin, { force: true });
    fs.rmSync(fake.driverDir, { recursive: true, force: true });
    fs.rmSync(fake.input, { force: true });
  }
});

test("Codex上限接近modal: readyへ戻らなければ本文を送らずtyped errorにする", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fake = makeFakeCodexRateLimitTuiBin(1, "stuck");
  const sid = `codex_rate_limit_stuck_${Date.now().toString(36)}`;
  process.env.CODEX_BIN = fake.bin;
  try {
    await withFakeCodexHome(async () => {
      const [actualSid] = core.openAgent("codex", { session_name: sid, agent_done: true });
      // 復帰失敗の150msには偽TUIの起動時間を含めない。modalの表示を先に確かめる。
      const initial = await core.readOutput(actualSid, { wait: true, until: "Approaching rate limits", timeout: 5, raw: true });
      assert.match(initial, /Approaching rate limits/);
      await assert.rejects(
        () => core.dispatchAgentTurn(actualSid, "RATE_LIMIT_BODY_MUST_NOT_SEND", { ready_timeout: 150 }),
        (error) => error.code === 2
          && /CODEX_RATE_LIMIT_MODEL_SWITCH_RECOVERY_FAILED/.test(error.message)
          && /文字列は送信していません/.test(error.message),
      );
      const input = readFakeTuiInput(fake.input);
      assert.deepEqual(input.filter((entry) => entry.phase === "modal").map((entry) => entry.text), ["2"]);
      assert.equal(input.some((entry) => entry.text.includes("RATE_LIMIT_BODY_MUST_NOT_SEND")), false);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fake.bin, { force: true });
    fs.rmSync(fake.driverDir, { recursive: true, force: true });
    fs.rmSync(fake.input, { force: true });
  }
});

test("agent_configure: Codex上限接近modalを一時keep後に同じsessionで設定する", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fake = makeFakeCodexRateLimitTuiBin(3, "recover");
  const sid = `codex_rate_limit_configure_${Date.now().toString(36)}`;
  process.env.CODEX_BIN = fake.bin;
  try {
    await withFakeCodexHome(async () => {
      const [actualSid] = core.openAgent("codex", { session_name: sid, agent_done: true });
      const result = await core.configureAgent(actualSid, { model: "gpt-5.6-sol", reasoning_effort: "low" });
      assert.deepEqual(result, {
        schema: "aiterm.agent-configure-result.v1",
        session_id: actualSid,
        provider: "codex",
        harness: "codex-cli",
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        fast: false,
      });
      assert.match(core.listSessions(), new RegExp(`(^|\\n)${actualSid}\\t`), "同じsessionを保つ");
      const input = readFakeTuiInput(fake.input);
      assert.deepEqual(input.filter((entry) => entry.phase === "modal").map((entry) => entry.text), ["2"]);
      assert.ok(input.some((entry) => entry.phase === "ready" && entry.text.includes("/model")));
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fake.bin, { force: true });
    fs.rmSync(fake.driverDir, { recursive: true, force: true });
    fs.rmSync(fake.input, { force: true });
  }
});

// Claude Codeの席のagent_configureは test/claude-configure-session-only.test.mjs（選ぶ画面の「この会話だけ」で替える。ADR 0111）。

test("target contract: Grokへ/modelと/effortを同じsessionのまま送る", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    const savedBin = process.env.GROK_BIN;
    const fakeBin = makeFakeGrokTuiBin();
    process.env.GROK_BIN = fakeBin;
    try {
      for (const kind of ["grok"]) {
        const [sid] = core.openAgent(kind, { agent_done: true });
        try {
          await markFakeAgentReady(sid, kind);
          const model = "grok-4.6";
          const result = await core.configureAgent(sid, { model, reasoning_effort: "high" });
          assert.deepEqual(result, {
            schema: "aiterm.agent-configure-result.v1",
            session_id: sid,
            provider: kind,
            harness: "grok-cli",
            model,
            reasoning_effort: "high",
            fast: false,
          });
          const effortResult = await core.configureAgent(sid, { reasoning_effort: "medium" });
          assert.deepEqual(effortResult, {
            schema: "aiterm.agent-configure-result.v1",
            session_id: sid,
            provider: kind,
            harness: "grok-cli",
            model: null,
            reasoning_effort: "medium",
            fast: false,
          });
          await assert.rejects(
            core.configureAgent(sid, { reasoning_effort: "impossible" }),
            (error) => error.code === 2 && /unknown effort level 'impossible'/.test(error.message),
          );
          const out = await core.readOutput(sid, { full: true, raw: true });
          assert.match(out, new RegExp(`/model ${model.replaceAll(".", "\\.")} high`));
          assert.match(out, /\/effort medium/);
          assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`));
        } finally {
          core.closeSession(sid);
        }
      }
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(fakeBin, { force: true });
    }
  });
});

test("target contract: Grokの成功通知が消えても変更後footerで設定完了を確認する", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    const savedBin = process.env.GROK_BIN;
    const fakeBin = makeFakeGrokFooterOnlyTuiBin();
    process.env.GROK_BIN = fakeBin;
    const [sid] = core.openAgent("grok", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "grok");
      const result = await core.configureAgent(sid, { model: "grok-4.6", reasoning_effort: "high" });
      assert.equal(result.model, "grok-4.6");
      assert.equal(result.reasoning_effort, "high");
    } finally {
      core.closeSession(sid);
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(fakeBin, { force: true });
    }
  });
});

test("openAgent: 実在しない cwd は session を作る前に拒否", () => {
  assert.throws(
    () => core.openAgent("codex", { cwd: "/no/such/dir-aiterm-agent-test" }),
    (e) => e.code === 2 && /cwd/.test(e.message),
  );
});

test("openAgent: 破壊語を含む prompt は誤検知で拒否しない（引用符付き引数ゆえ安全・A4）", { skip }, () => {
  const before = core.listSessions();
  // prompt の破壊語は CLI に渡る shq クオート済み引数でありシェルは実行しない。起動できること。
  // （修正前は send(force:false) が code 3 で誤爆し、正当な起動を塞いでいた。）
  const [sid] = core.openAgent("codex", { prompt: "explain what rm -rf / does" });
  try {
    assert.notEqual(core.listSessions(), before, "破壊語 prompt で起動できず session が作られない");
  } finally {
    core.closeSession(sid);
  }
  assert.equal(core.listSessions(), before, "close 後は元の一覧へ戻る");
});

test("openAgent: 前段検証で落ちたら session を残さない（残骸ゼロ）", { skip }, () => {
  const before = core.listSessions();
  // cwd 不在は session 作成前に code 2 で throw する。残骸を残さないこと。
  assert.throws(
    () => core.openAgent("codex", { cwd: "/no/such/dir-aiterm-agent-test-2" }),
    (e) => e.code === 2,
  );
  assert.equal(core.listSessions(), before, "失敗した openAgent が session を残した");
});

test("listSessions: agent 行だけに agent 情報を追加し、通常 session 行は不変", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const plain = "list_plain";
    const agent = "list_agent";
    core.openSession(plain);
    // Windows(psmux) は pane_current_command が起動直後 git→bash と遷移する。行が
    // 2回連続で同じになるまで待ってから基準を取る（遷移中を「不変の基準」にしない）。
    const plainRow = () => core.listSessions().split("\n").find((line) => line.startsWith(`${plain}\t`));
    let plainBefore = plainRow();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const next = plainRow();
      if (next === plainBefore) break;
      plainBefore = next;
    }
    const [sid] = core.openAgent("codex", { session_name: agent, agent_done: true });
    try {
      const rows = core.listSessions().split("\n");
      assert.equal(rows.find((line) => line.startsWith(`${plain}\t`)), plainBefore, "通常 session 行は変更しない");
      assert.match(rows.find((line) => line.startsWith(`${sid}\t`)) ?? "", /\tagent=codex harness=codex-cli agent_done=true$/);
    } finally {
      core.closeSession(sid);
      core.closeSession(plain);
    }
  });
});

test("openAgent: write_scope をmetadataとpty_listへ記録し、Codex read-onlyにはsandboxを付与する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true, write_scope: "read-only" });
    try {
      assert.equal(readAgentMeta(sid).write_scope, "read-only");
      assert.match(core.listSessions(), new RegExp(`${sid}\\t.*write_scope=\\\"read-only\\\"`));
      assert.match(hint, /--sandbox read-only を付与し、書込みを実効禁止/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /--sandbox read-only/, `codex read-only sandbox: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: write_scope省略時はCodex起動argvとpty_list表記を変えない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true });
    try {
      assert.equal(readAgentMeta(sid).write_scope, undefined);
      assert.doesNotMatch(core.listSessions(), new RegExp(`${sid}\\t.*write_scope=`));
      assert.doesNotMatch(hint, /能力宣言/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--sandbox read-only/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: Codexのパス説明write_scopeはunsupportedを明示してsandboxへ偽変換しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true, write_scope: "/repo/src と /repo/test のみ書込み可" });
    try {
      assert.equal(readAgentMeta(sid).write_scope, "/repo/src と /repo/test のみ書込み可");
      assert.match(hint, /パス単位のsandbox allowlistに対応するCLI引数がないため宣言の記録のみ（構造的unsupported）/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--sandbox read-only/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("target contract: Grok read-onlyはsandboxで実効化し、パス説明は宣言に保つ", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    for (const kind of ["grok"]) {
      const [sid, hint] = core.openAgent(kind, { agent_done: true, write_scope: "read-only" });
      try {
        assert.equal(readAgentMeta(sid).write_scope, "read-only");
        assert.match(hint, /--sandbox read-only を付与し、書込みを実効禁止/);
        assert.match(hint, /--always-approve で自動承認/);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /<arg>--sandbox<\/arg>\s*<arg>read-only<\/arg>\s*<arg>--always-approve<\/arg>/, `${kind} read-only sandbox: ${out}`);
      } finally {
        core.closeSession(sid);
      }

      const [pathSid, pathHint] = core.openAgent(kind, { agent_done: true, write_scope: "/repo/docs のみ書込み可" });
      try {
        assert.equal(readAgentMeta(pathSid).write_scope, "/repo/docs のみ書込み可");
        assert.match(pathHint, /パス単位のsandbox allowlistに対応するCLI引数がないため宣言の記録のみ（構造的unsupported）/);
        const pathOut = await core.readOutput(pathSid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(pathOut, /--always-approve/, `${kind} 非read-onlyへの自動承認混入: ${pathOut}`);
      } finally {
        core.closeSession(pathSid);
      }

      const [plainSid] = core.openAgent(kind, { agent_done: true });
      try {
        const plainOut = await core.readOutput(plainSid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(plainOut, /--always-approve/, `${kind} write_scope省略への自動承認混入: ${plainOut}`);
      } finally {
        core.closeSession(plainSid);
      }
    }
  });
});

// A-test: grok/composer 経路の組立コマンドを実検証（従来は codex 経路のみで未カバー）。
// 偽 bin は受け取ったargvをタグ付きで出力し、shell表示に依存せず組立内容を観測できる。
test("openAgent codex: -c model_reasoning_effort=<effort> を組み立てる", { skip }, async () => {
  const [sid] = core.openAgent("codex", { reasoning_effort: "high" });
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/, `codex 組立: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent codex: model 引数を -m で組み立てる", { skip }, async () => {
  const [sid] = core.openAgent("codex", { model: "gpt-5.6-terra" });
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/, `codex model: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent codex: 指定した現在値だけを既存tmux server越しにagentへ渡す", { skip }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const savedValue = process.env.AITERM_FORWARD_FIXTURE;
  // env をそのまま表示する実在 bin。Windows native は Git for Windows 同梱の env.exe を使う
  // （pane shell の Git Bash から実行される）。
  const envBin =
    process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "env.exe")
      : "/usr/bin/env";
  process.env.CODEX_BIN = envBin;
  process.env.AITERM_FORWARD_FIXTURE = "seat-value";
  try {
    const [sid] = core.openAgent("codex", { env_vars: ["AITERM_FORWARD_FIXTURE"] });
    try {
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /^AITERM_FORWARD_FIXTURE=seat-value$/mu);
    } finally {
      core.closeSession(sid);
    }
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    if (savedValue === undefined) delete process.env.AITERM_FORWARD_FIXTURE;
    else process.env.AITERM_FORWARD_FIXTURE = savedValue;
  }
});

test("openAgent: env_varsの無効名はsession作成前に拒否する", () => {
  assert.throws(
    () => core.openAgent("codex", { session_name: "invalid_env_name", env_vars: ["BAD-NAME"] }),
    (error) => error.code === 2 && /env_vars に無効/.test(error.message),
  );
  assert.doesNotMatch(core.listSessions(), /(^|\n)invalid_env_name\t/);
});

test("openAgent codex: 複数行日本語 prompt は argv に残るが shell continuation 表示を出す", { skip }, async () => {
  const prompt = [
    "NoveLore リポジトリで、docs/23_graph_upsert_tool_contract_plan.md を敵対的にレビューしてください。",
    "重点:",
    "- 現行 graph_upsert inputSchema と必須/任意の差分",
    "- docs/07_mcp_interface.md と server.ts / handlers.ts / validate.ts のズレ",
  ].join("\n");
  const [sid] = core.openAgent("codex", { prompt }); // CODEX_BIN=/bin/echo
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    // psmuxは複数行入力中のshell bracketed-paste mode切替をCSIとして描画へ挟む。
    // argv本文ではない表示制御だけを除いて、実引数とcontinuationを照合する。
    const visible = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    assert.match(visible, /> 重点:/, `shell continuation 表示が出ることを固定する: ${out}`);
    assert.match(visible, /NoveLore リポジトリで、docs\/23_graph_upsert_tool_contract_plan\.md/, `prompt 先頭: ${out}`);
    assert.match(visible, /重点:\r?\n- 現行 graph_upsert inputSchema と必須\/任意の差分/, `prompt 本文: ${out}`);
    assert.match(visible, /docs\/07_mcp_interface\.md と server\.ts \/ handlers\.ts \/ validate\.ts のズレ/, `prompt 末尾: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("target contract: Codexは通常CODEX_HOMEを共有しsub-agent lineageだけを加算する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (normalHome) => {
    const configPath = path.join(normalHome, "config.toml");
    const configBefore = fs.readFileSync(configPath, "utf8");
    const [sid] = core.openAgent("codex", { reasoning_effort: "high", agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.codex_home, normalHome);
      assert.equal(meta.hook_route, "shared_codex_home");
      assert.equal(meta.agent_role, "subagent");
      assert.equal(meta.parent_session_id, "host-root");
      assert.equal(meta.delegation_depth, 1);
      assert.equal(meta.delegation_allowed, true);
      assert.match(meta.lineage, new RegExp(`^host-root>codex:${sid}$`));
      assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "通常configを書き換えない");
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /CODEX_HOME=/, "通常CODEX_HOMEを置換しない");
      assert.match(out, /<arg>-c<\/arg>\s+<arg>check_for_update_on_startup=false<\/arg>/);
      assert.match(out, /developer_instructions=/);
      assert.match(out, /agent_role=subagent\r?\n/);
      assert.match(out, /agent_depth=1\r?\n/);
      assert.match(out, /delegation_allowed=true/);
    } finally {
      core.closeSession(sid);
    }
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "close後も通常configを維持する");
  });
});

test("Claudeはリンク経由のcwdを起動時に実体へ固定して会話記録を探す", async () => {
  const claudeHarness = await import("../dist/harnesses/claude.js");
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR, "claude-cwd-"));
  const actual = path.join(root, "actual");
  const linked = path.join(root, "linked");
  fs.mkdirSync(actual);
  fs.symlinkSync(actual, linked, process.platform === "win32" ? "junction" : "dir");
  try {
    const meta = claudeHarness.createClaudeAgentMetadata("claude_cwd", linked, "none", null, null,
      { agentRole: "subagent", parentSessionId: "test", delegationDepth: 1, lineage: "test", delegationAllowed: true }, null, null);
    assert.equal(meta.cwd, fs.realpathSync(actual));
    assert.equal(claudeHarness.claudeSessionTranscriptPath(meta), path.join(claudeHarness.claudeConfigDir(),
      "projects", claudeHarness.claudeProjectSlug(fs.realpathSync(actual)), `${meta.vendor_session_id}.jsonl`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("target contract: Claudeは通常3 scopeを共有してlaunch固有hookとlineageだけを加算する", { skip: skipAgentDone }, async () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  const configBody = JSON.stringify({ theme: "dark", mcpServers: { fixture: { command: "fixture-mcp" } } }) + "\n";
  fs.writeFileSync(userConfig, configBody, { mode: 0o600 });
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    assert.equal(meta.hook_route, "shared_claude_settings");
    assert.equal(meta.claude_mcp_config, undefined);
    assert.equal(meta.agent_role, "subagent");
    assert.equal(meta.delegation_depth, 1);
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--setting-sources\s+user,project,local/);
    assert.match(out, /--settings/);
    assert.match(out, /--append-system-prompt/);
    assert.doesNotMatch(out, /--mcp-config/);
    assert.equal(fs.readFileSync(userConfig, "utf8"), configBody, "通常user設定を書き換えない");
  } finally {
    core.closeSession(sid);
    fs.rmSync(userConfig, { force: true });
  }
});

test("target contract: Grokは通常HOMEとGROK_HOMEを共有し既知session transcriptへ束縛する", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async (normalHome) => {
    const configPath = path.join(normalHome, "config.toml");
    const configBefore = fs.readFileSync(configPath, "utf8");
    for (const kind of ["grok"]) {
      const [sid] = core.openAgent(kind, { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.grok_home, normalHome);
        assert.equal(meta.hook_route, "shared_grok_home");
        assert.match(meta.vendor_session_id, /^[0-9a-f-]{36}$/);
        assert.equal(meta.agent_role, "subagent");
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(out, /(?:^|\s)HOME=/, "通常HOMEを置換しない");
        assert.doesNotMatch(out, /(?:^|\s)GROK_HOME=/, "通常GROK_HOMEを置換しない");
        assert.match(out, /--session-id/);
        assert.match(out, /--rules/);
      } finally {
        core.closeSession(sid);
      }
    }
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "通常Grok configを書き換えない");
  });
});

test("target contract: nested launcherはdepthとlineageを1段だけ進め、再委譲を許可する", { skip: skipAgentDone }, async () => {
  const saved = {
    role: process.env.AITERM_AGENT_ROLE,
    session: process.env.AITERM_AGENT_SESSION_ID,
    depth: process.env.AITERM_AGENT_DEPTH,
    lineage: process.env.AITERM_AGENT_LINEAGE,
    delegationAllowed: process.env.AITERM_AGENT_DELEGATION_ALLOWED,
  };
  process.env.AITERM_AGENT_ROLE = "subagent";
  process.env.AITERM_AGENT_SESSION_ID = "parent-session";
  process.env.AITERM_AGENT_DEPTH = "1";
  process.env.AITERM_AGENT_LINEAGE = "host-root>claude:parent-session";
  process.env.AITERM_AGENT_DELEGATION_ALLOWED = "true";
  try {
    await withFakeCodexHome(async () => {
      const [sid] = core.openAgent("codex", { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.parent_session_id, "parent-session");
        assert.equal(meta.delegation_depth, 2);
        assert.equal(meta.lineage, `host-root>claude:parent-session>codex:${sid}`);
        assert.equal(meta.delegation_allowed, true);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /AITERM_AGENT_DEPT\s*H='2'/);
        assert.match(out, /追加のsub-agentへ委譲してよい/);
        assert.doesNotMatch(out, /再委譲.*禁止/);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    for (const [key, value] of Object.entries({
      AITERM_AGENT_ROLE: saved.role,
      AITERM_AGENT_SESSION_ID: saved.session,
      AITERM_AGENT_DEPTH: saved.depth,
      AITERM_AGENT_LINEAGE: saved.lineage,
      AITERM_AGENT_DELEGATION_ALLOWED: saved.delegationAllowed,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("openAgent codex agent_done: 通常CODEX_HOMEのroot transcriptだけを完了正本にする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const configBefore = fs.readFileSync(path.join(fakeHome, "config.toml"), "utf8");
    const [sid, hint] = core.openAgent("codex", { reasoning_effort: "high", agent_done: true });
    try {
      assert.match(hint, /agent_done 待機が有効/);
      const dir = agentStateDir();
      const metas = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
      assert.equal(metas.length, 1);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, metas[0]), "utf8"));
      assert.equal(meta.kind, "codex");
      assert.equal(meta.aiterm_session, sid);
      assert.equal(meta.completion_route, "codex_transcript");
      assert.equal(meta.hook_route, "shared_codex_home");
      assert.equal(meta.codex_home, fakeHome);
      assert.ok(fs.existsSync(meta.event_file), "event file を作る");
      assert.equal(fs.existsSync(path.join(meta.codex_home, "hooks.json")), false, "Codex Stop hookを二重正本にしない");
      assert.equal(fs.readFileSync(path.join(meta.codex_home, "config.toml"), "utf8"), configBefore);
      assert.equal(fs.existsSync(path.join(meta.codex_home, "history.jsonl")), true);
      assert.equal(fs.existsSync(path.join(meta.codex_home, "sessions")), true);
      assert.match(hint, /起動設定: model=test-model（端末config継承） effort=high（引数）/);
      assert.match(hint, /共有 config: mcp_servers 1 個継承 \/ approval_policy=never \/ sandbox_mode=danger-full-access/);

      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--dangerously-bypass-hook-trust/, `不要なhook trust bypassを付けない: ${out}`);
      assert.match(out, /model_reasoning_effort=high/, `codex CLI effort: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: agents discoveryは通常CODEX_HOMEを直接共有する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const sourceAgents = path.join(fakeHome, "agents");
    fs.mkdirSync(sourceAgents, { mode: 0o700 });
    const implementer = 'name = "implementer"\ndescription = "Implement changes"\n';
    const refuter = 'name = "refuter"\ndescription = "Challenge changes"\n';
    fs.writeFileSync(path.join(sourceAgents, "implementer.toml"), implementer, { mode: 0o600 });
    fs.writeFileSync(path.join(fakeHome, "refuter-source.toml"), refuter, { mode: 0o600 });
    fs.symlinkSync(path.join(fakeHome, "refuter-source.toml"), path.join(sourceAgents, "refuter.toml"));
    fs.writeFileSync(path.join(sourceAgents, "ignored.json"), "{}\n", { mode: 0o600 });

    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.codex_home, fakeHome);
      assert.equal(path.join(meta.codex_home, "agents"), sourceAgents);
      assert.equal(fs.lstatSync(path.join(sourceAgents, "refuter.toml")).isSymbolicLink(), true, "vendor自身が通常定義を読む");
      assert.equal(fs.readFileSync(path.join(sourceAgents, "implementer.toml"), "utf8"), implementer);
      assert.equal(fs.readFileSync(path.join(sourceAgents, "refuter.toml"), "utf8"), refuter);
      fs.writeFileSync(path.join(fakeHome, "refuter-source.toml"), 'name = "changed"\n', { mode: 0o600 });
      assert.equal(fs.readFileSync(path.join(sourceAgents, "refuter.toml"), "utf8"), 'name = "changed"\n', "起動後も通常定義を共有する");
    } finally {
      core.closeSession(sid);
    }
  });
});
