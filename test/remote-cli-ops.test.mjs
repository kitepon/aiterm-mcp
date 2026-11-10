import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// remote_terminal_command cli_* ops (remote-terminal.md R10, 0.70.9): validation, version gate, the per-OS command text,
// claude_* aliases, and cli_auth_status classification. The POSIX scripts are really run by /bin/sh against stub CLIs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const rt = await import("../dist/remote-terminal.js");
const posix = process.platform !== "win32";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-ops-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const HARNESSES = ["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"];
const BIN = { "claude-code": "claude", "codex-cli": "codex", "grok-cli": "grok", "cursor-cli": "cursor-agent", "antigravity-cli": "agy" };

/** A connection stand-in: records every script exec() gets and answers from `answer(script)`. */
function fake({ shell = "posix", platform = "linux", remoteVersion = "0.70.9", answer = () => ({ code: 0, stdout: "1.2.3\n", stderr: "" }) } = {}) {
  const scripts = [];
  const self = Object.create(rt.RemoteTerminalConnection.prototype);
  Object.assign(self, { shell, platform, remoteVersion, exec: async script => { scripts.push(script); return answer(script); } });
  return { self, scripts, command: (op, p, h) => rt.RemoteTerminalConnection.prototype.command.call(self, op, p, h) };
}
const code = c => error => error.code === c;

test("cli ops: harness is required and checked, path and harness go only where they belong, an older terminal is refused", async () => {
  const f = fake();
  for (const op of ["cli_version", "cli_install", "cli_update", "cli_auth_status"]) {
    await assert.rejects(f.command(op), code("COMMAND_INVALID"), `${op} without harness`);
    await assert.rejects(f.command(op, undefined, "gemini-cli"), code("COMMAND_INVALID"), `${op} unknown harness`);
    await assert.rejects(f.command(op, "/x", "grok-cli"), code("COMMAND_INVALID"), `${op} with path`);
    await assert.rejects(fake({ remoteVersion: "0.70.8" }).command(op, undefined, "grok-cli"), code("REMOTE_AITERM_TOO_OLD"), `${op} on 0.70.8`);
  }
  for (const op of ["claude_version", "claude_install", "claude_update", "path_status", "list_dirs"])
    await assert.rejects(f.command(op, undefined, "claude-code"), code("COMMAND_INVALID"), `${op} takes no harness`);
  await assert.rejects(f.command("nope"), code("COMMAND_UNSUPPORTED"));
  assert.deepEqual(f.scripts, [], "nothing was run for a refused call");
  // The claude_* aliases need no harness and no 0.70.9.
  assert.equal((await fake({ remoteVersion: "0.65.0" }).command("claude_version")).exit_code, 0);
});

test("cli_version / cli_update / cli_install: the same operation per harness and shell, with the official installers", async () => {
  const urls = { "claude-code": ["claude.ai/install.sh", "claude.ai/install.ps1"], "codex-cli": ["chatgpt.com/codex/install.sh", "chatgpt.com/codex/install.ps1"],
    "grok-cli": ["x.ai/cli/install.sh", "x.ai/cli/install.ps1"], "cursor-cli": ["cursor.com/install ", "cursor.com/install?win32=true"],
    "antigravity-cli": ["antigravity.google/cli/install.sh", "antigravity.google/cli/install.ps1"] };
  for (const harness of HARNESSES) {
    const bin = BIN[harness];
    for (const shell of ["posix", "powershell", "cmd"]) {
      const f = fake({ shell, platform: shell === "posix" ? "linux" : "windows" });
      const side = shell === "posix" ? "posix" : "windows";
      const version = await f.command("cli_version", undefined, harness);
      assert.deepEqual(version, { op: "cli_version", harness, exit_code: 0, version: "1.2.3", output_tail: "1.2.3\n" });
      assert.match(f.scripts[0][side], new RegExp(`${bin}.* --version 2>&1`));
      const update = await f.command("cli_update", undefined, harness);
      assert.deepEqual([update.op, update.harness, update.exit_code, update.version], ["cli_update", harness, 0, "1.2.3"]);
      assert.equal(f.scripts[1][side], `${bin} update 2>&1`);
      assert.equal(f.scripts[2][side], f.scripts[0][side], "the version is read afterwards by the same probe");
      const install = await f.command("cli_install", undefined, harness);
      assert.equal(install.harness, harness);
      assert.ok(f.scripts[3][side].includes(urls[harness][side === "posix" ? 0 : 1]), `${harness} ${side}: ${f.scripts[3][side]}`);
      assert.equal(f.scripts[4][side], f.scripts[0][side]);
    }
    // POSIX scripts live inside /bin/sh -c '...': no single quote.
    const f = fake();
    for (const op of ["cli_version", "cli_update", "cli_install", "cli_auth_status"]) await f.command(op, undefined, harness).catch(() => {});
    for (const s of f.scripts) assert.ok(!s.posix.includes("'"), s.posix);
  }
  // Windows: the installer's failure stops with exit 1; the version falls back to the installer's own place.
  const w = fake({ shell: "powershell", platform: "windows" });
  await w.command("cli_install", undefined, "codex-cli");
  assert.match(w.scripts[0].windows, /^& \{ \$ErrorActionPreference = 'Stop'; try \{ irm https:\/\/chatgpt\.com\/codex\/install\.ps1 \| iex \} catch \{ \$_\.Exception\.Message; exit 1 \} \} \*>&1; exit 0$/);
  assert.match(w.scripts[1].windows, /Programs\\OpenAI\\Codex\\bin\\codex\.exe/);
  // The ssh exit 255 is a connection failure, not an exit code of the CLI.
  await assert.rejects(fake({ answer: () => ({ code: 255, stdout: "", stderr: "ssh: connect to host h port 22: Connection refused" }) }).command("cli_version", undefined, "grok-cli"), code("CONNECTION_REFUSED"));
});

test("claude_* are aliases of cli_* for claude-code: the same scripts, the old result shape", async () => {
  for (const [alias, op] of [["claude_version", "cli_version"], ["claude_install", "cli_install"], ["claude_update", "cli_update"]]) {
    for (const [shell, platform] of [["posix", "linux"], ["powershell", "windows"]]) {
      const a = fake({ shell, platform }), b = fake({ shell, platform });
      const old = await a.command(alias), generic = await b.command(op, undefined, "claude-code");
      assert.deepEqual(a.scripts, b.scripts, `${alias} ${shell}`);
      assert.deepEqual(old, { op: alias, exit_code: generic.exit_code, version: generic.version, output_tail: generic.output_tail });
      assert.equal(generic.harness, "claude-code");
    }
  }
  // Kept verbatim from 0.70.8.
  const f = fake();
  await f.command("claude_install");
  assert.equal(f.scripts[0].posix, "curl -fsSL https://claude.ai/install.sh | bash 2>&1");
  assert.equal(f.scripts[0].windows, "& { $ErrorActionPreference = 'Stop'; try { irm https://claude.ai/install.ps1 | iex } catch { $_.Exception.Message; exit 1 } } *>&1; exit 0");
});

// What each CLI answers. `out`/`err`/`code` are what the stub CLI prints; `want` is the classification.
const ANSWERS = {
  "claude-code": [[{ out: '{"loggedIn":true,"email":"a@b.c","token":"SECRET-1"}', code: 0 }, true], [{ out: '{"loggedIn":false}', code: 1 }, false],
    [{ out: "DO_NOT_FORWARD", code: 0 }, null], [{ out: '{"loggedIn":true}', code: 1 }, null]],
  "codex-cli": [[{ out: "Logged in using ChatGPT SECRET-1", code: 0 }, true], [{ out: "Not logged in", code: 1 }, false],
    [{ out: "garbage", code: 0 }, null], [{ out: "Logged in", code: 2 }, null]],
  "grok-cli": [[{ out: "Default model: grok-4.7\n\nAvailable models:\n SECRET-1", code: 0 }, true], [{ err: "You are not authenticated.", code: 1 }, false],
    [{ out: "garbage", code: 0 }, null], [{ out: "Available models", code: 1 }, null]],
  "cursor-cli": [[{ out: "Logged in as SECRET-1@x.y", code: 0 }, true], [{ out: "Not logged in", code: 1 }, false],
    [{ out: "Logged in (unable to fetch user details)", code: 0 }, null], [{ out: "boom", code: 1 }, null]],
  "antigravity-cli": [[{ out: "gemini-3\tGemini 3 SECRET-1\n", code: 0 }, true], [{ err: "Please sign in to view available models", code: 1 }, false],
    [{ out: "", code: 0 }, null], [{ err: "boom", code: 1 }, null]],
};

test("cli_auth_status classification: logged_in only, never the CLI's output, an unclear answer is a coded error", async () => {
  for (const harness of HARNESSES) for (const [{ out = "", err = "", code: exit }, want] of ANSWERS[harness]) {
    const f = fake({ answer: () => ({ code: exit, stdout: out, stderr: err }) });
    if (want === null) await assert.rejects(f.command("cli_auth_status", undefined, harness), code("AUTH_STATUS_UNCONFIRMED"), `${harness} ${out}${err}`);
    else {
      const result = await f.command("cli_auth_status", undefined, harness);
      assert.deepEqual(result, { op: "cli_auth_status", harness, logged_in: want }, harness);
      assert.ok(!JSON.stringify(result).includes("SECRET-1"));
    }
  }
  // Not installed (exit 127 from the fixed script) is not "not logged in"; an ssh failure is not either.
  await assert.rejects(fake({ answer: () => ({ code: 127, stdout: "", stderr: "" }) }).command("cli_auth_status", undefined, "cursor-cli"), code("CLI_NOT_INSTALLED"));
  await assert.rejects(fake({ answer: () => ({ code: 255, stdout: "", stderr: "ssh: connect to host h port 22: Connection refused" }) }).command("cli_auth_status", undefined, "codex-cli"), code("CONNECTION_REFUSED"));
  // Grok may answer "not authenticated" once while it refreshes a live token: asked again, the second answer decides.
  let n = 0;
  const flaky = fake({ answer: () => (++n === 1 ? { code: 1, stdout: "", stderr: "You are not authenticated." } : { code: 0, stdout: "Available models:", stderr: "" }) });
  assert.equal((await flaky.command("cli_auth_status", undefined, "grok-cli")).logged_in, true);
  assert.equal(n, 2);
});

test("cli_auth_status script (POSIX): runs the CLI from PATH, else from its installer's place, else exits 127", { skip: !posix }, async () => {
  const run = (script, env) => spawnSync("/bin/sh", ["-c", script.posix], { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });
  for (const harness of HARNESSES) {
    const bin = BIN[harness];
    const home = fs.mkdtempSync(path.join(tmp, "home-"));
    const dir = harness === "grok-cli" ? path.join(home, ".grok", "bin") : path.join(home, ".local", "bin");
    const f = fake({ answer: () => ({ code: 127, stdout: "", stderr: "" }) });
    await f.command("cli_auth_status", undefined, harness).catch(() => {});
    const script = f.scripts[0];
    assert.equal(run(script, { HOME: home }).status, 127, `${harness} absent`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, bin), `#!/bin/sh\necho "$0 $*"\nexit 0\n`, { mode: 0o755 });
    const viaPlace = run(script, { HOME: home });
    assert.equal(viaPlace.status, 0, viaPlace.stderr);
    assert.ok(viaPlace.stdout.includes(` ${{ "claude-code": "auth status --json", "codex-cli": "login status", "grok-cli": "models", "cursor-cli": "status", "antigravity-cli": "models" }[harness]}`), viaPlace.stdout);
    const pathDir = fs.mkdtempSync(path.join(tmp, "path-"));
    fs.writeFileSync(path.join(pathDir, bin), `#!/bin/sh\necho onpath\n`, { mode: 0o755 });
    assert.equal(run(script, { HOME: home, PATH: `${pathDir}:/usr/bin:/bin` }).stdout.trim(), "onpath", "PATH wins over the installer's place");
  }
});
