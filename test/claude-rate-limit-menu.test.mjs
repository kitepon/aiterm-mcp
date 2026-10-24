// 利用枠に当たったClaude Codeが入力欄の代わりに出す選ぶ画面（/rate-limit-options）へ、文を打たない（ADR 0117）。
// 選ぶ画面は貼り付けを捨ててEnterで選択中の行を選ぶので、そのまま送ると文は会話へ入らない（実被弾 2026-10-13）。
// 画面の読みは実物の画面で、送る前の扱いは偽の席が受けた生のbyteで確かめる（agent-preface.test.mjsと同じ隔離socket方式）。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux = (process.platform === "win32" ? spawnSync("psmux", ["-V"]) : spawnSync("tmux", ["-V"])).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-rlm-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

// 枠に当たった席の実画面（BellTeamコンテナ、Claude Code 2.1.296、2026-10-13 11:10。端末の記録から作り直した）。
const LIMITED = [
  "  ⎿  You've hit your weekly limit · resets Oct 16, 8am (UTC)",
  "     Use your limit reset to reset it now: clau.de/reset",
  "",
  "✻ Sautéed for 5m 54s · done 2:10 AM",
  "",
  "❯ /rate-limit-options",
  "",
  "────────────────────────────────────────────────────────────────────────────────",
  "  What do you want to do?",
  "",
  "  ❯ 1. Stop and wait for limit to reset",
  "    2. Wait here, then continue automatically at Oct 16, 8am",
  "    3. Switch to usage credits",
  "    4. Upgrade your plan",
  "",
  "  Enter to confirm · Esc to cancel",
  "",
].join("\n");
// 枠に当たっていない時に手で開いた実画面（同じ版、2026-10-13 11:38）。2の行が無く、別払いが2番になる。
const NOT_LIMITED = [
  " ▐▛███▛█   Claude Code v2.1.296",
  "▝▜██████▀  Haiku 5.5 · Claude Pro",
  " ▝▝   ▝▝   /tmp/rp-USY5xK/proj",
  "",
  "❯ /rate-limit-options",
  "",
  "────────────────────────────────────────────────────────────────────────────────",
  "  What do you want to do?",
  "",
  "  ❯ 1. Stop and wait for limit to reset",
  "    2. Switch to usage credits",
  "    3. Upgrade your plan",
  "",
  "  Enter to confirm · Esc to cancel",
].join("\n");
// 選ぶ画面を閉じた後の実画面。枠の文は会話欄に残り、入力欄と足元の行が戻る。
const CLOSED = [
  "  ⎿  You've hit your weekly limit · resets Oct 16, 8am (UTC)",
  "     Use your limit reset to reset it now: clau.de/reset",
  "",
  "✻ Sautéed for 5m 54s · done 2:10 AM",
  "",
  "────────────────────────────────────────────────────────────────────────────────",
  "❯ ",
  "────────────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents",
].join("\n");

// 送る前の扱いを確かめる偽の席。入力受付の画面を出した後、合図のfileが出来たら選ぶ画面を描き、届いたbyteを16進でfileへ足す。
// 合図の中身が closes なら、Esc（0x1b の1byte）で入力受付の画面へ戻る。stuck は戻らない。
const fake = path.join(process.env.TMPDIR, "menu-seat.mjs");
fs.writeFileSync(fake, [
  "import fs from 'node:fs';",
  "const [file, cue] = process.argv.slice(2);",
  "const ready = 'Claude Code\\n❯ ready\\n';",
  "const draw = (text) => process.stdout.write('\\x1b[2J\\x1b[H' + text);",
  "draw(ready);",
  "let mode = null;",
  "if (process.stdin.isTTY) process.stdin.setRawMode(true);",
  "process.stdin.on('data', (chunk) => {",
  "  fs.appendFileSync(file, chunk.toString('hex'));",
  "  if (mode === 'closes' && chunk.length === 1 && chunk[0] === 0x1b) { mode = 'closed'; draw(ready); }",
  "});",
  "setInterval(() => {",
  "  if (mode !== null || !fs.existsSync(cue)) return;",
  "  const [kind, ...screen] = fs.readFileSync(cue, 'utf8').split('\\n');",
  "  mode = kind;",
  "  draw('Claude Code\\n' + screen.join('\\n'));",
  "}, 20);",
  "",
].join("\n"));
const received = path.join(process.env.TMPDIR, "claude.hex");
const cue = path.join(process.env.TMPDIR, "claude.cue");
const bin = path.join(process.env.TMPDIR, "fake-claude.sh");
fs.writeFileSync(bin, [
  "#!/bin/sh",
  "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
  "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
  "  exit 0",
  "fi",
  // Keep the declared harness parent present for the ordinary-send live check.
  `'${process.execPath}' '${fake}' '${received}' '${cue}'`,
  "",
].join("\n"), { mode: 0o700 });
fs.chmodSync(bin, 0o700);
process.env.CLAUDE_BIN = bin;

const core = await import(new URL("../dist/core.js", import.meta.url).href);
core.__testSetAgentTuiReadyStableSamples(1);
// 生のbyteの並びはPOSIXのtmuxで確かめる。Windows（psmux＋ConPTY）は入力の制御列の通り方が違うので、実物の席の確かめに任せる。
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "生のbyteの並びはPOSIXで確かめる" : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PASTE = ["\x1b[200~", "\x1b[201~"];
const bytes = () => { try { return Buffer.from(fs.readFileSync(received, "utf8"), "hex").toString("utf8"); } catch { return ""; } };
async function waitBytes(endsWith) {
  for (let waited = 0; waited < 8000 && !bytes().endsWith(endsWith); waited += 50) await sleep(50);
  return bytes();
}
/** 席の今の画面。起動の途中で読めない間は空文字を返す。 */
async function screenOf(sid) {
  try { return await core.readOutput(sid, { screen: true, raw: true }); } catch { return ""; }
}
/** 席を起こし、入力受付の画面が出てから選ぶ画面を描かせて、画面に出るまで待つ（枠に当たるのは、動いていた席）。 */
async function seatWithMenu(kind, screen) {
  fs.rmSync(received, { force: true });
  fs.rmSync(cue, { force: true });
  const [sid] = core.openAgent("claude", { agent_done: true });
  for (let waited = 0; waited < 8000 && !(await screenOf(sid)).includes("❯ ready"); waited += 50) await sleep(50);
  fs.writeFileSync(cue, `${kind}\n${screen}`);
  for (let waited = 0; waited < 5000 && !(await screenOf(sid)).includes("Enter to confirm"); waited += 50) await sleep(50);
  assert.match(await screenOf(sid), /Enter to confirm · Esc to cancel/u, "偽の席が選ぶ画面を描いた");
  return sid;
}

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});
const claude = await import(new URL("../dist/harnesses/claude.js", import.meta.url).href);

// 試験の宣言は、上の await（dist の読み込み）が全部済んでから並べる。先に宣言した試験が走り終わると、後始末（killAll）が先に走る。
test("選ぶ画面の読み: 枠の最中の4行も、手で開いた3行も、利用枠の選ぶ画面と読む", () => {
  assert.deepEqual(claude.claudeLiveSelectMenu(LIMITED), { kind: "rate_limit_options", heading: "What do you want to do?" });
  assert.deepEqual(claude.claudeLiveSelectMenu(NOT_LIMITED), { kind: "rate_limit_options", heading: "What do you want to do?" });
  // 選択を2番へ動かした後も同じ（「❯」の付く行が替わるだけ）。
  const moved = NOT_LIMITED.replace("  ❯ 1. Stop", "    1. Stop").replace("    2. Switch", "  ❯ 2. Switch");
  assert.equal(claude.claudeLiveSelectMenu(moved)?.kind, "rate_limit_options");
  // 色の制御列が混ざっていても読む。
  assert.equal(claude.claudeLiveSelectMenu(LIMITED.replace("What do you", "\x1b[1mWhat do you"))?.kind, "rate_limit_options");
});

test("選ぶ画面の読み: 閉じた後の画面と、会話欄に同じ文が残った画面は、開いていると読まない", () => {
  assert.equal(claude.claudeLiveSelectMenu(CLOSED), null);
  // 選ぶ画面の文を写した会話（この件を調べている席の画面）。下に入力欄と足元の行が描かれる。
  const quoted = `${LIMITED}\n● 上の画面が出ていました。\n\n${CLOSED.split("\n").slice(5).join("\n")}`;
  assert.equal(claude.claudeLiveSelectMenu(quoted), null);
  // 案内の行だけがあって番号の行が無い物は、選ぶ画面と数えない。
  assert.equal(claude.claudeLiveSelectMenu("Claude Code\n  some text\n\n  Enter to confirm · Esc to cancel\n"), null);
  assert.equal(claude.claudeLiveSelectMenu(""), null);
});

test("選ぶ画面の読み: 見出しや1番の文が違う物は、見覚えの無い選ぶ画面と読む（閉じる相手にしない）", () => {
  const other = "Claude Code\n\n  Pick a theme\n\n  ❯ 1. Dark\n    2. Light\n\n  Enter to confirm · Esc to cancel\n";
  assert.deepEqual(claude.claudeLiveSelectMenu(other), { kind: "unknown", heading: "Pick a theme" });
  // 見出しが同じでも、止めて待つ行が無ければ利用枠の物と数えない。
  const reworded = LIMITED.replace("Stop and wait for limit to reset", "Do something else");
  assert.equal(claude.claudeLiveSelectMenu(reworded)?.kind, "unknown");
});

// ここから: 送る前の扱い。
test("利用枠の選ぶ画面が出ている席へは、Escで閉じてから文を入れる（Escの前には何も打たない）", { skip }, async () => {
  const sid = await seatWithMenu("closes", LIMITED);
  try {
    const receipt = await core.sendAgentMessage(sid, "枠が解けた後の文。");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
    assert.deepEqual(receipt.pane_input_recovery, ["claude_rate_limit_menu_closed"]);
    assert.equal(await waitBytes("\r"), `\x1b${PASTE[0]}枠が解けた後の文。${PASTE[1]}\r`);
  } finally { core.closeSession(sid); }
});

test("前置きつきの文も、Escで閉じた後に打つ（打鍵の前置きが選ぶ画面へ入らない）", { skip }, async () => {
  const sid = await seatWithMenu("closes", NOT_LIMITED);
  try {
    // 数字と j を含む前置き。選ぶ画面へ打鍵で入ると、2番（別払いへ切り替え）が選ばれる形。
    const preface = "通話2の返信です。justの確認。";
    await core.sendAgentMessage(sid, "本文。", { preface });
    assert.equal(await waitBytes("\r"), `\x1b${preface}${PASTE[0]}\n\n本文。${PASTE[1]}\r`);
  } finally { core.closeSession(sid); }
});

test("Escで閉じない時は、文を打たずに断る", { skip }, async () => {
  const sid = await seatWithMenu("stuck", LIMITED);
  try {
    await assert.rejects(core.sendAgentMessage(sid, "MUST_NOT_ARRIVE", { preface: "通話2の返信です。" }),
      /CLAUDE_RATE_LIMIT_MENU_NOT_CLOSED vendor=claude session=\S+\n.*文字列は送信していません。/u);
    await sleep(300);
    assert.equal(bytes(), "\x1b", "届いたのはEscの1byteだけ");
  } finally { core.closeSession(sid); }
});

test("見覚えの無い選ぶ画面が出ている席へは、1byteも打たずに断る", { skip }, async () => {
  const sid = await seatWithMenu("stuck", "\n  Pick a theme\n\n  ❯ 1. Dark\n    2. Light\n\n  Enter to confirm · Esc to cancel\n");
  try {
    await assert.rejects(core.sendAgentMessage(sid, "MUST_NOT_ARRIVE"),
      /CLAUDE_SELECT_MENU_OPEN vendor=claude session=\S+\n.*見出し: Pick a theme.*文字列は送信していません。/u);
    await sleep(300);
    assert.equal(fs.existsSync(received), false, "席には1byteも届いていない");
  } finally { core.closeSession(sid); }
});

test("選ぶ画面が出ていない席への送信は今までどおり（Escを打たない）", { skip }, async () => {
  fs.rmSync(received, { force: true });
  fs.rmSync(cue, { force: true });
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const receipt = await core.sendAgentMessage(sid, "普通の文。");
    assert.deepEqual(receipt.pane_input_recovery, []);
    assert.equal(await waitBytes("\r"), `${PASTE[0]}普通の文。${PASTE[1]}\r`);
  } finally { core.closeSession(sid); }
});
