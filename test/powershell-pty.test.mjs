import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasBackend = spawnSync(process.platform === "win32" ? "psmux" : "tmux", ["-V"]).status === 0;
const hasPowerShell = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]).status === 0;
const skip = hasBackend && hasPowerShell ? undefined : "端末backendとPowerShell 7が必要";
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-powershell-test-"));
const core = await import("../dist/core.js");

test("PowerShellの複数行は記述順に実行し、完了印と変数を保持する", { skip }, async () => {
  const session = "powershell_multiline_order";
  core.openSession(session, "pwsh");
  try {
    core.send(session, "[Console]::WriteLine('準備' + '完了')", { mark: true });
    await core.readOutput(session, { wait: true, timeout: 5 });
    core.send(session, "$aitermValue = 42\n$aitermValue += 8\n[Console]::WriteLine('SUM=' + $aitermValue)", { mark: true });
    const result = await core.readOutput(session, { wait: true, timeout: 5 });
    assert.match(result, /SUM=50(?!\d)/u, result);
    assert.ok(result.indexOf("SUM=50") < result.indexOf("<<<AITERM_DONE rc=0>>>"), result);
    assert.match(result, /is_complete=True via mark/u, result);
    core.send(session, "[Console]::WriteLine('PERSIST=' + $aitermValue)", { mark: true });
    assert.match(await core.readOutput(session, { wait: true, timeout: 5 }), /PERSIST=50(?!\d)/u);
  } finally {
    core.closeSession(session);
  }
});

test("PowerShellのhere-stringはEnterまで実行せず、完了印なしでも順序を保つ", { skip }, async () => {
  const session = "powershell_multiline_enter";
  core.openSession(session, "pwsh");
  try {
    core.send(session, "[Console]::WriteLine('準備' + '完了')", { mark: true });
    await core.readOutput(session, { wait: true, timeout: 5 });
    const body = "$aitermText = @'\n日本語の\"引用\"と'$変数\n2行目\n'@\n[Console]::WriteLine('TEXT=' + ($aitermText -replace '\\r?\\n', '|'))";
    core.send(session, body, { enter: false });
    const pending = await core.readOutput(session);
    assert.doesNotMatch(pending, /TEXT=日本語/u, pending);
    core.sendKey(session, "Enter");
    const result = await core.readOutput(session, { wait: true, timeout: 5, until: 'TEXT=日本語の"引用"と\'$変数|2行目' });
    assert.match(result, /is_complete=True via until/u, result);
  } finally {
    core.closeSession(session);
  }
});
