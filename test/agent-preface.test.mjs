// pty_sendのpreface（本文の前に置く1行、ADR 0099）。
// Claude Codeの席へは、前置きを貼り付けの印なしで入れ、空行と本文を1回の貼り付けで入れる。ほかの席へは、1つにつないで貼る。
// 偽の席が受けた生のbyteを記録して確かめる（agent-send-serial.test.mjsと同じ隔離socket方式）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux = (process.platform === "win32" ? spawnSync("psmux", ["-V"]) : spawnSync("tmux", ["-V"])).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-pre-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

// 入力受付の画面を出した後、端末をrawにして、届いたbyteを16進でfileへ足す偽の席。何も表示しない。
const recorder = path.join(process.env.TMPDIR, "recorder.mjs");
fs.writeFileSync(recorder, [
  "import fs from 'node:fs';",
  "const [file, banner] = process.argv.slice(2);",
  "process.stdout.write(banner.replaceAll('\\\\n', '\\n') + '\\n');",
  "if (process.stdin.isTTY) process.stdin.setRawMode(true);",
  "process.stdin.on('data', chunk => fs.appendFileSync(file, chunk.toString('hex')));",
  "setInterval(() => {}, 60000);",
  "",
].join("\n"));
const received = (name) => path.join(process.env.TMPDIR, `${name}.hex`);
function fakeSeat(name, banner, authJson) {
  const bin = path.join(process.env.TMPDIR, `fake-${name}.sh`);
  fs.writeFileSync(bin, [
    "#!/bin/sh",
    ...(authJson ? ["if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then", `  printf '%s\\n' '${authJson}'`, "  exit 0", "fi"] : []),
    `exec '${process.execPath}' '${recorder}' '${received(name)}' '${banner}'`,
    "",
  ].join("\n"), { mode: 0o700 });
  fs.chmodSync(bin, 0o700);
  return bin;
}
const fakeCodexHome = path.join(process.env.TMPDIR, "fake-codex-home");
fs.mkdirSync(path.join(fakeCodexHome, "sessions"), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(fakeCodexHome, "auth.json"), "{}\n", { mode: 0o600 });
fs.writeFileSync(path.join(fakeCodexHome, "config.toml"),
  'model = "test-model"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[mcp_servers.test]\ncommand = "test"\n', { mode: 0o600 });
fs.writeFileSync(path.join(fakeCodexHome, "history.jsonl"), "{}\n", { mode: 0o600 });
process.env.CLAUDE_BIN = fakeSeat("claude", "Claude Code\\n❯ ready", '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}');
process.env.CODEX_BIN = fakeSeat("codex", "OpenAI Codex\\n› ready", null);
process.env.CODEX_HOME = fakeCodexHome;

const core = await import(new URL("../dist/core.js", import.meta.url).href);
core.__testSetAgentTuiReadyStableSamples(1);
// 生のbyteの並びはPOSIXのtmuxで確かめる。Windows（psmux＋ConPTY）は入力の制御列の通り方が違うので、実物の席の確かめに任せる。
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "生のbyteの並びはPOSIXで確かめる" : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PASTE = ["\x1b[200~", "\x1b[201~"];
/** 偽の席が受けたbyteを文字列で返す。末尾がEnter（CR）になるまで待つ。 */
async function waitReceived(name, endsWith = "\r") {
  let text = "";
  for (let waited = 0; waited < 8000; waited += 50) {
    try { text = Buffer.from(fs.readFileSync(received(name), "utf8"), "hex").toString("utf8"); } catch { text = ""; }
    if (text.endsWith(endsWith)) return text;
    await sleep(50);
  }
  return text;
}

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});

const PREFACE = "「トロニー」からあなたへ次のメッセージが届いています。";
const BODY = "1行目だよ。\n\n2行目に \"引用\" と 'single' がある。\n最後の行。";

test("前置きは、1行・200字以内・制御文字なしで、行頭が記号や空白でなく、@ を含まない文だけを通す", () => {
  assert.equal(core.assertAgentPreface(PREFACE), PREFACE);
  assert.equal(core.assertAgentPreface("BellTeamが届けた連絡です。"), "BellTeamが届けた連絡です。");
  assert.equal(core.assertAgentPreface("あ".repeat(200)), "あ".repeat(200));
  const refused = [
    ["", /空です/], ["1行目\n2行目", /改行か制御文字/], ["前置き\r", /改行か制御文字/], ["色\x1b[31m付き", /改行か制御文字/], ["タブ\tあり", /改行か制御文字/],
    ["あ".repeat(201), /200字を越えています/],
    // 入力欄は、行頭の記号を命令として読む（/＝命令、!＝shell、#＝記憶、?＝案内、@＝file）。
    ["/clear して", /行頭が記号か空白/], ["!rm -rf x", /行頭が記号か空白/], ["# 覚えて", /行頭が記号か空白/], ["?", /行頭が記号か空白/], [" 先頭に空白", /行頭が記号か空白/],
    ["末尾に空白 ", /行末が空白/], ["user@example.com から", /@ を含んでいます/],
  ];
  for (const [value, reason] of refused) {
    assert.throws(() => core.assertAgentPreface(value), (error) => {
      assert.match(error.message, /^AGENT_PREFACE_INVALID: /);
      assert.match(error.message, reason, JSON.stringify(value));
      assert.match(error.message, /文字列は送信していません。$/);
      return true;
    });
  }
});

test("Claudeの席へは、前置きを貼り付けの印なしで入れ、空行と本文を1回の貼り付けで入れる（新しいturnと差し込み）", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const first = await core.sendAgentMessage(sid, BODY, { preface: PREFACE });
    assert.equal(first.schema, "aiterm.agent-dispatch.v1");
    // 前置きは印の外。印の中は「空行＋本文」で、前置きを含まない。最後にEnter。
    assert.equal(await waitReceived("claude"), `${PREFACE}${PASTE[0]}\n\n${BODY}${PASTE[1]}\r`);
    // turnの印が残っている間の2通目は差し込み。渡る形は同じ。
    fs.rmSync(received("claude"));
    const second = await core.sendAgentMessage(sid, "差し込みの本文。", { preface: "「オーナー」からあなたへ次のメッセージが届いています。" });
    assert.equal(second.schema, "aiterm.agent-steer.v1");
    assert.equal(await waitReceived("claude"), `「オーナー」からあなたへ次のメッセージが届いています。${PASTE[0]}\n\n差し込みの本文。${PASTE[1]}\r`);
    // 前置きなしは今までどおり、本文だけを1回の貼り付けで入れる。
    fs.rmSync(received("claude"));
    await core.sendAgentMessage(sid, "前置きなしの本文。");
    assert.equal(await waitReceived("claude"), `${PASTE[0]}前置きなしの本文。${PASTE[1]}\r`);
  } finally { core.closeSession(sid); }
});

test("Codexの席へは、前置き・空行・本文を1つにつないで貼る", { skip }, async () => {
  const [sid] = core.openAgent("codex", { agent_done: true });
  try {
    const receipt = await core.sendAgentMessage(sid, BODY, { preface: PREFACE });
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
    assert.equal(await waitReceived("codex"), `${PASTE[0]}${PREFACE}\n\n${BODY}${PASTE[1]}\r`);
  } finally { core.closeSession(sid); }
});

test("通らない前置きは、順番待ちにも入力受付の待ちにも入らず、何も送らずに断る", { skip }, async () => {
  // 前の試験の席が受けた記録を消してから起こす（偽の席は同じfileへ足す）。
  fs.rmSync(received("claude"), { force: true });
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const started = Date.now();
    await assert.rejects(core.sendAgentMessage(sid, "MUST_NOT_ARRIVE", { preface: "/exit" }), /AGENT_PREFACE_INVALID: .*文字列は送信していません。$/);
    assert.ok(Date.now() - started < 1000, "待たずに断る");
    await sleep(300);
    assert.equal(fs.existsSync(received("claude")), false, "席には1byteも届いていない");
  } finally { core.closeSession(sid); }
});
