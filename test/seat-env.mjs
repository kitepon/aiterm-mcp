// npm testとCIの入口。試験processごとに、親の席から保存場所と系譜を引き継がない。
import { mkdtempSync } from 'node:fs';
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
for (const key of ['TMPDIR', 'TEMP', 'TMP', 'XDG_RUNTIME_DIR']) process.env[key] = root;
