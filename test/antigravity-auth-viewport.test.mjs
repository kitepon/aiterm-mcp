import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('AGY auth exposes the empty code field without paging keys at startup', {
  skip: process.platform === 'win32' || spawnSync('tmux', ['-V']).status !== 0,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-viewport-'));
  Object.assign(process.env, {HOME: root, TMPDIR: root, XDG_RUNTIME_DIR: root});
  const bin = path.join(root, 'agy');
  fs.writeFileSync(bin, `#!/bin/bash
if [ "$1" = models ]; then printf 'Please sign in to view available models\\n' >&2; exit 1; fi
read -r rows columns < <(stty size)
if [ "$rows" -ge 60 ] && [ "$columns" -ge 120 ]; then
 printf 'https://accounts.google.com/o/oauth2/auth?client_id=fixture\\n\\nauthorization code...\\n'
else
 printf 'https://accounts.google.com/o/oauth2/auth?client_id=fixture\\n(1–20 of 24 lines)\\nshift+up/down Navigate\\n'
fi
IFS= read -r unexpected
printf 'unexpected input' > '${root}/input'
`, {mode: 0o755});
  process.env.ANTIGRAVITY_BIN = bin;
  const core = await import('../dist/core.js');
  let session;
  try {
    const r = await core.authenticateAgent('antigravity', {action: 'start', cwd: root});
    session = r.session_id;
    assert.ok(session);
    assert.equal(r.auth_ui.stage, 'paste_code');
    assert.equal(r.auth_ui.input, 'authorization_code');
    assert.ok(r.auth_ui.binding.launch_id);
    assert.match(r.auth_ui.prompt_digest, /^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(path.join(root, 'input')), false);
  } finally {
    if (session) await core.authenticateAgent('antigravity', {action: 'cancel', session_id: session});
    fs.rmSync(root, {recursive: true, force: true});
  }
});
