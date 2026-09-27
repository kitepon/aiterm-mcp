import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GROK_HOOK = path.join(HERE, "..", "dist", "grok-stop-hook.js");
const CLAUDE_HOOK = path.join(HERE, "..", "dist", "claude-stop-hook.js");
// 製品側 currentUid()（src/core.ts）と同じ規則。Windows(native) は getuid を持たず、
// fs.Stats.uid が常に 0 のため 0 を返す。getuid の有無で suite 全体を止めない。
const testUid = () => (typeof process.getuid === "function" ? process.getuid() : 0);
const isWin = process.platform === "win32";

function baseHookEnv(tmp) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: tmp,
    // Windows の os.tmpdir() は TMPDIR でなく TEMP/TMP を読む。hook 子プロセスを
    // テスト用 state root へ隔離するため両方を渡す（POSIX 側は TMPDIR が効くため無害）。
    TEMP: tmp,
    TMP: tmp,
  };
}

function makeHookState(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const uid = testUid();
  const root = path.join(tmp, `aiterm-mcp-${uid}`);
  const agents = path.join(root, "agents");
  fs.mkdirSync(agents, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(agents, 0o700);
  return { tmp, root, agents };
}

function spawnGrokHook(tmp, env, payload = {}) {
  return spawnSync(process.execPath, [GROK_HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...baseHookEnv(tmp),
      ...env,
    },
  });
}

function spawnClaudeHook(tmp, env, payload = {}) {
  return spawnSync(process.execPath, [CLAUDE_HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...baseHookEnv(tmp),
      ...env,
    },
  });
}

test("grok-stop-hook: Stop payload を agent_done event に正規化する", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-grok-hook-");

  const session = "grokhook";
  const launchId = "fedcba9876543210fedcba9876543210";
  const payload = {
    hookEventName: "stop",
    sessionId: "019f399a-a6bb-76e3-84f9-0512fdab810a",
    promptId: "prompt-1",
    reason: "end_turn",
  };
  const r = spawnGrokHook(tmp, {
    AITERM_AGENT_KIND: "grok",
    AITERM_SESSION_ID: session,
    AITERM_AGENT_LAUNCH_ID: launchId,
  }, payload);

  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    const eventFile = path.join(agents, `${session}.${launchId}.events.jsonl`);
    const lines = fs.readFileSync(eventFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.type, "agent_done");
    assert.equal(event.vendor, "grok");
    assert.equal(event.aiterm_session, session);
    assert.equal(event.launch_id, launchId);
    assert.equal(event.vendor_session_id, "019f399a-a6bb-76e3-84f9-0512fdab810a");
    assert.equal(event.turn_id, "prompt-1");
    assert.equal(event.reason, "end_turn");
    assert.equal(event.done_status, "turn_done");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("claude-stop-hook: Stop payload本文をowner-only resultへ分離しeventを相関する", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-claude-hook-");
  const session = "claudehook";
  const launchId = "abcdef0123456789abcdef0123456789";
  const message = "継続中の同じClaude sessionからの助言";
  const r = spawnClaudeHook(tmp, {
    AITERM_AGENT_KIND: "claude",
    AITERM_SESSION_ID: session,
    AITERM_AGENT_LAUNCH_ID: launchId,
  }, {
    session_id: "claude-session-1",
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: message,
  });

  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "Claude hook stdoutを汚さない");
    assert.equal(r.stderr, "");
    const eventFile = path.join(agents, `${session}.${launchId}.events.jsonl`);
    const event = JSON.parse(fs.readFileSync(eventFile, "utf8").trim());
    assert.equal(event.vendor, "claude");
    assert.equal(event.vendor_session_id, "claude-session-1");
    assert.equal(event.turn_id, null);
    assert.equal(event.done_status, "turn_done");
    assert.equal(Object.hasOwn(event, "last_assistant_message"), false, "eventへ本文を混ぜない");
    assert.match(event.result_digest, /^[0-9a-f]{64}$/);
    assert.equal(event.result_bytes, Buffer.byteLength(message, "utf8"));
    const resultFile = path.join(agents, `${session}.${launchId}.claude-result.json`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    assert.deepEqual(result, {
      schema: "aiterm.claude-turn-result.v2",
      operation_id: null,
      vendor_session_id: "claude-session-1",
      result_digest: event.result_digest,
      result_bytes: Buffer.byteLength(message, "utf8"),
      text: message,
    });
    // POSIX permission bit の断言は Windows 非適用（fs.Stats.mode が 0o666 を返すため）。
    // 製品側 posixModeUnsafe() と同じ受容。本文分離と event 相関の断言は両 OS で走る。
    if (!isWin) assert.equal(fs.statSync(resultFile).mode & 0o077, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("claude-stop-hook: secure markerのoperation_idをresultとeventへ同一相関し消費する", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-claude-operation-");
  const session = "claudeoperation";
  const launchId = "11112222333344445555666677778888";
  const operationId = `sha256:${"a".repeat(64)}`;
  const markerFile = path.join(agents, `${session}.${launchId}.claude-operation.json`);
  fs.writeFileSync(markerFile, JSON.stringify({
    schema: "aiterm.claude-operation-marker.v1",
    operation_id: operationId,
  }) + "\n", { mode: 0o600 });
  const r = spawnClaudeHook(tmp, {
    AITERM_AGENT_KIND: "claude",
    AITERM_SESSION_ID: session,
    AITERM_AGENT_LAUNCH_ID: launchId,
  }, {
    session_id: "claude-session-operation",
    hook_event_name: "Stop",
    last_assistant_message: "operation-correlated answer",
  });

  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const event = JSON.parse(fs.readFileSync(path.join(agents, `${session}.${launchId}.events.jsonl`), "utf8").trim());
    const result = JSON.parse(fs.readFileSync(path.join(agents, `${session}.${launchId}.claude-result.json`), "utf8"));
    assert.equal(event.operation_id, operationId);
    assert.equal(result.operation_id, operationId);
    assert.equal(result.schema, "aiterm.claude-turn-result.v2");
    assert.equal(fs.existsSync(markerFile), false, "完了記録後はmarkerを消費する");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("claude-stop-hook: malformed operation markerを帰属なし完了へ降格しない", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-claude-bad-operation-");
  const session = "claudebadoperation";
  const launchId = "99998888777766665555444433332222";
  const markerFile = path.join(agents, `${session}.${launchId}.claude-operation.json`);
  fs.writeFileSync(markerFile, JSON.stringify({
    schema: "aiterm.claude-operation-marker.v1",
    operation_id: "sha256:not-a-digest",
  }) + "\n", { mode: 0o600 });
  const r = spawnClaudeHook(tmp, {
    AITERM_AGENT_KIND: "claude",
    AITERM_SESSION_ID: session,
    AITERM_AGENT_LAUNCH_ID: launchId,
  }, {
    session_id: "claude-session-bad-operation",
    hook_event_name: "Stop",
    last_assistant_message: "must not be attributed",
  });

  try {
    assert.equal(r.status, 0);
    assert.match(r.stderr, /operation marker/);
    assert.equal(fs.existsSync(path.join(agents, `${session}.${launchId}.events.jsonl`)), false);
    assert.equal(fs.existsSync(path.join(agents, `${session}.${launchId}.claude-result.json`)), false);
    assert.equal(fs.existsSync(markerFile), true, "診断可能なままmarkerを残す");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("claude-stop-hook: 不完全payloadと上限超過本文を完了eventへ昇格しない", { skip: undefined }, () => {
  for (const [label, payload, expected] of [
    ["missing-result", { session_id: "claude-session-1", hook_event_name: "Stop" }, /last_assistant_message/],
    [
      "oversized-result",
      { session_id: "claude-session-1", hook_event_name: "Stop", last_assistant_message: "x".repeat(4 * 1024 * 1024 + 1) },
      /bytesを超えています/,
    ],
  ]) {
    const { tmp, agents } = makeHookState(`aiterm-claude-${label}-`);
    const session = `claude_${label.replaceAll("-", "_")}`;
    const launchId = "01230123012301230123012301230123";
    try {
      const r = spawnClaudeHook(tmp, {
        AITERM_AGENT_KIND: "claude",
        AITERM_SESSION_ID: session,
        AITERM_AGENT_LAUNCH_ID: launchId,
      }, payload);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, expected);
      assert.equal(fs.existsSync(path.join(agents, `${session}.${launchId}.events.jsonl`)), false);
      assert.equal(fs.existsSync(path.join(agents, `${session}.${launchId}.claude-result.json`)), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("claude-stop-hook: 既存result symlinkを辿らず原子的に置換する", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-claude-result-link-");
  const session = "clauderesultlink";
  const launchId = "45674567456745674567456745674567";
  const resultFile = path.join(agents, `${session}.${launchId}.claude-result.json`);
  const victim = path.join(tmp, "victim.txt");
  fs.writeFileSync(victim, "unchanged", { mode: 0o600 });
  fs.symlinkSync(victim, resultFile);
  try {
    const r = spawnClaudeHook(tmp, {
      AITERM_AGENT_KIND: "claude",
      AITERM_SESSION_ID: session,
      AITERM_AGENT_LAUNCH_ID: launchId,
    }, {
      session_id: "claude-session-link",
      hook_event_name: "Stop",
      last_assistant_message: "safe result",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(fs.readFileSync(victim, "utf8"), "unchanged");
    assert.equal(fs.lstatSync(resultFile).isSymbolicLink(), false);
    assert.equal(JSON.parse(fs.readFileSync(resultFile, "utf8")).text, "safe result");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("managed stop hooks: aiterm env が全く無ければ state に触らず no-op", { skip: undefined }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-hook-noenv-"));
  try {
    const grok = spawnGrokHook(tmp, {}, { hookEventName: "stop" });
    assert.equal(grok.status, 0, grok.stderr);
    assert.equal(grok.stdout, "");
    assert.equal(grok.stderr, "");
    const claude = spawnClaudeHook(tmp, {}, { hook_event_name: "Stop", last_assistant_message: "secret" });
    assert.equal(claude.status, 0, claude.stderr);
    assert.equal(claude.stdout, "");
    assert.equal(claude.stderr, "");
    assert.equal(fs.existsSync(path.join(tmp, `aiterm-mcp-${testUid()}`)), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("grok-stop-hook: 存在しない XDG_RUNTIME_DIR は TMPDIR へ戻す", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-hook-bad-xdg-");
  const session = "badxdg";
  const launchId = "99999999999999999999999999999999";
  const r = spawnGrokHook(
    tmp,
    {
      XDG_RUNTIME_DIR: path.join(tmp, "missing-runtime-dir"),
      AITERM_AGENT_KIND: "grok",
      AITERM_SESSION_ID: session,
      AITERM_AGENT_LAUNCH_ID: launchId,
    },
    { hookEventName: "stop", sessionId: "grok-session", promptId: "prompt-1" },
  );
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "");
    const eventFile = path.join(agents, `${session}.${launchId}.events.jsonl`);
    assert.equal(fs.existsSync(eventFile), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// symlink/hard link の拒否は 2026-08-19 のオーナー裁定で撤去した（共有 /tmp に敵対的
// 同居主体がいる前提の防御で、対応 OS の per-user runtime dir では成立しない）。
// 一方「env で渡された任意 path へは書かず、session/launch から導出した path にだけ書く」は
// 撤去と無関係に成り立つ不変条件なので、こちらだけを固定する。
test("grok-stop-hook: env の任意 path を無視し導出 path にだけ書く", { skip: undefined }, () => {
  const { tmp, agents } = makeHookState("aiterm-grok-hook-envpath-");
  const session = "groklink";
  const launchId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const outsider = path.join(tmp, "outsider.jsonl");
  fs.writeFileSync(outsider, "");
  try {
    const r = spawnGrokHook(
      tmp,
      {
        AITERM_AGENT_KIND: "grok",
        AITERM_SESSION_ID: session,
        AITERM_AGENT_LAUNCH_ID: launchId,
        AITERM_AGENT_EVENT_FILE: outsider,
      },
      { hookEventName: "stop", sessionId: "grok-session", promptId: "prompt-1" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(fs.readFileSync(outsider, "utf8"), "", "env で指定された path へ書いてはいけない");
    const derived = path.join(agents, `${session}.${launchId}.events.jsonl`);
    const event = JSON.parse(fs.readFileSync(derived, "utf8").trim());
    assert.equal(event.type, "agent_done");
    assert.equal(event.aiterm_session, session);
    assert.equal(event.launch_id, launchId);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
