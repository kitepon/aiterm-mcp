// Scalar tracing of synthetic test namespaces. No additional native commands.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const actual = cp.spawnSync;
const markerOnly = process.argv.includes('--marker-only') || process.env.AITERM_DIAGNOSTIC_MARKER_ONLY === '1';
const captureMissing = process.env.AITERM_DIAGNOSTIC_CAPTURE_MISSING === '1';
const launches = new Map();
const destination = path.join(process.cwd(), `startup-trace-${process.pid}.jsonl`);
const actualWrite = fs.writeFileSync;
const invocationPath = path.join(process.cwd(), `fixture-invocations-${process.pid}.log`);
const invocationLog = invocationPath.replaceAll('\\', '/').replaceAll("'", "'\\''");
fs.writeFileSync = function(file, data, ...options) {
  if (typeof file === 'string' && ['print-argv.sh', 'fake-claude.sh'].includes(path.basename(file)) && typeof data === 'string' && data.startsWith('#!/bin/sh\n')) {
    const record = phase => `if [ -n "$AITERM_SESSION_ID" ] && [ -n "$AITERM_AGENT_LAUNCH_ID" ]; then printf '%s %s %s\\n' '${phase}' "$AITERM_SESSION_ID" "$AITERM_AGENT_LAUNCH_ID" >> '${invocationLog}'; fi\n`;
    data = data.replace('#!/bin/sh\n', '#!/bin/sh\n' + record('START')) + record('END');
  }
  return actualWrite.call(this, file, data, ...options);
};
function snapshot(namespace) {
  if (!/^aiterm-[0-9a-f]+$/.test(namespace)) return [];
  const dir = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
  try {
    return fs.readdirSync(dir).filter(name => name.startsWith(namespace + '__') && name.endsWith('.pid')).map(name => {
      const anchor = fs.readFileSync(path.join(dir, name), 'utf8').trim();
      const pid = Number(anchor.split(':')[0]);
      let alive = null;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code === 'ESRCH') alive = false; }
      }
      const base = name.slice(0, -4);
      return { base, anchor, alive, port: fs.existsSync(path.join(dir, base + '.port')), key: fs.existsSync(path.join(dir, base + '.key')) };
    });
  } catch { return []; }
}
function capturedText(text) {
  const plain = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  return { bytes: Buffer.byteLength(text), argv: text.includes('<arg>'), done: text.includes('<<<AITERM_FAKE_ARGV_DONE>>>'),
    shellPrompt: /\$\s*$/.test(plain), syntaxError: /syntax error/i.test(text) };
}
function captureAtCleanup(command, args, namespace) {
  if (!captureMissing || args[args.indexOf('-L') + 2] !== 'kill-session') return;
  const target = String(args[args.indexOf('-t') + 1] || '').replace(/^=/, '').replace(/:$/, '');
  const launch = launches.get(namespace + '__' + target);
  if (!launch || launch.inputClass !== 'argv-fixture') return;
  const root = process.env.TMPDIR || process.env.TEMP;
  const log = path.join(root, 'claude-tmux-sockets', target + '.log');
  let text = '';
  try { text = fs.readFileSync(log, 'utf8'); } catch {}
  if (text.includes('<<<AITERM_FAKE_ARGV_DONE>>>')) return;
  const before = snapshot(namespace).find(row => row.base === namespace + '__' + target);
  const point = { operation: 'missing-argv-at-cleanup', namespace, launchId: launch.launchId,
    sameGenerationBeforeCapture: !!before?.anchor && before.anchor === launch.anchor, log: capturedText(text) };
  try {
    point.invocationStarted = fs.readFileSync(invocationPath, 'utf8').includes('START ' + target + ' ' + launch.launchId);
    point.invocationEnded = fs.readFileSync(invocationPath, 'utf8').includes('END ' + target + ' ' + launch.launchId);
  } catch { point.invocationStarted = null; point.invocationEnded = null; }
  // Only after the original read and immediately before its existing cleanup.
  // One read-only capture; no send, retry, or replacement-generation action.
  if (point.sameGenerationBeforeCapture) {
    const read = actual.call(cp, command, ['-L', namespace, 'capture-pane', '-p', '-t', target], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    point.captureStatus = read.status; point.pane = capturedText(String(read.stdout || ''));
    point.sameGenerationAfterCapture = snapshot(namespace).find(row => row.base === namespace + '__' + target)?.anchor === before.anchor;
  }
  fs.appendFileSync(destination, JSON.stringify(point) + '\n');
}
cp.spawnSync = function(command, args = [], options) {
  const executable = path.basename(String(command)).toLowerCase();
  const psmux = executable === 'psmux' || executable === 'psmux.exe';
  const worker = executable.startsWith('node') && String(args[0]).endsWith('psmux-send-worker.js');
  const namespace = psmux ? args[args.indexOf('-L') + 1] : worker ? String(args[1]).split('__')[0] : null;
  if (psmux && namespace && /^aiterm-[0-9a-f]+$/.test(namespace)) captureAtCleanup(command, args, namespace);
  if ((markerOnly && !worker) || !namespace || !/^aiterm-[0-9a-f]+$/.test(namespace)) return actual.call(this, command, args, options);
  const before = markerOnly ? [] : snapshot(namespace);
  const started = performance.now();
  const result = actual.call(this, command, args, options);
  const event = { parent: process.pid, at: Math.round(started), elapsed: Math.round(performance.now() - started),
    operation: worker ? 'payload-worker' : args[args.indexOf('-L') + 2], namespace,
    status: result.status, errorCode: result.error?.code ?? null,
    noServer: /no server running/i.test(String(result.stderr)), before, after: markerOnly ? [] : snapshot(namespace) };
  if (worker) {
    const input = options?.input == null ? '' : Buffer.from(options.input).toString('utf8');
    event.launchId = /AITERM_AGENT_LAUNCH_ID=['"]?([0-9a-f]{32})/.exec(input)?.[1] ?? null;
    event.inputBytes = Buffer.byteLength(input);
    if (captureMissing && event.launchId) {
      event.inputClass = input.includes('print-argv.sh') ? 'argv-fixture' : 'other-fixture';
      const base = String(args[1]);
      const anchor = snapshot(namespace).find(row => row.base === base)?.anchor ?? null;
      launches.set(base, { launchId: event.launchId, inputClass: event.inputClass, anchor });
    }
  }
  fs.appendFileSync(destination, JSON.stringify(event) + '\n');
  return result;
};
syncBuiltinESMExports();
