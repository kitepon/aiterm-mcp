// tmux 実機を使う統合テスト: 内容を評価しない送信 / サニタイズ / sendKey / listSessions / mark+完了検出。
// 本番ソケット(claude.sock)を汚さぬよう TMPDIR を一時ディレクトリへ向け、専用ソケットで隔離する。
// 実行させない送信確認は enter:false で打鍵だけ行い、C-u で消す。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Windows ネイティブは tmux CLI 互換の psmux を叩く。検出も同じ経路に合わせる。
const hasTmux =
  (process.platform === "win32"
    ? spawnSync("psmux", ["-V"])
    : spawnSync("tmux", ["-V"])
  ).status === 0;
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-test-"));
const core = await import("../dist/core.js");
const SOCKDIR = path.join(process.env.TMPDIR, "claude-tmux-sockets");
const skip = hasTmux ? undefined : "tmux 未インストール";
// B8: 非 POSIX 対話シェル(csh/tcsh/fish)前面での mark 拒否を実テストする。csh は macOS 標準。
const hasCsh = spawnSync(process.platform === "win32" ? "where" : "which", ["csh"]).status === 0;
const skipB8 = hasTmux && hasCsh ? undefined : "tmux か csh 未インストール";
const hasPowerShell =
  process.platform === "win32" && spawnSync("where", ["powershell"]).status === 0;
const skipPowerShellMark =
  hasTmux && hasPowerShell ? undefined : "Windows、psmux、Windows PowerShell が必要";
const SESS = "selftest";
// cwdを使う後続テストの出力を作業treeへ残さないため、sessionは使い捨てdirectoryで動かす。
const SANDBOX = hasTmux ? fs.mkdtempSync(path.join(process.env.TMPDIR, "sandbox-")) : "";

before(() => {
  if (hasTmux) {
    core.openSession(SESS);
    core.send(SESS, `cd ${SANDBOX}`, { force: true }); // 以後この session の cwd はサンドボックス
  }
});
after(() => { if (hasTmux) { try { core.killAll(); } catch {} } });

// 前面コマンドが cmd になるまでポーリングする（固定 sleep は負荷の高い runner で不安定＝C8）。
// listSessions の各行は "name\tcurrent_command\t...\t..."。
async function waitForForeground(name, cmd, timeoutMs = 3000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const line = core.listSessions().split("\n").find((l) => l.startsWith(name + "\t"));
    if (line && line.split("\t")[1] === cmd) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function runConcurrentSender(session, char, count) {
  const coreUrl = new URL("../dist/core.js", import.meta.url).href;
  const script =
    `import * as core from ${JSON.stringify(coreUrl)};` +
    `core.send(process.argv[2], process.argv[1].repeat(Number(process.argv[3])), ` +
    `{ raw: true, force: true, enter: false });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, char, session, String(count)], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sender ${char} exit=${code}: ${stderr}`));
    });
  });
}

// ---------------------------------------------------------------- 送信内容はAitermが評価しない
for (const text of ["Explain DROP TABLE", "Review rm -rf /", "git reset --hard の意味を説明する"]) {
  test(`send: 内容を危険判定せず送信する（${text}）`, { skip }, () => {
    const result = core.send(SESS, text, { enter: false });
    assert.match(result, /sent \d+ chars/);
    core.sendKey(SESS, "C-u");
  });
}

test("send: rtk書換後の内容も評価せず送信する", { skip: skip ?? (process.platform === "win32" ? "拡張子なし fake rtk script は Windows の spawnSync で実行不可（実 rtk は native exe）" : undefined) }, () => {
  const fakeDir = fs.mkdtempSync(path.join(process.env.TMPDIR, "fake-rtk-"));
  const fakeRtk = path.join(fakeDir, "rtk");
  const oldPath = process.env.PATH;
  const rtkSession = "selftest_rtk_content";
  const rewritten = "Explain DROP TABLE";
  fs.writeFileSync(fakeRtk, `#!/bin/sh\n[ "$1" = rewrite ] && printf '%s\\n' '${rewritten}'\n`);
  fs.chmodSync(fakeRtk, 0o755);
  process.env.PATH = `${fakeDir}${path.delimiter}${oldPath ?? ""}`;
  core.openSession(rtkSession);
  try {
    const result = core.send(rtkSession, "source text", { rtk: true, enter: false });
    assert.match(result, /sent \d+ chars/);
    core.sendKey(rtkSession, "C-u");
  } finally {
    process.env.PATH = oldPath;
    try { core.closeSession(rtkSession); } catch {}
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- サニタイズ（送信文字数で確認）
test("サニタイズ: 制御文字を除去（既定）", { skip }, () => {
  const r = core.send(SESS, "ab\x07", { enter: false }); // BEL 除去 → "ab"=2
  assert.equal(r, `sent 2 chars to ${SESS}`);
  core.sendKey(SESS, "C-u");
});
test("サニタイズ: raw=true は素通し", { skip }, () => {
  const r = core.send(SESS, "ab\x07", { raw: true, enter: false }); // 素通し → 3
  assert.equal(r, `sent 3 chars to ${SESS}`);
  core.sendKey(SESS, "C-u");
});

test("send: 6,000文字の入力を途中欠落させずPTYへ送る", { skip }, async () => {
  const session = "selftest_long_input";
  core.openSession(session);
  try {
    const marker = "<<<AITERM_LONG_INPUT len=6000>>>";
    // 256byte境界直後に3byte文字を置き、chunk分割がUTF-8を壊さないことも同時に固定する。
    const value = `${"x".repeat(255)}あ${"x".repeat(5744)}`;
    const command = `v=${value}; printf '\\n<<<AITERM_LONG_INPUT len=%s>>>\\n' "\${#v}"`;
    core.send(session, command, { force: true });
    const out = await core.readOutput(session, { wait: true, until: marker, timeout: 5 });
    assert.ok(out.includes(marker), `長いcommandの末尾まで実行される: ${JSON.stringify(out)}`);
    assert.match(out, /is_complete=True via until/, "指定markerが完了証拠になる");
  } finally {
    core.closeSession(session);
  }
});

test("send: shellへの複数行は途中の対話programに後続行を奪わせない", { skip }, async () => {
  const session = "selftest_multiline_atomic";
  core.openSession(session);
  try {
    const marker = "<<<AITERM_AFTER_STEALER>>>";
    core.send(session, "stty -echo", { force: true });
    await core.readOutput(session, { wait: true, timeout: 2, raw: true });
    const stealer =
      `node -e 'process.stdin.setRawMode?.(true); process.stdin.resume(); ` +
      `process.stdin.once("data",d=>{console.log("<<<AITERM_STOLEN_DATA>>>");process.exit(0)}); ` +
      `setTimeout(()=>{console.log("<<<AITERM_STOLEN_NONE>>>");process.exit(0)},250)'`;
    core.send(session, `${stealer}\nprintf '${marker}\\n'`, { force: true, mark: true });
    const out = await core.readOutput(session, { wait: true, until: marker, timeout: 3, raw: true });
    assert.ok(out.includes("<<<AITERM_STOLEN_NONE>>>"), `途中programが後続行をPTY入力として奪っていない: ${JSON.stringify(out)}`);
    assert.ok(!out.includes("<<<AITERM_STOLEN_DATA>>>"), `途中programが入力を盗んだ: ${JSON.stringify(out)}`);
    assert.ok(out.includes(marker), "後続行がshell scriptとして実行される");
  } finally {
    try { core.closeSession(session); } catch {}
  }
});

test("send: 別processの同一session送信をchunk単位で混線させない", { skip }, async () => {
  const session = "selftest_send_lock";
  const outputPath = path.join(process.env.TMPDIR, "send-lock-output.bin");
  // Windows native pane（Git Bash）はドライブパスを forward slash 形で受ける。
  const shellOutputPath = process.platform === "win32" ? outputPath.replace(/\\/g, "/") : outputPath;
  core.openSession(session);
  try {
    const ready = "<<<AITERM_SEND_LOCK_READY>>>";
    const done = "<<<AITERM_SEND_LOCK_DONE>>>";
    core.send(
      session,
      `stty raw -echo; printf '<<<AITERM_SEND_LOCK_%s>>>\\n' READY; ` +
        `dd bs=1 count=12000 of='${shellOutputPath}' 2>/dev/null; stty sane; ` +
        `printf '<<<AITERM_SEND_LOCK_%s>>>\\n' DONE`,
      { force: true },
    );
    await core.readOutput(session, { wait: true, until: ready, timeout: 5, raw: true });
    await Promise.all([runConcurrentSender(session, "A", 6000), runConcurrentSender(session, "B", 6000)]);
    await core.readOutput(session, { wait: true, until: done, timeout: 5, raw: true });
    const actual = fs.readFileSync(outputPath, "utf8");
    const ab = `${"A".repeat(6000)}${"B".repeat(6000)}`;
    const ba = `${"B".repeat(6000)}${"A".repeat(6000)}`;
    assert.ok(
      actual === ab || actual === ba,
      `send全体が直列化され、2つの文字列が混線しない: len=${actual.length} head=${JSON.stringify(actual.slice(0, 80))} tail=${JSON.stringify(actual.slice(-80))}`,
    );
  } finally {
    try { core.closeSession(session); } catch {}
    fs.rmSync(outputPath, { force: true });
  }
});

test("send: Windows psmuxで別sessionのbuffer送信を並行実行しても消失しない", {
  skip: process.platform === "win32" ? skip : "Windows psmux 固有",
}, async () => {
  const sessions = Array.from({ length: 8 }, (_, i) => `selftest_cross_send_${i}`);
  for (const session of sessions) core.openSession(session);
  try {
    for (let round = 0; round < 8; round += 1) {
      await Promise.all(sessions.map((session, i) => runConcurrentSender(session, String(i), 200)));
    }
  } finally {
    for (const session of sessions) {
      try { core.closeSession(session); } catch {}
    }
  }
});

test("send: 64KiB超の入力はchunk生成前にfail-loud", { skip }, () => {
  assert.throws(
    () => core.send(SESS, "x".repeat(64 * 1024 + 1), { force: true, enter: false }),
    (e) => e.code === 2 && /65536 bytes/.test(e.message) && /65537 bytes/.test(e.message),
  );
});

test("send: stale send lockを並行自動回収せずfail-closedし、close後に復旧する", { skip }, async () => {
  const session = "selftest_stale_send_lock";
  const lockPath = path.join(SOCKDIR, `${session}.send.lock`);
  core.openSession(session);
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2147483647, at: "2000-01-01T00:00:00.000Z", token: "stale" }) + "\n",
      { mode: 0o600 },
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => runConcurrentSender(session, String.fromCharCode(65 + i), 6000)),
    );
    assert.ok(attempts.every((r) => r.status === "rejected"), "全senderが送信前にfail-closedする");
    for (const attempt of attempts) {
      assert.match(attempt.reason.message, /pty_list/);
      assert.match(attempt.reason.message, /pty_close/);
      assert.doesNotMatch(attempt.reason.message, /pty_kill_all/);
    }
    assert.ok(fs.existsSync(lockPath), "stale pathを並行reclaimerがunlinkしない");
  } finally {
    core.closeSession(session);
  }
  assert.ok(!fs.existsSync(lockPath), "session停止後のcloseがstale lockを掃除する");
  core.openSession(session);
  try {
    const r = core.send(session, "STALE_LOCK_CLOSED_AND_REOPENED", { force: true, enter: false });
    assert.match(r, /sent 30 chars/);
    core.sendKey(session, "C-u");
  } finally {
    core.closeSession(session);
  }
});

test("send raw: 制御文字とtabをtmux側で再変換しない", { skip }, async () => {
  const session = "selftest_raw_bytes";
  core.openSession(session);
  try {
    const ready = "<<<AITERM_RAW_READY>>>";
    core.send(
      session,
      `stty raw -echo; printf '<<<AITERM_RAW_%s>>>\\n' READY; dd bs=1 count=9 2>/dev/null | od -An -tx1; stty sane`,
      { force: true },
    );
    await core.readOutput(session, { wait: true, until: ready, timeout: 5, raw: true });
    core.send(session, "A\x07B\x1bC\x7fD\t\n", { raw: true, force: true, enter: false });
    const expected = /41\s+07\s+42\s+1b\s+43\s+7f\s+44\s+09\s+0a/;
    const out = await core.readOutput(session, {
      wait: true,
      until: "09\\s+0a",
      untilRegex: true,
      timeout: 5,
      raw: true,
    });
    assert.match(out, expected, `raw payload 9byteが無変換でPTYへ届く: ${JSON.stringify(out)}`);
  } finally {
    core.closeSession(session);
  }
});

// agent dispatch 経路の paste 原子化。ready gate通過済みagent TUIへ、本文全体を1回だけ
// 明示wrapperで包む（POSIX tmux・Windows psmuxとも。chunkごとに包むと別々の貼り付けになる）。
test("send bracketedPaste: 本文全体を1回だけESC[200~/201~で包む", { skip }, async () => {
  const session = "selftest_brkt";
  core.openSession(session);
  try {
    core.send(
      session,
      `stty raw -echo; printf '<<<AITERM_BRKT_%s>>>\\n' READY; dd bs=1 count=18 2>/dev/null | od -An -tx1; stty sane; printf '<<<AITERM_BRKT_%s>>>\\n' OFF`,
      { force: true },
    );
    await core.readOutput(session, { wait: true, until: "<<<AITERM_BRKT_READY>>>", timeout: 5, raw: true });
    core.send(session, "hello!", { raw: true, force: true, enter: false, bracketedPaste: true });
    // ESC[200~(6) + "hello!"(6) + ESC[201~(6) = 18 bytes
    const bracketed = await core.readOutput(session, {
      wait: true,
      until: "<<<AITERM_BRKT_OFF>>>",
      timeout: 5,
      raw: true,
    });
    // psmux(Windows) は stty sane 直後のCSIエコーが od のhex出力行間へ割り込むことがある
    // （内容は完全・表示順だけの差）。CSI シーケンスを剥いでから hex 列の連続性を照合する。
    const bracketedHex = bracketed.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    assert.match(
      bracketedHex,
      /1b\s+5b\s+32\s+30\s+30\s+7e\s+68\s+65\s+6c\s+6c\s+6f\s+21\s+1b\s+5b\s+32\s+30\s+31\s+7e/,
      `bracket 付きで届く: ${JSON.stringify(bracketed)}`,
    );
  } finally {
    core.closeSession(session);
  }
});

test("send bracketedPaste: 256byteを超える本文もchunkごとに包まない", { skip: skip ?? (process.platform === "win32" ? "Windows psmuxは全体を1回のSendBytesで送る別経路" : undefined) }, async () => {
  const session = "selftest_brkt_long";
  core.openSession(session);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-brkt-"));
  const out = path.join(dir, "paste.bin");
  try {
    // 3byte文字と画像pathを混ぜ、256byteの切れ目がpathの途中に来る長さにする。
    const body = `${"あ".repeat(80)}\n/tmp/bellteam-image-aa07a3a6-7ac7-4101-9d8b-55ffecfc60e4.jpg\n${"い".repeat(120)}\n確認する。`;
    const bytes = Buffer.byteLength(body, "utf8") + 12;
    assert.ok(bytes > 512, `3 chunk以上になる長さ: ${bytes}`);
    core.send(
      session,
      `stty raw -echo; printf '\\033[?2004h<<<AITERM_LONG_%s>>>\\n' READY; dd bs=1 count=${bytes} of='${out}' 2>/dev/null; stty sane; printf '\\033[?2004l<<<AITERM_LONG_%s>>>\\n' DONE`,
      { force: true },
    );
    await core.readOutput(session, { wait: true, until: "<<<AITERM_LONG_READY>>>", timeout: 5, raw: true });
    core.send(session, body, { raw: true, force: true, enter: false, bracketedPaste: true });
    await core.readOutput(session, { wait: true, until: "<<<AITERM_LONG_DONE>>>", timeout: 10, raw: true });
    const got = fs.readFileSync(out, "utf8");
    assert.equal(got, `\x1b[200~${body}\x1b[201~`, "開始と終了の印が1組だけで、本文は切れずに届く");
  } finally {
    core.closeSession(session);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- sendKey
test("sendKey: 別名→tmux キー名・戻り値", { skip }, () => {
  assert.equal(core.sendKey(SESS, "C-c"), `sent key C-c to ${SESS}`);
  assert.equal(core.sendKey(SESS, "ctrl-c"), `sent key C-c to ${SESS}`);
  assert.equal(core.sendKey(SESS, "enter"), `sent key Enter to ${SESS}`);
  assert.equal(core.sendKey(SESS, "Up"), `sent key Up to ${SESS}`);
  assert.equal(core.sendKey(SESS, "Zz9"), `sent key Zz9 to ${SESS}`); // 未知は素通し
});
test("sendKey: 欠如セッションはエラー(code2)", { skip }, () => {
  assert.throws(() => core.sendKey("no_such_xyz", "C-c"), (e) => e.code === 2);
});

// ---------------------------------------------------------------- openSession 副作用 / 重複
test("openSession: 副作用(.log/.offset=0) と重複エラー(code2)", { skip }, () => {
  assert.ok(fs.existsSync(path.join(SOCKDIR, SESS + ".log")), ".log 作成");
  assert.equal(fs.readFileSync(path.join(SOCKDIR, SESS + ".offset"), "utf8"), "0");
  assert.throws(() => core.openSession(SESS), (e) => e.code === 2); // 重複
});

// ---------------------------------------------------------------- listSessions / closeSession
test("listSessions: 開いているセッションを列挙", { skip }, () => {
  assert.ok(core.listSessions().includes(SESS));
});
test("closeSession: 非存在でも冪等", { skip }, () => {
  assert.equal(core.closeSession("no_such_close_xyz"), "closed no_such_close_xyz");
});

// ---------------------------------------------------------------- mark + 完了検出（sentinel 自動検出）
test("send mark + read wait: sentinel を自動検出し is_complete=True via mark", { skip }, async () => {
  const rt = "selftest_rt";
  core.openSession(rt);
  try {
    core.send(rt, "echo HELLO_AITERM", { mark: true });
    // until を渡さなくても mark 完了検出（数字アンカー sentinel）で確定する。
    const out = await core.readOutput(rt, { wait: true, timeout: 5 });
    assert.ok(out.includes("HELLO_AITERM"), `出力に HELLO: ${out}`);
    assert.match(out, /is_complete=True via mark/);
  } finally {
    core.closeSession(rt);
  }
});

// B1 回帰: mark はコマンド行のエコー(rc=%d)でなく実出力(rc=<数字>)の sentinel で完了する。
// 遅延コマンドでエコー早期誤完了が起きれば DELAYED_DONE を含まず nested/timeout になる＝失敗する。
// この2条件（実出力を含む∧via mark）で「数字アンカーによるエコー免疫」と「mark時のnested抑止」を固定。
test("send mark + read wait: 遅延コマンドでエコー早期完了しない（B1）", { skip }, async () => {
  const rb = "selftest_b1";
  core.openSession(rb);
  try {
    core.send(rb, "sleep 0.6; echo DELAYED_DONE", { mark: true });
    const out = await core.readOutput(rb, { wait: true, timeout: 6 });
    assert.match(out, /is_complete=True via mark/, `mark 完了であること: ${out}`);
    assert.ok(out.includes("DELAYED_DONE"), `実出力を待ってから完了（エコー早期完了でない）: ${out}`);
  } finally {
    core.closeSession(rb);
  }
});

// Windows ネイティブの既定対話シェルでも mark を完了証拠として使えることを固定する。
// command echo に完成済み sentinel を含めると早期完了するため、遅延出力も必ず観測する。
test("send mark + read wait: PowerShell で sentinel を実行時生成する", { skip: skipPowerShellMark }, async () => {
  const ps = "selftest_powershell_mark";
  core.openSession(ps, "powershell");
  try {
    core.send(ps, "Start-Sleep -Milliseconds 600; Write-Output POWERSHELL_DELAYED_DONE", { mark: true });
    const out = await core.readOutput(ps, { wait: true, timeout: 6 });
    assert.ok(out.includes("POWERSHELL_DELAYED_DONE"), `PowerShell の実出力を待つこと: ${out}`);
    assert.match(out, /<<<AITERM_DONE rc=0>>>/, `PowerShell の成功状態を出力すること: ${out}`);
    assert.match(out, /is_complete=True via mark/, `mark 完了であること: ${out}`);

    core.send(ps, "Write-Output '日本語PTY確認'; rg --version | Select-Object -First 1", { mark: true });
    const tools = await core.readOutput(ps, { wait: true, timeout: 6 });
    assert.match(tools, /日本語PTY確認/u, `PowerShell 7 paneが日本語を保持すること: ${tools}`);
    assert.match(tools, /ripgrep \d+/u, `PowerShell 7 paneからrgを実行できること: ${tools}`);
    assert.match(tools, /<<<AITERM_DONE rc=0>>>/, `日本語／rg smokeもmark成功すること: ${tools}`);

    core.send(ps, "Write-Error POWERSHELL_EXPECTED_FAILURE -ErrorAction Continue", { mark: true });
    const failed = await core.readOutput(ps, { wait: true, timeout: 6 });
    assert.match(failed, /<<<AITERM_DONE rc=1>>>/, `PowerShell の失敗状態を 1 で出力すること: ${failed}`);
    assert.match(failed, /is_complete=True via mark/, `失敗時も mark 完了であること: ${failed}`);
  } finally {
    core.closeSession(ps);
  }
});

// B8: mark はPOSIXとPowerShellに対応する。どちらの状態取得構文にも従わないcsh/tcsh/fishなら
// 黙って壊れた完了検出を作らず、明示エラー(code2)で拒否する。ssh/docker→リモート bash は前面が
// "ssh"/"docker" で本集合に含まれずPOSIX形式を使う（＝mark の主要用途を壊さない）。
test("send mark: 非 POSIX 前面シェル(csh)では mark を拒否", { skip: skipB8 }, async () => {
  const b8 = "selftest_b8";
  core.openSession(b8);
  try {
    core.send(b8, "csh"); // 前面を csh へ（非 POSIX）
    assert.ok(await waitForForeground(b8, "csh"), "csh が前面に出ない（C8）");
    assert.throws(
      () => core.send(b8, "echo hi", { mark: true }),
      (e) => e.code === 2 && /POSIX/.test(e.message),
    );
  } finally {
    core.closeSession(b8); // kill-session で csh も終了
  }
});

// ---------------------------------------------------------------- quiescent 完了検出
test("read wait: 短命コマンドは quiescent で完了", { skip }, async () => {
  const q = "selftest_q";
  core.openSession(q);
  try {
    core.send(q, "echo QUIET_OK");
    const out = await core.readOutput(q, { wait: true, timeout: 5 });
    assert.ok(out.includes("QUIET_OK"));
    assert.match(out, /is_complete=True via (quiescent|until)/);
  } finally {
    core.closeSession(q);
  }
});

// ---------------------------------------------------------------- ネスト早期リターン（nested）
// 前面が非シェル(ssh/docker/REPL 相当)＋until 無しは quiescence が原理的に発火できない。
// 出力静止時点で nested として is_complete=False を早期に返し、フル timeout を空費しない。
// Windows skip の理由（プラットフォーム制約・実測 2026-08-16）: Git Bash(MSYS2) は fork/exec の
// 中間プロセスが即座に消え、子（cat 等）の Windows PPID が死んだ pid を指す。PPID 鎖が切れるため
// psmux の前面プロセス検出（プロセスツリー walk）は MSYS2 配下の孫へ原理的に届かず、
// pane_current_command は bash のまま＝nested 判定が成立しない。cmd/pwsh/native 連鎖では検出できる。
// Windows で非シェル前面の完了判定が要る場合は until / mark を使う（quiescence の shell 復帰
// シグナルだけに依存しない）。
const skipNested = process.platform === "win32" ? "MSYS2のPPID切断でWindowsは前面プロセス検出不可（上記コメント参照）" : skip;
test("read wait: ネスト中(前面が非シェル)＋until無しは nested で早期 False", { skip: skipNested }, async () => {
  const nst = "selftest_nested";
  core.openSession(nst);
  try {
    core.send(nst, "cat"); // 前面コマンドが cat（SHELLS 集合外）＝ネスト相当
    assert.ok(await waitForForeground(nst, "cat"), "cat が前面に出ない（C8: 固定 sleep でなくポーリング）");
    const t0 = performance.now();
    const out = await core.readOutput(nst, { wait: true, timeout: 5 });
    const dt = performance.now() - t0;
    assert.match(out, /is_complete=False via nested/, `nested 判定であること: ${out}`);
    assert.ok(dt < 4000, `フル timeout(5s)前に早期返却すること: ${Math.round(dt)}ms`);
  } finally {
    core.closeSession(nst); // kill-session で cat も終了
  }
});

// ---------------------------------------------------------------- until リテラル既定 / 正規表現オプトイン（B4/B13）
// 既定はリテラル部分一致。正規表現 "1+1" は文字列 "1+1" に非一致だが、リテラルなら一致して完了する。
test("read wait: until は既定でリテラル部分一致（メタ化しない）（B4）", { skip }, async () => {
  const b4 = "selftest_b4";
  core.openSession(b4);
  try {
    core.send(b4, "echo AA1+1BB"); // 出力に "1+1" を含む（正規表現 1+1 は非一致・リテラルは一致）
    const out = await core.readOutput(b4, { wait: true, until: "1+1", timeout: 5 });
    assert.match(out, /is_complete=True via until/, `until リテラル一致で完了: ${out}`);
  } finally {
    core.closeSession(b4);
  }
});
test("read wait: until_regex:true で正規表現一致（B4）", { skip }, async () => {
  const b4r = "selftest_b4r";
  core.openSession(b4r);
  try {
    core.send(b4r, "echo RESULT_42_END");
    const out = await core.readOutput(b4r, {
      wait: true,
      until: "RESULT_[0-9]+_END",
      untilRegex: true,
      timeout: 5,
    });
    assert.match(out, /is_complete=True via until/, `正規表現一致で完了: ${out}`);
  } finally {
    core.closeSession(b4r);
  }
});
test("read wait: 不正な until 正規表現は明示エラー(code2)（B13）", { skip }, async () => {
  const b13 = "selftest_b13";
  core.openSession(b13);
  try {
    await assert.rejects(
      () => core.readOutput(b13, { wait: true, until: "[unclosed", untilRegex: true, timeout: 2 }),
      (e) => e.code === 2 && /until 正規表現/.test(e.message),
    );
  } finally {
    core.closeSession(b13);
  }
});

// ---------------------------------------------------------------- stale-log 復活防止 / killAll 掃除（B5/B9/B14）
test("openSession: 事前に残った同名 .log を truncate し旧出力を復活させない（B5）", { skip }, async () => {
  const nm = "selftest_stale";
  fs.mkdirSync(SOCKDIR, { recursive: true });
  fs.writeFileSync(path.join(SOCKDIR, nm + ".log"), "STALE_OLD_DATA_XYZ\n"); // 外部kill で残った旧ログ相当
  core.openSession(nm); // 既存 .log は truncate されるべき（"a" なら旧データが残る）
  try {
    core.send(nm, "echo FRESH_OK");
    const out = await core.readOutput(nm, { wait: true, timeout: 5 });
    assert.ok(!out.includes("STALE_OLD_DATA_XYZ"), `旧ログが復活した: ${out}`);
    assert.ok(out.includes("FRESH_OK"), `新出力が読めない: ${out}`);
  } finally {
    core.closeSession(nm);
  }
});
test("killAll: SOCKDIR の残骸ファイル(.log 等)も掃除する（B9）", { skip }, () => {
  core.openSession("selftest_ka1");
  core.send("selftest_ka1", "echo x");
  assert.ok(fs.existsSync(path.join(SOCKDIR, "selftest_ka1.log")), "前提: log が作られている");
  core.killAll();
  assert.ok(!fs.existsSync(path.join(SOCKDIR, "selftest_ka1.log")), "killAll が .log を残した（B9）");
  // killAll は SESS も消すため後続テストのために復元する（順序非依存にする）。
  core.openSession(SESS);
  core.send(SESS, `cd ${SANDBOX}`, { force: true });
});
test("read screen+wait: wait を尊重し完了後の画面＋is_complete を返す（B11）", { skip }, async () => {
  const sw = "selftest_sw";
  core.openSession(sw);
  try {
    core.send(sw, "echo SCREENWAIT_OK");
    // 従来 screen は wait ブロックの手前で return し完了検出が黙殺されていた。今は待ってから撮る。
    const out = await core.readOutput(sw, { screen: true, wait: true, timeout: 5 });
    assert.ok(out.includes("SCREENWAIT_OK"), `画面に出力: ${out}`);
    assert.match(out, /is_complete=True/, `screen+wait で完了検出が付く: ${out}`);
  } finally {
    core.closeSession(sw);
  }
});

// ---------------------------------------------------------------- session 名検証（トラバーサル/インジェクション遮断）
// 検証は tmux 呼び出し前に throw するので OS 非依存・skip 不要。
const BAD_NAMES = [
  ["../evil", "パストラバーサル"],
  ["a'b", "シングルクオート"],
  ["a;rm", "セミコロン"],
  ["a$x", "ドル展開"],
  ["a b", "空白"],
  ["a/b", "スラッシュ"],
  ["a".repeat(65), "65文字超"],
];
for (const [bad, label] of BAD_NAMES) {
  test(`session 名検証: ${label} を拒否(code2・未作成)`, () => {
    assert.throws(() => core.openSession(bad), (e) => e.code === 2);
    assert.ok(!fs.existsSync(path.join(SOCKDIR, bad + ".log")), "拒否時に .log を作らない");
  });
}
test("session 名検証: send/sendKey/close も不正名を拒否(code2)", () => {
  assert.throws(() => core.send("a;b", "x"), (e) => e.code === 2);
  assert.throws(() => core.sendKey("a;b", "C-c"), (e) => e.code === 2);
  assert.throws(() => core.closeSession("a;b"), (e) => e.code === 2);
});
test("session 名検証: readOutput(async) も不正名を拒否(code2)", async () => {
  await assert.rejects(() => core.readOutput("a;b", {}), (e) => e.code === 2);
});
test("session 名検証: closeSession のトラバーサルは SOCKDIR 外を消さない", () => {
  fs.mkdirSync(SOCKDIR, { recursive: true });
  const victim = path.join(SOCKDIR, "..", "aiterm_traversal_victim.log");
  fs.writeFileSync(victim, "keep");
  try {
    assert.throws(() => core.closeSession("../aiterm_traversal_victim"), (e) => e.code === 2);
    assert.ok(fs.existsSync(victim), "外部ファイルは削除されない");
  } finally {
    try { fs.unlinkSync(victim); } catch {}
  }
});
