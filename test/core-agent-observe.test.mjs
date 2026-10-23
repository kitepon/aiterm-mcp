// core-agentの試験のうち、完了の観測・回答の回収（transcript）と、残りの起動の前提検証。準備は core-agent-support.mjs。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ARGV_FIXTURE_DONE, hasTmux, savedHome, fakeHome, argvPrinterBin, fakeClaudeBin, fakeGrokBin, core, codexHarness, skip,
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

test("observeAgentDone: 送信前の古い task_complete を follow-up done と誤認しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true, prompt: "Reply READY." });
    try {
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, {
        vendor_session_id: "codex-session-initial",
        turn_id: "initial-turn",
      });
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo FOLLOWUP_BODY");
      assert.ok(
        receipt.submit_residue === null || typeof receipt.submit_residue === "boolean",
        `dispatch receipt に submit_residue 観測を含む: ${JSON.stringify(receipt)}`,
      );
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running", `古い event を拾っていない: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, null, `古い event を完了扱いしない: ${JSON.stringify(observation)}`);
      assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /FOLLOWUP_BODY/, "follow-up の出力は送信されている");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: Codexの利用上限はtask_completeの記録で見分け、画面の文字では判定しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      // 依頼文や道具の出力に上限の文字が出ても、turnが動いている間は上限にしない。
      const receipt = await core.dispatchAgentTurn(sid, "echo \"You've hit your usage limit\"");
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /You've hit your usage limit/);
      const running = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(running.outcome, "running", JSON.stringify(running));
      // macbookの実記録（2026-08-07）と同じ形。
      const message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 12:35 PM.";
      appendCodexTranscript(meta, "codex-session-limit", [
        { type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 100, resets_at: 4102444800 } } } },
        { type: "event_msg", timestamp: "2026-08-07T06:23:58.978Z", payload: { type: "task_complete", turn_id: "limit-turn",
          last_agent_message: null, error: { message, codex_error_info: "usage_limit_exceeded" } } },
      ]);
      const limited = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(limited.outcome, "rate_limited", JSON.stringify(limited));
      assert.equal(limited.rate_limit, message);
      assert.equal(limited.turn_id, "limit-turn");
      // 利用上限の返りは変えない（errorの欄は使わない）。
      assert.equal(limited.error, null);
      assert.equal(limited.error_kind, null);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: Codexのturnがサービスの誤りや通信の失敗で終わったら、完了ではなくerrorで返す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      // 実物（2026-10-07、codex 0.160.1）と同じ形。回答は無く、task_completeにerrorが付く。
      const cases = [
        [{ message: "We’re currently experiencing high demand, which may cause temporary errors.", codex_error_info: "internal_server_error" },
          "We’re currently experiencing high demand, which may cause temporary errors.", "internal_server_error"],
        [{ message: "unexpected status 401 Unauthorized: fixture: token expired, url: http://127.0.0.1:43221/v1/responses",
          codex_error_info: { http_connection_failed: { http_status_code: 401 } } },
          "unexpected status 401 Unauthorized", "http_connection_failed"],
        [{ message: "stream disconnected before completion: Transport error: network error: error decoding response body", codex_error_info: "other" },
          "stream disconnected before completion: Transport error: network error: error decoding response body", "other"],
      ];
      for (const [index, [error, text, kind]] of cases.entries()) {
        const receipt = await core.dispatchAgentTurn(sid, `echo FAILED_TURN_${index}`);
        appendCodexTranscript(meta, "codex-session-failed", [
          { type: "event_msg", timestamp: "2026-10-07T04:49:42.702Z", payload: { type: "task_complete", turn_id: `failed-turn-${index}`,
            last_agent_message: null, error } },
        ]);
        const failed = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
        assert.equal(failed.outcome, "error", JSON.stringify(failed));
        assert.equal(failed.error, text);
        assert.equal(failed.error_kind, kind);
        assert.equal(failed.rate_limit, null);
        assert.equal(failed.turn_id, `failed-turn-${index}`);
      }
      // 誤りで終わった後の席は、次の文を普通に受けて完了を返す。
      const next = await core.dispatchAgentTurn(sid, "echo AFTER_FAILED_TURN");
      appendCodexTranscript(meta, "codex-session-failed", [
        { type: "event_msg", timestamp: "2026-10-07T04:49:45.000Z", payload: { type: "task_complete", turn_id: "next-turn", last_agent_message: "ok" } },
      ]);
      const done = await core.observeAgentDone(sid, { cursor: next.event_cursor, timeout: 3 });
      assert.equal(done.outcome, "done", JSON.stringify(done));
      assert.equal(done.error, null);
      assert.equal(done.error_kind, null);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: Codexのused_percentが100%でも、上限の知らせが無いturnは完了にする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo FULL_BUT_WORKING");
      appendCodexTranscript(meta, "codex-session-full", [
        { type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 100, resets_at: 4102444800 } } } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: "full-turn", last_agent_message: "答え" } },
      ]);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done", JSON.stringify(observation));
      assert.equal(observation.rate_limit, null);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: 送信直後の task_complete を transcript cursor から回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo IMMEDIATE_DONE_BODY");
      scheduleCodexDone(meta, {
        vendor_session_id: "codex-session-race",
        turn_id: "race-turn",
      });
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done", `即時 event を拾う: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, "race-turn");
      // v0.16.0: observeAgentDone は純粋な event file リーダーであり、readOutput の増分offset
      // （.offsetファイル）には一切触れない。旧 sendAndWaitAgentDone は自身の戻り値としてPTY出力を
      // 読んでいたため副作用でoffsetを進め、直後の通常read重複が起きなかった。新契約では
      // dispatch/observe のどちらもreadOutputを呼ばないため、直後の通常readはこのターンの出力を
      // 含む（重複しない、という旧保証はもう成立しない）。この変更点は製品仕様として意図されたもの
      // （観測とPTY読み取りの分離）と判断し、旧アサーションは削除した。
    } finally {
      core.closeSession(sid);
    }
  });
});

// v0.16.0: sendAndWaitAgentDone の in-memory busy lock は削除された（dispatchAgentTurn は
// wait しないため二重waitという概念自体が消滅）。「同一 session の二重 wait は busy reject する」
// テストは削除。

test("observeAgentDone: follow-up は前turn後の transcript cursorだけを回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      const receipt1 = await core.dispatchAgentTurn(sid, "echo BIND_ONE");
      appendCodexDone(meta, {
        vendor_session_id: "vendor-session-a",
        turn_id: "bind-one",
      });
      const first = await core.observeAgentDone(sid, { cursor: receipt1.event_cursor, timeout: 3 });
      assert.equal(first.outcome, "done");
      assert.equal(first.turn_id, "bind-one");

      const receipt2 = await core.dispatchAgentTurn(sid, "echo BIND_TWO");
      const beforeSecond = await core.observeAgentDone(sid, { cursor: receipt2.event_cursor, timeout: 0 });
      assert.equal(beforeSecond.outcome, "running", "前turnのtask_completeを再利用しない");
      appendCodexDone(readAgentMeta(sid), { vendor_session_id: "vendor-session-a", turn_id: "bind-two" });
      const second = await core.observeAgentDone(sid, { cursor: receipt2.event_cursor, timeout: 3 });
      assert.equal(second.outcome, "done");
      assert.equal(second.turn_id, "bind-two");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: 後発sub-agent transcriptのtask_completeをroot turnへ誤帰属しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      appendCodexDone(meta, { vendor_session_id: "root-session", turn_id: "root-first" });
      await core.readAgentTranscript(sid).catch(() => {});
      const receipt = await core.dispatchAgentTurn(sid, "echo ROOT_SECOND");
      writeCodexTranscript(meta, "zzzz-subagent-session", [
        { type: "session_meta", payload: { id: "zzzz-subagent-session" } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: "subagent-turn" } },
      ]);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running");
      assert.notEqual(observation.turn_id, "subagent-turn");
    } finally {
      core.closeSession(sid);
    }
  });
});

// v0.16.0: wait 中の close/killAll 拒否・stale file lock 自動回収は agentWaitLocks／
// acquireAgentWaitFileLock ごと削除された（誰も .wait.lock を取得しなくなった）。旧
// 「wait 中の close/killAll と stale file lock を拒否する」テストは概念ごと削除。

// v0.16.0: agentWaitLocks（in-memory）と acquireAgentWaitFileLock は削除された。
// 「死んだ pid の stale lock は自動回収して待機を再開できる」「古い malformed lock も残骸として
// 回収する」は取得側が消滅したため概念ごと削除。「生きた別プロセスの lock は close/killAll も塞ぐ」は
// closeSessionInternal/killAll の liveWaitLocks によるcross-version安全弁として残り、手で
// lockファイルを作って検証する（sendAndWaitAgentDone による送信拒否検証部分のみ概念消滅のため削除）。
test("agent wait lock: 生きた別プロセスの lock は pid 診断付きで close/killAll を塞ぐ", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    const meta = readAgentMeta(sid);
    const lockPath = path.join(agentStateDir(), `${sid}.${meta.launch_id}.wait.lock`);
    try {
      await markFakeAgentReady(sid, "codex");
      // 生きている外部プロセス＝テストランナーの親 pid を待機者として偽装
      const livePid = process.ppid;
      fs.writeFileSync(lockPath, JSON.stringify({ pid: livePid, at: "2026-01-01T00:00:00Z" }) + "\n", {
        mode: 0o600,
      });
      assert.throws(
        () => core.closeSession(sid),
        (e) => e.code === 2 && new RegExp(`pid ${livePid}`).test(e.message) && /close できません/.test(e.message),
      );
      assert.throws(
        () => core.killAll(),
        (e) => e.code === 2 && /killAll できません/.test(e.message) && new RegExp(`${sid}\\(pid ${livePid}\\)`).test(e.message),
      );
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* noop */
      }
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: partial transcript JSONL fragment は次 poll まで保持する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-partial", []);
      const line = JSON.stringify({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "partial-turn" },
        timestamp: new Date().toISOString(),
      }) + "\n";
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo PARTIAL_BODY");
      setTimeout(() => {
        fs.appendFileSync(transcript, line.slice(0, 20));
        setTimeout(() => {
          fs.appendFileSync(transcript, line.slice(20));
        }, 350);
      }, 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done", `分割 JSONL event を拾う: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, "partial-turn");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: malformed 完結 transcript JSONL は malformed_events に数える", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-malformed", []);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo MALFORMED_BODY");
      setTimeout(() => fs.appendFileSync(transcript, '{"type":"event_msg"\n'), 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
      assert.equal(observation.outcome, "timeout");
      assert.equal(observation.malformed_events, 1, `malformed 診断: ${JSON.stringify(observation)}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: oversized transcript JSONL 行も malformed_events に数える", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-oversized", []);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo OVERSIZED_BODY");
      setTimeout(() => fs.appendFileSync(transcript, "x".repeat(1024 * 1024 + 1) + "\n"), 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
      assert.equal(observation.outcome, "timeout");
      assert.equal(observation.malformed_events, 1, `oversized 診断: ${JSON.stringify(observation)}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: 普通のPTY session は送信前に拒否する", { skip: skipAgentDone }, async () => {
  const sid = "plain_agentdone";
  core.openSession(sid);
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
      (e) => e.code === 2 && /agent_done 管理セッション/.test(e.message),
    );
    const out = await core.readOutput(sid, { screen: true, raw: true });
    assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
  } finally {
    core.closeSession(sid);
  }
});

// v0.16.0: dispatchAgentTurn に enter オプションは存在しない（渡しても無視される）。
// 「enter:false は送信前に拒否する」は概念ごと削除。

test("openAgent grok: --model grok-4.6 を組み立て、--effort は渡さない", { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo"; // grok 経路を echo で可視化
  try {
    const [sid] = core.openAgent("grok", {});
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--no-auto-update/, `grok no-auto-update: ${out}`);
    assert.match(out, /--model grok-4\.6/, `grok model: ${out}`);
    assert.doesNotMatch(out, /--effort/, `grok effort: ${out}`);
    core.closeSession(sid);
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
  }
});
test("openAgent grok: model 引数で既定モデルを上書きする", { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN;
  const catalogBin = makeGrokCatalogBin(["grok-next"]);
  process.env.GROK_BIN = catalogBin;
  try {
    for (const [kind, model] of [["grok", "grok-next"]]) {
      const [sid] = core.openAgent(kind, { model });
      try {
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /<arg>--model<\/arg>/, `${kind} model flag: ${out}`);
        assert.match(out, new RegExp(`<arg>${model}</arg>`), `${kind} model: ${out}`);
      } finally {
        core.closeSession(sid);
      }
    }
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
    fs.rmSync(catalogBin, { force: true });
  }
});

test("openAgent codex agent_done: model 上書きは共有 config を変更せずCLI引数へ載せる", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      'model = "pinned"\nmodel_reasoning_effort = "ultra"\nkeep_me = true\n\n[mcp_servers.x]\ncommand = "y"\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid, hint] = core.openAgent("codex", { model: "gpt-5.6-terra", agent_done: true });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true, until: ARGV_FIXTURE_DONE });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(hint, /共有 config/);
      assert.match(hint, /proactive 自動委譲/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: model と effort は共有 config を変更せずCLI引数へ載せる", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      'model = "pinned"\nmodel_reasoning_effort = "ultra"\nkeep_me = true\n\n[mcp_servers.x]\ncommand = "y"\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid] = core.openAgent("codex", {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      agent_done: true,
    });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true, until: ARGV_FIXTURE_DONE });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: quoted top-level pin も共有したまま引数を優先する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      '"model" = "pinned"\n\'model_reasoning_effort\' = "ultra"\nkeep_me = true\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid, hint] = core.openAgent("codex", {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      agent_done: true,
    });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true, until: ARGV_FIXTURE_DONE });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/);
      assert.match(hint, /model=gpt-5\.6-terra（引数） effort=high（引数）/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: 空/空白 model は session を残さず拒否する", () => {
  // throw 自体は session 作成前＝tmux 不要。残骸ゼロ確認だけ tmux が要る（listSessions）。
  const before = skip ? null : core.listSessions();
  for (const model of ["", "   "]) {
    assert.throws(
      () => core.openAgent("codex", { model }),
      (e) => e.code === 2 && /model が空文字/.test(e.message),
    );
  }
  if (!skip) assert.equal(core.listSessions(), before, "空 model の失敗が session を残した");
});

// A3: env 指定 bin の実在検証（存在しないパスを黙って返して偽成功にしない）。tmux 不要（session 前に throw）。
test("openAgent: 存在しない CODEX_BIN は明示エラー（偽成功にしない・A3）", () => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = "/no/such/codex-bin-aiterm-xyz";
  try {
    assert.throws(
      () => core.openAgent("codex", {}),
      (e) => e.code === 2 && /CODEX_BIN/.test(e.message),
    );
  } finally {
    process.env.CODEX_BIN = saved;
  }
});

test("agent bin: ディレクトリや非実行fileをreadyにしない", () => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = os.tmpdir();
  try {
    assert.equal(core.harnessLauncherDiagnostic("codex"), "unverified");
    assert.throws(
      () => core.openAgent("codex", {}),
      (e) => e.code === 2 && /CODEX_BIN/.test(e.message),
    );
  } finally {
    process.env.CODEX_BIN = saved;
  }
});

// A6: cwd の空文字・~ 未展開を明示エラーに。tmux 不要（bin 解決後・session 前に throw）。
test("openAgent: 空文字 cwd は明示エラー（A6）", () => {
  assert.throws(() => core.openAgent("codex", { cwd: "" }), (e) => e.code === 2 && /空/.test(e.message));
});
test("openAgent: ~ 始まりの cwd は展開されない旨の明示エラー（A6）", () => {
  assert.throws(() => core.openAgent("codex", { cwd: "~/repo" }), (e) => e.code === 2 && /~/.test(e.message));
});

test("readAgentTranscript: Codex の単一 output_text を直近完了 turn から回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-single";
      const turnId = "transcript-turn-single";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        "{ malformed jsonl line",
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Codex single answer" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid);
      assert.match(out, /Codex single answer/);
      assert.match(out, /vendor=codex turn_id=transcript-turn-single harness=codex-cli raw_chars=19/);
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      assert.equal((await core.readAgentTranscriptResult(sid, { completion, raw: true })).text, "Codex single answer");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: 配送用本文は完了turnを指定して無削減で回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "delivery-codex";
      const turnId = "delivery-turn";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      const answer = Array.from({ length: 100 }, (_, i) => `回答 ${i}\n引用符\"`).join("\n");
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: answer } },
      ]);
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      appendCodexTranscript(meta, vendorSessionId, [
        { type: "event_msg", payload: { type: "task_complete", turn_id: "later-turn", last_agent_message: "後続の回答" } },
      ]);
      const out = await core.readAgentTranscriptResult(sid, { completion, raw: true });
      assert.equal(out.text, answer);
      assert.equal(out.turn_id, turnId);
      assert.equal(out.raw_chars, answer.length);
      await assert.rejects(core.readAgentTranscriptResult(sid, { completion: { ...completion, launch_id: "b".repeat(32) }, raw: true }), /launchと一致しません/);
    } finally { core.closeSession(sid); }
  });
});

test("配送記録の保存に失敗した初手とfollow-upは、子へ本文を送らない", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    for (const initial of [true, false]) {
      const [sid] = core.openAgent("codex", { agent_done: true });
      try {
        let recorded;
        const options = { before_send: async (boundary) => { recorded = boundary; throw new Error("配送先の保存失敗"); } };
        const call = initial ? core.sendInitialAgentPrompt(sid, "配送前に止まる本文", options) : core.dispatchAgentTurn(sid, "配送前に止まる本文", options);
        await assert.rejects(call, /配送先の保存失敗/);
        assert.equal(recorded.session_id, sid);
        assert.equal(recorded.launch_id, readAgentMeta(sid).launch_id);
        assert.equal(typeof recorded.event_cursor, "number");
        assert.doesNotMatch(fs.readFileSync(sessionLogPath(sid), "utf8"), /配送前に止まる本文/);
      } finally { core.closeSession(sid); }
    }
  });
});

test("readAgentTranscript: Claudeはprivate transcriptでなくhook-captured resultを検証して返す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    const vendorSessionId = meta.vendor_session_id;
    const text = "一つの永続Claude sessionが維持した助言";
    const digest = createHash("sha256").update(text, "utf8").digest("hex");
    fs.writeFileSync(meta.result_file, JSON.stringify({
      schema: "aiterm.claude-turn-result.v2",
      operation_id: null,
      vendor_session_id: vendorSessionId,
      result_digest: digest,
      result_bytes: Buffer.byteLength(text, "utf8"),
      text,
    }) + "\n", { mode: 0o600 });
    fs.appendFileSync(meta.event_file, JSON.stringify({
      type: "agent_done",
      vendor: "claude",
      aiterm_session: sid,
      launch_id: meta.launch_id,
      vendor_session_id: vendorSessionId,
      turn_id: null,
      reason: "Stop",
      done_status: "turn_done",
      result_digest: digest,
      result_bytes: Buffer.byteLength(text, "utf8"),
      at: new Date().toISOString(),
    }) + "\n");
    const out = await core.readAgentTranscript(sid);
    assert.match(out, new RegExp(text));
    assert.match(out, /agent_transcript vendor=claude turn_id=unknown/);
    assert.match(out, /harness=claude-code/);

    const forged = JSON.parse(fs.readFileSync(meta.result_file, "utf8"));
    forged.text = "別の本文";
    fs.writeFileSync(meta.result_file, JSON.stringify(forged) + "\n", { mode: 0o600 });
    await assert.rejects(() => core.readAgentTranscript(sid), /完了eventと一致しません/);
  } finally {
    core.closeSession(sid);
  }
});

test("readAgentTranscript: Codex の複数 assistant block を join し lines は末尾へ絞る", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-blocks";
      const turnId = "transcript-turn-blocks";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "first\nsecond" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "third" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid, { lines: 2 });
      assert.doesNotMatch(out, /first/);
      assert.match(out, /second\nthird/);
      assert.match(out, /raw_chars=12/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: Codex は作業途中の報告(commentary)を除き final_answer だけを回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-phase";
      const turnId = "transcript-turn-phase";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      const message = (phase, text) => ({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase,
          content: [{ type: "output_text", text }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
      });
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        message("commentary", "調べるね"),
        message("commentary", "差分を確認したよ"),
        message("final_answer", "結論だよ"),
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid);
      assert.doesNotMatch(out, /調べるね|差分を確認したよ/);
      assert.match(out, /^結論だよ\n/);
      assert.match(out, /raw_chars=4/);
    } finally {
      core.closeSession(sid);
    }
  });
});

// 回答を空で終えたturn。Codex 0.160.1の実記録（2026-10-06）と同じ形: 途中の報告があり、final_answerのtextが空、
// task_completeのlast_agent_messageがnull。
function codexEmptyAnswerTurn(turnId) {
  const message = (phase, text) => ({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      phase,
      content: [{ type: "output_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
    },
  });
  return [
    { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    message("commentary", "伝える事は送ったよ"),
    message("final_answer", ""),
    { type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: null } },
  ];
}

test("readAgentTranscript: Codex が回答を空で終えたturnは、誤りにせず空の回答として返す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-empty";
      const turnId = "transcript-turn-empty";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        // turn IDの無い旧形式のagent_message（前のturnの回答かもしれない）を、空のturnの回答として返さない。
        { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "前のturnの回答" } },
        ...codexEmptyAnswerTurn(turnId),
      ]);
      const result = await core.readAgentTranscriptResult(sid);
      assert.equal(result.answer_empty, true);
      assert.equal(result.text, "");
      assert.equal(result.raw_chars, 0);
      assert.equal(result.turn_id, turnId);
      assert.match(result.display, /^このターンは完了しましたが、回答の本文は空でした。\n/);
      assert.match(result.display, /vendor=codex turn_id=transcript-turn-empty harness=codex-cli raw_chars=0 answer_empty=true\]$/);
      assert.doesNotMatch(result.display, /伝える事は送ったよ|前のturnの回答/);
      // 親配送の読み方（完了turnを指定）でも同じ。
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      const exact = await core.readAgentTranscriptResult(sid, { completion, raw: true });
      assert.equal(exact.answer_empty, true);
      assert.equal(exact.text, "");
      // 回答があるturnはfalse。
      appendCodexTranscript(meta, vendorSessionId, [
        { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer",
          content: [{ type: "output_text", text: "回答あり" }], internal_chat_message_metadata_passthrough: { turn_id: "answered-turn" } } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: "answered-turn", last_agent_message: "回答あり" } },
      ]);
      assert.equal((await core.readAgentTranscriptResult(sid)).answer_empty, false);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: Codex のturnの本文が記録に見つからない時は、空の回答にせず誤りのままにする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-unlocated";
      const turnId = "transcript-turn-unlocated";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        // 記録の形が変わった時の見立て: 本文はあるが、turn IDの置き場が違う。
        { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer",
          content: [{ type: "output_text", text: "読めない回答" }], turn: { id: turnId } } },
        // turn IDの無い旧形式のagent_messageは、空なら「回答が空」の証拠にしない。
        { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "" } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: null } },
      ]);
      await assert.rejects(
        () => core.readAgentTranscriptResult(sid),
        (e) => e.code === 2 && /最終 assistant メッセージを特定できませんでした（harness=codex-cli, vendor=codex）/.test(e.message),
      );
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      await assert.rejects(
        () => core.readAgentTranscriptResult(sid, { completion, raw: true }),
        (e) => e.code === 2 && /transcript がまだありません/.test(e.message),
      );
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: Claude のStop hookが空の回答を記録したturnは、空の回答として返す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    const digest = createHash("sha256").update("", "utf8").digest("hex");
    fs.writeFileSync(meta.result_file, JSON.stringify({
      schema: "aiterm.claude-turn-result.v2",
      operation_id: null,
      vendor_session_id: meta.vendor_session_id,
      result_digest: digest,
      result_bytes: 0,
      text: "",
    }) + "\n", { mode: 0o600 });
    fs.appendFileSync(meta.event_file, JSON.stringify({
      type: "agent_done",
      vendor: "claude",
      aiterm_session: sid,
      launch_id: meta.launch_id,
      vendor_session_id: meta.vendor_session_id,
      turn_id: null,
      reason: "Stop",
      done_status: "turn_done",
      result_digest: digest,
      result_bytes: 0,
      at: new Date().toISOString(),
    }) + "\n");
    const result = await core.readAgentTranscriptResult(sid);
    assert.equal(result.answer_empty, true);
    assert.equal(result.text, "");
    assert.match(result.display, /harness=claude-code raw_chars=0 answer_empty=true\]$/);
  } finally {
    core.closeSession(sid);
  }
});

test("readAgentTranscript: Grok は本文の無いassistant行だけのturnを空の回答、assistant行の無いturnを誤りにする", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true, cwd: process.cwd() });
      try {
        const meta = readAgentMeta(sid);
        appendAgentDone(meta, { turn_id: "transcript-turn-grok-empty" });
        // 道具を呼ぶだけのassistant行はcontentが空文字列で残る（実記録の形）。
        writeGrokTranscript(meta, meta.vendor_session_id, [
          { type: "user", content: "old question" },
          { type: "assistant", content: "old answer" },
          { type: "user", content: "latest question" },
          { type: "reasoning", content: "thinking" },
          { type: "assistant", content: "", tool_calls: [{ id: "call-1" }] },
          { type: "tool_result", content: "ok" },
        ]);
        const result = await core.readAgentTranscriptResult(sid);
        assert.equal(result.answer_empty, true);
        assert.equal(result.text, "");
        assert.doesNotMatch(result.display, /old answer/);

        writeGrokTranscript(meta, meta.vendor_session_id, [
          { type: "user", content: "old question" },
          { type: "assistant", content: "old answer" },
          { type: "user", content: "latest question" },
          // 記録の形が変わった時の見立て: contentが文字列でない。
          { type: "assistant", content: [{ type: "text", text: "読めない回答" }] },
        ]);
        await assert.rejects(
          () => core.readAgentTranscriptResult(sid),
          (e) => e.code === 2 && /最終 assistant メッセージを特定できませんでした（harness=grok-cli, vendor=grok）/.test(e.message),
        );
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("readAgentTranscript: Grok は最後の実 user 入力以降の確定assistantだけを回収する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true, cwd: process.cwd() });
      try {
        const meta = readAgentMeta(sid);
        const vendorSessionId = meta.vendor_session_id;
        appendAgentDone(meta, { turn_id: "transcript-turn-grok" });
        writeGrokTranscript(meta, vendorSessionId, [
          { type: "user", content: "old question" },
          { type: "assistant", content: "old answer" },
          { type: "user", content: "synthetic", synthetic_reason: "resume" },
          { type: "assistant", content: "still old answer" },
          { type: "user", content: "latest question" },
          { type: "reasoning", content: "thinking" },
          { type: "assistant", content: "latest first" },
          { type: "assistant", content: "latest second" },
        ]);
        const result = await core.readAgentTranscriptResult(sid);
        const out = result.display;
        assert.doesNotMatch(out, /old answer|still old answer/);
        assert.doesNotMatch(out, /latest first/);
        assert.match(out, /latest second/);
        assert.match(out, /vendor=grok turn_id=transcript-turn-grok harness=grok-cli/);
        assert.equal(result.text, "latest second");
        assert.equal(result.vendor, "grok");
        assert.equal(result.turn_id, "transcript-turn-grok");
        assert.equal(result.harness, "grok-cli");
        assert.equal(result.raw_chars, 13);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("readAgentTranscript: Grokのsteerで次turnが始まっても完了済み回答の配送を失わない", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true, cwd: process.cwd() });
      try {
        const meta = readAgentMeta(sid);
        writeGrokTranscript(meta, meta.vendor_session_id, [
          { type: "user", prompt_index: 0, content: "最初の依頼" },
          { type: "assistant", content: "先に完了した回答" },
          { type: "user", prompt_index: 1, content: "追加依頼" },
          { type: "assistant", content: "後の回答" },
        ]);
        const events = path.join(meta.grok_home, "sessions", encodeURIComponent(meta.cwd), meta.vendor_session_id, "events.jsonl");
        fs.writeFileSync(events, [
          { type: "turn_started", turn_number: 0 },
          { type: "turn_ended", outcome: "completed", ts: "first-completion" },
          { type: "turn_started", turn_number: 1 },
        ].map(JSON.stringify).join("\n") + "\n");
        const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
        assert.equal(completion.turn_id, "first-completion");
        assert.equal((await core.readAgentTranscriptResult(sid, { completion, raw: true })).text, "先に完了した回答");
        fs.appendFileSync(events, JSON.stringify({ type: "turn_ended", outcome: "completed", ts: "later-completion" }) + "\n");
        assert.equal((await core.readAgentTranscriptResult(sid, { completion, raw: true })).text, "先に完了した回答");
      } finally { core.closeSession(sid); }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("readAgentTranscript: 非 agent session は既存の明示エラーを返す", async () => {
  await assert.rejects(
    () => core.readAgentTranscript("not_an_agent_transcript"),
    (e) => e.code === 2 && /agent_done 管理セッションではありません/.test(e.message),
  );
});

test("readAgentTranscript: transcript 不在は明示エラーにする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      bindTranscriptTurn(sid, "transcript-missing", "transcript-turn-missing");
      await assert.rejects(
        () => core.readAgentTranscript(sid),
        (e) => e.code === 2 && /transcript がまだありません/.test(e.message),
      );
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: 巨大回答は既存 reduceOutput の行数 bound を通す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-large";
      const turnId = "transcript-turn-large";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      const answer = Array.from({ length: 70 }, (_, i) => `line-${i + 1}`).join("\n");
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: answer }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid);
      assert.match(out, /〈20 行省略。全文は full=true、範囲は line_range="A:B"〉/);
      assert.match(out, /raw_chars=550/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent grok: Windows は非native GROK_BIN を session 作成前に拒否する", {
  skip: process.platform !== "win32" ? "Windows 専用の native 強制検証" : (hasTmux ? undefined : "tmux 未インストール"),
}, () => {
  const saved = process.env.GROK_BIN;
  const bin = path.join(process.env.TMPDIR, "fake-grok-nonnative.sh");
  fs.writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.GROK_BIN = bin;
  try {
    assert.throws(() => core.openAgent("grok", {}), /Windows native の grok\.exe/);
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
    fs.rmSync(bin, { force: true });
  }
});

test("Claude hookのnodeは絶対pathで、HomebrewのCellarの実体は更新でも残るoptへ置き換える", async () => {
  const { hookNodeExecutable } = await import("../dist/harnesses/claude.js");
  assert.equal(hookNodeExecutable("/home/u/.local/lib/node-v24/bin/node", () => false), "/home/u/.local/lib/node-v24/bin/node");
  assert.equal(hookNodeExecutable("/opt/homebrew/Cellar/node/26.10.0_1/bin/node", file => file === "/opt/homebrew/opt/node/bin/node"), "/opt/homebrew/opt/node/bin/node");
  assert.equal(hookNodeExecutable("/opt/homebrew/Cellar/node@24/24.2.0/bin/node", file => file === "/opt/homebrew/opt/node@24/bin/node"), "/opt/homebrew/opt/node@24/bin/node");
  assert.equal(hookNodeExecutable("/opt/homebrew/Cellar/node/26.10.0_1/bin/node", () => false), "node");
});
