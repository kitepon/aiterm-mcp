// openAgent の前提検証と残骸ゼロ保証の characterization。
// - model/effort 検証は bin 解決より先＝CLI 不在の端末でも同じ結果（環境非依存）。
// - CODEX_BIN 環境変数で bin を無害コマンドに偽装し、CLI 未導入環境でも cwd 検証・残骸テストを回す。
// - tmux 実機を使うケースは core-tmux.test.mjs と同じ隔離ソケット方式（TMPDIR 退避・skip 制御）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
const argvPrinterBin = path.join(process.env.TMPDIR, "print-argv.sh");
const fakeClaudeBin = path.join(process.env.TMPDIR, "fake-claude.sh");
const fakeGrokBin = path.join(process.env.TMPDIR, "fake-grok.sh");
fs.writeFileSync(
    argvPrinterBin,
    "#!/bin/sh\nfor arg do\n  printf '<arg>%s</arg>\\n' \"$arg\"\ndone\n",
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
      "  printf '%s\\n' 'You are logged in with grok.com.' '' 'Default model: grok-4.5' '' 'Available models:' '  - grok-4.6' '  * grok-4.5 (default)' '  - grok-composer-2.5-fast'",
      "  exit 0",
      "fi",
      "for arg do printf '<arg>%s</arg>\\n' \"$arg\"; done",
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

function makeFakeCodexTuiBin(busy = false, exitAfterReady = false) {
  const bin = path.join(process.env.TMPDIR, `fake-codex-tui-${Date.now().toString(36)}.sh`);
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

function makeFakeGrokTuiBin() {
  const bin = path.join(process.env.TMPDIR, `fake-grok-tui-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = models ]; then",
      "  printf '%s\\n' 'You are logged in with grok.com.' '' 'Default model: grok-4.5' '' 'Available models:' '  - grok-4.6' '  * grok-4.5 (default)' '  - grok-composer-2.5-fast'",
      "  exit 0",
      "fi",
      "printf 'Grok Build\\n❯ ready\\n'",
      "while IFS= read -r line; do",
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

function makeFakeClaudeTuiBin({ authJson = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}', authExit = 0 } = {}) {
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
      "  printf '%s\\n' \"$line\"",
      "done",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return bin;
}

function makeFakeClaudeTrustTuiBin() {
  const bin = path.join(process.env.TMPDIR, `fake-claude-trust-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(
    bin,
    [
      "#!/bin/sh",
      "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
      "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
      "  exit 0",
      "fi",
      "printf '%s\\n' 'WARNING: Claude Code running in Bypass Permissions mode' '❯ No, exit' '  Yes, I accept' 'Enter to confirm · Esc to cancel'",
      "IFS= read -r bypass_response",
      "printf 'BYPASS_ACCEPTED:%s\\n' \"$bypass_response\"",
      "printf '%s\\n' 'Claude Code v2.1.251' 'Accessing workspace:' 'Is this a project you created or one you trust?' \"Claude Code'll be able to read, edit, and execute files here.\" '❯ No, exit' '  Yes, I trust this folder' 'Enter to confirm · Esc to cancel'",
      "IFS= read -r trust_response",
      "printf 'TRUST_ACCEPTED:%s\\n' \"$trust_response\"",
      "printf 'Claude Code\\n❯ ready\\n'",
      "while IFS= read -r line; do printf 'PROMPT:%s\\n' \"$line\"; done",
      "",
    ].join("\n"),
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
  if ((meta.kind === "grok" || meta.kind === "composer") && meta.completion_route === "grok_transcript") {
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
  if (kind === "grok" || kind === "composer") {
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
  core.send(sid, `printf '${marker.replace(/'/g, "'\\''").replace(/\n/g, "\\n")}'`, {
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

test("GrokはMCP初期化表示中でも現在のidle composerが安定していればready", () => {
  const screen = [
    "≡ main / MCP (6/11) │ 3.8K / 500K",
    "╭────────────────────────╮",
    "│ >                      │",
    "╰──────── Grok 4.6 (medium) · always-approve ─╯",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("grok", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("grok", screen), true);
});

test("Grokの応答中表示はcomposerが残っていてもidle readyにしない", () => {
  const screen = [
    "Waiting for response… 12s [stop]",
    "│ >                      │",
    "╰──────── Grok 4.6 (medium) · always-approve ─╯",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("grok", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("grok", screen), false);
});

test("target contract: Grok/Composerは対話TUIへreasoning_effortを渡す", { skip: skipGrokFakeBin }, async () => {
  for (const kind of ["grok", "composer"]) {
    const [sid] = core.openAgent(kind, { reasoning_effort: "high" });
    try {
      const out = await core.readOutput(sid, {
        wait: true,
        timeout: 5,
        until: '<arg>high</arg>',
        raw: true,
      });
      assert.match(out, /<arg>--reasoning-effort<\/arg>/, `${kind} effort flag: ${out}`);
      assert.match(out, /<arg>high<\/arg>/, `${kind} effort value: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  }
});

test("target contract: catalogにないGrok/Composer modelはsession作成前に拒否する", { skip: skipGrokFakeBin }, () => {
  for (const kind of ["grok", "composer"]) {
    const sessionName = `missing_${kind}_model`;
    assert.throws(
      () => core.openAgent(kind, { session_name: sessionName, model: "not-in-live-catalog" }),
      (error) => error.code === 2 && /model catalog/.test(error.message) && /not-in-live-catalog/.test(error.message),
    );
    assert.doesNotMatch(core.listSessions(), new RegExp(`(^|\\n)${sessionName}\\t`));
  }
});

test(
  "target contract: Composer既定modelがcatalogにない場合もsession作成前に拒否する",
  { skip: process.platform === "win32" ? "POSIX shell fixture" : undefined },
  () => {
    const savedBin = process.env.GROK_BIN;
    const catalogBin = makeGrokCatalogBin(["grok-4.6", "grok-4.5"]);
    process.env.GROK_BIN = catalogBin;
    try {
      const sessionName = "missing_composer_default";
      assert.throws(
        () => core.openAgent("composer", { session_name: sessionName }),
        (error) => error.code === 2 && /grok-composer-2\.5-fast/.test(error.message) && /model catalog/.test(error.message),
      );
      assert.doesNotMatch(core.listSessions(), new RegExp(`(^|\\n)${sessionName}\\t`));
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(catalogBin, { force: true });
    }
  },
);

test(
  "target contract: Grok model catalog取得失敗はexit付きでsession作成前に拒否する",
  { skip: process.platform === "win32" ? "POSIX shell fixture" : undefined },
  () => {
    const savedBin = process.env.GROK_BIN;
    const failingBin = makeFailingGrokCatalogBin();
    process.env.GROK_BIN = failingBin;
    try {
      assert.throws(
        () => core.openAgent("grok", { session_name: "catalog_failure", model: "grok-4.6" }),
        (error) => error.code === 2 && /catalog を取得できません/.test(error.message) && /exit=17/.test(error.message),
      );
      assert.doesNotMatch(core.listSessions(), /(^|\n)catalog_failure\t/);
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(failingBin, { force: true });
    }
  },
);

test("openAgent: codex の effort は縛らない（CLI 版差があるため送信まで到達する）", { skip }, () => {
  // 偽 bin(/bin/echo) なので実起動はしない。effort が事前拒否されないことだけ確認。
  const [sid] = core.openAgent("codex", { reasoning_effort: "minimal" });
  core.closeSession(sid);
});

test("agent_configure: Codexのmodel／effort選択肢を現在の/model画面から解決する", () => {
  const screen = [
    "  Select Model and Effort",
    "  1. gpt-5.6-sol (default)     Latest frontier agentic coding model.",
    "› 2. gpt-5.6-terra (current)  Balanced agentic coding model.",
    "  3. gpt-5.6-luna             Fast agentic coding model.",
    "",
    "  Select Reasoning Level for gpt-5.6-terra",
    "  1. Low               Fast responses",
    "› 2. Medium (default)  Balanced reasoning",
    "  3. High              Greater reasoning depth",
    "  4. Extra high        Extra reasoning depth",
    "  5. More reasoning…   Max and Ultra",
  ].join("\n");
  assert.deepEqual(core.__testCodexConfigureChoices(screen, "gpt-5.6-luna", "xhigh"), {
    model: "3",
    effort: "4",
    more: "5",
  });
  const advanced = "  Advanced Reasoning\n› 1. Max  For difficult problems when quality matters more than speed";
  assert.equal(core.__testCodexConfigureChoices(advanced, "missing", "max").effort, "1");
});

test("agent_configure: Claudeへ/modelと/effortを同じsessionのまま送る", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin();
  process.env.CLAUDE_BIN = fakeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const result = await core.configureAgent(sid, { model: "opus", reasoning_effort: "high" });
    assert.deepEqual(result, {
      schema: "aiterm.agent-configure-result.v1",
      session_id: sid,
      provider: "claude",
      harness: "claude-code",
      model: "opus",
      reasoning_effort: "high",
    });
    const out = await core.readOutput(sid, { full: true, raw: true });
    assert.match(out, /\/model opus/);
    assert.match(out, /\/effort high/);
    assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "同じsessionが残る");
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("target contract: Grok/Composerへ/modelと/effortを同じsessionのまま送る", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    const savedBin = process.env.GROK_BIN;
    const fakeBin = makeFakeGrokTuiBin();
    process.env.GROK_BIN = fakeBin;
    try {
      for (const kind of ["grok", "composer"]) {
        const [sid] = core.openAgent(kind, { agent_done: true });
        try {
          await markFakeAgentReady(sid, kind);
          const model = kind === "grok" ? "grok-4.6" : "grok-composer-2.5-fast";
          const result = await core.configureAgent(sid, { model, reasoning_effort: "high" });
          assert.deepEqual(result, {
            schema: "aiterm.agent-configure-result.v1",
            session_id: sid,
            provider: kind,
            harness: "grok-cli",
            model,
            reasoning_effort: "high",
          });
          const effortResult = await core.configureAgent(sid, { reasoning_effort: "medium" });
          assert.deepEqual(effortResult, {
            schema: "aiterm.agent-configure-result.v1",
            session_id: sid,
            provider: kind,
            harness: "grok-cli",
            model: null,
            reasoning_effort: "medium",
          });
          await assert.rejects(
            core.configureAgent(sid, { reasoning_effort: "impossible" }),
            (error) => error.code === 2 && /unknown effort level 'impossible'/.test(error.message),
          );
          const out = await core.readOutput(sid, { full: true, raw: true });
          assert.match(out, new RegExp(`/model ${model.replaceAll(".", "\\.")} high`));
          assert.match(out, /\/effort medium/);
          assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`));
        } finally {
          core.closeSession(sid);
        }
      }
    } finally {
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(fakeBin, { force: true });
    }
  });
});

test("target contract: Grokの成功通知が消えても変更後footerで設定完了を確認する", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    const savedBin = process.env.GROK_BIN;
    const fakeBin = makeFakeGrokFooterOnlyTuiBin();
    process.env.GROK_BIN = fakeBin;
    const [sid] = core.openAgent("grok", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "grok");
      const result = await core.configureAgent(sid, { model: "grok-4.6", reasoning_effort: "high" });
      assert.equal(result.model, "grok-4.6");
      assert.equal(result.reasoning_effort, "high");
    } finally {
      core.closeSession(sid);
      if (savedBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = savedBin;
      fs.rmSync(fakeBin, { force: true });
    }
  });
});

test("openAgent: 実在しない cwd は session を作る前に拒否", () => {
  assert.throws(
    () => core.openAgent("codex", { cwd: "/no/such/dir-aiterm-agent-test" }),
    (e) => e.code === 2 && /cwd/.test(e.message),
  );
});

test("openAgent: 破壊語を含む prompt は誤検知で拒否しない（引用符付き引数ゆえ安全・A4）", { skip }, () => {
  const before = core.listSessions();
  // prompt の破壊語は CLI に渡る shq クオート済み引数でありシェルは実行しない。起動できること。
  // （修正前は send(force:false) が code 3 で誤爆し、正当な起動を塞いでいた。）
  const [sid] = core.openAgent("codex", { prompt: "explain what rm -rf / does" });
  try {
    assert.notEqual(core.listSessions(), before, "破壊語 prompt で起動できず session が作られない");
  } finally {
    core.closeSession(sid);
  }
  assert.equal(core.listSessions(), before, "close 後は元の一覧へ戻る");
});

test("openAgent: 前段検証で落ちたら session を残さない（残骸ゼロ）", { skip }, () => {
  const before = core.listSessions();
  // cwd 不在は session 作成前に code 2 で throw する。残骸を残さないこと。
  assert.throws(
    () => core.openAgent("codex", { cwd: "/no/such/dir-aiterm-agent-test-2" }),
    (e) => e.code === 2,
  );
  assert.equal(core.listSessions(), before, "失敗した openAgent が session を残した");
});

test("listSessions: agent 行だけに agent 情報を追加し、通常 session 行は不変", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const plain = "list_plain";
    const agent = "list_agent";
    core.openSession(plain);
    // Windows(psmux) は pane_current_command が起動直後 git→bash と遷移する。行が
    // 2回連続で同じになるまで待ってから基準を取る（遷移中を「不変の基準」にしない）。
    const plainRow = () => core.listSessions().split("\n").find((line) => line.startsWith(`${plain}\t`));
    let plainBefore = plainRow();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const next = plainRow();
      if (next === plainBefore) break;
      plainBefore = next;
    }
    const [sid] = core.openAgent("codex", { session_name: agent, agent_done: true });
    try {
      const rows = core.listSessions().split("\n");
      assert.equal(rows.find((line) => line.startsWith(`${plain}\t`)), plainBefore, "通常 session 行は変更しない");
      assert.match(rows.find((line) => line.startsWith(`${sid}\t`)) ?? "", /\tagent=codex harness=codex-cli agent_done=true$/);
    } finally {
      core.closeSession(sid);
      core.closeSession(plain);
    }
  });
});

test("openAgent: write_scope をmetadataとpty_listへ記録し、Codex read-onlyにはsandboxを付与する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true, write_scope: "read-only" });
    try {
      assert.equal(readAgentMeta(sid).write_scope, "read-only");
      assert.match(core.listSessions(), new RegExp(`${sid}\\t.*write_scope=\\\"read-only\\\"`));
      assert.match(hint, /--sandbox read-only を付与し、書込みを実効禁止/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /--sandbox read-only/, `codex read-only sandbox: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: write_scope省略時はCodex起動argvとpty_list表記を変えない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true });
    try {
      assert.equal(readAgentMeta(sid).write_scope, undefined);
      assert.doesNotMatch(core.listSessions(), new RegExp(`${sid}\\t.*write_scope=`));
      assert.doesNotMatch(hint, /能力宣言/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--sandbox read-only/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: Codexのパス説明write_scopeはunsupportedを明示してsandboxへ偽変換しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid, hint] = core.openAgent("codex", { agent_done: true, write_scope: "/repo/src と /repo/test のみ書込み可" });
    try {
      assert.equal(readAgentMeta(sid).write_scope, "/repo/src と /repo/test のみ書込み可");
      assert.match(hint, /パス単位のsandbox allowlistに対応するCLI引数がないため宣言の記録のみ（構造的unsupported）/);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--sandbox read-only/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("target contract: Grok/Composer read-onlyはsandboxで実効化し、パス説明は宣言に保つ", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async () => {
    for (const kind of ["grok", "composer"]) {
      const [sid, hint] = core.openAgent(kind, { agent_done: true, write_scope: "read-only" });
      try {
        assert.equal(readAgentMeta(sid).write_scope, "read-only");
        assert.match(hint, /--sandbox read-only を付与し、書込みを実効禁止/);
        assert.match(hint, /--always-approve で自動承認/);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /<arg>--sandbox<\/arg>\s*<arg>read-only<\/arg>\s*<arg>--always-approve<\/arg>/, `${kind} read-only sandbox: ${out}`);
      } finally {
        core.closeSession(sid);
      }

      const [pathSid, pathHint] = core.openAgent(kind, { agent_done: true, write_scope: "/repo/docs のみ書込み可" });
      try {
        assert.equal(readAgentMeta(pathSid).write_scope, "/repo/docs のみ書込み可");
        assert.match(pathHint, /パス単位のsandbox allowlistに対応するCLI引数がないため宣言の記録のみ（構造的unsupported）/);
        const pathOut = await core.readOutput(pathSid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(pathOut, /--always-approve/, `${kind} 非read-onlyへの自動承認混入: ${pathOut}`);
      } finally {
        core.closeSession(pathSid);
      }

      const [plainSid] = core.openAgent(kind, { agent_done: true });
      try {
        const plainOut = await core.readOutput(plainSid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(plainOut, /--always-approve/, `${kind} write_scope省略への自動承認混入: ${plainOut}`);
      } finally {
        core.closeSession(plainSid);
      }
    }
  });
});

// A-test: grok/composer 経路の組立コマンドを実検証（従来は codex 経路のみで未カバー）。
// 偽 bin は受け取ったargvをタグ付きで出力し、shell表示に依存せず組立内容を観測できる。
test("openAgent codex: -c model_reasoning_effort=<effort> を組み立てる", { skip }, async () => {
  const [sid] = core.openAgent("codex", { reasoning_effort: "high" });
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/, `codex 組立: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent codex: model 引数を -m で組み立てる", { skip }, async () => {
  const [sid] = core.openAgent("codex", { model: "gpt-5.6-terra" });
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/, `codex model: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent codex: 指定した現在値だけを既存tmux server越しにagentへ渡す", { skip }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const savedValue = process.env.AITERM_FORWARD_FIXTURE;
  // env をそのまま表示する実在 bin。Windows native は Git for Windows 同梱の env.exe を使う
  // （pane shell の Git Bash から実行される）。
  const envBin =
    process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "env.exe")
      : "/usr/bin/env";
  process.env.CODEX_BIN = envBin;
  process.env.AITERM_FORWARD_FIXTURE = "seat-value";
  try {
    const [sid] = core.openAgent("codex", { env_vars: ["AITERM_FORWARD_FIXTURE"] });
    try {
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /^AITERM_FORWARD_FIXTURE=seat-value$/mu);
    } finally {
      core.closeSession(sid);
    }
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    if (savedValue === undefined) delete process.env.AITERM_FORWARD_FIXTURE;
    else process.env.AITERM_FORWARD_FIXTURE = savedValue;
  }
});

test("openAgent: env_varsの無効名はsession作成前に拒否する", () => {
  assert.throws(
    () => core.openAgent("codex", { session_name: "invalid_env_name", env_vars: ["BAD-NAME"] }),
    (error) => error.code === 2 && /env_vars に無効/.test(error.message),
  );
  assert.doesNotMatch(core.listSessions(), /(^|\n)invalid_env_name\t/);
});

test("openAgent codex: 複数行日本語 prompt は argv に残るが shell continuation 表示を出す", { skip }, async () => {
  const prompt = [
    "NoveLore リポジトリで、docs/23_graph_upsert_tool_contract_plan.md を敵対的にレビューしてください。",
    "重点:",
    "- 現行 graph_upsert inputSchema と必須/任意の差分",
    "- docs/07_mcp_interface.md と server.ts / handlers.ts / validate.ts のズレ",
  ].join("\n");
  const [sid] = core.openAgent("codex", { prompt }); // CODEX_BIN=/bin/echo
  try {
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    // psmuxは複数行入力中のshell bracketed-paste mode切替をCSIとして描画へ挟む。
    // argv本文ではない表示制御だけを除いて、実引数とcontinuationを照合する。
    const visible = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    assert.match(visible, /> 重点:/, `shell continuation 表示が出ることを固定する: ${out}`);
    assert.match(visible, /NoveLore リポジトリで、docs\/23_graph_upsert_tool_contract_plan\.md/, `prompt 先頭: ${out}`);
    assert.match(visible, /重点:\r?\n- 現行 graph_upsert inputSchema と必須\/任意の差分/, `prompt 本文: ${out}`);
    assert.match(visible, /docs\/07_mcp_interface\.md と server\.ts \/ handlers\.ts \/ validate\.ts のズレ/, `prompt 末尾: ${out}`);
  } finally {
    core.closeSession(sid);
  }
});

test("target contract: Codexは通常CODEX_HOMEを共有しsub-agent lineageだけを加算する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (normalHome) => {
    const configPath = path.join(normalHome, "config.toml");
    const configBefore = fs.readFileSync(configPath, "utf8");
    const [sid] = core.openAgent("codex", { reasoning_effort: "high", agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.codex_home, normalHome);
      assert.equal(meta.hook_route, "shared_codex_home");
      assert.equal(meta.agent_role, "subagent");
      assert.equal(meta.parent_session_id, "host-root");
      assert.equal(meta.delegation_depth, 1);
      assert.equal(meta.delegation_allowed, true);
      assert.match(meta.lineage, new RegExp(`^host-root>codex:${sid}$`));
      assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "通常configを書き換えない");
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /CODEX_HOME=/, "通常CODEX_HOMEを置換しない");
      assert.match(out, /-c\s+check_for_update_on_startup=false/);
      assert.match(out, /developer_instructions=/);
      assert.match(out, /AITERM_AGENT_R\s*OLE='subagent'/);
      assert.match(out, /AITERM_AGENT_DEPTH='1'/);
      assert.match(out, /delegation_allowed=true/);
    } finally {
      core.closeSession(sid);
    }
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "close後も通常configを維持する");
  });
});

test("target contract: Claudeは通常3 scopeを共有してlaunch固有hookとlineageだけを加算する", { skip: skipAgentDone }, async () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  const configBody = JSON.stringify({ theme: "dark", mcpServers: { fixture: { command: "fixture-mcp" } } }) + "\n";
  fs.writeFileSync(userConfig, configBody, { mode: 0o600 });
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    assert.equal(meta.hook_route, "shared_claude_settings");
    assert.equal(meta.claude_mcp_config, undefined);
    assert.equal(meta.agent_role, "subagent");
    assert.equal(meta.delegation_depth, 1);
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--setting-sources\s+user,project,local/);
    assert.match(out, /--settings/);
    assert.match(out, /--append-system-prompt/);
    assert.doesNotMatch(out, /--mcp-config/);
    assert.equal(fs.readFileSync(userConfig, "utf8"), configBody, "通常user設定を書き換えない");
  } finally {
    core.closeSession(sid);
    fs.rmSync(userConfig, { force: true });
  }
});

test("target contract: Grok/Composerは通常HOMEとGROK_HOMEを共有し既知session transcriptへ束縛する", { skip: skipGrokFakeBin }, async () => {
  await withFakeGrokHome(async (normalHome) => {
    const configPath = path.join(normalHome, "config.toml");
    const configBefore = fs.readFileSync(configPath, "utf8");
    for (const kind of ["grok", "composer"]) {
      const [sid] = core.openAgent(kind, { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.grok_home, normalHome);
        assert.equal(meta.hook_route, "shared_grok_home");
        assert.match(meta.vendor_session_id, /^[0-9a-f-]{36}$/);
        assert.equal(meta.agent_role, "subagent");
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(out, /(?:^|\s)HOME=/, "通常HOMEを置換しない");
        assert.doesNotMatch(out, /(?:^|\s)GROK_HOME=/, "通常GROK_HOMEを置換しない");
        assert.match(out, /--session-id/);
        assert.match(out, /--rules/);
      } finally {
        core.closeSession(sid);
      }
    }
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "通常Grok configを書き換えない");
  });
});

test("target contract: nested launcherはdepthとlineageを1段だけ進め、再委譲を許可する", { skip: skipAgentDone }, async () => {
  const saved = {
    role: process.env.AITERM_AGENT_ROLE,
    session: process.env.AITERM_AGENT_SESSION_ID,
    depth: process.env.AITERM_AGENT_DEPTH,
    lineage: process.env.AITERM_AGENT_LINEAGE,
    delegationAllowed: process.env.AITERM_AGENT_DELEGATION_ALLOWED,
  };
  process.env.AITERM_AGENT_ROLE = "subagent";
  process.env.AITERM_AGENT_SESSION_ID = "parent-session";
  process.env.AITERM_AGENT_DEPTH = "1";
  process.env.AITERM_AGENT_LINEAGE = "host-root>claude:parent-session";
  process.env.AITERM_AGENT_DELEGATION_ALLOWED = "true";
  try {
    await withFakeCodexHome(async () => {
      const [sid] = core.openAgent("codex", { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.parent_session_id, "parent-session");
        assert.equal(meta.delegation_depth, 2);
        assert.equal(meta.lineage, `host-root>claude:parent-session>codex:${sid}`);
        assert.equal(meta.delegation_allowed, true);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /AITERM_AGENT_DEPT\s*H='2'/);
        assert.match(out, /追加のsub-agentへ委譲してよい/);
        assert.doesNotMatch(out, /再委譲.*禁止/);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    for (const [key, value] of Object.entries({
      AITERM_AGENT_ROLE: saved.role,
      AITERM_AGENT_SESSION_ID: saved.session,
      AITERM_AGENT_DEPTH: saved.depth,
      AITERM_AGENT_LINEAGE: saved.lineage,
      AITERM_AGENT_DELEGATION_ALLOWED: saved.delegationAllowed,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("openAgent codex agent_done: 通常CODEX_HOMEのroot transcriptだけを完了正本にする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const configBefore = fs.readFileSync(path.join(fakeHome, "config.toml"), "utf8");
    const [sid, hint] = core.openAgent("codex", { reasoning_effort: "high", agent_done: true });
    try {
      assert.match(hint, /agent_done 待機が有効/);
      const dir = agentStateDir();
      const metas = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
      assert.equal(metas.length, 1);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, metas[0]), "utf8"));
      assert.equal(meta.kind, "codex");
      assert.equal(meta.aiterm_session, sid);
      assert.equal(meta.completion_route, "codex_transcript");
      assert.equal(meta.hook_route, "shared_codex_home");
      assert.equal(meta.codex_home, fakeHome);
      assert.ok(fs.existsSync(meta.event_file), "event file を作る");
      assert.equal(fs.existsSync(path.join(meta.codex_home, "hooks.json")), false, "Codex Stop hookを二重正本にしない");
      assert.equal(fs.readFileSync(path.join(meta.codex_home, "config.toml"), "utf8"), configBefore);
      assert.equal(fs.existsSync(path.join(meta.codex_home, "history.jsonl")), true);
      assert.equal(fs.existsSync(path.join(meta.codex_home, "sessions")), true);
      assert.match(hint, /起動設定: model=test-model（端末config継承） effort=high（引数）/);
      assert.match(hint, /共有 config: mcp_servers 1 個継承 \/ approval_policy=never \/ sandbox_mode=danger-full-access/);

      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.doesNotMatch(out, /--dangerously-bypass-hook-trust/, `不要なhook trust bypassを付けない: ${out}`);
      assert.match(out, /model_reasoning_effort=high/, `codex CLI effort: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: agents discoveryは通常CODEX_HOMEを直接共有する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const sourceAgents = path.join(fakeHome, "agents");
    fs.mkdirSync(sourceAgents, { mode: 0o700 });
    const implementer = 'name = "implementer"\ndescription = "Implement changes"\n';
    const refuter = 'name = "refuter"\ndescription = "Challenge changes"\n';
    fs.writeFileSync(path.join(sourceAgents, "implementer.toml"), implementer, { mode: 0o600 });
    fs.writeFileSync(path.join(fakeHome, "refuter-source.toml"), refuter, { mode: 0o600 });
    fs.symlinkSync(path.join(fakeHome, "refuter-source.toml"), path.join(sourceAgents, "refuter.toml"));
    fs.writeFileSync(path.join(sourceAgents, "ignored.json"), "{}\n", { mode: 0o600 });

    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.codex_home, fakeHome);
      assert.equal(path.join(meta.codex_home, "agents"), sourceAgents);
      assert.equal(fs.lstatSync(path.join(sourceAgents, "refuter.toml")).isSymbolicLink(), true, "vendor自身が通常定義を読む");
      assert.equal(fs.readFileSync(path.join(sourceAgents, "implementer.toml"), "utf8"), implementer);
      assert.equal(fs.readFileSync(path.join(sourceAgents, "refuter.toml"), "utf8"), refuter);
      fs.writeFileSync(path.join(fakeHome, "refuter-source.toml"), 'name = "changed"\n', { mode: 0o600 });
      assert.equal(fs.readFileSync(path.join(sourceAgents, "refuter.toml"), "utf8"), 'name = "changed"\n', "起動後も通常定義を共有する");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent claude: 未認証はsession作成前に拒否して残骸を残さない", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authJson: '{"loggedIn":false}', authExit: 1 });
  const sessionsBefore = core.listSessions();
  const stateBefore = agentStateFiles();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_rejected", agent_done: true }),
      (error) =>
        error.code === 2 &&
        /認証を利用できません/.test(error.message) &&
        /sessionは作成していません/.test(error.message) &&
        /claude auth login/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "未認証launchがtmux sessionを残さない");
    assert.deepEqual(agentStateFiles(), stateBefore, "未認証launchがagent stateを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: 認証statusが壊れていれば偽成功せずsession作成前に拒否する", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authJson: "not-json" });
  const sessionsBefore = core.listSessions();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_unknown", agent_done: true }),
      (error) => error.code === 2 && /認証状態を起動前に確認できません/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "壊れたstatusでtmux sessionを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: loggedIn=trueでもauth status失敗exitを成功扱いしない", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authExit: 1 });
  const sessionsBefore = core.listSessions();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_failed_exit", agent_done: true }),
      (error) => error.code === 2 && /認証状態を起動前に確認できません/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "失敗exitでtmux sessionを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: 共有認証で複数sessionを反復起動できる", { skip: skipAgentDone }, () => {
  const created = [];
  try {
    for (let wave = 0; wave < 2; wave += 1) {
      const waveSessions = Array.from({ length: 3 }, (_, index) => {
        const [sid] = core.openAgent("claude", {
          session_name: `claude_parallel_${wave}_${index}_${Date.now().toString(36)}`,
          agent_done: true,
        });
        created.push(sid);
        return sid;
      });
      assert.equal(new Set(waveSessions).size, 3, "同じwaveのClaude sessionは一意");
      const listed = core.listSessions();
      for (const sid of waveSessions) assert.match(listed, new RegExp(`^${sid}\\t.*agent=claude`, "m"));
      for (const sid of waveSessions) {
        core.closeSession(sid);
        created.splice(created.indexOf(sid), 1);
      }
    }
  } finally {
    for (const sid of created) {
      try { core.closeSession(sid); } catch { /* noop */ }
    }
  }
});

test("managed Claude: /login と /logout の解釈はClaude Codeに委ねる", { skip: skipAgentDone }, async () => {
  for (const command of ["/login", "/logout"]) {
    const [sid] = core.openAgent("claude", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "claude");
      const receipt = await core.dispatchAgentTurn(sid, command);
      assert.equal(receipt.vendor, "claude");
      assert.equal(typeof receipt.event_cursor, "number");
    } finally {
      core.closeSession(sid);
    }
  }
});

test("readAgentTranscript: Claude完了event直後のmarker削除raceを待って回収する", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin();
  process.env.CLAUDE_BIN = fakeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await core.dispatchAgentTurn(sid, "marker raceを再現する");
    const meta = readAgentMeta(sid);
    const markerFile = path.join(path.dirname(meta.result_file), `${meta.aiterm_session}.${meta.launch_id}.claude-operation.json`);
    writeClaudeDone(meta, "marker race after completion", { consume_marker: false });
    setTimeout(() => fs.rmSync(markerFile, { force: true }), 250);
    const started = Date.now();
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /marker race after completion/);
    assert.ok(Date.now() - started >= 100, "event公開直後のactive marker削除を待つ");
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude agent_done: 通常settingsへStop hookとlineageを追加する", { skip: skipAgentDone }, async () => {
  const [sid, hint] = core.openAgent("claude", {
    model: "claude-sonnet-4-6",
    reasoning_effort: "high",
    agent_done: true,
  });
  try {
    assert.match(hint, /Claude Code/);
    assert.match(hint, /agent_done 待機が有効/);
    const meta = readAgentMeta(sid);
    assert.equal(meta.kind, "claude");
    assert.equal(meta.hook_route, "shared_claude_settings");
    assert.ok(fs.existsSync(meta.event_file));
    assert.ok(fs.existsSync(meta.result_file));
    assert.equal(meta.claude_mcp_config, undefined, "user MCP snapshotを作らない");
    const settings = JSON.parse(fs.readFileSync(meta.claude_settings, "utf8"));
    assert.equal(settings.model, "claude-sonnet-4-6");
    assert.equal(settings.effortLevel, "high");
    assert.match(settings.hooks.Stop[0].hooks[0].command, /claude-stop-hook\.js/);
    assert.ok(settings.hooks.Stop[0].hooks[0].command.startsWith("'node' "), "hook実行時にPATHからnodeを解決する");
    assert.equal(settings.hooks.Stop[0].hooks[0].command.includes(process.execPath), false, "版付きnode実体を焼き付けない");
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--setting-sources\s+user,project,local\s+--settings/);
    assert.match(out, /--dangerously-skip-permissions/);
    assert.match(out, /--settings/);
    assert.doesNotMatch(out, /--mcp-config/, "user MCP未登録ならflagを渡さない");
    assert.match(out, /--model\s+claude-sonnet-4-6/);
    assert.match(out, /--effort\s+high/);
    assert.doesNotMatch(out, /\s-p(?:\s|$)/, "headless print modeへ落とさない");
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent claude agent_done: user MCPをsnapshotせず通常configへ委ねる", { skip: skipAgentDone }, async () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  fs.writeFileSync(userConfig, JSON.stringify({
    theme: "dark",
    mcpServers: {
      aishell: {
        command: "aishell-mcp",
        env: { AISHELL_CAPABILITY_SET: "expanded-v1", TEST_SECRET: "fixture-only" },
      },
    },
  }) + "\n", { mode: 0o600 });
  const before = fs.readFileSync(userConfig, "utf8");
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    assert.equal(meta.claude_mcp_config, undefined);
    const settings = JSON.parse(fs.readFileSync(meta.claude_settings, "utf8"));
    assert.deepEqual(Object.keys(settings), ["hooks"], "aiterm所有fileは追加Stop hookだけを持つ");
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.doesNotMatch(out, /--mcp-config/);
    assert.doesNotMatch(out, /fixture-only/, "MCP定義や秘密値をargvへ展開しない");
    assert.equal(fs.readFileSync(userConfig, "utf8"), before);
    core.closeSession(sid);
    assert.equal(fs.readFileSync(userConfig, "utf8"), before, "close後も通常configを維持する");
  } finally {
    fs.rmSync(userConfig, { force: true });
    try {
      core.closeSession(sid);
    } catch {
      /* already closed */
    }
  }
});

test("openAgent claude agent_done: 通常user configをlauncher自身はparseも書換えもしない", { skip: skipAgentDone }, () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  fs.writeFileSync(userConfig, "{ broken\n", { mode: 0o600 });
  const sid = `claude_bad_mcp_${Date.now().toString(36)}`;
  let created = null;
  try {
    [created] = core.openAgent("claude", { session_name: sid, agent_done: true });
    assert.equal(created, sid);
    assert.equal(fs.readFileSync(userConfig, "utf8"), "{ broken\n");
  } finally {
    if (created) core.closeSession(created);
    fs.rmSync(userConfig, { force: true });
  }
});

test("openAgent claude: 相関済みlaunch replayは同じsession receiptを返しCLIを再送しない", { skip: skipAgentDone }, async () => {
  const sid = `claude_launch_replay_${Date.now().toString(36)}`;
  const operationId = `sha256:${"a".repeat(64)}`;
  try {
    const first = core.openAgent("claude", {
      session_name: sid,
      agent_done: true,
      launch_operation_id: operationId,
    });
    assert.equal(first[0], sid);
    await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    const before = fs.readFileSync(sessionLogPath(sid), "utf8");
    const meta = readAgentMeta(sid);
    assert.equal(meta.launch_operation_id, operationId);
    assert.match(meta.launch_request_digest, /^sha256:[0-9a-f]{64}$/);

    const replay = core.openAgent("claude", {
      session_name: sid,
      agent_done: true,
      launch_operation_id: operationId,
    });
    assert.equal(replay[0], sid);
    assert.match(replay[1], /CLIは再送していません/);
    assert.equal(fs.readFileSync(sessionLogPath(sid), "utf8"), before, "replayでPTYへ起動commandを再送しない");

    assert.throws(
      () => core.openAgent("claude", {
        session_name: sid,
        agent_done: true,
        launch_operation_id: `sha256:${"b".repeat(64)}`,
      }),
      /launch identityが一致しません/,
    );
    assert.throws(
      () => core.openAgent("claude", {
        session_name: sid,
        model: "claude-sonnet-4-6",
        agent_done: true,
        launch_operation_id: operationId,
      }),
      /launch identityが一致しません/,
    );
  } finally {
    try {
      core.closeSession(sid);
    } catch {
      /* noop */
    }
  }
});

test("openAgent claude: launch_operation_idのpromptless managed条件を固定する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"c".repeat(64)}`;
  assert.throws(
    () => core.openAgent("claude", { agent_done: true, launch_operation_id: operationId }),
    /明示session_nameが必要/,
  );
  assert.throws(
    () => core.openAgent("claude", { session_name: "launch_requires_managed", launch_operation_id: operationId }),
    /agent_done:trueが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      session_name: "launch_rejects_prompt",
      prompt: "送信しない",
      agent_done: true,
      launch_operation_id: operationId,
    }),
    /launch_operation_idはpromptなしのClaude相関launchだけで指定できます/,
  );
});

test("openAgent grok agent_done: 通常 GROK_HOME を共有し相関・lineage引数だけを加える", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const [sid, hint] = core.openAgent("grok", {
        agent_done: true,
        prompt: "Reply READY.",
      });
      try {
        assert.match(hint, /agent_done 待機が有効/);
        assert.match(hint, /project／user環境を共有/);
        const dir = agentStateDir();
        const metas = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
        assert.equal(metas.length, 1);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, metas[0]), "utf8"));
        assert.equal(meta.kind, "grok");
        assert.equal(meta.hook_route, "shared_grok_home");
        assert.equal(meta.completion_route, "grok_transcript");
        assert.equal(meta.grok_home, fakeHome);
        assert.equal(meta.agent_role, "subagent");
        assert.equal(meta.parent_session_id, "host-root");
        assert.equal(meta.delegation_depth, 1);
        assert.equal(meta.delegation_allowed, true);
        assert.ok(fs.existsSync(meta.event_file), "event file を作る");
        assert.equal(meta.grok_auth_path, path.join(fakeHome, "auth.json"));
        const replacement = path.join(fakeHome, "auth.replacement");
        fs.writeFileSync(replacement, '{"rotated":true}\n', { mode: 0o600 });
        fs.renameSync(replacement, meta.grok_auth_path);
        assert.match(fs.readFileSync(meta.grok_auth_path, "utf8"), /rotated/);
        assert.match(fs.readFileSync(path.join(meta.grok_home, "config.toml"), "utf8"), /auto_update = true/);

        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /GROK_AUTH_PATH=/, `grok auth canonical path is passed: ${out}`);
        assert.match(out, /--session-id/, `grok correlation id: ${out}`);
        assert.match(out, new RegExp(meta.vendor_session_id), `grok vendor session: ${out}`);
        assert.match(out, /--rules/, `grok subagent instruction: ${out}`);
        assert.match(out, /AITERM_AGENT_ROLE=/, `grok lineage env: ${out}`);
        assert.match(out, /--no-auto-update/, `grok command: ${out}`);
        assert.match(out, /--no-alt-screen/, `grok no-alt-screen: ${out}`);
        assert.match(out, /--verbatim/, `grok verbatim: ${out}`);
        assert.match(out, /--model grok-4\.6/, `grok model: ${out}`);
        assert.doesNotMatch(out, /(^| )HOME=/, `grok HOME must be inherited: ${out}`);
        assert.doesNotMatch(out, /(^| )GROK_HOME=/, `grok GROK_HOME must be inherited: ${out}`);
        assert.doesNotMatch(out, /--effort/, `grok effort: ${out}`);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("openAgent grok agent_done: OAuth auth 不在は session 残骸ゼロで拒否する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedApiKey = process.env.XAI_API_KEY;
  process.env.GROK_BIN = "/bin/echo";
  delete process.env.XAI_API_KEY;
  try {
    await withGrokHomeWithoutAuth(async () => {
      const beforeSessions = core.listSessions();
      const beforeFiles = agentStateFiles();
      assert.throws(
        () => core.openAgent("grok", { agent_done: true, prompt: "Reply READY." }),
        (e) => e.code === 2 && /grok login/.test(e.message),
      );
      assert.equal(core.listSessions(), beforeSessions, "失敗した grok agent が tmux session を残した");
      assert.deepEqual(agentStateFiles(), beforeFiles, "失敗した grok agent が agent state を残した");
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    if (savedApiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedApiKey;
  }
});

test("openAgent grok agent_done: GROK_AUTH_PATH の構造だけを session 前に固定する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedPath = process.env.GROK_AUTH_PATH;
  const savedKey = process.env.XAI_API_KEY;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (home) => {
      const before = agentStateFiles();
      const reject = (name, setup) => {
        setup();
        assert.throws(() => core.openAgent("grok", { agent_done: true }), (e) => e.code === 2, name);
        assert.deepEqual(agentStateFiles(), before, `${name}: stateを残さない`);
      };
      reject("empty", () => { process.env.GROK_AUTH_PATH = ""; });
      reject("relative", () => { process.env.GROK_AUTH_PATH = "relative.json"; });
      reject("missing explicit despite key", () => { process.env.GROK_AUTH_PATH = path.join(home, "missing"); process.env.XAI_API_KEY = "test"; });
    });
    await withGrokHomeWithoutAuth(async () => {
      delete process.env.GROK_AUTH_PATH; process.env.XAI_API_KEY = "test";
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.grok_auth_path, null);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(out, /GROK_AUTH_PATH=/);
      } finally { core.closeSession(sid); }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    if (savedKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedKey;
  }
});

test("openAgent grok/composer agent_done: auth のリンクと権限はGrokへ委ねる", { skip: skipGrokFakeBin }, () => {
  const savedBin = process.env.GROK_BIN;
  const savedPath = process.env.GROK_AUTH_PATH;
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR), "grok-auth-ancestor-"));
  const realParent = path.join(root, "real-parent");
  const symlinkParent = path.join(root, "symlink-parent");
  const writableParent = path.join(root, "writable-parent");
  process.env.GROK_BIN = fakeGrokBin;
  try {
    fs.mkdirSync(realParent, { mode: 0o700 });
    fs.writeFileSync(path.join(realParent, "auth.json"), "{}\n", { mode: 0o600 });
    fs.symlinkSync(realParent, symlinkParent);
    fs.mkdirSync(writableParent, { mode: 0o720 });
    fs.chmodSync(writableParent, 0o720);
    fs.writeFileSync(path.join(writableParent, "auth.json"), "{}\n", { mode: 0o600 });
    const openForBoth = (authPath) => {
      process.env.GROK_AUTH_PATH = authPath;
      for (const kind of ["grok", "composer"]) {
        const [sid] = core.openAgent(kind, { agent_done: true });
        try {
          assert.equal(readAgentMeta(sid).grok_auth_path, authPath);
        } finally {
          core.closeSession(sid);
        }
      }
    };
    openForBoth(path.join(symlinkParent, "auth.json"));
    openForBoth(path.join(writableParent, "auth.json"));
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    fs.chmodSync(writableParent, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: relative GROK_HOMEでも親cwd基準の絶対auth正本を子へ渡す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedHome = process.env.GROK_HOME;
  const home = makeFakeGrokHome();
  const childCwd = fs.mkdtempSync(path.join(process.env.TMPDIR, "grok-child-cwd-"));
  process.env.GROK_BIN = "/bin/echo";
  process.env.GROK_HOME = path.relative(process.cwd(), home);
  try {
    const [sid] = core.openAgent("grok", { agent_done: true, cwd: childCwd });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.grok_auth_path, path.resolve(home, "auth.json"));
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out.replace(/[\r\n ]/g, ""), /GROK_AUTH_PATH=/, "tmux画面折返しを除いて絶対auth envを確認する");
    } finally { core.closeSession(sid); }
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(childCwd, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: auth の種類はGrokへ委ね、不存在defaultはAPI keyで許可する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN; const savedHome = process.env.GROK_HOME; const savedPath = process.env.GROK_AUTH_PATH; const savedKey = process.env.XAI_API_KEY;
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR), "grok-auth-fifo-"));
  const fifo = path.join(root, "auth.json"); const auth = path.join(root, "explicit-auth.json");
  process.env.GROK_BIN = "/bin/echo";
  try {
    assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
    process.env.GROK_HOME = root; delete process.env.GROK_AUTH_PATH; delete process.env.XAI_API_KEY;
    let opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
    const missingHome = path.join(root, "missing-home");
    process.env.GROK_HOME = missingHome; process.env.XAI_API_KEY = "test";
    opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
    fs.writeFileSync(auth, "{}\n", { mode: 0o600 });
    delete process.env.XAI_API_KEY; process.env.GROK_AUTH_PATH = auth;
    opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    if (savedKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: auth hard link はGrokへ渡す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const victim = path.join(fakeHome, "victim-auth-target");
      const auth = path.join(fakeHome, "auth.json");
      fs.writeFileSync(victim, "{}\n", { mode: 0o600 });
      fs.rmSync(auth);
      fs.linkSync(victim, auth);
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        assert.equal(readAgentMeta(sid).grok_auth_path, auth);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("openAgent composer agent_done: vendor=composer の metadata を作る", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = fakeGrokBin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("composer", {
        agent_done: true,
        prompt: "Reply READY.",
      });
      try {
        const metaFile = fs.readdirSync(agentStateDir()).find((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
        assert.ok(metaFile);
        const meta = JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFile), "utf8"));
        assert.equal(meta.kind, "composer");
        const out = await core.readOutput(sid, {
          wait: true,
          until: "<arg>grok-composer-2.5-fast</arg>",
          timeout: 5,
          raw: true,
        });
        assert.match(out, /--no-auto-update/, `composer managed command: ${out}`);
        assert.match(out, /--no-alt-screen/, `composer managed no-alt-screen: ${out}`);
        assert.match(out, /--verbatim/, `composer managed verbatim: ${out}`);
        assert.match(out, /<arg>--model<\/arg>/, `composer model flag argv: ${out}`);
        assert.match(out, /<arg>grok-composer-2\.5-fast<\/arg>/, `composer model value argv: ${out}`);
        assert.doesNotMatch(out, /--effort/, `composer managed effort: ${out}`);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("openAgent codex agent_done: cleanup は共有 CODEX_HOME の auth/config を残す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const authPath = path.join(fakeHome, "auth.json");
    const configPath = path.join(fakeHome, "config.toml");
    const authBefore = fileSnapshot(authPath);
    const configBefore = fileSnapshot(configPath);
    const [sid] = core.openAgent("codex", { agent_done: true });
    const meta = readAgentMeta(sid);
    assert.equal(meta.codex_home, fakeHome);
    assert.equal(fs.lstatSync(path.join(meta.codex_home, "auth.json")).isSymbolicLink(), false);
    core.closeSession(sid);
    assert.deepEqual(fileSnapshot(authPath), authBefore, "cleanup が Codex auth.json の実体を変えた");
    assert.deepEqual(fileSnapshot(configPath), configBefore, "cleanup が Codex config.toml の実体を変えた");
    assert.equal(fs.existsSync(meta.codex_home), true, "共有 CODEX_HOME を cleanup してはいけない");
  });
});

test("openAgent grok agent_done: cleanup は共有 auth/config/GROK_HOME を残す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const authPath = path.join(fakeHome, "auth.json");
      const configPath = path.join(fakeHome, "config.toml");
      const authBefore = fileSnapshot(authPath);
      const configBefore = fileSnapshot(configPath);
      const [sid] = core.openAgent("grok", { agent_done: true });
      const meta = readAgentMeta(sid);
      core.closeSession(sid);
      assert.deepEqual(fileSnapshot(authPath), authBefore, "cleanup が Grok auth.json の実体を変えた");
      assert.deepEqual(fileSnapshot(configPath), configBefore, "cleanup が通常 Grok config.toml の実体を変えた");
      assert.equal(fs.existsSync(meta.grok_home), true, "共有 GROK_HOME を cleanup してはいけない");
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("killAll: Claude operation markerとdispatch receiptもcleanupする", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"0".repeat(64)}`;
  const meta = readAgentMeta(sid);
  await markFakeAgentReady(sid, "claude");
  await core.dispatchAgentTurn(sid, "CLAUDE_KILL_ALL_OPERATION", { operation_id: operationId });
  const dir = path.dirname(meta.result_file);
  const before = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.${meta.launch_id}.`));
  assert.ok(before.some((f) => f.endsWith(".claude-operation.json")));
  assert.ok(before.some((f) => f.endsWith(".claude-dispatch")));
  core.killAll();
  const after = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.${meta.launch_id}.`));
  assert.deepEqual(after, []);
});

// 旧名「緩い state root でも…」: mode 矯正（chmod 0o777→0o700）は 2026-08-19 の
// 安全設備撤去で仕様から消えたため、stale metadata 掃除だけを固定する。
test("openAgent agent_done: 既存 state root の stale metadata を掃除してから再作成する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const session = "loose_cleanup";
    const root = path.join(process.env.TMPDIR, `aiterm-mcp-${testUid()}`);
    const agents = path.join(root, "agents");
    fs.mkdirSync(agents, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(agents, `${session}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.agent.json`), "{}\n", { mode: 0o600 });

    const [sid] = core.openAgent("codex", { session_name: session, agent_done: true });
    try {
      assert.equal(sid, session);
      const files = fs.readdirSync(agents).filter((f) => f.startsWith(`${session}.`) && f.endsWith(".agent.json"));
      assert.equal(files.length, 1, `stale metadata が残った: ${files.join(",")}`);
      assert.doesNotMatch(files[0], /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);

      await markFakeAgentReady(session, "codex");
      const receipt = await core.dispatchAgentTurn(session, "echo LOOSE_CLEANUP_BODY");
      assert.equal(receipt.harness, "codex-cli");
      const observation = await core.observeAgentDone(session, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running");
      assert.equal(observation.vendor, "codex");
      assert.equal(observation.harness, "codex-cli");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatch/observe: Codex task_complete 到着まで transcript 正本を待つ", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const metaFile = fs.readdirSync(agentStateDir()).find((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
      assert.ok(metaFile);
      const meta = JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFile), "utf8"));
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo AGENT_DONE_BODY");
      assert.equal(receipt.harness, "codex-cli");
      scheduleCodexDone(meta);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done");
      assert.equal(observation.vendor, "codex");
      assert.equal(observation.harness, "codex-cli");
      assert.equal(observation.turn_id, "turn-test");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatch/observe: Grok vendor event も待って suffix に vendor=grok を付ける", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        const metaFile = fs.readdirSync(agentStateDir()).find((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
        assert.ok(metaFile);
        const meta = JSON.parse(fs.readFileSync(path.join(agentStateDir(), metaFile), "utf8"));
        await markFakeAgentReady(sid, "grok");
        const receipt = await core.dispatchAgentTurn(sid, "echo GROK_DONE_BODY");
        assert.equal(receipt.harness, "grok-cli");
        scheduleAgentDone(meta, { turn_id: "prompt-test" }, 500);
        const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 5 });
        assert.equal(observation.outcome, "done");
        assert.equal(observation.vendor, "grok");
        assert.equal(observation.harness, "grok-cli");
        assert.equal(observation.turn_id, "prompt-test");
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("dispatch/observe: Claudeの同一PTY follow-upをStop resultと相関して回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_FOLLOWUP_PROMPT");
    assert.equal(receipt.harness, "claude-code");
    setTimeout(() => writeClaudeDone(meta, "Claude follow-up answer", {
      vendor_session_id: meta.vendor_session_id,
    }), 200);
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
    assert.equal(observation.outcome, "done");
    assert.equal(observation.vendor, "claude");
    assert.equal(observation.harness, "claude-code");
    assert.equal(observation.vendor_session_id, meta.vendor_session_id);
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /CLAUDE_FOLLOWUP_PROMPT/);
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude follow-up answer/);
    assert.match(transcript, /agent_transcript vendor=claude turn_id=unknown/);
    assert.match(transcript, /harness=claude-code/);
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claude timeout後は再送せず後着resultを同一sessionから回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_TIMEOUT_PROMPT");
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
    assert.equal(observation.outcome, "running");
    assert.equal(observation.vendor, "claude");
    assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "timeout後も同じsessionを残す");

    writeClaudeDone(meta, "Claude late answer", {
      vendor_session_id: meta.vendor_session_id,
    });
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude late answer/);
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation回収: 古いR1を新しいO2へ誤帰属せずO2だけを返す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"1".repeat(64)}`;
  const operation2 = `sha256:${"2".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    writeClaudeDone(meta, "old R1", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operation1,
    });

    await assert.rejects(
      () => core.readAgentTranscript(sid, { operation_id: operation2 }),
      /operation.*まだ完了していません|一致する.*operation/i,
    );

    writeClaudeDone(meta, "new R2", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operation2,
    });
    const out = await core.readAgentTranscript(sid, { operation_id: operation2 });
    assert.match(out, /new R2/);
    assert.doesNotMatch(out, /old R1/);
    assert.match(out, new RegExp(`operation_id=${operation2}`));
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claude operation_idをmarker・完了suffix・timeout後回収へ通す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"3".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_TIMEOUT", { operation_id: operationId });
    assert.equal(receipt.operation_id, operationId);
    const observation = await core.observeAgentDone(sid, {
      cursor: receipt.event_cursor,
      operation_id: operationId,
      timeout: 0,
    });
    assert.equal(observation.outcome, "running");
    assert.equal(observation.operation_id, operationId);
    const marker = JSON.parse(fs.readFileSync(
      path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`),
      "utf8",
    ));
    assert.equal(marker.operation_id, operationId);

    writeClaudeDone(meta, "late operation answer", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: operationId,
    });
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /late operation answer/);
    assert.match(recovered, new RegExp(`operation_id=${operationId}`));
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: timeoutしたissueはaccepted、同じoperationだけをpendingからexact resultへ回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"b".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");

    const issued = await core.runClaudeOperation({
      session_id: sid,
      action: "issue",
      operation_id: operationId,
      text: "STRUCTURED_TIMEOUT_PROMPT",
      timeout: 0,
    });
    // submit_residue は fake TUI の画面内容に依存する観測値なので型だけ固定し、他は exact 一致で固定する
    assert.ok(
      issued.submit_residue === null || typeof issued.submit_residue === "boolean",
      `issue は submit 座礁観測を返す: ${JSON.stringify(issued)}`,
    );
    delete issued.submit_residue;
    assert.deepEqual(issued, {
      schema: "aiterm.claude-operation-result.v1", action: "issue", status: "accepted",
      session_id: sid, operation_id: operationId, raw_output: null, reason: null,
    });
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: operationId }),
      {
        schema: "aiterm.claude-operation-result.v1", action: "recover", status: "pending",
        session_id: sid, operation_id: operationId, raw_output: null, reason: null, submit_residue: null,
      },
    );
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /STRUCTURED_TIMEOUT_PROMPT/);

    const hook = invokeClaudeStopHook(meta, "structured exact raw output", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: operationId }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "completed",
        session_id: sid,
        operation_id: operationId,
        raw_output: "structured exact raw output",
        reason: null,
        submit_residue: null,
      },
    );
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: 未dispatchとreceiptだけのoperationをunknown理由別に固定する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const undispatched = `sha256:${"0".repeat(64)}`;
  const receiptOnly = `sha256:${"f".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    // v0.16.0: runClaudeOperation から timeout パラメータ自体が削除された（型からも消えた）。
    // 実装は destructuring で未知キーを黙って無視するだけで、"recoverにtimeoutは指定できません"
    // という拒否は現 core.ts に存在しない（grep で確認済み）。旧テストが検証していたrejectを
    // 期待側の実挙動（無視されて通常のunknown結果が返る）へ合わせる。
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: undispatched }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "unknown",
        session_id: sid,
        operation_id: undispatched,
        raw_output: null,
        reason: "operation_not_found",
        submit_residue: null,
      },
    );
    fs.writeFileSync(claudeDispatchReceiptPath(meta, receiptOnly), "", { mode: 0o600 });
    assert.deepEqual(
      await core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: receiptOnly }),
      {
        schema: "aiterm.claude-operation-result.v1",
        action: "recover",
        status: "unknown",
        session_id: sid,
        operation_id: receiptOnly,
        raw_output: null,
        reason: "result_unknown",
        submit_residue: null,
      },
    );
  } finally {
    core.closeSession(sid);
  }
});

test("runClaudeOperation: 別active operationとmalformed markerをstructured結果へ降格しない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const active = `sha256:${"6".repeat(64)}`;
  const other = `sha256:${"7".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.runClaudeOperation({
      session_id: sid,
      action: "issue",
      operation_id: active,
      text: "ACTIVE_OPERATION",
      timeout: 0,
    });
    await assert.rejects(
      () => core.runClaudeOperation({
        session_id: sid,
        action: "issue",
        operation_id: other,
        text: "MUST_NOT_INTERLEAVE",
        timeout: 0,
      }),
      /別のoperation|未解決/,
    );

    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    fs.writeFileSync(marker, "{malformed\n", { mode: 0o600 });
    await assert.rejects(
      () => core.runClaudeOperation({ session_id: sid, action: "recover", operation_id: active }),
      /marker.*(?:不正|読めません)|JSON/,
    );
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation E2E fixture: core dispatch markerを実Stop hookが消費し同じIDで回収する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"c".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_E2E", { operation_id: operationId });
    const hook = invokeClaudeStopHook(meta, "hook-correlated E2E answer", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /hook-correlated E2E answer/);
    assert.match(recovered, new RegExp(`operation_id=${operationId}`));
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_OPERATION_E2E_REPLAY", { operation_id: operationId }),
      /既にdispatch済み/,
    );
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: 別operationのStop eventを期待operationの完了にしない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const expected = `sha256:${"4".repeat(64)}`;
  const other = `sha256:${"5".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_EXPECTED_OPERATION", { operation_id: expected });
    setTimeout(() => writeClaudeDone(meta, "wrong operation answer", {
      vendor_session_id: meta.vendor_session_id,
      operation_id: other,
      consume_marker: false,
    }), 200);
    const observation = await core.observeAgentDone(sid, {
      cursor: receipt.event_cursor,
      operation_id: expected,
      timeout: 1,
    });
    assert.equal(observation.outcome, "timeout");
    assert.equal(observation.operation_id, expected);
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation interrupt: active中の通常入力を拒否しC-c後もStopまでmarkerを保持する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"6".repeat(64)}`;
  const operation2 = `sha256:${"7".repeat(64)}`;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_INTERRUPT_ACTIVE", { operation_id: operationId });
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    const tmuxStateDir = path.join(process.env.TMPDIR, "claude-tmux-sockets");
    const markFile = path.join(tmuxStateDir, `${sid}.mark`);
    const lastcmdFile = path.join(tmuxStateDir, `${sid}.lastcmd`);
    assert.equal(fs.existsSync(marker), true);
    fs.rmSync(markFile, { force: true });
    fs.writeFileSync(lastcmdFile, "before-rejected-send");
    assert.throws(
      () => core.send(sid, "manual follow-up", { enter: false, force: true, mark: true }),
      /相関付きClaude|active|未解決/,
    );
    assert.equal(fs.existsSync(markFile), false, "拒否したmark:trueは偽の完了待ちmarkerを作らない");
    assert.equal(fs.readFileSync(lastcmdFile, "utf8"), "before-rejected-send", "拒否した送信はlastcmdも変えない");
    fs.writeFileSync(markFile, "existing-mark");
    assert.throws(
      () => core.send(sid, "manual follow-up", { enter: false, force: true, mark: false }),
      /相関付きClaude|active|未解決/,
    );
    assert.equal(fs.readFileSync(markFile, "utf8"), "existing-mark", "拒否したmark:falseは既存markerを消さない");
    assert.throws(() => core.sendKey(sid, "Enter"), /C-c|active|未解決/);
    assert.match(core.sendKey(sid, "C-c"), /sent key C-c/);
    assert.equal(fs.existsSync(marker), true, "C-c直後も遅延Stopを元operationへ相関する");
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "MUST_WAIT_FOR_INTERRUPTED_STOP", { operation_id: operation2 }),
      /未解決/,
    );

    const hook = invokeClaudeStopHook(meta, "interrupted operation result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    const recovered = await core.readAgentTranscript(sid, { operation_id: operationId });
    assert.match(recovered, /interrupted operation result/);
    await core.dispatchAgentTurn(sid, "SAFE_AFTER_INTERRUPTED_STOP", { operation_id: operation2 });
  } finally {
    core.closeSession(sid);
  }
});

test("claude_approval: active operationと画面digestを結合して単発承認だけを送る", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"7".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(
      sid,
      "printf '\\nThis command changes directory before running git.\\n\\nDo you want to proceed?\\n❯ 1. Yes\\n  2. No\\n'",
      { operation_id: operationId },
    );
    await core.readOutput(sid, { wait: true, until: "2. No", timeout: 5, raw: true });

    assert.throws(
      () => core.runClaudeApproval({ action: "inspect", session_id: sid, operation_id: `sha256:${"6".repeat(64)}` }),
      /active operationが一致しません/,
    );
    const inspected = core.runClaudeApproval({ action: "inspect", session_id: sid, operation_id: operationId });
    assert.equal(inspected.schema, "aiterm.claude-approval-result.v1");
    assert.equal(inspected.status, "approval_required");
    assert.match(inspected.prompt_digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(inspected.choices, [
      { decision: "approve_once", index: 1, label: "Yes" },
      { decision: "deny", index: 2, label: "No" },
    ]);
    assert.throws(
      () => core.runClaudeApproval({
        action: "respond",
        session_id: sid,
        operation_id: operationId,
        approval_choice: "approve_once",
        observed_prompt_digest: `sha256:${"0".repeat(64)}`,
      }),
      /inspect後に変化|再度inspect/,
    );

    const submitted = core.runClaudeApproval({
      action: "respond",
      session_id: sid,
      operation_id: operationId,
      approval_choice: "approve_once",
      observed_prompt_digest: inspected.prompt_digest,
    });
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.selected_choice, "approve_once");
    const approvalReceipt = path.join(agentStateDir(), `${sid}.${meta.launch_id}.claude-approval.json`);
    assert.equal(fs.existsSync(approvalReceipt), true);
    // POSIX permission bit の断言は Windows 非適用（fs.Stats.mode が 0o666 を返すため）。
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(approvalReceipt).mode & 0o777, 0o600, "approval receiptはowner-only");
    }
    assert.equal(JSON.parse(fs.readFileSync(approvalReceipt, "utf8")).prompt_digest, inspected.prompt_digest);
    assert.equal(fs.existsSync(path.join(agentStateDir(), `${sid}.${meta.launch_id}.claude-operation.json`)), true,
      "承認入力はactive operation markerを消費しない");
  } finally {
    core.closeSession(sid);
  }
});

test("claude_approval: 恒久許可だけの選択肢を拒否する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "printf 'Do you want to proceed?\\n1. Yes, and do not ask again\\n2. No\\n'");
    await core.readOutput(sid, { wait: true, until: "2. No", timeout: 5, raw: true });
    assert.throws(
      () => core.runClaudeApproval({ action: "inspect", session_id: sid }),
      /安全な単発Yes\/No選択肢/,
    );
  } finally {
    core.closeSession(sid);
  }
});

test("Claude anonymous turn: timeout中はdurable operationを開始せず遅延Stopを匿名turnへ保持する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"a".repeat(64)}`;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    writeClaudeDone(meta, "old anonymous R1", {
      vendor_session_id: meta.vendor_session_id,
      consume_marker: false,
    });
    await core.dispatchAgentTurn(sid, "CLAUDE_ANONYMOUS_TIMEOUT");
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), {
      schema: "aiterm.claude-operation-marker.v1",
      operation_id: null,
    });
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "MUST_NOT_OVERWRITE_ANONYMOUS", { operation_id: operationId }),
      /operation_idなし.*未解決/,
    );
    await assert.rejects(() => core.readAgentTranscript(sid), /operation_idなし.*まだ完了していません/);

    const hook = invokeClaudeStopHook(meta, "anonymous late result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    const anonymous = await core.readAgentTranscript(sid);
    assert.match(anonymous, /anonymous late result/);
    assert.doesNotMatch(anonymous, /operation_id=/);
    await core.dispatchAgentTurn(sid, "SAFE_DURABLE_AFTER_ANONYMOUS_STOP", { operation_id: operationId });
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation_id: malformed値と非Claude sessionは送信前に拒否する", { skip: skipAgentDone }, async () => {
  const [claude] = core.openAgent("claude", { agent_done: true });
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(claude, "MUST_NOT_SEND", { operation_id: "bad" }),
      /sha256:<64 lowercase hex>/,
    );
    assert.doesNotMatch(fs.readFileSync(sessionLogPath(claude), "utf8"), /MUST_NOT_SEND/);
  } finally {
    core.closeSession(claude);
  }

  await withFakeCodexHome(async () => {
    const [codex] = core.openAgent("codex", { agent_done: true });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(codex, "MUST_NOT_SEND_CODEX", { operation_id: `sha256:${"f".repeat(64)}` }),
        /Claude agent session/,
      );
      assert.doesNotMatch(fs.readFileSync(sessionLogPath(codex), "utf8"), /MUST_NOT_SEND_CODEX/);
    } finally {
      core.closeSession(codex);
    }
  });
});

test("Claude operation dispatch: timeout後の同一ID再送と未解決中の別ID送信を拒否する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"8".repeat(64)}`;
  const operation2 = `sha256:${"9".repeat(64)}`;
  try {
    await markFakeAgentReady(sid, "claude");
    await core.dispatchAgentTurn(sid, "CLAUDE_DISPATCH_ONCE", { operation_id: operation1 });
    // dispatchAgentTurn は send 直後（Stop を待たず）に返る。前面 bash が
    // 「command not found」を出力し終えるまで一呼吸置いてから比較基準を取る（v0.16.0でsend結果の
    // 待機が無くなったため、出力の安定を明示的に待つ必要がある）。
    await core.readOutput(sid, { screen: true, wait: true, timeout: 2 });
    const before = fs.readFileSync(sessionLogPath(sid), "utf8");
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_MUST_NOT_RESEND", { operation_id: operation1 }),
      /既にdispatch済み|再送しません/,
    );
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_MUST_NOT_INTERLEAVE", { operation_id: operation2 }),
      /未解決|回収または手動中断/,
    );
    const after = fs.readFileSync(sessionLogPath(sid), "utf8");
    assert.equal(after, before, "拒否したpromptはPTYへ一文字も送らない");
  } finally {
    core.closeSession(sid);
  }
});

test("Claude operation dispatch: prompt内容を危険判定せず相関を開始する", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operation1 = `sha256:${"d".repeat(64)}`;
  const operation2 = `sha256:${"e".repeat(64)}`;
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const marker = path.join(path.dirname(meta.result_file), `${sid}.${meta.launch_id}.claude-operation.json`);
    await core.dispatchAgentTurn(sid, "Explain why DROP TABLE is dangerous", { operation_id: operation1 });
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).operation_id, operation1);

    const hook = invokeClaudeStopHook(meta, "preflight operation result", meta.vendor_session_id);
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.equal(fs.existsSync(marker), false);
    await core.dispatchAgentTurn(sid, "SAFE_NEW_OPERATION", { operation_id: operation2 });
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: Claudeは既知vendor_session_idと一致しないeventを完了扱いしない", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_INVALID_VENDOR_SESSION");
    setTimeout(() => {
      fs.appendFileSync(meta.event_file, agentDoneLine(meta, { vendor_session_id: undefined }));
      fs.appendFileSync(meta.event_file, agentDoneLine(meta, { vendor_session_id: "" }));
    }, 200);
    const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
    assert.equal(observation.outcome, "timeout");
    assert.equal(observation.vendor, "claude");
    assert.equal(observation.malformed_events, 0, "別vendor sessionのeventは破損でなく非該当として無視する");
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    core.closeSession(sid);
  }
});

test("dispatch/observe: 起動時 prompt が未完了なら follow-up を送信前に拒否する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true, prompt: "Reply READY." });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /起動時 prompt の完了待ち/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});

// v0.16.0: wait/timeout/screen/lines オプションは openAgentWithInitialPrompt から削除された
// （旧 "openAgentWithInitialPrompt: wait agent_done は prompt と agent_done:true を必須にする" は
// 概念ごと消滅したため削除）。

test("openAgentWithInitialPrompt: TUI ready 失敗は明示エラーにし prompt を送らず session を残す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    let sid = null;
    try {
      await assert.rejects(
        core.openAgentWithInitialPrompt("codex", {
          prompt: "Reply READY.",
          agent_done: true,
          ready_timeout: 0,
        }),
        (e) => {
          assert.equal(e.initial_prompt.status, "not_sent");
          assert.equal(e.initial_prompt.turn_started, false);
          assert.equal(typeof e.session_id, "string");
          assert.match(e.message, /initial_prompt=not_sent/, `ready failure error: ${e.message}`);
          assert.match(e.message, /session は調査\/復旧用に残しています/, `session保全の明示: ${e.message}`);
          sid = e.message.match(/session_id: (\S+)/)?.[1] ?? null;
          return true;
        },
      );
      assert.ok(sid, "エラーメッセージに session_id を含める");
      assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "session は調査用に残す");
      const meta = readAgentMeta(sid);
      assert.equal(meta.initial_prompt, "not_sent");
    } finally {
      if (sid) core.closeSession(sid);
    }
  });
});

test("openAgentWithInitialPrompt: Claudeの無人起動確認とworkspace trustを順に承認して初回promptを送る", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTrustTuiBin();
  const sid = `claude_trust_${Date.now().toString(36)}`;
  const marker = "SHOULD_NOT_BE_SENT_TO_TRUST_MENU";
  process.env.CLAUDE_BIN = fakeBin;
  try {
    const result = await core.openAgentWithInitialPrompt("claude", {
      session_name: sid,
      prompt: marker,
      ready_timeout: 5_000,
    });
    assert.equal(result[0], sid);
    const meta = readAgentMeta(sid);
    assert.equal(meta.initial_prompt, "pending");
    assert.equal(fs.statSync(meta.event_file).size, 0, "completion eventを偽造しない");
    assert.equal(fs.statSync(meta.result_file).size, 0, "Claude resultを偽造しない");
    const screen = await core.readOutput(sid, { screen: true, raw: true });
    assert.match(screen, /BYPASS_ACCEPTED:/);
    assert.match(screen, /TRUST_ACCEPTED:/);
    assert.match(screen, new RegExp(marker));
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

// 実被弾 2026-08-25 の実機capture逐語（Codex v0.149.0）。ダイアログ表示中はheader/footerが
// 描かれないため、codexTuiReady では拾えず codexLaunchBlockingDialog が種別を特定する。
test("codexLaunchBlockingDialog: 起動前modalの実機画面を種別付きで検知する", () => {
  const updateScreen = [
    "  ✨ Update available! 0.149.0 -> 0.149.1",
    "",
    "  Release notes: https://github.com/openai/codex/releases/latest",
    "",
    "› 1. Update now (runs `npm install -g @openai/codex`)",
    "  2. Skip",
    "  3. Skip until next version",
    "",
    "  Press enter to continue",
  ].join("\n");
  assert.match(codexHarness.codexLaunchBlockingDialog(updateScreen), /update確認/);
  assert.equal(codexHarness.codexLaunchBlockingDialog([
    "✨ Update available! 0.151.0 -> 0.152.1",
    "Run npm install -g @openai/codex to update.",
    "OpenAI Codex (v0.151.0)",
    "› Ask Codex to do anything",
  ].join("\n")), null);
  const trustScreen = [
    "You are in /Users/kite/Developer/poly",
    "Do you trust the contents of this directory?",
    "Working with untrusted contents comes with higher risk of prompt injection.",
    "› 1. Yes, continue",
    "  2. No, quit",
    "Press enter to continue",
  ].join("\n");
  assert.match(codexHarness.codexLaunchBlockingDialog(trustScreen), /trust確認/);
  assert.match(codexHarness.codexLaunchBlockingDialog("something\nPress enter to continue"), /種別未特定/);
  assert.equal(codexHarness.codexLaunchBlockingDialog("› Ask Codex to do anything\n  gpt-5.6-luna low · ~/x"), null);
});

test("codexTuiReady: 現行Codexのdefault effort footerを入力待ちとして認識する", () => {
  const screen = [
    "• 承知しました。次のメッセージをお待ちしています。",
    "",
    "› Ask Codex to do anything",
    "",
    "  gpt-5.6-sol default · /srv/bellteam/bots/bot-93433892",
  ].join("\n");
  assert.equal(codexHarness.codexTuiReady(screen), true);
});

test("openAgentWithInitialPrompt: 終了したharnessの残画面へpromptを送らない", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin(false, true);
  process.env.CODEX_BIN = fakeBin;
  const sid = `initial_exited_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await assert.rejects(core.openAgentWithInitialPrompt("codex", { session_name: sid, prompt: "SHOULD_NOT_REACH_SHELL" }), error => {
        assert.equal(error.initial_prompt.status, "not_sent");
        assert.equal(error.initial_prompt.reason, "harness_exited");
        return true;
      });
      const output = await core.readOutput(sid, { screen: true, raw: true });
      assert.ok(!output.includes("SHOULD_NOT_REACH_SHELL"));
    });
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("observeSession: SIGSTOPしたharnessを残画面に関係なくblockedにする", { skip: skipAgentDone || process.platform === "win32" }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  const sid = `observe_stopped_${Date.now().toString(36)}`;
  let pid;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", { session_name: sid, trust_project: true });
      pid = core.observeSession(sid).harness_process.pid;
      process.kill(pid, "SIGSTOP");
      await new Promise(resolve => setTimeout(resolve, 100));
      const stopped = core.observeSession(sid);
      assert.equal(stopped.harness_alive, true);
      assert.equal(stopped.state, "blocked");
      assert.equal(stopped.reason, "harness_stopped");
    });
  } finally {
    if (pid) process.kill(pid, "SIGCONT");
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: 送信後の実行表示だけを開始確認に使う", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin(true);
  process.env.CODEX_BIN = fakeBin;
  const sid = `initial_started_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      const result = await core.openAgentWithInitialPrompt("codex", { session_name: sid, prompt: "開始確認" });
      assert.deepEqual(result[4], { status: "started", reason: "turn_running", turn_started: true });
    });
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: prompt を shell argv に載せず pending event_cursor を返す", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  try {
    await withFakeCodexHome(async () => {
      const sid = `initial_success_${Date.now().toString(36)}`;
      const marker = "AITERM_OPEN_AGENT_INITIAL_OK";
      try {
        const [actualSid, out, launchCursor, submitResidue, initialDelivery] = await core.openAgentWithInitialPrompt("codex", {
          session_name: sid,
          prompt: `日本語の複数行 prompt です。\n${marker}\nこの token だけを返してください。`,
          agent_done: true,
        });
        assert.equal(actualSid, sid);
        assert.equal(initialDelivery.status, "submitted_unconfirmed");
        assert.equal(initialDelivery.turn_started, null);
        assert.match(out, /initial_prompt=pending vendor=codex event_cursor=\d+/, `pending hint: ${out}`);
        assert.ok(
          submitResidue === null || typeof submitResidue === "boolean",
          `submit_residue を構造化して返す: ${JSON.stringify(submitResidue)}`,
        );
        assert.doesNotMatch(out, /> .*AITERM_OPEN_AGENT_INITIAL_OK/, `shell continuation に prompt を載せない: ${out}`);
        const meta = readAgentMeta(sid);
        assert.equal(meta.initial_prompt, "pending");
        assert.equal(typeof launchCursor, "number", "構造化 event_cursor を返す");
        assert.match(out, new RegExp(`event_cursor=${launchCursor}\\b`), "hint と構造化 cursor が一致する");
        appendCodexDone(meta, { turn_id: "open-agent-initial", vendor_session_id: "open-agent-vendor" });
        const observation = await core.observeAgentDone(sid, { cursor: launchCursor, timeout: 3 });
        assert.equal(observation.outcome, "done");
        assert.equal(observation.turn_id, "open-agent-initial");
        assert.equal(observation.vendor_session_id, "open-agent-vendor");
      } finally {
        try {
          core.closeSession(sid);
        } catch {
          /* noop */
        }
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("portable fork: Codex TUIへThroughline contextをmissionより前に一度だけ送る", { skip: skipAgentDone }, async () => {
  const savedCodexBin = process.env.CODEX_BIN;
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const fakeCodex = makeFakeCodexTuiBin();
  const fakeThroughline = makeFakeThroughlineBin();
  process.env.CODEX_BIN = fakeCodex;
  process.env.THROUGHLINE_BIN = fakeThroughline;
  const sid = `portable_codex_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", {
        session_name: sid,
        prompt: "MISSION_MARKER を実行してください。",
        throughline_source_session: "source-session",
      });
      const output = await core.readOutput(sid, {
        wait: true,
        until: "MISSION_MARKER",
        timeout: 5,
        full: true,
        raw: true,
      });
      assert.ok(output.indexOf("SOURCE_CONTEXT_MARKER") < output.indexOf("MISSION_MARKER"), output);
      assert.match(output, /---\\n\\n## Portable fork mission/);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedCodexBin;
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    fs.rmSync(fakeCodex, { force: true });
    fs.rmSync(fakeThroughline, { force: true });
  }
});

test("portable fork: 補足JSON pathを解釈せずThroughlineへ渡す", { skip: skipAgentDone }, async () => {
  const savedCodexBin = process.env.CODEX_BIN;
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const fakeCodex = makeFakeCodexTuiBin();
  const fakeThroughline = makeFakeThroughlineBin(undefined, "SUPPLEMENT_MARKER_PATH");
  process.env.CODEX_BIN = fakeCodex;
  process.env.THROUGHLINE_BIN = fakeThroughline;
  const sid = `portable_supplement_${Date.now().toString(36)}`;
  try {
    await withFakeCodexHome(async () => {
      await core.openAgentWithInitialPrompt("codex", {
        session_name: sid,
        prompt: "MISSION_MARKER",
        throughline_source_session: "source-session",
        throughline_supplement_file: "SUPPLEMENT_MARKER_PATH",
      });
      const output = await core.readOutput(sid, {
        wait: true,
        until: "MISSION_MARKER",
        timeout: 5,
        full: true,
        raw: true,
      });
      assert.match(output, /SOURCE_CONTEXT_MARKER/);
    });
  } finally {
    try { core.closeSession(sid); } catch {}
    if (savedCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedCodexBin;
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    fs.rmSync(fakeCodex, { force: true });
    fs.rmSync(fakeThroughline, { force: true });
  }
});

test("portable fork: Grok TUI promptも同じcontext→mission順で合成する", { skip: skipGrokFakeBin }, async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const savedGrokBin = process.env.GROK_BIN;
  const fakeThroughline = makeFakeThroughlineBin();
  const fakeGrok = makeFakeGrokTuiBin();
  process.env.THROUGHLINE_BIN = fakeThroughline;
  process.env.GROK_BIN = fakeGrok;
  let sid = null;
  try {
    await withFakeGrokHome(async () => {
      [sid] = await core.openAgentWithInitialPrompt("grok", {
        prompt: "MISSION_MARKER を実行してください。",
        throughline_source_session: "source-session",
      });
      const output = await core.readOutput(sid, { wait: true, timeout: 5, full: true, raw: true });
      assert.ok(output.indexOf("SOURCE_CONTEXT_MARKER") < output.indexOf("MISSION_MARKER"), output);
      assert.match(output, /Portable fork mission/);
    });
  } finally {
    if (sid) {
      try { core.closeSession(sid); } catch {}
    }
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    if (savedGrokBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedGrokBin;
    fs.rmSync(fakeThroughline, { force: true });
    fs.rmSync(fakeGrok, { force: true });
  }
});

test("portable fork: contextは加工せず一度だけmissionの前へ合成する", () => {
  const context = "CONTEXT_MARKER\n記憶本文";
  const mission = "MISSION_MARKER\n実装してください";
  const prompt = core.composePortableForkPrompt(context, mission);
  assert.equal(prompt, `${context}\n\n---\n\n## Portable fork mission\n\n${mission}`);
  assert.equal(prompt.split("CONTEXT_MARKER").length - 1, 1);
  assert.ok(prompt.indexOf("CONTEXT_MARKER") < prompt.indexOf("MISSION_MARKER"));
});

test("portable fork: Throughline外部境界の失敗はPTY作成前に明示拒否する", async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const invalidSchema = makeBrokenThroughlineBin("{}");
  const emptyContext = makeBrokenThroughlineBin(JSON.stringify({
    schema: "throughline.handoff_context.v1",
    status: "ready",
    sessionId: "source-session",
    context: "",
  }));
  const nonzero = makeBrokenThroughlineBin("", 7);
  const cases = [
    path.join(process.env.TMPDIR, "missing-throughline"),
    invalidSchema,
    emptyContext,
    nonzero,
  ];
  try {
    for (const bin of cases) {
      process.env.THROUGHLINE_BIN = bin;
      const before = core.listSessions();
      await assert.rejects(
        core.openAgentWithInitialPrompt("codex", {
          prompt: "MISSION_MARKER",
          throughline_source_session: "source-session",
        }),
        /Throughline/,
      );
      assert.equal(core.listSessions(), before, `${bin}: 外部失敗でsessionを作らない`);
    }
  } finally {
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    for (const bin of [invalidSchema, emptyContext, nonzero]) fs.rmSync(bin, { force: true });
  }
});

test("portable fork: source省略時はThroughlineを起動せず既存clean launchを維持する", { skip: skipGrokFakeBin }, async () => {
  const savedThroughlineBin = process.env.THROUGHLINE_BIN;
  const savedGrokBin = process.env.GROK_BIN;
  const broken = makeBrokenThroughlineBin("", 7);
  const fakeGrok = makeFakeGrokTuiBin();
  process.env.THROUGHLINE_BIN = broken;
  process.env.GROK_BIN = fakeGrok;
  let sid = null;
  try {
    await withFakeGrokHome(async () => {
      [sid] = await core.openAgentWithInitialPrompt("grok", { prompt: "CLEAN_MISSION_MARKER" });
      const output = await core.readOutput(sid, { wait: true, timeout: 5, full: true, raw: true });
      assert.match(output, /CLEAN_MISSION_MARKER/);
      assert.doesNotMatch(output, /Portable fork mission/);
    });
  } finally {
    if (sid) {
      try { core.closeSession(sid); } catch {}
    }
    if (savedThroughlineBin === undefined) delete process.env.THROUGHLINE_BIN;
    else process.env.THROUGHLINE_BIN = savedThroughlineBin;
    if (savedGrokBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedGrokBin;
    fs.rmSync(broken, { force: true });
    fs.rmSync(fakeGrok, { force: true });
  }
});

test("openAgentWithInitialPrompt: Grokもargv queueでなくTUI dispatchのpending cursorを返す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fakeBin = makeFakeGrokTuiBin();
  process.env.GROK_BIN = fakeBin;
  let sid = null;
  let launchCursor = null;
  let submitResidue = null;
  try {
    await withFakeGrokHome(async () => {
      [sid, , launchCursor, submitResidue] = await core.openAgentWithInitialPrompt("grok", {
        session_name: `initial_grok_${Date.now().toString(36)}`,
        model: "grok-4.6",
        reasoning_effort: "medium",
        prompt: "GROK_TUI_DISPATCH_MARKER",
      });
      assert.equal(typeof launchCursor, "number");
      assert.ok(submitResidue === null || typeof submitResidue === "boolean");
      assert.equal(readAgentMeta(sid).initial_prompt, "pending");
      const output = await core.readOutput(sid, { wait: true, until: "GROK_TUI_DISPATCH_MARKER", timeout: 5, full: true, raw: true });
      assert.match(output, /GROK_TUI_DISPATCH_MARKER/);
    });
  } finally {
    if (sid) { try { core.closeSession(sid); } catch {} }
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("portable fork: mission必須かつlaunch_operation_idとは排他", async () => {
  const before = core.listSessions();
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", { throughline_source_session: "source-session" }),
    /promptにmissionが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      prompt: "MISSION_MARKER",
      throughline_supplement_file: "SUPPLEMENT_MARKER_PATH",
    }),
    /throughline_source_sessionが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      prompt: "MISSION_MARKER",
      throughline_source_session: "source-session",
      launch_operation_id: `sha256:${"a".repeat(64)}`,
    }),
    /launch_operation_idと併用できません/,
  );
  assert.equal(core.listSessions(), before);
});

test("openAgentWithInitialPrompt: Claude初回promptを対話PTYへ送りpending event_cursorを返す", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin();
  process.env.CLAUDE_BIN = fakeBin;
  const sid = `claude_initial_${Date.now().toString(36)}`;
  const marker = "AITERM_CLAUDE_INITIAL_OK";
  try {
    const [actualSid, out] = await core.openAgentWithInitialPrompt("claude", {
      session_name: sid,
      prompt: `日本語の初回promptです。\n${marker}`,
      agent_done: true,
    });
    assert.equal(actualSid, sid);
    assert.match(out, /initial_prompt=pending vendor=claude event_cursor=\d+/, `pending hint: ${out}`);
    const meta = readAgentMeta(sid);
    assert.equal(meta.initial_prompt, "pending");
    writeClaudeDone(meta, "Claude initial answer", { vendor_session_id: meta.vendor_session_id });
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /Claude initial answer/);
    assert.equal(readAgentMeta(sid).vendor_session_id, meta.vendor_session_id);
  } finally {
    try {
      core.closeSession(sid);
    } catch {
      /* noop */
    }
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgentWithInitialPrompt: 起動後 error でも session_id を失わない", { skip: skipAgentDone }, async () => {
  // v0.16.0: sendInitialAgentPrompt はevent到着を待たないfire-and-forgetになったため、旧来の
  // 「Stop eventの複数vendor_session_id混在」は初回prompt処理中にはもう起こらない
  // （bindCompletedInitialPromptは次回follow-upのdispatchAgentTurn時にしか走らない）。
  // 新契約でも決定的に再現できる送信前拒否（MAX_SEND_BYTES超過）へ置き換える。
  const savedBin = process.env.CODEX_BIN;
  const fakeBin = makeFakeCodexTuiBin();
  process.env.CODEX_BIN = fakeBin;
  try {
    await withFakeCodexHome(async () => {
      const sid = `initial_error_${Date.now().toString(36)}`;
      const oversizedPrompt = "x".repeat(70 * 1024);
      try {
        await assert.rejects(
          () =>
            core.openAgentWithInitialPrompt("codex", {
              session_name: sid,
              prompt: oversizedPrompt,
              agent_done: true,
            }),
          (e) => e.code === 2 && e.message.includes(`session_id: ${sid}`) && /bytesを超えています/.test(e.message),
        );
        assert.match(core.listSessions(), new RegExp(`(^|\\n)${sid}\\t`), "失敗後も session は残す");
        assert.equal(readAgentMeta(sid).initial_prompt, "failed");
      } finally {
        try {
          core.closeSession(sid);
        } catch {
          /* noop */
        }
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("sendInitialAgentPrompt: 初回 prompt の内容を評価せず専用 boundary で送信する", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const out = await core.sendInitialAgentPrompt(sid, "explain what rm -rf / does");
      assert.match(out.text, /initial_prompt=pending vendor=codex event_cursor=\d+/, `pending hint: ${out.text}`);
      assert.equal(typeof out.event_cursor, "number", "構造化 event_cursor を返す");
      appendCodexDone(meta, { turn_id: "initial-turn", vendor_session_id: "initial-vendor" });
      const observation = await core.observeAgentDone(sid, { cursor: out.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done");
      assert.equal(observation.turn_id, "initial-turn");
      const updated = readAgentMeta(sid);
      assert.equal(updated.initial_prompt, "pending");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("sendInitialAgentPrompt: 送信後は常に pending 文字列を返し成功扱いしない", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const out = await core.sendInitialAgentPrompt(sid, "echo INITIAL_TIMEOUT_BODY");
      assert.match(out.text, /initial_prompt=pending vendor=codex event_cursor=\d+/, `pending hint: ${out.text}`);
      const meta = readAgentMeta(sid);
      assert.equal(meta.initial_prompt, "pending");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("sendInitialAgentPrompt: 送信後は pending にし follow-up を送信前に拒否する", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const hint = await core.sendInitialAgentPrompt(sid, "Reply READY.");
      assert.match(hint.text, /initial_prompt=pending/, `pending hint: ${hint.text}`);
      const meta = readAgentMeta(sid);
      assert.equal(meta.initial_prompt, "pending");
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /起動時 prompt/.test(e.message),
      );
      assert.throws(
        () => core.send(sid, "echo SHOULD_NOT_BE_SENT"),
        (e) => e.code === 2 && /混入防止/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: agent event は補助 metadata に出すが completion には昇格しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, { turn_id: "stale-read-turn", vendor_session_id: "stale-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent vendor=codex harness=codex-cli/, `agent metadata: ${out}`);
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /completion_attribution=none/, `agent attribution: ${out}`);
      assert.match(out, /last_turn_id=stale-read-turn/, `agent turn id: ${out}`);
      assert.doesNotMatch(out, /is_complete=True via agent_done/, `stale event を completion にしない: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: 1MB 超の agent event tail でも最新 metadata を表示する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "tail-vendor", []);
      fs.appendFileSync(transcript, "not-json\n".repeat(140_000));
      appendCodexDone(meta, { turn_id: "tail-read-turn", vendor_session_id: "tail-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /last_turn_id=tail-read-turn/, `agent turn id: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readOutput: 非 agent metadata negative-cache は close/openAgent で無効化される", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const session = "negativecache";
    core.openSession(session);
    // screen 内容はプロンプト描画タイミングで揺れるため同一比較しない（CI 実測 flake）。
    // 不変条件は「非 agent read には agent suffix が付かない（cache 有無に関わらず）」の方。
    const first = await core.readOutput(session, { screen: true, timeout: 0 });
    const second = await core.readOutput(session, { screen: true, timeout: 0 });
    assert.doesNotMatch(first, /\[agent /, "非 agent read に agent suffix は付かない（cache 前）");
    assert.doesNotMatch(second, /\[agent /, "非 agent read に agent suffix は付かない（cache 中）");
    core.closeSession(session);

    const [sid] = core.openAgent("codex", { session_name: session, agent_done: true });
    try {
      await markFakeAgentReady(sid);
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, { turn_id: "cache-cleared-turn", vendor_session_id: "cache-cleared-vendor" });
      const out = await core.readOutput(sid, { screen: true, timeout: 0 });
      assert.match(out, /agent_event_seen=true/, `agent event seen: ${out}`);
      assert.match(out, /last_turn_id=cache-cleared-turn/, `agent turn id: ${out}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: agent TUI ready 前は送信前に拒否し文字を流さない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await assert.rejects(
        () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT", { ready_timeout: 0 }),
        (e) => e.code === 2 && /入力受付状態/.test(e.message),
      );
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: 起動直後のClaudeはcomposer描画前に送信せず、初回dispatchもready gateを通す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "CLAUDE_COLD_START_PROMPT", { ready_timeout: 0 }),
      (e) => e.code === 2 && /入力受付状態/.test(e.message),
    );
    const out = await core.readOutput(sid, { screen: true, raw: true });
    assert.doesNotMatch(out, /CLAUDE_COLD_START_PROMPT/);
    await markFakeAgentReady(sid, "claude");
    const receipt = await core.dispatchAgentTurn(sid, "CLAUDE_COLD_START_PROMPT", { ready_timeout: 1000 });
    assert.equal(receipt.harness, "claude-code");
    assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /CLAUDE_COLD_START_PROMPT/);
  } finally {
    core.closeSession(sid);
  }
});

test("steerAgentTurn: 実行中のCodexへ現在ターンの追加メッセージを送る", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      core.send(sid, "printf 'OpenAI Codex\\n• Working (1s • esc to interrupt)\\n'", {
        force: true,
        raw: true,
        preserveAgentOperation: true,
      });
      await core.readOutput(sid, { wait: true, until: "esc to interrupt", timeout: 5, raw: true });
      const receipt = await core.steerAgentTurn(sid, "echo STEER_BODY");
      assert.equal(receipt.schema, "aiterm.agent-steer.v1");
      assert.equal(receipt.vendor, "codex");
      assert.equal(receipt.harness, "codex-cli");
      assert.equal(receipt.delivery, "steered");
      const out = await core.readOutput(sid, { wait: true, until: "STEER_BODY", timeout: 5, raw: true });
      assert.match(out, /STEER_BODY/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("steerAgentTurn: idle中は次ターンとして送信しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.steerAgentTurn(sid, "echo MUST_NOT_STEER");
      assert.equal(receipt.delivery, "idle");
      const out = await core.readOutput(sid, { screen: true, raw: true });
      assert.doesNotMatch(out, /MUST_NOT_STEER/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: Grokは現在のidle composerが見えればtranscript初期化eventを要求しない", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const fakeBin = makeFakeGrokTuiBin();
  process.env.GROK_BIN = fakeBin;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        await core.readOutput(sid, { wait: true, until: "ready", timeout: 5, raw: true });
        const receipt = await core.dispatchAgentTurn(sid, "SEND_WITH_VISIBLE_IDLE_COMPOSER", { ready_timeout: 1000 });
        assert.equal(typeof receipt.event_cursor, "number");
        const out = await core.readOutput(sid, { wait: true, until: "SEND_WITH_VISIBLE_IDLE_COMPOSER", timeout: 5, raw: true });
        assert.match(out, /SEND_WITH_VISIBLE_IDLE_COMPOSER/);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("observeAgentDone: 送信前の古い task_complete を follow-up done と誤認しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true, prompt: "Reply READY." });
    try {
      const meta = readAgentMeta(sid);
      appendCodexDone(meta, {
        vendor_session_id: "codex-session-initial",
        turn_id: "initial-turn",
      });
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo FOLLOWUP_BODY");
      assert.ok(
        receipt.submit_residue === null || typeof receipt.submit_residue === "boolean",
        `dispatch receipt に submit_residue 観測を含む: ${JSON.stringify(receipt)}`,
      );
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running", `古い event を拾っていない: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, null, `古い event を完了扱いしない: ${JSON.stringify(observation)}`);
      assert.match(fs.readFileSync(sessionLogPath(sid), "utf8"), /FOLLOWUP_BODY/, "follow-up の出力は送信されている");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: 送信直後の task_complete を transcript cursor から回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo IMMEDIATE_DONE_BODY");
      scheduleCodexDone(meta, {
        vendor_session_id: "codex-session-race",
        turn_id: "race-turn",
      });
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done", `即時 event を拾う: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, "race-turn");
      // v0.16.0: observeAgentDone は純粋な event file リーダーであり、readOutput の増分offset
      // （.offsetファイル）には一切触れない。旧 sendAndWaitAgentDone は自身の戻り値としてPTY出力を
      // 読んでいたため副作用でoffsetを進め、直後の通常read重複が起きなかった。新契約では
      // dispatch/observe のどちらもreadOutputを呼ばないため、直後の通常readはこのターンの出力を
      // 含む（重複しない、という旧保証はもう成立しない）。この変更点は製品仕様として意図されたもの
      // （観測とPTY読み取りの分離）と判断し、旧アサーションは削除した。
    } finally {
      core.closeSession(sid);
    }
  });
});

// v0.16.0: sendAndWaitAgentDone の in-memory busy lock は削除された（dispatchAgentTurn は
// wait しないため二重waitという概念自体が消滅）。「同一 session の二重 wait は busy reject する」
// テストは削除。

test("observeAgentDone: follow-up は前turn後の transcript cursorだけを回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      const receipt1 = await core.dispatchAgentTurn(sid, "echo BIND_ONE");
      appendCodexDone(meta, {
        vendor_session_id: "vendor-session-a",
        turn_id: "bind-one",
      });
      const first = await core.observeAgentDone(sid, { cursor: receipt1.event_cursor, timeout: 3 });
      assert.equal(first.outcome, "done");
      assert.equal(first.turn_id, "bind-one");

      const receipt2 = await core.dispatchAgentTurn(sid, "echo BIND_TWO");
      const beforeSecond = await core.observeAgentDone(sid, { cursor: receipt2.event_cursor, timeout: 0 });
      assert.equal(beforeSecond.outcome, "running", "前turnのtask_completeを再利用しない");
      appendCodexDone(readAgentMeta(sid), { vendor_session_id: "vendor-session-a", turn_id: "bind-two" });
      const second = await core.observeAgentDone(sid, { cursor: receipt2.event_cursor, timeout: 3 });
      assert.equal(second.outcome, "done");
      assert.equal(second.turn_id, "bind-two");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: 後発sub-agent transcriptのtask_completeをroot turnへ誤帰属しない", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      await markFakeAgentReady(sid, "codex");
      appendCodexDone(meta, { vendor_session_id: "root-session", turn_id: "root-first" });
      await core.readAgentTranscript(sid).catch(() => {});
      const receipt = await core.dispatchAgentTurn(sid, "echo ROOT_SECOND");
      writeCodexTranscript(meta, "zzzz-subagent-session", [
        { type: "session_meta", payload: { id: "zzzz-subagent-session" } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: "subagent-turn" } },
      ]);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running");
      assert.notEqual(observation.turn_id, "subagent-turn");
    } finally {
      core.closeSession(sid);
    }
  });
});

// v0.16.0: wait 中の close/killAll 拒否・stale file lock 自動回収は agentWaitLocks／
// acquireAgentWaitFileLock ごと削除された（誰も .wait.lock を取得しなくなった）。旧
// 「wait 中の close/killAll と stale file lock を拒否する」テストは概念ごと削除。

// v0.16.0: agentWaitLocks（in-memory）と acquireAgentWaitFileLock は削除された。
// 「死んだ pid の stale lock は自動回収して待機を再開できる」「古い malformed lock も残骸として
// 回収する」は取得側が消滅したため概念ごと削除。「生きた別プロセスの lock は close/killAll も塞ぐ」は
// closeSessionInternal/killAll の liveWaitLocks によるcross-version安全弁として残り、手で
// lockファイルを作って検証する（sendAndWaitAgentDone による送信拒否検証部分のみ概念消滅のため削除）。
test("agent wait lock: 生きた別プロセスの lock は pid 診断付きで close/killAll を塞ぐ", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    const meta = readAgentMeta(sid);
    const lockPath = path.join(agentStateDir(), `${sid}.${meta.launch_id}.wait.lock`);
    try {
      await markFakeAgentReady(sid, "codex");
      // 生きている外部プロセス＝テストランナーの親 pid を待機者として偽装
      const livePid = process.ppid;
      fs.writeFileSync(lockPath, JSON.stringify({ pid: livePid, at: "2026-01-01T00:00:00Z" }) + "\n", {
        mode: 0o600,
      });
      assert.throws(
        () => core.closeSession(sid),
        (e) => e.code === 2 && new RegExp(`pid ${livePid}`).test(e.message) && /close できません/.test(e.message),
      );
      assert.throws(
        () => core.killAll(),
        (e) => e.code === 2 && /killAll できません/.test(e.message) && new RegExp(`${sid}\\(pid ${livePid}\\)`).test(e.message),
      );
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* noop */
      }
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: partial transcript JSONL fragment は次 poll まで保持する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-partial", []);
      const line = JSON.stringify({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "partial-turn" },
        timestamp: new Date().toISOString(),
      }) + "\n";
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo PARTIAL_BODY");
      setTimeout(() => {
        fs.appendFileSync(transcript, line.slice(0, 20));
        setTimeout(() => {
          fs.appendFileSync(transcript, line.slice(20));
        }, 350);
      }, 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 3 });
      assert.equal(observation.outcome, "done", `分割 JSONL event を拾う: ${JSON.stringify(observation)}`);
      assert.equal(observation.turn_id, "partial-turn");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: malformed 完結 transcript JSONL は malformed_events に数える", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-malformed", []);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo MALFORMED_BODY");
      setTimeout(() => fs.appendFileSync(transcript, '{"type":"event_msg"\n'), 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
      assert.equal(observation.outcome, "timeout");
      assert.equal(observation.malformed_events, 1, `malformed 診断: ${JSON.stringify(observation)}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("observeAgentDone: oversized transcript JSONL 行も malformed_events に数える", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const meta = readAgentMeta(sid);
      const transcript = appendCodexTranscript(meta, "codex-session-oversized", []);
      await markFakeAgentReady(sid, "codex");
      const receipt = await core.dispatchAgentTurn(sid, "echo OVERSIZED_BODY");
      setTimeout(() => fs.appendFileSync(transcript, "x".repeat(1024 * 1024 + 1) + "\n"), 200);
      const observation = await core.observeAgentDone(sid, { cursor: receipt.event_cursor, timeout: 1 });
      assert.equal(observation.outcome, "timeout");
      assert.equal(observation.malformed_events, 1, `oversized 診断: ${JSON.stringify(observation)}`);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("dispatchAgentTurn: 普通のPTY session は送信前に拒否する", { skip: skipAgentDone }, async () => {
  const sid = "plain_agentdone";
  core.openSession(sid);
  try {
    await assert.rejects(
      () => core.dispatchAgentTurn(sid, "echo SHOULD_NOT_BE_SENT"),
      (e) => e.code === 2 && /agent_done 管理セッション/.test(e.message),
    );
    const out = await core.readOutput(sid, { screen: true, raw: true });
    assert.doesNotMatch(out, /SHOULD_NOT_BE_SENT/);
  } finally {
    core.closeSession(sid);
  }
});

// v0.16.0: dispatchAgentTurn に enter オプションは存在しない（渡しても無視される）。
// 「enter:false は送信前に拒否する」は概念ごと削除。

test("openAgent grok: --model grok-4.6 を組み立て、--effort は渡さない", { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo"; // grok 経路を echo で可視化
  try {
    const [sid] = core.openAgent("grok", {});
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--no-auto-update/, `grok no-auto-update: ${out}`);
    assert.match(out, /--model grok-4\.6/, `grok model: ${out}`);
    assert.doesNotMatch(out, /--effort/, `grok effort: ${out}`);
    core.closeSession(sid);
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
  }
});
test("openAgent composer: --model grok-composer-2.5-fast を組み立て、--effort は渡さない（コピペ swap 検出）", { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN;
  process.env.GROK_BIN = fakeGrokBin;
  try {
    const [sid] = core.openAgent("composer", {});
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--no-auto-update/, `composer no-auto-update: ${out}`);
    assert.match(out, /<arg>--model<\/arg>/, `composer model flag: ${out}`);
    assert.match(out, /<arg>grok-composer-2\.5-fast<\/arg>/, `composer model: ${out}`);
    assert.doesNotMatch(out, /--effort/, `composer effort: ${out}`);
    core.closeSession(sid);
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
  }
});

test("openAgent grok/composer: model 引数で既定モデルを上書きする", { skip: skipGrokFakeBin }, async () => {
  const saved = process.env.GROK_BIN;
  const catalogBin = makeGrokCatalogBin(["grok-next", "composer-next"]);
  process.env.GROK_BIN = catalogBin;
  try {
    for (const [kind, model] of [["grok", "grok-next"], ["composer", "composer-next"]]) {
      const [sid] = core.openAgent(kind, { model });
      try {
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /<arg>--model<\/arg>/, `${kind} model flag: ${out}`);
        assert.match(out, new RegExp(`<arg>${model}</arg>`), `${kind} model: ${out}`);
      } finally {
        core.closeSession(sid);
      }
    }
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
    fs.rmSync(catalogBin, { force: true });
  }
});

test("openAgent codex agent_done: model 上書きは共有 config を変更せずCLI引数へ載せる", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      'model = "pinned"\nmodel_reasoning_effort = "ultra"\nkeep_me = true\n\n[mcp_servers.x]\ncommand = "y"\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid, hint] = core.openAgent("codex", { model: "gpt-5.6-terra", agent_done: true });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(hint, /共有 config/);
      assert.match(hint, /proactive 自動委譲/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: model と effort は共有 config を変更せずCLI引数へ載せる", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      'model = "pinned"\nmodel_reasoning_effort = "ultra"\nkeep_me = true\n\n[mcp_servers.x]\ncommand = "y"\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid] = core.openAgent("codex", {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      agent_done: true,
    });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent codex agent_done: quoted top-level pin も共有したまま引数を優先する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    fs.writeFileSync(
      path.join(fakeHome, "config.toml"),
      '"model" = "pinned"\n\'model_reasoning_effort\' = "ultra"\nkeep_me = true\n',
      { mode: 0o600 },
    );
    const configPath = path.join(fakeHome, "config.toml");
    const before = fs.readFileSync(configPath, "utf8");
    const [sid, hint] = core.openAgent("codex", {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      agent_done: true,
    });
    try {
      assert.equal(fs.readFileSync(configPath, "utf8"), before);
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out, /<arg>-m<\/arg>\s*<arg>gpt-5\.6-terra<\/arg>/);
      assert.match(out, /<arg>-c<\/arg>\s*<arg>model_reasoning_effort=high<\/arg>/);
      assert.match(hint, /model=gpt-5\.6-terra（引数） effort=high（引数）/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent: 空/空白 model は session を残さず拒否する", () => {
  // throw 自体は session 作成前＝tmux 不要。残骸ゼロ確認だけ tmux が要る（listSessions）。
  const before = skip ? null : core.listSessions();
  for (const model of ["", "   "]) {
    assert.throws(
      () => core.openAgent("codex", { model }),
      (e) => e.code === 2 && /model が空文字/.test(e.message),
    );
  }
  if (!skip) assert.equal(core.listSessions(), before, "空 model の失敗が session を残した");
});

// A3: env 指定 bin の実在検証（存在しないパスを黙って返して偽成功にしない）。tmux 不要（session 前に throw）。
test("openAgent: 存在しない CODEX_BIN は明示エラー（偽成功にしない・A3）", () => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = "/no/such/codex-bin-aiterm-xyz";
  try {
    assert.throws(
      () => core.openAgent("codex", {}),
      (e) => e.code === 2 && /CODEX_BIN/.test(e.message),
    );
  } finally {
    process.env.CODEX_BIN = saved;
  }
});

test("agent bin: ディレクトリや非実行fileをreadyにしない", () => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = os.tmpdir();
  try {
    assert.equal(core.harnessLauncherDiagnostic("codex"), "unverified");
    assert.throws(
      () => core.openAgent("codex", {}),
      (e) => e.code === 2 && /CODEX_BIN/.test(e.message),
    );
  } finally {
    process.env.CODEX_BIN = saved;
  }
});

// A6: cwd の空文字・~ 未展開を明示エラーに。tmux 不要（bin 解決後・session 前に throw）。
test("openAgent: 空文字 cwd は明示エラー（A6）", () => {
  assert.throws(() => core.openAgent("codex", { cwd: "" }), (e) => e.code === 2 && /空/.test(e.message));
});
test("openAgent: ~ 始まりの cwd は展開されない旨の明示エラー（A6）", () => {
  assert.throws(() => core.openAgent("codex", { cwd: "~/repo" }), (e) => e.code === 2 && /~/.test(e.message));
});

test("readAgentTranscript: Codex の単一 output_text を直近完了 turn から回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-single";
      const turnId = "transcript-turn-single";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        "{ malformed jsonl line",
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Codex single answer" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid);
      assert.match(out, /Codex single answer/);
      assert.match(out, /vendor=codex turn_id=transcript-turn-single harness=codex-cli raw_chars=19/);
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      assert.equal((await core.readAgentTranscriptResult(sid, { completion, raw: true })).text, "Codex single answer");
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: 配送用本文は完了turnを指定して無削減で回収する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "delivery-codex";
      const turnId = "delivery-turn";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      const answer = Array.from({ length: 100 }, (_, i) => `回答 ${i}\n引用符\"`).join("\n");
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: answer } },
      ]);
      const completion = await core.observeAgentDone(sid, { cursor: 0, timeout: 0 });
      appendCodexTranscript(meta, vendorSessionId, [
        { type: "event_msg", payload: { type: "task_complete", turn_id: "later-turn", last_agent_message: "後続の回答" } },
      ]);
      const out = await core.readAgentTranscriptResult(sid, { completion, raw: true });
      assert.equal(out.text, answer);
      assert.equal(out.turn_id, turnId);
      assert.equal(out.raw_chars, answer.length);
      await assert.rejects(core.readAgentTranscriptResult(sid, { completion: { ...completion, launch_id: "b".repeat(32) }, raw: true }), /launchと一致しません/);
    } finally { core.closeSession(sid); }
  });
});

test("配送記録の保存に失敗した初手とfollow-upは、子へ本文を送らない", { skip: skipAgentDone }, async () => {
  await withFakeCodexTuiHome(async () => {
    for (const initial of [true, false]) {
      const [sid] = core.openAgent("codex", { agent_done: true });
      try {
        let recorded;
        const options = { before_send: async (boundary) => { recorded = boundary; throw new Error("配送先の保存失敗"); } };
        const call = initial ? core.sendInitialAgentPrompt(sid, "配送前に止まる本文", options) : core.dispatchAgentTurn(sid, "配送前に止まる本文", options);
        await assert.rejects(call, /配送先の保存失敗/);
        assert.equal(recorded.session_id, sid);
        assert.equal(recorded.launch_id, readAgentMeta(sid).launch_id);
        assert.equal(typeof recorded.event_cursor, "number");
        assert.doesNotMatch(fs.readFileSync(sessionLogPath(sid), "utf8"), /配送前に止まる本文/);
      } finally { core.closeSession(sid); }
    }
  });
});

test("readAgentTranscript: Claudeはprivate transcriptでなくhook-captured resultを検証して返す", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    const vendorSessionId = meta.vendor_session_id;
    const text = "一つの永続Claude sessionが維持した助言";
    const digest = createHash("sha256").update(text, "utf8").digest("hex");
    fs.writeFileSync(meta.result_file, JSON.stringify({
      schema: "aiterm.claude-turn-result.v2",
      operation_id: null,
      vendor_session_id: vendorSessionId,
      result_digest: digest,
      result_bytes: Buffer.byteLength(text, "utf8"),
      text,
    }) + "\n", { mode: 0o600 });
    fs.appendFileSync(meta.event_file, JSON.stringify({
      type: "agent_done",
      vendor: "claude",
      aiterm_session: sid,
      launch_id: meta.launch_id,
      vendor_session_id: vendorSessionId,
      turn_id: null,
      reason: "Stop",
      done_status: "turn_done",
      result_digest: digest,
      result_bytes: Buffer.byteLength(text, "utf8"),
      at: new Date().toISOString(),
    }) + "\n");
    const out = await core.readAgentTranscript(sid);
    assert.match(out, new RegExp(text));
    assert.match(out, /agent_transcript vendor=claude turn_id=unknown/);
    assert.match(out, /harness=claude-code/);

    const forged = JSON.parse(fs.readFileSync(meta.result_file, "utf8"));
    forged.text = "別の本文";
    fs.writeFileSync(meta.result_file, JSON.stringify(forged) + "\n", { mode: 0o600 });
    await assert.rejects(() => core.readAgentTranscript(sid), /完了eventと一致しません/);
  } finally {
    core.closeSession(sid);
  }
});

test("readAgentTranscript: Codex の複数 assistant block を join し lines は末尾へ絞る", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-blocks";
      const turnId = "transcript-turn-blocks";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "first\nsecond" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "third" }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid, { lines: 2 });
      assert.doesNotMatch(out, /first/);
      assert.match(out, /second\nthird/);
      assert.match(out, /raw_chars=12/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: Grok は最後の実 user 入力以降の確定assistantだけを回収する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true, cwd: process.cwd() });
      try {
        const meta = readAgentMeta(sid);
        const vendorSessionId = meta.vendor_session_id;
        appendAgentDone(meta, { turn_id: "transcript-turn-grok" });
        writeGrokTranscript(meta, vendorSessionId, [
          { type: "user", content: "old question" },
          { type: "assistant", content: "old answer" },
          { type: "user", content: "synthetic", synthetic_reason: "resume" },
          { type: "assistant", content: "still old answer" },
          { type: "user", content: "latest question" },
          { type: "reasoning", content: "thinking" },
          { type: "assistant", content: "latest first" },
          { type: "assistant", content: "latest second" },
        ]);
        const result = await core.readAgentTranscriptResult(sid);
        const out = result.display;
        assert.doesNotMatch(out, /old answer|still old answer/);
        assert.doesNotMatch(out, /latest first/);
        assert.match(out, /latest second/);
        assert.match(out, /vendor=grok turn_id=transcript-turn-grok harness=grok-cli/);
        assert.equal(result.text, "latest second");
        assert.equal(result.vendor, "grok");
        assert.equal(result.turn_id, "transcript-turn-grok");
        assert.equal(result.harness, "grok-cli");
        assert.equal(result.raw_chars, 13);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("readAgentTranscript: 非 agent session は既存の明示エラーを返す", async () => {
  await assert.rejects(
    () => core.readAgentTranscript("not_an_agent_transcript"),
    (e) => e.code === 2 && /agent_done 管理セッションではありません/.test(e.message),
  );
});

test("readAgentTranscript: transcript 不在は明示エラーにする", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      bindTranscriptTurn(sid, "transcript-missing", "transcript-turn-missing");
      await assert.rejects(
        () => core.readAgentTranscript(sid),
        (e) => e.code === 2 && /transcript がまだありません/.test(e.message),
      );
    } finally {
      core.closeSession(sid);
    }
  });
});

test("readAgentTranscript: 巨大回答は既存 reduceOutput の行数 bound を通す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const [sid] = core.openAgent("codex", { agent_done: true });
    try {
      const vendorSessionId = "transcript-codex-large";
      const turnId = "transcript-turn-large";
      const meta = bindTranscriptTurn(sid, vendorSessionId, turnId);
      const answer = Array.from({ length: 70 }, (_, i) => `line-${i + 1}`).join("\n");
      writeCodexTranscript(meta, vendorSessionId, [
        { type: "session_meta", payload: { id: vendorSessionId } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: answer }],
            internal_chat_message_metadata_passthrough: { turn_id: turnId },
          },
        },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ]);
      const out = await core.readAgentTranscript(sid);
      assert.match(out, /〈20 行省略。全文は full=true、範囲は line_range="A:B"〉/);
      assert.match(out, /raw_chars=550/);
    } finally {
      core.closeSession(sid);
    }
  });
});

test("openAgent grok: Windows は非native GROK_BIN を session 作成前に拒否する", {
  skip: process.platform !== "win32" ? "Windows 専用の native 強制検証" : (hasTmux ? undefined : "tmux 未インストール"),
}, () => {
  const saved = process.env.GROK_BIN;
  const bin = path.join(process.env.TMPDIR, "fake-grok-nonnative.sh");
  fs.writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.GROK_BIN = bin;
  try {
    assert.throws(() => core.openAgent("grok", {}), /Windows native の grok\.exe/);
  } finally {
    if (saved === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = saved;
    fs.rmSync(bin, { force: true });
  }
});
