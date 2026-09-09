import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { appendMarkSentinel, isWin, sessionEnvironmentLaunch, markShellCommand } from "../dist/tmux-runtime.js";

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
