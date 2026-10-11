import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Grok（1.0.50、Windowsの実物 2026-10-11）は、送った文を中のagentが受け取らないと、10秒で足元の表示を「受け取り待ち」に変え、
// 120秒で自分から取り消して、文を入力欄へ戻す。会話の記録には番の行が出ない。画面の文は、その実物から写した。
const base = fs.mkdtempSync(path.join(os.tmpdir(), "agu-"));
process.env.TMPDIR = base;
process.env.XDG_RUNTIME_DIR = base;
const grok = await import("../dist/harnesses/grok.js");
const shared = await import("../dist/agent-shared.js");
const core = await import("../dist/core.js");
core.__testSetAgentTuiReadyStableSamples(1);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const status = "  ~/.c/aiterm-branch-test/steer-test  1.8K / 256K │ [Dashboard]";
const sent = "  > Reply with the single word OK. Do not use tools.  6:23 PM  █";
const notice = [
  "  The agent did not accept your prompt within 120s. Your text is back in the input box; press Enter to retry. If",
  "  this keeps happening, run /feedback.",
].join("\n");
const frame = (text) => `  ╭──────────────────────────────────────────────────────────╮\n  │ > ${text}  │\n  ╰──────────────────────── Grok 4.6 (high) ─╯`;
const footer = "  Enter:send  │  Alt+Enter:newline  │  Shift+Tab:mode  │  Ctrl+;:queue  │  Ctrl+x:shortcuts";
const awaiting = `${status}\n${sent}\n  | Waiting for the agent to accept the prompt… 9.2s  19s ↓1.81k [stop]\n${frame("")}\n  Shift+Tab:mode  │  Ctrl+c:cancel  │  Ctrl+x:shortcuts`;
const restored = `${status}\n${notice}\n  Prompt not accepted, text restored\n${frame("Reply with the single word OK. Do not use tools.")}\n${footer}`;

test("受け取り待ちの表示を、普通の応答待ちと分ける", () => {
  assert.equal(grok.grokPromptAwaitingAccept(awaiting), true);
  assert.deepEqual(grok.grokPaneObservation(awaiting), { state: "busy", reason: "turn_running" });
  assert.equal(grok.grokPromptAwaitingAccept(awaiting.replace("Waiting for the agent to accept the prompt…", "Waiting for response…")), false);
  // 上に残った古い受け取り待ちの行より、今の行を読む。
  assert.equal(grok.grokPromptAwaitingAccept(`${awaiting}\n  - Waiting for response… 1.2s [stop]`), false);
  assert.equal(grok.grokPromptAwaitingAccept(restored), false);
});

test("受け取られなかった文が入力欄へ戻されたままの画面だけを拾う", () => {
  assert.equal(grok.grokUnacceptedPromptRestored(restored), true);
  assert.equal(grok.grokUnacceptedPromptRestored(restored.replace("│ > ", "│ ❯ ")), true);
  // 待ち行列に文が残っている形（受け取り待ちの間に2通目が入った時）。
  assert.equal(grok.grokUnacceptedPromptRestored(restored.replace("  Prompt not accepted, text restored", "  v Queued 1\n  #1 Reply with the single word SECOND.")), true);
  // 入力欄を空にした後、送り直して動いている間、知らせが無い画面は、どれも拾わない。
  assert.equal(grok.grokUnacceptedPromptRestored(`${status}\n${notice}\n${frame("")}\n${footer}`), false);
  assert.equal(grok.grokUnacceptedPromptRestored(`${status}\n${notice}\n${sent}\n  - Waiting for response… 2.0s [stop]\n${frame("次の下書き")}`), false);
  assert.equal(grok.grokUnacceptedPromptRestored(`${status}\n${frame("ただの下書き")}\n${footer}`), false);
  assert.deepEqual(grok.grokPaneObservation(`Grok Build\n${restored}`), { state: "idle", reason: "composer_ready" });
});

test("完了待ち: 受け取られなかった知らせは、間を置いた2回の読みで結果なしの終了にする。番が始まっていれば拾わない", async () => {
  const meta = { kind: "grok", aiterm_session: "unaccepted", launch_id: "b".repeat(32), grok_home: base, cwd: base, vendor_session_id: "unaccepted-session" };
  const metadata = shared.agentMetadataPath(meta.aiterm_session, meta.launch_id);
  fs.mkdirSync(path.dirname(metadata), { recursive: true });
  fs.writeFileSync(metadata, "{}");
  const transcript = grok.grokEventsTranscript(meta);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '{"type":"mcp_init_completed"}\n');
  const cursor = fs.statSync(transcript).size;
  // 1回だけの照会では返さない（送った直後は、前の番の知らせが画面に残っている事がある）。
  assert.equal((await grok.observeGrokDone(meta, 0, cursor, () => null, undefined, () => true)).outcome, "running");
  let looked = 0;
  const started = performance.now();
  const result = await grok.observeGrokDone(meta, 10, cursor, () => null, undefined, () => { looked++; return true; });
  assert.equal(result.outcome, "error");
  assert.equal(result.error, grok.GROK_UNACCEPTED_PROMPT_ERROR);
  assert.equal(result.turn_id, null);
  assert.equal(looked, 2);
  assert.ok(performance.now() - started >= 1900, "2回目の読みは間を置いてから");
  // 番が始まった後は、画面に知らせが残っていても拾わない。
  fs.appendFileSync(transcript, '{"type":"turn_started"}\n');
  assert.equal((await grok.observeGrokDone(meta, 3, cursor, () => null, undefined, () => true)).outcome, "timeout");
});

const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).status === 0;
const ptySkip = hasTmux ? false : "POSIX模擬CLIのPTY試験にはtmuxが必要";
const DISPATCH = "aiterm.agent-dispatch.v1";

// 模擬のGrok。1通目は受け取らない（releaseのfileが出来るまで受け取り待ち、出来たら文を入力欄へ戻す）。2通目からは受け取って答える。
async function withUnacceptingGrok(run) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, "pty-")));
  const inputFile = path.join(dir, "input.jsonl");
  const release = path.join(dir, "release");
  const bin = path.join(dir, "grok.mjs");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "auth.json"), "{}", { mode: 0o600 });
  fs.writeFileSync(inputFile, "");
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[2] === 'models') { console.log('Available models:\\n  - grok-4.6'); process.exit(0); }
const sid = process.argv[process.argv.indexOf('--session-id') + 1];
const dir = path.join(process.env.GROK_HOME, 'sessions', encodeURIComponent(process.cwd()), sid);
fs.mkdirSync(dir, { recursive: true });
const emit = (record) => fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(record) + '\\n');
emit({ type: 'mcp_init_completed' });
const frame = (text) => '╭────────────────────────────╮\\n│ > ' + text + '  │\\n╰──── Grok 4.6 (high) · always-approve ─╯';
// 本物と同じく、同じ場所へ描き直す（画面を消して送ると、前の表示が端末の履歴に残る）。
const render = (text) => process.stdout.write('\\x1b[H' + text.split('\\n').map(line => line + '\\x1b[K').join('\\n') + '\\n\\x1b[J');
const notice = ${JSON.stringify(notice)};
let composer = '', above = 'Grok Build', turns = 0;
process.stdin.setRawMode(true);
process.stdin.resume();
render(above + '\\n' + frame(''));
process.stdin.on('data', data => {
  const text = data.toString();
  fs.appendFileSync(${JSON.stringify(inputFile)}, JSON.stringify(text) + '\\n');
  if (text === '\\x03') { composer = ''; render(above + '\\n' + frame('')); return; }
  composer += text.replace(/\\x1b\\[20[01]~/g, '');
  if (!composer.includes('\\r')) { render(above + '\\n' + frame(composer)); return; }
  const prompt = composer.replace(/\\r/g, '');
  composer = '';
  if (++turns === 1) {
    render('  > ' + prompt + '\\n  | Waiting for the agent to accept the prompt… 9.2s  19s [stop]\\n' + frame(''));
    const wait = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(release)})) return;
      clearInterval(wait);
      composer = prompt; above = notice;
      render(above + '\\n  Prompt not accepted, text restored\\n' + frame(composer));
    }, 50);
    return;
  }
  emit({ type: 'turn_started', turn_number: turns });
  render('  > ' + prompt + '\\n  - Waiting for response… 0.3s [stop]\\n' + frame(''));
  setTimeout(() => {
    fs.writeFileSync(path.join(dir, 'chat_history.jsonl'), JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: '回答: ' + prompt }] }) + '\\n');
    emit({ type: 'turn_ended', outcome: 'completed', ts: 'turn-' + turns });
    above = notice + '\\n  > ' + prompt + '\\n  回答: ' + prompt;
    render(above + '\\n' + frame(''));
  }, 500);
});
`, { mode: 0o700 });
  const savedBin = process.env.GROK_BIN;
  const savedHome = process.env.GROK_HOME;
  process.env.GROK_BIN = bin;
  process.env.GROK_HOME = home;
  let sid;
  try {
    [sid] = core.openAgent("grok", { agent_done: true, cwd: dir });
    await core.readOutput(sid, { wait: true, until: "always-approve", timeout: 5, raw: true });
    const inputs = () => fs.readFileSync(inputFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).join("").replace(/\x1b\[20[01]~/g, "");
    await run({ sid, inputs, release: () => fs.writeFileSync(release, "") });
  } finally {
    if (sid) core.closeSession(sid);
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Grokが文を受け取らない席: 受け取り待ちの間は送らずに断り、戻された文は消してから次の文を送り、完了待ちは結果なしで終わる", { skip: ptySkip }, async () => {
  await withUnacceptingGrok(async ({ sid, inputs, release }) => {
    const first = await core.sendAgentMessage(sid, "FIRST");
    assert.equal(first.schema, DISPATCH);
    await core.readOutput(sid, { wait: true, until: "accept the prompt", timeout: 5, raw: true });
    // 受け取り待ちの間: 差し込まず、何も打たずに断る。
    await assert.rejects(core.sendAgentMessage(sid, "SECOND"), /GROK_PROMPT_NOT_ACCEPTED_YET vendor=grok[\s\S]*文字列は送信していません。/u);
    assert.equal(inputs(), "FIRST\r");
    assert.equal((await core.observeAgentDone(sid, { cursor: first.event_cursor, timeout: 0 })).outcome, "running");
    // Grokが取り消して、文を入力欄へ戻した後: 1通目の完了待ちは、結果なしの終了で返る。
    release();
    await core.readOutput(sid, { wait: true, until: "text restored", timeout: 5, raw: true });
    const ended = await core.observeAgentDone(sid, { cursor: first.event_cursor, timeout: 10 });
    assert.equal(ended.outcome, "error");
    assert.equal(ended.error, grok.GROK_UNACCEPTED_PROMPT_ERROR);
    assert.equal(core.observeSession(sid).state, "idle");
    // 次の文: 戻された文を消してから、新しい番として送る。前の文とつながらない。
    const second = await core.sendAgentMessage(sid, "SECOND");
    assert.equal(second.schema, DISPATCH);
    assert.ok(second.pane_input_recovery.includes("grok_unaccepted_prompt_cleared"), JSON.stringify(second.pane_input_recovery));
    assert.equal(inputs(), "FIRST\r\x03SECOND\r");
    const done = await core.observeAgentDone(sid, { cursor: second.event_cursor, timeout: 10 });
    assert.equal(done.outcome, "done");
    assert.equal(done.turn_id, "turn-2");
    // 知らせが画面の上に残っていても、入力欄が空なら、次の文の前に何も押さない。
    const third = await core.sendAgentMessage(sid, "THIRD");
    assert.equal(third.pane_input_recovery.includes("grok_unaccepted_prompt_cleared"), false);
    assert.equal(inputs(), "FIRST\r\x03SECOND\rTHIRD\r");
    assert.equal((await core.observeAgentDone(sid, { cursor: third.event_cursor, timeout: 10 })).outcome, "done");
  });
});
