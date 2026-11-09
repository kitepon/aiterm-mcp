import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// Terminal self-service (docs/architecture/remote-terminal.md R14-R16): refused vs unreachable, empty scan, authorize-key,
// fixed path operations, the provision bootstrap and the runtime preference.
import assert from "node:assert/strict";
import fs from "node:fs";
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
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR, "remote-self-"));
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

test("command: path only for path ops; an older terminal answers REMOTE_AITERM_TOO_OLD", async () => {
  const proto = rt.RemoteTerminalConnection.prototype;
  await assert.rejects(proto.command.call({}, "claude_version", "/x"), error => error.code === "COMMAND_INVALID");
  const old = { remoteVersion: "0.68.1", pathCommand: proto.pathCommand };
  await assert.rejects(proto.command.call(old, "path_status", "/Users/x"), error => error.code === "REMOTE_AITERM_TOO_OLD");
  await assert.rejects(proto.command.call(old, "make_dir", "x"), error => error.code === "PATH_INVALID");
  assert.deepEqual([...rt.REMOTE_COMMAND_OPS], ["claude_version", "claude_install", "claude_update", "path_status", "make_dir"]);
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
function runtimeAssets(version, smokeExit = 0) {
  const dir = fs.mkdtempSync(path.join(tmp, "assets-"));
  const name = `aiterm-runtime-${version}-darwin-arm64`;
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

  const linux = stubBin("linux", { uname: "#!/bin/sh\necho Linux\n" });
  assert.deepEqual(run("1.0.0", a.base, linux).out, { code: "PROVISION_PLATFORM_UNSUPPORTED" });
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
