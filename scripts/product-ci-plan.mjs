#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

export const ALL_ENVIRONMENTS = Object.freeze([
  'macos-native',
  'linux-workstation',
  'windows-native',
]);

// 共通実装の変更は対応する全OSで検証する。試験の内容とOSの選択は別に決める。
export const PUSH_ENVIRONMENTS = ALL_ENVIRONMENTS;

const HOST_PATH_RULES = Object.freeze([
  Object.freeze({
    environment: 'windows-native',
    patterns: Object.freeze([
      /^src\/windows-powershell\.ts$/u,
      /^src\/psmux-send-worker\.ts$/u,
      /^test\/windows-[^/]+\.test\.mjs$/u,
    ]),
  }),
]);

const DIRECT_TEST_RULES = new Map([
  ['src/harnesses/cursor.ts', Object.freeze([
    'test/cursor-agent.test.mjs',
    'test/launcher-structured.test.mjs',
  ])],
  ['src/rtk.ts', Object.freeze([
    'test/core-readoutput.test.mjs',
    'test/core-tmux.test.mjs',
    'test/rtk.test.mjs',
  ])],
]);

export function classifyPaths(paths) {
  const normalizedPaths = [...new Set(paths)].toSorted();
  if (normalizedPaths.length === 0) return fullPlan(normalizedPaths, '差分なしを全OSの検査へ分類');
  if (normalizedPaths.every(isDocumentationPath)) {
    return Object.freeze({
      schema: 'aiterm.ci-plan.v1',
      productChange: false,
      environments: Object.freeze(['linux-workstation']),
      reason: '文書だけの変更',
      changedPaths: Object.freeze(normalizedPaths),
    });
  }

  const selected = new Set(['linux-workstation']);
  for (const path of normalizedPaths) {
    if (isDocumentationPath(path)) continue;
    const matchedRules = HOST_PATH_RULES.filter((rule) =>
      rule.patterns.some((pattern) => pattern.test(path)));
    if (matchedRules.length === 0) return fullPlan(normalizedPaths, '共通または未分類の変更を全OSの検査へ');
    for (const rule of matchedRules) selected.add(rule.environment);
  }

  return Object.freeze({
    schema: 'aiterm.ci-plan.v1',
    productChange: true,
    environments: Object.freeze(ALL_ENVIRONMENTS.filter((environment) => selected.has(environment))),
    reason: 'host固有の変更',
    changedPaths: Object.freeze(normalizedPaths),
  });
}

export function verifyResults({ classifyResult, fullResult, productChange }) {
  if (classifyResult !== 'success') {
    throw new Error(`変更分類jobが成功していません: ${classifyResult || '結果なし'}`);
  }
  if (productChange === 'true' && fullResult === 'success') return;
  if (productChange === 'false' && fullResult === 'skipped') return;
  if (productChange !== 'true' && productChange !== 'false') {
    throw new Error(`変更分類の出力が不正です: ${productChange || '出力なし'}`);
  }
  throw new Error(
    `選択計画と実行結果が一致しません: product_change=${productChange}, full=${fullResult || '結果なし'}`,
  );
}

export function selectTestFiles(changedPaths, root = process.cwd()) {
  const hasDocumentation = changedPaths.some(isDocumentationPath);
  const changed = [...new Set(changedPaths)].filter((file) => !isDocumentationPath(file)).toSorted();
  if (changed.length === 0) {
    return Object.freeze({ testScope: 'all', testFiles: Object.freeze([]) });
  }
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'buffer' })
    .toString('utf8').split('\0').filter(Boolean);
  const codeFiles = tracked.filter((file) => /\.(?:mjs|js|ts)$/u.test(file));
  const codeSet = new Set(codeFiles);
  if (changed.some((file) => !codeSet.has(file))) {
    return Object.freeze({ testScope: 'all', testFiles: Object.freeze([]) });
  }

  if (changed.every((file) => DIRECT_TEST_RULES.has(file))) {
    const direct = new Set(changed.flatMap((file) => DIRECT_TEST_RULES.get(file)));
    if (hasDocumentation) direct.add('test/repository-contract.test.mjs');
    return Object.freeze({ testScope: 'selected', testFiles: Object.freeze([...direct].toSorted()) });
  }

  const reverse = new Map();
  for (const owner of codeFiles) {
    const source = readFileSync(path.join(root, ...owner.split('/')), 'utf8');
    for (const dependency of relativeDependencies(owner, source, codeSet)) {
      const dependents = reverse.get(dependency) ?? new Set();
      dependents.add(owner);
      reverse.set(dependency, dependents);
    }
  }

  const selected = new Set(hasDocumentation ? ['test/repository-contract.test.mjs'] : []);
  for (const start of changed) {
    const queue = [start];
    const seen = new Set(queue);
    let found = false;
    while (queue.length > 0) {
      const current = queue.shift();
      if (isTestFile(current)) {
        selected.add(current);
        found = true;
      }
      for (const dependent of reverse.get(current) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        queue.push(dependent);
      }
    }
    if (!found) return Object.freeze({ testScope: 'all', testFiles: Object.freeze([]) });
  }
  return Object.freeze({ testScope: 'selected', testFiles: Object.freeze([...selected].toSorted()) });
}

function relativeDependencies(owner, source, codeSet) {
  const dependencies = new Set();
  for (const match of source.matchAll(/["'`](\.\.?\/[^"'`\r\n]+)["'`]/gu)) {
    const specifier = match[1];
    if (specifier.includes('${')) continue;
    const clean = specifier.split(/[?#]/u, 1)[0];
    const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(owner), clean));
    for (const resolved of dependencyCandidates(candidate)) {
      if (codeSet.has(resolved)) {
        dependencies.add(resolved);
        break;
      }
    }
  }
  return dependencies;
}

function dependencyCandidates(candidate) {
  const candidates = [candidate];
  if (!/\.[^/]+$/u.test(candidate)) {
    candidates.push(`${candidate}.mjs`, `${candidate}.js`, `${candidate}.ts`);
  }
  if (candidate.startsWith('src/') && candidate.endsWith('.js')) {
    candidates.push(candidate.replace(/\.js$/u, '.ts'));
  }
  if (candidate.startsWith('dist/') && candidate.endsWith('.js')) {
    candidates.push(`src/${candidate.slice('dist/'.length, -'.js'.length)}.ts`);
  }
  return candidates;
}

function isTestFile(file) {
  return /(?:^|\/)[^/]+\.test\.mjs$/u.test(file);
}

function isDocumentationPath(path) {
  return /\.(?:md|mdc)$/u.test(path);
}

function fullPlan(paths, reason, environments = PUSH_ENVIRONMENTS) {
  return Object.freeze({
    schema: 'aiterm.ci-plan.v1',
    productChange: true,
    environments,
    reason,
    changedPaths: Object.freeze(paths),
  });
}

function isVersionOnlyChange(paths, base, head) {
  const jsonPaths = paths.filter((file) => !isDocumentationPath(file));
  const releasePaths = new Set(['package.json', 'package-lock.json', 'server.json', 'mcpb/manifest.json']);
  if (jsonPaths.length === 0 || jsonPaths.some((file) => !releasePaths.has(file))) return false;
  // 配布設定の追加・削除は版番号更新ではない。存在しないrevisionのJSONを読まない。
  if (git(['diff', '--no-renames', '--name-only', '--diff-filter=AD', base, head, '--', ...jsonPaths]).trim()) return false;
  const withoutVersion = (revision, file) => {
    const data = JSON.parse(git(['show', `${revision}:${file}`]));
    delete data.version;
    if (file === 'package-lock.json') delete data.packages[''].version;
    if (file === 'server.json') for (const pkg of data.packages) delete pkg.version;
    return data;
  };
  return jsonPaths.every((file) => isDeepStrictEqual(withoutVersion(base, file), withoutVersion(head, file)));
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveCommit(revision) {
  try {
    return git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
  } catch (error) {
    throw new Error(
      `CI comparison baseをcommitとして解決できません: ${revision} (${error.stderr?.trim() || error.message})`,
    );
  }
}

function comparisonBase(environment) {
  if (environment.EVENT_NAME === 'pull_request') return environment.BASE_SHA;
  if (environment.EVENT_NAME === 'push') return environment.BEFORE_SHA;
  if (environment.EVENT_NAME === 'workflow_dispatch') return environment.DISPATCH_BASE;
  throw new Error(`未対応のGitHub Actions eventです: ${environment.EVENT_NAME || '未指定'}`);
}

function requestedEnvironments(requested) {
  if (requested === 'all') return ALL_ENVIRONMENTS;
  if (ALL_ENVIRONMENTS.includes(requested)) return Object.freeze([requested]);
  throw new Error(`未対応の工場環境です: ${requested || '未指定'}`);
}

function createPlan(environment) {
  if (environment.EVENT_NAME === 'schedule') {
    return {
      ...fullPlan([], '定期健康診断', ALL_ENVIRONMENTS),
      comparisonBase: resolveCommit(environment.GITHUB_SHA),
      testScope: 'all',
      testFiles: [],
    };
  }
  const baseInput = comparisonBase(environment);
  if (!baseInput || /^0+$/u.test(baseInput)) {
    throw new Error(
      `CI comparison baseが必要です: event=${environment.EVENT_NAME || '未指定'}, base=${baseInput || '未指定'}`,
    );
  }
  const base = resolveCommit(baseInput);
  const head = resolveCommit(environment.GITHUB_SHA);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' });
  if (base === head || ancestry.status !== 0) {
    throw new Error(`CI comparison baseはHEADより前のancestorでなければなりません: base=${base}, head=${head}`);
  }

  if (environment.EVENT_NAME === 'workflow_dispatch') {
    return {
      ...fullPlan([], '手動実行', requestedEnvironments(environment.REQUESTED_ENVIRONMENT)),
      comparisonBase: base,
      testScope: 'all',
      testFiles: [],
    };
  }

  const raw = git(['diff', '--no-renames', '--name-only', '-z', base, head], { encoding: 'buffer' });
  const paths = raw.toString('utf8').split('\0').filter((path) => path.length > 0);
  if (isVersionOnlyChange(paths, base, head)) {
    return {
      ...fullPlan(paths, '版番号だけの変更を配布情報とpackの検査へ', ['linux-workstation']),
      comparisonBase: base,
      testScope: 'metadata',
      testFiles: [],
    };
  }
  const environmentPlan = classifyPaths(paths);
  const tests = environmentPlan.productChange
    ? selectTestFiles(paths)
    : { testScope: 'docs', testFiles: [] };
  return { ...environmentPlan, ...tests, comparisonBase: base };
}

function writeGithubOutputs(plan, outputPath) {
  appendFileSync(outputPath, [
    `product_change=${plan.productChange}`,
    `comparison_base=${plan.comparisonBase}`,
    `environments=${JSON.stringify(plan.environments)}`,
    `test_scope=${plan.testScope}`,
    `test_files=${JSON.stringify(plan.testFiles)}`,
    '',
  ].join('\n'), 'utf8');
}

function main() {
  const mode = process.argv[2];
  if (mode === 'plan') {
    const plan = createPlan(process.env);
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUTがありません');
    writeGithubOutputs(plan, process.env.GITHUB_OUTPUT);
    process.stdout.write(
      `CI plan: ${plan.reason}; environments=${plan.environments.join(',')}; tests=${plan.testScope}`
      + `${plan.testFiles.length > 0 ? `:${plan.testFiles.join(',')}` : ''}\n`,
    );
    return;
  }
  if (mode === 'verify') {
    verifyResults({
      classifyResult: process.env.CLASSIFY_RESULT,
      fullResult: process.env.FULL_RESULT,
      productChange: process.env.PRODUCT_CHANGE,
    });
    process.stdout.write('CI result: 選択計画と実行結果が一致しました\n');
    return;
  }
  throw new Error('usage: product-ci-plan.mjs <plan|verify>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
