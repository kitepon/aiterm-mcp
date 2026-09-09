// smoke: 実際に `node dist/index.js` を起動し、initialize + tools/list を stdin にパイプ。
// 検証: stdout は改行区切り JSON-RPC のみ（診断混入なし）／18 ツールが公開されている。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "..", "dist", "index.js");
const DIAGNOSTICS_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures", "factory-diagnostics-schema.json"), "utf8"),
);
const PACKAGE = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
const MCPB = JSON.parse(fs.readFileSync(path.join(HERE, "..", "mcpb", "manifest.json"), "utf8"));

test("smoke: 公開versionはpackage・lock・server manifestで一致する", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package-lock.json"), "utf8"));
  const server = JSON.parse(fs.readFileSync(path.join(HERE, "..", "server.json"), "utf8"));
  assert.equal(lock.version, PACKAGE.version);
  assert.equal(lock.packages?.[""]?.version, PACKAGE.version);
  assert.equal(server.version, PACKAGE.version);
  assert.equal(server.packages?.[0]?.version, PACKAGE.version);
  assert.equal(MCPB.version, PACKAGE.version);
});

test("smoke: Windows backend公開面はpsmux 3.3.8以上で一致する", () => {
  const readme = fs.readFileSync(path.join(HERE, "..", "README.md"), "utf8");
  const readmeJa = fs.readFileSync(path.join(HERE, "..", "README.ja.md"), "utf8");
  const mcpbPtyOpen = MCPB.tools.find((tool) => tool.name === "pty_open");
  assert.match(MCPB.long_description, /psmux 3\.3\.8\+/);
  assert.match(mcpbPtyOpen.description, /psmux 3\.3\.8\+/);
  assert.match(readme, /psmux 3\.3\.8\+/);
  assert.match(readmeJa, /psmux 3\.3\.8以上/);
  assert.doesNotMatch(readme, /Requires \*\*Node\.js ≥ 18\*\* and \*\*tmux\*\*\./);
  assert.doesNotMatch(readmeJa, /同じ tmux ソケット/);
});

test("smoke: stdout は JSON-RPC のみ / diagnostics を含む 18 ツール公開", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-diagnostics-"));
  const child = spawn(process.execPath, [ENTRY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TMPDIR: tmpdir, XDG_RUNTIME_DIR: tmpdir },
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (out += d));

  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pty_read", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "pty_read", arguments: { session_id: "unused", line_range: "5:3" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "diagnostics", arguments: {} } },
  ];
  child.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");

  // id:2(tools/list)応答が来たら即 resolve、来なければ reject する（C8: 従来は timeout でも resolve し、
  // 低速 CI で応答前に空出力のままアサート失敗＝紛らわしい偽陰性だった）。猶予も 5s→15s に延長。
  let errOut = "";
  child.stderr.on("data", (d) => (errOut += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`smoke: 15s 以内に tools/list 応答が来ない。stdout=${JSON.stringify(out)} stderr=${JSON.stringify(errOut)}`));
    }, 15000);
    child.stdout.on("data", () => {
      if (out.includes('"id":6')) { clearTimeout(timer); try { child.kill(); } catch {} resolve(); }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });

  const lines = out.split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 1, `stdout に応答が無い: ${JSON.stringify(out)}`);
  let toolsResp = null;
  const responses = new Map();
  for (const ln of lines) {
    let obj;
    try { obj = JSON.parse(ln); } catch { assert.fail(`stdout に非 JSON-RPC 行: ${JSON.stringify(ln)}`); }
    assert.equal(obj.jsonrpc, "2.0", `JSON-RPC 2.0 でない: ${ln}`);
    responses.set(obj.id, obj);
    if (obj.id === 2) toolsResp = obj;
  }
  assert.ok(toolsResp, "tools/list 応答が無い");
  assert.equal(responses.get(1)?.result?.serverInfo?.version, PACKAGE.version, "initialize version");
  const names = (toolsResp.result?.tools ?? []).map((t) => t.name).sort();
  assert.deepEqual(names, [
    "agent_approval",
    "agent_configure",
    "agent_launch",
    "agent_steer",
    "claude_agent",
    "claude_approval",
    "claude_turn",
    "codex_agent",
    "composer_agent",
    "diagnostics",
    "grok_agent",
    "pty_close",
    "pty_key",
    "pty_list",
    "pty_observe",
    "pty_open",
    "pty_read",
    "pty_send",
  ]);
  const ptyOpen = toolsResp.result.tools.find((t) => t.name === "pty_open");
  assert.match(ptyOpen.description, /POSIXはtmux/, "pty_open: POSIX backendを明示する");
  assert.match(ptyOpen.description, /Windows nativeはpsmux 3\.3\.8以上/, "pty_open: Windows backendと最低版を明示する");
  assert.doesNotMatch(ptyOpen.description, /tmux セッション/, "pty_open: Windowsにもtmuxを要求する旧説明へ戻さない");
  const ptySend = toolsResp.result.tools.find((t) => t.name === "pty_send");
  assert.equal(ptySend.inputSchema.properties.wait, undefined, "v0.16: wait は廃止");
  assert.equal(ptySend.inputSchema.properties.operation_id, undefined, "v0.16: durable相関はclaude_turn専用");
  assert.equal(ptySend.inputSchema.properties.timeout, undefined, "v0.16: pty_send はブロックしない");
  assert.equal(ptySend.inputSchema.properties.screen, undefined);
  assert.equal(ptySend.inputSchema.properties.lines, undefined);
  assert.equal(ptySend.outputSchema.properties.schema.const, "aiterm.pty-send-result.v1", "pty_send result schema");
  assert.deepEqual(ptySend.outputSchema.properties.mode.enum, ["sent", "agent_dispatch"], "pty_send mode schema");
  assert.deepEqual(ptySend.outputSchema.properties.harness.anyOf[0].enum, ["claude-code", "codex-cli", "grok-cli", "cursor-cli"], "pty_send harness schema");
  assert.ok(
    ptySend.outputSchema.properties.event_cursor.anyOf?.some((v) => v.type === "integer"),
    "pty_send event_cursor schema",
  );
  const agentSteer = toolsResp.result.tools.find((t) => t.name === "agent_steer");
  assert.equal(agentSteer.outputSchema.properties.schema.const, "aiterm.agent-steer.v1");
  assert.deepEqual(agentSteer.outputSchema.properties.delivery.enum, ["steered", "idle"]);
  // 非ブロック規範: dispatch 系の説明は「待たない」を明示し、foreground 実行へ誘導する
  // 抽象文（旧「ホストのバックグラウンドタスクとして実行」）へ戻らない。
  const dispatchDescs = [ptySend, ...["agent_launch", "claude_agent", "codex_agent", "grok_agent", "composer_agent"].map((n) => toolsResp.result.tools.find((t) => t.name === n))];
  for (const tool of dispatchDescs) {
    assert.match(tool.description, /投げっぱなしでよい/, `${tool.name}: 投げっぱなし許諾を明示する`);
    assert.match(tool.description, /親はここで待たない/, `${tool.name}: 親が待たないことを明示する`);
    assert.match(tool.description, /親のターンを塞がない別プロセス/, `${tool.name}: 非ブロック起動形を指す`);
    assert.doesNotMatch(tool.description, /ホストのバックグラウンドタスクとして実行/, `${tool.name}: 抽象案内へ戻さない`);
  }
  assert.match(ptySend.description, /foreground/, "pty_send: foreground実行の禁止を明示する");

  const ptyRead = toolsResp.result.tools.find((t) => t.name === "pty_read");
  assert.equal(ptyRead.inputSchema.properties.agent_transcript.type, "boolean", "pty_read agent_transcript schema");
  assert.equal(ptyRead.inputSchema.properties.agent_transcript.default, false, "pty_read agent_transcript default");
  assert.equal(ptyRead.outputSchema.properties.text.type, "string", "pty_read structured text schema");
  assert.deepEqual(ptyRead.outputSchema.properties.mode.enum, ["terminal", "agent_transcript"]);
  assert.ok(ptyRead.inputSchema.properties.operation_id.anyOf?.some((v) => v.type === "string"));
  const ptyClose = toolsResp.result.tools.find((t) => t.name === "pty_close");
  assert.equal(ptyClose.outputSchema.properties.schema.const, "aiterm.pty-close-result.v1", "pty_close result schema");
  assert.equal(ptyClose.outputSchema.properties.session_id.pattern, "^[A-Za-z0-9_-]{1,64}$", "pty_close session ID schema");
  assert.deepEqual(ptyClose.outputSchema.properties.outcome.enum, ["closed", "already_closed"], "pty_close outcome schema");
  const codexAgent = toolsResp.result.tools.find((t) => t.name === "codex_agent");
  assert.match(codexAgent.description, /完全な呼び出し例/, "codex_agent: 委譲guard前に完全形を提示する");
  for (const field of ["prompt", "model", "reasoning_effort", "cwd", "write_scope"]) {
    assert.match(codexAgent.description, new RegExp(`\\"${field}\\"`), `codex_agent complete example: ${field}`);
  }
  assert.equal(codexAgent.inputSchema.properties.env_vars.type, "array", "codex_agent env_vars schema");
  const claudeAgent = toolsResp.result.tools.find((t) => t.name === "claude_agent");
  assert.equal(claudeAgent.inputSchema.properties.write_scope, undefined, "claude_agent はwrite_scope対象外");
  assert.equal(claudeAgent.outputSchema.properties.write_scope, undefined, "claude_agent receiptは不変");
  for (const name of ["codex_agent", "grok_agent", "composer_agent"]) {
    const tool = toolsResp.result.tools.find((t) => t.name === name);
    assert.equal(tool.inputSchema.properties.write_scope.type, "string", `${name} write_scope schema`);
    assert.equal(tool.inputSchema.properties.write_scope.minLength, 1, `${name} write_scope must be non-empty`);
    assert.ok(tool.outputSchema.properties.write_scope, `${name} write_scope result schema`);
    assert.deepEqual(
      tool.outputSchema.properties.write_scope_enforcement.enum,
      ["enforced_read_only", "declaration_only_unsupported"],
      `${name} capability result schema`,
    );
  }
  assert.ok(
    codexAgent.inputSchema.properties.model.anyOf?.some((v) => v.type === "string"),
    "codex_agent model schema",
  );
  assert.ok(claudeAgent.inputSchema.properties.model.anyOf?.some((v) => v.type === "string"), "claude_agent model schema");
  assert.equal(claudeAgent.inputSchema.properties.agent_done, undefined, "v0.16: launcher は常に managed");
  assert.equal(claudeAgent.inputSchema.properties.launch_operation_id.pattern, "^sha256:[0-9a-f]{64}$", "claude_agent launch replay schema");
  assert.equal(claudeAgent.inputSchema.properties.wait, undefined, "v0.16: 初回prompt waitは廃止");
  assert.equal(claudeAgent.inputSchema.properties.timeout, undefined, "v0.16: launcher はブロックしない");
  const claudeTurn = toolsResp.result.tools.find((t) => t.name === "claude_turn");
  assert.equal(claudeTurn.inputSchema.properties.session_id.type, "string", "claude_turn session_id schema");
  assert.deepEqual(claudeTurn.inputSchema.properties.action.enum, ["issue", "recover"], "claude_turn action schema");
  assert.equal(claudeTurn.inputSchema.properties.operation_id.pattern, "^sha256:[0-9a-f]{64}$", "claude_turn operation_id schema");
  assert.equal(claudeTurn.inputSchema.properties.text.type, "string", "claude_turn issue text schema");
  assert.equal(claudeTurn.inputSchema.properties.timeout, undefined, "v0.16: issue は dispatch-only でブロックしない");
  assert.ok(claudeTurn.outputSchema, "claude_turn output schemaを公開する");
  assert.equal(claudeTurn.outputSchema.properties.schema.const, "aiterm.claude-operation-result.v1", "claude_turn result schema");
  assert.deepEqual([...claudeTurn.outputSchema.properties.status.enum].sort(), ["accepted", "completed", "pending", "unknown"], "claude_turn status schema");
  assert.deepEqual(
    claudeTurn.outputSchema.properties.reason.anyOf.flatMap((entry) => entry.enum ?? []).sort(),
    ["operation_not_found", "result_unknown"],
    "claude_turn unknown reason schema",
  );
  assert.ok(claudeTurn.outputSchema.properties.raw_output.anyOf.some((entry) => entry.type === "string"), "claude_turn completed raw_output schema");
  const claudeApproval = toolsResp.result.tools.find((t) => t.name === "claude_approval");
  assert.deepEqual(claudeApproval.inputSchema.properties.action.enum, ["inspect", "respond"], "claude_approval action schema");
  assert.deepEqual(claudeApproval.inputSchema.properties.approval_choice.enum, ["approve_once", "deny"]);
  assert.equal(claudeApproval.inputSchema.properties.observed_prompt_digest.pattern, "^sha256:[0-9a-f]{64}$");
  assert.equal(claudeApproval.outputSchema.properties.schema.const, "aiterm.claude-approval-result.v1");
  assert.deepEqual(claudeApproval.outputSchema.properties.status.enum, ["approval_required", "submitted"]);
  assert.deepEqual(claudeApproval.outputSchema.properties.selected_choice.anyOf.flatMap((entry) => entry.enum ?? []), ["approve_once", "deny"]);
  const agentConfigure = toolsResp.result.tools.find((t) => t.name === "agent_configure");
  assert.equal(agentConfigure.inputSchema.properties.session_id.pattern, "^[A-Za-z0-9_-]{1,64}$");
  assert.ok(agentConfigure.inputSchema.properties.model.anyOf.some((entry) => entry.type === "string"));
  assert.ok(agentConfigure.inputSchema.properties.reasoning_effort.anyOf.some((entry) => entry.type === "string"));
  assert.equal(agentConfigure.outputSchema.properties.schema.const, "aiterm.agent-configure-result.v1");
  assert.deepEqual(agentConfigure.outputSchema.properties.provider.enum, ["claude", "codex", "grok", "composer", "cursor"]);
  assert.deepEqual(agentConfigure.outputSchema.properties.harness.enum, ["claude-code", "codex-cli", "grok-cli", "cursor-cli"]);
  const agentLaunch = toolsResp.result.tools.find((t) => t.name === "agent_launch");
  assert.deepEqual(agentLaunch.inputSchema.properties.harness.enum, ["claude-code", "codex-cli", "grok-cli", "cursor-cli"]);
  assert.deepEqual(agentLaunch.outputSchema.properties.harness.enum, ["claude-code", "codex-cli", "grok-cli", "cursor-cli"]);
  assert.match(agentLaunch.description, /harnessはagent loop・認証・hook・transcriptを所有/);
  assert.match(agentLaunch.description, /Cursor harnessからGPT／Claude／Grok等を選んでも/);
  assert.match(agentLaunch.description, /Grok Composerは別harnessではなく/);
  assert.match(agentLaunch.description, /wait_process/);
  assert.ok(agentLaunch.outputSchema.properties.wait_process, "agent_launchはplatform-native waiter process境界を公開する");
  assert.equal(agentLaunch.inputSchema.properties.throughline_supplement_file.type, "string", "agent_launchはThroughline補足pathを公開する");
  assert.ok(ptySend.outputSchema.properties.wait_process, "pty_send dispatchも同じwaiter process境界を公開する");
  const waitProcessSchema = agentLaunch.outputSchema.properties.wait_process.anyOf.find((entry) => entry.type === "object");
  assert.ok(waitProcessSchema.properties.windows_start_process_argument_list, "Windows Start-Process用の完成済み引数文字列を公開する");
  assert.equal(codexAgent.inputSchema.properties.agent_done, undefined, "v0.16: launcher は常に managed");
  assert.equal(codexAgent.inputSchema.properties.wait, undefined, "v0.16: 初回prompt waitは廃止");
  assert.equal(codexAgent.inputSchema.properties.timeout, undefined);
  assert.equal(codexAgent.inputSchema.properties.screen, undefined);
  assert.equal(codexAgent.inputSchema.properties.lines, undefined);
  for (const [name, provider] of [
    ["claude_agent", "claude"],
    ["codex_agent", "codex"],
    ["grok_agent", "grok"],
    ["composer_agent", "composer"],
  ]) {
    const tool = toolsResp.result.tools.find((entry) => entry.name === name);
    assert.equal(tool.inputSchema.properties.throughline_source_session.type, "string", `${name} portable fork source schema`);
    assert.equal(tool.inputSchema.properties.throughline_source_session.minLength, 1, `${name} portable fork source is non-empty`);
    assert.equal(tool.inputSchema.properties.throughline_supplement_file.type, "string", `${name} portable fork supplement schema`);
    assert.equal(tool.outputSchema.properties.schema.const, "aiterm.agent-launch-result.v1", `${name} launch result schema`);
    assert.equal(tool.outputSchema.properties.provider.const, provider, `${name} provider固定`);
    assert.equal(
      tool.outputSchema.properties.harness.const,
      provider === "claude" ? "claude-code" : provider === "codex" ? "codex-cli" : "grok-cli",
      `${name} harness固定`,
    );
    assert.equal(tool.outputSchema.properties.session_id.pattern, "^[A-Za-z0-9_-]{1,64}$", `${name} session ID schema`);
    assert.equal(tool.outputSchema.properties.managed_completion.type, "boolean", `${name} managed completion schema`);
  }
  for (const name of ["grok_agent", "composer_agent"]) {
    const tool = toolsResp.result.tools.find((t) => t.name === name);
    assert.ok(
      tool.inputSchema.properties.model.anyOf?.some((v) => v.type === "string"),
      `${name} model schema`,
    );
    assert.equal(tool.inputSchema.properties.reasoning_effort.enum, undefined, `${name} reasoning_effort enum は未公開`);
    assert.equal(tool.inputSchema.properties.agent_done, undefined, `${name} v0.16: 常に managed`);
    assert.equal(tool.inputSchema.properties.wait, undefined, `${name} initial prompt wait は未公開`);
    assert.equal(tool.inputSchema.properties.timeout, undefined, `${name} initial prompt timeout は未公開`);
    assert.equal(tool.inputSchema.properties.screen, undefined, `${name} initial prompt screen は未公開`);
    assert.equal(tool.inputSchema.properties.lines, undefined, `${name} initial prompt lines は未公開`);
  }
  assert.equal(responses.get(3)?.result?.isError, true, "未知 tool は tool error 応答を返す");
  assert.match(responses.get(3)?.result?.content?.[0]?.text ?? "", /Tool no_such_tool not found/);
  assert.equal(responses.get(4)?.result?.isError, true, "不正引数は isError:true");
  assert.equal(responses.get(5)?.result?.isError, true, "逆転 line_range は isError:true");
  assert.match(responses.get(5)?.result?.content?.[0]?.text ?? "", /上端が下端より小さい/);

  const diagnosticText = responses.get(6)?.result?.content?.[0]?.text;
  assert.equal(responses.get(6)?.result?.isError, undefined, "diagnostics は通常未設定を error にしない");
  assert.equal(typeof diagnosticText, "string", "diagnostics は JSON text を返す");
  const diagnostics = JSON.parse(diagnosticText);
  assert.deepEqual(Object.keys(diagnostics), DIAGNOSTICS_FIXTURE.top_level_fields, "diagnostics top-level schema");
  assert.equal(diagnostics.diagnostic_schema, DIAGNOSTICS_FIXTURE.diagnostic_schema);
  assert.equal(diagnostics.version, PACKAGE.version, "diagnostics version は package.json の公開版と一致");
  assert.ok(["ready", "unverified"].includes(diagnostics.overall), "overall status");
  assert.deepEqual(Object.keys(diagnostics.mcp), DIAGNOSTICS_FIXTURE.mcp_fields);
  assert.deepEqual(diagnostics.mcp, DIAGNOSTICS_FIXTURE.mcp);
  assert.deepEqual(Object.keys(diagnostics.pty_list), DIAGNOSTICS_FIXTURE.pty_list_fields);
  assert.equal(diagnostics.pty_list.access, DIAGNOSTICS_FIXTURE.pty_list.access);
  assert.ok(DIAGNOSTICS_FIXTURE.status_values.includes(diagnostics.pty_list.status));
  assert.ok(diagnostics.pty_list.session_count === null ||
    (Number.isInteger(diagnostics.pty_list.session_count) && diagnostics.pty_list.session_count >= 0));
  assert.equal(diagnostics.pty_list.status === "ready", Number.isInteger(diagnostics.pty_list.session_count));
  assert.equal(
    diagnostics.overall,
    diagnostics.pty_list.status === "unverified" || diagnostics.runtime_error_store.status === "unverified"
      ? "unverified"
      : "ready",
  );
  assert.deepEqual(Object.keys(diagnostics.runtime_error_store), DIAGNOSTICS_FIXTURE.runtime_error_store_fields);
  assert.ok(DIAGNOSTICS_FIXTURE.status_values.includes(diagnostics.runtime_error_store.status));
  assert.ok(["enabled", "disabled", "malformed"].includes(diagnostics.runtime_error_store.collection));
  for (const key of ["record_count", "unacknowledged_count"]) {
    assert.ok(diagnostics.runtime_error_store[key] === null ||
      (Number.isInteger(diagnostics.runtime_error_store[key]) && diagnostics.runtime_error_store[key] >= 0));
  }
  assert.deepEqual(Object.keys(diagnostics.vendor_dependencies).sort(), DIAGNOSTICS_FIXTURE.vendor_keys);
  for (const [name, vendor] of Object.entries(diagnostics.vendor_dependencies)) {
    assert.deepEqual(Object.keys(vendor), DIAGNOSTICS_FIXTURE.vendor_fields);
    assert.equal(vendor.optional, true);
    assert.ok(DIAGNOSTICS_FIXTURE.status_values.includes(vendor.status));
    assert.deepEqual(vendor.required_for, DIAGNOSTICS_FIXTURE.vendor_required_for[name]);
  }
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("smoke: tmux を解決できない端末を diagnostics が ready にしない", async () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-no-tmux-"));
  const child = spawn(process.execPath, [ENTRY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: "/definitely-missing",
      HOME: tmpdir,
      TMPDIR: tmpdir,
      XDG_RUNTIME_DIR: tmpdir,
      ...(process.platform === "win32"
        ? { AITERM_PSMUX: "C:\\definitely-missing\\psmux.exe" }
        : { AITERM_TMUX: "/definitely-missing/tmux" }),
    },
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stdin.write([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "diagnostics", arguments: {} } },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`diagnostics timeout: ${out}`)), 15000);
    child.stdout.on("data", () => {
      if (out.includes('"id":2')) {
        clearTimeout(timer);
        try { child.kill(); } catch {}
        resolve();
      }
    });
    child.on("error", reject);
  });
  const response = out.trim().split("\n").map(JSON.parse).find((entry) => entry.id === 2);
  const diagnostics = JSON.parse(response.result.content[0].text);
  assert.equal(diagnostics.pty_list.status, "unverified");
  assert.equal(diagnostics.pty_list.session_count, null);
  assert.equal(diagnostics.overall, "unverified");
  fs.rmSync(tmpdir, { recursive: true, force: true });
});
