// npm testとCIの入口。試験processごとに、親の席から保存場所と系譜を引き継がない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const key of Object.keys(process.env)) {
  if (key === 'AITERM_STATE_BASE' || key === 'AITERM_SESSION_ID' || key.startsWith('AITERM_AGENT_')) {
    delete process.env[key];
  }
}
delete process.env.TMUX;
delete process.env.TMUX_PANE;
// macOSのos.tmpdir()は長く、tmux socketの104 byte上限を超え得る。
const root = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'at-'));
for (const key of ['TEMP', 'TMP', 'XDG_RUNTIME_DIR']) process.env[key] = root;
// Windowsのstate選択はTMPDIRをXDGより先に見る。個別試験がXDGだけを切り替えられるよう、
// 既定socketはTEMPで隔離し、TMPDIRは個別試験が指定する時だけ使う。
if (process.platform === 'win32') delete process.env.TMPDIR;
else process.env.TMPDIR = root;

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
    rmSync(root, { recursive: true, force: true });
  } catch {
    // 消せない置き場（Windowsで開かれたままのfileなど）は残す。試験の結果は変えない。
  }
});
