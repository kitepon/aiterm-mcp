import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// Terminal self-service (docs/architecture/remote-terminal.md R14-R16): refused vs unreachable, empty scan, authorize-key,
// fixed path operations, the provision bootstrap and the runtime preference.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const rt = await import("../dist/remote-terminal.js");
const rpath = await import("../dist/remote-path.js");
const prov = await import("../dist/remote-provision.js");
const remote = await import("../dist/remote.js");

const posix = process.platform !== "win32";
const hasKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-self-"));
const CLI = path.resolve("dist/remote-terminal-cli.js");

function stubBin(name, files) {
  const dir = fs.mkdtempSync(path.join(tmp, `${name}-`));
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body, { mode: 0o755 });
  return dir;
}

function runCli(args, { input, env = {}, keepStdinOpen = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on("close", code => { clearTimeout(timer); resolve({ code, json: JSON.parse(stdout.trim().split("\n").pop() || "null") }); });
    if (input !== undefined) child.stdin.end(input);
    else if (!keepStdinOpen) child.stdin.end();
  });
}

function trustedBinding(host) {
  const key = path.join(tmp, `id-${host}`);
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  const known = path.join(tmp, `known-${host}`);
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `${host} ${type} ${blob}\n`, { mode: 0o600 });
  const status = rt.registerBinding({ target: { host, user: "kite", port: 22 }, keyFile: key, knownHostsFile: known });
  return { ref: status.ref, publicKey: `${type} ${blob}`, known };
}

test("connection refused is its own evidence code, apart from timeouts and authentication", () => {
  assert.equal(rt.classifySshFailure("ssh: connect to host x port 22: Connection refused").code, "CONNECTION_REFUSED");
  assert.equal(rt.classifySshFailure("ssh: connect to host x port 22: Operation timed out").code, "UNREACHABLE");
  assert.equal(rt.classifySshFailure("ssh: connect to host x port 22: No route to host").code, "UNREACHABLE");
  assert.equal(rt.classifySshFailure("kite@x: Permission denied (publickey).").code, "AUTH_FAILED");
});

test("trust-confirm: no scanned key is UNREACHABLE, keys without the confirmed one stay a mismatch", { skip: !posix || !hasKeygen }, () => {
  const { ref } = trustedBinding("10.1.0.1");
  const hostKey = path.join(tmp, "scan-host");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
  const [type, blob] = fs.readFileSync(`${hostKey}.pub`, "utf8").trim().split(/\s+/);
  const fp = `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;
  const original = process.env.PATH;
  try {
    process.env.PATH = `${stubBin("scan-empty", { "ssh-keyscan": "#!/bin/sh\necho '# 10.1.0.1:22 SSH-2.0' >&2\nexit 1\n" })}:${original}`;
    assert.throws(() => rt.confirmHostKey(ref, fp), error => error.code === "UNREACHABLE");
    process.env.PATH = `${stubBin("scan-other", { "ssh-keyscan": `#!/bin/sh\necho '10.1.0.1 ${type} ${blob}'\n` })}:${original}`;
    assert.throws(() => rt.confirmHostKey(ref, `SHA256:${"A".repeat(43)}`), error => error.code === "HOST_KEY_FINGERPRINT_MISMATCH");
    assert.equal(rt.confirmHostKey(ref, fp).trust.fingerprints.includes(fp), true);
  } finally { process.env.PATH = original; }
});

test("path ops: missing, file, writable folder, inaccessible parent; make_dir; only absolute paths", { skip: !posix }, async () => {
  const base = fs.mkdtempSync(path.join(tmp, "paths-"));
  const missing = { schema: "aiterm.remote-path.v1", exists: false, directory: false, writable: false };
  assert.deepEqual(rpath.inspectPath(path.join(base, "none", "deeper")), missing);
  fs.writeFileSync(path.join(base, "file"), "x");
  assert.deepEqual(rpath.inspectPath(path.join(base, "file")), { ...missing, exists: true });
  assert.deepEqual(rpath.inspectPath(base), { ...missing, exists: true, directory: true, writable: true });
  assert.deepEqual(fs.readdirSync(base), ["file"], "the write probe leaves nothing");
  const made = rpath.makeDirectory(path.join(base, "a", "b c", "日本"));
  assert.deepEqual(made, { ...missing, exists: true, directory: true, writable: true });
  assert.deepEqual(rpath.makeDirectory(path.join(base, "file")), { ...missing, exists: true });
  for (const bad of ["relative/x", "", "/x\ny"]) assert.throws(() => rpath.inspectPath(bad), error => error.code === "PATH_INVALID");
  if (process.getuid?.() !== 0) {
    const locked = path.join(base, "locked");
    fs.mkdirSync(path.join(locked, "inner"), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      assert.throws(() => rpath.inspectPath(path.join(locked, "inner")), error => error.code === "FOLDER_NOT_PERMITTED");
      assert.throws(() => rpath.inspectPath(path.join(locked, "absent")), error => error.code === "FOLDER_NOT_PERMITTED");
      assert.throws(() => rpath.makeDirectory(path.join(locked, "new")), error => error.code === "FOLDER_NOT_PERMITTED");
      fs.chmodSync(locked, 0o500);
      assert.deepEqual(rpath.inspectPath(path.join(locked, "inner")).writable, true);
      assert.deepEqual(rpath.inspectPath(locked).writable, false);
    } finally { fs.chmodSync(locked, 0o700); }
  }
  // The terminal CLI takes the path as base64, so quotes and spaces never meet a shell.
  const quoted = path.join(base, "it's here");
  const cli = await runCli(["make-dir", "--path-base64", Buffer.from(quoted).toString("base64")]);
  assert.deepEqual([cli.code, cli.json], [0, { ...missing, exists: true, directory: true, writable: true }]);
  assert.equal((await runCli(["path-status", "--path", "relative"])).json.code, "PATH_INVALID");
});

test("list_dirs: home by default, subfolders only, no dot names, sorted, capped; missing/file are not empty lists", { skip: !posix }, async () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  for (const name of ["b", "A", "日本", ".hidden", "z dir", "linked-target"]) fs.mkdirSync(path.join(home, name));
  fs.writeFileSync(path.join(home, "file"), "x");
  fs.symlinkSync(path.join(home, "linked-target"), path.join(home, "link"));
  fs.symlinkSync(path.join(home, "nowhere"), path.join(home, "broken"));
  fs.symlinkSync(path.join(home, "file"), path.join(home, "file-link"));
  const listed = rpath.listDirectories(undefined, home);
  assert.deepEqual(listed, { schema: "aiterm.remote-dirs.v1", home, path: home, exists: true, directory: true,
    entries: ["A", "b", "link", "linked-target", "z dir", "日本"].map(name => ({ name })), truncated: false });
  assert.deepEqual(rpath.listDirectories(path.join(home, "none"), home), { schema: "aiterm.remote-dirs.v1", home, path: path.join(home, "none"), exists: false, directory: false, entries: null, truncated: false });
  assert.deepEqual(rpath.listDirectories(path.join(home, "file"), home).entries, null);
  assert.equal(rpath.listDirectories(path.join(home, "file"), home).exists, true);
  const many = path.join(home, "many");
  for (let i = 0; i < rpath.LIST_DIRS_MAX + 2; i++) fs.mkdirSync(path.join(many, String(i).padStart(4, "0")), { recursive: true });
  const capped = rpath.listDirectories(many, home);
  assert.deepEqual([capped.entries.length, capped.truncated, capped.entries[0].name, capped.entries.at(-1).name], [rpath.LIST_DIRS_MAX, true, "0000", "0499"]);
  assert.throws(() => rpath.listDirectories("relative", home), error => error.code === "PATH_INVALID");
  if (process.getuid?.() !== 0) {
    const locked = path.join(home, "locked");
    fs.mkdirSync(path.join(locked, "inner"), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      assert.throws(() => rpath.listDirectories(locked, home), error => error.code === "FOLDER_NOT_PERMITTED");
      assert.throws(() => rpath.listDirectories(path.join(locked, "inner"), home), error => error.code === "FOLDER_NOT_PERMITTED");
    } finally { fs.chmodSync(locked, 0o700); }
  }
  // The terminal CLI: no path lists HOME; a path travels as base64.
  const cli = await runCli(["list-dirs"], { env: { HOME: home } });
  const names = ["A", "b", "link", "linked-target", ...(process.getuid?.() !== 0 ? ["locked"] : []), "many", "z dir", "日本"];
  assert.deepEqual([cli.code, cli.json.home, cli.json.path, cli.json.entries.map(e => e.name)], [0, home, home, names]);
  const sub = await runCli(["list-dirs", "--path-base64", Buffer.from(path.join(home, "z dir")).toString("base64")], { env: { HOME: home } });
  assert.deepEqual([sub.code, sub.json.path, sub.json.entries], [0, path.join(home, "z dir"), []]);
});

test("command: path only for path ops; an older terminal answers REMOTE_AITERM_TOO_OLD", async () => {
  const proto = rt.RemoteTerminalConnection.prototype;
  await assert.rejects(proto.command.call({}, "claude_version", "/x"), error => error.code === "COMMAND_INVALID");
  const old = { remoteVersion: "0.68.1", pathCommand: proto.pathCommand };
  await assert.rejects(proto.command.call(old, "path_status", "/Users/x"), error => error.code === "REMOTE_AITERM_TOO_OLD");
  await assert.rejects(proto.command.call(old, "make_dir", "x"), error => error.code === "PATH_INVALID");
  const before = { remoteVersion: "0.69.0", listDirs: proto.listDirs };
  await assert.rejects(proto.command.call(before, "list_dirs"), error => error.code === "REMOTE_AITERM_TOO_OLD");
  await assert.rejects(proto.command.call(before, "list_dirs", "x"), error => error.code === "PATH_INVALID");
  assert.deepEqual([...rt.REMOTE_COMMAND_OPS], ["claude_version", "claude_install", "claude_update", "path_status", "make_dir", "list_dirs"]);
});

// A stand-in ssh: records argv and env, asks the askpass helper like OpenSSH, then runs the script on stdin in its own HOME.
const FAKE_SSH = `#!/bin/sh
d=$(dirname "$0")
printf '%s\\n' "$@" > "$d/argv"; env > "$d/env"
mode=$(cat "$d/mode")
case "$mode" in
  refused) echo "ssh: connect to host h port 22: Connection refused" >&2; exit 255 ;;
  disabled) echo "kite@h: Permission denied (publickey,keyboard-interactive)." >&2; exit 255 ;;
esac
"$SSH_ASKPASS" "kite@h's password: " > "$d/got" || exit 255
"$SSH_ASKPASS" "kite@h's password: " > "$d/second"
if [ "$mode" = reject ] || ! cmp -s "$d/got" "$d/expect"; then echo "kite@h: Permission denied (publickey,password)." >&2; exit 255; fi
HOME="$d/home" exec /bin/sh -s
`;

test("authorize-key: trust and key before stdin; password only through askpass, once; append once; typed failures", { skip: !posix || !hasKeygen }, async () => {
  const { ref, publicKey } = trustedBinding("10.1.0.2");
  const bin = stubBin("ssh", { ssh: FAKE_SSH });
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const password = "pä ss'wörd \"$x\" ";
  fs.writeFileSync(path.join(bin, "expect"), `${password}\n`);
  fs.mkdirSync(path.join(bin, "home", ".ssh"), { recursive: true, mode: 0o755 });
  // An existing entry with options and no trailing newline is kept intact.
  fs.writeFileSync(path.join(bin, "home", ".ssh", "authorized_keys"), 'from="10.0.0.1" ssh-ed25519 AAAAexisting other@host');
  fs.writeFileSync(path.join(bin, "mode"), "ok");

  const first = await runCli(["authorize-key", "--ref", ref], { input: password, env });
  assert.deepEqual([first.code, first.json], [0, { schema: "aiterm.remote-key-authorization.v1", ref, result: "AUTHORIZED" }]);
  for (const file of ["argv", "env"]) assert.ok(!fs.readFileSync(path.join(bin, file), "utf8").includes("wörd"), `no password in ${file}`);
  assert.equal(fs.readFileSync(path.join(bin, "second"), "utf8"), "", "the password is served once");
  const argv = fs.readFileSync(path.join(bin, "argv"), "utf8").split("\n");
  for (const option of ["PubkeyAuthentication=no", "PreferredAuthentications=password", "KbdInteractiveAuthentication=no", "NumberOfPasswordPrompts=1", "StrictHostKeyChecking=yes", "IdentityFile=none"])
    assert.ok(argv.includes(option), option);
  const keys = path.join(bin, "home", ".ssh", "authorized_keys");
  assert.equal(fs.readFileSync(keys, "utf8"), `from="10.0.0.1" ssh-ed25519 AAAAexisting other@host\n${publicKey}\n`);
  assert.equal(fs.statSync(keys).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(keys)).mode & 0o777, 0o700);
  const again = await runCli(["authorize-key", "--ref", ref], { input: password, env });
  assert.equal(again.json.result, "ALREADY_AUTHORIZED");
  assert.equal(fs.readFileSync(keys, "utf8").split(publicKey).length, 2, "appended once");

  const code = async (mode, input = password) => { fs.writeFileSync(path.join(bin, "mode"), mode); return (await runCli(["authorize-key", "--ref", ref], { input, env })).json.code; };
  assert.equal(await code("reject"), "PASSWORD_REJECTED");
  assert.equal(await code("ok", "wrong"), "PASSWORD_REJECTED");
  assert.equal(await code("disabled"), "PASSWORD_AUTH_DISABLED");
  assert.equal(await code("refused"), "CONNECTION_REFUSED");
  assert.equal(await code("ok", `${password}\n`), "PASSWORD_INVALID", "a trailing newline is not stripped");
  assert.equal(await code("ok", ""), "PASSWORD_INVALID");
  // ~/.ssh that cannot be a folder: nothing is written, the failure is its own code.
  fs.rmSync(path.join(bin, "home", ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(bin, "home", ".ssh"), "");
  assert.equal(await code("ok"), "AUTHORIZED_KEYS_WRITE_FAILED");

  // Without trust the command answers at once, with stdin still open and unread.
  const untrusted = rt.registerBinding({ target: { host: "10.1.0.3", user: "kite", port: 22 }, keyFile: path.join(tmp, "id-10.1.0.2") });
  const early = await runCli(["authorize-key", "--ref", untrusted.ref], { env, keepStdinOpen: true });
  assert.deepEqual([early.code, early.json.code], [2, "HOST_TRUST_MISSING"]);
  const keyless = rt.registerBinding({ target: { host: "10.1.0.4", user: "kite", port: 22 } });
  const keylessKnown = JSON.parse(fs.readFileSync(rt.storePath(), "utf8")).bindings.find(b => b.ref === keyless.ref).known_hosts_file;
  fs.writeFileSync(keylessKnown, `10.1.0.4 ${publicKey}\n`);
  assert.equal((await runCli(["authorize-key", "--ref", keyless.ref], { env, keepStdinOpen: true })).json.code, "CREDENTIAL_NOT_LOADED");
});

// A stand-in runtime artifact: its runtime-smoke passes unless the stage says otherwise.
function runtimeAssets(version, smokeExit = 0, platform = "darwin-arm64") {
  const dir = fs.mkdtempSync(path.join(tmp, "assets-"));
  const name = `aiterm-runtime-${version}-${platform}`;
  const root = path.join(dir, "build", name);
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "RUNTIME"), `${name}\n`);
  fs.writeFileSync(path.join(root, "bin", "aiterm-remote-terminal"), `#!/bin/sh\n[ "$1" = runtime-smoke ] && [ "$3" = ${version} ] && exit ${smokeExit}\nexit 9\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, `v${version}`));
  const tarball = path.join(dir, `v${version}`, `${name}.tar.gz`);
  assert.equal(spawnSync("tar", ["-czf", tarball, "-C", path.join(dir, "build"), name]).status, 0);
  const sum = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
  fs.writeFileSync(path.join(dir, `v${version}`, `aiterm-runtime-${version}-SHA256SUMS`), `${sum}  ${name}.tar.gz\n`);
  return { base: `file://${dir}`, tarball };
}

test("provision bootstrap: stage, checksum, smoke, then current/previous; failures keep the current runtime", { skip: !posix || spawnSync("curl", ["--version"]).error !== undefined }, () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const darwin = stubBin("darwin", { uname: '#!/bin/sh\n[ "$1" = -s ] && echo Darwin || echo arm64\n', sysctl: "#!/bin/sh\necho 1\n" });
  const run = (version, base, platform = darwin) => {
    const result = spawnSync("/bin/sh", ["-s", "--", version, base], { input: prov.PROVISION_SCRIPT, encoding: "utf8",
      env: { PATH: `${platform}:${process.env.PATH}`, HOME: home } });
    return { code: result.status, out: prov.parseProvisionOutput(result.stdout) };
  };
  const current = path.join(home, ".aiterm", "runtime", "current");
  const a = runtimeAssets("1.0.0");
  assert.deepEqual(run("1.0.0", a.base), { code: 0, out: { result: "PROVISIONED", version: "1.0.0" } });
  assert.equal(fs.readFileSync(path.join(current, "RUNTIME"), "utf8").trim(), "aiterm-runtime-1.0.0-darwin-arm64");
  assert.equal(fs.statSync(path.join(home, ".aiterm", "runtime")).mode & 0o777, 0o700);
  assert.deepEqual(run("1.0.0", a.base).out, { result: "ALREADY_CURRENT", version: "1.0.0" });

  const broken = runtimeAssets("2.0.0", 1);
  assert.deepEqual(run("2.0.0", broken.base).out, { code: "RUNTIME_SMOKE_FAILED" });
  const tampered = runtimeAssets("2.0.0");
  fs.appendFileSync(tampered.tarball, "x");
  assert.deepEqual(run("2.0.0", tampered.base).out, { code: "RUNTIME_VERIFY_FAILED" });
  assert.deepEqual(run("2.0.0", `file://${tmp}/nowhere`).out, { code: "RUNTIME_DOWNLOAD_FAILED" });
  assert.equal(fs.readFileSync(path.join(current, "RUNTIME"), "utf8").trim(), "aiterm-runtime-1.0.0-darwin-arm64", "failures keep current");
  assert.deepEqual(fs.readdirSync(path.join(home, ".aiterm", "runtime")).sort(), ["current"], "no stage or lock left");

  const b = runtimeAssets("2.0.0");
  assert.deepEqual(run("2.0.0", b.base).out, { result: "PROVISIONED", version: "2.0.0" });
  assert.equal(fs.readFileSync(path.join(home, ".aiterm", "runtime", "previous", "RUNTIME"), "utf8").trim(), "aiterm-runtime-1.0.0-darwin-arm64");

  const lock = path.join(home, ".aiterm", "runtime", ".lock");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
  assert.deepEqual(run("1.0.0", a.base).out, { code: "PROVISION_BUSY" });
  fs.writeFileSync(path.join(lock, "pid"), "999999999");
  assert.deepEqual(run("1.0.0", a.base).out, { result: "PROVISIONED", version: "1.0.0" }, "a dead owner's lock is taken over");

  const other = stubBin("freebsd", { uname: "#!/bin/sh\necho FreeBSD\n" });
  assert.deepEqual(run("1.0.0", a.base, other).out, { code: "PROVISION_PLATFORM_UNSUPPORTED" });
});

// Linux: only the tools the bootstrap runs are on PATH, so the real /usr/bin/tmux of the test machine cannot answer for the stub's absence.
function linuxTools(machine, { tmux }) {
  const bin = fs.mkdtempSync(path.join(tmp, "linux-tools-"));
  for (const tool of ["sed", "tail", "printenv", "curl", "tar", "awk", "sha256sum", "cat", "cut", "mkdir", "chmod", "rm", "mv", "kill", "env", "gzip"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (found) fs.symlinkSync(found, path.join(bin, tool));
  }
  fs.writeFileSync(path.join(bin, "uname"), `#!/bin/sh\n[ "$1" = -s ] && echo Linux || echo ${machine}\n`, { mode: 0o755 });
  if (tmux) fs.writeFileSync(path.join(bin, "tmux"), "#!/bin/sh\necho tmux 3.5\n", { mode: 0o755 });
  // The login shell the bootstrap asks for its PATH: it answers with exactly these tools.
  fs.writeFileSync(path.join(bin, "login-shell"), `#!/bin/sh\necho "PATH=${bin}"\n`, { mode: 0o755 });
  return bin;
}

test("provision bootstrap on Linux: x86_64 -> x64, aarch64 -> arm64, the system tmux is required before any download", { skip: !posix || spawnSync("curl", ["--version"]).error !== undefined }, () => {
  const run = (bin, version, base, home) => {
    const result = spawnSync("/bin/sh", ["-s", "--", version, base], { input: prov.PROVISION_SCRIPT, encoding: "utf8",
      env: { PATH: bin, SHELL: path.join(bin, "login-shell"), HOME: home } });
    return { code: result.status, out: prov.parseProvisionOutput(result.stdout), stdout: result.stdout };
  };
  const home = () => fs.mkdtempSync(path.join(tmp, "home-linux-"));
  for (const [machine, arch] of [["x86_64", "x64"], ["aarch64", "arm64"], ["arm64", "arm64"]]) {
    const h = home();
    const assets = runtimeAssets("1.0.0", 0, `linux-${arch}`);
    assert.deepEqual(run(linuxTools(machine, { tmux: true }), "1.0.0", assets.base, h).out, { result: "PROVISIONED", version: "1.0.0" }, machine);
    assert.equal(fs.readFileSync(path.join(h, ".aiterm", "runtime", "current", "RUNTIME"), "utf8").trim(), `aiterm-runtime-1.0.0-linux-${arch}`);
  }
  const unsupported = run(linuxTools("riscv64", { tmux: true }), "1.0.0", "file:///nowhere", home());
  assert.deepEqual(unsupported.out, { code: "PROVISION_PLATFORM_UNSUPPORTED" });
  // No tmux on the login PATH: refused before the home is touched and before curl runs (the base does not exist).
  const h = home();
  const missing = run(linuxTools("x86_64", { tmux: false }), "1.0.0", "file:///nowhere", h);
  assert.deepEqual(missing.out, { code: "PROVISION_TMUX_MISSING" });
  assert.equal(missing.code, 3);
  assert.deepEqual(fs.readdirSync(h), [], "nothing created on the terminal");
});

test("provision refuses before SSH without trust; runtime-smoke checks its own version", { skip: !posix || !hasKeygen }, async () => {
  const untrusted = rt.registerBinding({ target: { host: "10.1.0.5", user: "kite", port: 22 } });
  await assert.rejects(prov.provision(untrusted.ref), error => error.code === "HOST_TRUST_MISSING");
  await assert.rejects(prov.provision(untrusted.ref, "latest"), error => error.code === "VERSION_INVALID");
  assert.equal((await runCli(["runtime-smoke", "--expect-version", "0.0.1"])).json.code, "RUNTIME_SMOKE_FAILED");
});

test("POSIX remote commands prefer the provisioned runtime over another aiterm-mcp on PATH", { skip: !posix }, () => {
  const home = fs.mkdtempSync(path.join(tmp, "pref-"));
  const other = stubBin("other", { "aiterm-mcp": "#!/bin/sh\n" });
  const command = remote.posixCommand("command -v aiterm-mcp");
  const resolve = () => spawnSync("/bin/sh", ["-c", command], { encoding: "utf8", env: { HOME: home, SHELL: "/bin/false", PATH: `${other}:/usr/bin:/bin` } }).stdout.trim();
  assert.equal(resolve(), path.join(other, "aiterm-mcp"));
  const bin = path.join(home, ".aiterm", "runtime", "current", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "aiterm-mcp"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(resolve(), path.join(bin, "aiterm-mcp"));
});

// ---- terminal platform (remote-terminal.md R20) ----

test("terminal os: an optional sibling of target in the launch argument and in remote_terminal_open; the probe output decides the platform", async () => {
  const contract = await import("../dist/remote-contract.js");
  const value = { ref: "00000000-0000-4000-8000-000000000000", target: { host: "10.0.0.7", user: "kite", port: 22 },
    trustRevision: `sha256:${"1".repeat(64)}`, credentialRevision: `sha256:${"2".repeat(64)}` };
  for (const os of ["macos", "linux", "windows"]) assert.equal(contract.terminalArgumentSchema.safeParse({ ...value, os }).success, true, os);
  assert.equal(contract.terminalArgumentSchema.safeParse(value).success, true, "omitted stays valid");
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...value, os: "freebsd" }).success, false);
  assert.equal(contract.terminalArgumentSchema.safeParse({ ...value, target: { ...value.target, os: "linux" } }).success, false, "never inside target");
  assert.match(contract.terminalArgumentDescription, /TERMINAL_OS_MISMATCH/);
  assert.match(contract.terminalArgumentDescription, /TERMINAL_PLATFORM_UNSUPPORTED/);

  // posix shells print the shell-probe line, then uname; cmd prints one line; PowerShell prints the expanded $PSHOME and has no uname.
  const platform = remote.classifyRemotePlatform;
  assert.equal(platform("aiterm-probe %OS%\nDarwin\n"), "macos");
  assert.equal(platform("aiterm-probe %OS%\nLinux\n"), "linux");
  assert.equal(platform("aiterm-probe\n%OS%\n/usr/share/powershell\nLinux\n"), "linux", "pwsh on Linux is still Linux");
  assert.equal(platform("aiterm-probe Windows_NT $PSHOME; uname -s\r\n"), "windows");
  assert.equal(platform("aiterm-probe\r\n%OS%\r\nC:\\Program Files\\PowerShell\\7\r\n"), "windows");
  assert.equal(platform("aiterm-probe %OS%\nFreeBSD\n"), null);
  assert.equal(platform(""), null);

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "os-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "serve"], env: { ...process.env } }));
  try {
    const open = (await client.listTools()).tools.find(tool => tool.name === "remote_terminal_open");
    assert.deepEqual(open.inputSchema.properties.os.enum, ["macos", "linux", "windows"]);
    assert.equal(open.inputSchema.required.includes("os"), false);
    const call = os => client.callTool({ name: "remote_terminal_open", arguments: { ref: value.ref, target: value.target, ...(os ? { os } : {}),
      trustRevision: value.trustRevision, credentialRevision: value.credentialRevision } });
    for (const os of ["linux", undefined]) assert.match((await call(os)).content[0].text, /BINDING_UNKNOWN/, "past the schema, refused by the binding");
    assert.equal((await call("freebsd")).isError, true);
    assert.doesNotMatch((await call("freebsd")).content[0].text, /BINDING_UNKNOWN/);
  } finally { await client.close(); }
});

// One fake ssh: the platform probe answers by host name; the MCP connection is a real Aiterm server on this machine.
function platformSsh(t, { shellEnv = "" } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "platform-ssh-"));
  const log = path.join(dir, "log");
  const index = path.resolve("dist/index.js");
  fs.writeFileSync(path.join(dir, "ssh"), `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"uname -s"*)
    case "$*" in
      *t-win*) echo 'aiterm-probe Windows_NT $PSHOME; uname -s' ;;
      *t-mac*) echo 'aiterm-probe %OS%'; echo Darwin ;;
      *t-odd*) echo 'aiterm-probe %OS%'; echo FreeBSD ;;
      *) echo 'aiterm-probe %OS%'; echo Linux ;;
    esac; exit 0 ;;
  *aiterm-probe*) echo 'aiterm-probe %OS%'; exit 0 ;;
  *private-env-stdin*) exec ${JSON.stringify(process.execPath)} ${JSON.stringify(index)} --private-env-stdin ;;
${shellEnv ? `  *"/bin/sh -c"*) for last; do :; done; ${shellEnv} eval "exec $last" ;;\n` : ""}esac
exit 255
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  return () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
}

test("launch with terminal: a declared os that differs and an unknown system are refused as not started, before any MCP call; Windows is accepted in its own cwd form; the probe runs once per ref", { skip: !posix || !hasKeygen }, async t => {
  const calls = platformSsh(t);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createAitermServer } = await import("../dist/index.js");
  const client = new Client({ name: "platform-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createAitermServer().connect(b); await client.connect(a);
  t.after(() => client.close());
  const terminalFor = host => { const { ref } = trustedBinding(host); const status = rt.bindingStatus(ref);
    return { ref, target: status.target, trustRevision: status.trust.revision, credentialRevision: status.credential.revision }; };
  const launch = (terminal, cwd = "/work/project") => client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", terminal, cwd } });
  const meta = result => result._meta["aiterm/launch_error"];
  const probes = () => calls().filter(line => line.includes("uname -s")).length;

  const linux = terminalFor("t-linux");
  const mismatch = await launch({ ...linux, os: "macos" });
  assert.match(mismatch.content[0].text, /^aiterm: TERMINAL_OS_MISMATCH: .*macos.*linux/);
  assert.deepEqual({ ...meta(mismatch), action: typeof meta(mismatch).action }, { schema: "aiterm.agent-launch-error.v1", harness: "claude-code",
    code: "TERMINAL_OS_MISMATCH", phase: "terminal", effect: "not_started", session_created: false, action: "string" });
  assert.equal(mismatch._meta["aiterm/error_code"].code, "TERMINAL_OS_MISMATCH");
  assert.equal(probes(), 1);
  // Same ref again, now matching: no second platform probe; it goes on to the terminal's own version probe (fails here: no MCP over this stub path).
  const next = await launch({ ...linux, os: "linux" });
  assert.doesNotMatch(next.content[0].text, /TERMINAL_OS_MISMATCH|TERMINAL_PLATFORM_UNSUPPORTED/);
  assert.equal(probes(), 1, "cached per ref");

  const mac = terminalFor("t-mac");
  assert.match((await launch({ ...mac, os: "linux" })).content[0].text, /TERMINAL_OS_MISMATCH/);
  assert.doesNotMatch((await launch({ ...mac, os: "macos" })).content[0].text, /TERMINAL_OS_MISMATCH|TERMINAL_PLATFORM_UNSUPPORTED/);

  // Windows is a platform since 0.70.8: never refused as unsupported; the cwd must be drive-absolute, and the connect command is built for the probed shell (cmd here).
  const win = terminalFor("t-win");
  for (const terminal of [win, { ...win, os: "windows" }]) {
    const refused = await launch(terminal, "/work/project");
    assert.match(refused.content[0].text, /TERMINAL_INVALID: cwd is required.*X:/);
    assert.equal(meta(refused).code, "TERMINAL_INVALID");
    assert.match((await launch(terminal, "\\\\server\\share\\project")).content[0].text, /TERMINAL_INVALID/, "UNC is refused");
    assert.doesNotMatch((await launch(terminal, "C:\\work\\project")).content[0].text, /TERMINAL_INVALID|TERMINAL_PLATFORM_UNSUPPORTED|TERMINAL_OS_MISMATCH/);
  }
  const encoded = calls().filter(line => line.includes("-EncodedCommand"));
  assert.ok(encoded.length > 0, "the version probe ran as a cmd-safe encoded PowerShell command");
  assert.match(Buffer.from(/-EncodedCommand (\S+)/.exec(encoded[0])[1], "base64").toString("utf16le"), /& 'aiterm-mcp'/);
  assert.match((await launch({ ...win, os: "linux" })).content[0].text, /TERMINAL_OS_MISMATCH/, "a wrong declaration is reported before the unsupported system");
  assert.match((await launch(terminalFor("t-odd"))).content[0].text, /TERMINAL_PLATFORM_UNSUPPORTED/);
  // cwd: POSIX absolute on macOS and Linux terminals, also when the probe (not the caller) says so.
  assert.match((await launch({ ...linux, os: "linux" }, "C:\\work\\project")).content[0].text, /TERMINAL_INVALID: cwd is required.*POSIX/);
  assert.match((await launch(linux, "C:\\work\\project")).content[0].text, /TERMINAL_INVALID: cwd is required.*POSIX/);
  assert.match((await launch(linux, "relative")).content[0].text, /TERMINAL_INVALID/);
  assert.equal(calls().some(line => line.includes("private-env-stdin")), false, "no MCP connection was made for a refused platform");
});

test("remote_terminal_open: probes first, refuses a wrong os before connecting, builds the Windows connect command, and reports the platform", { skip: !posix || !hasKeygen || spawnSync("ssh-agent", ["-?"]).error !== undefined }, async t => {
  const calls = platformSsh(t);
  const openFor = (host, os) => { const { ref } = trustedBinding(host); const status = rt.bindingStatus(ref);
    return rt.RemoteTerminalConnection.open({ ref, target: status.target, ...(os ? { os } : {}), trustRevision: status.trust.revision, credentialRevision: status.credential.revision }); };
  await assert.rejects(openFor("t-open-linux", "macos"), error => error.code === "TERMINAL_OS_MISMATCH");
  await assert.rejects(openFor("t-odd-open"), error => error.code === "TERMINAL_PLATFORM_UNSUPPORTED");
  assert.equal(calls().some(line => line.includes("private-env-stdin")), false, "refused before the MCP connection");
  // Windows is not refused: it connects with the PowerShell command (the stub ssh has no such server, so the connection fails as a connection).
  await assert.rejects(openFor("t-win-open", "windows"), error => error.code === "CONNECTION_FAILED");
  const open = calls().find(line => line.includes("-EncodedCommand"));
  assert.match(Buffer.from(/-EncodedCommand (\S+)/.exec(open)[1], "base64").toString("utf16le"), /& 'aiterm-mcp' '--private-env-stdin'/);
  for (const [host, os, platform] of [["t-open-linux2", "linux", "linux"], ["t-mac-open", undefined, "macos"]]) {
    const connection = await openFor(host, os);
    assert.equal(connection.platform, platform);
    await connection.close();
  }
});

test("claude_update: the version is also read from ~/.local/bin/claude when a login shell has no claude on PATH", { skip: !posix || !hasKeygen || spawnSync("ssh-agent", ["-?"]).error !== undefined }, async t => {
  const home = fs.mkdtempSync(path.join(tmp, "claude-home-"));
  fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local", "bin", "claude"), "#!/bin/sh\necho '2.9.9 (Claude Code)'\n", { mode: 0o755 });
  // A PATH with only what the remote command line needs, so the machine's own claude is not found.
  const tools = fs.mkdtempSync(path.join(tmp, "claude-tools-"));
  for (const tool of ["sed", "tail"]) fs.symlinkSync(spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim(), path.join(tools, tool));
  fs.writeFileSync(path.join(tools, "login-shell"), `#!/bin/sh\necho "PATH=${tools}"\n`, { mode: 0o755 });
  platformSsh(t, { shellEnv: `export HOME=${JSON.stringify(home)} SHELL=${JSON.stringify(path.join(tools, "login-shell"))};` });
  const { ref } = trustedBinding("t-claude");
  const status = rt.bindingStatus(ref);
  const connection = await rt.RemoteTerminalConnection.open({ ref, target: status.target, trustRevision: status.trust.revision, credentialRevision: status.credential.revision });
  try {
    const result = await connection.command("claude_update");
    assert.equal(result.exit_code, 127, JSON.stringify(result));
    assert.equal(result.version, "2.9.9");
  } finally { await connection.close(); }
});

// ---- Windows terminals (remote-terminal.md R21, 0.70.8) ----

const decodeEncoded = command => Buffer.from(/-EncodedCommand (\S+)$/.exec(command)[1], "base64").toString("utf16le");

test("PowerShell quoting: spaces, quotes, $, backticks and non-ASCII stay one literal argument", () => {
  assert.equal(remote.powershellQuote("plain"), "'plain'");
  assert.equal(remote.powershellQuote("C:\\Users\\a b\\x"), "'C:\\Users\\a b\\x'");
  assert.equal(remote.powershellQuote("it's"), "'it''s'");
  assert.equal(remote.powershellQuote('say "hi" $env:PATH `n $(calc)'), `'say "hi" $env:PATH \`n $(calc)'`);
  assert.equal(remote.powershellQuote("\u30d7\u30ed\u30b8\u30a7\u30af\u30c8"), "'\u30d7\u30ed\u30b8\u30a7\u30af\u30c8'");
  assert.equal(remote.powershellInvoke(["aiterm-wait", "--session", "a b"]), "& 'aiterm-wait' '--session' 'a b'");
});

test("terminal command: the same operation for each shell; Windows gets the runtime preamble, a missing-program guard and the real exit code", () => {
  const script = remote.terminalProgram(["aiterm-remote-terminal", "path-status", "--path-base64", "QzpcVXNlcnNc"]);
  assert.equal(script.posix, "exec aiterm-remote-terminal path-status --path-base64 QzpcVXNlcnNc");
  assert.match(script.windows, /^if \(-not \(Get-Command 'aiterm-remote-terminal' -ErrorAction SilentlyContinue\)\) \{ \[Console\]::Error\.WriteLine\('aiterm-remote-terminal: command not found'\); exit 127 \}; & 'aiterm-remote-terminal' 'path-status' '--path-base64' 'QzpcVXNlcnNc'$/);
  assert.equal(remote.terminalProgram(["claude", "--version"]).windows, "& 'claude' '--version'", "only Aiterm's own programs carry the guard");

  assert.match(remote.terminalCommand("posix", script), /^\/bin\/sh -c '.*exec aiterm-remote-terminal path-status/);
  const ps = remote.terminalCommand("powershell", script);
  assert.match(ps, /^Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue; \$r = Join-Path \$env:USERPROFILE '\.aiterm\\runtime\\current\\bin'; if \(Test-Path -LiteralPath \(Join-Path \$r 'aiterm-mcp\.cmd'\)\)/);
  assert.match(ps, /; \$ok = \$\?; \$code = \$LASTEXITCODE; if \(\$code\) \{ exit \$code \}; if \(\$ok\) \{ exit 0 \}; exit 1$/);
  assert.ok(ps.includes(script.windows));
  assert.doesNotMatch(ps, /[^\x20-\x7e]/, "ASCII only: the Windows console code page must not touch it");
  // cmd cannot read PowerShell quoting: the same body goes through -EncodedCommand (UTF-16LE base64), nothing else on the line.
  const cmd = remote.terminalCommand("cmd", script);
  assert.match(cmd, /^powershell -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand [A-Za-z0-9+/=]+$/);
  assert.equal(decodeEncoded(cmd), ps);
  // A quote in an argument cannot leave its literal.
  assert.match(remote.terminalCommand("powershell", remote.terminalProgram(["claude", "a'; calc; '"])), /& 'claude' 'a''; calc; '''/);
});

test("the stdin stub runs a whole multi-line script and is the Windows entry for authorize-key and provision", () => {
  assert.equal(decodeEncoded(remote.WINDOWS_STDIN_SCRIPT_COMMAND), "Invoke-Expression ([Console]::In.ReadToEnd())");
  assert.match(remote.WINDOWS_STDIN_SCRIPT_COMMAND, /^powershell -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand /);
});

test("keeper command: the remote command ends with stdin on every shell", () => {
  assert.equal(rt.keeperCommand("posix"), "cat >/dev/null");
  assert.equal(rt.keeperCommand("powershell"), "[Console]::In.ReadToEnd() | Out-Null");
  assert.equal(decodeEncoded(rt.keeperCommand("cmd")), "[Console]::In.ReadToEnd() | Out-Null");
});

test("Windows paths: drive-absolute with backslashes only; UNC, device, relative, drive-relative, / separators and forbidden characters are refused", () => {
  for (const good of ["C:\\", "C:\\Users\\kite_", "d:\\work\\my project", "C:\\Users\\kite_\\\u30d7\u30ed\u30b8\u30a7\u30af\u30c8"]) {
    assert.doesNotThrow(() => rpath.checkRemotePath(good, "windows"), good);
    assert.equal(rpath.terminalCwdFits(good, "windows"), true, good);
  }
  for (const bad of ["", "relative\\dir", "\\\\server\\share\\x", "\\\\?\\C:\\x", "C:x", "C:/x", "C:\\a/b", "C:\\a:stream", "C:\\a?b", "C:\\a\u0000b", "C:\\a\nb", "/usr/bin", 42, undefined]) {
    assert.throws(() => rpath.checkRemotePath(bad, "windows"), error => error.code === "PATH_INVALID", String(bad));
    assert.equal(rpath.terminalCwdFits(bad, "windows"), false, String(bad));
  }
  assert.doesNotThrow(() => rpath.checkRemotePath("/Users/x", "posix"));
  assert.throws(() => rpath.checkRemotePath("C:\\x", "posix"), error => error.code === "PATH_INVALID");
  // cwd: the probed system decides; undeclared accepts either native form until the probe answers.
  assert.equal(rpath.terminalCwdFits("/work", "linux"), true);
  assert.equal(rpath.terminalCwdFits("C:\\work", "macos"), false);
  assert.equal(rpath.terminalCwdFits("/work", "windows"), false);
  assert.equal(rpath.terminalCwdFits("C:\\work"), true);
  assert.equal(rpath.terminalCwdFits("/work"), true);
  assert.equal(rpath.terminalCwdFits("work"), false);
});

test("Windows failure wording: a missing Aiterm is recognised in English cmd and PowerShell text and by our own guard line; other programs are not", () => {
  const unavailable = text => rt.classifySshFailure(text).code === "REMOTE_AITERM_UNAVAILABLE";
  assert.ok(unavailable("'aiterm-mcp' is not recognized as an internal or external command,\r\noperable program or batch file."));
  assert.ok(unavailable("aiterm-mcp : The term 'aiterm-mcp' is not recognized as the name of a cmdlet, function, script file, or operable program."));
  assert.ok(unavailable("The term 'aiterm-mcp' is not recognized as a name of a cmdlet, function, script file, or executable program."));
  assert.ok(unavailable("\u001b[31;1maiterm-wait: command not found"), "the guard line works whatever the Windows language, with colour codes before it");
  assert.ok(unavailable("sh: 1: aiterm-mcp: not found"));
  assert.ok(!unavailable("The term 'claude' is not recognized as the name of a cmdlet, function, script file, or operable program."));
  assert.equal(rt.classifySshFailure("The term 'git' is not recognized as the name of a cmdlet").code, "CONNECTION_FAILED");
  assert.match(terminalError.terminalLaunchAction("CONNECTION_REFUSED"), /Windows/);
  assert.match(terminalError.terminalLaunchAction("CONNECTION_REFUSED"), /OpenSSH/);
  assert.doesNotMatch(terminalError.terminalLaunchAction("TERMINAL_PLATFORM_UNSUPPORTED"), /まだ/);
});
const terminalError = await import("../dist/terminal-launch-error.js");

test("platform probe -> shell: one ssh run decides the platform and the shell kind, so no second shell probe is made", { skip: !posix || !hasKeygen }, async t => {
  const dir = fs.mkdtempSync(path.join(tmp, "shell-ssh-"));
  const log = path.join(dir, "log");
  fs.writeFileSync(path.join(dir, "ssh"), `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$*" in
  *h-cmd*) echo 'aiterm-probe Windows_NT $PSHOME; uname -s' ;;
  *h-pwsh*) echo 'aiterm-probe %OS% C:\\Program Files\\PowerShell\\7' ;;
  *h-ps5*) echo 'aiterm-probe %OS% C:\\Windows\\System32\\WindowsPowerShell\\v1.0' ;;
  *) echo 'aiterm-probe %OS%'; echo Linux ;;
esac
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  for (const [host, platform, shell] of [["h-cmd", "windows", "cmd"], ["h-pwsh", "windows", "powershell"], ["h-ps5", "windows", "powershell"], ["h-posix", "linux", "posix"]]) {
    const { ref } = trustedBinding(host);
    const target = rt.trustedTarget(JSON.parse(fs.readFileSync(rt.storePath(), "utf8")).bindings.find(b => b.ref === ref));
    assert.equal(await remote.remotePlatform(target), platform, host);
    assert.equal(await remote.remoteShell(target), shell, host);
  }
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 4, "one probe per terminal");
});

test("authorize-key on Windows: the PowerShell script is ASCII, decides the target file, and its markers (not the exit code) carry the result", { skip: !posix || !hasKeygen }, async () => {
  const auth = await import("../dist/remote-authorize.js");
  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLEBLOB0000000000000000000000000000000";
  const script = auth.windowsAuthorizedKeysScript(key);
  assert.doesNotMatch(script, /[^\x09\x0a\x20-\x7e]/, "ASCII only");
  assert.ok(script.includes(`$key = '${key}'; $type = 'ssh-ed25519'; $blob = 'AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLEBLOB0000000000000000000000000000000'`));
  // The decision: Administrators AND the default Match block -> the shared file with a reset ACL (SIDs, not localized names); otherwise the user's file.
  assert.match(script, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.match(script, /Match\\s\+Group\\s\+administrators/);
  assert.match(script, /__PROGRAMDATA__\/ssh\/administrators_authorized_keys/);
  assert.match(script, /\$shared\) \{ \$file = Join-Path \$env:ProgramData 'ssh\\administrators_authorized_keys' \} else \{ \$file = Join-Path \$dir 'authorized_keys' \}/);
  assert.match(script, /icacls\.exe \$file \/inheritance:r \/grant '\*S-1-5-32-544:F' \/grant '\*S-1-5-18:F'/);
  assert.match(script, /UTF8Encoding\(\$false\)/);
  assert.match(script, /AITERM_AUTHORIZE_ERROR/);
  // The password ssh runs the stdin stub, not /bin/sh.
  const known = trustedBinding("10.1.0.20");
  const binding = JSON.parse(fs.readFileSync(rt.storePath(), "utf8")).bindings.find(b => b.ref === known.ref);
  assert.equal(auth.passwordSshArguments(binding).at(-1), "/bin/sh -s");
  assert.equal(auth.passwordSshArguments(binding, "windows").at(-1), remote.WINDOWS_STDIN_SCRIPT_COMMAND);

  // End to end with a stand-in ssh that answers like the Windows side: the script arrives on stdin, markers decide.
  const bin = stubBin("winssh", { ssh: `#!/bin/sh
d=$(dirname "$0")
for last; do :; done
printf '%s' "$last" > "$d/cmd"
"$SSH_ASKPASS" "kite@h's password: " > "$d/got" || exit 255
cat > "$d/script"
cat "$d/reply"
exit $(cat "$d/exit")
` });
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const answer = async (reply, exit) => { fs.writeFileSync(path.join(bin, "reply"), reply); fs.writeFileSync(path.join(bin, "exit"), String(exit)); return runCli(["authorize-key", "--ref", known.ref, "--os", "windows"], { input: "pw", env }); };
  const ok = await answer("AITERM_AUTHORIZE AUTHORIZED\r\n", 0);
  assert.deepEqual([ok.code, ok.json.result], [0, "AUTHORIZED"]);
  assert.equal(fs.readFileSync(path.join(bin, "cmd"), "utf8"), remote.WINDOWS_STDIN_SCRIPT_COMMAND);
  assert.equal(fs.readFileSync(path.join(bin, "script"), "utf8"), auth.windowsAuthorizedKeysScript(known.publicKey));
  assert.equal((await answer("AITERM_AUTHORIZE ALREADY_AUTHORIZED\n", 0)).json.result, "ALREADY_AUTHORIZED");
  // The nested powershell's exit code is flattened to 1 under `pwsh -c`: the marker names the failure.
  assert.equal((await answer("AITERM_AUTHORIZE_ERROR 22\n", 1)).json.code, "AUTHORIZED_KEYS_WRITE_FAILED");
  assert.equal((await answer("AITERM_AUTHORIZE_ERROR 21\n", 1)).json.code, "AUTHORIZED_KEYS_WRITE_FAILED");
  assert.equal((await runCli(["authorize-key", "--ref", known.ref, "--os", "beos"], { input: "pw", env })).json.code, "OS_INVALID");
  fs.writeFileSync(path.join(bin, "reply"), "AITERM_AUTHORIZE AUTHORIZED\n"); fs.writeFileSync(path.join(bin, "exit"), "0");
  assert.equal((await runCli(["authorize-key", "--ref", known.ref, "--os", "macos"], { input: "pw", env })).code, 0, "macos and linux run the POSIX script (the stand-in ssh ignores it)");
  assert.equal(fs.readFileSync(path.join(bin, "cmd"), "utf8"), "/bin/sh -s");
});

test("Windows provision: the bootstrap is ASCII, checks psmux before any download, verifies the checksum, swaps a junction; the result lines are the POSIX ones", () => {
  const script = prov.windowsProvisionScript("0.70.8", prov.RUNTIME_RELEASE_BASE);
  assert.doesNotMatch(script, /[^\x09\x0a\x20-\x7e]/, "ASCII only");
  assert.ok(script.includes("$V = '0.70.8'; $BASE = 'https://github.com/kitepon/aiterm-mcp/releases/download'"));
  assert.ok(script.indexOf("PROVISION_PSMUX_MISSING") < script.indexOf("Invoke-WebRequest"), "psmux is checked before the download");
  assert.ok(script.indexOf("PROVISION_PLATFORM_UNSUPPORTED") < script.indexOf("PROVISION_PSMUX_MISSING"));
  for (const code of ["RUNTIME_DIR_UNAVAILABLE", "PROVISION_BUSY", "RUNTIME_ARTIFACT_UNAVAILABLE", "RUNTIME_DOWNLOAD_FAILED", "RUNTIME_VERIFY_FAILED", "RUNTIME_EXTRACT_FAILED", "RUNTIME_SMOKE_FAILED", "RUNTIME_ACTIVATE_FAILED"])
    assert.ok(script.includes(`'${code}'`), code);
  assert.ok(script.includes("aiterm-runtime-' + $V + '-win32-x64'") && script.includes("-SHA256SUMS'"));
  assert.ok(script.includes("New-Item -ItemType Junction") && script.includes("[IO.Directory]::Delete($link)"), "current is a junction: a running aiterm-mcp keeps its files");
  assert.ok(script.includes("'AITERM_PROVISION PROVISIONED ' + $V + ' x64'") && script.includes("'AITERM_PROVISION ALREADY_CURRENT ' + $V + ' x64'"));
  assert.deepEqual(prov.parseProvisionOutput("AITERM_PROVISION PROVISIONED 0.70.8 x64\r\n"), { result: "PROVISIONED", version: "0.70.8" });
  assert.deepEqual(prov.parseProvisionOutput("AITERM_PROVISION_ERROR PROVISION_PSMUX_MISSING\r\n"), { code: "PROVISION_PSMUX_MISSING" });
});

test("runtime assets: the publish job's fixed list holds the Windows zip, the workflow builds it on windows-latest, the builder parses", () => {
  const upload = fs.readFileSync("scripts/upload-runtime-assets.mjs", "utf8");
  assert.match(upload, /aiterm-runtime-\$\{version\}-win32-x64\.zip/);
  assert.match(upload, /"darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"/);
  const workflow = fs.readFileSync(".github/workflows/runtime.yml", "utf8");
  assert.match(workflow, /runner: windows-latest\n\s+script: build-windows-runtime\.mjs/);
  assert.match(workflow, /runner\.temp \}\}\/aiterm-runtime\/\*\.zip/);
  assert.equal(spawnSync(process.execPath, ["--check", "scripts/build-windows-runtime.mjs"]).status, 0);
  const builder = fs.readFileSync("scripts/build-windows-runtime.mjs", "utf8");
  assert.match(builder, /"\\r\\n"/, "the .cmd wrappers are written with CRLF");
  assert.match(builder, /cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20/);
});
