import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyInstallCommand } from '../dist/setup-platform.js';
import { psmuxVersionSupported } from '../dist/tmux-runtime.js';

test('psmux自身の版数だけで公開最低版を確認する', () => {
  assert.equal(psmuxVersionSupported('tmux 3.3.8\npsmux 3.3.8 (Windows)\n'), true);
  assert.equal(psmuxVersionSupported('tmux 3.3.8\npsmux 3.3.7 (Windows)\n'), false);
  assert.equal(psmuxVersionSupported('tmux 3.3.8\n'), false);
  assert.equal(psmuxVersionSupported('psmux 3.10.0\n'), true);
  assert.equal(psmuxVersionSupported('psmux 4.0.0\n'), true);
});

test('OS依存の導入は公式package managerへ限定する', () => {
  assert.deepEqual(dependencyInstallCommand('linux', 'tmux', 'ubuntu'), ['sudo', ['-n', 'apt-get', 'install', '--no-remove', '-y', 'tmux']]);
  assert.throws(() => dependencyInstallCommand('linux', 'tmux', 'unknown'), /対応していません/);
  assert.equal(dependencyInstallCommand('darwin', 'tmux')[1].join(' '), 'install tmux');
  assert.equal(dependencyInstallCommand('win32', 'psmux')[0], 'winget.exe');
  assert.ok(dependencyInstallCommand('win32', 'psmux')[1].includes('marlocarlo.psmux'));
});
