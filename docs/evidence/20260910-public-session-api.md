# 公開セッションAPIの実機検証

この記録は開発中の実測であり、公開完了の宣言ではない。

## 個別検証

| 対象 | 結果 |
| --- | --- |
| launcher構造化receipt・公開MCP通常PTY・単発承認 | 5件成功 |
| SIGSTOPしたharness・POSIX process表・自身のnative PID | 3件成功 |
| 公開tool数・配布metadata・repository契約 | 18件成功 |
| 状態観測・harness画面・heredoc・旧tmux環境注入 | 11件成功、Windows専用1件をMacでskip |
| 文書検査 | 7件成功 |
| Linux公開MCP通常PTY・単発承認 | 2件成功 |
| 最終Codex dialog分類と公開単発承認 | 10件成功 |

SIGSTOPは実Codexのprocess groupでも再現した。修正前は`unknown/unrecognized_screen`、
修正後は`blocked/harness_stopped`で、paneとharnessの生存はtrueのまま。確認後SIGCONTで復帰した。

## harness実機確認

| OS | harness | 起動・送信 | 完了と観測 |
| --- | --- | --- | --- |
| macOS | Codex | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| macOS | Grok | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| macOS | Claude | 初回prompt `started` | `done`、回答「確認済み。」、idle、生存、paneとharnessの別PID |
| macOS | Cursor | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| Linux | Grok | promptなし・信頼指定で`startup.ready`、後続dispatch | `done`、回答「確認済み」、idle、生存、別PID |
| Linux | Codex | promptなし・信頼指定で`startup.ready`、後続dispatch | `done`、回答「確認済み」、idle、生存、別PID |
| Linux | Claude | 起動前に認証利用不可のエラー | session未作成。認証はCLI所有者の作業として未実施 |
| Windows | 通常PTY | native PID・環境キー・CPU観測の先行試験成功 | 最新差分のharness実機試験はSSH timeoutで未実施 |

Macの旧Codex CLIは既存configを読めず終了し、古いready画面だけが残る欠陥を再現できた。
Aitermはharness生存を確認してから入力するよう修理した。CLI自体は公式npm更新で既存configを
読める版へ更新してから実機試験した。共有configの書き換えで回避していない。

## 続行条件

Windows端末へのSSH復帰、mainの製品CI、公開と公開package smokeが残っている。
元のsetup検証におけるMac SSH未提供・WSL接続不可は元の検証記録に保持する。

## 最終独立監査と親裁定

Grok 4.6 highによる読み取り監査で1件の指摘を回収した。古いcommand承認に現在のMCP／hooks
dialogが続くと、全captureの先頭にある種別へ分類される欠陥を親のfocused testでも確認した。
現在のdialog開始と過去footerの境界からsuffixを切り、分類、承認選択、起動時同意が同じsuffixを読む修理を採用した。
未知dialog、古い承認＋新しいcomposer、長い折返しも含む10件を成功確認した。
監査が挙げた永続許可への誤選択は今回の再現では実行しておらず、確定した被害として記録しない。
native PID誤陽性、死亡のidle化、信頼指定の範囲拡大について追加の確実な指摘はなかった。
別ベンダーの指摘と親の再現・修理確認を合わせ、実装差分を製品CIへ進めると裁定した。
