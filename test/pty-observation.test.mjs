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

test("起動完了の後に増えたprocessのうち、中継の直接の子は数えず、その下は数える", () => {
  const at = second => `2026-10-04T05:00:${String(second).padStart(2, "0")}.000Z`;
  const row = (pid, parent_pid, second, command) => ({ pid, parent_pid, started_identity: at(second), command });
  const startupRows = [
    row(5, 1, 0, "/bin/bash"),
    row(10, 5, 1, "/usr/local/bin/cursor-agent --force"),
    row(11, 10, 2, "/srv/trial/mcp-lazy-0.3.0-7cdb9cc -- /usr/local/bin/node /srv/aiterm/dist/index.js"),
    row(12, 10, 2, "/usr/local/bin/node /srv/other-mcp/server.js"),
  ];
  const startup = new Set(startupRows.map(item => `${item.pid}:${item.started_identity}`));
  const count = (kind, added) => core.postStartupProcessCount(kind, [...startupRows, ...added], [...startupRows, ...added], startup);
  assert.equal(count("cursor", []), 0);
  // 道具を呼ぶと本体が中継の下に立つ。先行起動の判定も中継の直接の子。
  const server = row(20, 11, 30, "/usr/local/bin/node /srv/aiterm/dist/index.js");
  assert.equal(count("cursor", [server, row(21, 11, 31, "/usr/local/bin/node /srv/aiterm/dist/pending-check.js")]), 0);
  // 本体の下で動くものと、中継を通らないものは今までどおり数える。
  assert.equal(count("cursor", [server, row(22, 20, 40, "sleep 240")]), 1);
  assert.equal(count("cursor", [row(23, 12, 40, "sleep 240"), row(24, 10, 41, "/bin/bash -c sleep 240")]), 2);
  // 後から立った中継そのものは数える。その直接の子は数えない。
  const lateRelay = row(30, 10, 50, "/usr/local/bin/mcp-lazy /usr/local/bin/node /srv/aiterm/dist/index.js");
  assert.equal(count("cursor", [lateRelay, row(31, 30, 51, "/usr/local/bin/node /srv/aiterm/dist/index.js")]), 1);
  // Windowsで再利用された親PID（子より後に始まったprocess）は親として扱わない。
  const reused = row(40, 10, 59, '"C:\\tools\\mcp-lazy.exe" node.exe index.js');
  assert.equal(count("cursor", [reused, row(41, 40, 45, "sleep 240")]), 2);
  // Codexの補助processの扱いは変えない。
  const helper = row(50, 10, 20, "/usr/local/lib/node_modules/@openai/codex/vendor/bin/codex-code-mode-host");
  assert.equal(count("codex", [helper, row(51, 50, 21, "sleep 240")]), 1);
  assert.equal(count("claude", [helper]), 1);
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

test('WindowsのpsmuxはPATHが固定されていても、利用者用とPC全体用のWinGet Linksから見つける', async () => {
  const { psmuxBin } = await import('../dist/tmux-runtime.js');
  const user = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\psmux.exe';
  const machine = 'C:\\Program Files\\WinGet\\Links\\psmux.exe';
  const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  assert.equal(psmuxBin(env, file => file === user || file === machine), user);
  assert.equal(psmuxBin(env, file => file === machine), machine);
  assert.equal(psmuxBin(env, () => false), 'psmux');
  assert.equal(psmuxBin({ ...env, AITERM_PSMUX: 'D:\\psmux.exe' }, () => true), 'D:\\psmux.exe');
});

test('子へ渡されたAITERM_STATE_BASEがあれば、XDG_RUNTIME_DIRより優先して同じ置き場を使う', async (t) => {
  const { runtimeStateBase } = await import('../dist/state-root.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aiterm-state-base-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const saved = { base: process.env.AITERM_STATE_BASE, xdg: process.env.XDG_RUNTIME_DIR };
  t.after(() => { for (const [k, v] of [['AITERM_STATE_BASE', saved.base], ['XDG_RUNTIME_DIR', saved.xdg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.XDG_RUNTIME_DIR = os.tmpdir();
  process.env.AITERM_STATE_BASE = base;
  assert.equal(runtimeStateBase(), base);
  process.env.AITERM_STATE_BASE = path.join(base, 'missing');
  assert.notEqual(runtimeStateBase(), path.join(base, 'missing'));
});
