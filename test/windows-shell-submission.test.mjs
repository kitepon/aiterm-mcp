import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import test from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const available = process.platform === "win32" && cp.spawnSync("psmux", ["-V"]).status === 0;
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "at-shell-dialect-"));
const core = await import("../dist/core.js");
const { shq } = await import("../dist/agent-shared.js");
const actualSpawn = cp.spawnSync;
test.after(() => { if (available) core.killAll(); });

for (const mark of [false, true]) {
  test(`Windows actual Bash + stale pwsh metadata: literal multiline file bytes and mark=${mark}`, { skip: !available }, async () => {
    const sid = `dialect_${mark ? "mark" : "plain"}`;
    const output = path.join(process.env.TMPDIR, sid + ".bin");
    const body = "日本語\n2行目 'quote' $HOME 50%";
    core.openSession(sid);
    try {
      await core.readOutput(sid, { wait: true, until: "$", timeout: 5, raw: true });
      const screen = await core.readOutput(sid, { screen: true, raw: true });
      assert.match(screen, /\b(?:MINGW(?:32|64)|UCRT64|MSYS)\b/);
      cp.spawnSync = function (command, args, options) {
        if (args?.includes("#{pane_current_command}")) return { status: 0, stdout: "pwsh\n", stderr: "" };
        return actualSpawn.call(this, command, args, options);
      };
      syncBuiltinESMExports();
      try {
        core.send(sid, `printf '%s' ${shq(body)} > ${shq(output.replaceAll("\\", "/"))}; printf 'NATIVE_DIALECT_%s\\n' DONE`, { mark });
      } finally {
        cp.spawnSync = actualSpawn;
        syncBuiltinESMExports();
      }
      const out = await core.readOutput(sid, { wait: true, timeout: 5, ...(mark ? {} : { until: "NATIVE_DIALECT_DONE" }) });
      assert.match(out, mark ? /is_complete=True via mark/ : /is_complete=True via until/);
      assert.deepEqual(fs.readFileSync(output), Buffer.from(body), "the actual Bash executes the original text without shell substitution");
    } finally { core.closeSession(sid); }
  });
}
