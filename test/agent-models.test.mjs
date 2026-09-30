import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agentModelsResult, checkedCatalog, sortEfforts } from "../dist/model-catalog.js";
import { cursorCatalogFromLines } from "../dist/harnesses/cursor.js";
import { grokCatalogFromInitialize, grokModelChoices } from "../dist/harnesses/grok.js";
import { claudeCatalogFromInitialize, claudeModelChoices } from "../dist/harnesses/claude.js";
import { codexCatalogFromPages, codexModelChoices } from "../dist/harnesses/codex.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const posixOnly = { skip: process.platform === "win32" ? "偽CLIはPOSIXのshebangで起動する" : false };

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-agent-models-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeCli(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

const choice = (id, efforts, extra = {}) => ({ id, display_name: null, efforts, default_effort: null, hidden: false, ...extra });

test("effortは既知の並びで重複なく並べ、未知の値は後ろへ出てきた順で置く", () => {
  assert.deepEqual(sortEfforts(["max", "low", "future", "ultracode", "xhigh", "low", "none", "extra-high"]),
    ["none", "low", "xhigh", "extra-high", "max", "ultracode", "future"]);
});

test("一覧の形式異常は明示的なエラーにする", () => {
  const base = { source: "test", harness_version: null, default_model: null, adapter_efforts: {} };
  assert.throws(() => checkedCatalog("X", { ...base, models: [] }), /MODEL_CATALOG_INVALID: .*利用可能なmodelがありません/);
  assert.throws(() => checkedCatalog("X", { ...base, models: [choice("a", []), choice("a", [])] }), /重複/);
  assert.throws(() => checkedCatalog("X", { ...base, models: [choice("a", ["low"], { default_effort: "high" })] }), /既定effort/);
  assert.throws(() => checkedCatalog("X", { ...base, default_model: "b", models: [choice("a", [])] }), /既定model/);
  const result = agentModelsResult("codex-cli", checkedCatalog("X", { ...base, models: [choice("a", ["high", "low"]), choice("b", ["max"])] }));
  assert.equal(result.schema, "aiterm.agent-models.v1");
  assert.deepEqual(result.models[0].efforts, ["low", "high"]);
  assert.deepEqual(result.efforts, ["low", "high", "max"]);
});

test("Cursorの完成形IDを、Aitermが連結で作れる素のIDとeffortへ分ける", () => {
  const ids = [
    ["auto", "Auto (current, default)"],
    ["gpt-5.3-codex-low", "Codex 5.3 Low"], ["gpt-5.3-codex-low-fast", "Codex 5.3 Low Fast"],
    ["gpt-5.3-codex", "Codex 5.3"], ["gpt-5.3-codex-fast", "Codex 5.3 Fast"],
    ["gpt-5.3-codex-high", "Codex 5.3 High"], ["gpt-5.3-codex-xhigh", "Codex 5.3 Extra High"],
    ["composer-2.5", "Composer 2.5"], ["composer-2.5-fast", "Composer 2.5 Fast"],
    ["claude-opus-5-thinking-high", "Claude Opus 5 1M Thinking"],
    ["claude-4.6-sonnet-medium-thinking", "Claude 4.6 Sonnet Medium Thinking"],
    ["gpt-5.5-none", "GPT-5.5 None"], ["gpt-5.5-extra-high", "GPT-5.5 Extra High"], ["gpt-5.5-minimal", "GPT-5.5 Minimal"],
    ["grok-4.7-low-fast", "Grok 4.7 Low Fast​​"],
  ];
  const catalog = cursorCatalogFromLines(ids.map(([id, label]) => ({ id, label })));
  assert.equal(catalog.default_model, "auto");
  const byId = Object.fromEntries(catalog.models.map((model) => [model.id, model]));
  assert.deepEqual(Object.keys(byId).sort(), ["auto", "claude-opus-5-thinking", "composer-2.5", "gpt-5.3-codex", "gpt-5.5", "grok-4.7"]);
  assert.deepEqual(byId["gpt-5.3-codex"].efforts, ["low", "high", "xhigh"]);
  assert.equal(byId["gpt-5.3-codex"].display_name, "Codex 5.3");
  // -fastだけのeffortは連結で作れない。minimalは稼働中に選び直せない。
  assert.deepEqual(byId["grok-4.7"].efforts, []);
  assert.deepEqual(byId["gpt-5.5"].efforts, ["none", "extra-high"]);
  assert.equal(byId["auto"].display_name, "Auto");
  // 返したeffortは、agent_launchが作る `${model}-${effort}` として必ずcatalogにある。
  const raw = new Set(ids.map(([id]) => id));
  for (const model of catalog.models) for (const effort of model.efforts) assert.ok(raw.has(`${model.id}-${effort}`), `${model.id}-${effort}`);
});

const grokModel = (modelId, efforts, defaultEffort = "high", extra = {}) => ({
  modelId, name: modelId.toUpperCase(),
  _meta: { supportsReasoningEffort: true, reasoningEffort: defaultEffort,
    reasoningEfforts: efforts.map((value) => ({ id: value, value, label: value, default: value === defaultEffort })), ...extra },
});
const grokInitialize = (models, current = models[0]?.modelId) => JSON.stringify({
  jsonrpc: "2.0", id: 1,
  result: { protocolVersion: 1, _meta: { agentVersion: "1.0.41", modelState: { currentModelId: current, availableModels: models } } },
});

test("Grokはinitializeの_meta.modelStateからmodelごとのeffortを読む", () => {
  const catalog = grokCatalogFromInitialize([
    "Grok起動の案内（JSONでない行）",
    grokInitialize([grokModel("grok-4.7", ["xhigh", "high", "medium", "low"]), grokModel("grok-4.5", ["high", "medium", "low"])]),
  ].join("\n"));
  assert.equal(catalog.default_model, "grok-4.7");
  assert.equal(catalog.harness_version, "1.0.41");
  assert.deepEqual(catalog.models.map((model) => [model.id, model.efforts, model.default_effort]), [
    ["grok-4.7", ["low", "medium", "high", "xhigh"], "high"],
    ["grok-4.5", ["low", "medium", "high"], "high"],
  ]);
});

test("Grokの応答が無い・拒否・形の違いは区別したエラーにする", () => {
  assert.throws(() => grokCatalogFromInitialize("", "exit=0"), /MODEL_CATALOG_INVALID: .*initializeの応答がありません（exit=0）/);
  assert.throws(() => grokCatalogFromInitialize(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "auth" } })), /MODEL_CATALOG_UNAVAILABLE: .*拒否/);
  assert.throws(() => grokCatalogFromInitialize(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { _meta: {} } })), /MODEL_CATALOG_INVALID: .*modelState/);
  assert.throws(() => grokCatalogFromInitialize(grokInitialize([grokModel("grok-x", ["low"], "high")])), /既定effort/);
});

const claudeInitialize = (requestId, models, subtype = "success") => JSON.stringify({
  type: "control_response",
  response: subtype === "success" ? { subtype, request_id: requestId, response: { models } } : { subtype, request_id: requestId, error: "denied" },
});
const claudeModels = [
  { value: "default", displayName: "Default (recommended)", resolvedModel: "claude-opus-5-5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku 4.5", resolvedModel: "claude-haiku-4-5-20251001" },
  { value: "claude-opus-4-6", displayName: "Opus 4.6", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "max"] },
];

test("Claudeはinitializeのmodelsを読み、ultracodeをeffort対応modelへ足して出所を示す", () => {
  const catalog = claudeCatalogFromInitialize([
    JSON.stringify({ type: "system", subtype: "hook_started" }),
    claudeInitialize("other", []),
    claudeInitialize("req-1", claudeModels),
  ].join("\n"), "req-1");
  assert.equal(catalog.default_model, "default");
  assert.deepEqual(catalog.models.map((model) => [model.id, model.efforts]), [
    ["default", ["low", "medium", "high", "xhigh", "max", "ultracode"]],
    ["haiku", []],
    ["claude-opus-4-6", ["low", "medium", "high", "max", "ultracode"]],
  ]);
  assert.deepEqual(Object.keys(catalog.adapter_efforts), ["ultracode"]);
  assert.throws(() => claudeCatalogFromInitialize(claudeInitialize("other", claudeModels), "req-1"), /MODEL_CATALOG_INVALID: .*initializeの応答がありません/);
  assert.throws(() => claudeCatalogFromInitialize(claudeInitialize("req-1", [], "error"), "req-1"), /MODEL_CATALOG_UNAVAILABLE: .*拒否/);
  assert.throws(() => claudeCatalogFromInitialize(claudeInitialize("req-1", [{ value: "x", supportsEffort: true, supportedEffortLevels: "high" }]), "req-1"),
    /supportedEffortLevels/);
});

const codexModel = (id, efforts, extra = {}) => ({
  id, model: id, displayName: id.toUpperCase(), hidden: false, isDefault: false, defaultReasoningEffort: efforts[0],
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })), ...extra,
});

test("Codexはmodel/listの全ページからmodelごとのeffortと既定値を読む", () => {
  const catalog = codexCatalogFromPages([
    { data: [codexModel("gpt-6-astra", ["low", "ultra"], { isDefault: true, defaultReasoningEffort: "low" })], nextCursor: "1" },
    { data: [codexModel("gpt-reserve", ["medium"], { hidden: true })], nextCursor: null },
  ]);
  assert.equal(catalog.default_model, "gpt-6-astra");
  assert.deepEqual(catalog.models.map((model) => [model.id, model.efforts, model.default_effort, model.hidden]), [
    ["gpt-6-astra", ["low", "ultra"], "low", false],
    ["gpt-reserve", ["medium"], "medium", true],
  ]);
  assert.throws(() => codexCatalogFromPages([{ items: [] }]), /MODEL_CATALOG_INVALID: .*data/);
  assert.throws(() => codexCatalogFromPages([{ data: [{ id: "x" }], nextCursor: null }]), /supportedReasoningEfforts/);
});

test("Grokはagent stdioへinitializeだけを送り、sessionを作らない", posixOnly, (t) => {
  const dir = tempDir(t);
  const log = path.join(dir, "log.json");
  const bin = fakeCli(dir, "grok", `
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8").trim().split("\\n").map((line) => JSON.parse(line));
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), methods: input.map((item) => item.method) }));
process.stdout.write(${JSON.stringify(grokInitialize([grokModel("grok-4.7", ["low", "high"])]))} + "\\n");`);
  const catalog = grokModelChoices(bin, dir);
  assert.deepEqual(catalog.models.map((model) => model.id), ["grok-4.7"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(log, "utf8")), { argv: ["agent", "--no-leader", "stdio"], methods: ["initialize"] });
});

test("Grokが失敗して終わった時はMODEL_CATALOG_UNAVAILABLEにする", posixOnly, (t) => {
  const dir = tempDir(t);
  const bin = fakeCli(dir, "grok", `process.stderr.write("not logged in"); process.exit(3);`);
  assert.throws(() => grokModelChoices(bin, dir), /MODEL_CATALOG_UNAVAILABLE: .*not logged in/);
});

test("Claudeはpromptを送らず、hookとMCP serverを止め、sessionを保存しない", posixOnly, (t) => {
  const dir = tempDir(t);
  const log = path.join(dir, "log.json");
  const bin = fakeCli(dir, "claude", `
const fs = require("node:fs");
const argv = process.argv.slice(2);
const settingsFile = argv[argv.indexOf("--settings") + 1];
const input = fs.readFileSync(0, "utf8").trim().split("\\n").map((line) => JSON.parse(line));
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, settingsFile, settings: JSON.parse(fs.readFileSync(settingsFile, "utf8")), input }));
const id = input[0].request_id;
process.stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: id, response: { models: ${JSON.stringify(claudeModels)} } } }) + "\\n");`);
  const catalog = claudeModelChoices(bin, dir);
  assert.equal(catalog.models.length, 3);
  const seen = JSON.parse(fs.readFileSync(log, "utf8"));
  for (const flag of ["-p", "--no-session-persistence", "--strict-mcp-config", "--input-format", "--output-format"]) assert.ok(seen.argv.includes(flag), flag);
  assert.equal(seen.argv.includes("--mcp-config"), false);
  assert.deepEqual(seen.settings, { disableAllHooks: true });
  assert.deepEqual(seen.input.map((item) => [item.type, item.request.subtype]), [["control_request", "initialize"]]);
  assert.equal(fs.existsSync(seen.settingsFile), false, "一時設定は消す");
});

test("Codexはapp-serverのmodel/listをページ順に読み、threadを作らない", posixOnly, async (t) => {
  const dir = tempDir(t);
  const log = path.join(dir, "log.json");
  const bin = fakeCli(dir, "codex", `
const fs = require("node:fs");
const readline = require("node:readline");
const methods = [];
const pages = { "": { data: [${JSON.stringify(codexModel("gpt-a", ["low", "high"], { isDefault: true }))}], nextCursor: "p2" },
  p2: { data: [${JSON.stringify(codexModel("gpt-b", ["medium"]))}], nextCursor: null } };
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  methods.push([message.method, message.params?.cursor ?? null, message.params?.includeHidden ?? null]);
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), methods }));
  if (message.id === undefined) return;
  const result = message.method === "initialize" ? { userAgent: "fake" } : pages[message.params.cursor ?? ""];
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
});`);
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  const catalog = await codexModelChoices(bin, true);
  assert.deepEqual(catalog.models.map((model) => model.id), ["gpt-a", "gpt-b"]);
  assert.equal(catalog.default_model, "gpt-a");
  const seen = JSON.parse(fs.readFileSync(log, "utf8"));
  assert.deepEqual(seen.argv, ["app-server", "--listen", "stdio://"]);
  assert.deepEqual(seen.methods, [["initialize", null, null], ["initialized", null, null], ["model/list", null, true], ["model/list", "p2", true]]);
});

test("公開MCPのagent_modelsでharnessを指定して候補を取得できる", posixOnly, async (t) => {
  const dir = tempDir(t);
  const bin = fakeCli(dir, "grok", `
require("node:fs").readFileSync(0);
process.stdout.write(${JSON.stringify(grokInitialize([grokModel("grok-4.7", ["low", "high"]), grokModel("grok-4.6", ["low"], "low")]))} + "\\n");`);
  const server = spawn(process.execPath, [path.join(ROOT, "dist", "index.js")], {
    env: { ...process.env, GROK_BIN: bin, AITERM_STATE_ROOT: path.join(dir, "state") },
    stdio: ["pipe", "pipe", "ignore"],
  });
  t.after(() => server.kill());
  const responses = new Map();
  let buffer = "";
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) { const message = JSON.parse(line); if (message.id !== undefined) responses.set(message.id, message); }
    }
  });
  const send = (message) => server.stdin.write(JSON.stringify(message) + "\n");
  const wait = async (id) => {
    for (let i = 0; i < 300 && !responses.has(id); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(responses.has(id), `response ${id}`);
    return responses.get(id);
  };
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  await wait(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agent_models", arguments: { harness: "grok-cli", cwd: dir } } });
  const ok = (await wait(2)).result;
  assert.equal(ok.isError, undefined);
  assert.equal(ok.structuredContent.schema, "aiterm.agent-models.v1");
  assert.equal(ok.structuredContent.harness, "grok-cli");
  assert.deepEqual(ok.structuredContent.efforts, ["low", "high"]);
  assert.deepEqual(ok.structuredContent.models.map((model) => model.id), ["grok-4.7", "grok-4.6"]);
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_models", arguments: { harness: "grok-cli", cwd: "relative" } } });
  const bad = (await wait(3)).result;
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /絶対パス/);
});
