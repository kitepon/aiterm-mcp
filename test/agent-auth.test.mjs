import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ソケットとHOMEを隔離し、実際の資格情報と稼働sessionへ触れない。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aa-"));
process.env.TMPDIR = root;
process.env.XDG_RUNTIME_DIR = root;
process.env.HOME = root;
const { authUrl, authUserCode } = await import("../dist/agent-auth.js");
const { claudeAuthPane } = await import("../dist/harnesses/claude.js");
const { codexAuthPlan } = await import("../dist/harnesses/codex.js");
const { grokAuthPlan } = await import("../dist/harnesses/grok.js");
const { cursorAuthPlan } = await import("../dist/harnesses/cursor.js");
const core = await import("../dist/core.js");
const sessions = [];
after(() => { for (const name of sessions) core.closeSession(name); fs.rmSync(root, { recursive: true, force: true }); });
const posixPty = { skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).status !== 0 ? "POSIXの偽CLI・tmuxで認証境界を検証する" : false };

function cli(kind, extra = "") {
  const home = fs.mkdtempSync(path.join(root, `${kind}-`));
  const bin = path.join(home, "cli");
  const state = path.join(home, "authenticated");
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const kind = ${JSON.stringify(kind)};
fs.appendFileSync(${JSON.stringify(path.join(home, "argv"))}, JSON.stringify({ args, no_open: process.env.NO_OPEN_BROWSER ?? null, marker: process.env.AITERM_AUTH_TEST_MARKER ?? null }) + "\\n");
if ((kind === "claude" && args[0] === "auth" && args[1] === "status") || (kind === "codex" && args[1] === "status") || (kind === "cursor" && args[0] === "status")) {
 const ready = fs.existsSync(state);
 if (kind === "claude") console.log(JSON.stringify({ loggedIn: ready }));
 else console.log(ready ? "Logged in" : "Not logged in");
 process.exit(ready ? 0 : 1);
}
${extra}
if (kind === "claude" && args.length === 0) {
 console.log("Claude Code\\nChoose the text style that looks best with your terminal\\n❯ 1. Dark mode");
 require("node:readline").createInterface({ input: process.stdin }).on("line", () => { console.log("\\x1b[2J\\x1b[HClaude Code\\n❯"); });
} else {
 const host = kind === "codex" ? "auth.openai.com" : kind === "grok" ? "auth.x.ai" : kind === "cursor" ? "cursor.com" : "claude.ai";
 console.log("Open https://" + host + "/device\\nEnter this code: ABCD-EFGH");
 require("node:readline").createInterface({ input: process.stdin }).on("line", () => { fs.writeFileSync(state, "yes"); process.exit(0); });
}
`, { mode: 0o755 });
  process.env[{ claude: "CLAUDE_BIN", codex: "CODEX_BIN", grok: "GROK_BIN", cursor: "CURSOR_AGENT_BIN" }[kind]] = bin;
  return { home, bin, state };
}
async function until(kind, session, expected) {
  const deadline = Date.now() + 6000;
  let result;
  do {
    result = await core.authenticateAgent(kind, { action: "status", session_id: session });
    if (result.status === expected) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`期待=${expected} 実際=${JSON.stringify(result)}`);
}

test("公式認証URLと明示device codeだけを公開する", () => {
  assert.equal(authUrl("https://evil.example/device https://auth.x.ai/device", ["auth.x.ai"]), "https://auth.x.ai/device");
  for (const url of ["https://auth.x.ai/device?access_token=secret", "https://auth.x.ai/callback?code=secret", "https://u:p@auth.x.ai/device", "https://auth.x.ai/device#secret"])
    assert.equal(authUrl(url, ["auth.x.ai"]), null);
  assert.equal(authUserCode("Enter this code:\n ABCD-EFGHI"), "ABCD-EFGHI");
  assert.equal(authUserCode("2. Enter this one-time code (expires in 15 minutes)\n   ABCD-EFGHI"), "ABCD-EFGHI");
  assert.equal(authUserCode("credential ABCD-EFGHI"), null);
  assert.equal(authUserCode("Code: long-secret-token"), null);
  assert.deepEqual(codexAuthPlan().args, ["login", "--device-auth"]);
  assert.deepEqual(grokAuthPlan().args, ["login", "--device-auth"]);
  assert.deepEqual(cursorAuthPlan(), { args: ["login"], env: [["NO_OPEN_BROWSER", "1"]] });
});

test("Claudeの初回案内と通常composerを区別する", () => {
  const pane = claudeAuthPane("Claude Code\nSelect login method:\n❯ 1. Claude account with subscription", true);
  assert.equal(pane.input_required, true);
  assert.equal(pane.onboarding_complete, false);
  assert.equal(claudeAuthPane("Claude Code\n❯", true).onboarding_complete, true);
});

for (const kind of ["codex", "grok", "cursor"]) test(`${kind}: 公式ログインPTYのURLを返し、人の入力後の終了で認証を確認する`, posixPty, async () => {
  const { home } = cli(kind);
  process.env.AITERM_AUTH_TEST_MARKER = "元のsession環境";
  const start = await core.authenticateAgent(kind, { action: "start", cwd: home, env_vars: ["AITERM_AUTH_TEST_MARKER"] });
  sessions.push(start.session_id);
  assert.equal(start.status, "waiting");
  assert.ok(start.url?.startsWith("https://"), await core.readOutput(start.session_id, { screen: true, raw: true }));
  assert.equal(start.user_code, kind === "cursor" ? null : "ABCD-EFGH");
  core.send(start.session_id, "ok");
  const done = await until(kind, start.session_id, "authenticated");
  assert.equal(done.url, null);
  assert.equal(done.input_required, false);
  const recovered = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const core = await import(${JSON.stringify(new URL("../dist/core.js", import.meta.url).href)}); console.log(JSON.stringify(await core.authenticateAgent(${JSON.stringify(kind)}, { action: "status", session_id: ${JSON.stringify(start.session_id)} })));`],
    { env: { ...process.env, AITERM_AUTH_TEST_MARKER: "次のMCP環境" }, encoding: "utf8", timeout: 10000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, "authenticated", "MCP processを閉じた後もsession IDから公式結果を読める");

  const argv = fs.readFileSync(path.join(home, "argv"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(argv.some(row => JSON.stringify(row.args) === JSON.stringify(kind === "cursor" ? ["login"] : ["login", "--device-auth"])));
  if (kind === "cursor") assert.equal(argv.find(row => row.args[0] === "login").no_open, "1");
  if (kind !== "grok") assert.equal(argv.at(-1).marker, "元のsession環境", "公式statusは開始したPTYのenvを使う");
  const cancel = await core.authenticateAgent(kind, { action: "cancel", session_id: start.session_id });
  assert.equal(cancel.session_id, null);
  sessions.splice(sessions.indexOf(start.session_id), 1);
});

test("認証session無しのGrokはファイル存在を成功扱いしない", posixPty, async () => {
  const fixture = cli("grok");
  fs.writeFileSync(fixture.state, "yes");
  const result = await core.authenticateAgent("grok", { action: "status" });
  assert.equal(result.status, "blocked");
  assert.match(result.message, /session/);
});

test("取消と状態確認は別harness・通常PTYへ触れない", posixPty, async () => {
  const [normal] = core.openSession(); sessions.push(normal);
  await assert.rejects(core.authenticateAgent("codex", { action: "cancel", session_id: normal }), /AGENT_AUTH_SESSION_NOT_FOUND/);
  assert.ok(core.listSessions().includes(normal));
  const fixture = cli("grok");
  const start = await core.authenticateAgent("grok", { action: "start", cwd: fixture.home }); sessions.push(start.session_id);
  await assert.rejects(core.authenticateAgent("cursor", { action: "cancel", session_id: start.session_id }), /AGENT_AUTH_HARNESS_MISMATCH/);
  assert.ok(core.listSessions().includes(start.session_id));
});

test("公式ログインが失敗した場合は既存の認証状態へ成功を丸めない", posixPty, async () => {
  const fixture = cli("codex", 'if (args[1] !== "status") { fs.writeFileSync(state, "yes"); process.exit(7); }');
  const start = await core.authenticateAgent("codex", { action: "start", cwd: fixture.home }); sessions.push(start.session_id);
  assert.equal(start.status, "failed");
  assert.match(start.message, /exit=7/);
});

test("Claude: auth login終了後に同じ認証sessionで公式の初回案内を進める", posixPty, async () => {
  const fixture = cli("claude");
  const start = await core.authenticateAgent("claude", { action: "start", cwd: fixture.home }); sessions.push(start.session_id);
  assert.equal(start.status, "waiting");
  core.send(start.session_id, "ok");
  const onboarding = await until("claude", start.session_id, "blocked");
  assert.equal(onboarding.input_required, true);
  core.sendKey(start.session_id, "Enter");
  const done = await until("claude", start.session_id, "authenticated");
  assert.equal(done.session_id, start.session_id);
  const argv = fs.readFileSync(path.join(fixture.home, "argv"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(argv.some(row => JSON.stringify(row.args) === JSON.stringify(["auth", "login"])));
  assert.ok(argv.some(row => row.args.length === 0));
});
