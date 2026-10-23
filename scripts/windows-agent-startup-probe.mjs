// Synthetic argv fixtures only; never re-send an input or invoke a real agent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const fromRoot = file => import(pathToFileURL(path.join(process.cwd(), file)));
const support = await fromRoot('test/core-agent-support.mjs');
const runtime = await fromRoot('dist/tmux-runtime.js');
const { core, withFakeCodexHome, argvPrinterBin, fakeClaudeBin, sessionLogPath } = support;
assert.equal(process.platform, 'win32');
const result = { schema: 'aiterm.windows-agent-startup-probe.v1', cases: [] };
const quote = s => "'" + s.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
const marker = path.join(process.env.TMPDIR, 'fixture-invoked.txt');
for (const file of [argvPrinterBin, fakeClaudeBin]) {
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('#!/bin/sh\n', '#!/bin/sh\n' + `printf invoked > ${quote(marker)}\n`));
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function observation(sid) {
  const pane = runtime.tmuxCommand(false, 'capture-pane', '-p', '-t', sid);
  let log = '';
  try { log = fs.readFileSync(sessionLogPath(sid), 'utf8'); } catch {}
  return { invoked: fs.existsSync(marker), paneCode: pane.code,
    paneHasArgs: /<arg>|--setting-sources/.test(pane.stdout), logHasArgs: /<arg>|--setting-sources/.test(log),
    paneHasPrompt: /\$\s*$/.test(pane.stdout.trimEnd()),
    pid: runtime.tmuxCommand(false, 'display-message', '-p', '-t', sid, '#{pid}').stdout.trim() };
}
async function run(label, kind, options) {
  const row = { label, kind };
  result.cases.push(row);
  let sid;
  try {
    fs.rmSync(marker, { force: true });
    const started = performance.now();
    [sid] = core.openAgent(kind, { agent_done: true, ...options });
    row.openMs = Math.round(performance.now() - started);
    row.afterOpen = observation(sid);
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    row.firstReadMs = Math.round(performance.now() - started);
    row.firstReadHasArgs = /<arg>|--setting-sources/.test(out);
    row.firstReadCompletion = /via (\w+)/.exec(out)?.[1] ?? null;
    row.afterRead = observation(sid);
    // Observe only. An initial incomplete read is never followed by another send.
    const deadline = performance.now() + 5000;
    while (!row.afterRead.logHasArgs && performance.now() < deadline) {
      await pause(100);
      row.afterRead = observation(sid);
      if (row.afterRead.paneCode !== 0) break;
    }
    row.finalMs = Math.round(performance.now() - started);
  } catch (error) {
    row.error = error.message;
    if (sid) row.failure = observation(sid);
  } finally {
    if (sid) try { core.closeSession(sid); } catch (error) { row.cleanupError = error.message; }
  }
}
await withFakeCodexHome(async () => {
  await run('codex-model', 'codex', { model: 'gpt-5.6-terra' });
  await run('codex-model-effort', 'codex', { model: 'gpt-5.6-terra', reasoning_effort: 'high' });
  await run('codex-home', 'codex', {});
});
await run('claude-scopes', 'claude', {});
await run('claude-hook-result-startup', 'claude', {});
console.log('AGENT_STARTUP_PROBE_RESULT=' + JSON.stringify(result));
