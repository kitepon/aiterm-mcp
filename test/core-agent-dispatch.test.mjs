// core-agentの試験のうち、送信と完了の対応づけ（dispatch／observe、Claudeのoperation）。準備は core-agent-support.mjs。
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

test("dispatch/observe: Codex task_complete 到着まで transcript 正本を待つ", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const metaFile = fs.readdirSync(agentStateDir()).find((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
      assert.ok(metaFile);
      const meta = JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFile), "utf8"));
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo AGENT_DONE_BODY");
      assert.equal(receipt.harness, "codex-cli");
      scheduleCodexDone(meta);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done");
      assert.equal(observation.vendor, "codex");
      assert.equal(observation.harness, "codex-cli");
      assert.equal(observation.turn_id, "turn-test");
    } finally {
      core.closeSession(sid);
    }
  });
});

// 2026-10-07: 起きていて動いていないCodexの席へ新しいturnで送ると、受け付けまで毎回5.7秒かかっていた（連携元の本番の記録）。
// 起動直後のための11回の確かめ（ADR 0014）を、2通目以降にも毎回通していた（ADR 0097）。
test("dispatch: この起動でturnを1つ終えたCodexの席は11回の確かめを待たずに送り、記録でturnが動いている間は待つ", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    // 11回の確かめを、時間内には通らない回数にする。送れたなら、短い道を通っている。
    core.__testSetAgentTuiReadyStableSamples(1000);
    const refused = /入力受付状態になりません。文字列は送信していません。/;
    const turn = (type, id) => ({ type: "event_msg", payload: { type, turn_id: id } });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      // 起動直後。記録にturnが無いので、短い道は使わない。
      await assert.rejects(core.dispatchAgentTurn(sid, "echo COLD_MUST_NOT_SEND", { ready_timeout: 1_200 }), refused);
      appendCodexTranscript(meta, "codex-session-settled", [turn("task_started", "turn-1"), turn("task_complete", "turn-1")]);
      const first = await core.dispatchAgentTurn(sid, "echo SETTLED_FIRST_BODY", { ready_timeout: 1_200 });
      assert.equal(first.schema, "aiterm.agent-dispatch.v1");
      // 記録の上で次のturnが動いている間は、画面が入力待ちに見えても短い道を使わない。
      appendCodexTranscript(meta, "codex-session-settled", [turn("task_started", "turn-2")]);
      await assert.rejects(core.dispatchAgentTurn(sid, "echo RUNNING_MUST_NOT_SEND", { ready_timeout: 1_200 }), refused);
      // そのturnが終われば、また短い道で送る（画面は変えていない）。
      appendCodexTranscript(meta, "codex-session-settled", [turn("task_complete", "turn-2")]);
      const second = await core.dispatchAgentTurn(sid, "echo SETTLED_SECOND_BODY", { ready_timeout: 1_200 });
      assert.ok(second.event_cursor > first.event_cursor, "境界は、終わったturnの後ろに切る");
      const log = fs.readFileSync(sessionLogPath(sid), "utf8");
      assert.match(log, /SETTLED_FIRST_BODY/);
      assert.match(log, /SETTLED_SECOND_BODY/);
      assert.doesNotMatch(log, /MUST_NOT_SEND/);
    } finally {
      core.__testSetAgentTuiReadyStableSamples(1);
      core.closeSession(sid);
    }
  });
});

test("dispatch/observe: Grok vendor event も待って suffix に vendor=grok を付ける", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        const metaFile = fs.readdirSync(agentStateDir()).find((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
        assert.ok(metaFile);
        const meta = JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFile), "utf8"));
        await markFakeAgentReady(sid, "grok");
        const receipt = await core.dispatchAgentTurn(sid, "echo GROK_DONE_BODY");
        assert.equal(receipt.harness, "grok-cli");
        scheduleAgentDone(meta, { turn_id: "prompt-test" }, 500);
        const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 5 });
        assert.equal(observation.outcome, "done");
        assert.equal(observation.vendor, "grok");
        assert.equal(observation.harness, "grok-cli");
        assert.equal(observation.turn_id, "prompt-test");
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("dispatch/observe: Claudeの同一PTY follow-upをStop resultと相関して回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_FOLLOWUP_PROMPT");
    assert.equal(receipt.harness, "claude-code");
    setTimeout(() => writeClaudeDone(meta, "Claude follow-up answer", {
      vendor_session_id: meta.vendor_session_id,
    }), 200);
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
    assert.equal(observation.outcome, "done");
    assert.equal(observation.vendor, "claude");
    assert.equal(observation.harness, "claude-code");
    assert.equal(observation.vendor_session_id, meta.vendor_session_id);
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /CLAUDE_FOLLOWUP_PROMPT/);
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude follow-up answer/);
    assert.match(transcript, /agent_transcript vendor=claude turn_id=unknown/);
    assert.match(transcript, /harness=claude-code/);
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claude timeout後は再送せず後着resultを同一sessionから回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_TIMEOUT_PROMPT");
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
    assert.equal(observation.outcome, "running");
    assert.equal(observation.vendor, "claude");
    assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "timeout後も同じsessionを残す");

    writeClaudeDone(meta, "Claude late answer", {
      vendor_session_id: meta.vendor_session_id,
    });
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude late answer/);
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation回収: 古いR1を新しいO2へ誤帰属せずO2だけを返す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"1".repeat(64)}`;
  const operation2 = `sha256:${"2".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    writeClaudeDone(meta, "old R1", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operation1,
    });

    await assert.rejects(
      () => core.readAgentTranscript(sid, { operation_id: operation2 }),
      /operation.*まだ完了していません|一致する.*operation/i,
    );

    writeClaudeDone(meta, "new R2", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operation2,
    });
    const out = await core.readAgentTranscript(sid, { operation_id: operation2 });
    assert.match(out, /new R2/);
    assert.doesNotMatch(out, /old R1/);
    assert.match(out, new RegExp(`operation_id=${operation2}`));
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claude operation_idをmarker・完了suffix・timeout後回収へ通す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"3".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_TIMEOUT", { operation_id: operationId });
    assert.equal(receipt.operation_id, operationId);
    const observation = await core.observeAgentDone(sid, {
      cursor: receipt.event_cursor,
      operation_id: operationId,
      timeout: 0,
    });
    assert.equal(observation.outcome, "running");
    assert.equal(observation.operation_id, operationId);
    const marker = JSON.parse(fs.readFileSync(
      path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`),
      "utf8",
    ));
    assert.equal(marker.operation_id, operationId);

    writeClaudeDone(meta, "late operation answer", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operationId,
    });
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /late operation answer/);
    assert.match(recovered, new RegExp(`operation_id=${operationId}`));
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: timeoutしたissueはaccepted、同じoperationだけをpendingからexact resultへ回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"b".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");

    const issued = await core.runClaudeOperation({
      session_id: sid,
      action: "issue",
      operation_id: operationId,
      text: "STRUCTURED_TIMEOUT_PROMPT",
      timeout: 0,
    });
    // submit_residue は fake TUI の画面内容に依存する観測値なので型だけ固定し、他は exact 一致で固定する
    assert.ok(
      issued.submit_residue === null || typeof issued.submit_residue === "boolean",
      `issue は submit 座礁観測を返す: ${JSON.stringify(issued)}`,
    );
    delete issued.submit_residue;
    assert.deepEqual(issued, {
      schema: "aiterm.claude-operation-result.v1", action: "issue", status: "accepted",
      session_id: sid, operation_id: operationId, raw_output: null, reason: null,
    });
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: operationId }),
      {
        schema: "aiterm.claude-operation-result.v1", action: "recover", status: "pending",
        session_id: sid, operation_id: operationId, raw_output: null, reason: null, submit_residue: null,
      },
    );
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /STRUCTURED_TIMEOUT_PROMPT/);

    const hook = invokeClaudeStopHook(meta, "structured exact raw output", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: operationId }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "completed",
        session_id: sid,
        operation_id: operationId,
        raw_output: "structured exact raw output",
        reason: null,
        submit_residue: null,
      },
    );
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: 未dispatchとreceiptだけのoperationをunknown理由別に固定する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const undispatched = `sha256:${"0".repeat(64)}`;
  const receiptOnly = `sha256:${"f".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    // v0.16.0: runClaudeOperation から timeout パラメータ自体が削除された（型からも消えた）。
    // 実装は destructuring で未知キーを黙って無視するだけで、"recoverにtimeoutは指定できません"
    // という拒否は現 core.ts に存在しない（grep で確認済み）。旧テストが検証していたrejectを
    // 期待側の実挙動（無視されて通常のunknown結果が返る）へ合わせる。
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: undispatched }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "unknown",
        session_id: sid,
        operation_id: undispatched,
        raw_output: null,
        reason: "operation_not_found",
        submit_residue: null,
      },
    );
    fs.writeFileSync(claudeDispatchReceiptPath(meta, receiptOnly), "", { mode: 0o600 });
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: receiptOnly }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "unknown",
        session_id: sid,
        operation_id: receiptOnly,
        raw_output: null,
        reason: "result_unknown",
        submit_residue: null,
      },
    );
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: 別active operationとmalformed markerをstructured結果へ降格しない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const active = `sha256:${"6".repeat(64)}`;
  const other = `sha256:${"7".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.runClaudeOperation({
      session_id: sid,
      action: "issue",
      operation_id: active,
      text: "ACTIVE_OPERATION",
      timeout: 0,
    });
    await assert.rejects(
      () => core.runClaudeOperation({
        session_id: sid,
        action: "issue",
        operation_id: other,
        text: "MUST_NOT_INTERLEAVE",
        timeout: 0,
      }),
      /別のoperation|未解決/,
    );

    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    fs.writeFileSync(marker, "{malformed\n", { mode: 0o600 });
    await assert.rejects(
      () => core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: active }),
      /marker.*(?:不正|読めません)|JSON/,
    );
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation E2E fixture: core dispatch markerを実Stop hookが消費し同じIDで回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"c".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_E2E", { operation_id: operationId });
    const hook = invokeClaudeStopHook(meta, "hook-correlated E2E answer", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /hook-correlated E2E answer/);
    assert.match(recovered, new RegExp(`operation_id=${operationId}`));
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_E2E_REPLAY", { operation_id: operationId }),
      /既にdispatch済み/,
    );
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: 別operationのStop eventを期待operationの完了にしない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const expected = `sha256:${"4".repeat(64)}`;
  const other = `sha256:${"5".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_EXPECTED_OPERATION", { operation_id: expected });
    setTimeout(() => writeClaudeDone(meta, "wrong operation answer", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: other,
      consume_marker: false,
    }), 200);
    const observation = await core.observeAgentDone(sid, {
      cursor: receipt.event_cursor,
      operation_id: expected,
      timeout: 1,
    });
    assert.equal(observation.outcome, "timeout");
    assert.equal(observation.operation_id, expected);
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation interrupt: active中の通常入力を拒否しC-c後もStopまでmarkerを保持する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"6".repeat(64)}`;
  const operation2 = `sha256:${"7".repeat(64)}`;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_INTERRUPT_ACTIVE", { operation_id: operationId });
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    const tmuxStateDir = path.join(process.env.TMPDIR, "claude-tmux-sockets");
    const markFile = path.join(tmuxStateDir, `${sid}.mark`);
    const lastcmdFile = path.join(tmuxStateDir, `${sid}.lastcmd`);
    assert.equal(fs.existsSync(marker), true);
    fs.rmSync(markFile, { force: true });
    fs.writeFileSync(lastcmdFile, "before-rejected-send");
    assert.throws(
      () => core.send(sid, "manual follow-up", { enter: false, force: true, mark: true }),
      /相関付きClaude|active|未解決/,
    );
    assert.equal(fs.existsSync(markFile), false, "拒否したmark:trueは偽の完了待ちmarkerを作らない");
    assert.equal(fs.readFileSync(lastcmdFile, "utf8"), "before-rejected-send", "拒否した送信はlastcmdも変えない");
    fs.writeFileSync(markFile, "existing-mark");
    assert.throws(
      () => core.send(sid, "manual follow-up", { enter: false, force: true, mark: false }),
      /相関付きClaude|active|未解決/,
    );
    assert.equal(fs.readFileSync(markFile, "utf8"), "existing-mark", "拒否したmark:falseは既存markerを消さない");
    assert.throws(() => core.sendKey(sid, "Enter"), /C-c|active|未解決/);
    assert.match(core.sendKey(sid, "C-c"), /sent key C-c/);
    assert.equal(fs.existsSync(marker), true, "C-c直後も遅延Stopを元operationへ相関する");
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "MUST_WAIT_FOR_INTERRUPTED_STOP", { operation_id: operation2 }),
      /未解決/,
    );

    const hook = invokeClaudeStopHook(meta, "interrupted operation result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /interrupted operation result/);
    await core.dispatchAgentTurn(sid, "SAFE_AFTER_INTERRUPTED_STOP", { operation_id: operation2 });
  } finally {
    core.closeSession(sid);
  }
});

test("claude_approval: active operationと画面digestを結合して単発承認だけを送る", { skip: skipAgentDone }, async () => {
  // 貼り付けの印はagent TUIだけが解す。shellに頼らず、偽TUIの中で画面を出す。
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ run: true });
  process.env.CLAUDE_BIN = fakeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"7".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(
      sid,
      "printf '\\nThis command changes directory before running git.\\n\\nDo you want to proceed?\\n❯ 1. Yes\\n  2. No\\n'",
      { operation_id: operationId },
    );
    await core.readOutput(sid, { wait: true, until: "2. No", timeout: 5, raw: true });

    assert.throws(
      () => core.runClaudeApproval({ action: "inspect", session_id: sid, operation_id: `sha256:${"6".repeat(64)}` }),
      /active operationが一致しません/,
    );
    const inspected = core.runClaudeApproval({ action: "inspect", session_id: sid, operation_id: operationId });
    assert.equal(inspected.schema, "aiterm.claude-approval-result.v1");
    assert.equal(inspected.status, "approval_required");
    assert.match(inspected.prompt_digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(inspected.choices, [
      { decision: "approve_once", index: 1, label: "Yes" },
      { decision: "deny", index: 2, label: "No" },
    ]);
    assert.throws(
      () => core.runClaudeApproval({
        action: "respond",
        session_id: sid,
        operation_id: operationId,
        approval_choice: "approve_once",
        observed_prompt_digest: `sha256:${"0".repeat(64)}`,
      }),
      /inspect後に変化|再度inspect/,
    );

    const submitted = core.runClaudeApproval({
      action: "respond",
      session_id: sid,
      operation_id: operationId,
      approval_choice: "approve_once",
      observed_prompt_digest: inspected.prompt_digest,
    });
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.selected_choice, "approve_once");
    const approvalReceipt = path.join(agentStateDir(), `${sid}.${meta.launch_id}.claude-approval.json`);
    assert.equal(fs.existsSync(approvalReceipt), true);
    // POSIX permission bit の断言は Windows 非適用（fs.Stats.mode が 0o666 を返すため）。
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(approvalReceipt).mode & 0o777, 0o600, "approval receiptはowner-only");
    }
    assert.equal(JSON.parse(fs.readFileSync(approvalReceipt, "utf8")).prompt_digest, inspected.prompt_digest);
    assert.equal(fs.existsSync(path.join(agentStateDir(), `${sid}.${meta.launch_id}.claude-operation.json`)), true,
      "承認入力はactive operation markerを消費しない");
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("claude_approval: 恒久許可だけの選択肢を拒否する", { skip: skipAgentDone }, async () => {
  // 貼り付けの印はagent TUIだけが解す。shellに頼らず、偽TUIの中で画面を出す。
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ run: true });
  process.env.CLAUDE_BIN = fakeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "printf 'Do you want to proceed?\\n1. Yes, and do not ask again\\n2. No\\n'");
    await core.readOutput(sid, { wait: true, until: "2. No", timeout: 5, raw: true });
    assert.throws(
      () => core.runClaudeApproval({ action: "inspect", session_id: sid }),
      /安全な単発Yes\/No選択肢/,
    );
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("Claude anonymous turn: timeout中はdurable operationを開始せず遅延Stopを匿名turnへ保持する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"a".repeat(64)}`;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    writeClaudeDone(meta, "old anonymous R1", {
      vendor_session_id: meta.vendor_session_id,
      consume_marker: false,
    });
    await core.dispatchAgentTurn(sid, "CLAUDE_ANONYMOUS_TIMEOUT");
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), {
      schema: "aiterm.claude-operation-marker.v1",
      operation_id: null,
    });
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "MUST_NOT_OVERWRITE_ANONYMOUS", { operation_id: operationId }),
      /operation_idなし.*未解決/,
    );
    await assert.rejects(() => core.readAgentTranscript(sid), /operation_idなし.*まだ完了していません/);

    const hook = invokeClaudeStopHook(meta, "anonymous late result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    const anonymous = await core.readAgentTranscript(sid);
    assert.match(anonymous, /anonymous late result/);
    assert.doesNotMatch(anonymous, /operation_id=/);
    await core.dispatchAgentTurn(sid, "SAFE_DURABLE_AFTER_ANONYMOUS_STOP", { operation_id: operationId });
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation_id: malformed値と非Claude sessionは送信前に拒否する", { skip: skipAgentDone }, async () => {
  const [claude] = core.openAgent("claude", { agent_done: true });
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(claude, "MUST_NOT_SEND", { operation_id: "bad" }),
      /sha256:<64 lowercase hex>/,
    );
    assert.doesNotMatch(fs.readFileSync(sessionLogPath(claude), "utf8"), /MUST_NOT_SEND/);
  } finally {
    core.closeSession(claude);
  }

  await withFakeCodexHome(async () => {
    const [codex] = core.openAgent("codex", { agent_done: true });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(codex, "MUST_NOT_SEND_CODEX", { operation_id: `sha256:${"f".repeat(64)}` }),
        /Claude agent session/,
      );
      assert.doesNotMatch(fs.readFileSync(sessionLogPath(codex), "utf8"), /MUST_NOT_SEND_CODEX/);
    } finally {
      core.closeSession(codex);
    }
  });
});

test("Claude operation dispatch: timeout後の同一ID再送と未解決中の別ID送信を拒否する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"8".repeat(64)}`;
  const operation2 = `sha256:${"9".repeat(64)}`;
  try {
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_DISPATCH_ONCE", { operation_id: operation1 });
    // dispatchAgentTurn は send 直後（Stop を待たず）に返る。前面 bash が
    // 「command not found」を出力し終えるまで一呼吸置いてから比較基準を取る（v0.16.0でsend結果の
    // 待機が無くなったため、出力の安定を明示的に待つ必要がある）。
    await core.readOutput(sid, { screen: true, wait: true, timeout: 2 });
    const before = fs.readFileSync(sessionLogPath(sid), "utf8");
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_MUST_NOT_RESEND", { operation_id: operation1 }),
      /既にdispatch済み|再送しません/,
    );
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_MUST_NOT_INTERLEAVE", { operation_id: operation2 }),
      /未解決|回収または手動中断/,
    );
    const after = fs.readFileSync(sessionLogPath(sid), "utf8");
    assert.equal(after, before, "拒否したpromptはPTYへ一文字も送らない");
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation dispatch: prompt内容を危険判定せず相関を開始する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"d".repeat(64)}`;
  const operation2 = `sha256:${"e".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    await core.dispatchAgentTurn(sid, "Explain why DROP TABLE is dangerous", { operation_id: operation1 });
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).operation_id, operation1);

    const hook = invokeClaudeStopHook(meta, "preflight operation result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    await core.dispatchAgentTurn(sid, "SAFE_NEW_OPERATION", { operation_id: operation2 });
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claudeは既知vendor_session_idと一致しないeventを完了扱いしない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_INVALID_VENDOR_SESSION");
    setTimeout(() => {
      fs.appendFileSync(meta.event_file, agentDoneLine(meta, { vendor_session_id: undefined }));
      fs.appendFileSync(meta.event_file, agentDoneLine(meta, { vendor_session_id: "" }));
    }, 200);
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
    assert.equal(observation.outcome, "timeout");
    assert.equal(observation.vendor, "claude");
    assert.equal(observation.malformed_events, 0, "別vendor sessionのeventは破損でなく非該当として無視する");
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: 起動時 prompt が未完了なら follow-up を送信前に拒否する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true, prompt: "Reply READY." });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /起動時 prompt の完了待ち/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});
