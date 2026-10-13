import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "../dist/core.js";

test("Windows Start-Process: wait_processの空白入りCLI pathとargvを逐語維持する", {
  skip: process.platform !== "win32" && "Windows native専用",
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm wait process "));
  const cliPath = path.join(root, "argv probe.mjs");
  const outputPath = path.join(root, "argv.json");
  fs.writeFileSync(
    cliPath,
    'import fs from "node:fs"; fs.writeFileSync(process.env.AITERM_ARGV_PROBE_OUT, JSON.stringify(process.argv.slice(2)));\n',
    "utf8",
  );

  const waitProcess = core.agentWaitProcess("session-1", 42, {
    executable: process.execPath,
    cliPath,
    platform: "win32",
  });
  const result = spawnSync(
    "pwsh.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$p = Start-Process -FilePath $env:AITERM_WAIT_EXE -ArgumentList $env:AITERM_WAIT_ARGS -Wait -PassThru; exit $p.ExitCode',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AITERM_WAIT_EXE: waitProcess.executable,
        AITERM_WAIT_ARGS: waitProcess.windows_start_process_argument_list,
        AITERM_ARGV_PROBE_OUT: outputPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(outputPath, "utf8")),
    ["--session", "session-1", "--cursor", "42"],
  );
});
