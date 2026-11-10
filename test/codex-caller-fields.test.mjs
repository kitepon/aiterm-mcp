import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const codex = await import("../dist/harnesses/codex.js");
const { launchNotStartedMeta, withTerminalLaunchAction } = await import("../dist/terminal-launch-error.js");
const { launchInputRefusal } = await import("../dist/errors.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-caller-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const bellteam = { type: "http", url: "http://127.0.0.1:4181/mcp", headers: {
  Authorization: "Bearer ${BELLTEAM_MCP_TOKEN}", "X-Bellteam-Seat": "${AITERM_SESSION_ID}", "X-Bellteam-Launch-Id": "${AITERM_AGENT_LAUNCH_ID}", "X-Fixed": "v1" } };

test("mcp_config: Bearer -> bearer_token_env_var, a whole ${NAME} -> env_http_headers, a literal -> http_headers", () => {
  assert.deepEqual(codex.codexMcpOverrides({ mcpServers: { bellteam, "call-bridge": { url: "https://h.example/x?y=1" } } }), [
    'mcp_servers.bellteam={url="http://127.0.0.1:4181/mcp",bearer_token_env_var="BELLTEAM_MCP_TOKEN",'
      + 'env_http_headers={"X-Bellteam-Seat"="AITERM_SESSION_ID","X-Bellteam-Launch-Id"="AITERM_AGENT_LAUNCH_ID"},http_headers={"X-Fixed"="v1"}}',
    'mcp_servers.call-bridge={url="https://h.example/x?y=1"}']);
  // A terminal launch has already moved a literal 'Bearer <secret>' into ${AITERM_MCP_HEADER_n}: the whole value, so env_http_headers.
  assert.deepEqual(codex.codexMcpOverrides({ mcpServers: { b: { type: "http", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "${AITERM_MCP_HEADER_0}" } } } }),
    ['mcp_servers.b={url="http://127.0.0.1:9/mcp",env_http_headers={"Authorization"="AITERM_MCP_HEADER_0"}}']);
});

test("mcp_config: what Codex's http server table cannot say is refused, never guessed", () => {
  const server = extra => ({ mcpServers: { s: { url: "http://127.0.0.1:1/m", ...extra } } });
  for (const bad of [
    server({ type: "sse" }), server({ type: "stdio" }), { mcpServers: { s: { command: "x" } } }, server({ command: "x" }), server({ url: "ftp://x" }), server({ url: "nope" }),
    server({ headers: { Authorization: "Bearer ${A} extra" } }), server({ headers: { "X-A": "pre-${A}" } }), server({ headers: { "X-A": "${A}${B}" } }),
    server({ headers: { "X-A": "${a-b}" } }), server({ headers: { "X-A": "${}" } }), server({ headers: { "X A": "v" } }), server({ headers: { "X-A": 1 } }),
    server({ headers: { authorization: "Bearer ${A}", Authorization: "${B}" } }), server({ headers: [] }),
    { mcpServers: { "bad name": { url: "http://127.0.0.1:1/m" } } }, { mcpServers: {}, extra: 1 }, { mcpServers: [] }, {}, null,
  ]) assert.throws(() => codex.codexMcpOverrides(bad), /^Error: CODEX_MCP_CONFIG_UNSUPPORTED: /, JSON.stringify(bad));
});

test("a same-name user stdio server is taken over with Aiterm's relay; an http one is merged; checkCodexCallerInput checks size", () => {
  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.toml"), [
    "[mcp_servers.aiterm]", 'command = "/x"', "[mcp_servers.aiterm.env]", 'A = "b"', "",
    "[mcp_servers.bellteam]", 'url = "http://127.0.0.1:4181/mcp"', 'env_http_headers = { "X-Bellteam-Seat" = "AITERM_SESSION_ID" }', "",
    '[mcp_servers."quoted-stdio"]', "command = 'y'", ""].join("\n"));
  const stdio = codex.codexUserStdioServers(home);
  assert.deepEqual([...stdio].sort(), ["aiterm", "quoted-stdio"]);
  assert.deepEqual(codex.codexUserStdioServers(path.join(tmp, "no-such-home")), new Set(), "no user config, nothing to take over");
  const [http, relayed] = codex.codexMcpOverrides({ mcpServers: { bellteam, aiterm: bellteam } }, stdio);
  assert.match(http, /^mcp_servers\.bellteam=\{url=/);
  const bridge = fileURLToPath(new URL("../dist/mcp-http-bridge.js", import.meta.url));
  assert.equal(relayed, `mcp_servers.aiterm={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([bridge, bellteam.url,
    "--bearer-env", "BELLTEAM_MCP_TOKEN", "--env-header", "X-Bellteam-Seat=AITERM_SESSION_ID", "--env-header", "X-Bellteam-Launch-Id=AITERM_AGENT_LAUNCH_ID", "--header", "X-Fixed=v1"])},`
    + 'env_vars=["BELLTEAM_MCP_TOKEN","AITERM_SESSION_ID","AITERM_AGENT_LAUNCH_ID"],enabled=true,disabled_tools=[]}');
  assert.doesNotThrow(() => codex.checkCodexCallerInput("rules", { mcpServers: { aiterm: bellteam } }), "no longer refused");
  assert.throws(() => codex.checkCodexCallerInput("  ", null), /non-empty/);
  assert.throws(() => codex.checkCodexCallerInput("x".repeat(64 * 1024 + 1), null), /64 KiB/);
});

test("the relay carries a tool call between stdio and the http server with the seat's headers", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const http = await import("node:http");
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push([req.headers.authorization, req.headers["x-seat"], req.headers["x-fixed"]]);
    const mcp = new McpServer({ name: "probe", version: "1" });
    mcp.registerTool("echo", { description: "echo" }, async () => ({ content: [{ type: "text", text: "pong" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const [override] = codex.codexMcpOverrides({ mcpServers: { s: { url, headers: { Authorization: "Bearer ${TOK}", "X-Seat": "${SEAT}", "X-Fixed": "v1" } } } }, new Set(["s"]));
  const args = JSON.parse(/args=(\[.*?\]),env_vars/.exec(override)[1]);
  const client = new Client({ name: "relay-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args, env: { TOK: "t0k", SEAT: "seat-1" }, stderr: "pipe" }));
  try {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ["echo"]);
    assert.equal((await client.callTool({ name: "echo", arguments: {} })).content[0].text, "pong");
    assert.ok(seen.length >= 3 && seen.every(h => JSON.stringify(h) === JSON.stringify(["Bearer t0k", "seat-1", "v1"])), JSON.stringify(seen));
  } finally {
    await client.close();
    server.close();
  }
});

const meta = (extra = {}) => ({ kind: "codex", aiterm_session: "caller_fixture", launch_id: "a".repeat(32), hook_route: "shared_codex_home", node_platform: process.platform,
  created_at: "2026-11-10T00:00:00Z", agent_role: "subagent", parent_session_id: "host-root", delegation_depth: 1, lineage: "host-root>x", delegation_allowed: true,
  codex_home: tmp, ...extra });

test("argv: the caller text joins the one developer_instructions value after Aiterm's marker; one -c per MCP server; resume keeps both", () => {
  const prompt = path.join(tmp, "prompt.md"), mcp = path.join(tmp, "mcp.json");
  fs.writeFileSync(prompt, "CALLER_RULE: it's \"quoted\"\nsecond line");
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { bellteam } }));
  const m = meta({ codex_caller_prompt_file: prompt, codex_caller_mcp_file: mcp });
  const argv = codex.codexAgentArgv("codex", null, null, "first prompt", m);
  const values = key => argv.flatMap((arg, i) => argv[i - 1] === "-c" && arg.startsWith(key) ? [arg] : []);
  assert.equal(values("developer_instructions=").length, 1, "a second -c of the key would replace Aiterm's marker");
  const [instructions] = values("developer_instructions=");
  assert.ok(instructions.startsWith("developer_instructions=<aiterm_subagent_context>\n"), "the marker block is first");
  assert.ok(instructions.includes(`AITERM_AGENT_LAUNCH_ID=${m.launch_id}`));
  assert.ok(instructions.indexOf("</aiterm_subagent_context>") < instructions.indexOf("CALLER_RULE"));
  assert.ok(instructions.endsWith("\n\nCALLER_RULE: it's \"quoted\"\nsecond line"));
  assert.equal(values("mcp_servers.").length, 1);
  assert.equal(argv.at(-1), "first prompt");
  const resumed = codex.codexResumeArgv("codex", null, null, { ...m, vendor_session_id: "11111111-2222-4333-8444-555555555555" }, tmp);
  assert.deepEqual([resumed.filter(a => a.startsWith("developer_instructions=")), resumed.filter(a => a.startsWith("mcp_servers."))], [[instructions], values("mcp_servers.")]);
  const plain = codex.codexAgentArgv("codex", null, null, null, meta());
  assert.ok(!plain.some(a => a.startsWith("mcp_servers.")));
  assert.ok(plain.find(a => a.startsWith("developer_instructions=")).endsWith("</aiterm_subagent_context>"), "without caller text the value is Aiterm's block alone");
});

test("buildCodexAgentCmd: the typed line carries every -c value as one shell word", { skip: process.platform === "win32" }, () => {
  const prompt = path.join(tmp, "prompt2.md"), mcp = path.join(tmp, "mcp2.json");
  fs.writeFileSync(prompt, "it's $HOME `x` \"q\"");
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { bellteam } }));
  const printer = path.join(tmp, "print-argv.sh");
  fs.writeFileSync(printer, '#!/bin/sh\nfor a do printf "%s\\0" "$a"; done\n', { mode: 0o700 });
  const m = meta({ codex_caller_prompt_file: prompt, codex_caller_mcp_file: mcp });
  const line = codex.buildCodexAgentCmd(printer, "gpt-x", "high", "do $it", m);
  const out = spawnSync("sh", ["-c", line], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/h" } }).stdout.split("\0").slice(0, -1);
  assert.deepEqual(out, codex.codexAgentArgv(printer, "gpt-x", "high", "do $it", m).slice(1));
});

test("caller files: written 0600 in Aiterm state, never in the Codex home", () => {
  const home = path.join(tmp, "empty-home");
  fs.mkdirSync(home);
  {
    const m = meta({ codex_home: home });
    codex.writeCodexCallerFiles(m, "rules", { mcpServers: { bellteam } });
    assert.equal(fs.readFileSync(m.codex_caller_prompt_file, "utf8"), "rules");
    assert.deepEqual(JSON.parse(fs.readFileSync(m.codex_caller_mcp_file, "utf8")), { mcpServers: { bellteam } });
    for (const file of [m.codex_caller_prompt_file, m.codex_caller_mcp_file]) {
      if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.ok(!file.startsWith(home), "not in the Codex home");
      fs.rmSync(file);
    }
    assert.throws(() => codex.writeCodexCallerFiles(meta({ codex_home: home }), null, { mcpServers: { s: { command: "x" } } }), /CODEX_MCP_CONFIG_UNSUPPORTED/);
  }
});

test("input refusal: AGENT_LAUNCH_NOT_STARTED with phase input for every harness; terminal projection keeps it", async () => {
  const error = launchInputRefusal("grok-cli", "x");
  assert.match(error.message, /^AGENT_LAUNCH_NOT_STARTED: x$/);
  assert.deepEqual(error.launchNotStarted, { harness: "grok-cli", phase: "input" });
  const meta = launchNotStartedMeta("grok-cli", "input")["aiterm/launch_error"];
  assert.deepEqual({ ...meta, action: typeof meta.action }, { schema: "aiterm.agent-launch-error.v1", harness: "grok-cli", code: "AGENT_LAUNCH_NOT_STARTED",
    phase: "input", effect: "not_started", session_created: false, action: "string" });
  assert.notEqual(meta.action, launchNotStartedMeta("grok-cli")["aiterm/launch_error"].action, "an input refusal does not claim a rolled-back creation");
  const result = { isError: true, content: [{ type: "text", text: "aiterm: AGENT_LAUNCH_NOT_STARTED: x" }], _meta: launchNotStartedMeta("codex-cli", "input") };
  assert.equal(withTerminalLaunchAction(result, "codex-cli"), result, "the server keeps the phase it already set");
  const fromTerminal = withTerminalLaunchAction({ isError: true, content: [{ type: "text", text: "aiterm: AGENT_LAUNCH_NOT_STARTED: y" }] }, "codex-cli");
  assert.deepEqual([fromTerminal._meta["aiterm/launch_error"].harness, fromTerminal._meta["aiterm/launch_error"].phase], ["codex-cli", "terminal"]);

  const { createAitermServer } = await import("../dist/index.js");
  const server = createAitermServer(), client = new Client({ name: "caller-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const launchError = result => result._meta?.["aiterm/launch_error"];
  const call = args => client.callTool({ name: "agent_launch", arguments: args });
  try {
    // grok-cli, cursor-cli and antigravity-cli take the fields since 0.70.9 (test/harness-caller-fields.test.mjs).
    // Codex: an inexpressible MCP shape is refused before any session exists, with the reason after the code.
    const codexRefused = await call({ harness: "codex-cli", cwd: tmp, mcp_config: { mcpServers: { s: { type: "stdio", command: "x" } } } });
    assert.match(codexRefused.content[0].text, /^aiterm: AGENT_LAUNCH_NOT_STARTED: CODEX_MCP_CONFIG_UNSUPPORTED: /);
    assert.deepEqual([launchError(codexRefused).harness, launchError(codexRefused).phase, launchError(codexRefused).effect], ["codex-cli", "input", "not_started"]);
    // write_scope on claude-code and a bad resume request are input refusals too.
    const scope = await client.callTool({ name: "agent_launch", arguments: { harness: "claude-code", write_scope: "read-only" } });
    assert.equal(launchError(scope)?.phase, "input");
    const resume = await call({ harness: "claude-code", require_existing_resume: true, prompt: "x" });
    assert.equal(launchError(resume)?.phase, "input");
  } finally {
    await client.close();
  }
});
