import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// R31: `aiterm-remote probe` / `command` run the C8 and folder operations over a caller-pinned ssh; the results are the ones remote_terminal_open / _command return.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const skip = process.platform === "win32";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-pinned-command-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
const s = new Server({ name: "aiterm-mcp", version: process.env.FAKE_VERSION }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { schema: "aiterm.pty-list-result.v1", sessions: [] } }));
await s.connect(new StdioServerTransport());
`);
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
// The remote command decides the answer: the platform probe, the Aiterm server (the line ending in `exec "$p"`), or the CLI version script.
fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh
case "$*" in *'exec "$p"'*) FAKE_VERSION=\${FAKE_REMOTE_VERSION:-0.70.111} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)};; esac
case "$*" in *uname*) printf 'aiterm-probe %%OS%%\\nLinux\\n'; exit 0;; *aiterm-probe*) echo posix; exit 0;; esac
case "$*" in *--version*) echo "grok 2.3.4"; exit 0;; esac
exit 1
`, { mode: 0o755 });
const run = (args, env = {}) => spawnSync(process.execPath, [new URL("../dist/remote-terminal-cli.js", import.meta.url).pathname, ...args,
  "--host", "10.7.0.1", "--user", "kite", "--known-hosts", "/k/known_hosts", "--identity-agent", "/run/agent.sock"],
  { encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env } });
const last = r => JSON.parse(r.stdout.trim().split("\n").pop());

test("probe: the Aiterm version and platform of a machine reached by a pinned ssh", { skip }, () => {
  const r = run(["probe"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(last(r), { remoteVersion: "0.70.111", platform: "linux" });
});

test("command: cli_version over the pinned ssh returns the binding path's result shape; a too-old remote and an unknown op are refused", { skip }, () => {
  const ok = run(["command", "--op", "cli_version", "--harness", "grok-cli"]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.deepEqual(last(ok), { op: "cli_version", harness: "grok-cli", exit_code: 0, version: "2.3.4", output_tail: "grok 2.3.4\n" });
  const old = run(["command", "--op", "cli_version", "--harness", "grok-cli"], { FAKE_REMOTE_VERSION: "0.70.8" });
  assert.equal(old.status, 2); assert.equal(last(old).code, "REMOTE_AITERM_TOO_OLD");
  const bad = run(["command", "--op", "nope"]);
  assert.equal(bad.status, 2); assert.equal(last(bad).code, "COMMAND_UNSUPPORTED");
  const noPin = spawnSync(process.execPath, [new URL("../dist/remote-terminal-cli.js", import.meta.url).pathname, "probe", "--host", "h", "--user", "u"], { encoding: "utf8" });
  assert.equal(noPin.status, 2);
});

test("a pinned ssh waits and calls through the machine's runtime like a binding does, in a Windows shell too", { skip }, async () => {
  const pinned = { host: "10.7.0.2", user: "kite", ssh: { known_hosts_file: "/k/kh", identity_agent: "/run/agent.sock" } };
  const { remoteWaitProcess, runtimeFirst } = await import("../dist/remote.js");
  assert.equal(runtimeFirst(pinned), true); assert.equal(runtimeFirst({ host: "h" }), false);
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh
case "$*" in *aiterm-probe*) echo 'aiterm-probe %OS% C:\\\\Program Files\\\\PowerShell\\\\7'; exit 0;; esac
exit 1
`, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  const wait = await remoteWaitProcess(pinned, "seat_a", 1);
  assert.match(wait.args.at(-1), /runtime/, wait.args.at(-1));
  assert.match(wait.args.at(-1), /aiterm-wait/);
});

test("aiterm-transcript-read with the pinned ssh flags reads on that machine (R32); a malformed pin is one error line", { skip }, () => {
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh
case "$*" in *aiterm-probe*) echo posix; exit 0;; esac
case "$*" in *transcript-read*) echo '{"schema":"aiterm.transcript-read.v1","lines":[],"cursor":null}'; exit 0;; esac
exit 1
`, { mode: 0o755 });
  const cli = new URL("../dist/transcript-read-cli.js", import.meta.url).pathname;
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const ok = spawnSync(process.execPath, [cli, "--session", "seat_a", "--host", "10.7.0.3", "--user", "kite", "--known-hosts", "/k/kh", "--identity-agent", "/run/agent.sock"], { encoding: "utf8", env });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim()).schema, "aiterm.transcript-read.v1");
  const bad = spawnSync(process.execPath, [cli, "--session", "seat_a", "--host", "10.7.0.3", "--user", "kite"], { encoding: "utf8", env });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout.trim()).code, "REMOTE_INVALID");
});
