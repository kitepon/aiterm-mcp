import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ソケットとHOMEを隔離し、実際の資格情報と稼働sessionへ触れない。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao-"));
process.env.TMPDIR = root;
process.env.XDG_RUNTIME_DIR = root;
process.env.HOME = root;
const core = await import("../dist/core.js");
const { tmuxCommand } = await import("../dist/tmux-runtime.js");
const sessions = [];
after(() => { for (const name of sessions) try { core.closeSession(name); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); });
const posixPty = { skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).status !== 0 ? "POSIXの偽CLI・tmuxで検証する" : false };

const TOKEN = "sk-ant-oat01-" + "Ab3_-".repeat(20) + "xyzAA";
const tokenFile = slot => path.join(root, ".bellteam-accounts", "claude", slot, "oauth-token");

// Fake claude: `auth status` says logged in (start must not short-circuit); `setup-token` asks for a code, then prints the token.
function fakeClaude(withToken = true) {
  const home = fs.mkdtempSync(path.join(root, "claude-"));
  const bin = path.join(home, "cli");
  fs.writeFileSync(bin, `#!/bin/bash
printf '%s\\n' "$*" >> '${path.join(home, "argv")}'
if [ "$1" = auth ] && [ "$2" = status ]; then printf '{"loggedIn":true}\\n'; exit 0; fi
if [ "$1" = setup-token ]; then
 printf 'Browser did not open? Use the url below to sign in\\nhttps://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%%3Ainference&code_challenge=${"c".repeat(43)}&code_challenge_method=S256\\n Paste code here if prompted > '
 IFS= read -r reply || exit 1
 ${withToken ? `printf '\\nLong-lived authentication token created successfully!\\n\\nYour OAuth token (valid for 1 year):\\n\\n${TOKEN}\\n\\nStore this token securely.\\n'` : "printf '\\nDone.\\n'"}
 exit 0
fi
exit 9
`, { mode: 0o755 });
  process.env.CLAUDE_BIN = bin;
  return { home, argv: () => fs.readFileSync(path.join(home, "argv"), "utf8").trim().split("\n") };
}

async function until(session, expected, extra = {}) {
  const deadline = Date.now() + 6000;
  let result;
  do {
    result = await core.authenticateAgent("claude", { action: "status", session_id: session, ...extra });
    if (result.status === expected) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`expected=${expected} actual=${JSON.stringify(result)}`);
}

test("oauth_token: token_file outside the slot shape, another harness, or a half pair is refused before any start", async () => {
  const cwd = root;
  for (const file of [path.join(root, "oauth-token"), path.join(root, ".bellteam-accounts", "claude", "..", "x", "oauth-token"),
    path.join(root, ".bellteam-accounts", "claude", "2nd", "token"), ".bellteam-accounts/claude/2nd/oauth-token"])
    await assert.rejects(core.authenticateAgent("claude", { action: "start", cwd, login: "oauth_token", token_file: file }), /AGENT_AUTH_TOKEN_FILE_REJECTED/);
  await assert.rejects(core.authenticateAgent("codex", { action: "start", cwd, login: "oauth_token", token_file: tokenFile("2nd") }), /AGENT_AUTH_LOGIN_REJECTED/);
  await assert.rejects(core.authenticateAgent("claude", { action: "start", cwd, token_file: tokenFile("2nd") }), /AGENT_AUTH_LOGIN_REJECTED/);
  await assert.rejects(core.authenticateAgent("claude", { action: "start", cwd, login: "oauth_token" }), /AGENT_AUTH_LOGIN_REJECTED/);
});

test("oauth_token: setup-token runs even when logged in; its token goes to token_file 0600 and leaves the pane", posixPty, async () => {
  const fixture = fakeClaude();
  const file = tokenFile("2nd");
  const mode = { login: "oauth_token", token_file: file };
  const start = await core.authenticateAgent("claude", { action: "start", cwd: fixture.home, ...mode }); sessions.push(start.session_id);
  assert.equal(start.status, "blocked", "the code prompt");
  assert.equal(start.auth_ui.input, "authorization_code");
  assert.equal(start.login, "oauth_token");
  assert.match(start.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize/);
  assert.deepEqual(fixture.argv(), ["setup-token"], "no status short-circuit, no auth login");
  const blank = await core.authenticateAgent("claude", { action: "status", cwd: fixture.home, ...mode });
  assert.equal(blank.status, "blocked", "no file yet");

  core.send(start.session_id, "the-code");
  const done = await until(start.session_id, "authenticated");
  assert.equal(done.login, "oauth_token", "echoed from the session record");
  assert.equal(JSON.stringify(done).includes(TOKEN), false);
  assert.equal(fs.readFileSync(file, "utf8"), TOKEN);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["oauth-token"], "no temp file left");
  const screen = tmuxCommand(false, "capture-pane", "-p", "-S", "-", "-t", start.session_id).stdout;
  assert.equal(screen.includes("sk-ant-oat01-"), false, "pane history wiped");
  assert.equal((await until(start.session_id, "authenticated", mode)).session_id, start.session_id);
  const plain = await core.authenticateAgent("claude", { action: "status", cwd: fixture.home, ...mode });
  assert.equal(plain.status, "authenticated");
  assert.equal(plain.login, "oauth_token");
  assert.equal("account_label" in plain, false);
  fs.chmodSync(file, 0o644);
  assert.equal((await core.authenticateAgent("claude", { action: "status", cwd: fixture.home, ...mode })).status, "blocked", "not 0600");
  await assert.rejects(core.authenticateAgent("claude", { action: "status", session_id: start.session_id, login: "oauth_token", token_file: tokenFile("3rd") }), /AGENT_AUTH_LOGIN_REJECTED/);
});

test("oauth_token: an exit without a token fails and the older token_file stays", posixPty, async () => {
  const fixture = fakeClaude(false);
  const file = tokenFile("4th");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "older", { mode: 0o600 });
  const start = await core.authenticateAgent("claude", { action: "start", cwd: fixture.home, login: "oauth_token", token_file: file }); sessions.push(start.session_id);
  core.send(start.session_id, "the-code");
  const failed = await until(start.session_id, "failed");
  assert.equal(failed.login, "oauth_token");
  assert.equal(fs.readFileSync(file, "utf8"), "older");
});
