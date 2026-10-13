import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  ALL_ENVIRONMENTS,
  PUSH_ENVIRONMENTS,
  classifyPaths,
  priorFullEnvironments,
  selectTestFiles,
  verifyResults,
} from '../scripts/product-ci-plan.mjs';

const SCRIPT = resolve(import.meta.dirname, '..', 'scripts', 'product-ci-plan.mjs');

// CIの端末で流す時、この試験のprocessはGitHub Actionsの変数（今の実行の番号、repository）を持っている。
// 計画の道具へそのまま渡すと、試験が本物のGitHubへ聞きに行く。渡すのは試験が決めた値だけにする。
function planEnvironment(extra) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GITHUB_')));
  return { ...inherited, ...extra };
}

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
    env: planEnvironment({
      EVENT_NAME: 'schedule',
      BEFORE_SHA: '',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: output,
      REQUESTED_ENVIRONMENT: 'all',
    }),
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
      env: planEnvironment({ EVENT_NAME: 'push', BEFORE_SHA: comparison, GITHUB_SHA: git(repo.root, 'rev-parse', 'HEAD'), GITHUB_OUTPUT: output }),
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
    env: planEnvironment({
      EVENT_NAME: 'push',
      BEFORE_SHA: repo.base,
      BASE_SHA: '',
      DISPATCH_BASE: '',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: output,
      REQUESTED_ENVIRONMENT: 'all',
    }),
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
    env: planEnvironment({
      EVENT_NAME: 'push',
      BEFORE_SHA: '0'.repeat(40),
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: join(repo.root, 'github-output.txt'),
      REQUESTED_ENVIRONMENT: 'all',
    }),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CI comparison baseが必要です/u);
});

// ここから: 同じcommitの全テストがもう通っている環境は、pushで流さない。
// 形は本物のGitHubの返り（2026-10-12、kitepon/aiterm-mcpの実行 38194000978 と 38194920001）に合わせてある。
const WORKFLOW_ID = 4242;
const fullJobs = (results) => [
  { name: 'ownership', status: 'completed', conclusion: 'success' },
  { name: 'full / classify', status: 'completed', conclusion: 'success' },
  ...Object.entries(results).map(([environment, conclusion]) => ({
    name: `full / full (${environment})`,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
  })),
  { name: 'full / gate', status: 'completed', conclusion: 'success' },
  { name: 'publish', status: 'completed', conclusion: 'skipped' },
];
const allPassed = Object.fromEntries(ALL_ENVIRONMENTS.map((environment) => [environment, 'success']));

test('同じcommitの全テストの成功は、手動実行と定期実行の環境ごとのjobで数える', () => {
  const headSha = 'a'.repeat(40);
  const run = (id, event, extra = {}) => ({ id, event, head_sha: headSha, workflow_id: WORKFLOW_ID, ...extra });
  const verified = (runs, jobs) => Object.fromEntries(priorFullEnvironments({
    runs, jobsByRun: new Map(jobs), headSha, workflowId: WORKFLOW_ID, currentRunId: 900,
  }));

  assert.deepEqual(verified([run(1, 'workflow_dispatch')], [[1, fullJobs(allPassed)]]), {
    'macos-native': 1, 'linux-workstation': 1, 'windows-native': 1,
  });
  assert.deepEqual(verified([run(2, 'schedule')], [[2, fullJobs(allPassed)]]), {
    'macos-native': 2, 'linux-workstation': 2, 'windows-native': 2,
  });
  // 1つの環境だけの手動実行は、その環境だけ。落ちた環境・動いている最中の環境は数えない。
  assert.deepEqual(verified([run(3, 'workflow_dispatch')], [[3, fullJobs({ 'windows-native': 'success' })]]), {
    'windows-native': 3,
  });
  assert.deepEqual(verified(
    [run(4, 'workflow_dispatch'), run(5, 'workflow_dispatch')],
    [
      [4, fullJobs({ 'macos-native': 'success', 'linux-workstation': 'success', 'windows-native': 'failure' })],
      [5, fullJobs({ 'windows-native': null })],
    ],
  ), { 'macos-native': 4, 'linux-workstation': 4 });
  // pushとpull requestは試験を絞る事があるので、通っていても数えない。
  assert.deepEqual(verified(
    [run(6, 'push'), run(7, 'pull_request')],
    [[6, fullJobs(allPassed)], [7, fullJobs(allPassed)]],
  ), {});
  // 別のcommit、別のworkflow、今の実行そのものは数えない。
  assert.deepEqual(verified(
    [
      run(8, 'workflow_dispatch', { head_sha: 'b'.repeat(40) }),
      run(9, 'workflow_dispatch', { workflow_id: WORKFLOW_ID + 1 }),
      run(900, 'workflow_dispatch'),
    ],
    [[8, fullJobs(allPassed)], [9, fullJobs(allPassed)], [900, fullJobs(allPassed)]],
  ), {});
  // 似た名前のjobは環境のjobではない。
  assert.deepEqual(verified([run(10, 'workflow_dispatch')], [[10, [
    { name: 'full / gate', status: 'completed', conclusion: 'success' },
    { name: 'full / full (unknown-host)', status: 'completed', conclusion: 'success' },
    { name: 'careful (windows-native)', status: 'completed', conclusion: 'success' },
  ]]]), {});
});

// GitHubの口を模したserver。聞かれた道を控える。
async function githubApi(t, { runs, jobs = {}, currentRun = { id: 900, workflow_id: WORKFLOW_ID }, status = 200 }) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization ?? null });
    const url = new URL(request.url, 'http://fixture.invalid');
    const send = (code, body) => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (status !== 200) return send(status, { message: 'fixture failure' });
    const base = '/repos/fixture/product/actions';
    if (url.pathname === `${base}/runs/${currentRun.id}`) return send(200, currentRun);
    if (url.pathname === `${base}/workflows/${WORKFLOW_ID}/runs`) {
      const headSha = url.searchParams.get('head_sha');
      return send(200, { workflow_runs: runs.filter((run) => run.head_sha === headSha) });
    }
    const jobsOf = new RegExp(`^${base}/runs/(\\d+)/jobs$`, 'u').exec(url.pathname);
    if (jobsOf && jobs[jobsOf[1]]) return send(200, { jobs: jobs[jobsOf[1]] });
    return send(404, { message: 'Not Found' });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

// 模したserverはこの試験のprocessの中に居るので、計画の道具は止めずに（非同期で）起こす。
async function pushPlan(repo, api, extra = {}) {
  const output = join(repo.root, 'github-output.txt');
  await writeFile(output, '');
  const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT, 'plan'], {
    cwd: repo.root,
    encoding: 'utf8',
    env: planEnvironment({
      EVENT_NAME: 'push',
      BEFORE_SHA: repo.base,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: repo.head,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: 'fixture/product',
      GITHUB_RUN_ID: '900',
      GITHUB_API_URL: api,
      GITHUB_TOKEN: 'fixture-token',
      ...extra,
    }),
  });
  const outputs = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n')
    .map((line) => line.split(/=(.*)/su).slice(0, 2)));
  return { stdout, outputs };
}

test('pushは、同じcommitの全テストがもう通っている環境を流さない', async (t) => {
  const repo = await repository(t);
  const run = (id, event) => ({ id, event, head_sha: repo.head, workflow_id: WORKFLOW_ID });

  // 枝で全テストを通してからmainへ早送りした時。fixtureの変更はLinuxとWindowsを選ぶ。
  const passed = await githubApi(t, { runs: [run(11, 'workflow_dispatch')], jobs: { 11: fullJobs(allPassed) } });
  const skipped = await pushPlan(repo, passed.url);
  assert.equal(skipped.outputs.product_change, 'true');
  assert.deepEqual(JSON.parse(skipped.outputs.environments), []);
  assert.deepEqual(JSON.parse(skipped.outputs.prior_full), { 'linux-workstation': 11, 'windows-native': 11 });
  assert.match(skipped.stdout, /成功済みの環境は流さない: linux-workstation=run 11, windows-native=run 11/u);
  assert.equal(passed.requests.every((request) => request.authorization === 'Bearer fixture-token'), true);
  assert.doesNotThrow(() => verifyResults({
    classifyResult: 'success',
    fullResult: 'skipped',
    productChange: skipped.outputs.product_change,
    environments: skipped.outputs.environments,
    priorFull: skipped.outputs.prior_full,
  }));

  // Windowsだけが通っている時は、残りの環境だけを流す。
  const windowsOnly = await githubApi(t, {
    runs: [run(12, 'workflow_dispatch')],
    jobs: { 12: fullJobs({ 'macos-native': 'success', 'linux-workstation': 'failure', 'windows-native': 'success' }) },
  });
  const partial = await pushPlan(repo, windowsOnly.url);
  assert.deepEqual(JSON.parse(partial.outputs.environments), ['linux-workstation']);
  assert.deepEqual(JSON.parse(partial.outputs.prior_full), { 'windows-native': 12 });

  // 同じcommitのpushの成功は、試験を絞っているかも知れないので使わない。
  const pushOnly = await githubApi(t, { runs: [run(13, 'push')], jobs: { 13: fullJobs(allPassed) } });
  const again = await pushPlan(repo, pushOnly.url);
  assert.deepEqual(JSON.parse(again.outputs.environments), ['linux-workstation', 'windows-native']);
  assert.deepEqual(JSON.parse(again.outputs.prior_full), {});
  assert.equal(pushOnly.requests.some((request) => request.url.includes('/runs/13/jobs')), false);
});

test('同じcommitの成功を確かめられない時は、選んだ環境を全部流す', async (t) => {
  const repo = await repository(t);
  const expectFull = (plan) => {
    assert.equal(plan.outputs.product_change, 'true');
    assert.deepEqual(JSON.parse(plan.outputs.environments), ['linux-workstation', 'windows-native']);
    assert.deepEqual(JSON.parse(plan.outputs.prior_full), {});
  };

  const failing = await githubApi(t, { runs: [], status: 500 });
  const refused = await pushPlan(repo, failing.url);
  expectFull(refused);
  assert.match(refused.stdout, /確かめられないので、試験を流す（HTTP 500 /u);

  // 口が無い（つながらない）。開いてから閉じた口なので、誰も聞いていない。
  const gone = createServer();
  await new Promise((done) => gone.listen(0, '127.0.0.1', done));
  const gonePort = gone.address().port;
  await new Promise((done) => gone.close(done));
  const closed = await pushPlan(repo, `http://127.0.0.1:${gonePort}`);
  expectFull(closed);
  assert.match(closed.stdout, /確かめられないので、試験を流す/u);

  // 今の実行のworkflowが読めない。
  const broken = await githubApi(t, { runs: [], currentRun: { id: 900 } });
  const unreadable = await pushPlan(repo, broken.url);
  expectFull(unreadable);
  assert.match(unreadable.stdout, /workflow_idが読めない/u);

  // GitHub Actionsの外（手元）では聞きに行かない。
  const untouched = await githubApi(t, { runs: [] });
  const local = await pushPlan(repo, untouched.url, { GITHUB_RUN_ID: '' });
  expectFull(local);
  assert.deepEqual(untouched.requests, []);
});

test('手動実行は、同じcommitがもう通っていても、頼まれた環境を全部流す', async (t) => {
  const repo = await repository(t);
  const api = await githubApi(t, {
    runs: [{ id: 14, event: 'workflow_dispatch', head_sha: repo.head, workflow_id: WORKFLOW_ID }],
    jobs: { 14: fullJobs(allPassed) },
  });
  const plan = await pushPlan(repo, api.url, { EVENT_NAME: 'workflow_dispatch', DISPATCH_BASE: repo.base, REQUESTED_ENVIRONMENT: 'all' });
  assert.deepEqual(JSON.parse(plan.outputs.environments), ALL_ENVIRONMENTS);
  assert.equal(plan.outputs.test_scope, 'all');
  assert.deepEqual(JSON.parse(plan.outputs.prior_full), {});
  assert.deepEqual(api.requests, []);
});

test('結果判定は、全部の環境が成功済みと分かっている時だけ、製品の変更でのfullのskipを受ける', () => {
  const skipped = { classifyResult: 'success', fullResult: 'skipped', productChange: 'true' };
  assert.doesNotThrow(() => verifyResults({ ...skipped, environments: '[]', priorFull: '{"windows-native":11}' }));
  for (const [environments, priorFull] of [
    ['[]', '{}'],
    ['[]', ''],
    ['[]', undefined],
    ['', '{"windows-native":11}'],
    ['["windows-native"]', '{"linux-workstation":11}'],
    ['[]', '{"unknown-host":11}'],
    ['[]', '{"windows-native":"11"}'],
    ['[]', '[11]'],
    ['[]', 'null'],
  ]) {
    assert.throws(
      () => verifyResults({ ...skipped, environments, priorFull }),
      /選択計画と実行結果が一致しません/u,
      `${environments} / ${priorFull}`,
    );
  }
  // 文書だけの時のskipと、流した時の成功は前と同じ。
  assert.doesNotThrow(() => verifyResults({ classifyResult: 'success', fullResult: 'skipped', productChange: 'false', environments: '["linux-workstation"]', priorFull: '{}' }));
  assert.throws(
    () => verifyResults({ classifyResult: 'success', fullResult: 'failure', productChange: 'true', environments: '[]', priorFull: '{"windows-native":11}' }),
    /選択計画と実行結果が一致しません/u,
  );
});

test('workflowは、環境が空の時にfullを起こさず、関門へ環境と成功済みの実行を渡す', async () => {
  const workflow = await readFile(resolve(import.meta.dirname, '..', '.github', 'workflows', 'product-full-ci.yml'), 'utf8');
  // 数える時のjobの名前（「full (<環境>)」）は、このjobのidとmatrixから出来る。
  assert.match(workflow, /\n  full:\n    needs: classify\n(?:    #[^\n]*\n)*    if: needs\.classify\.outputs\.product_change == 'true' && needs\.classify\.outputs\.environments != '\[\]'\n/u);
  assert.match(workflow, /environment: \$\{\{ fromJSON\(needs\.classify\.outputs\.environments\) \}\}/u);
  assert.match(workflow, /prior_full: \$\{\{ steps\.changes\.outputs\.prior_full \}\}/u);
  assert.match(workflow, /ENVIRONMENTS: \$\{\{ needs\.classify\.outputs\.environments \}\}\n\s+PRIOR_FULL: \$\{\{ needs\.classify\.outputs\.prior_full \}\}/u);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  for (const file of ['ci.yml', 'product-full-ci.yml']) {
    const source = await readFile(resolve(import.meta.dirname, '..', '.github', 'workflows', file), 'utf8');
    assert.match(source, /\npermissions:\n(?:  #[^\n]*\n)*  actions: read\n  contents: read\n/u, file);
  }
});
