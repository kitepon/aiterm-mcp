import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { appendMarkSentinel, atomicShellMultiline, isWin, macGuiTmuxPlist, sessionEnvironmentLaunch, markShellCommand,
  psmuxDesktopAccessWanted, psmuxServerAccessScript, openPsmuxServerToDesktop } from "../dist/tmux-runtime.js";

test("複数行のshell適合はhost OSによらず行を一括して渡す", () => {
  const source = "文字列'\\\n2行目\r\n";
  for (const shell of ["bash", "sh", "zsh", "dash", "pwsh", "powershell"]) {
    assert.doesNotMatch(atomicShellMultiline(source, shell), /[\r\n]/u, shell);
  }
  for (const command of ["node", "ssh", "fish"]) {
    assert.equal(atomicShellMultiline(source, command), source, command);
  }
});

test("appendMarkSentinel: POSIX形式は既存byte列を維持する", () => {
  assert.equal(
    appendMarkSentinel("echo ok", "bash"),
    `echo ok; printf '\\n<<<AITERM_DONE rc=%d>>>\\n' "$?"`,
  );
});

test("appendMarkSentinel: heredocの終端を保ち終了コードを取得する", { skip: isWin }, () => {
  for (const rc of [0, 7]) {
    const command = `node <<'NODE'\nconsole.log('本文'); process.exit(${rc});\nNODE`;
    const result = spawnSync("bash", ["-c", appendMarkSentinel(command, "bash")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `本文\n\n<<<AITERM_DONE rc=${rc}>>>\n`);
  }
});

test("appendMarkSentinel: 実行hostによらずPowerShellは数字sentinelを実行時生成する", () => {
  for (const shell of ["powershell", "pwsh"]) {
    const command = appendMarkSentinel("Write-Output ok", shell);
    assert.match(command, /if \(\$\?\)/);
    assert.match(command, /<<<AITERM_DONE rc=\{0\}>>>/);
    assert.doesNotMatch(command, /<<<AITERM_DONE rc=[0-9]+>>>/);
    assert.doesNotMatch(command, /printf/);
  }
});

test("markShellCommand: SSH先の現在のPowerShell promptを使い過去画面を拾わない", () => {
  assert.equal(markShellCommand('ssh', 'PowerShell 7.6.5\nPS C:\\Users\\kite_>\n\n'), 'pwsh');
  assert.equal(markShellCommand('ssh', 'PS C:\\Users\\kite_> exit\nkite@ubuntu:~$\n'), 'ssh');
  assert.equal(markShellCommand('ssh', 'PS C:\\Users\\kite_>\n処理中\n'), 'ssh');
  assert.equal(markShellCommand('ssh', 'PS C:\\Users\\kite_> hostname\n'), 'ssh');
  assert.equal(markShellCommand('pwsh', ''), 'pwsh');
});

test("旧tmuxにもsession識別を注入しnew-session -eを要求しない", { skip: isWin }, () => {
  const launch = sessionEnvironmentLaunch("/bin/sh", ["AITERM_SESSION_ID=legacy'quoted"], "tmux 3.1c");
  assert.deepEqual(launch.args, []);
  assert.equal(launch.register_after_start, true);
  const result = spawnSync("/bin/sh", ["-c", launch.shell], {
    input: "printf '%s' \"$AITERM_SESSION_ID\"\n", encoding: "utf8", env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "legacy'quoted");
  assert.deepEqual(sessionEnvironmentLaunch("bash", ["AITERM_SESSION_ID=modern"], "tmux 3.6a").args,
    ["-e", "AITERM_SESSION_ID=modern"]);
});

test("macOSのGUI側tmux起動jobは引数と環境を逐語でlaunchdへ渡し、終了コードを残す", { skip: isWin }, async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm gui-"));
  try {
    const plist = macGuiTmuxPlist("dev.aiterm.test", dir, ["/bin/sh", "-c", "printf '%s|%s' \"$1\" \"$AITERM_T\"; exit 3", "x", "a<b&c 'q'"],
      { AITERM_T: "値<&>", SKIP: undefined }, "/work dir");
    assert.match(plist, /<string>a&lt;b&amp;c 'q'<\/string>/);
    assert.match(plist, /<key>AITERM_T<\/key><string>値&lt;&amp;&gt;<\/string>/);
    assert.doesNotMatch(plist, /SKIP/);
    assert.match(plist, /<key>WorkingDirectory<\/key><string>\/work dir<\/string>/);
    assert.match(plist, /<key>AbandonProcessGroup<\/key><true\/>/);
    // ProgramArguments の script 部分を取り出し、launchd と同じ argv で実行する。
    const args = [...plist.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/)[1].matchAll(/<string>(.*?)<\/string>/g)]
      .map(match => match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    const result = spawnSync(args[0], args.slice(1), { env: { PATH: process.env.PATH, AITERM_T: "値<&>" } });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.join(dir, "out"), "utf8"), "a<b&c 'q'|値<&>");
    assert.equal(fs.readFileSync(path.join(dir, "status"), "utf8").trim(), "3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// psmux 3.3.8は、画面の無いlogon（ssh・service）で立てた本体を画面のある側から開けないと、その端末の控えを消す（psmux #650）。
test("psmuxの本体を画面のある側へ開く手当ては、直しの無い版で、画面のあるlogonの印が無い時だけ要る", () => {
  assert.equal(psmuxDesktopAccessWanted("3.3.8", {}), true);
  assert.equal(psmuxDesktopAccessWanted("3.3.8", { SSH_CONNECTION: "192.0.2.1 50000 192.0.2.2 22" }), true);
  assert.equal(psmuxDesktopAccessWanted("3.3.8", { SESSIONNAME: "Console" }), false);
  assert.equal(psmuxDesktopAccessWanted("3.3.8", { SESSIONNAME: "RDP-Tcp#0" }), false);
  assert.equal(psmuxDesktopAccessWanted("3.3.9", {}), false);
  assert.equal(psmuxDesktopAccessWanted("4.0.0", {}), false);
  assert.equal(psmuxDesktopAccessWanted(null, {}), false);
});

test("本体へ足す権利は、名前を問う権利（0x1000）だけで、画面のある側のprocessからは何もしない", () => {
  const script = psmuxServerAccessScript(4321);
  assert.match(script, /SessionId -ne 0\) \{ 'desktop'; exit 0 \}/u);
  assert.match(script, /\[AitermPsmuxAccess\]::Grant\(4321, \[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value, 0x1000\)/u);
  // 本体を開く時の権利は、控えの読み書きに要る READ_CONTROL と WRITE_DAC だけ。
  assert.match(script, /OpenProcess\(0x00060000, false, pid\)/u);
  assert.equal(Buffer.from(Buffer.from(script, "utf16le").toString("base64"), "base64").toString("utf16le"), script);
});

function accessRun(steps) {
  const calls = [];
  let paused = 0;
  const result = openPsmuxServerToDesktop("seat", {
    wanted: steps.wanted ?? true,
    tmux: (...args) => { calls.push(args[0]); return (args[0] === "display-message" ? steps.pid : steps.has)?.(calls.filter(c => c === args[0]).length) ?? { code: 1, stdout: "" }; },
    grant: (pid) => { calls.push(`grant:${pid}`); return steps.grant; },
    pause: (ms) => { paused += ms; },
  });
  return { result, calls, paused };
}

test("要らない時は、psmuxもPowerShellも呼ばない", () => {
  assert.deepEqual(accessRun({ wanted: false }), { result: "skipped", calls: [], paused: 0 });
});

test("立てた直後に控えを消されていても、本体が書き戻すのを待ってから権利を足し、控えが戻ってから返す", () => {
  const run = accessRun({
    pid: n => n < 3 ? { code: 1, stdout: "" } : { code: 0, stdout: "4321\r\n" },
    grant: "ok",
    has: n => ({ code: n < 2 ? 1 : 0, stdout: "" }),
  });
  assert.equal(run.result, "granted");
  assert.deepEqual(run.calls, ["display-message", "display-message", "display-message", "grant:4321", "has-session", "has-session"]);
  assert.equal(run.paused, 750);
});

test("画面のある側のprocessと分かった時は、権利を足さずに返す", () => {
  const run = accessRun({ pid: () => ({ code: 0, stdout: "77\n" }), grant: "desktop" });
  assert.equal(run.result, "desktop");
  assert.deepEqual(run.calls, ["display-message", "grant:77"]);
});

test("権利を足せない時も端末は使わせる。投げずに、理由を1行だけstderrへ書く。待ちは10秒より短い", () => {
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  let refused, lost;
  try {
    refused = accessRun({ pid: () => ({ code: 0, stdout: "77" }), grant: "OpenProcess 5" });
    lost = accessRun({ grant: "ok" });
  } finally { process.stderr.write = original; }
  assert.equal(refused.result, "failed");
  assert.deepEqual(refused.calls, ["display-message", "grant:77"]);
  assert.equal(lost.result, "failed");
  assert.equal(lost.calls.includes("grant:0"), false);
  assert.ok(lost.paused <= 5500, String(lost.paused));
  assert.deepEqual(written, [
    "aiterm: PSMUX_SERVER_ACCESS_NOT_GRANTED session=seat OpenProcess 5\n",
    "aiterm: PSMUX_SERVER_ACCESS_NOT_GRANTED session=seat psmuxの本体のpidを問えません\n",
  ]);
});
