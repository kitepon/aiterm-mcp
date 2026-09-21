// aiterm-wait（純リーダー観測）の回帰テスト。tmux 不要・fake state root で完結する。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 製品側 currentUid()（src/core.ts）と同じ規則。Windows(native) は getuid を持たず、
// fs.Stats.uid が常に 0 のため 0 を返す＝stateRoot() のパス組み立てと一致する。
// これを getuid の有無で test 自体を止める述語に使わない（Windows 覆域が消えるため）。
const testUid = () => (typeof process.getuid === "function" ? process.getuid() : 0);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "aiterm-wait-cli.js");

const LAUNCH = "0123456789abcdef0123456789abcdef";
const VENDOR_SESSION = "11111111-2222-4333-8444-555555555555";
const OPID = `sha256:${"ab".repeat(32)}`;
const OPID2 = `sha256:${"cd".repeat(32)}`;

function makeStateRoot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-wait-"));
  const root = path.join(base, `aiterm-mcp-${testUid()}`);
  const agents = path.join(root, "agents");
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(agents, { mode: 0o700 });
  return { base, root, agents };
}

function writeMeta(agents, name, kind, extra = {}) {
  const common = {
    kind,
    aiterm_session: name,
    launch_id: LAUNCH,
    event_file: path.join(agents, `${name}.${LAUNCH}.events.jsonl`),
    created_at: new Date().toISOString(),
    cwd: null,
    vendor_session_id: VENDOR_SESSION,
    initial_prompt: "done",
    agent_role: "subagent",
    parent_session_id: "host-root",
    delegation_depth: 1,
    lineage: `host-root>${kind}:${name}`,
    delegation_allowed: true,
    node_platform: process.platform,
  };
  const byKind =
    kind === "claude"
      ? {
          hook_route: "shared_claude_settings",
          claude_settings: path.join(agents, `${name}.${LAUNCH}.claude-settings.json`),
          result_file: path.join(agents, `${name}.${LAUNCH}.claude-result.json`),
          launch_operation_id: null,
          launch_request_digest: null,
        }
      : {
          hook_route: "shared_codex_home",
          completion_route: "codex_transcript",
          codex_home: process.env.CODEX_HOME,
        };
  const metaPath = path.join(agents, `${name}.${LAUNCH}.agent.json`);
  fs.writeFileSync(metaPath, JSON.stringify({ ...common, ...byKind, ...extra }), { mode: 0o600 });
  return { metaPath, eventPath: common.event_file };
}

function waitEvent(name, over = {}) {
  return (
    JSON.stringify({
      type: "agent_done",
      vendor: "claude",
      aiterm_session: name,
      launch_id: LAUNCH,
      vendor_session_id: VENDOR_SESSION,
      turn_id: "turn-1",
      operation_id: null,
      reason: "Stop",
      done_status: "turn_done",
      result_digest: "0".repeat(64),
      result_bytes: 0,
      at: "2026-07-18T00:00:00.000Z",
      ...over,
    }) + "\n"
  );
}

function claudeEvent(name, over = {}) {
  return (
    JSON.stringify({
      type: "agent_done",
      vendor: "claude",
      aiterm_session: name,
      launch_id: LAUNCH,
      vendor_session_id: VENDOR_SESSION,
      turn_id: null,
      operation_id: OPID,
      reason: "Stop",
      done_status: "turn_done",
      result_digest: "0".repeat(64),
      result_bytes: 12,
      at: "2026-07-18T00:00:00.000Z",
      ...over,
    }) + "\n"
  );
}

async function withStateRoot(fn) {
  const { base, agents } = makeStateRoot();
  const prev = process.env.XDG_RUNTIME_DIR;
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.XDG_RUNTIME_DIR = base;
  process.env.CODEX_HOME = path.join(base, "codex-home");
  fs.mkdirSync(process.env.CODEX_HOME, { mode: 0o700 });
  try {
    return await fn(agents);
  } finally {
    if (prev === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prev;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const core = await import("../dist/core.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("observe: 待機後に届いたClaude eventでdone", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s1", "claude");
    const p = core.observeAgentDone("s1", { timeout: 5 });
    await sleep(250);
    fs.appendFileSync(eventPath, waitEvent("s1"));
    const r = await p;
    assert.equal(r.schema, "aiterm.agent-wait-result.v1");
    assert.equal(r.outcome, "done");
    assert.equal(r.vendor, "claude");
    assert.equal(r.harness, "claude-code");
    assert.equal(r.turn_id, "turn-1");
    assert.equal(r.vendor_session_id, VENDOR_SESSION);
    assert.equal(r.launch_id, LAUNCH);
  });
});

test("observe: 起動前のstale eventは境界の外＝running", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s2", "claude");
    fs.appendFileSync(eventPath, waitEvent("s2"));
    const r = await core.observeAgentDone("s2", { timeout: 0 });
    assert.equal(r.outcome, "running");
    assert.equal(r.turn_id, null);
  });
});

test("observe: 他launch・他vendor・他sessionのeventは無視", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s3", "claude");
    const p = core.observeAgentDone("s3", { timeout: 1 });
    await sleep(100);
    fs.appendFileSync(eventPath, waitEvent("s3", { launch_id: "f".repeat(32) }));
    fs.appendFileSync(eventPath, waitEvent("s3", { vendor: "grok" }));
    fs.appendFileSync(eventPath, waitEvent("s3", { aiterm_session: "other" }));
    const r = await p;
    assert.equal(r.outcome, "timeout");
  });
});

test("observe: malformed lineはカウントして待機継続", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s4", "claude");
    const p = core.observeAgentDone("s4", { timeout: 5 });
    await sleep(100);
    fs.appendFileSync(eventPath, "{not json\n");
    await sleep(250);
    fs.appendFileSync(eventPath, waitEvent("s4"));
    const r = await p;
    assert.equal(r.outcome, "done");
    assert.equal(r.malformed_events, 1);
  });
});

test("observe: claude operation相関はwaiter起動より前のeventも回収できる", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s5", "claude");
    fs.appendFileSync(eventPath, claudeEvent("s5"));
    const r = await core.observeAgentDone("s5", { operation_id: OPID, timeout: 5 });
    assert.equal(r.outcome, "done");
    assert.equal(r.operation_id, OPID);
    assert.equal(r.vendor_session_id, VENDOR_SESSION);
  });
});

test("observe: 別operation_idのeventは回収しない（誤帰属拒否）", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s6", "claude");
    fs.appendFileSync(eventPath, claudeEvent("s6", { operation_id: OPID2 }));
    const r = await core.observeAgentDone("s6", { operation_id: OPID, timeout: 0 });
    assert.equal(r.outcome, "running");
    assert.equal(r.operation_id, OPID);
  });
});

test("observe: 待機中のsession closeはoutcome=closed", async () => {
  await withStateRoot(async (agents) => {
    const { metaPath, eventPath } = writeMeta(agents, "s7", "claude");
    const p = core.observeAgentDone("s7", { timeout: 10 });
    await sleep(250);
    fs.rmSync(eventPath, { force: true });
    fs.rmSync(metaPath, { force: true });
    const r = await p;
    assert.equal(r.outcome, "closed");
  });
});

test("observe: 非Claudeへのoperation_id指定は拒否", async () => {
  await withStateRoot(async (agents) => {
    writeMeta(agents, "s8", "codex");
    await assert.rejects(
      () => core.observeAgentDone("s8", { operation_id: OPID, timeout: 0 }),
      /Claude agent session/,
    );
  });
});

test("observe: 既知vendor_session_idと違うeventは非該当として無視", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s9", "claude");
    const p = core.observeAgentDone("s9", { timeout: 5 });
    await sleep(100);
    fs.appendFileSync(eventPath, waitEvent("s9", { vendor_session_id: "vs-a" }) + waitEvent("s9", { vendor_session_id: "vs-b" }));
    assert.equal((await p).outcome, "timeout");
  });
});

test("observe: 純リーダー＝wait.lockを作らず・既存lockとも競合しない", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s10", "claude");
    const lockPath = path.join(agents, `s10.${LAUNCH}.wait.lock`);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
    const p = core.observeAgentDone("s10", { timeout: 5 });
    await sleep(250);
    fs.appendFileSync(eventPath, waitEvent("s10"));
    const r = await p;
    assert.equal(r.outcome, "done");
    assert.equal(fs.readFileSync(lockPath, "utf8").includes(`${process.pid}`), true, "既存lockは無傷");
    const locks = fs.readdirSync(agents).filter((f) => f.endsWith(".wait.lock"));
    assert.deepEqual(locks, [`s10.${LAUNCH}.wait.lock`], "waiterが新しいlockを作っていない");
  });
});

test("observe: metadata書き戻しをしない（vendor_session_id bindを永続化しない）", async () => {
  await withStateRoot(async (agents) => {
    const { metaPath, eventPath } = writeMeta(agents, "s11", "claude");
    const before = fs.readFileSync(metaPath, "utf8");
    const p = core.observeAgentDone("s11", { timeout: 5 });
    await sleep(250);
    fs.appendFileSync(eventPath, waitEvent("s11"));
    await p;
    assert.equal(fs.readFileSync(metaPath, "utf8"), before);
  });
});

test("observe: cursor指定はwaiter起動より前のeventも境界から回収する", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s12", "claude");
    fs.appendFileSync(eventPath, waitEvent("s12", { turn_id: "old-turn" }));
    const boundary = fs.statSync(eventPath).size;
    fs.appendFileSync(eventPath, waitEvent("s12", { turn_id: "new-turn" }));
    const r = await core.observeAgentDone("s12", { cursor: boundary, timeout: 5 });
    assert.equal(r.outcome, "done");
    assert.equal(r.turn_id, "new-turn", "cursor以降のeventだけを見る");
  });
});

test("observe: cursor境界より前のeventは不可視", async () => {
  await withStateRoot(async (agents) => {
    const { eventPath } = writeMeta(agents, "s13", "claude");
    fs.appendFileSync(eventPath, waitEvent("s13"));
    const boundary = fs.statSync(eventPath).size;
    const r = await core.observeAgentDone("s13", { cursor: boundary, timeout: 0 });
    assert.equal(r.outcome, "running");
  });
});

test("observe: 不正cursorは拒否", async () => {
  await withStateRoot(async (agents) => {
    writeMeta(agents, "s14", "claude");
    await assert.rejects(() => core.observeAgentDone("s14", { cursor: -1, timeout: 0 }), /cursor/);
    await assert.rejects(() => core.observeAgentDone("s14", { cursor: 1.5, timeout: 0 }), /cursor/);
  });
});

// ---- CLI black-box ----

function runCli(args, env) {
  // Windows native は TMPDIR を持たない。TEMP/TMP を渡さないと子の SOCKDIR が
  // os.tmpdir() へ落ち、親が書いた pane log と置き場がずれる。
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, XDG_RUNTIME_DIR: env, HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE, SYSTEMROOT: process.env.SYSTEMROOT,
    },
  });
}

test("cli: 完了済みclaude operationをreceiptで返しexit 0", async () => {
  const { base, agents } = makeStateRoot();
  try {
    const { eventPath } = writeMeta(agents, "c1", "claude");
    fs.appendFileSync(eventPath, claudeEvent("c1"));
    const r = runCli(["--session", "c1", "--operation", OPID, "--timeout", "5"], base);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.schema, "aiterm.agent-wait-result.v1");
    assert.equal(out.outcome, "done");
    assert.equal(out.harness, "claude-code");
    assert.equal(out.operation_id, OPID);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: timeoutはreceiptを出しつつexit 3（exit≠完了）", async () => {
  const { base, agents } = makeStateRoot();
  try {
    writeMeta(agents, "c2", "claude");
    const r = runCli(["--session", "c2", "--timeout", "1"], base);
    assert.equal(r.status, 3, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.outcome, "timeout");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// --timeout 0 は「待たずに一度だけ見る」照会。未完了は失敗ではなく running で、
// 待って終わらなかった timeout と1語に潰さない（潰すと親が異常と読んで様子見をやめる）。
test("cli: timeout 0の未完了はrunningでexit 5（timeoutと別語）", async () => {
  const { base, agents } = makeStateRoot();
  try {
    writeMeta(agents, "c8", "claude");
    const r = runCli(["--session", "c8", "--timeout", "0"], base);
    assert.equal(r.status, 5, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.outcome, "running");
    assert.equal(out.turn_id, null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: timeout 0でも完了済みならdoneでexit 0", async () => {
  const { base, agents } = makeStateRoot();
  try {
    const { eventPath } = writeMeta(agents, "c9", "claude");
    fs.appendFileSync(eventPath, waitEvent("c9"));
    const r = runCli(["--session", "c9", "--cursor", "0", "--timeout", "0"], base);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.outcome, "done");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// 照会経路でも「知らないsession」をrunningへ倒さない。倒すと打ち間違えたsession名が
// 永久に「まだ走ってる」と報告され、親が存在しない子を待ち続ける。
test("cli: timeout 0でも未知sessionはエラー（runningへ倒さない）", async () => {
  const { base } = makeStateRoot();
  try {
    const r = runCli(["--session", "nosuch", "--timeout", "0"], base);
    assert.equal(r.status, 1, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.ok, false);
    assert.notEqual(out.outcome, "running");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: exit codeは全outcomeで相異なる＝素通しでdoneに化けない", async () => {
  const codes = { done: 0, running: 5, timeout: 3, closed: 4 };
  assert.equal(new Set(Object.values(codes)).size, Object.keys(codes).length, "exit codeの重複なし");
  assert.ok(!Object.entries(codes).some(([k, v]) => k !== "done" && v === 0), "done以外に0を割り当てない");
});

test("cli: 待機中のsession closeはreceiptを出しつつexit 4", async () => {
  const { base, agents } = makeStateRoot();
  try {
    const { metaPath } = writeMeta(agents, "c5", "claude");
    const child = spawn(process.execPath, [CLI, "--session", "c5", "--timeout", "30"], {
      env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: base, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    await sleep(500);
    fs.rmSync(metaPath, { force: true });
    const status = await new Promise((res) => child.on("close", res));
    assert.equal(status, 4);
    const out = JSON.parse(stdout.trim());
    assert.equal(out.outcome, "closed");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: 待機中にeventが届くとexitして完了通知になる", async () => {
  const { base, agents } = makeStateRoot();
  try {
    const { eventPath } = writeMeta(agents, "c3", "claude");
    const child = spawn(process.execPath, [CLI, "--session", "c3", "--timeout", "30"], {
      env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: base, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    await sleep(500);
    fs.appendFileSync(eventPath, waitEvent("c3"));
    const status = await new Promise((res) => child.on("close", res));
    assert.equal(status, 0);
    const out = JSON.parse(stdout.trim());
    assert.equal(out.outcome, "done");
    assert.equal(out.turn_id, "turn-1");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: 不正引数はok:false envelopeでexit 1", () => {
  const { base } = makeStateRoot();
  try {
    for (const args of [[], ["--session"], ["--session", "x", "--operation", "bad"], ["--session", "x", "--timeout", "-1"], ["--unknown"]]) {
      const r = runCli(args, base);
      assert.equal(r.status, 1, JSON.stringify(args));
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.ok, false);
      assert.equal(out.code, "AITERM_WAIT_FAILED");
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: 未管理sessionはAitermErrorの文言つきでexit 1", () => {
  const { base } = makeStateRoot();
  try {
    const r = runCli(["--session", "nosuch", "--timeout", "0"], base);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.ok, false);
    assert.match(out.message, /agent_done 管理セッション/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: --cursor で境界指定して回収できる", async () => {
  const { base, agents } = makeStateRoot();
  try {
    const { eventPath } = writeMeta(agents, "c4", "claude");
    fs.appendFileSync(eventPath, waitEvent("c4", { turn_id: "old" }));
    const boundary = fs.statSync(eventPath).size;
    fs.appendFileSync(eventPath, waitEvent("c4", { turn_id: "target" }));
    const r = runCli(["--session", "c4", "--cursor", String(boundary), "--timeout", "5"], base);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.outcome, "done");
    assert.equal(out.turn_id, "target");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cli: 不正--cursorはexit 1", () => {
  const { base } = makeStateRoot();
  try {
    const r = runCli(["--session", "x", "--cursor", "-1"], base);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout.trim()).ok, false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- rate limit 検知（2026-08-22 実被弾: Grok weekly limit で waiter が沈黙/auth誤診）----

// 製品側 SOCKDIR（src/tmux-runtime.ts）と同じ規則。Windows native は TMPDIR を持たず
// TEMP→os.tmpdir() へ落ちるため、POSIX 前提で組むと pane log の置き場がずれてテストが落ちる。
const SOCKDIR_FOR_TEST = path.join(
  process.env.TMPDIR ?? (process.platform === "win32" ? process.env.TEMP ?? os.tmpdir() : "/tmp"),
  "claude-tmux-sockets",
);

function writePaneLog(name, text) {
  fs.mkdirSync(SOCKDIR_FOR_TEST, { recursive: true });
  const p = path.join(SOCKDIR_FOR_TEST, `${name}.log`);
  fs.writeFileSync(p, text);
  return p;
}

test("detectAgentRateLimit: Grokの過去logだけでは現在の上限にしない", () => {
  const name = `rl-unit-${process.pid}`;
  const log = writePaneLog(
    name,
    "\x1b[1m  You hit your weekly limit.\x1b[0m\n  You can continue by purchasing more credits.\n"
  );
  try {
    assert.equal(core.detectAgentRateLimit("grok", name), null);
    assert.equal(core.detectAgentRateLimit("composer", name), null);
    assert.equal(core.detectAgentRateLimit("codex", name), null);
  } finally {
    fs.rmSync(log, { force: true });
  }
});

test("detectAgentRateLimit: バナー無し・log無しは null（誤検知しない）", () => {
  const name = `rl-none-${process.pid}`;
  assert.equal(core.detectAgentRateLimit("grok", name), null);
  const log = writePaneLog(name, "normal output\nWeekly limit left: 42%\n");
  try {
    assert.equal(core.detectAgentRateLimit("grok", name), null);
  } finally {
    fs.rmSync(log, { force: true });
  }
});

test("cli: Grok auth不在と過去上限logは認証エラーを維持する", async () => {
  await withStateRoot(async (agents) => {
    const name = "rl-authgone";
    const grokHome = path.join(path.dirname(agents), "grok-home-empty");
    fs.mkdirSync(grokHome, { mode: 0o700 });
    writeMeta(agents, name, "grok", {
      hook_route: "shared_grok_home",
      completion_route: "grok_transcript",
      grok_home: grokHome,
      grok_auth_path: path.join(grokHome, "auth.json"),
    });
    const log = writePaneLog(name, "  You hit your weekly limit.\n");
    try {
      const res = runCli(["--session", name, "--timeout", "0"], path.dirname(path.dirname(agents)));
      const body = JSON.parse(res.stdout.trim().split("\n").pop());
      assert.equal(res.status, 1);
      assert.equal(body.code, "AITERM_WAIT_FAILED");
      assert.match(body.message, /Grok 認証正本/);
    } finally {
      fs.rmSync(log, { force: true });
    }
  });
});
