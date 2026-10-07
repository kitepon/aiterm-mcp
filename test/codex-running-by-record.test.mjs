// Codexの席への送信の振り分け: 画面は入力待ちに見えるが、記録の上ではturnが動いている席（回答を流している間）を、動いていると数える（ADR 0101）。
// Codex 0.160.1は、回答を流している間、動作中の行を出さない。その間に届いた文を、Codexは動いているturnへ取り込む。
// 今までは新しいturnとして返し、同じ1つの回答が2回の完了として届いていた。
// 止まっている席を動いていると読むと、文は新しいturnになるのに差し込みとして返り、その完了を誰も待たない。
// 読み違えない方の条件（この起動の記録・最後の境界がturnの開始・画面が動いている）を、偽の席と手で書いた記録で確かめる。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux = (process.platform === "win32" ? spawnSync("psmux", ["-V"]) : spawnSync("tmux", ["-V"])).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-crr-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

// Codexの画面をまねる偽の席。届いたbyteを16進でfileへ足す。
// - static: 入力欄と足元の行を出して、そのまま止まる。
// - stream: 回答を流している画面。0.1秒ごとに会話欄へ1行足し、入力欄と足元の行を描き直す（動作中の行は出さない）。
const seat = path.join(process.env.TMPDIR, "seat.mjs");
fs.writeFileSync(seat, [
  "import fs from 'node:fs';",
  "const [file, mode] = process.argv.slice(2);",
  "const chrome = '› Ask Codex to do anything\\n  mock-model default · /tmp/proj\\n';",
  "process.stdout.write('OpenAI Codex\\n' + chrome);",
  "if (process.stdin.isTTY) process.stdin.setRawMode(true);",
  "process.stdin.on('data', chunk => fs.appendFileSync(file, chunk.toString('hex')));",
  "let n = 0;",
  "if (mode === 'stream') setInterval(() => { n++; process.stdout.write(`\\x1b[2A\\x1b[J${n}. item number ${n} is here\\n` + chrome); }, 100);",
  "else setInterval(() => {}, 60000);",
  "",
].join("\n"));
const received = (name) => path.join(process.env.TMPDIR, `${name}.hex`);
function fakeCodex(name, mode) {
  const bin = path.join(process.env.TMPDIR, `codex-${name}.sh`);
  // execしない。起動した実行ファイル（このscript）が席のprocessとして残り、harnessとして見分けられる。
  fs.writeFileSync(bin, ["#!/bin/sh", `'${process.execPath}' '${seat}' '${received(name)}' '${mode}'`, ""].join("\n"), { mode: 0o700 });
  fs.chmodSync(bin, 0o700);
  return bin;
}
const codexHome = path.join(process.env.TMPDIR, "codex-home");
const rolloutDir = path.join(codexHome, "sessions", "2026", "10", "07");
fs.mkdirSync(rolloutDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(codexHome, "auth.json"), "{}\n", { mode: 0o600 });
fs.writeFileSync(path.join(codexHome, "config.toml"),
  'model = "test-model"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[mcp_servers.test]\ncommand = "test"\n', { mode: 0o600 });
fs.writeFileSync(path.join(codexHome, "history.jsonl"), "{}\n", { mode: 0o600 });
process.env.CODEX_HOME = codexHome;

const core = await import(new URL("../dist/core.js", import.meta.url).href);
const { codexRunningTurn, codexTurnSettled } = await import(new URL("../dist/harnesses/codex.js", import.meta.url).href);
core.__testSetAgentTuiReadyStableSamples(1);
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "POSIX shell fixture" : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});

const event = (type, extra = {}) => JSON.stringify({ type: "event_msg", payload: { type, ...extra } });
const START = event("task_started", { turn_id: "turn-1" });
const DONE = event("task_complete", { turn_id: "turn-1", last_agent_message: "答え" });
const ABORTED = event("turn_aborted", { turn_id: "turn-1", reason: "interrupted" });
let serial = 0;
/** 起動の印（launch_id）つきの記録を1つ書く。返すのは、そのfileへ行を足す関数。 */
function rollout(launchId, lines) {
  const id = `sess-${++serial}`;
  const file = path.join(rolloutDir, `rollout-2026-10-07T00-00-0${serial}-${id}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ type: "session_meta", payload: { id, originator: "codex-tui", source: "cli" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer",
      content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${launchId}` }] } }),
    ...lines,
  ].join("\n") + "\n");
  return (line) => fs.appendFileSync(file, line + "\n");
}
/** 偽の席を起こし、入力待ちと読めるまで待つ。 */
async function openSeat(name, mode) {
  process.env.CODEX_BIN = fakeCodex(name, mode);
  const [sid] = core.openAgent("codex", { agent_done: true });
  let seen = core.observeSession(sid);
  for (let waited = 0; waited < 8000 && !(seen.state === "idle" && seen.harness_alive === true); waited += 100) { await sleep(100); seen = core.observeSession(sid); }
  assert.equal(seen.state, "idle", "画面は入力待ちと読める（動作中の行は出ていない）");
  assert.equal(seen.harness_alive, true);
  return { sid, launchId: seen.launch_id };
}
const arrived = (name, body) => { try { return Buffer.from(fs.readFileSync(received(name), "utf8"), "hex").toString("utf8").includes(body); } catch { return false; } };

test("記録の読み: 最後の境界がturnの開始の時だけ、動いているturnのIDを返す", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "running-codex-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "sessions", "2026", "10", "07");
  fs.mkdirSync(dir, { recursive: true });
  const meta = { kind: "codex", codex_home: home, hook_route: "shared_codex_home", launch_id: "launch-running",
    created_at: new Date(Date.now() - 60_000).toISOString(), vendor_session_id: null };
  const file = path.join(dir, "rollout-2026-10-07T00-00-00-sess-running.jsonl");
  const head = (launch = meta.launch_id) => [
    JSON.stringify({ type: "session_meta", payload: { id: "sess-running", originator: "codex-tui", source: "cli" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${launch}` }] } }),
  ];
  const write = (lines) => fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(codexRunningTurn(meta), null, "記録が無い（起動直後）");
  write(head());
  assert.equal(codexRunningTurn(meta), null, "turnがまだ1つも無い");
  write([...head(), START]);
  assert.equal(codexRunningTurn(meta), "turn-1");
  assert.equal(codexTurnSettled(meta), false);
  write([...head(), START, event("agent_message", { message: "途中の一言" })]);
  assert.equal(codexRunningTurn(meta), "turn-1", "境界でない出来事は読み飛ばす");
  // Codexは、APIの誤りで終わった番にもtask_completeを書く（0.160.1の実記録）。
  for (const end of [DONE, event("task_complete", { turn_id: "turn-1", last_agent_message: null, error: { message: "boom", codex_error_info: "internal_server_error" } }), ABORTED,
    event("turn_aborted", { turn_id: "turn-1", reason: "replaced" })]) {
    write([...head(), START, end]);
    assert.equal(codexRunningTurn(meta), null, end);
  }
  write([...head(), START, DONE, event("task_started", { turn_id: "turn-2" })]);
  assert.equal(codexRunningTurn(meta), "turn-2", "次のturnが始まっている");
  write([...head(), START, DONE, event("task_started", {})]);
  assert.equal(codexRunningTurn(meta), null, "IDの無い開始は数えない");
  fs.writeFileSync(file, [...head(), START].join("\n") + '\n{"type":"event_msg","payload":{"type":"task_complete","turn_');
  assert.equal(codexRunningTurn(meta), null, "末尾を書いている途中は、分からないと読む");
  // 別の起動の印しか無い記録は、この席の物として読まない（前の起動の、途中で切られた記録）。
  write([...head("launch-older"), START]);
  assert.equal(codexRunningTurn(meta), null);
});

test("回答を流している席（画面は入力待ち、記録はturnの途中、画面が動いている）への文は、差し込みで返す", { skip }, async () => {
  const { sid, launchId } = await openSeat("stream", "stream");
  try {
    rollout(launchId, [START]);
    const receipt = await core.sendAgentMessage(sid, "流れている間に届いた文。");
    assert.equal(receipt.schema, "aiterm.agent-steer.v1");
    for (let waited = 0; waited < 4000 && !arrived("stream", "流れている間に届いた文。"); waited += 50) await sleep(50);
    assert.ok(arrived("stream", "流れている間に届いた文。"), "文は席へ届いている");
  } finally { core.closeSession(sid); }
});

test("記録がturnの途中でも、画面が動いていない席への文は、新しいturnで返す（止まっている席を読み違えない）", { skip }, async () => {
  const { sid, launchId } = await openSeat("static", "static");
  try {
    rollout(launchId, [START]);
    const receipt = await core.sendAgentMessage(sid, "止まっている席への文。");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
  } finally { core.closeSession(sid); }
});

test("画面が動いていても、記録の上でturnが終わっている席への文は、新しいturnで返す", { skip }, async () => {
  for (const [name, end] of [["done", DONE], ["aborted", ABORTED]]) {
    const { sid, launchId } = await openSeat(name, "stream");
    try {
      rollout(launchId, [START, end]);
      const receipt = await core.sendAgentMessage(sid, "終わった後の文。");
      assert.equal(receipt.schema, "aiterm.agent-dispatch.v1", name);
    } finally { core.closeSession(sid); }
  }
});

test("前の起動の、turnの途中で切られた記録が残っていても、起こし直した席への文は新しいturnで返す", { skip }, async () => {
  const { sid } = await openSeat("fresh", "stream");
  try {
    // この席の記録はまだ無い。残っているのは、別の起動の印がついた記録だけ。
    rollout("0123456789abcdef0123456789abcdef", [START]);
    const receipt = await core.sendAgentMessage(sid, "起こし直した席への文。");
    assert.equal(receipt.schema, "aiterm.agent-dispatch.v1");
  } finally { core.closeSession(sid); }
});

test("見直すまでの間にturnの終わりが記録へ届いたら、新しいturnで返す（終わり際に届いた文）", { skip }, async () => {
  const { sid, launchId } = await openSeat("ending", "stream");
  try {
    const append = rollout(launchId, [START]);
    const sending = core.sendAgentMessage(sid, "終わり際の文。");
    setTimeout(() => append(DONE), 150);
    assert.equal((await sending).schema, "aiterm.agent-dispatch.v1");
  } finally { core.closeSession(sid); }
});
