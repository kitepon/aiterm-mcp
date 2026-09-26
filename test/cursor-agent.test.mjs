import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { resolveAgentBin } from "../dist/agent-resolver.js";
import {
  bindCursorTranscriptSession,
  buildCursorAgentCmd,
  cursorAgentArgv,
  cursorPwshLaunchLine,
  cursorPromptWithLineage,
  createCursorAgentMetadata,
  cursorTranscriptRoot,
  cursorTranscriptText,
  cursorTurnBoundary,
  cursorWorkspaceId,
  cursorModelArgument,
  cursorEffortNavigation,
  CURSOR_SUBMIT_SEQUENCE,
  latestCursorCompletion,
  observeCursorDone,
  validateCursorModelEffort,
} from "../dist/harnesses/cursor.js";

test("Cursor adapter: Enterをextended keyboard protocolのCSI-u列へ変換する", () => {
  assert.equal(CURSOR_SUBMIT_SEQUENCE, "\x1b[13u");
});

test("Cursor resolver: 曖昧な agent ではなく公式 cursor-agent だけを解決する", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-resolver-"));
  const localBin = path.join(root, ".local", "bin");
  const cursorInstallDir = process.platform === "win32"
    ? path.join(root, "AppData", "Local", "cursor-agent")
    : localBin;
  const cursorAgent = path.join(cursorInstallDir, process.platform === "win32" ? "cursor-agent.cmd" : "cursor-agent");
  const ambiguousAgent = path.join(localBin, process.platform === "win32" ? "agent.cmd" : "agent");
  fs.mkdirSync(localBin, { recursive: true });
  fs.mkdirSync(cursorInstallDir, { recursive: true });
  fs.writeFileSync(cursorAgent, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fs.writeFileSync(ambiguousAgent, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
  const previous = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CURSOR_AGENT_BIN: process.env.CURSOR_AGENT_BIN,
  };
  process.env.HOME = root;
  process.env.PATH = localBin;
  if (process.platform === "win32") process.env.LOCALAPPDATA = path.join(root, "AppData", "Local");
  delete process.env.CURSOR_AGENT_BIN;
  try {
    assert.equal(resolveAgentBin("cursor"), cursorAgent);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cursor adapter: model/effort・無人承認・read-onlyを公式CLI引数へ変換しpluginを要求しない", () => {
  assert.throws(() => validateCursorModelEffort(null, "high"), /reasoning_effort を指定する時は model も指定/);
  assert.throws(() => validateCursorModelEffort("gpt-5[effort=high]", "high"), /二重指定/);
  const meta = {
    kind: "cursor",
    launch_id: "0123456789abcdef0123456789abcdef",
    write_scope: "read-only",
    agent_role: "subagent",
    parent_session_id: "host-root",
    delegation_depth: 1,
    lineage: "host-root>cursor:test",
    delegation_allowed: true,
  };
  const cmd = buildCursorAgentCmd("/opt/Cursor Agent/cursor-agent", "gpt-5.6-sol", "high", "調べて返して", meta);
  assert.match(cmd, /^'\/opt\/Cursor Agent\/cursor-agent'/);
  assert.equal(cursorModelArgument("gpt-5.6-sol", "high"), "gpt-5.6-sol-high");
  assert.match(cmd, /--model 'gpt-5\.6-sol-high'/);
  assert.match(cmd, /--force --approve-mcps --trust/);
  assert.doesNotMatch(cmd, /--plugin-dir/);
  assert.match(cmd, /--mode ask/);
  assert.match(cmd, /AITERM_AGENT_LAUNCH_ID=0123456789abcdef0123456789abcdef/);
  assert.match(cmd, /調べて返して/);
  assert.match(cursorPromptWithLineage(meta, "初手"), /AITERM_AGENT_LAUNCH_ID=0123456789abcdef0123456789abcdef[\s\S]*初手/);

  const normal = buildCursorAgentCmd("cursor-agent", null, null, null, { ...meta, write_scope: undefined });
  assert.match(normal, /--force --approve-mcps --trust/);
  assert.doesNotMatch(normal, /--mode ask/);
});

test("Cursor adapter: WindowsのPowerShell pane用の起動行は値をPowerShellの単引用で渡す", () => {
  const meta = {
    kind: "cursor", launch_id: "0123456789abcdef0123456789abcdef", write_scope: undefined, agent_role: "subagent",
    parent_session_id: "host-root", delegation_depth: 1, lineage: "host-root>cursor:t1", delegation_allowed: true,
  };
  const argv = cursorAgentArgv("C:\\Users\\kite_\\AppData\\Local\\cursor-agent\\cursor-agent.cmd", "gpt-5.6-sol", null, "it's 初手", meta);
  const line = cursorPwshLaunchLine("C:\\work dir\\o'neil", [["AITERM_AGENT_KIND", "cursor"], ["AITERM_SESSION_ID", "t1"]], argv);
  assert.equal(line.split("; & ")[0],
    "Set-Location -LiteralPath 'C:\\work dir\\o''neil'; $env:AITERM_AGENT_KIND='cursor'; $env:AITERM_SESSION_ID='t1'");
  assert.match(line, /; & 'C:\\Users\\kite_\\AppData\\Local\\cursor-agent\\cursor-agent\.cmd' '--model' 'gpt-5\.6-sol' '--force' '--approve-mcps' '--trust' '/);
  assert.match(line, /it''s 初手'$/);
  assert.throws(() => cursorPwshLaunchLine(null, [["BAD NAME", "x"]], argv), /環境変数名が不正/);
});

test("Cursor adapter: model parameter画面で標準effortの移動量を決める", () => {
  const screen = [
    "GPT-5.6 Luna — Edit Parameters",
    "  Context",
    "  → ● 272K ✓",
    "    ○ 1M",
    "  Reasoning",
    "    ○ None",
    "    ○ Low",
    "    ● Medium ✓",
    "    ○ High",
    "    ○ Extra High",
    "    ○ Max",
    "    ◯ Fast",
  ].join("\n");
  assert.deepEqual(cursorEffortNavigation(screen, "high"), { down: 5, label: "High" });
  assert.deepEqual(cursorEffortNavigation(screen, "xhigh"), { down: 6, label: "Extra High" });
  assert.throws(() => cursorEffortNavigation(screen, "ultra"), /未対応/);
});

test("Cursor adapter: launch markerで通常Cursor transcriptをbindしturn境界・回答を回収する", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-transcript-"));
  const runtime = path.join(root, "runtime");
  const home = path.join(root, "home");
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const previous = { HOME: process.env.HOME, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR };
  process.env.HOME = home;
  process.env.XDG_RUNTIME_DIR = runtime;
  const session = `cursor_${Date.now().toString(36)}`;
  const conversation = "71171692-0813-4002-b05a-0fbfb8433ee3";
  try {
    const meta = createCursorAgentMetadata(session, "/repo with spaces", "pending", "read-only", {
      agentRole: "subagent",
      parentSessionId: "host-root",
      delegationDepth: 1,
      lineage: `host-root>cursor:${session}`,
      delegationAllowed: true,
    });
    assert.equal(meta.hook_route, "shared_cursor_home");
    assert.equal(meta.completion_route, "cursor_transcript");
    assert.equal(meta.cursor_home, path.join(home, ".cursor"));
    assert.equal(cursorWorkspaceId("/repo with spaces"), "repo-with-spaces");

    const transcript = path.join(cursorTranscriptRoot(meta), conversation, `${conversation}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    const first = "Cursor Agent CLIからの回答";
    fs.writeFileSync(transcript, [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: `AITERM_AGENT_LAUNCH_ID=${meta.launch_id}\n質問` }] } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: first }, { type: "tool_use", name: "read" }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
      "",
    ].join("\n"));

    const initial = await observeCursorDone(meta, 0, 0, () => null);
    assert.equal(initial.outcome, "done");
    assert.equal(initial.vendor_session_id, conversation);
    assert.equal(initial.turn_id, "cursor:1");

    assert.equal(bindCursorTranscriptSession(meta), transcript);
    assert.equal(meta.vendor_session_id, conversation);
    const latest = latestCursorCompletion(meta, (file) => fs.readFileSync(file, "utf8").split("\n"));
    assert.equal(latest.vendor_session_id, conversation);
    assert.equal(
      cursorTranscriptText(meta, (file) => fs.readFileSync(file, "utf8").split("\n"), () => { throw new Error("unavailable"); }),
      first,
    );

    const boundary = cursorTurnBoundary(meta);
    assert.equal(boundary, 1);
    const second = "follow-upの回答";
    // 実CLIはfollow-up開始時に直前の末尾turn_endedを除去してから次turnを追記する。
    const prior = fs.readFileSync(transcript, "utf8").trimEnd().split("\n");
    prior.pop();
    fs.writeFileSync(transcript, [...prior,
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "続けて" }] } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: second }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
      "",
    ].join("\n"));
    const followup = await observeCursorDone(meta, 0, boundary, () => null);
    assert.equal(followup.outcome, "done");
    assert.equal(followup.turn_id, "cursor:2");
    assert.equal(
      cursorTranscriptText(meta, (file) => fs.readFileSync(file, "utf8").split("\n"), () => { throw new Error("unavailable"); }),
      second,
    );
    assert.equal(fs.existsSync(path.join(runtime, `aiterm-mcp-${typeof process.getuid === "function" ? process.getuid() : 0}`, "agents", `${session}.${meta.launch_id}.cursor-plugin`)), false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
