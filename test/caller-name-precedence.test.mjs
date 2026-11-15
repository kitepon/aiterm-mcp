import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// launch-identity-input.md "Caller name precedence": a caller server never replaces a same-name server of the seat's own
// harness config unless its entry says replace: true; dropped and replaced names reach the metadata (and the receipt).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { applyCallerPrecedence, withoutReplaceKeys, jsonMcpServerNames, tomlMcpServerNames, parseCallerMcp } = await import("../dist/harnesses/caller-mcp.js");
const { claudeOwnMcpNames, writeClaudeCallerFiles } = await import("../dist/harnesses/claude.js");
const { codexMcpOverrides } = await import("../dist/harnesses/codex.js");
const cursor = await import("../dist/harnesses/cursor.js");
const { writeAgentMetadata } = await import("../dist/agent-shared.js");
const { loadAgentMetadata } = await import("../dist/agent-metadata-reader.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "caller-precedence-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const http = url => ({ type: "http", url });

test("own names win; replace: true replaces; the rest is added", () => {
  const mcp = { mcpServers: {
    bellteam: { ...http("http://127.0.0.1:1/api/seat-mcp"), replace: true },
    "call-bridge": { ...http("http://127.0.0.1:1/api/seat-mcp/call-bridge"), replace: true },
    "approval-box": http("http://127.0.0.1:1/approval"),
    stripe: { ...http("http://127.0.0.1:1/stripe"), replace: false },
    extra: http("http://127.0.0.1:1/extra"),
  } };
  const { config, precedence } = applyCallerPrecedence(mcp, new Set(["call-bridge", "approval-box", "stripe", "aishell"]));
  assert.deepEqual(Object.keys(config.mcpServers), ["bellteam", "call-bridge", "extra"]);
  assert.deepEqual(precedence, { dropped: ["approval-box", "stripe"], replaced: ["call-bridge"] });
  assert.equal(Object.keys(mcp.mcpServers).length, 5, "the caller's object is not changed");
  assert.throws(() => applyCallerPrecedence({ mcpServers: { a: { ...http("http://x"), replace: "yes" } } }, new Set()), /replace must be true or false/);
  assert.deepEqual(withoutReplaceKeys(config).mcpServers.bellteam, http("http://127.0.0.1:1/api/seat-mcp"));
});

test("every harness shape takes replace as a boolean only", () => {
  const ok = { mcpServers: { a: { ...http("http://127.0.0.1:1/a"), replace: true } } };
  assert.equal(parseCallerMcp(ok, "GROK")[0].replace, true);
  assert.equal(parseCallerMcp({ mcpServers: { a: http("http://127.0.0.1:1/a") } }, "GROK")[0].replace, false);
  assert.throws(() => parseCallerMcp({ mcpServers: { a: { ...http("http://x"), replace: 1 } } }, "CURSOR"), /replace must be true or false/);
  assert.deepEqual(codexMcpOverrides(ok), ['mcp_servers.a={url="http://127.0.0.1:1/a"}']);
  assert.throws(() => codexMcpOverrides({ mcpServers: { a: { ...http("http://x"), replace: "y" } } }), /replace must be true or false/);
});

test("Claude own names: user and local scope of the seat's global config, project .mcp.json", () => {
  const home = path.join(tmp, "home"), cwd = path.join(tmp, "project"), root = path.join(tmp, "root");
  fs.mkdirSync(home); fs.mkdirSync(cwd); fs.mkdirSync(root);
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "call-bridge": {} },
    projects: { [fs.realpathSync(cwd)]: { mcpServers: { stripe: {} } }, "/elsewhere": { mcpServers: { other: {} } } } }));
  fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { "approval-box": {} } }));
  fs.writeFileSync(path.join(root, ".claude.json"), JSON.stringify({ mcpServers: { rooted: {} } }));
  assert.deepEqual([...claudeOwnMcpNames({ HOME: home }, cwd)].sort(), ["approval-box", "call-bridge", "stripe"]);
  assert.deepEqual([...claudeOwnMcpNames({ HOME: home, CLAUDE_CONFIG_DIR: root }, cwd)].sort(), ["approval-box", "rooted"]);
  assert.deepEqual([...claudeOwnMcpNames({ HOME: path.join(tmp, "none") }, path.join(tmp, "none"))], [], "nothing to read = no own names");
  fs.writeFileSync(path.join(root, ".claude.json"), "{broken");
  assert.deepEqual(jsonMcpServerNames(path.join(root, ".claude.json")), []);
});

test("config.toml own names (Codex, Grok)", () => {
  const file = path.join(tmp, "config.toml");
  fs.writeFileSync(file, '[mcp_servers.bellteam]\nurl = "x"\n[mcp_servers."call-bridge"] # c\ncommand = "y"\n[mcp_servers.aiterm.env]\nA = "1"\n[models]\n');
  assert.deepEqual(tomlMcpServerNames(file), ["bellteam", "call-bridge"]);
  assert.deepEqual(tomlMcpServerNames(path.join(tmp, "missing.toml")), []);
});

test("Claude caller file drops the replace key; caller_mcp survives the metadata reader", () => {
  const meta = { aiterm_session: "precedence_claude" };
  try {
    writeClaudeCallerFiles(meta, null, { mcpServers: { a: { ...http("http://127.0.0.1:1/a"), replace: true } } });
    assert.deepEqual(JSON.parse(fs.readFileSync(meta.claude_caller_mcp_file, "utf8")), { mcpServers: { a: http("http://127.0.0.1:1/a") } });
  } finally { if (meta.claude_caller_mcp_file) fs.rmSync(meta.claude_caller_mcp_file, { force: true }); }
  const name = "precedence_cursor";
  const m = cursor.createCursorAgentMetadata(name, tmp, "none", undefined,
    { agentRole: "subagent", parentSessionId: "host-root", delegationDepth: 1, lineage: `host-root>x:${name}`, delegationAllowed: true });
  m.caller_mcp = { dropped: ["approval-box"], replaced: ["call-bridge"] };
  writeAgentMetadata(m);
  assert.deepEqual(loadAgentMetadata(name).caller_mcp, { dropped: ["approval-box"], replaced: ["call-bridge"] });
});

test("agent_launch: a replace that is not a boolean is an input refusal for every harness, before any seat", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createAitermServer } = await import("../dist/index.js");
  const server = createAitermServer(), client = new Client({ name: "caller-precedence-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const bad = { mcpServers: { s: { url: "http://127.0.0.1:1/m", replace: "yes" } } };
    for (const harness of ["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"]) {
      const refused = await client.callTool({ name: "agent_launch", arguments: { harness, cwd: tmp, mcp_config: bad } });
      assert.equal(refused.isError, true, harness);
      assert.match(refused.content[0].text, /AGENT_LAUNCH_NOT_STARTED: .*replace must be true or false/, harness);
      assert.deepEqual([refused._meta["aiterm/launch_error"].phase, refused._meta["aiterm/launch_error"].session_created], ["input", false], harness);
    }
  } finally { await client.close(); }
});
