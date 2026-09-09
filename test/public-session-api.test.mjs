import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function withClient(run, prepare = () => ({})) {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "aiterm-public-"));
  const client = new Client({ name: "public-session-test", version: "1" });
  const env = { ...process.env, TMPDIR: root, AITERM_TEST_OWNER: "公開試験", ...prepare(root) };
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("dist/index.js")], env, stderr: "pipe" }));
    await run((name, args = {}) => client.callTool({ name, arguments: args }));
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("公開MCPで通常PTYの一覧・環境・活動・消滅を構造化して回収する", async () => {
  await withClient(async call => {
    const sid = "public_ordinary";
    assert.equal((await call("pty_open", { name: sid, env_vars: ["AITERM_TEST_OWNER"] })).isError, undefined);
    try {
      const list = (await call("pty_list", { env_keys: ["AITERM_TEST_OWNER", "AITERM_SESSION_ID"] })).structuredContent;
      assert.deepEqual(list.sessions[0].environment, { AITERM_TEST_OWNER: "公開試験", AITERM_SESSION_ID: sid });
      const before = (await call("pty_observe", { session_id: sid })).structuredContent;
      assert.equal(before.pane_alive, true);
      assert.ok(before.process_identity.pid > 0);
      const text = process.platform === "win32" ? "Write-Output '公開PTY試験'" : "printf '公開PTY試験\\n'";
      await call("pty_send", { session_id: sid, text, mark: true });
      await call("pty_read", { session_id: sid, wait: true, timeout: 5 });
      const after = (await call("pty_observe", { session_id: sid, cursor: before.activity.cursor })).structuredContent;
      assert.equal(after.activity.output_changed, true);
      assert.equal(after.token_hint, null);
    } finally { await call("pty_close", { session_id: sid }); }
    assert.equal((await call("pty_observe", { session_id: sid })).structuredContent.state, "missing");
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
