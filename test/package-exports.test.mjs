import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// bellteam-boundary.md "公開の入口": what a consumer may import by name, and nothing else (bd04, 2026-11-14).
const PROMISED = {
  "aiterm-mcp/setup-node": ["mcpRegistration", "setupNodeExecutable"],
  "aiterm-mcp/setup-integrations": ["mergeClaudeParentHooks", "mergeCursorParentHooks", "ensureCodexParentSteer"],
  "aiterm-mcp/execution-parent-worker": ["localParentWorkerRuntime"],
  "aiterm-mcp/execution-native-server": ["parseNativeExecutionArguments"],
  "aiterm-mcp/child-result": ["CHILD_RESULT_PREFACE", "answerMessage"],
};

test("each public entry point imports by name and carries its promised functions", async () => {
  for (const [entry, names] of Object.entries(PROMISED)) {
    const module = await import(entry);
    for (const name of names) assert.ok(name in module, `${entry} exports ${name}`);
  }
  const compat = JSON.parse(fs.readFileSync(fileURLToPath(import.meta.resolve("aiterm-mcp/state-compat.json")), "utf8"));
  assert.equal(compat.schema, "aiterm.state-compat.v1");
  assert.equal((await import("aiterm-mcp/package.json", { with: { type: "json" } })).default.name, "aiterm-mcp");
});

// Kiro 2026-11-14: BellTeam reads the selected root's package.json exports itself, so the map is the promise.
test("the exports map: every value is a string target inside the package root, and the file exists", () => {
  const root = path.resolve(".");
  const { exports } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const [entry, target] of Object.entries(exports)) {
    assert.equal(typeof target, "string", entry);
    assert.match(target, /^\.\//u, entry);
    const file = path.resolve(root, target);
    assert.ok(file.startsWith(root + path.sep), `${entry} stays inside the root`);
    assert.ok(fs.existsSync(file), `${entry} -> ${target}`);
  }
  assert.equal(exports["./resume-state-cli"], "./dist/resume-state-cli.js");
});

test("resume-state-cli runs with node by its exports target; a bad call ends with exit 2 and no stdout", () => {
  const { exports } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const result = spawnSync(process.execPath, [exports["./resume-state-cli"], "restore", "--session", "x"], { encoding: "utf8", input: "" });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
});

test("mcpRegistration is the node + this package's dist/index.js shape, with no npm call", async () => {
  const { mcpRegistration, setupNodeExecutable } = await import("aiterm-mcp/setup-node");
  const registration = mcpRegistration();
  assert.equal(registration.command, setupNodeExecutable());
  assert.deepEqual(registration.args, [path.resolve("dist/index.js")]);
  assert.ok(fs.existsSync(registration.args[0]));
});

test("the child-result preface is the start of every parent delivery text", async () => {
  const { CHILD_RESULT_PREFACE, answerMessage } = await import("aiterm-mcp/child-result");
  const text = answerMessage({ delivery_id: "d", child_turn_id: null, child_outcome: "done", text: "answer",
    boundary: { session_id: "s", harness: "claude-code", launch_id: "a".repeat(32) } });
  assert.ok(text.startsWith(CHILD_RESULT_PREFACE), text);
});

test("files outside the public entry points are not importable by name", async () => {
  await assert.rejects(import("aiterm-mcp/dist/core.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  await assert.rejects(import("aiterm-mcp/setup"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  await assert.rejects(import("aiterm-mcp/execution-native-setup"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }); // retired 0.70.60 (bd14)
});
