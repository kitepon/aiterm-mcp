import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const grok = await import("../dist/harnesses/grok.js");
const cursor = await import("../dist/harnesses/cursor.js");
const agy = await import("../dist/harnesses/antigravity.js");
const core = await import("../dist/core.js");
const { parseCallerMcp, assertCallerEnv } = await import("../dist/harnesses/caller-mcp.js");
const { agentsDir } = await import("../dist/agent-shared.js");
const { writeAgentMetadata } = await import("../dist/agent-shared.js");
const { loadAgentMetadata } = await import("../dist/agent-metadata-reader.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-caller-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const bellteam = { type: "http", url: "http://127.0.0.1:4181/mcp", headers: {
  Authorization: "Bearer ${BELLTEAM_MCP_TOKEN}", "X-Bellteam-Seat": "${AITERM_SESSION_ID}", "X-Bellteam-Launch-Id": "${AITERM_AGENT_LAUNCH_ID}", "X-Fixed": "v1" } };
const callBridge = { type: "http", url: "http://127.0.0.1:4181/call-bridge" };
const mcp = { mcpServers: { bellteam, "call-bridge": callBridge } };
const seatEnv = { BELLTEAM_MCP_TOKEN: "tok-secret", AITERM_SESSION_ID: "caller_fixture", AITERM_AGENT_LAUNCH_ID: "a".repeat(32) };
const valueOf = name => seatEnv[name];

const meta = (kind, extra = {}) => ({ kind, aiterm_session: "caller_fixture", launch_id: "a".repeat(32), hook_route: `shared_${kind}_home`, node_platform: process.platform,
  created_at: "2026-11-11T00:00:00Z", agent_role: "subagent", parent_session_id: "host-root", delegation_depth: 1, lineage: "host-root>x", delegation_allowed: true,
  cwd: tmp, vendor_session_id: kind === "grok" ? "11111111-2222-4333-8444-555555555555" : null, ...extra });
const mode = file => fs.statSync(file).mode & 0o777;
const files = [];
const keep = (...paths) => { files.push(...paths); };
test.after(() => { for (const f of files) fs.rmSync(f, { recursive: true, force: true }); });

test("parseCallerMcp: Bearer / whole ${NAME} / literal, and everything else is refused", () => {
  assert.deepEqual(parseCallerMcp(mcp, "GROK").map(s => [s.name, s.headers.map(h => `${h.name}:${h.kind}:${h.value}`)]), [
    ["bellteam", ["Authorization:bearer:BELLTEAM_MCP_TOKEN", "X-Bellteam-Seat:env:AITERM_SESSION_ID", "X-Bellteam-Launch-Id:env:AITERM_AGENT_LAUNCH_ID", "X-Fixed:literal:v1"]],
    ["call-bridge", []]]);
  const server = extra => ({ mcpServers: { s: { url: "http://127.0.0.1:1/m", ...extra } } });
  for (const bad of [
    server({ type: "sse" }), server({ type: "stdio" }), { mcpServers: { s: { command: "x" } } }, server({ command: "x" }), server({ url: "ftp://x" }), server({ url: "nope" }),
    server({ headers: { Authorization: "Bearer ${A} extra" } }), server({ headers: { "X-A": "pre-${A}" } }), server({ headers: { "X-A": "${A}${B}" } }),
    server({ headers: { "X-A": "${a-b}" } }), server({ headers: { "X-A": "${}" } }), server({ headers: { "X A": "v" } }), server({ headers: { "X-A": 1 } }),
    server({ headers: { authorization: "Bearer ${A}", Authorization: "${B}" } }), server({ headers: [] }),
    { mcpServers: { "bad name": { url: "http://127.0.0.1:1/m" } } }, { mcpServers: {}, extra: 1 }, { mcpServers: [] }, {}, null,
  ]) assert.throws(() => parseCallerMcp(bad, "CURSOR"), /^Error: CURSOR_MCP_CONFIG_UNSUPPORTED: /, JSON.stringify(bad));
  const servers = parseCallerMcp(mcp, "GROK");
  assert.doesNotThrow(() => assertCallerEnv("GROK", servers, valueOf));
  assert.throws(() => assertCallerEnv("GROK", servers, name => name === "BELLTEAM_MCP_TOKEN" ? undefined : valueOf(name)), /^Error: GROK_MCP_ENV_UNAVAILABLE: .*BELLTEAM_MCP_TOKEN/);
  // before a seat exists only the names every seat has are known without a value
  assert.throws(() => assertCallerEnv("GROK", servers, () => undefined, true), /BELLTEAM_MCP_TOKEN/);
  assert.doesNotThrow(() => assertCallerEnv("GROK", servers, name => name === "BELLTEAM_MCP_TOKEN" ? "x" : undefined, true));
});

test("grok: caller text joins the one --rules after Aiterm's text; --agent carries a mcpServers LIST; secrets only in the 0600 file", () => {
  const m = meta("grok", { aiterm_session: "caller_grok" });
  grok.writeGrokCallerFiles(m, "CALLER_RULE: it's \"quoted\"\nsecond line", mcp, valueOf);
  keep(m.grok_caller_prompt_file, m.grok_caller_mcp_file);
  for (const file of [m.grok_caller_prompt_file, m.grok_caller_mcp_file]) {
    if (process.platform !== "win32") assert.equal(mode(file), 0o600);
    assert.ok(file.startsWith(agentsDir()), "Aiterm state, never ~/.grok or the project");
  }
  const definition = fs.readFileSync(m.grok_caller_mcp_file, "utf8");
  const [, front, body] = /^---\n([\s\S]*)\n---\n([\s\S]*)$/.exec(definition);
  assert.equal(body, "", "an empty body leaves the default agent's prompt and tools");
  assert.match(front, /^name: aiterm-caller\ndescription: .+\nmcpServers: \[/);
  const entries = JSON.parse(front.slice(front.indexOf("mcpServers: ") + "mcpServers: ".length));
  assert.ok(Array.isArray(entries), "a map keyed by name would silently drop the whole file");
  assert.deepEqual(entries, [
    { name: "bellteam", type: "http", url: "http://127.0.0.1:4181/mcp", bearer_token_env_var: "BELLTEAM_MCP_TOKEN",
      headers: { "X-Bellteam-Seat": "caller_fixture", "X-Bellteam-Launch-Id": "a".repeat(32), "X-Fixed": "v1" } },
    { name: "call-bridge", type: "http", url: "http://127.0.0.1:4181/call-bridge" }]);
  assert.ok(!definition.includes("tok-secret"), "a Bearer ${NAME} stays an env name; grok reads the seat env");

  const argv = grok.grokAgentArgv("grok", "grok", null, null, null, m);
  const rules = argv.flatMap((arg, i) => argv[i - 1] === "--rules" ? [arg] : []);
  assert.equal(rules.length, 1, "one --rules");
  assert.ok(rules[0].includes("AITERM_AGENT_LAUNCH_ID") && rules[0].indexOf("CALLER_RULE") > rules[0].indexOf("AITERM_AGENT_LAUNCH_ID"), "Aiterm's text first");
  assert.ok(rules[0].endsWith("\n\nCALLER_RULE: it's \"quoted\"\nsecond line"));
  assert.equal(argv[argv.indexOf("--agent") + 1], m.grok_caller_mcp_file);
  assert.ok(!argv.some(a => a.includes("tok-secret")), "no secret value in argv");

  const plain = grok.grokAgentArgv("grok", "grok", null, null, null, meta("grok"));
  assert.ok(!plain.includes("--agent"));
  assert.ok(plain.find((_, i) => plain[i - 1] === "--rules").endsWith("</aiterm_subagent_context>") || !plain.find((_, i) => plain[i - 1] === "--rules").includes("CALLER_RULE"));
});

test("grok: buildGrokAgentCmd types every value as one shell word", { skip: process.platform === "win32" }, () => {
  const m = meta("grok", { aiterm_session: "caller_grok2" });
  grok.writeGrokCallerFiles(m, "it's $HOME `x` \"q\"", mcp, valueOf);
  keep(m.grok_caller_prompt_file, m.grok_caller_mcp_file);
  const printer = path.join(tmp, "print-argv.sh");
  fs.writeFileSync(printer, '#!/bin/sh\nfor a do printf "%s\\0" "$a"; done\n', { mode: 0o700 });
  const line = grok.buildGrokAgentCmd("grok", printer, "m", null, null, m);
  const out = spawnSync("sh", ["-c", line], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/h" } }).stdout.split("\0").slice(0, -1);
  assert.deepEqual(out, grok.grokAgentArgv("grok", printer, "m", null, null, m).slice(1));
});

test("grok: a missing ${NAME}, an inexpressible server and a bad text are refused before anything is written", () => {
  const m = meta("grok", { aiterm_session: "caller_grok3" });
  assert.throws(() => grok.writeGrokCallerFiles(m, null, mcp, name => name === "BELLTEAM_MCP_TOKEN" ? undefined : valueOf(name)), /GROK_MCP_ENV_UNAVAILABLE/);
  assert.throws(() => grok.writeGrokCallerFiles(m, null, { mcpServers: { s: { type: "stdio", command: "x" } } }, valueOf), /GROK_MCP_CONFIG_UNSUPPORTED/);
  assert.throws(() => grok.writeGrokCallerFiles(m, "  ", null, valueOf), /non-empty/);
  assert.throws(() => grok.writeGrokCallerFiles(m, "x".repeat(64 * 1024 + 1), null, valueOf), /64 KiB/);
  assert.equal(m.grok_caller_prompt_file, undefined);
  assert.equal(m.grok_caller_mcp_file, undefined);
});

test("cursor: the text joins Aiterm's first-prompt block (also a promptless seat's first dispatch); the plugin folder holds ${env:NAME} references only", () => {
  const m = meta("cursor", { aiterm_session: "caller_cursor" });
  cursor.writeCursorCallerFiles(m, "CALLER_RULE", mcp, valueOf);
  keep(m.cursor_caller_prompt_file, path.dirname(m.cursor_caller_mcp_dir));
  assert.equal(path.basename(m.cursor_caller_mcp_dir), "aiterm-caller");
  assert.equal(path.basename(path.dirname(m.cursor_caller_mcp_dir)), "caller_cursor.cursor-plugin", "cleanupAgentState removes the folder with the seat");
  const manifest = path.join(m.cursor_caller_mcp_dir, ".cursor-plugin", "plugin.json"), mcpFile = path.join(m.cursor_caller_mcp_dir, "mcp.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest, "utf8")), { name: "aiterm-caller", version: "1.0.0", description: "MCP servers Aiterm adds for this seat" });
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpFile, "utf8")), { mcpServers: {
    bellteam: { url: "http://127.0.0.1:4181/mcp", headers: { Authorization: "Bearer ${env:BELLTEAM_MCP_TOKEN}", "X-Bellteam-Seat": "${env:AITERM_SESSION_ID}",
      "X-Bellteam-Launch-Id": "${env:AITERM_AGENT_LAUNCH_ID}", "X-Fixed": "v1" } },
    "call-bridge": { url: "http://127.0.0.1:4181/call-bridge" } } });
  assert.ok(!fs.readFileSync(mcpFile, "utf8").includes("tok-secret"));
  if (process.platform !== "win32") {
    for (const file of [m.cursor_caller_prompt_file, manifest, mcpFile]) assert.equal(mode(file), 0o600, file);
    assert.equal(mode(m.cursor_caller_mcp_dir), 0o700);
  }
  const argv = cursor.cursorAgentArgv("cursor-agent", null, null, "do it", m);
  assert.deepEqual(argv.slice(argv.indexOf("--trust") + 1, argv.indexOf("--trust") + 3), ["--plugin-dir", m.cursor_caller_mcp_dir]);
  assert.ok(argv.includes("--force") && argv.includes("--approve-mcps"));
  const prompt = argv.at(-1);
  assert.ok(prompt.startsWith("<aiterm_subagent_context>"));
  assert.ok(prompt.indexOf("</aiterm_subagent_context>") < prompt.indexOf("CALLER_RULE") && prompt.indexOf("CALLER_RULE") < prompt.indexOf("do it"));
  assert.equal(prompt, cursor.cursorPromptWithLineage(m, "do it"));
  assert.ok(cursor.cursorLineagePreface(m).endsWith("\n\nCALLER_RULE"));
  const plain = meta("cursor");
  assert.ok(!cursor.cursorAgentArgv("cursor-agent", null, null, "do it", plain).includes("--plugin-dir"));
  assert.ok(!cursor.cursorPromptWithLineage(plain, "do it").includes("CALLER_RULE"));
  if (process.platform !== "win32") {
    const printer = path.join(tmp, "print-argv-cursor.sh");
    fs.writeFileSync(printer, '#!/bin/sh\nfor a do printf "%s\\0" "$a"; done\n', { mode: 0o700 });
    const line = cursor.buildCursorAgentCmd(printer, null, null, "do $it", m);
    const out = spawnSync("sh", ["-c", line], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/h" } }).stdout.split("\0").slice(0, -1);
    assert.deepEqual(out, cursor.cursorAgentArgv(printer, null, null, "do $it", m).slice(1));
  }
});

test("antigravity: mcp_config.json holds resolved values (0600) in a seat folder passed as --add-dir; --settings trusts the cwd and that folder; the text is an always-on rule there", () => {
  const m = meta("antigravity", { aiterm_session: "caller_agy" });
  agy.writeAntigravityCallerFiles(m, "CALLER_RULE", mcp, valueOf);
  keep(m.antigravity_caller_mcp_dir);
  assert.equal(path.basename(m.antigravity_caller_mcp_dir), "caller_agy.antigravity-caller");
  const file = path.join(m.antigravity_caller_mcp_dir, ".agents", "mcp_config.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { mcpServers: {
    bellteam: { serverUrl: "http://127.0.0.1:4181/mcp", headers: { Authorization: "Bearer tok-secret", "X-Bellteam-Seat": "caller_fixture",
      "X-Bellteam-Launch-Id": "a".repeat(32), "X-Fixed": "v1" } },
    "call-bridge": { serverUrl: "http://127.0.0.1:4181/call-bridge" } } });
  // agy 1.5.8 skips a rule without the trigger frontmatter (lab 2026-11-14).
  const rule = path.join(m.antigravity_caller_mcp_dir, ".agents", "rules", "aiterm.md");
  assert.equal(fs.readFileSync(rule, "utf8"), "---\ntrigger: always_on\n---\n\nCALLER_RULE");
  if (process.platform !== "win32") {
    assert.equal(mode(file), 0o600);
    assert.equal(mode(rule), 0o600);
    assert.equal(mode(m.antigravity_caller_mcp_dir), 0o700);
  }
  const argv = agy.antigravityAgentArgv("agy", "mdl", null, "do it", m);
  const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]);
  assert.deepEqual(settings, { queuedMessages: "send-immediately", trustedWorkspaces: [...new Set([tmp, fs.realpathSync(tmp), m.antigravity_caller_mcp_dir])] });
  assert.equal(argv[argv.indexOf("--add-dir") + 1], m.antigravity_caller_mcp_dir);
  assert.equal(argv.at(-1), "do it", "the prompt is sent as given");
  // without caller fields nothing changes
  assert.deepEqual(agy.antigravityAgentArgv("agy", null, null, null), ["agy", "--dangerously-skip-permissions", "--settings", '{"queuedMessages":"send-immediately"}']);
  assert.deepEqual(agy.antigravityAgentArgv("agy", null, null, "p", meta("antigravity")), ["agy", "--dangerously-skip-permissions", "--settings", '{"queuedMessages":"send-immediately"}', "--prompt-interactive", "p"]);
  assert.equal(core.firstDispatchText(m, "work"), "work", "a promptless seat's first input is sent as given: the rule is already loaded");
  // Instructions only: the folder holds the rule and no server file.
  const only = meta("antigravity", { aiterm_session: "caller_agy3" });
  agy.writeAntigravityCallerFiles(only, "ONLY_RULE", null, valueOf);
  keep(only.antigravity_caller_mcp_dir);
  assert.ok(fs.existsSync(path.join(only.antigravity_caller_mcp_dir, ".agents", "rules", "aiterm.md")));
  assert.ok(!fs.existsSync(path.join(only.antigravity_caller_mcp_dir, ".agents", "mcp_config.json")));
  assert.equal(agy.antigravityAgentArgv("agy", null, null, null, only).includes("--add-dir"), true);
  assert.throws(() => agy.writeAntigravityCallerFiles(meta("antigravity", { aiterm_session: "caller_agy2" }), null, mcp, name => name === "X-none" ? "" : undefined), /ANTIGRAVITY_MCP_ENV_UNAVAILABLE/);
});

test("metadata keeps the caller files across a reload, and closing the seat removes every one of them", async t => {
  const { createAitermServer } = await import("../dist/index.js");
  const server = createAitermServer(), client = new Client({ name: "harness-caller-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const lineage = name => ({ agentRole: "subagent", parentSessionId: "host-root", delegationDepth: 1, lineage: `host-root>x:${name}`, delegationAllowed: true });
  const authFile = path.join(tmp, "grok-auth.json");
  fs.writeFileSync(authFile, "{}");
  process.env.GROK_AUTH_PATH = authFile; // the reader checks the recorded auth path against the current one
  t.after(() => { delete process.env.GROK_AUTH_PATH; });
  const make = {
    grok: name => grok.createGrokAgentMetadata("grok", name, tmp, "none", authFile, undefined, lineage(name)),
    cursor: name => cursor.createCursorAgentMetadata(name, tmp, "none", undefined, lineage(name)),
    antigravity: name => agy.createAntigravityAgentMetadata(name, tmp, "none", undefined, lineage(name)),
  };
  const write = { grok: grok.writeGrokCallerFiles, cursor: cursor.writeCursorCallerFiles, antigravity: agy.writeAntigravityCallerFiles };
  const fields = { grok: ["grok_caller_prompt_file", "grok_caller_mcp_file"], cursor: ["cursor_caller_prompt_file", "cursor_caller_mcp_dir"],
    antigravity: ["antigravity_caller_mcp_dir"] };
  try {
    for (const kind of Object.keys(make)) {
      const name = `callerclean_${kind}`;
      const opened = await client.callTool({ name: "pty_open", arguments: { name, shell: "/bin/sh" } });
      assert.ok(!opened.isError, JSON.stringify(opened));
      const m = make[kind](name);
      write[kind](m, "text", mcp, valueOf);
      writeAgentMetadata(m);
      const loaded = loadAgentMetadata(name);
      const paths = fields[kind].map(field => { assert.equal(loaded[field], m[field], `${kind} ${field} survives the reader`); return m[field]; });
      for (const item of paths) assert.ok(fs.existsSync(item), item);
      const closed = await client.callTool({ name: "pty_close", arguments: { session_id: name } });
      assert.ok(!closed.isError, JSON.stringify(closed));
      for (const item of paths) assert.ok(!fs.existsSync(item), `${item} left behind`);
      assert.deepEqual(fs.readdirSync(agentsDir()).filter(file => file.startsWith(`${name}.`)), [], `${kind}: nothing of the seat is left`);
    }
  } finally {
    await client.close();
  }
});

test("agent_launch: every harness takes the fields; an inexpressible shape and a missing ${NAME} are input refusals before any seat", async () => {
  const { createAitermServer } = await import("../dist/index.js");
  const server = createAitermServer(), client = new Client({ name: "harness-caller-test2", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const launchError = result => result._meta?.["aiterm/launch_error"];
  const call = args => client.callTool({ name: "agent_launch", arguments: args });
  try {
    const stdio = { mcpServers: { s: { type: "stdio", command: "x" } } };
    const needsEnv = { mcpServers: { s: { url: "http://127.0.0.1:1/m", headers: { Authorization: "Bearer ${HARNESS_CALLER_UNSET_TOKEN}" } } } };
    for (const [harness, label] of [["grok-cli", "GROK"], ["cursor-cli", "CURSOR"], ["antigravity-cli", "ANTIGRAVITY"]]) {
      const refused = await call({ harness, cwd: tmp, mcp_config: stdio });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, new RegExp(`^aiterm: AGENT_LAUNCH_NOT_STARTED: ${label}_MCP_CONFIG_UNSUPPORTED: `));
      assert.deepEqual([launchError(refused).harness, launchError(refused).phase, launchError(refused).effect, launchError(refused).session_created], [harness, "input", "not_started", false]);
      const noEnv = await call({ harness, cwd: tmp, mcp_config: needsEnv });
      assert.match(noEnv.content[0].text, new RegExp(`^aiterm: AGENT_LAUNCH_NOT_STARTED: ${label}_MCP_ENV_UNAVAILABLE: .*HARNESS_CALLER_UNSET_TOKEN`));
      assert.equal(launchError(noEnv).phase, "input");
      const big = await call({ harness, cwd: tmp, append_system_prompt: "x".repeat(64 * 1024 + 1), prompt: "p" });
      assert.match(big.content[0].text, /AGENT_LAUNCH_NOT_STARTED: append_system_prompt must be non-empty and at most 64 KiB/);
    }
    // the old blanket refusal is gone
    for (const harness of ["grok-cli", "cursor-cli", "antigravity-cli"]) {
      const result = await call({ harness, cwd: tmp, mcp_config: stdio });
      assert.ok(!/claude-code and codex-cli only/.test(result.content[0].text));
    }
  } finally {
    await client.close();
  }
});
