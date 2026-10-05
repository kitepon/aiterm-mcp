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
const { grokAuthPlan, grokAuthPane } = await import("../dist/harnesses/grok.js");
const { cursorAuthPlan } = await import("../dist/harnesses/cursor.js");
const core = await import("../dist/core.js");
const { agentsDir } = await import("../dist/agent-shared.js");
const { tmuxCommand } = await import("../dist/tmux-runtime.js");
const sessions = [];
after(() => { for (const name of sessions) core.closeSession(name); fs.rmSync(root, { recursive: true, force: true }); });
const posixPty = { skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).status !== 0 ? "POSIXの偽CLI・tmuxで認証境界を検証する" : false };

function cli(kind, extra = "") {
  const home = fs.mkdtempSync(path.join(root, `${kind}-`));
  const bin = path.join(home, "cli");
  const state = path.join(home, "authenticated");
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(bin, `#!/bin/bash
state=${quote(state)}
kind=${quote(kind)}
log=${quote(path.join(home, "argv"))}
printf '{"args":[' >> "$log"
separator=''
for argument in "$@"; do printf '%s"%s"' "$separator" "$argument" >> "$log"; separator=','; done
printf '],"no_open":"%s","marker":"%s"}\\n' "$NO_OPEN_BROWSER" "$AITERM_AUTH_TEST_MARKER" >> "$log"
if { [ "$kind" = claude ] && [ "$1" = auth ] && [ "$2" = status ]; } || { [ "$kind" = codex ] && [ "$2" = status ]; } || { [ "$kind" = cursor ] && [ "$1" = status ]; }; then
 if [ -f "$state" ]; then
  if [ "$kind" = claude ]; then printf '{"loggedIn":true}\\n'; elif [ "$kind" = cursor ] && [ -f "$state.expired" ]; then printf 'Login successful!\\nLogged in (unable to fetch user details)\\n'; else printf 'Logged in\\n'; fi
  exit 0
 else
  if [ "$kind" = claude ]; then printf '{"loggedIn":false}\\n'; else printf 'Not logged in\\n'; fi
  exit 1
 fi
fi
# Codexの公式App Server。account/readは、期限切れ（$state.expired）ならaccount:null、旧版（$state.old）なら問い合わせを知らない。
if [ "$kind" = codex ] && [ "$1" = app-server ]; then
 while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/^{"id":\\([0-9]*\\).*/\\1/p')
  [ -z "$id" ] && continue
  case "$line" in
   *'"method":"initialize"'*) printf '{"id":%s,"result":{}}\\n' "$id";;
   *) if [ -f "$state.old" ]; then printf '{"id":%s,"error":{"code":-32601,"message":"Method not found"}}\\n' "$id"
      elif [ -f "$state.broken" ]; then exit 3
      else case "$line" in
       *'"method":"account/read"'*) if [ -f "$state.expired" ]; then printf '{"id":%s,"result":{"account":null,"requiresOpenaiAuth":true}}\\n' "$id"
         else printf '{"id":%s,"result":{"account":{"type":"chatgpt","email":"x@example.com","planType":"pro"},"requiresOpenaiAuth":true}}\\n' "$id"; fi;;
       *) printf '{"id":%s,"result":{"authMethod":"chatgpt","authToken":null,"requiresOpenaiAuth":true}}\\n' "$id";;
      esac; fi;;
  esac
 done
 exit 0
fi
# Grokは状態のcommandを持たない。modelsが、使えるログインが無い時だけ先頭で知らせる。
if [ "$kind" = grok ] && [ "$1" = models ]; then
 if [ -f "$state.stale" ]; then rm -f "$state.stale"; printf 'You are not authenticated.\\n\\n'; elif [ ! -f "$state" ]; then printf 'You are not authenticated.\\n\\n'; fi
 printf 'Default model: grok-x\\n\\nAvailable models:\\n  * grok-x (default)\\n'
 exit 0
fi
${extra === "login_failed" ? 'touch "$state"; exit 7' : ""}
if [ "$kind" = claude ] && [ "$#" = 0 ]; then
 printf 'Claude Code\\nChoose the text style that looks best with your terminal\\n❯ 1. Dark mode\\n'
 while IFS= read -r reply; do printf '\\033[2J\\033[HClaude Code\\n❯\\n'; done
else
 case "$kind" in
  codex) printf 'Open https://auth.openai.com/device\\nEnter this code: ABCD-EFGH\\n';;
  grok) printf 'To sign in, open this URL in your browser:\\nhttps://auth.x.ai/device?user_code=ABCD-EFGH\\n';;
  cursor) printf 'Open https://cursor.com/device\\n';;
  claude) printf 'Open https://claude.ai/device\\n';;
 esac
 IFS= read -r reply
 touch "$state"
 rm -f "$state.expired"
 exit 0
fi
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

test("Grok実機のverification_uri_completeからuser_codeを読む", () => {
  const pane = grokAuthPane("To sign in, open this URL in your browser:\nhttps://auth.x.ai/device?user_code=ABCD-EFGH");
  assert.equal(pane.user_code, "ABCD-EFGH");
  assert.equal(pane.input_required, false);
  assert.throws(() => grokAuthPane("https://auth.x.ai/device?user_code=invalid_value"), /AGENT_AUTH_CHALLENGE_INVALID/);
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

// Grokには状態のcommandが無い。`grok models`が「You are not authenticated.」と答えるかで見る（auth fileの存在は見ない）。
test("認証session無しのGrokは、公式のmodelsの答えで状態を返す", posixPty, async () => {
  const fixture = cli("grok");
  const before = await core.authenticateAgent("grok", { action: "status" });
  assert.deepEqual([before.status, before.session_id], ["blocked", null]);
  assert.match(before.message, /startで開始/);
  fs.writeFileSync(fixture.state, "yes");
  assert.deepEqual(await core.authenticateAgent("grok", { action: "status" }),
    { schema: "aiterm.agent-auth-result.v1", harness: "grok-cli", status: "authenticated", session_id: null, url: null, user_code: null, input_required: false, message: null });
  // 2026-10-05 macbook: 生きているログインで、1回目だけ「未認証」と答えた（同じ時刻にauth.jsonが更新された）。1回では決めない。
  fs.writeFileSync(`${fixture.state}.stale`, "yes");
  assert.equal((await core.authenticateAgent("grok", { action: "status" })).status, "authenticated");
  const argv = fs.readFileSync(path.join(fixture.home, "argv"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(argv.filter(row => row.args[0] === "models").length, 5, "未認証の答えの時だけ、もう1回聞く（ログイン無しで2回、認証済みで1回、取り直しの回で2回）");
  // 認証済みなら、reloginを付けないstartは何も起こさない。
  assert.deepEqual([(await core.authenticateAgent("grok", { action: "start", cwd: fixture.home })).status, core.listSessions().length], ["authenticated", core.listSessions().length]);
});

// 2026-10-05 BellTeamのコンテナ: ログインから30日でCodexのログインが切れた後も`codex login status`は「Logged in」と答え、
// agent_authのstatusとstartは`authenticated`を返して入り直しを始めなかった。auth.jsonの名前を手で変えるまで戻せなかった。
test("Codex: 期限が切れたログインを認証済みと返さず、startは入り直しを始める", posixPty, async () => {
  const fixture = cli("codex");
  fs.writeFileSync(fixture.state, "yes");
  assert.equal((await core.authenticateAgent("codex", { action: "status" })).status, "authenticated");
  fs.writeFileSync(`${fixture.state}.expired`, "yes");
  const status = await core.authenticateAgent("codex", { action: "status" });
  assert.deepEqual([status.status, status.session_id], ["blocked", null]);
  assert.match(status.message, /期限が切れています/);
  const start = await core.authenticateAgent("codex", { action: "start", cwd: fixture.home }); sessions.push(start.session_id);
  assert.equal(start.status, "waiting");
  assert.equal(start.user_code, "ABCD-EFGH");
  core.send(start.session_id, "ok");
  assert.equal((await until("codex", start.session_id, "authenticated")).session_id, start.session_id);
  // App Serverが問い合わせを知らない旧版は、今までどおり公式statusに従う。App Serverと話せない時は、認証済みとは返さない。
  fs.writeFileSync(`${fixture.state}.expired`, "yes");
  fs.writeFileSync(`${fixture.state}.old`, "yes");
  assert.equal((await core.authenticateAgent("codex", { action: "status" })).status, "authenticated");
  fs.rmSync(`${fixture.state}.old`);
  fs.writeFileSync(`${fixture.state}.broken`, "yes");
  const broken = await core.authenticateAgent("codex", { action: "status" });
  assert.equal(broken.status, "failed");
  assert.match(broken.message, /App Server/);
});

// Aitermは資格情報に触れない。公式CLIがログインの開始時に元のログインを消すか（Codex 0.160.0は消す）は、公式CLIの側の動き。
test("relogin: 認証済みに見えても公式ログインを始め、Aitermは取り消しで元のログインに触れない", posixPty, async () => {
  for (const kind of ["codex", "grok", "cursor"]) {
    const fixture = cli(kind);
    fs.writeFileSync(fixture.state, "yes");
    const plain = await core.authenticateAgent(kind, { action: "start", cwd: fixture.home });
    assert.deepEqual([plain.status, plain.session_id], ["authenticated", null], kind);
    const start = await core.authenticateAgent(kind, { action: "start", cwd: fixture.home, relogin: true }); sessions.push(start.session_id);
    assert.equal(start.status, "waiting", kind);
    assert.ok(start.session_id, `${kind}: reloginのstartはsessionを返す`);
    assert.ok(start.url?.startsWith("https://"), kind);
    const cancel = await core.authenticateAgent(kind, { action: "cancel", session_id: start.session_id });
    assert.equal(cancel.session_id, null);
    sessions.splice(sessions.indexOf(start.session_id), 1);
    assert.equal(fs.existsSync(fixture.state), true, `${kind}: 取り消しは元のログインに触れない`);
    assert.equal((await core.authenticateAgent(kind, { action: "status" })).status, "authenticated", kind);
  }
});

// 無効なtokenの時、Cursorの公式statusは「Logged in (unable to fetch user details)」と終了0で答える（偽の資格情報で再現）。
test("Cursor: ログインを確認できない時は認証済みと返さず、reloginで入り直せる", posixPty, async () => {
  const fixture = cli("cursor");
  fs.writeFileSync(fixture.state, "yes");
  fs.writeFileSync(`${fixture.state}.expired`, "yes");
  const status = await core.authenticateAgent("cursor", { action: "status" });
  assert.equal(status.status, "failed");
  assert.match(status.message, /relogin:true/);
  const plain = await core.authenticateAgent("cursor", { action: "start", cwd: fixture.home });
  assert.deepEqual([plain.status, plain.session_id], ["failed", null]);
  const start = await core.authenticateAgent("cursor", { action: "start", cwd: fixture.home, relogin: true }); sessions.push(start.session_id);
  assert.equal(start.status, "waiting");
  core.send(start.session_id, "ok");
  assert.equal((await until("cursor", start.session_id, "authenticated")).session_id, start.session_id);
});

test("ログインが無い・切れた時の起動画面を、起動を止めるダイアログとして見分ける", async () => {
  const { codexLaunchBlockingDialog } = await import("../dist/harnesses/codex.js");
  const { grokLaunchBlockingDialog, grokPaneObservation } = await import("../dist/harnesses/grok.js");
  // Codex 0.160.0（期限切れのログインの写しで起こした実物の画面）。
  const codex = ["Welcome to Codex, OpenAI's command-line coding agent", "Sign in with ChatGPT to use Codex as part of your paid plan", "or connect an API key for usage-based billing",
    "> 1. Sign in with ChatGPT", "2. Sign in with Device Code", "3. Provide your own API key", "Press enter to continue"].join("\n");
  assert.match(codexLaunchBlockingDialog(codex), /サインイン画面/);
  // Grok 1.0.46（値を全部ダミーにした資格情報で起こした実物の画面）。起動してすぐdevice codeのサインインを自分で始める。
  const grok = ["/tmp/work", "Approve in your browser to finish signing in.", "ABCD-EFGH", "Make sure your browser shows this code.", "If it doesn't open, click here to copy.",
    "Copying not working? Click here to show full URL.", "Waiting for approval...", "ctrl+q  quit"].join("\n");
  assert.match(grokLaunchBlockingDialog(grok), /サインイン画面/);
  assert.deepEqual(grokPaneObservation(grok), { state: "blocked", reason: "startup_dialog" });
  // 過去の出力として残っているだけで、後ろに今の入力欄がある時は止めない。
  assert.equal(grokLaunchBlockingDialog(`${grok}\n❯ `), null);
});

test("取消と状態確認は別harness・通常PTYへ触れない", posixPty, async () => {
  const [normal] = core.openSession(); sessions.push(normal);
  for (const action of ["status", "cancel"])
    await assert.rejects(core.authenticateAgent("codex", { action, session_id: normal }), /AGENT_AUTH_SESSION_NOT_FOUND/);
  assert.ok(core.listSessions().includes(normal));
  const fixture = cli("grok");
  const start = await core.authenticateAgent("grok", { action: "start", cwd: fixture.home }); sessions.push(start.session_id);
  for (const action of ["status", "cancel"])
    await assert.rejects(core.authenticateAgent("cursor", { action, session_id: start.session_id }), /AGENT_AUTH_HARNESS_MISMATCH/);
  assert.ok(core.listSessions().includes(start.session_id));
});

for (const keepMetadata of [false, true]) test(`消失した認証PTYは通常結果を返し、再開始できる（記録${keepMetadata ? "あり" : "なし"}）`, posixPty, async () => {
  const fixture = cli("grok");
  const start = await core.authenticateAgent("grok", { action: "start", cwd: fixture.home });
  sessions.push(start.session_id);
  const metadata = path.join(agentsDir(), `${start.session_id}.auth.json`);
  if (keepMetadata) {
    // コンテナ再起動相当: backendだけが失われ、永続した相関記録は残る。
    assert.equal(tmuxCommand(false, "kill-session", "-t", start.session_id).code, 0);
  } else core.closeSession(start.session_id);
  assert.equal(fs.existsSync(metadata), keepMetadata);
  const status = await core.authenticateAgent("grok", { action: "status", session_id: start.session_id });
  assert.equal(status.status, "failed");
  assert.equal(status.session_id, null);
  assert.match(status.message, /失われ/);
  assert.equal(status.url, null);
  assert.equal(status.user_code, null);
  assert.equal(status.input_required, false);
  if (keepMetadata) for (const action of ["status", "cancel"])
    await assert.rejects(core.authenticateAgent("cursor", { action, session_id: start.session_id }), /AGENT_AUTH_HARNESS_MISMATCH/);
  const cancel = await core.authenticateAgent("grok", { action: "cancel", session_id: start.session_id });
  assert.equal(cancel.status, "blocked");
  assert.equal(cancel.session_id, null);
  assert.match(cancel.message, /既に.*取消済み/);
  assert.equal(fs.existsSync(metadata), false);
  const restarted = await core.authenticateAgent("grok", { action: "start", cwd: fixture.home });
  sessions.push(restarted.session_id);
  assert.equal(restarted.status, "waiting");
  assert.equal((await core.authenticateAgent("grok", { action: "cancel", session_id: restarted.session_id })).session_id, null);
  assert.equal(fs.existsSync(fixture.state), false, "消失と取消は資格情報を作成しない");
});

test("壊れた認証記録と読取り失敗は消失扱いしない", posixPty, async () => {
  const name = "auth-invalid-record";
  const metadata = path.join(agentsDir(), `${name}.auth.json`);
  try {
    for (const value of ["{", "null", "[]"]) {
      fs.writeFileSync(metadata, value);
      for (const action of ["status", "cancel"])
        await assert.rejects(core.authenticateAgent("grok", { action, session_id: name }), /AGENT_AUTH_STATE_INVALID/);
    }
    fs.unlinkSync(metadata);
    fs.mkdirSync(metadata);
    for (const action of ["status", "cancel"])
      await assert.rejects(core.authenticateAgent("grok", { action, session_id: name }), { code: "EISDIR" });
  } finally { fs.rmSync(metadata, { recursive: true, force: true }); }
});

test("公式ログインが失敗した場合は既存の認証状態へ成功を丸めない", posixPty, async () => {
  const fixture = cli("codex", "login_failed");
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
