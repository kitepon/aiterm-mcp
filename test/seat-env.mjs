// npm testとCIの入口。試験processごとに、親の席から保存場所と系譜を引き継がない。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
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

for (const key of Object.keys(process.env)) {
  if (key === 'AITERM_STATE_BASE' || key === 'AITERM_SESSION_ID' || key.startsWith('AITERM_AGENT_')) {
    delete process.env[key];
  }
}
// 席や開発機は、harnessと道具の置き場を環境で名指ししている事がある（BellTeamの席はCODEX_HOME・GROK_HOME・GH_CONFIG_DIR・GIT_CONFIG_GLOBAL）。
// 製品もharnessも、これらをHOMEより先に見るので、下でHOMEを差し替えても本物の置き場を読み書きする。外して、HOMEから決めさせる。
for (const key of ['CODEX_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_HOME', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL']) delete process.env[key];
// 動かした席やrunnerの鍵と、席を置いている製品（BellTeam）の環境は、試験にも、試験が起こすprocessにも渡さない。
for (const key of Object.keys(process.env)) {
  if (/^BELLTEAM_|^CLAUDE_CODE_MESSAGING_|_(?:TOKEN|KEY|SECRET|PASSWORD)$/.test(key)) delete process.env[key];
}
delete process.env.TMUX;
delete process.env.TMUX_PANE;
// 試験の配送で、寝ている会話を起こす見張り（ADR 0108）を起こさない。見張りは、その端末のCodexのアプリにリンクを開かせる。
// 試験の会話は一時の置き場にあり、開発機やrunnerのアプリには無い。
process.env.AITERM_STEER_CODEX_WAKE = '0';
// macOSのos.tmpdir()は長く、tmux socketの104 byte上限を超え得る。
const root = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'at-'));
for (const key of ['TEMP', 'TMP', 'XDG_RUNTIME_DIR']) process.env[key] = root;
// Windowsのstate選択はTMPDIRをXDGより先に見る。個別試験がXDGだけを切り替えられるよう、
// 既定socketはTEMPで隔離し、TMPDIRは個別試験が指定する時だけ使う。
if (process.platform === 'win32') delete process.env.TMPDIR;
else process.env.TMPDIR = root;

// 試験は、動かす利用者のhomeを読まない・書かない。CIのrunnerの利用者が替わっても、homeに何が入っていても、同じ結果にする。
// 席のbashは~/.bashrcを読んで~/.bash_historyへ打った命令を書き、製品は~/.config/aiterm-mcpと~/.claude/settings.jsonを読む。
// POSIXは、HOMEと、HOMEから決まる置き場（XDG）を、この試験processの置き場へ向ける。自分のHOMEを立てる試験は、それが勝つ。
// Windowsは変えない。psmux・PowerShell・npmはUSERPROFILEとLOCALAPPDATAを見ていて、差し替えるとPowerShellが起動のたびに
// cacheを作り直して遅くなる。
if (process.platform !== 'win32') {
  const home = join(root, 'home');
  mkdirSync(home, { mode: 0o700 });
  process.env.HOME = home;
  for (const key of ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) delete process.env[key];
}

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
    const sockets = socketFiles(root);
    if (sockets.length > 0) {
      const result = spawnSync(process.execPath, ['-e', probe, ...sockets], { encoding: 'utf8', timeout: 5000, windowsHide: true });
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
