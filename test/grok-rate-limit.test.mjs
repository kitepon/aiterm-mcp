import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "agr-"));
process.env.TMPDIR = base;
process.env.XDG_RUNTIME_DIR = base;
const grok = await import("../dist/harnesses/grok.js");
const shared = await import("../dist/agent-shared.js");
const core = await import("../dist/core.js");
core.__testSetAgentTuiReadyStableSamples(1);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const panel = [
  "Help improve Grok                         [Opt out] [Opt in]",
  "┃  You hit your weekly limit.",
  "┃  ↑/↓ navigate · y copy                   Enter:submit",
  "Tab:next answer │ Esc:scrollback │ Shift+x:dismiss",
].join("\n");
const composer = "╭────────────────────────────╮\n│ ❯ \n╰──── Grok 4.6 (high) · always-approve ─╯";

test("Grok上限: 空の選択肢と折返した操作欄を認識する", () => {
  for (const screen of [panel, panel.replace(" │ Esc:", "\nEsc:").replace(" │ Shift+x:", "\nShift+x:\n") + "\n\n"]) {
    assert.deepEqual(grok.grokRateLimitDialog(screen), { message: "You hit your weekly limit.", dismissKey: "X" });
    assert.deepEqual(grok.grokPaneObservation(screen), { state: "blocked", reason: "rate_limited" });
  }
});

test("Grok上限: 引用、古いカード、新しい入力欄と処理中を区別する", () => {
  for (const screen of [
    "説明: You hit your weekly limit.\nTab:next answer │ Esc:scrollback │ Shift+x:dismiss",
    "> You hit your weekly limit.\nTab:next answer │ Esc:scrollback │ Shift+x:dismiss",
    "┃ You hit your weekly limit.",
    panel + "\n" + composer,
    panel + "\nWaiting for response… 2s [stop]",
    panel + "\n┃ Another question?\nTab:next answer │ Esc:scrollback │ Shift+x:dismiss",
    panel + "\nDo you trust this folder?\nEnter:submit Esc:cancel",
  ]) assert.equal(grok.grokRateLimitDialog(screen), null, screen);
});

test("Grok privacy: 案内と現在の枠付き入力欄が共存してもidleになる", () => {
  for (const screen of [composer, composer.replace("❯", ">"), composer.replace("Grok 4.6", "Composer 2.5")]) {
    assert.deepEqual(grok.grokPaneObservation("Help improve Grok\n[Opt out] [Opt in]\n" + screen),
      { state: "idle", reason: "composer_ready" });
  }
  assert.equal(grok.grokPaneObservation("Help improve Grok\nGrok Build\n❯").state, "blocked");
  assert.equal(grok.grokPaneObservation("Help improve Grok\n" + composer + "\nWaiting for response… [stop]").state, "busy");
  assert.equal(grok.grokPaneObservation("Connection failed\n" + composer).state, "blocked");
});

test("Grok完了: 今回の成功・上限エラー・通常エラーと古い完了を区別する", async () => {
  const meta = {
    kind: "grok", aiterm_session: "pure", launch_id: "a".repeat(32),
    grok_home: base, cwd: base, vendor_session_id: "pure-session",
  };
  const metadata = shared.agentMetadataPath(meta.aiterm_session, meta.launch_id);
  fs.mkdirSync(path.dirname(metadata), { recursive: true });
  fs.writeFileSync(metadata, "{}");
  const transcript = grok.grokEventsTranscript(meta);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const record = (outcome) => JSON.stringify({ type: "turn_ended", outcome, ts: "current-turn" }) + "\n";
  try {
    for (const [outcome, visible, expected] of [["completed", true, "done"], ["error", true, "rate_limited"], ["error", false, "error"]]) {
      fs.writeFileSync(transcript, record(outcome));
      const result = await grok.observeGrokDone(meta, 0, 0, () => visible ? "You hit your weekly limit." : null);
      assert.equal(result.outcome, expected);
      assert.equal(result.turn_id, "current-turn");
      assert.equal(result.rate_limit, expected === "rate_limited" ? "You hit your weekly limit." : null);
    }
    fs.writeFileSync(transcript, record("error"));
    const cursor = fs.statSync(transcript).size;
    fs.appendFileSync(transcript, '{"type":"turn_started"}\n');
    assert.equal((await grok.observeGrokDone(meta, 0, cursor, () => null)).outcome, "running");
    assert.equal((await grok.observeGrokDone(meta, 0, cursor, () => "You hit your weekly limit.")).outcome, "rate_limited");
    fs.appendFileSync(transcript, record("completed"));
    assert.equal((await grok.observeGrokDone(meta, 0, cursor, () => null)).outcome, "done");
  } finally { fs.rmSync(metadata, { force: true }); }
});

const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).status === 0;
const ptySkip = hasTmux ? false : "POSIX模擬CLIのPTY試験にはtmuxが必要";

async function withLimitPty(mode, kind, run) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, "pty-")));
  const inputFile = path.join(dir, "input.jsonl");
  const bin = path.join(dir, "grok.mjs");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "auth.json"), "{}", { mode: 0o600 });
  fs.writeFileSync(inputFile, "");
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[2] === 'models') {
  console.log('Available models:\\n  - grok-4.6\\n  - grok-composer-2.5-fast');
  process.exit(0);
}
const mode = ${JSON.stringify(mode)};
const sid = process.argv[process.argv.indexOf('--session-id') + 1];
const dir = path.join(process.env.GROK_HOME, 'sessions', encodeURIComponent(process.cwd()), sid);
fs.mkdirSync(dir, { recursive: true });
const events = path.join(dir, 'events.jsonl');
const emit = (record) => fs.appendFileSync(events, JSON.stringify(record) + '\\n');
emit({ type: 'turn_started', turn_number: 1 });
emit({ type: 'turn_ended', outcome: 'error', ts: 'old-error' });
if (mode === 'active') emit({ type: 'turn_started', turn_number: 2 });
const render = (text) => process.stdout.write('\\x1b[2J\\x1b[H' + text + '\\n');
process.stdin.setRawMode(true);
process.stdin.resume();
render(mode === 'ready' ? ${JSON.stringify(composer)} : ${JSON.stringify(panel)});
let buffer = '';
process.stdin.on('data', data => {
  fs.appendFileSync(${JSON.stringify(inputFile)}, JSON.stringify(data.toString()) + '\\n');
  if (data.toString() === 'X') {
    if (mode === 'stuck') return;
    emit({ type: 'turn_ended', outcome: 'cancelled', ts: 'dismiss-event' });
    render('Help improve Grok\\n' + ${JSON.stringify(composer)});
    return;
  }
  buffer += data.toString().replace(/\\x1b\\[20[01]~/g, '');
  if (buffer.includes('\\r')) {
    const prompt = buffer.replace(/\\r/g, '');
    emit({ type: 'turn_started', turn_number: 2 });
    render('Waiting for response… [stop]');
    setTimeout(() => {
      emit({ type: 'turn_ended', outcome: mode === 'limited' ? 'error' : 'completed', ts: 'new-turn' });
      render(mode === 'limited' ? ${JSON.stringify(panel)} : '回答: ' + prompt + '\\n' + ${JSON.stringify(composer)});
    }, 700);
    buffer = '';
  }
});
`, { mode: 0o700 });
  const savedBin = process.env.GROK_BIN;
  const savedHome = process.env.GROK_HOME;
  process.env.GROK_BIN = bin;
  process.env.GROK_HOME = home;
  let sid;
  try {
    [sid] = core.openAgent(kind, { agent_done: true, cwd: dir });
    await core.readOutput(sid, { wait: true, until: mode === "ready" ? "always-approve" : "Shift+x:dismiss", timeout: 5, raw: true });
    const agentsDir = path.dirname(shared.agentMetadataPath(sid, "0".repeat(32)));
    const metadata = path.join(agentsDir, fs.readdirSync(agentsDir).find(f => f.startsWith(sid + ".") && f.endsWith(".agent.json")));
    const meta = JSON.parse(fs.readFileSync(metadata, "utf8"));
    const inputs = () => fs.readFileSync(inputFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    await run({ sid, meta, metadata, inputs });
  } finally {
    if (sid) core.closeSession(sid);
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const kind of ["grok", "composer"]) {
  test(`Grok上限PTY: ${kind}の同一sessionでX一回、今回の本文一回、解除後のcursor`, { skip: ptySkip }, async () => {
    await withLimitPty("recover", kind, async ({ sid, meta, metadata, inputs }) => {
      const original = fs.readFileSync(metadata, "utf8");
      const oldCursor = fs.statSync(grok.grokEventsTranscript(meta)).size;
      for (let i = 0; i < 2; i++) {
        assert.equal(core.observeSession(sid).state, "blocked");
        assert.equal((await core.observeAgentDone(sid, { cursor: 0, timeout: 0 })).outcome, "rate_limited");
      }
      assert.deepEqual(inputs(), []);
      assert.equal(fs.readFileSync(metadata, "utf8"), original);
      let preparedCursor;
      const receipt = await core.dispatchAgentTurn(sid, "CURRENT_PROMPT", {
        ready_timeout: 2000,
        before_send: async ({ event_cursor }) => {
          preparedCursor = event_cursor;
          assert.ok(event_cursor > oldCursor);
          assert.equal(event_cursor, fs.statSync(grok.grokEventsTranscript(meta)).size);
          assert.deepEqual(inputs(), ["X"]);
        },
      });
      assert.equal(receipt.session_id, sid);
      assert.equal(receipt.launch_id, meta.launch_id);
      assert.equal(receipt.event_cursor, preparedCursor);
      assert.ok(receipt.pane_input_recovery.includes("grok_rate_limit_dialog_dismissed"));
      const result = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 4 });
      assert.equal(result.outcome, "done");
      assert.equal(result.turn_id, "new-turn");
      assert.equal(result.vendor_session_id, meta.vendor_session_id);
      assert.equal(inputs().filter(x => x === "X").length, 1);
      assert.equal(inputs().join("").replace(/\x1b\[20[01]~/g, ""), "XCURRENT_PROMPT\r");
      assert.equal(core.detectAgentRateLimit(kind, sid), null);
    });
  });
}

test("Grok上限PTY: 未終了ターンと解除失敗は本文を送らない", { skip: ptySkip }, async () => {
  for (const [mode, code, expectedInputs] of [["active", "BLOCKED", []], ["stuck", "FAILED", ["X"]]]) {
    await withLimitPty(mode, "grok", async ({ sid, inputs }) => {
      await assert.rejects(core.dispatchAgentTurn(sid, "UNSENT_PROMPT", { ready_timeout: 300 }),
        new RegExp(`GROK_RATE_LIMIT_RECOVERY_${code}.*送信していません`));
      assert.deepEqual(inputs(), expectedInputs);
    });
  }
});

test("Grok上限PTY: harnessが終了した残画面へXも本文も送らない", { skip: ptySkip }, async () => {
  await withLimitPty("recover", "grok", async ({ sid, meta, metadata, inputs }) => {
    core.closeSession(sid);
    core.openSession(sid, "/bin/bash");
    core.send(sid, "printf '\\033[2J\\033[H'; printf '%s\\n' '" + panel + "'; sleep 30", { enter: true });
    await core.readOutput(sid, { wait: true, until: "Shift+x:dismiss", timeout: 3 });
    fs.writeFileSync(metadata, JSON.stringify(meta), { mode: 0o600 });
    assert.equal(core.observeSession(sid).harness_alive, false);
    await assert.rejects(core.dispatchAgentTurn(sid, "UNSENT_PROMPT", { ready_timeout: 300 }),
      /GROK_RATE_LIMIT_RECOVERY_BLOCKED: harness_exited.*送信していません/);
    assert.deepEqual(inputs(), []);
  });
});

test("Grok上限PTY: 通常送信ではXを送らず、今回の新たな上限は報告する", { skip: ptySkip }, async () => {
  for (const mode of ["ready", "limited"]) {
    await withLimitPty(mode, "grok", async ({ sid, inputs }) => {
      const receipt = await core.dispatchAgentTurn(sid, "CURRENT_PROMPT", { ready_timeout: 2000 });
      const result = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 4 });
      assert.equal(result.outcome, mode === "ready" ? "done" : "rate_limited");
      if (mode === "ready") assert.equal(inputs().includes("X"), false);
    });
  }
});

test("Grok上限PTY: auth不在は現在パネルがある時だけexit 6", { skip: ptySkip }, async () => {
  for (const mode of ["recover", "ready"]) {
    await withLimitPty(mode, "grok", async ({ sid, meta, inputs }) => {
      fs.rmSync(meta.grok_auth_path);
      const cli = spawnSync(process.execPath, [path.resolve("dist/aiterm-wait-cli.js"), "--session", sid, "--timeout", "0"], { encoding: "utf8" });
      const result = JSON.parse(cli.stdout.trim());
      assert.equal(cli.status, mode === "recover" ? 6 : 1, cli.stdout + cli.stderr);
      assert.equal(result.code, mode === "recover" ? "AGENT_RATE_LIMITED" : "AITERM_WAIT_FAILED");
      assert.deepEqual(inputs(), []);
    });
  }
});
