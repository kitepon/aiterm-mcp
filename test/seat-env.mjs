// npm testとCIの入口。試験processごとに、親の席から保存場所・系譜・harnessと道具の置き場・鍵を引き継がない。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// この前処理を通す試験fileは、この作業ツリーの物だけ。引数が空の`node --test`は、file systemの根から試験fileを拾って流す
// （2026-10-13にBellTeamの席で起きた。ADR 0087の追記）。入口から起こした走者がそうなった時、よその試験fileは動かさずに落とす。
// 見るのは走者の子（NODE_TEST_CONTEXT）が流すfile（argv[1]）。`-e`で起こした補助のprocessには無い。
if (process.env.NODE_TEST_CONTEXT && process.argv[1]) {
  const real = (file) => {
    try { return realpathSync.native(file); } catch { return file; }
  };
  const inside = relative(real(fileURLToPath(new URL('..', import.meta.url))), real(process.argv[1]));
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    process.stderr.write(`seat-env: この作業ツリーの外の試験fileは流しません: ${process.argv[1]}\n`);
    process.exit(1);
  }
}

// 試験へ渡す環境は、要る物だけにする（ADR 0087の追記）。動かした席・開発機・runnerの環境には、Aitermの置き場と系譜、tmux、
// harnessと道具の置き場、鍵が入っている。名前の形で外す作りは、形の違う名前（…_CREDENTIALS など）を残す。
// 残すのは、OS・端末・道具が動くのに要る物、Nodeと走者の物、CIの入口が渡す物、試験が利用者から受け取る物（AITERM_TEST_）。
// 残す中でも、名前が鍵の形の物は外す。個別の試験がこの後で自分で立てる値は、そのまま使える。
const KEPT = new Set([
  'PATH', 'HOME', 'SHELL', 'TERM', 'COLORTERM', 'LANG', 'LANGUAGE', 'TZ', 'USER', 'LOGNAME', 'HOSTNAME', 'PWD', 'CI', 'FORCE_COLOR', 'NO_COLOR',
  // 端末の本体とbashの場所を、利用者が名指しする口（製品が読む）
  'AITERM_TMUX', 'AITERM_PSMUX', 'AITERM_PSMUX_DEBUG', 'AITERM_BASH', 'PSMUX_DATA_DIR',
  // Windows
  'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS', 'NUMBER_OF_PROCESSORS', 'PROGRAMDATA', 'PROGRAMW6432', 'ALLUSERSPROFILE', 'PUBLIC',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'SESSIONNAME', 'PSMODULEPATH', 'DRIVERDATA',
  // macOS
  '__CF_USER_TEXT_ENCODING',
  // npmの本体の場所（試験がnpmを起こす時に使う）
  'NPM_EXECPATH', 'NPM_NODE_EXECPATH',
]);
const KEPT_PREFIXES = ['LC_', 'NODE_', 'AITERM_TEST_', 'PRODUCT_CI_', 'FACTORY_CI_', 'GITHUB_', 'RUNNER_', 'PROCESSOR_', 'PROGRAMFILES', 'COMMONPROGRAM', 'WSL'];
const SECRET_NAME = /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$/;
for (const key of Object.keys(process.env)) {
  // Windowsの変数名は大文字小文字を区別しない。
  const name = key.toUpperCase();
  if (SECRET_NAME.test(name) || !(KEPT.has(name) || KEPT_PREFIXES.some((prefix) => name.startsWith(prefix)))) delete process.env[key];
}
// 試験の配送で、寝ている会話を起こす見張り（ADR 0108）を起こさない。見張りは、その端末のCodexのアプリにリンクを開かせる。
// 試験の会話は一時の置き場にあり、開発機やrunnerのアプリには無い。
process.env.AITERM_STEER_CODEX_WAKE = '0';
// macOSのos.tmpdir()は長く、tmux socketの104 byte上限を超え得る。
const root = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'at-'));
for (const key of ['TEMP', 'TMP', 'XDG_RUNTIME_DIR']) process.env[key] = root;
// Windowsのstate選択はTMPDIRをXDGより先に見る。個別試験がXDGだけを切り替えられるよう、
// 既定socketはTEMPで隔離し、TMPDIRは個別試験が指定する時だけ使う。
if (process.platform !== 'win32') process.env.TMPDIR = root;

// 試験は、動かす利用者のhomeと、harness・道具の置き場を、読まない・書かない（ADR 0121、ADR 0087の追記）。
// 席のbashは~/.bashrcを読んで~/.bash_historyへ打った命令を書き、製品は~/.config/aiterm-mcp、~/.claude/settings.json、~/.codex、~/.grokを読む。
// HOMEを、この試験processの置き場の中の空のhomeへ向ける。その上で、harness（Codex・Grok・Claude Code・Cursor）、XDG、gh、git、npmの置き場を、
// 試験の置き場の中に名指しする。名指しが要るのは、HOMEを見ない物が在るため: Windowsでは本物のharnessとnpmがUSERPROFILEを、ghがAPPDATAを見る。
// 名指しを外しただけでは、Windowsで利用者の本物の置き場（ログインが入っている）へ戻る。
// 名指しした場所は作らない（homeは空のまま）。自分のHOMEを立てる試験は、要る置き場を自分で名指しする。
// Windowsの利用者フォルダの変数（USERPROFILE・LOCALAPPDATA・APPDATA）は差し替えない。psmux・PowerShell・npmの本体が見ていて、
// 差し替えるとPowerShellが起動のたびにcacheを作り直して遅くなる。
const home = join(root, 'home');
mkdirSync(home, { mode: 0o700 });
Object.assign(process.env, {
  HOME: home,
  CODEX_HOME: join(home, '.codex'),
  GROK_HOME: join(home, '.grok'),
  CLAUDE_CONFIG_DIR: join(home, '.claude'),
  CURSOR_HOME: join(home, '.cursor'),
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_STATE_HOME: join(home, '.local', 'state'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  XDG_CACHE_HOME: join(home, '.cache'),
  GH_CONFIG_DIR: join(home, '.config', 'gh'),
  // gitは、利用者の設定を読まず、認証の補助（端末全体の設定に入っている物も）を使わず、端末へ問い合わせない。
  // 利用者の設定を読まないと、そこに書かれた「この場所を信頼する」（safe.directory）も消える。試験はこの作業ツリーでgitを呼ぶので
  // （文書の一覧、CIの組み立て）、この作業ツリーだけを信頼する場所として渡す。
  // 端末全体の設定（/etc/gitconfig、Git for Windowsの同梱の設定）は外さない（Windowsでは改行の扱いなどが入っている）。そこにhookの置き場や
  // repositoryのひな形が書かれていても使わないよう、この2つは試験の置き場の中の空のフォルダを名指しする（環境からの設定は、端末全体の設定に勝つ）。
  GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_KEY_1: 'safe.directory',
  GIT_CONFIG_VALUE_1: fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, ''),
  GIT_CONFIG_KEY_2: 'core.hooksPath',
  GIT_CONFIG_VALUE_2: join(root, 'git-hooks').replace(/\\/g, '/'),
  GIT_CONFIG_KEY_3: 'init.templateDir',
  GIT_CONFIG_VALUE_3: join(root, 'git-template').replace(/\\/g, '/'),
  GIT_TERMINAL_PROMPT: '0',
  // npmは、利用者の.npmrc（registryの鍵が入る）とcacheを使わない。
  npm_config_userconfig: join(root, 'npmrc'),
  npm_config_cache: join(root, 'npm-cache'),
});
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
for (const directory of ['git-hooks', 'git-template']) mkdirSync(join(root, directory));

// 一般の試験は、端末に入っている本物のharness（Claude Code・Codex・Grok・Cursor）を起こさない（ADR 0087の追記）。
// 製品は、名指しの変数（CLAUDE_BINほか）→ 決まった場所（homeの下。WindowsのCursorはLOCALAPPDATAの下）→ PATH の順で実行ファイルを探す。
// 開発機とrunnerにはharnessが入っているので、偽物を立て忘れた試験は、本物を起こす。4つの変数を、起きたら断って終わる偽物へ向け、
// 同じ名前の偽物をPATHの先頭にも置く（変数を外して探し方を確かめる試験と、環境を自分で組む試験のため）。
// 偽物を使う試験は、今までどおり自分で変数を立てる。実物のharnessで確かめる試験は、利用者が AITERM_TEST_ で始まる変数で実行ファイルを渡した時だけ動く。
// 偽物は、呼ばれた事を置き場の記録へ1行書く。記録が在れば、processの終わりに知らせて失敗にする（下のexitの所）。
const refusals = join(root, 'no-harness.log');
const refusers = join(root, 'no-harness');
mkdirSync(refusers);
// 記録の場所は、偽物の中へ絶対pathで書く（Git Bashは`/`区切りのWindowsのpathを読める）。
const quoted = `'${(process.platform === 'win32' ? refusals.replace(/\\/g, '/') : refusals).replace(/'/g, `'\\''`)}'`;
for (const [variable, name] of [['CLAUDE_BIN', 'claude'], ['CODEX_BIN', 'codex'], ['GROK_BIN', 'grok'], ['CURSOR_AGENT_BIN', 'cursor-agent']]) {
  // 変数が指すのは、席のshell（WindowsはGit Bash）が動かすscript。製品は、Windowsでも拡張子の無いscriptを受け取る。
  process.env[variable] = join(refusers, name);
  writeFileSync(process.env[variable],
    `#!/bin/sh\necho "${name} $*" >> ${quoted}\necho "seat-env: refused to start ${name} from a test" >&2\nexit 97\n`, { mode: 0o755 });
  // WindowsのPATHの探し方は、拡張子つき（.exe・.cmd）を先に選ぶ。本物の.exeより先に見つかるよう、.cmdの偽物も置く。
  if (process.platform === 'win32') {
    writeFileSync(join(refusers, `${name}.cmd`),
      `@echo off\r\n>>"${refusals}" echo ${name} %*\r\necho seat-env: refused to start ${name} from a test 1>&2\r\nexit /b 97\r\n`);
  }
}
process.env.PATH = [refusers, process.env.PATH].filter(Boolean).join(delimiter);

// 作った置き場は、このprocessの終わりに消す（ADR 0104）。tmuxはserverが終わってもsocketのfileを残すので、
// fileの有無ではなく、つながるかで生死を見る。生きたserverが残っている時は、試験が閉じ忘れた席の手掛かりとして置き場を残す。
function socketFiles(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) socketFiles(file, found);
    else if (entry.isSocket()) found.push(file);
  }
  return found;
}

const probe = `
  const fs = require('node:fs');
  const net = require('node:net');
  let left = process.argv.length - 1;
  if (left === 0) process.exit(0);
  for (const file of process.argv.slice(1)) {
    const socket = net.connect(file);
    const done = (live) => {
      socket.destroy();
      if (live) { fs.writeSync(1, file); process.exit(3); }
      if (--left === 0) process.exit(0);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  }
`;

process.on('exit', () => {
  try {
    if (existsSync(refusals)) {
      const lines = readFileSync(refusals, 'utf8').trim().split(/\r?\n/);
      process.stderr.write(`seat-env: 偽物を立てずにharnessを起こそうとしました（本物は起こしていません）:\n${lines.map(line => `  ${line}`).join('\n')}\n`);
      if (!process.exitCode) process.exitCode = 1;
    }
  } catch {
    // 記録を読めない時は、試験の結果を変えない。
  }
  try {
    const sockets = socketFiles(root);
    if (sockets.length > 0) {
      const result = spawnSync(process.execPath, ['-e', probe, ...sockets], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      if (result.status !== 0) {
        const live = result.status === 3 ? result.stdout.trim() : '生死を確かめられませんでした';
        process.stderr.write(`seat-env: tmuxのserverが残っているので、試験の置き場を消しません: ${root} (${live})\n`);
        return;
      }
    }
    // Windowsでは、止めたばかりの端末の本体が記録のfileをまだ開いている事がある。少し待って消し直す。
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  } catch {
    // 消せない置き場（Windowsで開かれたままのfileなど）は残す。試験の結果は変えない。
  }
});
