import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  ALL_ENVIRONMENTS,
  PUSH_ENVIRONMENTS,
  classifyPaths,
  selectTestFiles,
  verifyResults,
} from '../scripts/product-ci-plan.mjs';

const SCRIPT = resolve(import.meta.dirname, '..', 'scripts', 'product-ci-plan.mjs');

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'aiterm-ci-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'CI test');
  git(root, 'config', 'user.email', 'ci@example.invalid');
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'initial');
  const base = git(root, 'rev-parse', 'HEAD');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'windows-powershell.ts'), '// fixture\n', 'utf8');
  git(root, 'add', 'src/windows-powershell.ts');
  git(root, 'commit', '-m', 'windows');
  return { root, base, head: git(root, 'rev-parse', 'HEAD') };
}

test('文書だけの変更はLinuxの文書検査へ分類する', () => {
  const plan = classifyPaths(['README.md', 'docs/RELEASE.md']);
  assert.equal(plan.productChange, false);
  assert.deepEqual(plan.environments, ['linux-workstation']);
});

test('Windows固有変更はLinux共通検査とWindows検査へ分類する', () => {
  const plan = classifyPaths(['src/windows-powershell.ts', 'docs/RELEASE.md']);
  assert.equal(plan.productChange, true);
  assert.deepEqual(plan.environments, ['linux-workstation', 'windows-native']);
});

test('共通変更と未分類変更はMac・Linux・Windowsへ分類する', () => {
  assert.deepEqual(PUSH_ENVIRONMENTS, ALL_ENVIRONMENTS);
  for (const paths of [['src/core.ts'], ['new-product/file.txt'], ['.github/workflows/ci.yml'], ['package.json'], []]) {
    const plan = classifyPaths(paths);
    assert.equal(plan.productChange, true);
    assert.deepEqual(plan.environments, PUSH_ENVIRONMENTS);
  }
});

test('共通変更とWindows固有変更の混在でWindowsを落とさない', () => {
  assert.deepEqual(classifyPaths(['src/core.ts', 'src/windows-powershell.ts']).environments, ALL_ENVIRONMENTS);
});

test('定期実行は全環境の全テストを選ぶ', async (t) => {
  const repo = await repository(t);
  const output = join(repo.root, 'github-output.txt');
  const result = spawnSync(process.execPath, [SCRIPT, 'plan'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      EVENT_NAME: 'schedule',
      BEFORE_SHA: '',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: output,
      REQUESTED_ENVIRONMENT: 'all',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const outputs = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n')
    .map((line) => line.split(/=(.*)/su).slice(0, 2)));
  assert.deepEqual(JSON.parse(outputs.environments), ALL_ENVIRONMENTS);
  assert.equal(outputs.test_scope, 'all');
});

test('実装変更は依存するテストだけを選ぶ', () => {
  const plan = selectTestFiles(['src/harnesses/cursor.ts'], resolve(import.meta.dirname, '..'));
  assert.equal(plan.testScope, 'selected');
  assert.deepEqual(plan.testFiles, [
    'test/cursor-agent.test.mjs',
    'test/launcher-structured.test.mjs',
  ]);
});

test('文書が混ざっても実装の関連試験を維持し文書検査を追加する', () => {
  const plan = selectTestFiles(['src/harnesses/cursor.ts', 'README.md'], resolve(import.meta.dirname, '..'));
  assert.equal(plan.testScope, 'selected');
  assert.deepEqual(plan.testFiles, ['test/cursor-agent.test.mjs', 'test/launcher-structured.test.mjs', 'test/repository-contract.test.mjs']);
});

test('plan入口は版番号だけの更新を配布確認へ絞り依存変更は全OSへ残す', async (t) => {
  const repo = await repository(t);
  const before = {
    'package.json': { name: 'fixture', version: '1.0.0', dependencies: { example: '1.0.0' } },
    'package-lock.json': { version: '1.0.0', packages: { '': { version: '1.0.0' }, 'node_modules/example': { version: '1.0.0' } } },
    'server.json': { version: '1.0.0', packages: [{ identifier: 'fixture', version: '1.0.0' }] },
    'mcpb/manifest.json': { version: '1.0.0' },
  };
  await mkdir(join(repo.root, 'mcpb'));
  for (const [file, data] of Object.entries(before)) await writeFile(join(repo.root, file), JSON.stringify(data));
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-m', '配布情報の初期値');
  const base = git(repo.root, 'rev-parse', 'HEAD');
  const after = structuredClone(before);
  for (const data of Object.values(after)) data.version = '1.0.1';
  after['package-lock.json'].packages[''].version = '1.0.1';
  after['server.json'].packages[0].version = '1.0.1';
  for (const [file, data] of Object.entries(after)) await writeFile(join(repo.root, file), JSON.stringify(data));
  await writeFile(join(repo.root, 'README.md'), '# 1.0.1\n');
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-m', '版番号更新');
  const run = async (comparison = base) => {
    const output = join(repo.root, 'github-output.txt');
    await writeFile(output, '');
    const result = spawnSync(process.execPath, [SCRIPT, 'plan'], {
      cwd: repo.root, encoding: 'utf8',
      env: { ...process.env, EVENT_NAME: 'push', BEFORE_SHA: comparison, GITHUB_SHA: git(repo.root, 'rev-parse', 'HEAD'), GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map((line) => line.split(/=(.*)/su).slice(0, 2)));
  };
  const versionOnly = await run();
  assert.equal(versionOnly.test_scope, 'metadata');
  assert.deepEqual(JSON.parse(versionOnly.environments), ['linux-workstation']);
  const addedMetadata = await run(repo.head);
  assert.equal(addedMetadata.test_scope, 'all');
  assert.deepEqual(JSON.parse(addedMetadata.environments), ALL_ENVIRONMENTS);

  after['package-lock.json'].packages['node_modules/example'].version = '2.0.0';
  await writeFile(join(repo.root, 'package-lock.json'), JSON.stringify(after['package-lock.json']));
  git(repo.root, 'add', 'package-lock.json');
  git(repo.root, 'commit', '-m', '依存の変更');
  const dependency = await run();
  assert.equal(dependency.test_scope, 'all');
  assert.deepEqual(JSON.parse(dependency.environments), ALL_ENVIRONMENTS);
  const beforeDeletion = git(repo.root, 'rev-parse', 'HEAD');
  await rm(join(repo.root, 'mcpb/manifest.json'));
  git(repo.root, 'add', 'mcpb/manifest.json');
  git(repo.root, 'commit', '-m', '配布設定の削除');
  const deletedMetadata = await run(beforeDeletion);
  assert.equal(deletedMetadata.test_scope, 'all');
  assert.deepEqual(JSON.parse(deletedMetadata.environments), ALL_ENVIRONMENTS);
});

test('依存を確定できない変更は全テストへ広げる', () => {
  assert.deepEqual(selectTestFiles(['package.json'], resolve(import.meta.dirname, '..')), {
    testScope: 'all',
    testFiles: [],
  });
});

test('結果判定は選択されたfullの成功と文書時の明示skipだけを受け入れる', () => {
  assert.doesNotThrow(() => verifyResults({
    classifyResult: 'success',
    fullResult: 'success',
    productChange: 'true',
  }));
  assert.doesNotThrow(() => verifyResults({
    classifyResult: 'success',
    fullResult: 'skipped',
    productChange: 'false',
  }));
});

test('結果判定は分類失敗と理由不明skipを拒否する', () => {
  assert.throws(() => verifyResults({
    classifyResult: 'failure',
    fullResult: 'skipped',
    productChange: '',
  }), /変更分類jobが成功していません/u);
  assert.throws(() => verifyResults({
    classifyResult: 'success',
    fullResult: 'skipped',
    productChange: 'true',
  }), /選択計画と実行結果が一致しません/u);
});

test('plan入口はGit履歴から変更を分類してGitHub outputへ書く', async (t) => {
  const repo = await repository(t);
  const output = join(repo.root, 'github-output.txt');
  const result = spawnSync(process.execPath, [SCRIPT, 'plan'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      EVENT_NAME: 'push',
      BEFORE_SHA: repo.base,
      BASE_SHA: '',
      DISPATCH_BASE: '',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: output,
      REQUESTED_ENVIRONMENT: 'all',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const outputs = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n')
    .map((line) => line.split(/=(.*)/su).slice(0, 2)));
  assert.equal(outputs.product_change, 'true');
  assert.deepEqual(JSON.parse(outputs.environments), ['linux-workstation', 'windows-native']);
  assert.equal(outputs.test_scope, 'all');
  assert.equal(outputs.comparison_base, repo.base);
});

test('plan入口はzero SHAを明示失敗にする', async (t) => {
  const repo = await repository(t);
  const result = spawnSync(process.execPath, [SCRIPT, 'plan'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      EVENT_NAME: 'push',
      BEFORE_SHA: '0'.repeat(40),
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: join(repo.root, 'github-output.txt'),
      REQUESTED_ENVIRONMENT: 'all',
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CI comparison baseが必要です/u);
});
