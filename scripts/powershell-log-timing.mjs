// Temporary diagnostic: record only arrival times for the synthetic PowerShell fixture.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, dirname } from 'node:path';

const strip = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
function sample(row, raw, at, marker) {
  const text = strip(raw);
  if (raw.length && row.first_bytes_at === null) row.first_bytes_at = at;
  if (text.includes("'))))") && row.input_line_at === null) row.input_line_at = at;
  if (text.includes(row.expected) && row.result_at === null) row.result_at = at;
  if (/^[0-9a-f]{32}$/.test(marker) && new RegExp(`<<<AITERM_DONE rc=\\d+>>> id=${marker}`).test(text) && row.mark_at === null) row.mark_at = at;
  row.bytes = Buffer.byteLength(raw);
}
const rowFor = (phase, expected, at) => ({ phase, expected, command_seen_at: at,
  first_bytes_at: null, input_line_at: null, result_at: null, mark_at: null, bytes: 0 });

if (process.argv[2] === '--self-check') {
  const row = rowFor('persist', 'PERSIST=50', 0);
  const id = '1'.repeat(32);
  sample(row, "\x1b[37m. ('incomplete", 1, id);
  assert.equal(row.input_line_at, null);
  sample(row, ". ('payload'))))", 2, id);
  assert.equal(row.input_line_at, 2);
  sample(row, `PERSIST=50\x1b[30;1H<<<AITERM_DONE rc=0>>> id=${id}\r`, 3, '2'.repeat(32));
  assert.equal(row.result_at, 3);
  assert.equal(row.mark_at, null);
  sample(row, `PERSIST=50\x1b[30;1H<<<AITERM_DONE rc=0>>> id=${id}\r`, 4, id);
  assert.equal(row.mark_at, 4);
  assert(!JSON.stringify(row).includes(id));
  console.log('PowerShell timing parser assertions passed');
} else {
  const [directory, session, receipt] = process.argv.slice(2);
  assert(isAbsolute(directory) && session === 'powershell_multiline_order' && isAbsolute(receipt));
  assert(dirname(receipt) === directory, 'receipt must stay beside the owned log');
  const file = suffix => join(directory, session + suffix);
  const read = path => { try { return readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
  const rows = [];
  let current = null;
  let marker = '';
  let offset = 0;
  let stopped = false;
  function tick() {
    const command = read(file('.lastcmd'));
    const phase = command.includes('PERSIST=') ? 'persist' : command.includes('SUM=') ? 'sum' : command.includes('準備') ? 'warm' : null;
    if (!phase) return;
    if (current?.phase !== phase) {
      current = rowFor(phase, {warm:'準備完了',sum:'SUM=50',persist:'PERSIST=50'}[phase], Date.now());
      rows.push(current);
      offset = Number(read(file('.offset'))) || 0;
      marker = '';
    }
    const raw = read(file('.log'));
    assert(Buffer.byteLength(raw) <= 512 * 1024, 'fixture log exceeded diagnostic bound');
    const pending = read(file('.mark')).trim();
    if (/^[0-9a-f]{32}$/.test(pending)) marker = pending;
    sample(current, Buffer.from(raw).subarray(offset).toString('utf8'), Date.now(), marker);
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    tick();
    writeFileSync(receipt, JSON.stringify({schema:'aiterm.powershell-log-timing.v1',rows:rows.map(({expected,...row})=>row)})+'\n');
    process.stdin.destroy();
  }
  const timer = setInterval(tick, 20);
  const deadline = setTimeout(stop, 30000);
  process.stdin.resume();
  process.stdin.on('end', stop);
}
