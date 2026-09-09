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
製品CIと公開後の結果はこの記録へ追記する。
