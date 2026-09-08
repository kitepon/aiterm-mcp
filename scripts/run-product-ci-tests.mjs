#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const scope = process.env.PRODUCT_CI_TEST_SCOPE;
const build = () => {
  run(process.execPath, ['scripts/clean-build.mjs']);
  run(process.execPath, ['node_modules/typescript/bin/tsc']);
};
if (scope === 'all') {
  build();
  const files = [
    'scripts/verify-release-commit.test.mjs',
    ...readdirSync('test').filter((file) => file.endsWith('.test.mjs')).map((file) => `test/${file}`),
  ];
  run(process.execPath, ['--test', ...files]);
} else if (scope === 'metadata') {
  build();
  run(process.execPath, ['--test', 'test/release-metadata.test.mjs', 'test/repository-contract.test.mjs']);
} else if (scope === 'selected') {
  const files = JSON.parse(process.env.PRODUCT_CI_TEST_FILES ?? '[]');
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
    throw new Error('PRODUCT_CI_TEST_FILES が不正です');
  }
  build();
  run(process.execPath, ['--test', ...files]);
} else {
  throw new Error(`PRODUCT_CI_TEST_SCOPE が不正です: ${scope || '未指定'}`);
}
