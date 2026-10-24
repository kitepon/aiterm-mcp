// Scalar tracing of synthetic test namespaces. No additional native commands.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const actual = cp.spawnSync;
const destination = path.join(process.cwd(), `startup-trace-${process.pid}.jsonl`);
const actualWrite = fs.writeFileSync;
const invocationLog = path.join(process.cwd(), `fixture-invocations-${process.pid}.log`).replaceAll('\\', '/').replaceAll("'", "'\\''");
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
cp.spawnSync = function(command, args = [], options) {
  const executable = path.basename(String(command)).toLowerCase();
  const psmux = executable === 'psmux' || executable === 'psmux.exe';
  const worker = executable.startsWith('node') && String(args[0]).endsWith('psmux-send-worker.js');
  const namespace = psmux ? args[args.indexOf('-L') + 1] : worker ? String(args[1]).split('__')[0] : null;
  if (!namespace || !/^aiterm-[0-9a-f]+$/.test(namespace)) return actual.call(this, command, args, options);
  const before = snapshot(namespace);
  const started = performance.now();
  const result = actual.call(this, command, args, options);
  const event = { parent: process.pid, at: Math.round(started), elapsed: Math.round(performance.now() - started),
    operation: worker ? 'payload-worker' : args[args.indexOf('-L') + 2], namespace,
    status: result.status, errorCode: result.error?.code ?? null,
    noServer: /no server running/i.test(String(result.stderr)), before, after: snapshot(namespace) };
  if (worker) {
    const input = options?.input == null ? '' : Buffer.from(options.input).toString('utf8');
    event.launchId = /AITERM_AGENT_LAUNCH_ID=['"]?([0-9a-f]{32})/.exec(input)?.[1] ?? null;
    event.inputBytes = Buffer.byteLength(input);
  }
  fs.appendFileSync(destination, JSON.stringify(event) + '\n');
  return result;
};
syncBuiltinESMExports();
