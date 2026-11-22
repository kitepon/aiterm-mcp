import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const rt = await import("../dist/remote-terminal.js");
const remote = await import("../dist/remote.js");
const contract = await import("../dist/remote-contract.js");
const authorize = await import("../dist/remote-authorize.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-generic-"));
const sshOk = process.platform !== "win32" && spawnSync("ssh-keygen", ["-?"]).error === undefined;
const pin = { known_hosts_file: "/k/known_hosts", host_key_alias: "alias.example", identity_agent: "/run/agent.sock" };

test("remote.ssh builds the same strict argv a binding gets, from the caller's paths only", () => {
  const { args } = remote.sshInvocation({ host: "10.0.0.9", user: "kite", port: 2222, ssh: pin }, "echo hi");
  for (const option of ["BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=/k/known_hosts", "GlobalKnownHostsFile=/dev/null", "HostKeyAlias=alias.example", "IdentityAgent=/run/agent.sock"])
    assert.ok(args.includes(option), option);
  assert.deepEqual(args.slice(0, 2), ["-F", "/dev/null"]);
  assert.ok(!args.includes("IdentitiesOnly=yes"), "a dedicated agent offers only its own key");
  assert.deepEqual(args.slice(-7, -3), ["-l", "kite", "-p", "2222"]);
  assert.deepEqual(args.slice(-2), ["10.0.0.9", "echo hi"]);
  const file = remote.sshInvocation({ host: "h", user: "u", ssh: { known_hosts_file: "/k/kh", identity_file: "/k/id" } }, "x").args;
  assert.ok(file.includes("IdentityFile=/k/id") && file.includes("IdentityAgent=none") && file.includes("IdentitiesOnly=yes"));
  assert.ok(!file.includes("-p"), "no port when none was given");
  // The master socket is never shared with a binding's or an ad-hoc one.
  assert.match(args.find(a => a.startsWith("ControlPath=")) ?? "ControlPath=none", /ControlPath=(none|.*\/t-p[0-9a-f]{7}-%C)$/);
});

test("remote.ssh refuses a second identity or host-key source and a malformed pin", () => {
  for (const extra of [{ identity_file: "/k/id" }, { ssh_options: ["IdentityFile=/x"] }, { passphrase_env: "P" }])
    assert.throws(() => remote.sshInvocation({ host: "h", ssh: pin, ...extra }, "x"), /REMOTE_SSH_OPTIONS_CONFLICT/);
  assert.throws(() => remote.acceptRemote({ host: "h", ssh: pin, passphrase: "secret" }), /REMOTE_SSH_OPTIONS_CONFLICT/);
  const bad = [{ ...pin, known_hosts_file: "relative/kh" }, { ...pin, identity_file: "/k/id" }, { known_hosts_file: "/k/kh" }, { ...pin, extra: 1 }, { ...pin, identity_agent: "/a b" }];
  for (const value of bad) assert.equal(contract.pinnedSshSchema.safeParse(value).success, false, JSON.stringify(value));
  assert.equal(contract.pinnedSshSchema.safeParse({ ...pin, strict_host_key: true }).success, true);
  assert.equal(contract.pinnedSshSchema.safeParse({ ...pin, strict_host_key: false }).success, false);
  assert.equal(contract.FORWARD_ID.test("terminal-1.a_b"), true);
  for (const id of ["", "-x", "a/b", "a b", "x".repeat(65)]) assert.equal(contract.FORWARD_ID.test(id), false, id);
});

function keeperFixture(name, portLine = "Allocated port 61000 for remote forward to x") {
  const dir = fs.mkdtempSync(path.join(tmp, `${name}-`)), bin = path.join(dir, "bin"), log = path.join(dir, "ssh.log");
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, "state"));
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\necho '${portLine}' >&2\ncase "$*" in *" -R "*) echo AITERM_FORWARD_READY; exec cat >/dev/null;; esac\n`, { mode: 0o755 });
  const run = script => spawnSync(process.execPath, ["--input-type=module", "-e", `
    const rt = await import(${JSON.stringify(new URL("../dist/remote-terminal.js", import.meta.url).href)});
    const fs = await import("node:fs");
    ${script}`], { encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: path.join(dir, "home"), AITERM_STATE_BASE: path.join(dir, "state") } });
  const stop = () => {
    for (const name of fs.readdirSync(path.join(dir, "state"), { recursive: true }).map(String).filter(n => /terminal-forward-.*\.lock$/.test(n)))
      try { process.kill(JSON.parse(fs.readFileSync(path.join(dir, "state", name), "utf8")).pid, "SIGKILL"); } catch { /* gone */ }
  };
  return { dir, log, run, stop, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []).filter(line => line.includes(" -R ")) };
}

test("ensure_forward: an id without a binding gets its own record and a detached keeper on the pinned route; a second call joins it", { skip: !sshOk }, () => {
  const f = keeperFixture("generic");
  const input = { id: "rabbit-1", remote: { host: "10.0.0.9", user: "kite", port: 2200, ssh: pin }, to: { host: "127.0.0.1", port: 4183 } };
  const run = f.run(`
    const first = await rt.ensureForward(${JSON.stringify(input)}, 5000);
    const second = await rt.ensureForward(${JSON.stringify(input)}, 5000);
    const status = rt.forwardStatus("rabbit-1");
    const record = JSON.parse(fs.readFileSync(process.env.AITERM_STATE_BASE + "/" + fs.readdirSync(process.env.AITERM_STATE_BASE, { recursive: true }).map(String).find(n => /terminal-forward-rabbit-1\\.json$/.test(n)), "utf8"));
    const released = rt.releaseForward("rabbit-1");
    console.log(JSON.stringify({ first, second, status, record, released, launch: fs.readdirSync(process.env.AITERM_STATE_BASE, { recursive: true }).map(String).some(n => /rabbit-1\\.launch$/.test(n)) }));
    process.exit(0);`);
  f.stop();
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(out.first.port, 61000);
  assert.equal(out.second.port, 61000);
  assert.ok(out.first.ready_at, "ready_at comes from the keeper's lock");
  assert.deepEqual({ ...out.status, ready_at: null }, { id: "rabbit-1", port: 61000, ready: true, ready_at: null });
  assert.deepEqual(out.record, { schema: "aiterm.forward-record.v1", id: "rabbit-1", target: { host: "10.0.0.9", user: "kite", port: 2200 }, ssh: pin,
    to: { host: "127.0.0.1", port: 4183 }, seat_forward_port: 61000 });
  assert.deepEqual(out.released, { id: "rabbit-1", released: true });
  assert.equal(out.launch, false, "release removes the keep-alive");
  const calls = f.calls();
  assert.equal(calls.length, 1, "the second ensure joins the running keeper");
  assert.match(calls[0], /-R 127\.0\.0\.1:0:127\.0\.0\.1:4183 /);
  for (const option of ["UserKnownHostsFile=/k/known_hosts", "IdentityAgent=/run/agent.sock", "StrictHostKeyChecking=yes", "HostKeyAlias=alias.example"]) assert.ok(calls[0].includes(option), option);
  assert.match(calls[0], / -l kite -p 2200 -- 10\.0\.0\.9 /);
});

test("ensure_forward: a pinned remote_port is requested as given and a new D clears nothing pinned", { skip: !sshOk }, () => {
  const f = keeperFixture("pinned", "debug1: Remote connections from LOCALHOST:62000 forwarded to local address 127.0.0.1:4183");
  const base = { id: "p1", remote: { host: "10.0.0.9", user: "kite", ssh: pin }, remote_port: 62000 };
  const run = f.run(`
    const a = await rt.ensureForward({ ...${JSON.stringify(base)}, to: { host: "127.0.0.1", port: 4183 } }, 5000);
    const b = await rt.ensureForward({ ...${JSON.stringify(base)}, to: { host: "127.0.0.1", port: 4190 } }, 600).then(r => r, e => e.message.split(":")[0]);
    console.log(JSON.stringify({ a, b, status: rt.forwardStatus("p1") }));
    process.exit(0);`);
  f.stop();
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(out.a.port, 62000);
  assert.equal(out.status.port, 62000, "the pin survives a changed D");
  assert.match(f.calls()[0], /-R 127\.0\.0\.1:62000:127\.0\.0\.1:4183 /);
});

test("ensure_forward: an id that is a binding's ref joins the binding's own keeper (same P, no record, no second keeper)", { skip: !sshOk }, () => {
  const f = keeperFixture("joined");
  const key = path.join(f.dir, "id");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const run = f.run(`
    const status = rt.registerBinding({ target: { host: "10.0.0.9", user: "kite", port: 22 }, keyFile: ${JSON.stringify(key)} });
    rt.bindTerminalSession("seat-old", status.ref);
    const seat = await rt.ensureSeatForward(status.ref, 4183, 5000);
    const joined = await rt.ensureForward({ id: status.ref, to: { host: "127.0.0.1", port: 4183 } }, 5000);
    const records = fs.readdirSync(process.env.AITERM_STATE_BASE, { recursive: true }).map(String).filter(n => /\\.json$/.test(n) && /terminal-forward/.test(n));
    console.log(JSON.stringify({ seat, joined, records, status: rt.forwardStatus(status.ref), stored: rt.binding(status.ref).seat_forward_port }));
    process.exit(0);`);
  f.stop();
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(out.seat, 61000);
  assert.equal(out.joined.port, 61000);
  assert.deepEqual(out.records, []);
  assert.equal(out.stored, 61000);
  assert.equal(out.status.ready, true);
  assert.equal(f.calls().length, 1);
});

test("forward input errors are typed and raise before any ssh", { skip: !sshOk }, () => {
  const f = keeperFixture("errors");
  const run = f.run(`
    const code = p => p.then(() => "ok", e => e.message.split(":")[0]);
    console.log(JSON.stringify({
      badId: await code(rt.ensureForward({ id: "-bad", to: { host: "127.0.0.1", port: 1 } })),
      noRemote: await code(rt.ensureForward({ id: "x1", to: { host: "127.0.0.1", port: 1 } })),
      noTo: await code(rt.ensureForward({ id: "x1", remote: { host: "h", user: "u", ssh: { known_hosts_file: "/k", identity_agent: "/a" } } })),
      unknownStatus: (() => { try { rt.forwardStatus("nope"); return "ok"; } catch (e) { return e.message.split(":")[0]; } })(),
      unknownRelease: (() => { try { rt.releaseForward("nope"); return "ok"; } catch (e) { return e.message.split(":")[0]; } })() }));
    process.exit(0);`);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim().split("\n").pop()), { badId: "FORWARD_ID_INVALID", noRemote: "FORWARD_INPUT_INVALID", noTo: "FORWARD_INPUT_INVALID", unknownStatus: "FORWARD_UNKNOWN", unknownRelease: "FORWARD_UNKNOWN" });
  assert.deepEqual(f.calls(), []);
});

test("export: public binding facts only (host lines, fingerprints, revision), never a key path or key bytes", { skip: !sshOk }, () => {
  const f = keeperFixture("export");
  const key = path.join(f.dir, "id"), host = path.join(f.dir, "host"), khFile = path.join(f.dir, "kh");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", host]).status, 0);
  const [type, blob] = fs.readFileSync(`${host}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(khFile, `10.0.0.9 ${type} ${blob}\n`);
  const run = f.run(`
    const status = rt.registerBinding({ target: { host: "10.0.0.9", user: "kite", port: 22 }, keyFile: ${JSON.stringify(key)}, knownHostsFile: ${JSON.stringify(khFile)} });
    console.log(JSON.stringify({ status, exported: rt.exportBinding(status.ref) }));`);
  assert.equal(run.status, 0, run.stderr);
  const { status, exported } = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(exported.schema, "aiterm.remote-binding-export.v1");
  assert.deepEqual(exported.known_hosts_lines, [`10.0.0.9 ${type} ${blob}`]);
  assert.deepEqual(exported.fingerprints, status.trust.fingerprints);
  assert.equal(exported.trust_revision, status.trust.revision);
  assert.deepEqual(exported.target, { host: "10.0.0.9", user: "kite", port: 22 });
  assert.equal(exported.seat_ingress_port, null);
  const text = JSON.stringify(exported);
  assert.ok(!text.includes(key) && !text.includes("PRIVATE KEY"), "no key path, no key bytes");
});

test("install-key over caller paths: checks run before any password is read; the result names the peer, not a ref", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "install-key-")), kh = path.join(dir, "kh"), pub = path.join(dir, "id.pub");
  const peer = { host: "10.0.0.9", user: "kite", port: 22, known_hosts_file: kh };
  assert.throws(() => authorize.prepareKeyInstall(peer, pub), /HOST_TRUST_MISSING/);
  fs.writeFileSync(kh, "");
  assert.throws(() => authorize.prepareKeyInstall(peer, pub), /CREDENTIAL_UNAVAILABLE/);
  fs.writeFileSync(pub, "not a key\n");
  assert.throws(() => authorize.prepareKeyInstall(peer, pub), /CREDENTIAL_UNAVAILABLE/);
  fs.writeFileSync(pub, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE comment\n");
  const prepared = authorize.prepareKeyInstall({ ...peer, host_key_alias: "alias.example" }, pub);
  assert.equal(prepared.key, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE");
  const args = authorize.passwordSshArguments(prepared.b);
  assert.ok(args.includes(`UserKnownHostsFile=${kh}`) && args.includes("HostKeyAlias=alias.example") && args.includes("PreferredAuthentications=password"));
  assert.deepEqual(args.slice(-7, -2), ["-l", "kite", "-p", "22", "--"]);
  assert.equal(contract.keyInstallPeerSchema.safeParse({ ...peer, extra: 1 }).success, false);
});
