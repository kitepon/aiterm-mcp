import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// launch-identity-input.md "Post-launch command" and remote-terminal.md R25 (a532b1).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { aliveArgv, consumedPrivateNames, postLaunchSchema, runPostLaunch } = await import("../dist/post-launch.js");
const { parseAliveArgs, sessionAliveExit } = await import("../dist/session-alive-cli.js");
const { setPrivateEnv } = await import("../dist/private-env.js");
const { createAitermServer } = await import("../dist/index.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-launch-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const writeEnv = out => ["node", "-e", "require('fs').writeFileSync(process.argv[1], JSON.stringify(process.env))", out];

test("the command is 1-16 args without NUL, at most 24 KiB in all, and nothing else", () => {
  assert.equal(postLaunchSchema.safeParse({ command: ["node", "x.js"] }).success, true);
  for (const bad of [{ command: [] }, { command: Array(17).fill("a") }, { command: ["a\0b"] }, { command: [""] }, { command: ["a".repeat(25 * 1024)] },
    { command: ["a"], shell: true }, { cmd: ["a"] }, "node x.js"]) assert.equal(postLaunchSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 40));
});

test("it names the private values the launch consumed: env_vars and every ${NAME} its mcp_config headers refer to", () => {
  const names = consumedPrivateNames({ env_vars: ["A"], mcp_config: { mcpServers: { s: { headers: { Authorization: "Bearer ${TOKEN_X}", X: "${AITERM_MCP_HEADER_0}", Y: "literal" } }, t: {} } } });
  assert.deepEqual(names.sort(), ["A", "AITERM_MCP_HEADER_0", "TOKEN_X"]);
  assert.deepEqual(consumedPrivateNames({}), []);
});

test("the hook gets plain facts and exactly the consumed private values, never another private value, and without AITERM_AGENT_*", async () => {
  setPrivateEnv({ AITERM_MCP_HEADER_0: "bearer-secret", AITERM_SEAT_FORWARD_PORT: "45123", NOT_CONSUMED: "other-secret" });
  process.env.AITERM_AGENT_ROLE = "subagent";
  const out = path.join(tmp, "env.json");
  try {
    const result = await runPostLaunch({ command: writeEnv(out) }, { session: "seat-1", event: "resume", cwd: tmp, names: ["AITERM_MCP_HEADER_0", "UNSET_NAME"] });
    assert.deepEqual(result, { status: "ok", exit_code: 0 });
  } finally { delete process.env.AITERM_AGENT_ROLE; }
  const env = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(env.AITERM_SESSION_ID, "seat-1");
  assert.equal(env.AITERM_HOOK_EVENT, "resume");
  assert.equal(env.AITERM_SEAT_FORWARD_PORT, "45123");
  assert.equal(env.AITERM_MCP_HEADER_0, "bearer-secret");
  assert.equal(env.NOT_CONSUMED, undefined);
  assert.equal(env.AITERM_AGENT_ROLE, undefined);
  assert.ok("PATH" in env || "Path" in env, "the process environment is inherited");
  const alive = JSON.parse(env.AITERM_SESSION_ALIVE);
  assert.deepEqual(alive.slice(2, 4), ["seat-1", "--tmpdir"]);
  assert.ok(path.isAbsolute(alive[4]) && !alive[4].endsWith("claude-tmux-sockets"), "the base the socket directory is made under");
  assert.match(alive[1], /session-alive-cli\.js$/);
  assert.deepEqual(aliveArgv("seat-1"), alive);
});

test("a failing, missing or stuck command never throws: failed / failed / timeout, and the stuck one is killed", async () => {
  assert.deepEqual(await runPostLaunch({ command: ["node", "-e", "process.exit(3)"] }, { session: "s", event: "launch", names: [] }), { status: "failed", exit_code: 3 });
  assert.deepEqual(await runPostLaunch({ command: [path.join(tmp, "no-such-program")] }, { session: "s", event: "launch", names: [] }), { status: "failed", exit_code: null });
  const marker = path.join(tmp, "still-running");
  const started = Date.now();
  const result = await runPostLaunch({ command: ["node", "-e", `setInterval(() => require('fs').writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 50)`] }, { session: "s", event: "launch", names: [], timeoutMs: 400 });
  assert.deepEqual(result, { status: "timeout", exit_code: null });
  assert.ok(Date.now() - started < 5000);
  await new Promise(resolve => setTimeout(resolve, 300));
  const before = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0, before, "the killed command writes no more");
});

test("aiterm-session-alive: 0 exists, 1 confirmed absent, 2 cannot tell or bad name", () => {
  assert.equal(sessionAliveExit("seat-1", () => 0), 0);
  assert.equal(sessionAliveExit("seat-1", () => 1), 1);
  assert.equal(sessionAliveExit("seat-1", () => null), 2);
  assert.equal(sessionAliveExit("seat-1", () => 127), 2);
  for (const bad of [undefined, "", "a b", "a;b", "x".repeat(200)]) assert.equal(sessionAliveExit(bad, () => 0), 2);
});

test("aiterm-session-alive arguments: --tmpdir must be absolute or the answer is 'cannot tell'", () => {
  assert.deepEqual(parseAliveArgs(["seat-1"]), { session: "seat-1", tmpdir: undefined });
  const abs = path.resolve(tmp, "base");
  assert.deepEqual(parseAliveArgs(["seat-1", "--tmpdir", abs]), { session: "seat-1", tmpdir: abs });
  for (const bad of [["seat-1", "--tmpdir"], ["seat-1", "--tmpdir", "relative/dir"], ["seat-1", "--tmpdir", ""]]) assert.equal(parseAliveArgs(bad), null, JSON.stringify(bad));
});

// The 0.70.100 failure (fox, 2026-11-23): a caller without the launching Aiterm's TMPDIR asked another socket / namespace and got "absent" for a live seat.
test("aiterm-session-alive: --tmpdir reaches the launching Aiterm's multiplexer whatever the caller's own TMPDIR", { skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).error !== undefined }, () => {
  const base = fs.mkdtempSync(path.join(tmp, "alive-base-")), other = fs.mkdtempSync(path.join(tmp, "alive-other-"));
  const sockDir = path.join(base, "claude-tmux-sockets");
  fs.mkdirSync(sockDir, { recursive: true });
  const sock = path.join(sockDir, "claude.sock");
  assert.equal(spawnSync("tmux", ["-S", sock, "new-session", "-d", "-s", "alive-fixture", "sleep 60"]).status, 0);
  try {
    const cli = new URL("../dist/session-alive-cli.js", import.meta.url).pathname;
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, TMPDIR: other }, encoding: "utf8" }).status;
    assert.equal(run("alive-fixture", "--tmpdir", base), 0, "the launching Aiterm's base finds the live session");
    assert.equal(run("alive-fixture"), 1, "the caller's own base has no such server: absent there (the 0.70.100 answer for a live seat)");
    assert.equal(run("no-such-session", "--tmpdir", base), 1);
    assert.equal(run("alive-fixture", "--tmpdir", "relative"), 2);
  } finally { spawnSync("tmux", ["-S", sock, "kill-server"]); }
});

// A fake terminal for the gate: its Aiterm version is `version`; it records the launch it receives.
async function relayLaunch(t, version, args) {
  const dir = fs.mkdtempSync(path.join(tmp, "relay-"));
  const record = path.join(dir, "calls.jsonl");
  const server = path.join(dir, "server.mjs");
  const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
  fs.writeFileSync(server, `import fs from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
const s = new Server({ name: "aiterm-mcp", version: ${JSON.stringify(version)} }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async r => {
  fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ name: r.params.name, args: r.params.arguments }) + "\\n");
  return { content: [{ type: "text", text: "fake" }], isError: true };
});
await s.connect(new StdioServerTransport());
`);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh\ncase "$*" in *aiterm-probe*) echo posix; exit 0;; esac\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(server)}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  const aiterm = createAitermServer(), client = new Client({ name: "post-launch-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await aiterm.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); });
  const result = await client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", cwd: "/work", remote: { host: `post-launch-${version}` }, ...args } });
  const calls = fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  return { result, calls };
}

test("a terminal older than 0.70.100 is refused before anything is sent; a newer one gets agent_launch with the field (never the claude_agent alias)", { skip: process.platform === "win32" }, async t => {
  const post = { command: ["node", "hook.js"] };
  const old = await relayLaunch(t, "0.70.99", { post_launch: post });
  assert.equal(old.result.isError, true);
  assert.match(old.result.content.map(item => item.text ?? "").join("\n"), /REMOTE_AITERM_TOO_OLD.*post_launch.*0\.70\.100/s);
  assert.equal(old.calls.some(call => call.name === "agent_launch" || call.name === "claude_agent"), false);
  const current = await relayLaunch(t, "0.70.100", { post_launch: post });
  const launch = current.calls.find(call => call.name === "agent_launch" || call.name === "claude_agent");
  assert.equal(launch.name, "agent_launch");
  assert.deepEqual(launch.args.post_launch, post);
});
