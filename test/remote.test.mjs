import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { acceptRemote, classifyRemoteShell, remoteInputSchema, remoteServerCommand, remoteWaitCommand, sshInvocation, observeRemoteAgentDone, remoteWaitProcess } from "../dist/remote.js";
import { ParentDeliveryManager, deliveryKey } from "../dist/parent-delivery.js";

const parent = { thread_id: "11111111-2222-4333-8444-555555555551", codex_home: path.join(os.tmpdir(), "親のCodex") };

test("接続先はoptionとして解釈される形と改行入りのsshオプションを受け付けない", () => {
  assert.equal(remoteInputSchema.safeParse({ host: "rabbit" }).success, true);
  assert.equal(remoteInputSchema.safeParse({ host: "-oProxyCommand=sh" }).success, false);
  assert.equal(remoteInputSchema.safeParse({ host: "rabbit", ssh_options: ["ProxyJump=main-server"] }).success, true);
  assert.equal(remoteInputSchema.safeParse({ host: "rabbit", ssh_options: ["Port=22\nProxyCommand=sh"] }).success, false);
  assert.equal(remoteInputSchema.safeParse({ host: "rabbit", passphrase: "a", passphrase_env: "B" }).success, false);
});

test("パスフレーズが無ければBatchModeで止め、接続名の前で引数を区切る", () => {
  const { args, env } = sshInvocation({ host: "rabbit", user: "kite", port: 2222, identity_file: "/k/id" }, "true");
  assert.ok(args.includes("BatchMode=yes"));
  assert.deepEqual(args.slice(-3), ["--", "rabbit", "true"]);
  assert.ok(args.join(" ").includes("-l kite -p 2222 -i /k/id"));
  assert.equal(env.AITERM_SSH_PASSPHRASE, undefined);
});

for (const long of [false, true]) {
  test(`${long ? "長い" : "通常の"}TMPDIRでもSSH共有ソケットと作成時の一時名をbindできる`, { skip: process.platform === "win32" }, async (t) => {
    const root = fs.mkdtempSync("/tmp/aiterm-control-test-");
    const tmp = long ? path.join(root, ...Array(10).fill("長い一時領域")) : root;
    fs.mkdirSync(tmp, { recursive: true });
    const saved = { TMPDIR: process.env.TMPDIR, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, AITERM_STATE_BASE: process.env.AITERM_STATE_BASE };
    process.env.TMPDIR = tmp;
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.AITERM_STATE_BASE;
    let dir;
    t.after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    });
    const target = { host: "127.0.0.1" };
    const invocation = sshInvocation(target, "true");
    const control = invocation.args.find((arg) => arg.startsWith("ControlPath=")).slice("ControlPath=".length);
    dir = path.dirname(control);
    const temporary = control.replace("%C", "a".repeat(40)) + "." + "b".repeat(16);
    assert.ok(Buffer.byteLength(temporary) < 104, "OpenSSHの一時suffixを含めてmacOSの制限に収まる");
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.ok(invocation.args.includes("ControlMaster=auto"));
    assert.ok(invocation.args.includes("ControlPersist=600"));
    assert.equal(sshInvocation(target, "another command").args.find((arg) => arg.startsWith("ControlPath=")), `ControlPath=${control}`);
    const other = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import {sshInvocation} from ${JSON.stringify(new URL("../dist/remote.js", import.meta.url).href)}; process.stdout.write(sshInvocation({host:'127.0.0.1'},'true').args.find(a=>a.startsWith('ControlPath=')));`],
      { env: process.env, encoding: "utf8" });
    assert.equal(other.status, 0, other.stderr);
    assert.equal(other.stdout, `ControlPath=${control}`, "別processも同じ共有接続を使う");
    const ssh = spawnSync("ssh", ["-O", "check", ...invocation.args], { env: invocation.env, encoding: "utf8", timeout: 5000 });
    assert.equal(ssh.error, undefined);
    assert.match(ssh.stderr, /Control socket connect/);
    assert.doesNotMatch(ssh.stderr, /too long/);
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(temporary, resolve); });
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    assert.equal(fs.existsSync(temporary), false, "閉じたソケットの残骸を残さない");
    process.env.XDG_RUNTIME_DIR = root;
    const alternate = sshInvocation(target, "true").args.find((arg) => arg.startsWith("ControlPath="));
    if (long) {
      assert.notEqual(alternate, `ControlPath=${control}`, "異なるstate rootの接続を共有しない");
      fs.rmSync(path.dirname(alternate.slice("ControlPath=".length)), { recursive: true, force: true });
    } else {
      assert.equal(alternate, `ControlPath=${control}`, "同じstate rootなら環境変数の選び方によらず共有する");
    }
    fs.chmodSync(dir, 0o777);
    process.env.XDG_RUNTIME_DIR = tmp;
    assert.throws(() => sshInvocation(target, "true"), /REMOTE_CONTROL_DIR_INVALID/);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o777, "既存領域の権限を勝手に修復しない");
    fs.rmSync(dir, { recursive: true });
    fs.symlinkSync(root, dir);
    assert.throws(() => sshInvocation(target, "true"), /REMOTE_CONTROL_DIR_INVALID/);
    fs.unlinkSync(dir);
  });
}

test("平文のパスフレーズは記録用の接続情報から外し、askpass経由でsshにだけ渡す", { skip: process.platform === "win32" }, async (t) => {
  fakeSsh(t, "echo aiterm-probe %OS%");
  const target = acceptRemote({ host: "askpass-host", passphrase: "秘密の合言葉" });
  assert.deepEqual(target, { host: "askpass-host" });
  const { args, env } = sshInvocation(target, "true");
  assert.equal(args.includes("BatchMode=yes"), false);
  assert.equal(env.AITERM_SSH_PASSPHRASE, "秘密の合言葉");
  assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
  assert.equal(fs.readFileSync(env.SSH_ASKPASS, "utf8").includes("秘密の合言葉"), false);
  // 親が別processで起動する完了待ちにはパスフレーズを載せない。
  const waiter = await remoteWaitProcess(target, "t1", 0);
  assert.ok(waiter.args.includes("BatchMode=yes"));
  assert.equal(waiter.args.find((arg) => arg.startsWith("ControlPath=")), args.find((arg) => arg.startsWith("ControlPath=")));
});

test("接続先のshellを、cmd・PowerShell・POSIX系の展開の違いで見分ける", () => {
  assert.equal(classifyRemoteShell("aiterm-probe Windows_NT $PSHOME\r\n"), "cmd");
  assert.equal(classifyRemoteShell("aiterm-probe\r\n%OS%\r\nC:\\Program Files\\PowerShell\\7\r\n"), "powershell");
  assert.equal(classifyRemoteShell("aiterm-probe %OS%\n"), "posix");
  // cshは未定義変数で何も出さずに終わる。Windowsの印が無ければPOSIX系として扱う。
  assert.equal(classifyRemoteShell(""), "posix");
});

test("POSIX系ではログインshellからPATHだけを受け取り、処理は/bin/shで行う", () => {
  const command = remoteServerCommand("posix");
  assert.match(command, /^\/bin\/sh -c '/);
  assert.match(command, /-lc env/);
  assert.match(command, /exec aiterm-mcp'$/);
  assert.equal(command.slice("/bin/sh -c '".length, -1).includes("'"), false, "単引用符の中に単引用符を入れない");
  assert.equal(remoteServerCommand("powershell"), "aiterm-mcp");
  assert.equal(remoteServerCommand("cmd"), "aiterm-mcp");
});

test("完了待ちはPATHに無いaiterm-waitも同じpackageから探し、不正なsession名を埋め込まない", () => {
  const command = remoteWaitCommand("posix", "t1", 3, null, 600);
  assert.match(command, /command -v aiterm-wait/);
  assert.match(command, /aiterm-wait-cli\.js/);
  assert.match(command, /--session t1 --timeout 600 --cursor 3/);
  assert.equal(remoteWaitCommand("powershell", "t1", 3, null, 600), "aiterm-wait --session t1 --timeout 600 --cursor 3");
  assert.throws(() => remoteWaitCommand("posix", "t1;rm", 0, null, 1), /REMOTE_SESSION_INVALID/);
});

function fakeSsh(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-fake-ssh-"));
  fs.writeFileSync(path.join(dir, "ssh"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; fs.rmSync(dir, { recursive: true, force: true }); });
}

test("現地のaiterm-waitのreceiptをそのまま観測結果として返す", { skip: process.platform === "win32" }, async (t) => {
  const receipt = { schema: "aiterm.agent-wait-result.v1", session_id: "t1", launch_id: "a".repeat(32), vendor: "codex", harness: "codex-cli",
    outcome: "done", operation_id: null, vendor_session_id: "v", turn_id: "turn-1", malformed_events: 0, at: null, rate_limit: null, error: null };
  fakeSsh(t, `echo '${JSON.stringify(receipt)}'; exit 0`);
  const observed = await observeRemoteAgentDone({ host: "rabbit" }, "t1", { cursor: 0, timeout: 5 });
  assert.equal(observed.outcome, "done");
  assert.equal(observed.turn_id, "turn-1");
});

test("現地のaiterm-waitが失敗を返したら、つなぎ直さずに理由付きで失敗する", { skip: process.platform === "win32" }, async (t) => {
  fakeSsh(t, `echo '{"ok":false,"code":"AITERM_WAIT_FAILED","message":"agent session が見つかりません"}'; exit 1`);
  await assert.rejects(observeRemoteAgentDone({ host: "rabbit" }, "t1", { cursor: 0, timeout: 5 }), /REMOTE_WAIT_FAILED.*見つかりません/);
});

test("別端末の子は接続先ごとに予約し、観測と回答回収へ接続情報を渡す", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-remote-delivery-"));
  const calls = [];
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const remote = { host: "rabbit" };
  const b = { session_id: "t1", launch_id: "b".repeat(32), vendor: "codex", harness: "codex-cli", event_cursor: 0, operation_id: null, remote };
  const observation = { schema: "aiterm.agent-wait-result.v1", ...b, remote: undefined, outcome: "done", vendor_session_id: "v", turn_id: "turn-1",
    malformed_events: 0, at: null, rate_limit: null, error: null };
  const submitted = [];
  const manager = new ParentDeliveryManager({ root, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: "fixture" }],
    verify: async () => {},
    observe: async (session, options) => {
      calls.push({ kind: "observe", session, remote: options.remote, timeout: options.timeout });
      if (options.timeout === 0) return { ...observation, outcome: "running", turn_id: null };
      return done;
    },
    answer: async (session, options) => { calls.push({ kind: "answer", session, remote: options.remote }); return { text: "rabbit" }; },
    submit: async (target, id, text) => { submitted.push(text); return { queued_submission_id: null }; },
  } });
  t.after(async () => { await manager.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await manager.request(parent).before_send(b);
  const key = deliveryKey("t1", remote);
  assert.notEqual(key, "t1");
  assert.ok(fs.existsSync(path.join(root, "claims", `${key}.json`)));
  assert.equal(manager.status("t1").length, 0, "この端末の同名sessionとは混ぜない");
  resolveDone(observation);
  const end = Date.now() + 3000;
  while (manager.status(key)[0]?.state !== "submitted") {
    if (Date.now() > end) throw new Error("配送が完了しませんでした");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(calls.filter((call) => call.kind !== "observe" || call.timeout !== 0).map((call) => [call.kind, call.session, call.remote?.host]),
    [["observe", "t1", "rabbit"], ["answer", "t1", "rabbit"]]);
  assert.match(submitted[0], /rabbit$/);
});

test("別端末の記録は旧版が読む保存場所へ置かない", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-remote-root-"));
  const saved = process.env.XDG_RUNTIME_DIR;
  const savedBase = process.env.AITERM_STATE_BASE;
  delete process.env.AITERM_STATE_BASE;
  process.env.XDG_RUNTIME_DIR = dir;
  const manager = new ParentDeliveryManager({ parent_kind: "claude", remote: true,
    dependencies: { processes: () => [{ pid: process.pid, started_identity: "fixture" }] } });
  t.after(async () => {
    await manager.close();
    if (saved === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved;
    if (savedBase === undefined) delete process.env.AITERM_STATE_BASE; else process.env.AITERM_STATE_BASE = savedBase;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stateRoot = fs.readdirSync(dir).map((name) => path.join(dir, name)).find((name) => fs.existsSync(path.join(name, "agents")));
  assert.ok(fs.existsSync(path.join(stateRoot, "remote-claude-parent-deliveries", "active")));
  assert.equal(fs.existsSync(path.join(stateRoot, "claude-parent-deliveries")), false);
});
