// 新しい端末の環境は、その端末を開いた process の環境で決まる。先に tmux server を起こした別の
// 呼び出し元の値が入らないことを、呼び出し元ごとに別 process を立てて確かめる。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { isWin, sessionCallerEnvironment, updateEnvironmentPatterns } from "../dist/tmux-runtime.js";

const coreUrl = JSON.stringify(pathToFileURL(resolve("dist/core.js")).href);
const KEYS = ["WHO", "ONLY_A", "ONLY_B", "AITERM_SESSION_ID", "AITERM_AGENT_ROLE", "HOME"];

// 呼び出し元を別 process として立て、端末を開いて、その端末の shell が持つ値を返す。
function openAs(base, name, extra = {}, envVars = []) {
  const script = `
    const core = await import(${coreUrl});
    core.openSession(${JSON.stringify(name)}, "bash", ${JSON.stringify(envVars)});
    core.send(${JSON.stringify(name)}, ${JSON.stringify(`printf '%s:%s\\n' RES "${KEYS.map(key => `$${key}`).join("|")}"`)});
    const out = await core.readOutput(${JSON.stringify(name)}, { wait: true, until: "RES:", timeout: 15, raw: true });
    process.stdout.write(JSON.stringify(/RES:([^\\r\\n]*)/.exec(out)?.[1] ?? null));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...base, ...extra }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const values = JSON.parse(r.stdout).split("|");
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

function withServer(run) {
  const root = mkdtempSync(join(isWin ? tmpdir() : "/tmp", "aiterm-env-"));
  const home = join(root, "home");
  mkdirSync(home);
  // 端末個人の設定を読むと、ここで落ちる。
  writeFileSync(join(home, ".tmux.conf"), "aiterm-test-must-not-read-this-file\n");
  const base = isWin
    ? { ...process.env, TMPDIR: root }
    : { PATH: process.env.PATH, HOME: home, TMPDIR: root, LC_CTYPE: "C.UTF-8", ...(process.env.AITERM_TMUX ? { AITERM_TMUX: process.env.AITERM_TMUX } : {}) };
  for (const key of Object.keys(base)) if (/^(?:AITERM_(?:SESSION_ID|AGENT_)|TMUX)/.test(key)) delete base[key];
  try {
    run(base, home);
  } finally {
    const cleanup = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const { killAll } = await import(${coreUrl}); killAll();`], { env: base, encoding: "utf8" });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    rmSync(root, { recursive: true, force: true });
  }
}

test("update-environmentの並び: 3.2以上は丸ごと写し、それより前は名前を並べる", () => {
  assert.deepEqual(updateEnvironmentPatterns(["PATH", "WHO"], ["WHO", "ONLY_A", "PWD", "ONLY_A"], true), ["*", "ONLY_A", "PWD"]);
  assert.deepEqual(updateEnvironmentPatterns(["PATH", "WHO", "BAD NAME"], ["ONLY_A", "x*y"], false), ["PATH", "WHO", "ONLY_A"]);
});

test("端末へ継がせる環境から、Aitermの名札と呼んだ側のpaneを外す", () => {
  const env = sessionCallerEnvironment({
    PATH: "/bin", AITERM_SESSION_ID: "parent", AITERM_AGENT_ROLE: "subagent", AITERM_AGENT_LAUNCH_ID: "x",
    TMUX: "/tmp/s,1,0", TMUX_PANE: "%3", AITERM_STATE_BASE: "/state", AITERM_TMUX: "/usr/bin/tmux",
  });
  assert.deepEqual(env, { PATH: "/bin", AITERM_STATE_BASE: "/state", AITERM_TMUX: "/usr/bin/tmux" });
});

test("後から開いた端末に、先にserverを起こした呼び出し元の環境が入らない", () => {
  withServer((base, home) => {
    const a = openAs(base, "env_a", { WHO: "A", ONLY_A: "secretA" });
    assert.deepEqual([a.WHO, a.ONLY_A, a.ONLY_B, a.AITERM_SESSION_ID], ["A", "secretA", "", "env_a"]);
    // 2人目は入れ子の中から開く。名札は継がず、端末ごとに付け直す。
    const b = openAs(base, "env_b", { WHO: "B", ONLY_B: "valB", AITERM_SESSION_ID: "env_a", AITERM_AGENT_ROLE: "subagent" });
    assert.deepEqual([b.WHO, b.ONLY_A, b.ONLY_B, b.AITERM_SESSION_ID], ["B", "", "valB", "env_b"]);
    if (!isWin) {
      assert.equal(b.AITERM_AGENT_ROLE, "");
      assert.equal(b.HOME, home);
    }
  });
});

test("変数を4つしか持たない呼び出し元の端末は、その4つで動く", { skip: isWin }, () => {
  withServer((base, home) => {
    openAs(base, "env_rich", { WHO: "A", ONLY_A: "secretA", PWD: "/" });
    // Codex が MCP server へ渡す環境と同じ形。PWD も無い。
    const bare = { PATH: base.PATH, HOME: home, TMPDIR: base.TMPDIR, SHELL: "/bin/sh", TERM: "dumb", ...(base.AITERM_TMUX ? { AITERM_TMUX: base.AITERM_TMUX } : {}) };
    const c = openAs(bare, "env_bare");
    assert.deepEqual([c.WHO, c.ONLY_A, c.AITERM_SESSION_ID, c.HOME], ["", "", "env_bare", home]);
  });
});

test("作成が失敗しても、差し替えたupdate-environmentを戻す", { skip: isWin }, () => {
  withServer(base => {
    openAs(base, "env_dup", { WHO: "A" });
    const script = `
      const runtime = await import(${JSON.stringify(pathToFileURL(resolve("dist/tmux-runtime.js")).href)});
      const created = runtime.tmuxNewSession(false, "env_dup", { args: [], shell: "bash" });
      const option = runtime.tmuxCommand(false, "show-options", "-g", "update-environment");
      process.stdout.write(JSON.stringify({ code: created.code, stderr: created.stderr, option: option.stdout }));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: base, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /duplicate session/);
    assert.match(result.option, /DISPLAY/);
    assert.doesNotMatch(result.option, /\*/);
  });
});

test("env_varsで名指しした値は今までどおり端末へ入る", () => {
  withServer(base => {
    openAs(base, "env_first", { WHO: "A" });
    const caller = { WHO: "B", ONLY_B: "named" };
    const named = openAs(base, "env_named", caller, ["ONLY_B"]);
    assert.deepEqual([named.WHO, named.ONLY_B], ["B", "named"]);
    // 端末は WHO も継いでいるが、一覧で読めるのは名指しで登録した値だけ。
    const listed = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const core = await import(${coreUrl});
      const session = core.listSessionsResult(["ONLY_B", "WHO", "AITERM_SESSION_ID"]).sessions.find(row => row.session_id === "env_named");
      process.stdout.write(JSON.stringify(session.environment));`], { env: { ...base, ...caller }, encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), { ONLY_B: "named", WHO: null, AITERM_SESSION_ID: "env_named" });
  });
});
