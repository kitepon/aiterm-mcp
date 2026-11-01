import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capturePtyFailure } from './pty-failure-evidence.mjs';

const backend = process.platform === 'win32' ? 'psmux' : 'tmux';
const available = cp.spawnSync(backend, ['-V']).status === 0;
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'at-composer-'));
const core = await import('../dist/core.js');
const actualSpawn = cp.spawnSync;
const quote = text => "'" + text.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";

for (const [suffix, body] of [['single', '日本語の本文'], ['multiline', "日本語\n2行目'$変数"]]) {
  test(`agent composer ${suffix}: stale PowerShell foreground does not rewrite sanitized TUI bytes`, { skip: !available }, async (t) => {
    const name = 'composer_' + suffix;
    const output = path.join(process.env.TMPDIR, suffix + '.bin');
    const payload = '\x1b[31m' + body + '\x1b[0m';
    const expected = Buffer.from('\x1b[200~' + body + '\x1b[201~');
    core.openSession(name);
    try {
      // This reader is the synthetic TUI. Inspect its actual input bytes,
      // independent of shell echo and of the cached foreground process name.
      core.send(name, `stty raw -echo; printf 'COMPOSER_%s\\n' READY; dd bs=1 count=${expected.length} of=${quote(output)} 2>/dev/null; stty sane; printf 'COMPOSER_%s\\n' DONE`, { raw: true, force: true });
      const ready = await core.readOutput(name, { wait: true, timeout: 5, until: 'COMPOSER_READY', raw: true });
      assert.match(ready, /COMPOSER_READY/);
      cp.spawnSync = function(command, args, options) {
        if (args?.includes('#{pane_current_command}')) return { status: 0, stdout: 'pwsh\n', stderr: '' };
        return actualSpawn.call(this, command, args, options);
      };
      syncBuiltinESMExports();
      try {
        core.send(name, payload, { force: true, enter: false, bracketedPaste: true });
      } finally {
        cp.spawnSync = actualSpawn;
        syncBuiltinESMExports();
      }
      await core.readOutput(name, { wait: true, timeout: 5, until: 'COMPOSER_DONE', raw: true });
      assert.deepEqual(fs.readFileSync(output), expected, 'TUI receives one paste with sanitized original text, without shell syntax');
    } catch (error) {
      t.diagnostic(JSON.stringify(await capturePtyFailure(core, name, { boundary: 'composer setup or payload' })));
      throw error;
    } finally { core.closeSession(name); }
  });
}
