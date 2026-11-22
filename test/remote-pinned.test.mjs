import "./seat-env.mjs"; // first import (ADR 0121)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

// a532b4 (remote-terminal.md "Generic remote surface"): a pinned `remote.ssh` target is a binding keyed by its id.
const contract = await import("../dist/remote-contract.js");
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR, "remote-pinned-"));
const cli = new URL("../dist/remote-cli.js", import.meta.url).pathname;
const ssh = { known_hosts_file: "/srv/state/known_hosts", host_key_alias: "box-1", identity_agent: "/run/agent.sock", strict_host_key: true };
const base = { host: "10.0.0.9", user: "kite", port: 22 };

test("remote.ssh is a typed subset: absolute paths, strict host checking, no free options", () => {
  const ok = contract.remoteInputSchema.safeParse({ ...base, ssh, id: "box-1" });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
  const refused = [
    { ...base, ssh: { ...ssh, known_hosts_file: "known_hosts" } },
    { ...base, ssh: { ...ssh, known_hosts_file: "/a\n-oProxyCommand=x" } },
    { ...base, ssh: { ...ssh, strict_host_key: false } },
    { ...base, ssh: { ...ssh, options: ["ProxyCommand=x"] } },
    { ...base, ssh, identity_file: "/k" },
    { ...base, ssh, ssh_options: ["Foo=1"] },
    { ...base, id: "box-1" },
    { ...base, ssh, id: "bad id" },
  ];
  for (const input of refused) assert.equal(contract.remoteInputSchema.safeParse(input).success, false, JSON.stringify(input));
});

function inChild(script, extra = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "case-"));
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", `const rt = await import(${JSON.stringify(new URL("../dist/remote-terminal.js", import.meta.url).href)}); const fs = await import("node:fs");\n${script}`],
    { encoding: "utf8", env: { ...process.env, HOME: path.join(dir, "home"), AITERM_STATE_BASE: path.join(dir, "state"), ...extra } });
  return { dir, run };
}

test("a pinned id is a binding: idempotent, one machine per id, options may change, the argv is the strict ssh", () => {
  const { run } = inChild(`
    const a = rt.upsertRemoteBinding("box-1", ${JSON.stringify(base)}, ${JSON.stringify(ssh)});
    const again = rt.upsertRemoteBinding("box-1", ${JSON.stringify(base)}, ${JSON.stringify(ssh)});
    let conflict = null;
    try { rt.upsertRemoteBinding("box-1", { host: "10.0.0.10", user: "kite", port: 22 }, ${JSON.stringify(ssh)}); } catch (e) { conflict = e.code; }
    const moved = rt.upsertRemoteBinding("box-1", ${JSON.stringify(base)}, { ...${JSON.stringify(ssh)}, identity_agent: "/run/other.sock" });
    let invalid = null;
    try { rt.upsertRemoteBinding("not an id", ${JSON.stringify(base)}, ${JSON.stringify(ssh)}); } catch (e) { invalid = e.code; }
    console.log(JSON.stringify({ same: a.created_at === again.created_at && a.created_at === moved.created_at, conflict, invalid,
      argv: rt.trustedSshArguments("box-1", "true", null).join(" "), agent: moved.identity_agent, derived: rt.pinnedBindingId(${JSON.stringify(base)}, ${JSON.stringify(ssh)}) }));`);
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(out.same, true);
  assert.equal(out.conflict, "REMOTE_ID_CONFLICT");
  assert.equal(out.invalid, "REF_INVALID");
  assert.equal(out.agent, "/run/other.sock");
  assert.match(out.argv, /^-F \/dev\/null -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\/srv\/state\/known_hosts -o GlobalKnownHostsFile=\/dev\/null -o CheckHostIP=no -o HostKeyAlias=box-1 -o IdentityAgent=\/run\/other\.sock /);
  assert.match(out.argv, / -l kite -p 22 -- 10\.0\.0\.9 true$/);
  assert.match(out.derived, /^ssh-[0-9a-f]{16}$/);
});

test("ensure_forward: the caller's P and D reach the keeper; status, release and export", { skip: process.platform === "win32" || spawnSync("ssh-keygen", ["-?"]).error !== undefined }, () => {
  const dir = fs.mkdtempSync(path.join(tmp, "fwd-")), bin = path.join(dir, "bin"), log = path.join(dir, "ssh.log");
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, "state"));
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *" -R "*) echo AITERM_FORWARD_READY; exec cat >/dev/null;; esac\n`, { mode: 0o755 });
  const known = path.join(dir, "known_hosts");
  const sshOptions = { ...ssh, known_hosts_file: known };
  const script = `
    rt.upsertRemoteBinding("box-1", ${JSON.stringify(base)}, ${JSON.stringify(sshOptions)});
    const port = await rt.ensureSeatForward("box-1", 4183, 5000, 61234);
    const status = rt.forwardStatus("box-1");
    const released = rt.releaseForward("box-1");
    const exported = rt.exportBinding("box-1");
    console.log(JSON.stringify({ port, status, needed: released.needed, exported }));
    process.exit(0);`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", `const rt = await import(${JSON.stringify(new URL("../dist/remote-terminal.js", import.meta.url).href)});\n${script}`],
    { encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: path.join(dir, "home"), AITERM_STATE_BASE: path.join(dir, "state") } });
  for (const name of fs.readdirSync(path.join(dir, "state"), { recursive: true }).map(String).filter(name => /terminal-forward-.*\.lock$/.test(name))) {
    try { process.kill(JSON.parse(fs.readFileSync(path.join(dir, "state", name), "utf8")).pid, "SIGKILL"); } catch { /* gone */ }
  }
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(out.port, 61234);
  assert.equal(out.status.ready, true);
  assert.equal(out.status.needed, true, "the 120 s hold of the call");
  assert.equal(typeof out.status.ready_at, "string");
  assert.equal(out.needed, false, "released, no session mapped");
  assert.equal(out.exported.schema, "aiterm.remote-export.v1");
  assert.deepEqual(out.exported.target, base);
  assert.equal(out.exported.seat_forward_port, 61234);
  assert.equal(out.exported.seat_ingress_port, 4183);
  assert.deepEqual(Object.keys(out.exported).sort(), ["fingerprints", "host_key_alias", "known_hosts_lines", "ref", "schema", "seat_forward_port", "seat_ingress_port", "target", "trust_revision"]);
  const calls = fs.readFileSync(log, "utf8").split("\n").filter(line => line.includes(" -R "));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /-R 127\.0\.0\.1:61234:127\.0\.0\.1:4183 /);
  assert.match(calls[0], /-o IdentityAgent=\/run\/agent\.sock /);
});

test("aiterm-remote: a usage line for an unknown command, a typed error for an unknown id or a malformed target", () => {
  const unknown = spawnSync(process.execPath, [cli, "nothing"], { encoding: "utf8" });
  assert.equal(unknown.status, 64);
  assert.match(unknown.stderr, /usage: aiterm-remote install-key\|install-aiterm\|forward-keeper\|export/);
  const env = { ...process.env, HOME: path.join(tmp, "home"), AITERM_STATE_BASE: path.join(tmp, "state") };
  const missing = spawnSync(process.execPath, [cli, "export", "--id", "never-registered"], { encoding: "utf8", env });
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).code, "BINDING_UNKNOWN");
  const bad = spawnSync(process.execPath, [cli, "install-aiterm", "--remote", JSON.stringify({ host: "h" })], { encoding: "utf8", env });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).code, "REMOTE_INVALID");
});
