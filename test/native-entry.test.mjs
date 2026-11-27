// 0.70.109 (a532b2 stage 5): the generic names of the parent's native entry and of the hook items, beside the old ones.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = await import("../dist/native-entry.js");
const { nativeHookEntries } = await import("../dist/native-setup.js");

const base = ["--state-root", "/synthetic/state", "--socket", "/synthetic/socket", "--steer-provider", "/synthetic/provider.mjs"];

test("the generic entry takes the old argument list without --execution-interrupt, and ignores that flag when it is given", () => {
  const plain = entry.parseNativeEntryArguments(base);
  assert.deepEqual(plain, { mode: "mcp", codexHome: undefined, hookDirectory: undefined, expectedScope: { state_root: "/synthetic/state", multiplexer: { kind: "socket", key: "/synthetic/socket" } }, providerFile: "/synthetic/provider.mjs" });
  assert.deepEqual(entry.parseNativeEntryArguments(["--execution-interrupt", ...base]), plain, "the old flag is accepted and ignored");
  for (const bad of [[], base.slice(2), base.slice(0, -2), base.map(value => value === "/synthetic/state" ? "relative" : value), [...base, "--mode", "unknown"], [...base, "--unknown"]])
    assert.throws(() => entry.parseNativeEntryArguments(bad));
});

test("localScope() names a state root and a multiplexer", () => {
  const scope = entry.localScope();
  assert.ok(["socket", "namespace"].includes(scope.multiplexer.kind) && scope.multiplexer.key && scope.state_root);
});

test("hook-entries: aiterm.hook-entries.v1 owns native-entry.js and no longer the old entry name", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-entry-"));
  try {
    const home = join(dir, "home"); mkdirSync(home);
    const provider = fileURLToPath(new URL("../node_modules/aiterm-steer-delivery/dist/index.js", import.meta.url));
    const options = { stateRoot: join(dir, "state"), socket: join(dir, "sock"), providerFile: provider, clients: ["claude", "cursor"] };
    mkdirSync(options.stateRoot);
    const generic = await nativeHookEntries(home, options);
    assert.equal(generic.schema, "aiterm.hook-entries.v1");
    assert.ok(generic.owns.commandIncludes.includes("native-entry.js") && !generic.owns.commandIncludes.includes("execution-native-server.js"));
    assert.ok(generic.hooks && typeof generic.hooks === "object");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("aiterm-setup hook-entries refuses missing flags with one line on stderr and nothing on stdout (exit 2)", () => {
  const cli = fileURLToPath(new URL("../dist/setup-cli.js", import.meta.url));
  const run = spawnSync(process.execPath, [cli, "hook-entries", "--json"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /--json --home --state-root --socket --steer-provider/);
  const usage = spawnSync(process.execPath, [cli, "hook-entries", "--nope"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /aiterm-setup hook-entries --json/);
});

test("the generic entry file serves the delivery MCP over stdio: agent_stop, no execution tools", { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "native-entry-stdio-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", new URL("./seat-env.mjs", import.meta.url).href, fileURLToPath(new URL("../dist/native-entry.js", import.meta.url)), ...base.map(v => v.replace("/synthetic", dir))],
    env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)), stderr: "pipe" });
  const client = new Client({ name: "native-entry-test", version: "1" });
  t.after(async () => { await client.close().catch(() => {}); });
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes("agent_stop") && names.includes("agent_launch"));
  assert.ok(!names.some(name => name.startsWith("agent_execution")));
});
