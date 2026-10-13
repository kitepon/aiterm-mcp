// 席の環境へ、席の会話ID（AITERM_AGENT_VENDOR_SESSION_ID）を入れる（ADR 0118）。
// 起動の印（AITERM_AGENT_LAUNCH_ID）は席のprocessが起こした子にも継がれるので、席そのものの会話かは、この値で見分ける。
// 偽の席が、自分の環境と引数をfileへ書く（agent-preface.test.mjsと同じ隔離socket方式）。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const hasTmux = (process.platform === "win32" ? spawnSync("psmux", ["-V"]) : spawnSync("tmux", ["-V"])).status === 0;
// prefixは短く保つ（macOSのUNIXソケットパスは104バイト上限）。
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-vse-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const savedHome = process.env.HOME;
const fakeHome = path.join(process.env.TMPDIR, "fake-home");
fs.mkdirSync(fakeHome, { mode: 0o700 });
process.env.HOME = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");

const seen = path.join(process.env.TMPDIR, "claude.seen");
const bin = path.join(process.env.TMPDIR, "fake-claude.sh");
fs.writeFileSync(bin, [
  "#!/bin/sh",
  "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
  "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
  "  exit 0",
  "fi",
  `{ printf 'env=%s\\n' "$AITERM_AGENT_VENDOR_SESSION_ID"; printf 'launch=%s\\n' "$AITERM_AGENT_LAUNCH_ID"; for a in "$@"; do printf 'arg=%s\\n' "$a"; done; } > '${seen}.tmp'`,
  `mv '${seen}.tmp' '${seen}'`,
  "printf 'Claude Code\\n❯ ready\\n'",
  "exec sleep 600",
  "",
].join("\n"), { mode: 0o700 });
fs.chmodSync(bin, 0o700);
process.env.CLAUDE_BIN = bin;

const core = await import(new URL("../dist/core.js", import.meta.url).href);
const skip = !hasTmux ? "tmux 未インストール" : process.platform === "win32" ? "偽の席はPOSIXのshで書いている" : undefined;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

after(() => {
  if (hasTmux) { try { core.killAll(); } catch { /* noop */ } }
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
});

test("Claudeの席の環境には、--session-id で渡した会話IDが AITERM_AGENT_VENDOR_SESSION_ID として入る", { skip }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    for (let waited = 0; waited < 8000 && !fs.existsSync(seen); waited += 50) await sleep(50);
    const lines = fs.readFileSync(seen, "utf8").trim().split("\n");
    const value = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
    const args = lines.filter((line) => line.startsWith("arg=")).map((line) => line.slice(4));
    const sessionId = args[args.indexOf("--session-id") + 1];
    assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u, "席は --session-id で起こす");
    assert.equal(value("env"), sessionId, "環境の値は、起動の引数の会話IDと同じ");
    assert.match(value("launch"), /^[0-9a-f]{32}$/u, "起動の印は今までどおり入る");
  } finally { core.closeSession(sid); }
});
