import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { globalPrefixOf, remoteUpdateCommand, updateLocal, resolveTargetVersion } from "../dist/update.js";

// npm install -gと同じ形の導入先を作る。POSIXは<prefix>/lib/node_modules、Windowsは<prefix>/node_modules。
function fakeGlobalInstall(platform, version = "0.38.2") {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-update-"));
  const root = platform === "win32"
    ? path.join(prefix, "node_modules", "aiterm-mcp")
    : path.join(prefix, "lib", "node_modules", "aiterm-mcp");
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "aiterm-mcp", version }));
  if (platform === "win32") fs.writeFileSync(path.join(prefix, "aiterm-mcp.cmd"), "");
  else {
    fs.mkdirSync(path.join(prefix, "bin"));
    fs.writeFileSync(path.join(prefix, "bin", "aiterm-mcp"), "");
  }
  return { prefix, root };
}

test("globalPrefixOf: npm global導入だけを更新対象にする", () => {
  const posix = fakeGlobalInstall("linux");
  assert.equal(globalPrefixOf(posix.root, "linux"), fs.realpathSync(posix.prefix));
  const win = fakeGlobalInstall("win32");
  assert.equal(globalPrefixOf(win.root, "win32"), fs.realpathSync(win.prefix));
  // source checkoutやproject内のnode_modulesは対象外。
  assert.equal(globalPrefixOf(process.cwd(), "linux"), null);
  fs.rmSync(path.join(posix.prefix, "bin", "aiterm-mcp"));
  assert.equal(globalPrefixOf(posix.root, "linux"), null, "binのリンクが無いnode_modulesはglobal導入と見なさない");
  for (const p of [posix.prefix, win.prefix]) fs.rmSync(p, { recursive: true, force: true });
});

function recordingRun(responses) {
  const calls = [];
  const run = (command, args, _timeout, env) => {
    calls.push({ command, args, env });
    const key = args.includes("view") ? "view" : args.includes("install") ? "install"
      : args.some((a) => a.endsWith("setup-cli.js")) ? "setup" : command === "ps" ? "ps" : "other";
    const response = responses[key] ?? { status: 0, stdout: "", stderr: "" };
    if (key === "install" && response.status === 0 && responses.onInstall) responses.onInstall();
    return response;
  };
  return { run, calls };
}

test("updateLocal: 同じprefixへ指定の版を入れ、新しい版のaiterm-setupで確かめ直す", { skip: process.platform === "win32" }, () => {
  const { prefix, root } = fakeGlobalInstall(process.platform, "0.38.2");
  const { run, calls } = recordingRun({
    view: { status: 0, stdout: "\"0.39.0\"", stderr: "" },
    install: { status: 0, stdout: "", stderr: "" },
    onInstall: () => fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.39.0" })),
    setup: { status: 0, stdout: "aiterm-setup: 準備します\n{\"schema\":\"aiterm.setup-result.v1\",\"status\":\"ready\"}\n", stderr: "" },
    ps: { status: 0, stdout: `  11 node ${path.join(fs.realpathSync(prefix), "bin", "aiterm-mcp")}\n  12 node /elsewhere/bin/aiterm-mcp\n`, stderr: "" },
  });
  const result = updateLocal({ version: "latest", run, root });
  assert.equal(result.status, "updated");
  assert.equal(result.from_version, "0.38.2");
  assert.equal(result.to_version, "0.39.0");
  assert.equal(result.setup_status, "ready");
  assert.equal(result.running_servers, 1, "別のprefixのaiterm-mcpは数えない");
  const install = calls.find((c) => c.args.includes("install"));
  assert.deepEqual(install.args.slice(0, 4), ["install", "-g", "--prefix", fs.realpathSync(prefix)]);
  assert.ok(install.args.includes("aiterm-mcp@0.39.0"));
  const setup = calls.find((c) => c.args.some((a) => a.endsWith("setup-cli.js")));
  assert.equal(setup.env.npm_config_prefix, fs.realpathSync(prefix), "setupのglobal判定を更新した場所へ向ける");
  fs.rmSync(prefix, { recursive: true, force: true });
});

test("updateLocal: 同じ版なら入れ替えずにsetupだけ確かめ、--checkは何も変えない", { skip: process.platform === "win32" }, () => {
  const { prefix, root } = fakeGlobalInstall(process.platform, "0.39.0");
  const same = recordingRun({ setup: { status: 0, stdout: "{\"status\":\"ready\"}\n", stderr: "" } });
  const current = updateLocal({ version: "0.39.0", run: same.run, root });
  assert.equal(current.status, "already_current");
  assert.equal(same.calls.some((c) => c.args.includes("install")), false);
  const check = recordingRun({});
  const checked = updateLocal({ version: "0.40.0", check: true, run: check.run, root });
  assert.equal(checked.status, "checked");
  assert.equal(checked.to_version, "0.40.0");
  assert.equal(check.calls.some((c) => c.args.includes("install") || c.args.some((a) => a.endsWith("setup-cli.js"))), false);
  fs.rmSync(prefix, { recursive: true, force: true });
});

test("updateLocal: 導入先へ書けない時は管理者権限での手順を返す", { skip: process.platform === "win32" }, () => {
  const { prefix, root } = fakeGlobalInstall(process.platform, "0.38.2");
  const { run } = recordingRun({ install: { status: 243, stdout: "", stderr: "npm error code EACCES\nnpm error syscall rename" } });
  const result = updateLocal({ version: "0.39.0", run, root });
  assert.equal(result.status, "permission_required");
  assert.equal(result.reason_code, "npm_global_not_writable");
  assert.match(result.message, /npm install -g aiterm-mcp@0\.39\.0/);
  fs.rmSync(prefix, { recursive: true, force: true });
});

test("resolveTargetVersion: 版指定を検証してからnpm registryへ問い合わせる", () => {
  assert.throws(() => resolveTargetVersion("1.0; rm -rf /", () => assert.fail("npmを呼ばない")), /版の指定が不正/);
  assert.equal(resolveTargetVersion("latest", () => ({ status: 0, stdout: "\"0.39.0\"\n", stderr: "" })), "0.39.0");
  assert.throws(() => resolveTargetVersion("9.9.9", () => ({ status: 0, stdout: "", stderr: "" })), /npm registryにありません/);
});

test("remoteUpdateCommand: 現地にaiterm-updateが無い旧版でもnpmで入れてから同じ手順へ渡す", () => {
  const posix = remoteUpdateCommand("posix", "0.39.0", false);
  assert.match(posix, /^\/bin\/sh -c '/);
  assert.match(posix, /command -v aiterm-update/);
  assert.match(posix, /npm install -g aiterm-mcp@0\.39\.0/);
  assert.match(posix, /exec aiterm-update --json --version 0\.39\.0'$/);
  assert.equal(posix.slice("/bin/sh -c '".length, -1).includes("'"), false, "内側に単引用符を含めない");
  const ps = remoteUpdateCommand("powershell", "0.39.0", false);
  assert.match(ps, /Get-Command aiterm-update/);
  assert.match(ps, /aiterm-update --json --version 0\.39\.0; exit \$LASTEXITCODE$/);
  const check = remoteUpdateCommand("powershell", "0.39.0", true);
  assert.doesNotMatch(check, /npm install/, "--checkは現地を変えない");
  assert.throws(() => remoteUpdateCommand("posix", "latest", false), /版の指定が不正/);
});
