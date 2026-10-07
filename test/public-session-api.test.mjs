import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function withClient(run, prepare = () => ({})) {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "aiterm-public-"));
  const client = new Client({ name: "public-session-test", version: "1" });
  const env = { ...process.env, TMPDIR: root, XDG_RUNTIME_DIR: root, AITERM_STATE_BASE: root,
    AITERM_TEST_OWNER: "公開試験", ...prepare(root) };
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("dist/index.js")], env, stderr: "pipe" }));
    await run((name, args = {}) => client.callTool({ name, arguments: args }), root);
  } finally {
    await client.close();
    // sessionを閉じてもpsmuxのwarm serverは残る。試験専用namespaceを終了してcwdのlockも解放する。
    const cleanup = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const { killAll } = await import(${JSON.stringify(pathToFileURL(resolve("dist/core.js")).href)}); killAll();`,
    ], { env, encoding: "utf8" });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    rmSync(root, { recursive: true, force: true });
  }
}

test("公開MCPで通常PTYの一覧・環境・活動・消滅を構造化して回収する", async () => {
  await withClient(async (call, root) => {
    const sid = "public_ordinary";
    assert.equal((await call("pty_open", { name: sid, env_vars: ["AITERM_TEST_OWNER"] })).isError, undefined);
    try {
      const list = (await call("pty_list", { env_keys: ["AITERM_TEST_OWNER", "AITERM_SESSION_ID"] })).structuredContent;
      assert.deepEqual(list.sessions[0].environment, { AITERM_TEST_OWNER: "公開試験", AITERM_SESSION_ID: sid });
      const before = (await call("pty_observe", { session_id: sid })).structuredContent;
      assert.equal(before.pane_alive, true);
      assert.ok(before.process_identity.pid > 0);
      // 通常PTYには起動完了の控えも親配送も無い。数えられない時は0ではなくnull。
      assert.equal(before.activity.post_startup_process_count, null);
      assert.equal(before.pending_child_deliveries, null);
      const text = process.platform === "win32" ? "Write-Output '公開PTY試験'" : "printf '公開PTY試験\\n'";
      const refused = await call("pty_send", { session_id: sid, text: "MUST_NOT_SEND_ORDINARY", require_agent: true });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /^aiterm: AGENT_SESSION_REQUIRED:.*文字列は送信していません/);
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${sid}.log`), "utf8"), /MUST_NOT_SEND_ORDINARY/);
      const forced = await call("pty_send", { session_id: sid, text: "MUST_NOT_SEND_FORCED", require_agent: true, force: true });
      assert.equal(forced.isError, true);
      assert.match(forced.content[0].text, /併用できません.*文字列は送信していません/);
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${sid}.log`), "utf8"), /MUST_NOT_SEND_FORCED/);
      // preface（本文の前に置く1行）は、agentの席への送信だけで使える。通常PTY・force・別端末へは、打鍵前に断る。
      for (const [extra, reason] of [[{}, /preface は agent session への送信（forceなし）だけで使えます。文字列は送信していません。/],
        [{ force: true }, /preface は agent session への送信（forceなし）だけで使えます。文字列は送信していません。/],
        [{ remote: { host: "preface-test-host" } }, /REMOTE_PREFACE_UNSUPPORTED: .*文字列は送信していません。/]]) {
        const prefaced = await call("pty_send", { session_id: sid, text: "MUST_NOT_SEND_PREFACED", preface: "前置きです。", ...extra });
        assert.equal(prefaced.isError, true, JSON.stringify(extra));
        assert.match(prefaced.content[0].text, reason);
      }
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${sid}.log`), "utf8"), /MUST_NOT_SEND_PREFACED|前置きです/);
      await call("pty_send", { session_id: sid, text, mark: true });
      await call("pty_read", { session_id: sid, wait: true, timeout: 5 });
      const after = (await call("pty_observe", { session_id: sid, cursor: before.activity.cursor })).structuredContent;
      assert.equal(after.activity.output_changed, true);
      assert.equal(after.token_hint, null);
    } finally { await call("pty_close", { session_id: sid }); }
    assert.equal((await call("pty_observe", { session_id: sid })).structuredContent.state, "missing");
  });
});

test("pty_send require_agentは通常PTYと消えたagent登録を打鍵前に拒否する", { skip: process.platform === "win32" }, async () => {
  await withClient(async (call, root) => {
    const ordinary = "required_ordinary";
    const agent = "required_agent";
    await call("pty_open", { name: ordinary });
    try {
      const rejected = await call("pty_send", { session_id: ordinary, text: "MUST_NOT_SEND_ORDINARY", require_agent: true });
      assert.equal(rejected.isError, true);
      assert.match(rejected.content[0].text, /^aiterm: AGENT_SESSION_REQUIRED:/);
      assert.match(rejected.content[0].text, /文字列は送信していません/);
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${ordinary}.log`), "utf8"), /MUST_NOT_SEND_ORDINARY/);
      const compatible = await call("pty_send", { session_id: ordinary, text: "echo COMPATIBLE_SEND" });
      assert.equal(compatible.structuredContent.mode, "sent");
      await call("agent_launch", { harness: "codex-cli", session_name: agent });
      const dispatched = await call("pty_send", { session_id: agent, text: "VALID_AGENT_SEND", require_agent: true });
      assert.equal(dispatched.isError, undefined);
      assert.equal(dispatched.structuredContent.mode, "agent_dispatch");
      const agents = join(root, `aiterm-mcp-${process.getuid()}`, "agents");
      for (const file of readdirSync(agents)) {
        if (file.startsWith(`${agent}.`) && file.endsWith(".agent.json")) unlinkSync(join(agents, file));
      }
      const lost = await call("pty_send", { session_id: agent, text: "MUST_NOT_SEND_LOST", require_agent: true });
      assert.equal(lost.isError, true);
      assert.match(lost.content[0].text, /AGENT_SESSION_REQUIRED.*文字列は送信していません/);
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${agent}.log`), "utf8"), /MUST_NOT_SEND_LOST/);
      const forced = await call("pty_send", { session_id: ordinary, text: "MUST_NOT_SEND_FORCED", require_agent: true, force: true });
      assert.equal(forced.isError, true);
      assert.match(forced.content[0].text, /併用できません.*文字列は送信していません/);
      assert.doesNotMatch(readFileSync(join(root, "claude-tmux-sockets", `${ordinary}.log`), "utf8"), /MUST_NOT_SEND_FORCED/);
    } finally {
      await call("pty_close", { session_id: ordinary });
      await call("pty_close", { session_id: agent });
    }
  }, root => {
    const bin = join(root, "codex");
    const home = join(root, "codex-home");
    mkdirSync(home);
    writeFileSync(bin, `#!/usr/bin/env node
process.stdin.setRawMode(true);
process.stdout.write('OpenAI Codex\\n› ready\\n');
process.stdin.on('data', chunk => process.stdout.write('RECEIVED:' + chunk.toString() + '\\n'));
`, { mode: 0o700 });
    return { CODEX_BIN: bin, CODEX_HOME: home };
  });
});

test("公開Codex承認はdigest不一致で送信せず単発許可だけを選ぶ", { skip: process.platform === "win32" }, async () => {
  await withClient(async call => {
    const sid = "public_approval";
    const launch = await call("agent_launch", { harness: "codex-cli", session_name: sid, prompt: "承認試験" });
    try {
      assert.equal(launch.structuredContent.initial_prompt.status, "started");
      assert.equal(launch.structuredContent.initial_prompt.reason, "approval_required");
      const inspected = (await call("agent_approval", { action: "inspect", session_id: sid })).structuredContent;
      assert.equal(inspected.status, "approval_required");
      assert.deepEqual(inspected.choices.map(choice => choice.decision), ["approve_once", "deny"]);
      const stale = await call("agent_approval", { action: "respond", session_id: sid, approval_choice: "approve_once", observed_prompt_digest: "sha256:wrong" });
      assert.equal(stale.isError, true);
      assert.equal(stale.structuredContent.reason, "dialog_changed");
      const response = await call("agent_approval", { action: "respond", session_id: sid, approval_choice: "approve_once", observed_prompt_digest: inspected.prompt_digest });
      assert.equal(response.structuredContent.status, "submitted");
      const screen = await call("pty_read", { session_id: sid, wait: true, until: "単発選択=1", timeout: 5 });
      assert.ok(screen.structuredContent.text.includes("単発選択=1"));
    } finally { await call("pty_close", { session_id: sid }); }
  }, root => {
    const bin = join(root, "codex");
    const home = join(root, "codex-home");
    mkdirSync(home);
    writeFileSync(bin, `#!/usr/bin/env node
process.stdin.setRawMode(true);
process.stdout.write('OpenAI Codex\\n› ready\\n');
let approval = false;
let selected = 2;
process.stdin.on('data', chunk => {
  const text = chunk.toString();
  if (!approval && /[\\r\\n]/.test(text)) {
    approval = true;
    process.stdout.write("\\x1b[2J\\x1b[HWould you like to run the following command?\\n$ harmless-command\\n  1. Yes, proceed (y)\\n› 2. Yes, and don't ask again for commands that start with harmless-command (p)\\n  3. No, and tell Codex what to do differently (esc)\\nPress enter to confirm or esc to cancel\\n");
  } else if (approval) {
    if (text.includes('\\x1b[A')) selected--;
    if (/[\\r\\n]/.test(text)) process.stdout.write('単発選択=' + selected + '\\n');
  }
});
`, { mode: 0o700 });
    return { CODEX_BIN: bin, CODEX_HOME: home };
  });
});

// BellTeamコンテナ 2026-10-06: 開始未確認の返りを誤り（isError）にしていた。Claude Code親は誤りの返りで受け口のhook
// （PostToolUse）を走らせないので、登録済みの配送が届かなかった（ADR 0093）。
test("起動時promptの開始を確認できなくても誤りにせず、本文とinitial_promptで未確認を伝える", { skip: process.platform === "win32" }, async () => {
  await withClient(async call => {
    const sid = "public_unconfirmed";
    const launch = await call("agent_launch", { harness: "codex-cli", session_name: sid, prompt: "開始未確認の試験" });
    try {
      assert.equal(launch.isError, undefined, JSON.stringify(launch));
      assert.deepEqual(launch.structuredContent.initial_prompt, { status: "submitted_unconfirmed", reason: "start_unconfirmed", turn_started: null });
      assert.deepEqual(launch.structuredContent.startup, { status: "ready", reason: "composer_ready" });
      assert.equal(typeof launch.structuredContent.event_cursor, "number");
      const text = launch.content[0].text;
      assert.match(text, /initial_prompt=pending vendor=codex/);
      assert.match(text, new RegExp(`turnの開始は未確認（reason=start_unconfirmed）。.*再送もagentの起動し直しもしない。.*pty_observe\\(${sid}\\)`));
    } finally { await call("pty_close", { session_id: sid }); }
  }, root => {
    // 入力は受けるが、動作中の表示を出さないCodex。
    const bin = join(root, "codex");
    const home = join(root, "codex-home");
    mkdirSync(home);
    writeFileSync(bin, `#!/usr/bin/env node
process.stdin.setRawMode(true);
process.stdout.write('OpenAI Codex\\n› ready\\n');
process.stdin.on('data', () => {});
`, { mode: 0o700 });
    return { CODEX_BIN: bin, CODEX_HOME: home };
  });
});
