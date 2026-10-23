import './seat-env.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A cold macOS server starts through launchd, outside the test's spawnSync spy.
// Observe the actual executable in both paths without pre-seeding a server.
export function installNativeTmuxCreationTrace() {
  if (process.platform === 'win32') return { reset() {}, count: () => 0 };
  const real = process.env.AITERM_TMUX ?? execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim();
  const binary = join(process.env.HOME, 'fixture-tmux-trace');
  const log = join(process.env.HOME, 'fixture-tmux-creations.log');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(binary, '#!/bin/sh\n' +
    'for arg do\n' +
    `  if [ "$arg" = new-session ]; then printf '%s\\n' new-session >> ${quote(log)}; fi\n` +
    'done\n' +
    `exec ${quote(real)} "$@"\n`, { mode: 0o700 });
  process.env.AITERM_TMUX = binary;
  return {
    reset() { writeFileSync(log, ''); },
    count() { return readFileSync(log, 'utf8').split('\n').filter(line => line === 'new-session').length; },
  };
}
