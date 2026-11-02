import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { capturePtyFailure } from "./pty-failure-evidence.mjs";

const hasBackend = spawnSync(process.platform === "win32" ? "psmux" : "tmux", ["-V"]).status === 0;
const hasPowerShell = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]).status === 0;
const skip = hasBackend && hasPowerShell ? undefined : "端末backendとPowerShell 7が必要";
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-powershell-test-"));
const core = await import("../dist/core.js");
const runtime = await import("../dist/tmux-runtime.js");

test("PowerShellの単行もUnicode入出力とnative pipelineをUTF-8で保持する", { skip }, async () => {
  const session = "powershell_unicode_singleline";
  core.openSession(session, "pwsh");
  try {
    core.send(session, "$unicodeValue = '日本語'; [Console]::WriteLine('VALUE=' + $unicodeValue)", { mark: true });
    const result = await core.readOutput(session, { wait: true, timeout: 5 });
    assert.match(result, /VALUE=日本語/u, result);
    assert.match(result, /is_complete=True via mark/u, result);
    const nodePath = process.execPath.replaceAll("'", "''");
    core.send(session, `\"$unicodeValue\" | & '${nodePath}' -e 'process.stdin.pipe(process.stdout)'`, { mark: true });
    assert.match(await core.readOutput(session, { wait: true, timeout: 5 }), /日本語/u);
  } finally {
    core.closeSession(session);
  }
});

test("PowerShellの複数行は記述順に実行し、完了印と変数を保持する", { skip }, async (t) => {
  const session = "powershell_multiline_order";
  const timing = { open_started_at: Date.now() };
  core.openSession(session, "pwsh");
  timing.open_returned_at = Date.now();
  const receipt = path.join(runtime.SOCKDIR, session + ".timing.json");
  const observer = process.platform === "win32" ? spawn(process.execPath,
    [fileURLToPath(new URL('../scripts/powershell-log-timing.mjs', import.meta.url)), runtime.SOCKDIR, session, receipt],
    { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true }) : null;
  const observed = observer ? new Promise((resolve, reject) => { observer.once('error', reject); observer.once('close', code => code === 0 ? resolve() : reject(new Error(`timing observer exit ${code}`))); }) : null;
  try {
    timing.warm_send_started_at = Date.now();
    core.send(session, "[Console]::WriteLine('準備' + '完了')", { mark: true });
    timing.warm_send_returned_at = Date.now();
    await core.readOutput(session, { wait: true, timeout: 5 });
    timing.warm_read_returned_at = Date.now();
    timing.sum_send_started_at = Date.now();
    core.send(session, "$aitermValue = 42\n$aitermValue += 8\n[Console]::WriteLine('SUM=' + $aitermValue)", { mark: true });
    timing.sum_send_returned_at = Date.now();
    const markId = fs.readFileSync(path.join(runtime.SOCKDIR, session + ".mark"), "utf8").trim();
    const result = await core.readOutput(session, { wait: true, timeout: 5 });
    timing.sum_read_returned_at = Date.now();
    assert.match(result, /SUM=50(?!\d)/u, result);
    assert.ok(result.indexOf("SUM=50") < result.indexOf(`<<<AITERM_DONE rc=0>>> id=${markId}`), result);
    assert.match(result, /is_complete=True via mark/u, result);
    timing.persist_send_started_at = Date.now();
    core.send(session, "[Console]::WriteLine('PERSIST=' + $aitermValue)", { mark: true });
    timing.persist_send_returned_at = Date.now();
    const persisted = await core.readOutput(session, { wait: true, timeout: 5 });
    timing.persist_read_returned_at = Date.now();
    assert.match(persisted, /PERSIST=50(?!\d)/u);
  } catch (error) {
    t.diagnostic(JSON.stringify(await capturePtyFailure(core, session, { boundary: 'PowerShell multiline mark', timing })));
    throw error;
  } finally {
    try {
      if (observer) {
        observer.stdin.end();
        await observed;
        t.diagnostic(fs.readFileSync(receipt, 'utf8').trim());
      }
    } finally {
      core.closeSession(session);
    }
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
