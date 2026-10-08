// pty_closeが、Claude Codeの席を止める前に、自分で終わる機会を与える（ADR 0100）。
// Windowsのpsmuxは、sessionを止める時に画面のprocessへ切断の合図を送らない。合図なしで止められたClaude Codeは、
// 会話終了のhook（SessionEnd）を走らせない。
// 鍵と待ちの順番は差し替えで確かめる。席を閉じる道へのつなぎは、鍵を受けて自分で終わる偽の席で確かめる
// （POSIXでは既定で使わない道なので、試験用の口で入れる。Windowsの実物は端末の実機試験で確かめる）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux = (process.platform === "win32" ? spawnSync("psmux", ["-V"]) : spawnSync("tmux", ["-V"])).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cex-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

// Claude Codeの終わり方をまねる偽の席。届いたC-cを1行ずつ記録する。
// - 動いている番（busy）の間のC-cは、番を止めて入力待ちの画面へ戻すだけ。
// - 入力待ちでのC-cは「Press Ctrl-C again to exit」を出し、1秒以内の次のC-cで、会話終了の印を書いて自分で終わる。
// - deaf: C-cを記録するだけで終わらない。
const seat = path.join(process.env.TMPDIR, "seat.mjs");
fs.writeFileSync(seat, [
  "import fs from 'node:fs';",
  "const [log, mode] = process.argv.slice(2);",
  "const note = line => fs.appendFileSync(log, `${Date.now()} ${line}\\n`);",
  "let busy = mode === 'busy';",
  "process.stdout.write(busy ? 'Claude Code\\n● working\\n✻ Musing… (esc to interrupt)\\n' : 'Claude Code\\n❯ ready\\n');",
  // 実物と同じく、動作中の行をその場で描き直して入力欄へ戻す（画面を流さない）。
  "const idle = () => process.stdout.write('\\x1b[1A\\x1b[2K❯ ready\\n');",
  "if (process.stdin.isTTY) process.stdin.setRawMode(true);",
  "let armed = 0;",
  "process.stdin.on('data', chunk => { for (const byte of chunk) {",
  "  if (byte !== 3) { note(`byte ${byte}`); continue; }",
  "  note('C-c');",
  "  if (mode === 'deaf') continue;",
  "  if (busy) { busy = false; idle(); continue; }",
  "  if (Date.now() - armed <= 1000) { note('SessionEnd'); process.exit(0); }",
  "  armed = Date.now();",
  "  process.stdout.write('  Press Ctrl-C again to exit\\n');",
  "} });",
  "process.on('SIGHUP', () => { note('SIGHUP'); process.exit(0); });",
  "setInterval(() => {}, 60000);",
  "",
].join("\n"));
const seatLog = (name) => path.join(process.env.TMPDIR, `${name}.log`);
function fakeClaude(name, mode) {
  const bin = path.join(process.env.TMPDIR, `claude-${name}.sh`);
  // execしない。起動した実行ファイル（このscript）が席のprocessとして残り、harnessとして見分けられる。
  fs.writeFileSync(bin, [
    "#!/bin/sh",
    "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
    "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
    "  exit 0",
    "fi",
    `'${process.execPath}' '${seat}' '${seatLog(name)}' '${mode}'`,
    "",
  ].join("\n"), { mode: 0o700 });
  fs.chmodSync(bin, 0o700);
  return bin;
}
const events = (name) => {
  try { return fs.readFileSync(seatLog(name), "utf8").split("\n").filter(Boolean).map(line => line.replace(/^\d+ /, "")); }
  catch { return []; }
};
/** 止められた席が切断の合図（SIGHUP）を記録するまで待つ。席のprocessが書くので、閉じた直後にはまだ無い事がある（混んだmacOSで0.3秒を超えた）。 */
async function eventsAfterHangup(name) {
  for (let waited = 0; waited < 5000 && !events(name).includes("SIGHUP"); waited += 50) await sleep(50);
  return events(name);
}

const core = await import(new URL("../dist/core.js", import.meta.url).href);
core.__testSetAgentTuiReadyStableSamples(1);
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "POSIX shell fixture" : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  core.__testSetClaudeExitBeforeClose(null);
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});

/** 時計と席の様子を差し替えて、送った鍵と待ちの並びを記録する。 */
function script({ idleAt = 0, exitAfterSecondKey = 600 } = {}) {
  let clock = 0, keys = 0, exitKeysAt = null;
  const log = [];
  return {
    log,
    steps: {
      idle: () => clock >= idleAt && (idleAt === 0 || keys >= 1),
      interrupt: () => { keys++; log.push(`C-c@${clock}`); if (log.filter(item => item.startsWith("C-c")).length === (idleAt === 0 ? 2 : 3)) exitKeysAt = clock; },
      alive: () => exitAfterSecondKey === null || exitKeysAt === null || clock < exitKeysAt + exitAfterSecondKey,
      pause: (ms) => { clock += ms; },
      now: () => clock,
    },
    clock: () => clock,
  };
}

test("入力待ちの席へは、C-cを間を空けずに2回送り、processが終わるのを待つ", () => {
  const seat = script({ exitAfterSecondKey: 600 });
  assert.equal(core.requestClaudeExit(seat.steps), "exited");
  // 終了の受付は短い（実物では間2.2秒の2回は切れた）。2回の間は200ms。
  assert.deepEqual(seat.log, ["C-c@0", "C-c@200"]);
  assert.equal(seat.clock(), 800, "終わった所で待ちをやめる");
});

test("動いている席へは、先にC-cを1回送って入力待ちに戻るのを待ち、その後に2回送る", () => {
  // 1回目のC-cは番を止めるのに使われ、終了の受付にならない。700ms後に入力待ちへ戻る席。
  const seat = script({ idleAt: 700, exitAfterSecondKey: 1000 });
  assert.equal(core.requestClaudeExit(seat.steps), "exited");
  assert.deepEqual(seat.log, ["C-c@0", "C-c@700", "C-c@900"]);
});

test("入力待ちに戻らない席でも、上限まで待ったら2回送り、終わらなければ終わらないと返す", () => {
  const seat = script({ idleAt: Infinity, exitAfterSecondKey: null });
  assert.equal(core.requestClaudeExit(seat.steps), "still_running");
  // 止まるのを待つ上限は1.5秒、終わるのを待つ上限は4秒。合わせて5.7秒で止める方へ進む。
  assert.deepEqual(seat.log, ["C-c@0", "C-c@1500", "C-c@1700"]);
  assert.equal(seat.clock(), 5700);
});

test("席を閉じる時、Claude Codeは止められる前に自分で終わる（入力待ちの席）", { skip }, async () => {
  process.env.CLAUDE_BIN = fakeClaude("idle", "idle");
  core.__testSetClaudeExitBeforeClose(true);
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    for (let waited = 0; waited < 8000 && core.observeSession(sid).state !== "idle"; waited += 100) await sleep(100);
    assert.equal(core.observeSession(sid).state, "idle");
    assert.deepEqual(core.closeSessionResult(sid), { schema: "aiterm.pty-close-result.v1", session_id: sid, outcome: "closed" });
    // 切断の合図（SIGHUP）より前に、鍵で終わっている。
    assert.deepEqual(events("idle"), ["C-c", "C-c", "SessionEnd"]);
    assert.equal(core.observeSession(sid).exists, false);
  } finally { core.__testSetClaudeExitBeforeClose(null); try { core.closeSession(sid); } catch { /* noop */ } }
});

test("動いている番の席も、番を止めてから自分で終わる", { skip }, async () => {
  process.env.CLAUDE_BIN = fakeClaude("busy", "busy");
  core.__testSetClaudeExitBeforeClose(true);
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    for (let waited = 0; waited < 8000 && core.observeSession(sid).state !== "busy"; waited += 100) await sleep(100);
    assert.equal(core.observeSession(sid).state, "busy");
    const started = Date.now();
    assert.equal(core.closeSessionResult(sid).outcome, "closed");
    assert.deepEqual(events("busy"), ["C-c", "C-c", "C-c", "SessionEnd"]);
    assert.ok(Date.now() - started < 1400, "入力待ちに戻ったのを見て、上限（1.5秒）を待たずに進む");
  } finally { core.__testSetClaudeExitBeforeClose(null); try { core.closeSession(sid); } catch { /* noop */ } }
});

test("鍵で終わらない席は、待った後に今までどおり止める", { skip }, async () => {
  process.env.CLAUDE_BIN = fakeClaude("deaf", "deaf");
  core.__testSetClaudeExitBeforeClose(true);
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    for (let waited = 0; waited < 8000 && core.observeSession(sid).state !== "idle"; waited += 100) await sleep(100);
    const started = Date.now();
    assert.equal(core.closeSessionResult(sid).outcome, "closed");
    const took = Date.now() - started;
    assert.ok(took >= 4000 && took < 8000, `終わるのを待つ上限（4秒）の後に止める: ${took}ms`);
    assert.equal(core.observeSession(sid).exists, false);
    assert.deepEqual(await eventsAfterHangup("deaf"), ["C-c", "C-c", "SIGHUP"]);
  } finally { core.__testSetClaudeExitBeforeClose(null); try { core.closeSession(sid); } catch { /* noop */ } }
});

test("既定では、POSIXの席へ鍵を送らない（tmuxが切断の合図を送る）", { skip }, async () => {
  process.env.CLAUDE_BIN = fakeClaude("posix", "idle");
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    for (let waited = 0; waited < 8000 && core.observeSession(sid).state !== "idle"; waited += 100) await sleep(100);
    const started = Date.now();
    assert.equal(core.closeSessionResult(sid).outcome, "closed");
    assert.ok(Date.now() - started < 1500, "待たずに閉じる");
    assert.deepEqual(await eventsAfterHangup("posix"), ["SIGHUP"]);
  } finally { try { core.closeSession(sid); } catch { /* noop */ } }
});

test("Claude Code以外の席と、普通の端末へは鍵を送らない", { skip }, async () => {
  core.__testSetClaudeExitBeforeClose(true);
  const [sid] = core.openSession(null, "bash");
  try {
    const started = Date.now();
    assert.equal(core.closeSessionResult(sid).outcome, "closed");
    assert.ok(Date.now() - started < 1500, "待たずに閉じる");
  } finally { core.__testSetClaudeExitBeforeClose(null); try { core.closeSession(sid); } catch { /* noop */ } }
});
