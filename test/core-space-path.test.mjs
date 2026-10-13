// 空白を含む一時パスでも pipe-pane のログ捕捉が壊れないことを実機 tmux で確認する回帰テスト。
// openSession は `cat >> '<path>'` を tmux 内部の /bin/sh に渡すため、パスにクオートが無いと
// 空白でリダイレクト先が割れ、ログが書かれず read が timeout する（Windows %TEMP% や mac/Linux の
// 空白入りホームで現実に起きる）。SOCKDIR は core の import 時に確定するので TMPDIR は import 前に設定する。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux =
  (process.platform === "win32"
    ? spawnSync("psmux", ["-V"])
    : spawnSync("tmux", ["-V"])
  ).status === 0;
const skip = hasTmux ? undefined : "tmux 未インストール";

process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm space "));
const core = await import("../dist/core.js");

after(() => {
  if (hasTmux) {
    try {
      core.killAll();
    } catch {}
  }
});

test("openSession: 空白入り一時パスでも pipe-pane が出力を捕捉する", { skip }, async () => {
  const s = "spacelog";
  core.openSession(s);
  try {
    core.send(s, "echo SPACE_PATH_OK");
    const out = await core.readOutput(s, { wait: true, timeout: 5 });
    assert.ok(out.includes("SPACE_PATH_OK"), `空白パスでも捕捉: ${out}`);
  } finally {
    core.closeSession(s);
  }
});
