// core-agentの試験（core-agent*.test.mjs）が共有する準備。試験は入れない。
// 偽のCLI・一時のHOME・後片付けを、読み込んだ試験のprocessごとに1回ずつ用意する。
// 1つだった試験fileを分けたのは、file の中の試験が1本ずつ順に走るため（Windowsで687秒、ほかの全fileが終わった後も8分ほど
// この1 fileを待っていた）。分けた file は並んで走る。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）。test/の下のfileは、よその走者に単独でも拾われる。
import { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentFixturePrint, agentFixtureShellCommand } from "./agent-fixture-shell.mjs";

const hasTmux =
  (process.platform === "win32"
    ? spawnSync("psmux", ["-V"])
    : spawnSync("tmux", ["-V"])
  ).status === 0;
// prefix は短く保つ（macOS の UNIX ソケットパスは 104 バイト上限。長い prefix だと
// claude.sock への接続が "File name too long" で落ちる——実測）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-agt-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
// わざと起こす起動失敗を、利用者の実行時エラー記録へ書かない。XDGが設定された環境でも収集設定の無い場所を指す。
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");
const ARGV_FIXTURE_DONE = "<<<AITERM_FAKE_ARGV_DONE>>>";
const argvPrinterBin = path.join(process.env.TMPDIR, "print-argv.sh");
const argvInvocationFile = path.join(process.env.TMPDIR, "argv-invocations.log");
const quotedInvocationFile = "'" + argvInvocationFile.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
const argvInvocation = phase => `printf '${phase} %s %s\\n' "$AITERM_SESSION_ID" "$AITERM_AGENT_LAUNCH_ID" >> ${quotedInvocationFile}\n`;

const fakeClaudeBin = path.join(process.env.TMPDIR, "fake-claude.sh");
const fakeGrokBin = path.join(process.env.TMPDIR, "fake-grok.sh");
fs.writeFileSync(
    argvPrinterBin,
    "#!/bin/sh\n" + argvInvocation("START") + "printf 'agent_role=%s\\nagent_depth=%s\\n' \"$AITERM_AGENT_ROLE\" \"$AITERM_AGENT_DEPTH\"\nfor arg do\n  printf '<arg>%s</arg>\\n' \"$arg\"\ndone\nprintf '%s\\n' '" + ARGV_FIXTURE_DONE + "'\n" + argvInvocation("END") + agentFixtureShellCommand + "\n:\n",
    { mode: 0o700 },
  );
fs.chmodSync(argvPrinterBin, 0o700);
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
      `printf '%s\\n' '${ARGV_FIXTURE_DONE}'`,
      // Dispatch fixtures render through a shell, with a real surviving fake
      // harness parent rather than metadata for an already exited printer.
      agentFixtureShellCommand,
      ":",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
fs.chmodSync(fakeClaudeBin, 0o700);
fs.writeFileSync(
    fakeGrokBin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = models ]; then",
      "  printf '%s\\n' 'You are logged in with grok.com.' '' 'Default model: grok-4.5' '' 'Available models:' '  - grok-4.6' '  * grok-4.5 (default)'",
      "  exit 0",
      "fi",
      "for arg do printf '<arg>%s</arg>\\n' \"$arg\"; done",
      "printf 'agent_role=%s\\nGROK_AUTH_PATH=%s\\n' \"$AITERM_AGENT_ROLE\" \"$GROK_AUTH_PATH\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
fs.chmodSync(fakeGrokBin, 0o700);
// 実 CLI を起動せず openAgent の配管だけ検証する偽 bin。resolveAgentBin は存在検証する（A3）ため、
// 実在するパスにする必要がある。POSIX は /bin/echo（起動コマンドを echo で可視化できる）、native
// Windows には /bin/echo が無いので node 自身（必ず存在）を使う——echo 出力を読む grok/composer/codex
// 組立テストは { skip }（tmux 必須）で native Windows では走らないため、可視化不要な bin で足りる。
process.env.CODEX_BIN = argvPrinterBin;
process.env.GROK_BIN = fakeGrokBin;
process.env.CLAUDE_BIN = fakeClaudeBin;
const core = await import("../dist/core.js");
const codexHarness = await import("../dist/harnesses/codex.js");
const { buildWindowsLauncher } = process.platform === "win32" ? await import("../dist/windows-codex-setup.js") : {};
core.__testSetAgentTuiReadyStableSamples(1);
const skip = hasTmux ? undefined : "tmux 未インストール";
// 製品側 currentUid()（src/core.ts）と同じ規則。Windows(native) は getuid を持たないので 0。
// getuid の有無を skip 条件に使わない（Windows の agent 覆域が丸ごと消えるため）。
const testUid = () => (typeof process.getuid === "function" ? process.getuid() : 0);
const skipAgentDone = hasTmux ? undefined : "tmux 未インストール";
// Windows は grok/composer launcher が Windows native の grok.exe を強制するため、
// POSIX script の fake grok bin による起動組立テストは設計どおり session 作成前に拒否される。
// 同じ組立コードは POSIX 3 環境（macOS/Linux/WSL2）の同テストが検証する。
const skipGrokFakeBin = process.platform === "win32" ? "Windows は native grok.exe 強制のため fake grok bin は起動不可" : skip;
const agentStateDir = () => path.join(process.env.TMPDIR, `aiterm-mcp-${testUid()}`, "agents");


// Observe the fake CLI's own complete argv output, never its shell command echo.
// Keep the existing 5-second deadline. On a miss, collect scalars before the
// caller's original cleanup without resending input or advancing a screen offset.
async function readArgvFixture(sid, t) {
  const launchId = readAgentMeta(sid).launch_id;
  const runtime = await import("../dist/tmux-runtime.js");
  const anchor = () => {
    if (process.platform !== "win32") return null;
    const registry = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), ".psmux");
    try { return fs.readFileSync(path.join(registry, `${runtime.WIN_NS}__${sid}.pid`), "utf8").trim(); }
    catch { return null; }
  };
  const expectedAnchor = anchor();
  const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true, until: ARGV_FIXTURE_DONE });
  if (out.includes(ARGV_FIXTURE_DONE)) return out;
  const stats = text => ({ bytes: Buffer.byteLength(text), argv: text.includes("<arg>"),
    done: text.includes(ARGV_FIXTURE_DONE),
    shell_prompt: /\$\s*$/.test(text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")),
    syntax_error: /syntax error/i.test(text) });
  const sameLaunch = () => { try { return readAgentMeta(sid).launch_id === launchId; } catch { return false; } };
  const diagnostic = { schema: "aiterm.test-argv-miss.v1", session_id: sid, launch_id: launchId,
    output: stats(out), log: null, offset: null, cli_started: null, cli_ended: null,
    same_generation: null, pane: null };
  try { diagnostic.log = stats(fs.readFileSync(sessionLogPath(sid), "utf8")); } catch {}
  try { const n = Number(fs.readFileSync(path.join(runtime.SOCKDIR, sid + ".offset"), "utf8")); if (Number.isSafeInteger(n)) diagnostic.offset = n; } catch {}
  try {
    const phases = fs.readFileSync(argvInvocationFile, "utf8").split(/\r?\n/);
    diagnostic.cli_started = phases.includes(`START ${sid} ${launchId}`);
    diagnostic.cli_ended = phases.includes(`END ${sid} ${launchId}`);
  } catch {}
  if (expectedAnchor && expectedAnchor === anchor() && sameLaunch()) {
    try {
      const pane = await core.readOutput(sid, { screen: true, raw: true });
      diagnostic.same_generation = expectedAnchor === anchor() && sameLaunch();
      if (diagnostic.same_generation) diagnostic.pane = stats(pane);
    } catch { diagnostic.same_generation = null; }
  }
  t.diagnostic(JSON.stringify(diagnostic));
  assert.fail("fake CLI argv completion was not observed within the existing 5-second deadline");
}

function makeFakeCodexHome() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "fake-codex-home-"));
  fs.writeFileSync(path.join(dir, "auth.json"), "{}\n", { mode: 0o600 });
  fs.writeFileSync(
    path.join(dir, "config.toml"),
    'model = "test-model"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[mcp_servers.test]\ncommand = "test"\n',
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(dir, "history.jsonl"), "{}\n", { mode: 0o600 });
  fs.mkdirSync(path.join(dir, "sessions"), { mode: 0o700 });
  return dir;
}

function makeFakeGrokHome() {
  // macOS の /var は /private/var への symlink。auth の canonical path 契約を検証する fixture
  // だけ実パス下に置き、tmux socket 用 TMPDIR は短い従来値のまま保つ。
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR), "fake-grok-home-"));
  fs.writeFileSync(path.join(dir, "auth.json"), "{}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "config.toml"), "[cli]\nauto_update = true\n", { mode: 0o600 });
  return dir;
}

function makeGrokHomeWithoutAuth() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "fake-grok-home-noauth-"));
  fs.writeFileSync(path.join(dir, "config.toml"), "[cli]\nauto_update = true\n", { mode: 0o600 });
  return dir;
}

function withFakeCodexHome(fn) {
  const saved = process.env.CODEX_HOME;
  const dir = makeFakeCodexHome();
  process.env.CODEX_HOME = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (saved === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

async function withFakeCodexTuiHome(fn) {
  const saved = process.env.CODEX_BIN;
  const bin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = bin;
  try { return await withFakeCodexHome(fn); }
  finally {
    if (saved === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = saved;
    fs.rmSync(bin, { force: true });
  }
}

function withFakeGrokHome(fn) {
  const saved = process.env.GROK_HOME;
  const dir = makeFakeGrokHome();
  process.env.GROK_HOME = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (saved === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function withGrokHomeWithoutAuth(fn) {
  const saved = process.env.GROK_HOME;
  const dir = makeGrokHomeWithoutAuth();
  process.env.GROK_HOME = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (saved === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

// kill-sessionの受付の直後は、serverとsocketの片付けが終わる前の一覧が「server exited unexpectedly」で失敗する事がある
// （macOS。直前の試験が最後の席を閉じた時。Macの全体試験で1件）。一覧が読める状態（known）になるまで待ってから、
// 試験の基準を取る。unknownを空へ丸めず、待ち切れなければ今までどおり読んで誤りをそのまま出す。
async function settledListSessions(timeoutMs = 2000) {
  for (const deadline = performance.now() + timeoutMs; ; await new Promise((resolve) => setTimeout(resolve, 20))) {
    if (core.observeExecutionNativeSessions().state === "known" || performance.now() >= deadline) return core.listSessions();
  }
}

function agentStateFiles() {
  try {
    return fs.readdirSync(agentStateDir()).sort();
  } catch {
    return [];
  }
}

function readAgentMeta(sid) {
  const metaFiles = fs.readdirSync(agentStateDir()).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
  assert.equal(metaFiles.length, 1);
  return JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFiles[0]), "utf8"));
}

function writeAgentMeta(sid, meta) {
  const metaFiles = fs.readdirSync(agentStateDir()).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
  assert.equal(metaFiles.length, 1);
  fs.writeFileSync(path.join(agentStateDir(), metaFiles[0]), JSON.stringify(meta) + "\n", { mode: 0o600 });
}

function bindTranscriptTurn(sid, vendorSessionId, turnId) {
  const meta = readAgentMeta(sid);
  meta.vendor_session_id = vendorSessionId;
  writeAgentMeta(sid, meta);
  fs.appendFileSync(meta.event_file, agentDoneLine(meta, { vendor_session_id: vendorSessionId, turn_id: turnId }));
  return meta;
}

function writeCodexTranscript(meta, vendorSessionId, records) {
  const dir = path.join(meta.codex_home, "sessions", "2026", "07", "11");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `rollout-2026-07-11T00-00-00-${vendorSessionId}.jsonl`);
  let normalized = records;
  if (meta.hook_route === "shared_codex_home") {
    const markerRecord = {
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${meta.launch_id}` }],
      },
    };
    const first = records[0];
    const sessionMeta = typeof first !== "string" && first?.type === "session_meta"
      ? { ...first, payload: { ...first.payload, id: vendorSessionId, originator: "codex-tui", source: "cli" } }
      : { type: "session_meta", payload: { id: vendorSessionId, originator: "codex-tui", source: "cli" } };
    normalized = [sessionMeta, markerRecord, ...(typeof first !== "string" && first?.type === "session_meta" ? records.slice(1) : records)];
  }
  fs.writeFileSync(file, normalized.map((record) => (typeof record === "string" ? record : JSON.stringify(record))).join("\n") + "\n", {
    mode: 0o600,
  });
  return file;
}

function appendCodexTranscript(meta, vendorSessionId, records) {
  const sessions = path.join(meta.codex_home, "sessions");
  let file = null;
  const visit = (dir) => {
    if (file || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.includes(vendorSessionId) && entry.name.endsWith(".jsonl")) file = candidate;
      if (file) return;
    }
  };
  visit(sessions);
  if (!file) {
    file = writeCodexTranscript(meta, vendorSessionId, [{ type: "session_meta", payload: { id: vendorSessionId } }]);
  }
  fs.appendFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return file;
}

function appendCodexDone(meta, {
  vendor_session_id: vendorSessionId = "codex-session-test",
  turn_id: turnId = "turn-test",
} = {}) {
  return appendCodexTranscript(meta, vendorSessionId, [
    { type: "event_msg", payload: { type: "task_complete", turn_id: turnId }, timestamp: new Date().toISOString() },
  ]);
}

function scheduleCodexDone(meta, overrides = {}, delay = 200) {
  setTimeout(() => appendCodexDone(meta, overrides), delay);
}

function writeGrokTranscript(meta, vendorSessionId, records) {
  const dir = path.join(meta.grok_home, "sessions", encodeURIComponent(meta.cwd), vendorSessionId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "chat_history.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", {
    mode: 0o600,
  });
}

function sessionLogPath(sid) {
  return path.join(process.env.TMPDIR, "claude-tmux-sockets", `${sid}.log`);
}

function makeFakeCodexTuiBin(busy = false, exitAfterReady = false, inputFile = null) {
  const bin = path.join(process.env.TMPDIR, `fake-codex-tui-${Date.now().toString(36)}.sh`);
  if (inputFile) {
    // A TUI submits a bracketed multiline paste on Enter, not once per LF.
    // Record logical submissions directly; terminal echo is not the oracle.
    const driver = bin + ".cjs";
    fs.writeFileSync(driver, `const fs = require("node:fs");
const { StringDecoder } = require("node:string_decoder");
const output = ${JSON.stringify(inputFile)};
const decoder = new StringDecoder("utf8");
const start = "\\x1b[200~", end = "\\x1b[201~";
let buffer = "", text = "", inPaste = false, pastes = 0;
process.stdin.setRawMode(true);
process.stdin.on("data", bytes => {
  buffer += decoder.write(bytes);
  for (;;) {
    if (inPaste) {
      const i = buffer.indexOf(end);
      if (i < 0) return;
      text += buffer.slice(0, i); buffer = buffer.slice(i + end.length);
      inPaste = false; pastes++; continue;
    }
    if (!buffer) return;
    if (buffer.startsWith(start)) { buffer = buffer.slice(start.length); inPaste = true; continue; }
    if (start.startsWith(buffer)) return;
    const c = buffer[0]; buffer = buffer.slice(1);
    if (c === "\\r" || c === "\\n") {
      if (text) {
        fs.appendFileSync(output, JSON.stringify({ text, paste_frames: pastes }) + "\\n");
        process.stdout.write(text + "\\n");
        ${busy ? 'process.stdout.write("• Working (1s • esc to interrupt)\\n");' : ''}
      }
      text = ""; pastes = 0;
    } else text += c;
  }
});
process.stdin.resume();
process.stdout.write("OpenAI Codex\\n› ready\\n");
${exitAfterReady ? 'process.exit(0);' : ''}
`, { mode: 0o600 });
    const quote = value => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
    // Keep the configured launcher visible while its synthetic TUI child runs.
    fs.writeFileSync(bin, `#!/bin/sh\n${quote(process.execPath)} ${quote(driver)} "$@"\nexit $?\n`, { mode: 0o700 });
    return bin;
  }
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "printf 'OpenAI Codex\\n› ready\\n'",
      ...(exitAfterReady ? ["exit 0"] : []),
      "while IFS= read -r line; do",
      "  printf '%s\\n' \"$line\"",
      ...(busy ? ["  printf '• Working (1s • esc to interrupt)\\n'"] : []),
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeFakeCodexRateLimitTuiBin(cursor, mode, version = "0.155.1") {
  const stem = `fake-codex-rate-limit-${Date.now().toString(36)}`;
  const bin = path.join(process.env.TMPDIR, `${stem}.sh`);
  const driverDir = path.join(process.env.TMPDIR, stem);
  const driver = path.join(driverDir, "codex");
  const input = path.join(process.env.TMPDIR, `${stem}.jsonl`);
  fs.mkdirSync(driverDir, { mode: 0o700 });
  fs.writeFileSync(input, "", { mode: 0o600 });
  fs.writeFileSync(driver, `#!${process.execPath}
const fs = require("node:fs");
const input = ${JSON.stringify(input)};
const cursor = ${JSON.stringify(cursor)};
const mode = ${JSON.stringify(mode)};
if (mode.startsWith("catalog-label") && process.argv.includes("app-server")) {
  require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
    const message = JSON.parse(line);
    fs.appendFileSync(input, JSON.stringify({ method: message.method }) + "\\n");
    if (message.id === undefined) return;
    const result = message.method === "model/list" ? { data: [{ id: "account-model-42", displayName: "Custom Model",
      supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }], nextCursor: null } : {};
    process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
  });
} else {
const luna = ${JSON.stringify(version === "0.157.0" ? "gpt-6-luna" : "gpt-5.6-luna")};
const footer = ${JSON.stringify(version === "0.157.0" ? "  enter select · esc back" : "Press enter to confirm or esc to go back")};
const modal = () => process.stdout.write(["Approaching rate limits", "Switch to " + luna + " for lower credit usage?", ...[1, 2, 3].map(i => (i === cursor ? "› " : "  ") + i + ". " + (i === 1 ? "Switch to " + luna + "                 Fast and affordable agentic coding\\n                                            model." : i === 2 ? "Keep current model" : "Keep current model (never show again)  Hide future rate limit reminders\\n                                            about switching models.")), footer].join("\\n") + "\\n");
const ready = () => process.stdout.write("OpenAI Codex\\n› Ask Codex to do anything\\ngpt-5.6-terra high · ~/work\\n");
const model = () => process.stdout.write("Select Model and Effort\\n› 1. " + (mode.startsWith("catalog-label") ? "Custom Model" : "gpt-5.6-sol") + "\\n  2. gpt-5.6-terra\\n");
const effort = () => process.stdout.write("Select Reasoning Level\\n› 1. Low  Fast responses\\n  2. High  Greater reasoning depth\\n");
let phase = "modal";
process.stdin.setRawMode(true); process.stdin.resume(); modal();
process.stdin.on("data", chunk => {
  const text = chunk.toString();
  fs.appendFileSync(input, JSON.stringify({ phase, text }) + "\\n");
  if (phase === "modal" && text === "2") { if (mode === "stuck") return; phase = "ready"; ready(); return; }
  if (phase === "ready" && text.includes("/model")) { phase = "model"; model(); return; }
  if (phase === "model" && text === "1") { phase = "effort"; effort(); return; }
  if (phase === "effort" && text === "1") { phase = "ready"; process.stdout.write("Model changed to " + (mode === "catalog-label" ? "account-model-42" : "gpt-5.6-sol") + " low\\n"); ready(); }
});
}
`, { mode: 0o700 });
  fs.writeFileSync(bin, `#!/bin/sh
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)} "$@"
`, { mode: 0o700 });
  if (process.platform === "win32" && mode.startsWith("catalog-label")) {
    // App Server uses native spawn, while the TUI's older shell fixture runs through Git Bash.
    const native = buildWindowsLauncher(driverDir, `using System; using System.Diagnostics;
class Fixture {
  static int Main(string[] args) {
    var start = new ProcessStartInfo(${JSON.stringify(process.execPath)}, ${JSON.stringify('"' + driver + '"')} +
      (Array.IndexOf(args, "app-server") >= 0 ? " app-server" : ""));
    start.UseShellExecute = false;
    using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
  }
}`);
    fs.rmSync(bin);
    return { bin: native, input, driverDir };
  }
  return { bin, input, driverDir };
}

function makeFakeThroughlineBin(
  context = "## Throughline Context\nSOURCE_CONTEXT_MARKER",
  expectedSupplementFile = null,
) {
  const payload = JSON.stringify({
    schema: "throughline.handoff_context.v1",
    status: "ready",
    sessionId: "source-session",
    context,
  });
  const stem = `fake-throughline-${Date.now().toString(36)}`;
  if (process.platform === "win32") {
    // Windows の Throughline は npm shim 形（.cmd＋sibling .ps1）を製品が正式に受ける
    //（resolveThroughlineBin→runThroughlineHandoffContext）。fixture も同じ形にする。
    const cmd = path.join(process.env.TMPDIR, `${stem}.cmd`);
    const ps1 = path.join(process.env.TMPDIR, `${stem}.ps1`);
    fs.writeFileSync(cmd, "@echo off\r\nexit /b 9\r\n");
    fs.writeFileSync(ps1, [
      "if ($args[0] -ne 'handoff-context' -or $args[1] -ne '--session' -or $args[3] -ne '--json') { exit 9 }",
      ...(expectedSupplementFile === null
        ? []
        : [`if ($args[4] -ne '--supplement-file' -or $args[5] -ne '${expectedSupplementFile}') { exit 10 }`]),
      `Write-Output '${payload.replace(/'/g, "''")}'`,
      "",
    ].join("\r\n"));
    return cmd;
  }
  const bin = path.join(process.env.TMPDIR, `${stem}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" != handoff-context ] || [ \"$2\" != --session ] || [ \"$4\" != --json ]; then exit 9; fi",
      ...(expectedSupplementFile === null
        ? []
        : [`if [ \"$5\" != --supplement-file ] || [ \"$6\" != '${expectedSupplementFile}' ]; then exit 10; fi`]),
      `printf '%s\\n' '${payload}'`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeBrokenThroughlineBin(stdout, exitCode = 0) {
  const bin = path.join(process.env.TMPDIR, `broken-throughline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(
    bin,
    ["#!/bin/sh", `printf '%s\\n' '${stdout}'`, `exit ${exitCode}`, ""].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

// agent dispatchは本文全体をESC[200~/201~で包む。本物のTUIと同じく、行の前後の印を外す。
const FAKE_TUI_STRIP_PASTE_MARKERS = [
  "  line=${line#?\\[200~}",
  "  line=${line%?\\[201~}",
];

function makeFakeGrokTuiBin() {
  const bin = path.join(process.env.TMPDIR, `fake-grok-tui-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = models ]; then",
      "  printf '%s\\n' 'You are logged in with grok.com.' '' 'Default model: grok-4.5' '' 'Available models:' '  - grok-4.6' '  * grok-4.5 (default)'",
      "  exit 0",
      "fi",
      "printf 'Grok Build\\n❯ ready\\n'",
      "while IFS= read -r line; do",
      ...FAKE_TUI_STRIP_PASTE_MARKERS,
      "  printf '%s\\n' \"$line\"",
      "  case \"$line\" in /effort\\ impossible) printf \"unknown effort level 'impossible'; use one of: low, medium, high\\n\" ;; /model*|/effort*) printf 'Switched to fake configuration: %s\\n' \"$line\" ;; esac",
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeFakeGrokFooterOnlyTuiBin() {
  const bin = path.join(process.env.TMPDIR, `fake-grok-footer-only-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = models ]; then",
      "  printf '%s\\n' 'Default model: grok-4.5' '' 'Available models:' '  - grok-4.6' '  * grok-4.5 (default)'",
      "  exit 0",
      "fi",
      "printf 'Grok Build\\n❯ ready\\n╰─ Grok 4.5 (high) · always-approve ─╯\\n'",
      "while IFS= read -r line; do",
      ...FAKE_TUI_STRIP_PASTE_MARKERS,
      "  case \"$line\" in '/model grok-4.6 high') printf '╰─ Grok 4.6 (high) · always-approve ─╯\\n' ;; esac",
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeGrokCatalogBin(models) {
  const bin = path.join(process.env.TMPDIR, `fake-grok-catalog-${Date.now().toString(36)}.sh`);
  const catalogLines = models.map((model) => `  - ${model}`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = models ]; then",
      `  printf '%s\\n' 'Default model: grok-4.5' '' 'Available models:' ${catalogLines.map((line) => `'${line}'`).join(" ")}`,
      "  exit 0",
      "fi",
      "for arg do printf '<arg>%s</arg>\\n' \"$arg\"; done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeFailingGrokCatalogBin() {
  const bin = path.join(process.env.TMPDIR, `fake-grok-catalog-failure-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(bin, "#!/bin/sh\nexit 17\n", { mode: 0o700 });
  return bin;
}

// run:true は受けた行を印を外してから実行する（承認画面などを本物のTUIの中から出すため）。
function makeFakeClaudeTuiBin({ authJson = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}', authExit = 0, run = false } = {}) {
  const bin = path.join(process.env.TMPDIR, `fake-claude-tui-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
      `  printf '%s\\n' '${authJson}'`,
      `  exit ${authExit}`,
      "fi",
      "printf 'Claude Code\\n❯ ready\\n'",
      "while IFS= read -r line; do",
      ...(run ? [...FAKE_TUI_STRIP_PASTE_MARKERS, "  eval \"$line\""] : ["  printf '%s\\n' \"$line\""]),
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

// 既定が「No, exit」の確認画面を矢印キーで動かす偽Claude。dropFirstDownは起動直後のキー取り落としを再現する。
function makeFakeClaudeTrustTuiBin({ dropFirstDown = false } = {}) {
  // Windowsはnodeのscriptを実行fileとして直接起動できないため、他の偽harnessと同じく.shから起動する。
  // 実体の名前はclaudeにする（Aitermはpane内のprocess名でharnessの生存を見る）。
  const stem = `fake-claude-trust-${Date.now().toString(36)}`;
  const bin = path.join(process.env.TMPDIR, `${stem}.sh`);
  fs.mkdirSync(path.join(process.env.TMPDIR, stem), { mode: 0o700 });
  const driver = path.join(process.env.TMPDIR, stem, "claude");
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)} "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(
    driver,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status" && args[2] === "--json") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }));
  process.exit(0);
}
const out = (lines) => process.stdout.write(lines.join("\\n") + "\\n");
const dialogs = [
  { head: ["Welcome to Claude Code v2.1.261", "Choose the text style that looks best with your terminal"],
    options: ["1. Auto (match terminal)", "2. Dark mode ✔", "3. Light mode"], selected: 1, accept: 1, done: "THEME_ACCEPTED" },
  { head: ["WARNING: Claude Code running in Bypass Permissions mode"],
    options: ["No, exit", "Yes, I accept"], selected: 0, accept: 1, done: "BYPASS_ACCEPTED", foot: "Enter to confirm · Esc to cancel" },
  { head: ["Claude Code v2.1.283", "Accessing workspace:", "Quick safety check: Is this a project you created or one you trust?", "Claude Code'll be able to read, edit, and execute files here."],
    options: ["No, exit", "Yes, I trust this folder"], selected: 0, accept: 1, done: "TRUST_ACCEPTED", foot: "Enter to confirm · Esc to cancel" },
];
let dropDown = ${JSON.stringify(dropFirstDown)};
let index = 0;
const draw = () => {
  const d = dialogs[index];
  out([...d.head, ...d.options.map((o, i) => (i === d.selected ? "❯ " : "  ") + o), ...(d.foot ? [d.foot] : [])]);
};
let line = "";
process.stdin.setRawMode(true); process.stdin.resume(); draw();
process.stdin.on("data", (chunk) => {
  const key = chunk.toString("utf8");
  if (index >= dialogs.length) {
    for (const ch of key) {
      if (ch === "\\r" || ch === "\\n") { out(["PROMPT:" + line]); line = ""; }
      else if (ch >= " ") line += ch;
    }
    return;
  }
  const d = dialogs[index];
  if (key.includes("\\x1b[B")) {
    if (dropDown) { dropDown = false; return; }
    d.selected = Math.min(d.selected + 1, d.options.length - 1); draw(); return;
  }
  if (key.includes("\\r")) {
    if (d.selected !== d.accept) { out(["EXITED_BY:" + d.options[d.selected]]); process.exit(1); }
    out([d.done + ":" + d.options[d.selected]]);
    index += 1;
    if (index < dialogs.length) draw(); else out(["Claude Code", "❯ ready"]);
  }
});
`,
    { mode: 0o700 },
  );
  return bin;
}

function appendAgentDoneWhenLogContains(sid, needle, events) {
  const timer = setInterval(() => {
    try {
      const text = fs.readFileSync(sessionLogPath(sid), "utf8");
      if (!text.includes(needle)) return;
      const meta = readAgentMeta(sid);
      for (const ev of events) appendAgentDone(meta, ev);
      clearInterval(timer);
    } catch {
      /* session/log may not exist yet */
    }
  }, 50);
  return () => clearInterval(timer);
}

function agentDoneLine(meta, overrides = {}) {
  return (
    JSON.stringify({
      type: "agent_done",
      vendor: meta.kind,
      aiterm_session: meta.aiterm_session,
      launch_id: meta.launch_id,
      vendor_session_id: meta.vendor_session_id ?? "agent-session-test",
      turn_id: "turn-test",
      reason: "Stop",
      done_status: "turn_done",
      at: new Date().toISOString(),
      ...overrides,
    }) + "\n"
  );
}

function appendAgentDone(meta, overrides = {}) {
  if (meta.kind === "grok" && meta.completion_route === "grok_transcript") {
    const dir = path.join(meta.grok_home, "sessions", encodeURIComponent(meta.cwd ?? process.cwd()), meta.vendor_session_id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({
      type: "turn_ended",
      outcome: "completed",
      ts: overrides.turn_id ?? new Date().toISOString(),
    }) + "\n", { mode: 0o600 });
    return;
  }
  fs.appendFileSync(meta.event_file, agentDoneLine(meta, overrides));
}

function scheduleAgentDone(meta, overrides = {}, delay = 200) {
  setTimeout(() => appendAgentDone(meta, overrides), delay);
}

function writeClaudeDone(meta, text, overrides = {}) {
  const { consume_marker: consumeMarker = true, ...eventOverrides } = overrides;
  const vendorSessionId = eventOverrides.vendor_session_id ?? meta.vendor_session_id ?? "claude-session-test";
  const operationId = eventOverrides.operation_id ?? null;
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  const bytes = Buffer.byteLength(text, "utf8");
  fs.writeFileSync(meta.result_file, JSON.stringify({
    schema: "aiterm.claude-turn-result.v2",
    operation_id: operationId,
    vendor_session_id: vendorSessionId,
    result_digest: digest,
    result_bytes: bytes,
    text,
  }) + "\n", { mode: 0o600 });
  appendAgentDone(meta, {
    vendor_session_id: vendorSessionId,
    turn_id: null,
    result_digest: digest,
    result_bytes: bytes,
    operation_id: operationId,
    ...eventOverrides,
  });
  if (consumeMarker) {
    try {
      fs.unlinkSync(path.join(path.dirname(meta.result_file), `${meta.aiterm_session}.${meta.launch_id}.claude-operation.json`));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function invokeClaudeStopHook(meta, text, vendorSessionId = meta.vendor_session_id ?? "claude-stop-fixture-session") {
  return spawnSync(process.execPath, [path.join(process.cwd(), "dist", "claude-stop-hook.js")], {
    input: JSON.stringify({
      session_id: vendorSessionId,
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: text,
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      AITERM_AGENT_KIND: "claude",
      AITERM_SESSION_ID: meta.aiterm_session,
      AITERM_AGENT_LAUNCH_ID: meta.launch_id,
    },
  });
}

function claudeDispatchReceiptPath(meta, operationId) {
  return path.join(
    agentStateDir(),
    `${meta.aiterm_session}.${meta.launch_id}.${operationId.slice("sha256:".length)}.claude-dispatch`,
  );
}

function appendClaudeDoneWhenLogContains(sid, needle, text, overrides = {}) {
  const timer = setInterval(() => {
    try {
      if (!fs.readFileSync(sessionLogPath(sid), "utf8").includes(needle)) return;
      writeClaudeDone(readAgentMeta(sid), text, overrides);
      clearInterval(timer);
    } catch {
      /* session/log may not exist yet */
    }
  }, 50);
  return () => clearInterval(timer);
}

async function markFakeAgentReady(sid, kind = "codex") {
  if (kind === "grok") {
    const meta = readAgentMeta(sid);
    const dir = path.join(meta.grok_home, "sessions", encodeURIComponent(meta.cwd ?? process.cwd()), meta.vendor_session_id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({
      type: "mcp_init_completed",
      ts: new Date().toISOString(),
    }) + "\n", { mode: 0o600 });
  }
  const marker =
    kind === "codex" ? "OpenAI Codex\n› ready\n" : kind === "claude" ? "Claude Code\n❯ ready\n" : "Grok Build\n❯ ready\n";
  core.send(sid, agentFixturePrint(marker), {
    force: true,
    raw: true,
    preserveAgentOperation: true,
  });
  await core.readOutput(sid, { wait: true, until: "ready", timeout: 5, raw: true });
}

function fileSnapshot(p) {
  const st = fs.statSync(p);
  return {
    text: fs.readFileSync(p, "utf8"),
    mode: st.mode & 0o777,
    size: st.size,
  };
}

after(() => {
  core.__testSetAgentTuiReadyStableSamples(null);
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

export {
  ARGV_FIXTURE_DONE, readArgvFixture, hasTmux, savedHome, fakeHome, argvPrinterBin, fakeClaudeBin, fakeGrokBin, core, codexHarness, skip,
  testUid, skipAgentDone, skipGrokFakeBin, agentStateDir, makeFakeCodexHome, makeFakeGrokHome,
  makeGrokHomeWithoutAuth, withFakeCodexHome, withFakeCodexTuiHome, withFakeGrokHome,
  withGrokHomeWithoutAuth, agentStateFiles, settledListSessions, readAgentMeta, writeAgentMeta, bindTranscriptTurn,
  writeCodexTranscript, appendCodexTranscript, appendCodexDone, scheduleCodexDone, writeGrokTranscript,
  sessionLogPath, makeFakeCodexTuiBin, makeFakeCodexRateLimitTuiBin, makeFakeThroughlineBin,
  makeBrokenThroughlineBin, FAKE_TUI_STRIP_PASTE_MARKERS, makeFakeGrokTuiBin, makeFakeGrokFooterOnlyTuiBin,
  makeGrokCatalogBin, makeFailingGrokCatalogBin, makeFakeClaudeTuiBin, makeFakeClaudeTrustTuiBin,
  appendAgentDoneWhenLogContains, agentDoneLine, appendAgentDone, scheduleAgentDone, writeClaudeDone,
  invokeClaudeStopHook, claudeDispatchReceiptPath, appendClaudeDoneWhenLogContains, markFakeAgentReady,
  fileSnapshot,
};
