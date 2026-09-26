import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "aiterm-observe-"));
process.env.TMPDIR = directory;
process.env.AITERM_TEST_OWNER = "観測担当";
const core = await import("../dist/core.js");
const runtime = await import("../dist/process-runtime.js");
after(() => { core.killAll(); rmSync(directory, { recursive: true, force: true }); });

test("同じlaunchのnpm shimとnative Codexは中間Nodeを跨いだ一つの起動として識別する", () => {
  const meta = { kind: 'codex', launch_id: 'launch-fixture', agent_executable: 'C:/Users/test/npm/codex' };
  const rows = [
    { pid: 10, parent_pid: 1, command: '"C:\\Program Files\\Git\\usr\\bin\\sh.exe" C:/Users/test/npm/codex launch-fixture' },
    { pid: 11, parent_pid: 10, command: 'node.exe C:/Users/test/npm/node_modules/@openai/codex/bin/codex.js launch-fixture' },
    { pid: 12, parent_pid: 11, command: 'C:/Users/test/npm/node_modules/@openai/codex/vendor/codex.exe launch-fixture' },
  ];
  assert.deepEqual(core.selectHarnessProcesses(meta, rows, rows).map(row => row.pid), [10]);
  const separate = { ...rows[2], pid: 20, parent_pid: 2 };
  assert.deepEqual(core.selectHarnessProcesses(meta, [...rows, separate], rows).map(row => row.pid), [10, 20]);
});

test("Cursor公式Windows installerのcmd→ps1→node中継を一つの起動として識別する", () => {
  const meta = { kind: 'cursor', launch_id: 'launch-cursor', agent_executable: 'C:/Users/kite_/AppData/Local/cursor-agent/cursor-agent.cmd' };
  const base = 'C:\\Users\\kite_\\AppData\\Local\\cursor-agent';
  const rows = [
    { pid: 5, parent_pid: 1, command: '"C:\\Program Files\\Git\\usr\\bin\\bash.exe"' },
    { pid: 10, parent_pid: 5, command: `C:\\WINDOWS\\system32\\cmd.exe /c ${base}\\cursor-agent.cmd --force --approve-mcps --trust` },
    { pid: 11, parent_pid: 10, command: `C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe  -NoProfile -ExecutionPolicy Bypass -File "${base}\\cursor-agent.ps1" --force` },
    { pid: 12, parent_pid: 11, command: `"${base}\\versions\\2026.09.15-d2fe57e\\node.exe" ${base}\\versions\\2026.09.15-d2fe57e\\index.js --force` },
  ];
  assert.deepEqual(core.selectHarnessProcesses(meta, rows, rows).map(row => row.pid), [10]);
});

// 実機（fox、2026-09-26）: psmux serverを起動した親PIDが、後からCursorの子（MCP server）へ再利用され、
// 親PIDを辿るとCursor自身へ戻る循環ができていた。子より後に始まったprocessは親として辿らない。
test("再利用された親PIDの循環があってもCursor起動を一つに識別する", () => {
  const meta = { kind: 'cursor', launch_id: 'launch-cursor', agent_executable: 'C:/Users/kite_/AppData/Local/cursor-agent/cursor-agent.cmd' };
  const base = 'C:\\Users\\kite_\\AppData\\Local\\cursor-agent';
  const at = second => `2026-09-26T07:42:${String(second).padStart(2, "0")}.000Z`;
  const rows = [
    { pid: 4, parent_pid: 9, started_identity: at(28), command: '"C:\\Program Files\\WinGet\\Links\\psmux.exe" server -s t7' },
    { pid: 5, parent_pid: 4, started_identity: at(28), command: '"C:\\Program Files\\Git\\bin\\bash.exe"' },
    { pid: 10, parent_pid: 5, started_identity: at(29), command: `C:\\WINDOWS\\system32\\cmd.exe /c ${base}\\cursor-agent.cmd --force` },
    { pid: 11, parent_pid: 10, started_identity: at(29), command: `powershell.exe -NoProfile -File "${base}\\cursor-agent.ps1" --force` },
    { pid: 12, parent_pid: 11, started_identity: at(30), command: `"${base}\\versions\\2026.09.26\\node.exe" ${base}\\versions\\2026.09.26\\index.js --force` },
    { pid: 9, parent_pid: 12, started_identity: at(33), command: '"C:\\Program Files\\nodejs\\node.exe" aiterm-mcp\\dist\\index.js' },
  ];
  const subtree = runtime.processSubtree(rows, 5);
  assert.deepEqual(subtree.map(row => row.pid).sort((a, b) => a - b), [5, 9, 10, 11, 12]);
  assert.deepEqual(core.selectHarnessProcesses(meta, rows, subtree).map(row => row.pid), [10]);
});

test("通常PTYの自己識別と明示キーだけの環境照会", async () => {
  const name = "ordinary";
  core.openSession(name, process.platform === "win32" ? "pwsh" : "bash", ["AITERM_TEST_OWNER"]);
  const list = core.listSessionsResult(["AITERM_SESSION_ID", "AITERM_TEST_OWNER", "AITERM_UNSET_TEST"]);
  assert.deepEqual(list.sessions[0].environment, {
    AITERM_SESSION_ID: name, AITERM_TEST_OWNER: "観測担当", AITERM_UNSET_TEST: null,
  });
  const before = core.observeSession(name);
  assert.equal(before.exists, true);
  assert.equal(before.pane_alive, true);
  assert.ok(before.process_identity.pid > 0);
  assert.equal(before.activity.output_changed, null);
  const command = process.platform === "win32" ? "Write-Output ('自己識別=' + $env:AITERM_SESSION_ID)" : "printf '自己識別=%s\\n' \"$AITERM_SESSION_ID\"";
  core.send(name, command, { mark: true });
  const output = await core.readOutput(name, { wait: true, timeout: 5 });
  assert.ok(output.includes("自己識別=ordinary"), output);
  const observed = core.observeSession(name, before.activity.cursor);
  assert.equal(observed.activity.output_changed, true);
  assert.ok(observed.activity.cpu_delta_seconds >= 0);
  assert.equal("command" in observed.process_identity, false);
  core.closeSession(name);
  assert.equal(core.observeSession(name).state, "missing");
  assert.deepEqual(core.listSessionsResult().sessions, []);
});
