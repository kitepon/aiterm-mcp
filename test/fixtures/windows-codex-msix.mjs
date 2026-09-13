import assert from 'node:assert/strict';
import { cpSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 公式のMSIX試験入口から呼び、通常ユーザーの設定と稼働中Desktopには触れない。
const [source, work, name, binary] = process.argv.slice(2);
const logical = join(process.env.APPDATA, name);
const report = { logical };
try {
  mkdirSync(logical);
  cpSync(join(source, 'package.json'), join(logical, 'package.json'));
  cpSync(join(source, 'dist'), join(logical, 'dist'), { recursive: true });
  symlinkSync(join(source, 'node_modules'), join(logical, 'node_modules'), 'junction');
  const relay = join(logical, 'dist/windows-codex-relay.js');
  report.physical = realpathSync.native(relay);
  assert.notEqual(report.physical.toLowerCase(), relay.toLowerCase(), '試験ファイルがMSIX仮想領域にあること');
  const { buildWindowsLauncher, windowsLauncherSource } = await import(pathToFileURL(join(logical, 'dist/windows-codex-setup.js')));
  const { verifyRelayLauncher } = await import(pathToFileURL(join(logical, 'dist/setup-codex-relay.js')));
  const { ensurePrivateDirectory } = await import(pathToFileURL(join(logical, 'dist/windows-codex-state.js')));
  ensurePrivateDirectory(work);
  // prepareの起動には論理パスを残し、製品がserveへ実体パスを渡すことを検証する。
  const launcher = buildWindowsLauncher(work, windowsLauncherSource(process.execPath, relay, binary, join(work, 'sessions')));
  const version = spawnSync(launcher, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(version.status, 0, version.stderr);
  report.version = version.stdout.trim();
  await verifyRelayLauncher(launcher);
  report.initialize_and_eof = true;
} catch (error) {
  report.error = { code: error.code, message: error.message };
} finally {
  // 自分で作った一意の試験領域だけを片付ける。
  assert.ok(name.startsWith('aiterm-msix-test-') && logical === join(process.env.APPDATA, name));
  rmSync(logical, { recursive: true, force: true });
  writeFileSync(join(work, 'result.json'), JSON.stringify(report));
}
