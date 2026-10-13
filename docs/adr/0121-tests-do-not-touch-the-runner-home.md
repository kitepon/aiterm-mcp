# ADR 0121: 試験は、動かす利用者のhomeに触らない。CIは、端末の本体が見えない時に落ちる

状態: 採用。ADR 0087・0104の続き。

## 原因

工場のrunnerの利用者を、今の利用者から専用の利用者へ移す話が出た（dotagentsのSEC-002）。
利用者が替わると結果が変わる所を数えるため、目印のfileを置いた別のhomeを立てて、CIと同じ命令（`npm ci`、`node scripts/run-product-ci-tests.mjs`）を
Linuxで流し、homeで開かれたfileと呼ばれた実行ファイルを記録した（2026-10-13、main `9f0d0f3`）。

試験が、動かす利用者のhomeで読んでいた物:

- `~/.bashrc`: 端末を開く試験9本。席のbashが読む。
- `~/.claude/settings.json`と`~/.config/aiterm-mcp/runtime-error-reporting.json`: `smoke.test.mjs`。MCPの本体を起こした時に読む。
  rabbitとmacbookの今の利用者のhomeでは、この報告の設定が有効になっている。
- `~/.config/aiterm-mcp/codex-parent-hooks/config.json`: `setup.test.mjs`の2本。`steer`を差し替えても、`codex_steer`を渡さないと
  `runSetup`が利用者の設定を読んで決める。このfileが壊れた形だと、2本とも落ちる（無ければ通る）。
- `~/.gitconfig`と`~/.npmrc`: gitと`npm pack --dry-run`を呼ぶ試験。

書いていた物:

- `~/.bash_history`: 試験が席へ打った命令（全部の試験1回で336行）。rabbitとmacbookの利用者の履歴に、試験の文字列が入っていた。
- `~/.codex/tmp/arg0/`: `setup-codex-hooks.test.mjs`が、端末に入っている公式Codexを起こしていた（`codex --version`と
  `codex app-server --listen stdio://`を2回ずつ。外したhookの承認の記録を消す後片付け）。起きるたびにCodexが一時の置き場を作る。
- `~/.npm`（cacheと記録）。
- `/tmp/aiterm-ssh-<hash>`: `remote.test.mjs`が、1回につき空の置き場を1つ残していた。

開かれなかった物: 各harnessのログイン（`~/.claude/.credentials.json`、`~/.codex/auth.json`ほか）、`~/.grok`、`~/.cursor`、`~/.ssh`の鍵。

別に、端末の本体（tmux・psmux）がrunnerのPATHから見えない時、端末を使う試験は「未インストール」で飛ぶだけで、CIは緑のまま通る作りだった。
今のrunnerは、tmux（macbook）・psmux（fox）・Node（rabbit）を、今の利用者のhomeの中の物で動かしている。

## 決めた事

1. 試験の前処理（`test/seat-env.mjs`）は、`HOME`を試験processの置き場の中の空のhomeへ向ける。自分の`HOME`を立てる試験は、それが勝つ。
   homeは置き場の中にあるので、processの終わりに一緒に消える（ADR 0104）。
   初めはPOSIXだけで向け、XDGの4つは外していた。今は全OSで向け、XDGとharness・道具の置き場を、その中に名指しする（ADR 0087の追記の3）。
2. Windowsは、利用者フォルダの変数（`USERPROFILE`・`LOCALAPPDATA`・`APPDATA`）を差し替えない。psmux・PowerShell・npmの本体が見ていて、差し替えると
   PowerShellが起動のたびにcacheを作り直して遅くなる。`HOME`を見ない物（本物のharness、gh、npmの設定）は、名指しで試験の置き場へ向ける（同じ追記の3）。
3. `steer`を差し替えて`runSetup`を呼ぶ試験は、`codex_steer`も渡す。
4. `setup-codex-hooks.test.mjs`は、端末に入っているcodexを起こさない（`CODEX_BIN`で無い実行ファイルを指す）。後片付けが出来なくても解除は進む作りで、
   この試験はその道を通る。実物のcodexでの確かめは、`AITERM_TEST_CODEX_BINARY`を渡す試験が持つ。
   今は、前処理が4つのharnessの全部について、端末に入っている本物を起こさないようにしている（ADR 0087の追記の7）。
5. `remote.test.mjs`は、自分の試験processの分のSSH共有ソケットの領域を、終わりに消す。
6. 前処理が置き場を消す時、消せなければ少し待ってやり直す（4回まで）。Windowsで、止めたばかりの端末の本体が記録のfileを
   まだ開いている時の残りを減らす。
7. CIの入口（`scripts/run-product-ci-tests.mjs`）は、全部の試験と選んだ試験を流す前に、試験と同じ見つけ方で端末の本体を確かめる
   （POSIXは`tmux -V`、Windowsは`psmux -V`と`pwsh`）。見えなければ、組む前に落ちる。見つけた版は記録へ1行出す。
   手元の`npm test`は変えない（端末の本体が無い端末では、今までどおり飛ぶ）。

## 及ばない所

- 計った時の環境は、`CODEX_HOME`・`GROK_HOME`が本物の置き場を指す席だった。目印を置いたのは`HOME`だけなので、名指しされた置き場の読み書きは数えていない。
  名指しの置き場は、ADR 0087の追記（2026-10-13）で、前処理が試験の置き場の中へ向ける。
- `ssh`はpasswdのhomeを見るので、`HOME`を差し替えても利用者の`~/.ssh/config`を読む（`remote.test.mjs`が`ssh -O check`を2回呼ぶ。つなぎには行かない）。
- Windowsでは、psmuxが利用者フォルダの`.psmux`へ端末の控えを書き、npmが利用者のcacheへ書く。
- 計ったのはLinuxだけ。在るfileを開いた事しか記録できない。

## 確かめ

- `test/seat-env.test.mjs`: 前処理つきのprocessでは、`HOME`とOSのhomeの問い合わせ（POSIX）が置き場の中の空のhomeを返し、XDGの4つがその中を指す。直す前の前処理では落ちる。
- 手元（Linux）で、目印のfile 25個を置いたhomeから、CIの入口で全部の試験を流し、home で開かれたfileが0、呼ばれた実物のcodexが0である事。
- tmuxの無いPATHでCIの入口を呼ぶと、組む前に終了コード1で止まる。
