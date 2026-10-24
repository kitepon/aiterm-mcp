import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';

test('bounded worker stdin integrity with inherited versus removed test context', () => {
  const original = fs.readFileSync(path.join(process.cwd(), 'dist/psmux-send-worker.js'), 'utf8');
  const end = original.indexOf('function psmuxDataDir()');
  assert.ok(end > 0);
  const worker = path.join(process.env.TEMP, 'stdin-only-worker.mjs');
  fs.writeFileSync(worker, 'import { createHash } from "node:crypto";\n' + original.slice(0, end) + '\nconst payload = await readPayload(); process.stdout.write(JSON.stringify({ bytes: payload.length, sha256: createHash("sha256").update(payload).digest("hex") }));\n');
  const input = Buffer.alloc(1151, 0x61);
  const expectedHash = createHash('sha256').update(input).digest('hex');
  const observations = [];
  try {
    for (const mode of ['inherited', 'removed']) {
      for (let trial = 0; trial < 6; trial++) {
        const env = { ...process.env };
        if (mode === 'removed') delete env.NODE_TEST_CONTEXT;
        const result = cp.spawnSync(process.execPath, [worker], { input, env, encoding: 'utf8', maxBuffer: 65536, windowsHide: true });
        let received = null;
        try { received = JSON.parse(result.stdout); } catch {}
        const row = { mode, trial, parentContext: process.env.NODE_TEST_CONTEXT ?? null,
          status: result.status, bytes: received?.bytes ?? null, digestMatches: received?.sha256 === expectedHash,
          stderrPresent: !!result.stderr, errorCode: result.error?.code ?? null };
        observations.push(row);
        if (result.status !== 0 || row.bytes !== input.length || !row.digestMatches) break;
      }
    }
    console.log('STDIN_INTEGRITY_RESULT=' + JSON.stringify({ observations, productNativeEffects: 0 }));
    assert.ok(observations.every(row => row.status === 0 && row.bytes === input.length && row.digestMatches));
  } finally { fs.rmSync(worker, { force: true }); }
});
