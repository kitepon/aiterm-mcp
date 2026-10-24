import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
assert.equal(process.platform, 'win32');
const { psmuxBin } = await import(pathToFileURL(path.join(process.cwd(), 'dist/tmux-runtime.js')));
function locate(command) {
  if (path.isAbsolute(command)) return fs.realpathSync(command);
  for (const directory of process.env.PATH.split(path.delimiter)) {
    for (const candidate of [command, command + '.exe']) {
      const file = path.join(directory, candidate);
      if (fs.existsSync(file)) return fs.realpathSync(file);
    }
  }
  throw Error('requested executable not found');
}
function attest(command) {
  const resolved = locate(command);
  const version = spawnSync(resolved, ['-V'], { encoding: 'utf8' });
  assert.equal(version.status, 0, 'version query must succeed');
  return { resolved, version: version.stdout.trim(), sha256: createHash('sha256').update(fs.readFileSync(resolved)).digest('hex') };
}
const fromPath = attest('psmux'), fromProduct = attest(psmuxBin());
const ownSession = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '[Diagnostics.Process]::GetCurrentProcess().SessionId'], { encoding: 'utf8' });
assert.equal(ownSession.status, 0);
const sessionId = Number(ownSession.stdout.trim());
assert.ok(Number.isSafeInteger(sessionId));
console.log('BACKEND_ATTESTATION=' + JSON.stringify({ schema: 'aiterm.windows-backend-attestation.v1', fromPath, fromProduct,
  sameExecutable: fromPath.resolved.toLowerCase() === fromProduct.resolved.toLowerCase(), sameBytes: fromPath.sha256 === fromProduct.sha256,
  sessionId, explicitBackendOverride: !!process.env.AITERM_PSMUX, sessionNamePresent: !!process.env.SESSIONNAME }));
