import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [source, output, mode = 'parent'] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
if (mode.endsWith('parent')) {
  const cases = mode === 'load-parent' ? Array.from({ length: 16 }, (_, i) => `${i < 8 ? 'pwsh-long' : i < 12 ? 'pwsh-short' : 'bash-long'}-${i}`)
    : ['bash-short', 'bash-long', 'pwsh-short', 'pwsh-long'];
  const children = cases.map(kind => new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(source, 'test/seat-env.mjs')).href, import.meta.filename, source, output, kind], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    child.on('close', code => { fs.writeFileSync(path.join(output, kind + '.log'), log); resolve({ kind, code }); });
  }));
  const exits = await Promise.all(children);
  console.log(JSON.stringify({ node: process.version, exits }));
  for (const { kind } of exits) {
    const file = path.join(output, kind + '.json');
    if (fs.existsSync(file)) console.log('DIAG_RESULT ' + fs.readFileSync(file, 'utf8').replace(/\n/g, ' '));
    else console.log('DIAG_DRIVER_ERROR ' + kind + ' ' + fs.readFileSync(path.join(output, kind + '.log'), 'utf8'));
  }
  assert(exits.every(row => row.code === 0), 'one or more diagnostic children failed');
} else {
  assert.equal(process.platform, 'win32');
  const core = await import(pathToFileURL(path.join(source, 'dist/core.js')));
  const rt = await import(pathToFileURL(path.join(source, 'dist/tmux-runtime.js')));
  const [shell, size] = mode.split('-');
  const sid = 'boundary';
  const at = performance.now();
  const result = { mode, runtime: process.env.XDG_RUNTIME_DIR, trace: [], source, timing_origin: 'core.send return before diagnostic probes' };
  const note = (phase, value = {}) => { result.trace.push({ phase, ms: performance.now() - at, ...value }); fs.writeFileSync(path.join(output, mode + '.json'), JSON.stringify(result, null, 2)); };
  const marker = 'BOUNDARY_EXEC_' + mode;
  const target = path.join(process.env.XDG_RUNTIME_DIR, 'executed.txt');
  const value = size === 'long' ? 'x'.repeat(255) + 'あ' + 'x'.repeat(5744) : 'abcあdef';
  const command = shell === 'pwsh'
    ? `$v='${value}'; [IO.File]::WriteAllText('${target.replaceAll("'", "''")}', $v); [Console]::WriteLine('${marker}')`
    : `v='${value}'; printf '%s' "$v" > '${target.replaceAll('\\', '/')}'; printf '\\n${marker}\\n'`;
  const log = () => { try { return fs.readFileSync(path.join(rt.SOCKDIR, sid + '.log'), 'utf8'); } catch { return ''; } };
  const screen = () => rt.tmuxCommand(false, 'capture-pane', '-p', '-J', '-t', sid, '-S', '-20').stdout;
  try {
    note('open-start'); core.openSession(sid, shell); note('open-return');
    note('send-start', { chars: command.length }); core.send(sid, command);
    const returned = performance.now();
    note('send-return', { send_return_ms: returned - at });
    let ended = false;
    for (let i = 0; performance.now() - returned < 15000; i++) {
      const exists = fs.existsSync(target), text = log();
      const match = text.includes(marker);
      if (i === 0 || exists || match || i % 10 === 0) note('observe', { file_exists: exists, marker: match, log_bytes: Buffer.byteLength(text), since_send_ms: performance.now() - returned });
      if (exists && match) { result.executed = fs.readFileSync(target, 'utf8'); result.exact = result.executed === value; result.within_original_5s = performance.now() - returned < 5000; ended = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }
    result.observed_completion = ended;
    if (!result.exact || !result.within_original_5s) process.exitCode = 1;
    note('final', { screen: screen() });
    fs.writeFileSync(path.join(output, mode + '.pane.log'), log());
  } catch (e) { note('error', { message: e.message, stack: e.stack }); process.exitCode = 1; }
  finally {
    try { core.closeSession(sid); note('closed'); } catch (e) { note('close-error', { message: e.message }); process.exitCode = 1; }
  }
}
