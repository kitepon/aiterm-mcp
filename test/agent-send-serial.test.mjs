// 同じagent sessionへの送信が重なった時の扱い（ADR 0088）。
// 後の1通は、前の1通が終わってから振り分け直す。偽の席と隔離socketで確かめる（core-agent.test.mjsと同じ方式）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux =
  (process.platform === "win32"
    ? spawnSync("psmux", ["-V"])
    : spawnSync("tmux", ["-V"])
  ).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-ser-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");
const fakeClaudeBin = path.join(process.env.TMPDIR, "fake-claude.sh");
fs.writeFileSync(
  fakeClaudeBin,
  [
    "#!/bin/sh",
    "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
    "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
    "  exit 0",
    "fi",
    "printf '%s ' \"$@\"",
    "printf '\\n'",
    "",
  ].join("\n"),
  { mode: 0o700 },
);
fs.chmodSync(fakeClaudeBin, 0o700);
// 入力受付の画面を出し、届いた行をそのまま返す偽Codex。
const fakeCodexBin = path.join(process.env.TMPDIR, "fake-codex-tui.sh");
fs.writeFileSync(
  fakeCodexBin,
  ["#!/bin/sh", "printf 'OpenAI Codex\\n› ready\\n'", "while IFS= read -r line; do", "  printf '%s\\n' \"$line\"", "done", ""].join("\n"),
  { mode: 0o700 },
);
fs.chmodSync(fakeCodexBin, 0o700);
const fakeCodexHome = path.join(process.env.TMPDIR, "fake-codex-home");
fs.mkdirSync(path.join(fakeCodexHome, "sessions"), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(fakeCodexHome, "auth.json"), "{}\n", { mode: 0o600 });
fs.writeFileSync(
  path.join(fakeCodexHome, "config.toml"),
  'model = "test-model"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[mcp_servers.test]\ncommand = "test"\n',
  { mode: 0o600 },
);
fs.writeFileSync(path.join(fakeCodexHome, "history.jsonl"), "{}\n", { mode: 0o600 });
process.env.CLAUDE_BIN = fakeClaudeBin;
process.env.CODEX_BIN = fakeCodexBin;
process.env.CODEX_HOME = fakeCodexHome;

const coreUrl = new URL("../dist/core.js", import.meta.url);
const core = await import(coreUrl.href);
core.__testSetAgentTuiReadyStableSamples(1);
const skip = hasTmux ? undefined : "tmux 未インストール";
const testUid = () => (typeof process.getuid === "function" ? process.getuid() : 0);
const agentStateDir = () => path.join(process.env.TMPDIR, `aiterm-mcp-${testUid()}`, "agents");
const socketDir = () => path.join(process.env.TMPDIR, "claude-tmux-sockets");
const sessionLogPath = (sid) => path.join(socketDir(), `${sid}.log`);
const agentSendLockPath = (sid) => path.join(socketDir(), `${sid}.agent-send.lock`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readAgentMeta(sid) {
  const metaFiles = fs.readdirSync(agentStateDir()).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
  assert.equal(metaFiles.length, 1);
  return JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFiles[0]), "utf8"));
}

function claudeMarkerPath(sid) {
  const meta = readAgentMeta(sid);
  return path.join(path.dirname(meta.event_file), `${sid}.${meta.launch_id}.claude-operation.json`);
}

async function markFakeClaudeReady(sid) {
  core.send(sid, "printf 'Claude Code\\n❯ ready\\n'", { force: true, raw: true, preserveAgentOperation: true });
  await core.readOutput(sid, { wait: true, until: "ready", timeout: 5, raw: true });
}

// 終了済みのprocessのpid。
function deadPid() {
  const done = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(done.status, 0);
  return done.pid;
}

function writeLock(file, pid) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ pid, at: new Date().toISOString(), token: "0".repeat(32) }) + "\n", { mode: 0o600 });
}

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  core.__testSetAgentSendLockWaitMs?.(null);
  if (hasTmux) {
    try {
      core.killAll();
    } catch {
      /* noop */
    }
  }
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

test("起動直後のClaudeへ2通が重なっても、後の1通は断られず差し込みで届く", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const sends = Promise.allSettled([
      core.sendAgentMessage(sid, "echo OVERLAP_ONE"),
      core.sendAgentMessage(sid, "echo OVERLAP_TWO"),
    ]);
    // 2通とも入力受付待ちへ入ってから、席を入力受付にする。
    await sleep(300);
    await markFakeClaudeReady(sid);
    const [first, second] = await sends;
    assert.equal(first.status, "fulfilled", first.reason?.message);
    assert.equal(second.status, "fulfilled", second.reason?.message);
    assert.equal(first.value.schema, "aiterm.agent-dispatch.v1");
    assert.equal(second.value.schema, "aiterm.agent-steer.v1");
    const out = await core.readOutput(sid, { wait: true, until: "OVERLAP_TWO", timeout: 5, raw: true, full: true });
    assert.match(out, /OVERLAP_ONE/);
    assert.match(out, /OVERLAP_TWO/);
    assert.ok(fs.existsSync(claudeMarkerPath(sid)), "turnの印は1通目のものが残る");
    assert.equal(fs.existsSync(agentSendLockPath(sid)), false, "送り終えたらlockを残さない");
  } finally {
    core.closeSession(sid);
  }
});

test("別のprocessから起動直後のClaudeへ2通が重なっても、どちらも断られない", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const script = path.join(process.env.TMPDIR, "send-one.mjs");
  fs.writeFileSync(script, [
    "const core = await import(process.argv[2]);",
    "core.__testSetAgentTuiReadyStableSamples(1);",
    "console.log('started');",
    "try {",
    "  const receipt = await core.sendAgentMessage(process.argv[3], process.argv[4]);",
    "  console.log(JSON.stringify({ ok: true, schema: receipt.schema }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ ok: false, message: error.message }));",
    "}",
    "",
  ].join("\n"));
  const run = (text) => {
    const child = spawn(process.execPath, [script, coreUrl.href, sid, text], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    return {
      started: async () => { while (!stdout.includes("started")) await sleep(20); },
      result: new Promise((resolve) => child.on("close", () => resolve(JSON.parse(stdout.trim().split("\n").at(-1))))),
    };
  };
  try {
    const one = run("echo PROCESS_ONE");
    const two = run("echo PROCESS_TWO");
    await Promise.all([one.started(), two.started()]);
    await sleep(500);
    await markFakeClaudeReady(sid);
    const results = await Promise.all([one.result, two.result]);
    assert.deepEqual(results.map((r) => r.ok), [true, true], JSON.stringify(results));
    // 別のprocessの間の順番は決めない。先に通った方が新しいturn、後の方が差し込みになる。
    assert.deepEqual(results.map((r) => r.schema).sort(), ["aiterm.agent-dispatch.v1", "aiterm.agent-steer.v1"]);
    const out = await core.readOutput(sid, { raw: true, full: true });
    assert.match(out, /PROCESS_ONE/);
    assert.match(out, /PROCESS_TWO/);
    assert.equal(fs.existsSync(agentSendLockPath(sid)), false);
  } finally {
    core.closeSession(sid);
    fs.rmSync(script, { force: true });
  }
});

test("入力受付のCodexへ2通が重なっても、1通ずつ別の行で届く", { skip }, async () => {
  const [sid] = core.openAgent("codex", { agent_done: true });
  try {
    const results = await Promise.allSettled([
      core.sendAgentMessage(sid, "CODEX_OVERLAP_ONE"),
      core.sendAgentMessage(sid, "CODEX_OVERLAP_TWO"),
    ]);
    for (const result of results) assert.equal(result.status, "fulfilled", result.reason?.message);
    await core.readOutput(sid, { wait: true, until: "CODEX_OVERLAP_TWO", timeout: 5, raw: true });
    const log = fs.readFileSync(sessionLogPath(sid), "utf8");
    assert.match(log, /CODEX_OVERLAP_ONE/);
    assert.match(log, /CODEX_OVERLAP_TWO/);
    const joined = log.split(/\r?\n/).filter((line) => line.includes("CODEX_OVERLAP_ONE") && line.includes("CODEX_OVERLAP_TWO"));
    assert.deepEqual(joined, [], "2通が1行につながって届いていない");
  } finally {
    core.closeSession(sid);
  }
});

test("起動時promptの準備中に届いた1通は、起動時promptを送り終えてから差し込みで届く", { skip }, async () => {
  // 1秒後に入力受付になり、届いた行をそのまま返す偽Claude。
  const slowClaudeBin = path.join(process.env.TMPDIR, "fake-claude-slow.sh");
  fs.writeFileSync(
    slowClaudeBin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
      "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
      "  exit 0",
      "fi",
      "sleep 1",
      "printf 'Claude Code\\n❯ ready\\n'",
      "while IFS= read -r line; do",
      "  printf '%s\\n' \"$line\"",
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  fs.chmodSync(slowClaudeBin, 0o700);
  process.env.CLAUDE_BIN = slowClaudeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const [initial, follow] = await Promise.allSettled([
      core.sendInitialAgentPrompt(sid, "INITIAL_BODY"),
      core.sendAgentMessage(sid, "FOLLOW_BODY"),
    ]);
    assert.equal(initial.status, "fulfilled", initial.reason?.message);
    assert.equal(follow.status, "fulfilled", follow.reason?.message);
    assert.match(initial.value.text, /initial_prompt=pending/);
    assert.equal(follow.value.schema, "aiterm.agent-steer.v1");
    const out = await core.readOutput(sid, { wait: true, until: "FOLLOW_BODY", timeout: 5, raw: true, full: true });
    assert.ok(out.indexOf("INITIAL_BODY") >= 0 && out.indexOf("INITIAL_BODY") < out.lastIndexOf("FOLLOW_BODY"), out);
  } finally {
    process.env.CLAUDE_BIN = fakeClaudeBin;
    core.closeSession(sid);
    fs.rmSync(slowClaudeBin, { force: true });
  }
});

test("持ち主が終了したlockは片付けて送る", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await markFakeClaudeReady(sid);
    writeLock(agentSendLockPath(sid), deadPid());
    const receipt = await core.sendAgentMessage(sid, "echo AFTER_DEAD_OWNER");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
    assert.equal(fs.existsSync(agentSendLockPath(sid)), false);
    assert.equal(fs.existsSync(`${agentSendLockPath(sid)}.reap`), false);
  } finally {
    core.closeSession(sid);
  }
});

test("別のprocessが送信中のまま待つ上限を越えたら、打たずに断る。sessionは閉じられる", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    core.__testSetAgentSendLockWaitMs(400);
    await markFakeClaudeReady(sid);
    writeLock(agentSendLockPath(sid), owner.pid);
    const started = performance.now();
    await assert.rejects(
      () => core.sendAgentMessage(sid, "echo MUST_NOT_ARRIVE"),
      // 先頭と「文字列は送信していません。」は、連携元（BellTeam）が未送信の断りを見分けるのに使う。
      (e) => e.code === 2 && e.message.startsWith(`AGENT_SEND_BUSY: agent session '${sid}' は別プロセス（pid ${owner.pid}）`)
        && e.message.includes("文字列は送信していません。"),
    );
    assert.ok(performance.now() - started >= 400, "上限まで待つ");
    assert.doesNotMatch(fs.readFileSync(sessionLogPath(sid), "utf8"), /MUST_NOT_ARRIVE/);
    assert.equal(fs.existsSync(claudeMarkerPath(sid)), false, "断った1通はturnの印を取らない");
    core.closeSession(sid);
    assert.ok(fs.existsSync(agentSendLockPath(sid)), "生きた持ち主のlockは閉じても残す");
  } finally {
    core.__testSetAgentSendLockWaitMs?.(null);
    owner.kill();
    fs.rmSync(agentSendLockPath(sid), { force: true });
    try { core.closeSession(sid); } catch { /* 閉じ済み */ }
  }
});

test("同じprocessの前の1通が上限を越えて続く時も、後の1通は打たずに断り、その次の1通は順番を保つ", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    core.__testSetAgentSendLockWaitMs(400);
    // 1通目は入力受付待ちで止まる。2通目は上限で断る。3通目は1通目の後で通る。
    const first = core.sendAgentMessage(sid, "echo QUEUE_ONE");
    const second = core.sendAgentMessage(sid, "echo QUEUE_TWO");
    await assert.rejects(
      () => second,
      (e) => e.code === 2 && e.message.startsWith(`AGENT_SEND_BUSY: agent session '${sid}' は先に受け付けた送信`)
        && e.message.includes("文字列は送信していません。"),
    );
    core.__testSetAgentSendLockWaitMs(null);
    const third = core.sendAgentMessage(sid, "echo QUEUE_THREE");
    await markFakeClaudeReady(sid);
    assert.equal((await first).schema, "aiterm.agent-dispatch.v1");
    assert.equal((await third).schema, "aiterm.agent-steer.v1");
    const out = await core.readOutput(sid, { wait: true, until: "QUEUE_THREE", timeout: 5, raw: true, full: true });
    assert.doesNotMatch(out, /QUEUE_TWO/);
  } finally {
    core.__testSetAgentSendLockWaitMs?.(null);
    core.closeSession(sid);
  }
});

test("送信が入力受付待ちの間もsessionは閉じられ、その送信は打たずに終わってlockを外す", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const sending = core.dispatchAgentTurn(sid, "echo MUST_NOT_ARRIVE", { ready_timeout: 3000 });
    const settled = sending.then(() => null, (error) => error);
    await sleep(300);
    assert.ok(fs.existsSync(agentSendLockPath(sid)), "入力受付待ちの間はlockを持つ");
    core.closeSession(sid);
    assert.ok(fs.existsSync(agentSendLockPath(sid)), "閉じる側は、続いている送信のlockを消さない");
    const error = await settled;
    assert.ok(error instanceof Error, "閉じられたsessionへは送れない");
    assert.equal(fs.existsSync(agentSendLockPath(sid)), false, "終わった送信は自分のlockを外す");
  } finally {
    try { core.closeSession(sid); } catch { /* 閉じ済み */ }
  }
});

test("片付けの途中で残った印は自動で消さず、pty_closeで片付く", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const lock = agentSendLockPath(sid);
  try {
    await markFakeClaudeReady(sid);
    writeLock(lock, deadPid());
    writeLock(`${lock}.reap`, deadPid());
    await assert.rejects(
      () => core.sendAgentMessage(sid, "echo MUST_NOT_ARRIVE"),
      (e) => e.code === 2 && /pty_close/.test(e.message) && /文字列は送信していません/.test(e.message),
    );
    assert.doesNotMatch(fs.readFileSync(sessionLogPath(sid), "utf8"), /MUST_NOT_ARRIVE/);
    assert.ok(fs.existsSync(lock));
    core.closeSession(sid);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.existsSync(`${lock}.reap`), false);
  } finally {
    try { core.closeSession(sid); } catch { /* 閉じ済み */ }
  }
});

// psmuxのsessionはsocketの置き場と別に生き、置き場のfileは使用中で消せない。lockの層の判断はOSに依らないので、POSIXで確かめる。
const skipMissingSocketDir = process.platform === "win32" ? "Windowsはsocketの置き場を消してもsessionが残る" : skip;

test("socketの置き場が無くなった席への送信は、lockの作成失敗でなく、今まで通りの未送信の断りを返す", { skip: skipMissingSocketDir }, async () => {
  // 置き場を消すので、別の保存場所を持つprocessで確かめる。
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR, "gone-"));
  const script = path.join(root, "send-after-socket-dir-gone.mjs");
  fs.writeFileSync(script, [
    'import { spawnSync } from "node:child_process";',
    'import * as fs from "node:fs";',
    'import * as path from "node:path";',
    "const core = await import(process.argv[2]);",
    "core.__testSetAgentTuiReadyStableSamples(1);",
    'const socketDir = path.join(process.env.TMPDIR, "claude-tmux-sockets");',
    'const [sid] = core.openAgent("claude", { agent_done: true });',
    'spawnSync("tmux", ["-S", path.join(socketDir, "claude.sock"), "kill-server"]);',
    "fs.rmSync(socketDir, { recursive: true, force: true });",
    "let message = null;",
    // 入力受付待ちを待たずに結果を得る。lockの層はsendAgentMessageと同じ。
    'try { await core.dispatchAgentTurn(sid, "echo MUST_NOT_ARRIVE", { ready_timeout: 0 }); } catch (error) { message = error.message; }',
    "console.log(JSON.stringify({ message, socket_dir: fs.existsSync(socketDir) }));",
    "",
  ].join("\n"));
  try {
    const child = spawnSync(process.execPath, [script, coreUrl.href], {
      env: { ...process.env, TMPDIR: root, XDG_RUNTIME_DIR: root }, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.match(result.message, /入力受付状態になりません。文字列は送信していません。/);
    assert.doesNotMatch(result.message, /ENOENT|agent-send\.lock/);
    assert.equal(result.socket_dir, false, "送れなかった送信が置き場を作り直さない");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
