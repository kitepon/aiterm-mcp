# SSH先PowerShellの完了マーカー修理

## 原因と再現

PeertableのWindows導入中に、Mac上のAitermからSSH先のPowerShell 7へ
`pty_send(text:"hostname", mark:true)`を送ると、hostnameは成功するが追記した`printf`が失敗した。
使用中のPeertable sessionには触れず、専用sessionを作って同じ現象を再現した。

`src/core.ts`の実効shell判定と`src/tmux-runtime.ts`のPowerShell sentinel生成が、
どちらもAiterm hostの`isWin`に限定されていた。ローカルの前面processは`ssh`なので、
SSH先がPowerShellでもPOSIX構文になっていた。

## 修理と個別確認

端末runtimeでSSH先の現在の標準`PS ...>`promptを判定し、host OSとsentinel方言を分離した。
画面途中の古いprompt、入力途中、後続の出力がある場合はPowerShellへの切替に使わない。
既存のWindows nativeで起動直後のprocess名が古い場合の判定も同じ関数を使う。

- 修理前: 公開MCP経由の別SSH sessionで`printf`未認識を再現。PowerShell形式の個別試験も失敗した。
- 修理後: runtimeの5試験成功。関連するmark／sentinel／heredocはMacで6件成功、Windows専用1件skip。
- MacからWindows PowerShell 7への実SSHで、成功`rc=0`、失敗`rc=1`、600ms遅延出力が
  それぞれ`is_complete=True via mark`で完了した。
- 同じsessionからSSHを抜けたMacのbashで、POSIX形式の`hostname`が完了した。
- 同じsessionで続けてLinuxへSSHし、POSIX形式の`hostname`が完了した。

CLI認証や共有AI設定を変更していない。Peertableの利用中sessionを操作・停止していない。

## 公開と導入

実装修理はmain `a8b25cfe748ee9abba83d7161b47cdc065735eb0`。
[3環境CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34411283887)成功後、
正規release入口で`54725adf664fce0c684c65ffdfd55a8934559645`をmainに着地させて0.33.1を公開した。
[npm publish](https://github.com/kitepon/aiterm-mcp/actions/runs/34412069106)、
[GitHub ReleaseとMCPB](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.33.1)、
[Registry登録](https://github.com/kitepon/aiterm-mcp/actions/runs/34412081551)は成功した。
npmの版別照会で0.33.1とSLSA provenanceを、Registryの版別APIでactive・isLatestを読戻した。
公開直後のnpm 404とLinuxのETARGETは記録し、公式npmのオンライン再照会で取得可能になってから導入した。

3端末で設定をtar退避し、公式npm global installと`aiterm-setup --json`を実行した。
Mac・Linux・WindowsでClaude／Codex／Grok／Cursorの既存設定の実効保持を確認した。
WindowsのCodexは未検出のまま既存設定を保持する。setupの再実行契約は前工程の確認を再利用した。

MacではCodex公式CLIが他のMCP登録の`args=[]`、`enabled=true`、`required=false`を省略した。
隔離した最小configで同じ公式`mcp add`を再現し、更新前後の`mcp get --json`が厳密一致した。
比較ではこの既定値だけを省略と等価に扱い、実ユーザー設定を書き戻していない。

| 公開版の実機経路 | 結果 |
| --- | --- |
| Mac → Windows SSH・PowerShell 7 | 成功rc0・失敗rc1・600ms遅延の3件を`via mark`で完了 |
| Mac native | 同じ3件の状態・完了とclose後missingを確認 |
| Linux native | 同上 |
| Windows native・PowerShell 7 | 同上 |

接続先serverは各端末にglobal installした公開packageの`dist/index.js`であり、開発treeのserverではない。
共有書込み終了と公開版の確認結果をPeertable担当へ引き渡した。

## 試験の後片付けの修理

Windowsの公式npm更新がglobal package directoryのrenameでEBUSYになった。
前の公開API試験と一致する時刻に作られた隔離psmux namespaceが、session0件でもwarm serverを
残していた。該当namespaceだけを停止すると、同じ公式npm更新が成功した。
Peertableの使用中sessionや他のnamespaceは停止していない。

`test/public-session-api.test.mjs`のfinallyに、試験専用TMPDIRを引き継いだ内部`core.killAll()`を
追加した。MCP接続を閉じるだけで終えず、専用backendを終了してから一時ディレクトリを削除する。
これはtest cleanupであり、利用者向けの一括停止APIは追加していない。
Macの公開API試験2件、Windowsの1件成功・POSIX fixture1件skipを確認し、
Windowsでは試験前後のnative process比較で新規psmux processの残存ゼロを確認した。
