# ADR 0076: SSH共有ソケットは短い専用領域へ置く

状態: 採用。

## 原因

macOSで`remote: { host: "windows-workstation" }`のPTY作成が接続前に失敗した。
state root下の`remote/cm-%C`は展開後114 bytesとなり、OpenSSHが`ControlPath too long`（104 bytes制限）で拒否した。
OpenSSHはmasterソケットの作成時にもドットと16字を末尾へ加えるため、正式名だけ短くする修理では足りない。

## 判断

POSIXのSSH共有ソケットだけを`/tmp/aiterm-ssh-<state rootのSHA-256先頭20桁>/cm-%C`へ置く。
パスの長さは正式名81 bytes、一時名98 bytesで一定になる。state rootをhashへ含めることで
利用者と隔離領域を分離し、同じstate rootの呼び出しと別processの完了待ちは従来どおり共有する。
`%C`による接続先の分離を維持する。WindowsのOpenSSHはControlMasterを使わない。

共有`/tmp`に既存の領域がある場合、自分所有の0700ディレクトリだけを使う。
symlink・別所有者・異なる権限はtyped errorで止め、既存領域の修復・削除を行わない。
この検査はOS上の共有領域という外部境界のために置く。

askpass、agentの相関記録とAPIは変えない。socketのcleanupはOpenSSHの`ControlPersist=600`が所有し、
MCP呼び出しを閉じるたびにmasterを止めない。旧配置の稼働中ソケットにも触れない。

## 検証

通常と長い日本語TMPDIR、XDG_RUNTIME_DIRのstate root分離、別processでの共有、
完了待ちとdispatchの同一ControlPath、OpenSSHのソケット照会と一時名での実bind・closeを試験する。
不正権限とsymlinkへの拒否、既存権限の保持も確認する。

一次資料は[OpenSSHの共有ソケット実装](../../rag/sources/platform/openssh-mux-control-socket.md)と
[公式設定仕様](../../rag/sources/platform/openssh-controlmaster-config.md)へ保管する。
