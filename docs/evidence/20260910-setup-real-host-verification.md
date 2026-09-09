# 公開setupの実機確認

## 確認対象

公開npm版は`0.32.0`、GitHub Releaseは`v0.32.0`。fetch後のmainは
`800f14dfcc81f727566565f9b686902034d42f74`だった。
`git diff v0.32.0..origin/main`は`test/core-pure.test.mjs`のパス期待値1件だけで、
setupの実装差分はない。ローカルmainはfast-forwardで同期した。

[既存CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34362576295)は
macOS native、Linux workstation、Windows nativeと集約gateが成功していた。
実装変更がないため同じ試験を再実行せず、実機の公開package確認を行った。

## 今回の実測

導入はMac上のAiterm永続PTYからSSHログインしたセッション内で行った。
実ユーザー設定をtarで退避し、公式npm導入、`aiterm-setup --json`を2回実行した。
設定変更を伴う導入は端末ごとに直列で行った。

| 実機 | 導入前 | 公開npm導入 | setup初回／再実行 | 公開MCP端末操作 | 診断 |
| --- | --- | --- | --- | --- | --- |
| Ubuntu 26.04、Node 24.14.1、tmux 3.6 | 0.31.2 | 0.32.0へ更新成功 | 両方ready | 両方成功 | 0.32.0、overall ready |
| Windows native、PowerShell 7.6.5、Node 24.19.0 | SSH環境のglobal packageが不在 | 0.32.0導入成功 | 両方ready | 両方成功 | 0.32.0、overall ready |
| macOS 26.6.1 | 今回は未確認 | 未実施 | 未実施 | 未実施 | 未実施 |
| WSLのSSH接続先 | 今回は未確認 | 未実施 | 未実施 | 未実施 | 未実施 |

公開MCP端末操作は、公開packageのsetupに含まれる`pty_open`、`pty_send`、
`pty_read`、`pty_close`で実行結果を検査する処理を指す。
Windowsのbackend選択はsetupが所有し、利用者がpsmuxを直接操作していない。
別途、同じglobal packageのstdio MCPに接続し、公開`diagnostics`も呼び出した。

| AI | Linux初回／再実行 | Windows初回／再実行 | 既存設定保持・再実行前後の一致 |
| --- | --- | --- | --- |
| Claude Code | ready / ready | ready / ready | 両OSで確認 |
| Codex CLI | ready / ready | not_detected / not_detected | 両OSで確認。Windowsは既存設定を変更していない |
| Grok CLI | ready / ready | ready / ready | 両OSで確認 |
| Cursor | ready / ready | ready / ready | 両OSで確認 |

JSONとTOMLを構造として比較し、Aiterm登録以外が保持されたことを確認した。
初回setup後と再実行後の4設定ファイルはバイト単位で一致した。
設定本体・退避tarは実機内に保持し、本repositoryへ収録していない。
Cursorは設定ディレクトリによる検出・登録であり、CLI起動の確認を意味しない。
AIの会話実行は今回の確認項目に含めていない。

## 引継ぎと未実施

引継ぎではWindowsの公開版導入、実設定4 AI登録、Grok子の起動・完了通知・
回答回収・終了が成功している。今回はSSH環境でCodex CLIが未検出だったため、
その過去実績を今回の4 AI成功として扱っていない。

Macはlocalhostと実ホスト名へのSSHが接続拒否となった。リモートログインの
管理状態照会にはsudo認証が必要で、接続先または有効化についてユーザーへ確認中。
WSL接続先は時間を限定した2回のSSH試行がともにタイムアウトした。
ローカル模擬試験や既存CIを、これらの実機導入成功の代用にはしていない。
未導入のtmux、PowerShell 7、psmuxを新規に準備する分岐は今回実測していない。

## 正規操作と工場から削除できる代行

初回も更新も以下を使い、利用するMCP clientを再起動する。

```sh
npm install -g aiterm-mcp@latest
aiterm-setup --json
```

診断は公開MCPの`diagnostics({})`。setupの再実行は依存・端末実動作・登録を
まとめて再確認する入口であり、診断専用の読み取り操作とは区別する。

工場にあるAiterm専用のClaude／Cursor JSON編集、Codex／Grok登録CLI呼出し、
登録パス組立て、登録の読戻し、OS別backend依存準備と端末probeの代行は、
製品setupへ置き換えられる。共有AI設定の編集は同一端末で重ねない。
AI CLI自体の導入・認証、host接続、製品横断の互換性確認は各所有者に残る。
他製品repositoryのコード削除・変更は今回行っていない。

setupの追加修理・増版・再公開は行っていない。Mac／WSLの接続とWindowsの
Codex CLI検出が未解決であり、全対象の完了とは判定しない。
