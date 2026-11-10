import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

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

test("checkCodexCallerInput: size, and a same-name user stdio server is refused while an http one is overridden", () => {
  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.toml"), [
    "[mcp_servers.aiterm]", 'command = "/x"', "[mcp_servers.aiterm.env]", 'A = "b"', "",
    "[mcp_servers.bellteam]", 'url = "http://127.0.0.1:4181/mcp"', 'env_http_headers = { "X-Bellteam-Seat" = "AITERM_SESSION_ID" }', "",
    '[mcp_servers."quoted-stdio"]', "command = 'y'", ""].join("\n"));
  const mcp = servers => ({ mcpServers: Object.fromEntries(servers.map(name => [name, { url: "http://127.0.0.1:1/m" }])) });
  assert.doesNotThrow(() => codex.checkCodexCallerInput("rules", mcp(["bellteam", "other"]), home));
  assert.throws(() => codex.checkCodexCallerInput(null, mcp(["bellteam", "aiterm"]), home), /^Error: CODEX_MCP_SERVER_CONFLICT: .*'aiterm'/);
  assert.throws(() => codex.checkCodexCallerInput(null, mcp(["quoted-stdio"]), home), /CODEX_MCP_SERVER_CONFLICT/);
  assert.doesNotThrow(() => codex.checkCodexCallerInput(null, mcp(["aiterm"]), path.join(tmp, "no-such-home")), "no user config, nothing to conflict with");
  assert.throws(() => codex.checkCodexCallerInput("  ", null, home), /non-empty/);
  assert.throws(() => codex.checkCodexCallerInput("x".repeat(64 * 1024 + 1), null, home), /64 KiB/);
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
    for (const harness of ["grok-cli", "cursor-cli", "antigravity-cli"]) {
      for (const field of [{ append_system_prompt: "x" }, { mcp_config: { mcpServers: {} } }]) {
        const refused = await call({ harness, ...field });
        assert.equal(refused.isError, true);
        assert.match(refused.content[0].text, /^aiterm: AGENT_LAUNCH_NOT_STARTED: append_system_prompt and mcp_config are claude-code and codex-cli only/);
        assert.deepEqual({ ...launchError(refused), action: 0 }, { schema: "aiterm.agent-launch-error.v1", harness, code: "AGENT_LAUNCH_NOT_STARTED",
          phase: "input", effect: "not_started", session_created: false, action: 0 });
        assert.equal(refused._meta["aiterm/error_code"] === undefined, true, "the local call carries only the launch error meta");
      }
    }
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
