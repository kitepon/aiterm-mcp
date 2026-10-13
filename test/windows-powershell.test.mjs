import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  resolveWindowsPowerShell7,
  WINDOWS_POWERSHELL_7_INSTALL,
} from "../dist/windows-powershell.js";
import { resolveWinPaneShell } from "../dist/agent-resolver.js";

const probe = (major = 7, edition = "Core") => (command) => command === "where.exe"
  ? { status: 0, stdout: "C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n" }
  : { status: 0, stdout: `${JSON.stringify({ edition, major })}\r\n` };

test("Windows PowerShell resolverは実体のCore major 7以上だけを受理する", () => {
  assert.equal(resolveWindowsPowerShell7(probe()), "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  assert.throws(() => resolveWindowsPowerShell7(probe(6)), /PowerShell 7/u);
  assert.throws(() => resolveWindowsPowerShell7(probe(7, "Desktop")), /PowerShell 7/u);
  assert.throws(() => resolveWindowsPowerShell7(() => ({ status: 1, stdout: "" })),
    new RegExp(WINDOWS_POWERSHELL_7_INSTALL.replaceAll(".", "\\.")));
});

test("Windows paneのPowerShell指定は検証済みpwsh 7へ正規化する", { skip: process.platform !== "win32" }, () => {
  const expected = resolveWinPaneShell("pwsh");
  assert.match(expected, /pwsh\.exe$/iu);
  for (const shell of ["powershell", "powershell.exe", "pwsh.exe"]) {
    assert.equal(resolveWinPaneShell(shell), expected);
  }
});

test("Windows OS adapterはbare powershell.exeをspawnしない", async () => {
  for (const file of ["src/agent-resolver.ts", "src/runtime-error-os.ts"]) {
    const source = await readFile(resolve(file), "utf8");
    assert.match(source, /resolveWindowsPowerShell7|windowsPowerShell7Command/u, file);
    assert.doesNotMatch(source, /spawnSync\(["']powershell\.exe["']/u, file);
  }
});
