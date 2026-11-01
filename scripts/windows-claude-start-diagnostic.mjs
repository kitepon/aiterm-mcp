import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const [source, output] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
await import(pathToFileURL(path.join(source, 'test/seat-env.mjs')));
const runtime = process.env.XDG_RUNTIME_DIR;
const invoked = path.join(runtime, 'cli-invoked.txt').replaceAll('\\', '/');
const cli = path.join(runtime, 'claude-boundary.sh');
fs.writeFileSync(cli, `#!/bin/sh\nif [ "$1" = auth ]; then printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'; exit 0; fi\nprintf 'START %s\\n' "$AITERM_AGENT_LAUNCH_ID" > '${invoked}'\nprintf 'FAKE_CLI_ARGV_DONE\\n'\npwsh -NoLogo -NoProfile\n:\n`);
process.env.CLAUDE_BIN = cli;
const core = await import(pathToFileURL(path.join(source, 'dist/core.js')));
const { agentFixturePrint } = await import(pathToFileURL(path.join(source, 'test/agent-fixture-shell.mjs')));
core.__testSetAgentTuiReadyStableSamples(1);
const sid = 'claude_start_boundary';
const started = performance.now();
const result = { source, runtime, stages: [] };
const record = (phase, extra = {}) => {
  result.stages.push({ phase, ms: performance.now() - started, invoked: fs.existsSync(invoked) ? fs.readFileSync(invoked, 'utf8') : null, invoked_at: fs.existsSync(invoked) ? fs.statSync(invoked).mtimeMs : null, wall_ms: Date.now(), ...extra });
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
};
const snapshot = async phase => record(phase, { observation: core.observeSession(sid), screen: await core.readOutput(sid, { screen: true, raw: true }) });
try {
  record('before-open');
  const opened = core.openAgent('claude', { session_name: sid, agent_done: true });
  record('open-return', { opened });
  const runtimeModule = await import(pathToFileURL(path.join(source, 'dist/tmux-runtime.js')));
  fs.copyFileSync(path.join(runtimeModule.SOCKDIR, sid + '.lastcmd'), path.join(output, 'launch-command.txt'));
  const pending = Promise.allSettled([core.sendAgentMessage(sid, 'echo BOUNDARY_ONE'), core.sendAgentMessage(sid, 'echo BOUNDARY_TWO')]);
  await new Promise(r => setTimeout(r, 300));
  record('before-control-print');
  core.send(sid, agentFixturePrint('Claude Code\n❯ ready\n'), { force: true, raw: true, preserveAgentOperation: true });
  record('after-control-print');
  const settled = await pending;
  record('settled', { sends: settled.map(x => x.status === 'fulfilled' ? { status: x.status, receipt: x.value } : { status: x.status, error: x.reason.message }) });
  if (settled.some(row => row.status === 'rejected')) process.exitCode = 1;
  for (let i = 0; i < 100 && !fs.existsSync(invoked); i++) await new Promise(r => setTimeout(r, 100));
  await snapshot('final');
  const processModule = await import(pathToFileURL(path.join(source, 'dist/process-runtime.js')));
  const live = core.observeSession(sid), rows = processModule.readRuntimeProcesses();
  record('native-processes', { processes: live.pane_process ? processModule.processSubtree(rows, live.pane_process.pid) : [] });
  fs.copyFileSync(path.join(runtimeModule.SOCKDIR, sid + '.log'), path.join(output, 'pane.log'));
} catch (error) { record('error', { message: error.message, stack: error.stack }); process.exitCode = 1; }
finally {
  try { record('close', { receipt: core.closeSessionResult(sid) }); } catch (e) { record('close-error', { message: e.message }); process.exitCode = 1; }
  const exists = core.observeSessionGeneration(sid).exists;
  record('finished', { exists });
  if (exists) process.exitCode = 1;
  console.log(JSON.stringify({ stages: result.stages.map(x => ({ phase: x.phase, ms: x.ms, invoked: x.invoked, sends: x.sends, message: x.message })) }));
}
