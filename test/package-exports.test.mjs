import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// bellteam-boundary.md "公開の入口": what a consumer may import by name, and nothing else (bd04, 2026-11-14).
const PROMISED = {
  "aiterm-mcp/setup-node": ["mcpRegistration", "setupNodeExecutable"],
  "aiterm-mcp/setup-integrations": ["mergeClaudeParentHooks", "mergeCursorParentHooks", "ensureCodexParentSteer"],
  "aiterm-mcp/execution-parent-worker": ["localParentWorkerRuntime"],
  "aiterm-mcp/execution-native-setup": ["configureNativeExecutionHooks"],
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
});
