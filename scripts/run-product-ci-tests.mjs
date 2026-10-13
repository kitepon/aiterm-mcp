#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 端末の本体（tmux・psmux）が見えないrunnerでは、端末を使う試験が「未インストール」で飛ぶだけになり、CIが緑のまま通る。
// 試験と同じ見つけ方で先に確かめ、見えない時は落とす（runnerの利用者やPATHが替わった時の取りこぼしを防ぐ）。
function requireTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr?.trim() || `exit ${result.status}`);
    throw new Error(`${command} を実行できません。runnerのPATHから見えるようにしてください: ${reason}`);
  }
  console.log(`${command}: ${result.stdout.trim().split(/\r?\n/)[0]}`);
}
function requireTerminalBackend() {
  if (process.platform === 'win32') {
    requireTool('psmux', ['-V']);
    requireTool('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  } else {
    requireTool('tmux', ['-V']);
  }
}

const scope = process.env.PRODUCT_CI_TEST_SCOPE;
const build = () => {
  run(process.execPath, ['scripts/clean-build.mjs']);
  run(process.execPath, ['node_modules/typescript/bin/tsc']);
};
if (scope === 'all') {
  requireTerminalBackend();
  build();
  const files = [
    'scripts/verify-release-commit.test.mjs',
    ...readdirSync('test').filter((file) => file.endsWith('.test.mjs')).map((file) => `test/${file}`),
  ];
  run(process.execPath, ['--import', './test/seat-env.mjs', '--test', ...files]);
} else if (scope === 'metadata') {
  build();
  run(process.execPath, ['--import', './test/seat-env.mjs', '--test', 'test/release-metadata.test.mjs', 'test/repository-contract.test.mjs']);
} else if (scope === 'selected') {
  const files = JSON.parse(process.env.PRODUCT_CI_TEST_FILES ?? '[]');
  // 空の名前、試験fileでない名前、無いfileを`node --test`へ渡さない。空の引数は、file systemの根から試験fileを拾わせる。
  const isTestFile = (file) => typeof file === 'string' && /^(?:test|scripts)\/(?:[\w-]+\/)*[\w.-]+\.test\.mjs$/.test(file)
    && statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  if (!Array.isArray(files) || files.length === 0 || !files.every(isTestFile)) {
    throw new Error('PRODUCT_CI_TEST_FILES が不正です');
  }
  requireTerminalBackend();
  build();
  run(process.execPath, ['--import', './test/seat-env.mjs', '--test', ...files]);
} else {
  throw new Error(`PRODUCT_CI_TEST_SCOPE が不正です: ${scope || '未指定'}`);
}
