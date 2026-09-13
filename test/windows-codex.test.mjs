import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { windowsServerArguments } from "../dist/windows-codex-relay.js";
import { buildWindowsLauncher, configureWindowsCodexSteer, findWindowsCodexCache, windowsLauncherSource } from "../dist/windows-codex-setup.js";
import { ensurePrivateDirectory } from "../dist/windows-codex-state.js";
import { withCodexRelay } from "../dist/codex-relay-client.js";
import { findWindowsParentSocket, readWindowsProcesses, readWindowsRelay } from "../dist/windows-codex-connection.js";
import { readRelayConfig } from "../dist/codex-relay-config.js";
import { configureCodexSteer } from "../dist/setup-codex-relay.js";
test("Windows: Desktopの配布元と一致する実行用コピーだけを採用する", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-codex-cache-"));
    const resources = join(directory, "resources");
    const cache = join(directory, "cache");
    const current = join(cache, "0123456789abcdef");
    const old = join(cache, "fedcba9876543210");
    const names = ["codex.exe", "codex-code-mode-host.exe", "codex-windows-sandbox-setup.exe", "codex-command-runner.exe"];
    try {
        for (const target of [resources, current, old]) {
            await mkdir(target, { recursive: true });
            for (const name of names)
                await writeFile(join(target, name), target === old ? "古い配布" : name);
        }
        assert.equal(findWindowsCodexCache(resources, cache), join(current, "codex.exe"));
        await writeFile(join(current, "codex-command-runner.exe"), "他の配布");
        assert.throws(() => findWindowsCodexCache(resources, cache), /公式Desktopを起動/);
        assert.throws(() => findWindowsCodexCache(resources, join(directory, "未起動")), /公式Desktopを起動/);
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test("Windows: serverだけを中継し、他コマンドと既存transportを変更しない", () => {
    assert.deepEqual(windowsServerArguments(["-c", 'x="app-server"', "app-server", "--stdio", "--analytics-default-enabled"]), ["-c", 'x="app-server"', "app-server", "--analytics-default-enabled"]);
    assert.deepEqual(windowsServerArguments(["app-server", "--listen", "stdio://"]), ["app-server"]);
    for (const args of [["--version"], ["exec", "app-server"], ["app-server", "proxy"], ["app-server", "daemon", "status"], ["app-server", "--help"]])
        assert.equal(windowsServerArguments(args), null);
    assert.throws(() => windowsServerArguments(["app-server", "--listen", "ws://127.0.0.1:9999"]), /変更できません/);
    assert.throws(() => windowsServerArguments(["app-server", "--ws-token-file", "secret"]), /変更できません/);
});
test("Windows: native launcherは空白・日本語・引用符・末尾backslashをそのまま子へ渡す", { skip: process.platform !== "win32" }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-launcher-日本語 "));
    ensurePrivateDirectory(directory);
    const echo = join(directory, "echo.mjs");
    await writeFile(echo, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    try {
        const source = windowsLauncherSource(process.execPath, resolve('dist/windows-codex-relay.js'), process.execPath, join(directory, 'sessions'));
        const launcher = buildWindowsLauncher(directory, source);
        const args = ['a"b', "a b", "日本語", "last\\", "", "\\\"quoted"];
        const child = spawn(launcher, [echo, ...args], { windowsHide: true });
        let output = "";
        let error = "";
        child.stdout.on("data", data => { output += data; });
        child.stderr.on("data", data => { error += data; });
        assert.equal((await once(child, "close"))[0], 0, error);
        assert.deepEqual(JSON.parse(output), args);
        assert.equal(buildWindowsLauncher(directory, source), launcher);
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test("Windows: native launcherはstdinをEOF前に転送する", { skip: process.platform !== "win32" }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-stdin-"));
    ensurePrivateDirectory(directory);
    const echo = join(directory, "echo.mjs");
    await writeFile(echo, "process.stdin.on('data', data => process.stdout.write(data));\n");
    const launcher = buildWindowsLauncher(directory, windowsLauncherSource(process.execPath, resolve('dist/windows-codex-relay.js'), process.execPath, join(directory, 'sessions')));
    const child = spawn(launcher, [echo], { windowsHide: true });
    const exited = once(child, "close");
    const reader = createInterface({ input: child.stdout });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
        const response = once(reader, "line", { signal: controller.signal });
        child.stdin.write("initialize\n");
        assert.equal((await response)[0], "initialize");
    }
    finally {
        clearTimeout(timer);
        child.stdin.end();
        await exited;
        reader.close();
        await rm(directory, { recursive: true, force: true });
    }
});
test("Windows: 同梱CLIで中継initializeとEOF後のprocess終了・接続情報削除を確認する", { skip: process.platform !== "win32" || !process.env.AITERM_TEST_CODEX_BINARY }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-codex-test-"));
    ensurePrivateDirectory(directory);
    const root = join(directory, "sessions");
    ensurePrivateDirectory(root);
    const codexHome = join(directory, "codex");
    ensurePrivateDirectory(codexHome);
    const relay = resolve("dist/windows-codex-relay.js");
    const launcher = buildWindowsLauncher(directory, windowsLauncherSource(process.execPath, relay, process.env.AITERM_TEST_CODEX_BINARY, root));
    const child = spawn(launcher, ["app-server", "--listen", "stdio://"], { env: { ...process.env, CODEX_HOME: codexHome }, windowsHide: true });
    const exited = once(child, "close");
    const reader = createInterface({ input: child.stdout });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = once(reader, "line", { signal: controller.signal });
        child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "aiterm_windows_test", version: "1" } } }) + "\n");
        const value = JSON.parse((await response)[0]);
        assert.equal(value.id, 1);
        assert.ok(value.result);
        const sessions = await readdir(root);
        assert.equal(sessions.length, 1);
        const record = JSON.parse(await readFile(join(root, sessions[0], "connection.json"), "utf8"));
        assert.ok(record.serverPid > 0);
        readWindowsRelay(join(root, sessions[0], "connection.json"));
        const rows = readWindowsProcesses();
        const file = join(root, sessions[0], 'connection.json');
        const compatible = { ...record, schema: 'gpt-connector.windows-relay.v1', serverStarted: record.serverStarted.replace(/(\.\d{3})Z$/, '$10000Z') };
        await writeFile(file, JSON.stringify(compatible));
        readWindowsRelay(file, rows);
        await writeFile(file, JSON.stringify({ ...compatible, serverStarted: new Date(Date.parse(record.serverStarted) + 1).toISOString() }));
        assert.throws(() => readWindowsRelay(file, rows), /親Codex processを照合できません/);
        await writeFile(file, JSON.stringify(compatible));
        assert.equal(findWindowsParentSocket([...rows, { pid: 99999999, parent_pid: record.serverPid, command: "MCP fixture", executable: process.execPath, started: "fixture" }], 99999999), join(root, sessions[0], "connection.json"));
        assert.throws(() => findWindowsParentSocket(rows, 99999999), /親CodexのSteer接続がありません/);
        assert.throws(() => findWindowsParentSocket([...rows, { pid: 99999999, parent_pid: record.serverPid }], 99999999, join(directory, '別製品')), /AitermのSteer起動設定/);
        const loaded = await withCodexRelay(join(root, sessions[0], "connection.json"), request => request("thread/loaded/list", { limit: 1 }));
        assert.deepEqual(loaded.data, []);
        execFileSync("icacls", [join(root, sessions[0], "connection.json"), "/grant", "*S-1-5-32-545:R"], { windowsHide: true });
        assert.throws(() => readWindowsRelay(join(root, sessions[0], "connection.json")));
        child.stdin.end();
        assert.equal((await exited)[0], 0);
        assert.deepEqual(await readdir(root), []);
        assert.throws(() => process.kill(record.serverPid, 0), { code: "ESRCH" });
    }
    finally {
        clearTimeout(timer);
        child.stdin.end();
        await exited;
        reader.close();
        await rm(directory, { recursive: true, force: true });
    }
});
test("Windows: setupは検証後に起動設定を保存し、再実行・解除・競合を区別する", { skip: process.platform !== "win32" }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-setup-windows-"));
    let gui = null;
    let ready = false;
    let verified = 0;
    const runtime = { directory, node: process.execPath, relay: "fixture.js", findBinary: () => "fixture.exe",
        getGui: (key) => key === "CODEX_CLI_PATH" ? gui : null,
        setGui: (_key, value) => { assert.ok(verified > 0); gui = value; },
        verify: async () => { verified++; }, live: async () => ready };
    try {
        assert.equal((await configureWindowsCodexSteer("enable", runtime)).status, "restart_required");
        const launcher = gui;
        ready = true;
        assert.equal((await configureWindowsCodexSteer("status", runtime)).status, "ready");
        assert.equal((await configureWindowsCodexSteer("enable", runtime)).status, "ready");
        assert.equal(gui, launcher);
        gui = "another.exe";
        await assert.rejects(configureWindowsCodexSteer("disable", runtime), /上書きしません/);
        gui = launcher;
        assert.equal((await configureWindowsCodexSteer("disable", runtime)).status, "restart_required");
        assert.equal(gui, null);
        assert.equal((await configureWindowsCodexSteer("status", runtime)).status, "disabled");
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Windows: Macと同じく元の起動設定を保存し、解除時に復元する", { skip: process.platform !== "win32" }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "aiterm-existing-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let gui = 'existing.exe';
    const runtime = { platform: 'win32', directory, getGui: key => key === 'CODEX_CLI_PATH' ? gui : null,
        setGui: (_key, value) => { gui = value; }, findBinary: () => 'official.exe',
        verify: async () => {}, live: async () => false };
    assert.equal((await configureCodexSteer('enable', runtime)).status, 'restart_required');
    assert.notEqual(gui, 'existing.exe');
    assert.equal(readRelayConfig(directory).previous_cli_path, 'existing.exe');
    assert.equal((await configureWindowsCodexSteer('enable', runtime)).status, 'restart_required');
    // GUI適用が元に戻っていても、Macと同じく解除を完了できる。
    gui = 'existing.exe';
    assert.equal((await configureWindowsCodexSteer('disable', runtime)).status, 'restart_required');
    assert.equal(gui, 'existing.exe');
    assert.equal(readRelayConfig(directory).enabled, false);
});

test("Windows: 隔離起動の失敗は起動設定を変えず、GUI適用失敗からは同じ設定を再適用できる", { skip: process.platform !== "win32" }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'aiterm-setup-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let gui = null;
    const runtime = { directory, node: process.execPath, relay: 'fixture.js', findBinary: () => 'fixture.exe',
        getGui: key => key === 'CODEX_CLI_PATH' ? gui : null, setGui: (_key, value) => { gui = value; },
        verify: async () => {}, live: async () => false };
    await assert.rejects(configureWindowsCodexSteer('enable', { ...runtime, verify: async () => { throw new Error('起動失敗'); } }), /起動失敗/);
    assert.equal(gui, null);
    assert.equal(readRelayConfig(directory), null);
    await assert.rejects(configureWindowsCodexSteer('enable', { ...runtime, setGui: () => { throw new Error('適用失敗'); } }), /適用失敗/);
    assert.equal((await configureWindowsCodexSteer('enable', runtime)).status, 'restart_required');
    assert.equal(readRelayConfig(directory).previous_cli_path, null);
});
