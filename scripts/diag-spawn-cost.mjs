import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));

export function targetTest(context, entry, repository) {
  if (!context || !entry) return false;
  try {
    const file = fs.realpathSync.native(entry);
    const relative = path.relative(fs.realpathSync.native(repository), file).split(path.sep).join('/');
    return /^(?:test|scripts)\/(?:[\w-]+\/)*[\w.-]+\.test\.mjs$/.test(relative) && fs.statSync(file).isFile();
  } catch { return false; }
}

export function category(command, args) {
  const name = typeof command === 'string' ? command.split(/[\\/]/).at(-1).toLowerCase() : '';
  const values = Array.isArray(args) ? args.filter(value => typeof value === 'string') : [];
  if (/^(?:pwsh|powershell)(?:\.exe)?$/.test(name)) {
    const at = values.findIndex(value => value.toLowerCase() === '-encodedcommand');
    const script = at < 0 ? '' : Buffer.from(values[at + 1] ?? '', 'base64').toString('utf16le').toLowerCase();
    if (script.includes('[diagnostics.process]::getprocessbyid')) return 'process_identity';
    if (script.includes('get-ciminstance win32_process')) return 'native_process_table';
    return 'powershell_other';
  }
  if (/^(?:psmux|tmux)(?:\.exe)?$/.test(name)) {
    const operation = values.find(value => ['capture-pane', 'list-sessions', 'display-message', 'send-keys', 'new-session', 'kill-session'].includes(value));
    return operation ? `terminal_${operation}` : 'terminal_other';
  }
  if (values.some(value => /(?:^|[\\/])psmux-send-worker\.js$/.test(value))) return 'payload_worker';
  return 'other';
}

// A normal Node child can inherit NODE_TEST_CONTEXT; its entry must also be a real repository test.
if (targetTest(process.env.NODE_TEST_CONTEXT, process.argv[1], root)) {
  const original = childProcess.spawnSync;
  const started = performance.now();
  const operations = Object.create(null);
  childProcess.spawnSync = function (...args) {
    const name = category(args[0], args[1]);
    const before = performance.now();
    try { return Reflect.apply(original, this, args); }
    finally {
      const elapsed = performance.now() - before;
      const row = operations[name] ??= { count: 0, total_ms: 0, max_ms: 0 };
      row.count++;
      row.total_ms += elapsed;
      row.max_ms = Math.max(row.max_ms, elapsed);
    }
  };
  syncBuiltinESMExports();
  process.once('exit', () => {
    const directory = path.join(root, 'test-failure-snapshots');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `spawn-cost-${process.pid}.json`), JSON.stringify({
      schema: 'aiterm.diagnostic-spawn-cost.v1', pid: process.pid,
      test_file: path.relative(root, process.argv[1]).split(path.sep).join('/'),
      duration_ms: performance.now() - started, operations,
    }, null, 2) + '\n', { mode: 0o600 });
  });
}
