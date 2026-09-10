# ADR 0059: Claude親への回答自動配送の受入

日付: 2026-09-10

## 判断

[ADR 0058](0058-claude-parent-hook-receiver.md)のClaude Code親対応を受け入れ、実装・公開・導入を完了とする。
公開版0.35.1をmacOS、Linux、Windows nativeへ導入し、通常HOMEの親が子の初回回答と
同じ子への追加依頼の回答を自動受信し、次のターンを完了することを確認した。
親のwaiter起動・ポーリング・回答回収と、子への返送コマンド指示は不要だった。

受入対象の公開commitは `f3f4e0fc4715b790d29e1dcef36bad5285e386bf`。
これは受入時点の固定記録であり、現行版はREADMEと配布metadataを参照する。

## 受入結果

| 条件 | 結果と根拠 |
| --- | --- |
| 通常起動からの配送 | 公式の非同期hookをsetupで登録し、Channels起動flagなしで本文を受信 |
| 親の非ブロック性 | hookが45秒待つ間に、親が16秒後に別turnの回答を完了。その後の自動再開も確認 |
| 本文の完全性 | 32,164文字の日本語hook出力の先頭・末尾・最終行を確認 |
| 会話終了 | `/clear`後の新会話へ未送信の旧回答が届かず、本文保存と明示errorを確認 |
| 依頼相関と互換 | 別の親、即完了、連続依頼、保存・出力失敗、既存Codex記録との共存を含む関連試験103件成功 |
| macOS | 公開npm版、setup、初回・追加依頼の受信と親の続行、試験sessionの終了が成功 |
| Linux | 公開npm版、setup、初回・追加依頼の受信と親の続行、試験sessionの終了が成功。初回起動時の別観測は下記 |
| Windows native | 公開npm版、psmux、setup、初回・追加依頼の受信と親の続行、試験sessionの終了が成功 |
| 最終CI | 修正版のmacOS・Linux・Windowsの製品試験と集約gateが成功 |
| 公開 | main祖先、npm provenance、GitHub ReleaseとMCPB、Official MCP Registryのactiveを確認 |

実際の親回答、配送ID、公開先、CIと試験出力のhashは
[公開後証拠](../evidence/2026-09-10-claude-parent-delivery-release.json)へ保存した。
hookの待機・会話終了・長文の実測は[実装時証拠](../evidence/2026-09-10-claude-parent-delivery.json)、
独立反証と追加修理は[レビュー証拠](../evidence/2026-09-10-claude-parent-delivery-review.json)に残す。

## 独立反証と修理

Grok 4.6による読み取り専用の反証では、親の宛先・会話終了・結果不明・導入互換に重大欠陥なし。
`--agent`の主会話にも`agent_id`が付く指摘を受け、既存の拒否対象を文書とerror本文へ明記した。

レビュー中の追加指示が21ミリ秒後に次turnを開始し、前turnの回答回収が失敗する競合を実際に踏んだ。
Grokの完了eventと履歴の`prompt_index`を照合して対象turnを回収するように修理した。
最小再現、関連回収試験、実historyの3,447文字との完全一致、限定反証と3環境CIが成功した。

0.35.0の導入後試験では、Macのリンク経由cwdを保存したmetadataと、Claudeが実体パスから作る
project slugが一致せず、会話記録を検出できなかった。自動配送自体は親の記録で確認できた。
指定cwdの実体パスを起動時に固定する修正を0.35.1へ入れ、失敗再現と修正後の3試験、
修正版の実機試験、3環境CI、公開版の再導入後試験で確認した。

## 起動時の未確定な観測

Linuxの0.35.1導入直後の1回は`startup_dialog`で起動準備未完了となり、依頼は未送信だった。
試験の終了処理がpaneを閉じる前に起動画面を保存していなかったため、具体的な原因は未確定である。
画面保存を加えた再現試行では同じ公開版と通常設定で起動し、初回と追加依頼の自動受信が成功した。
この観測を配送成功へ数えず、失敗時と成功時の記録を別々に保存した。
未確定の原因に対する製品コード変更や自動再試行は追加していない。

## 対応範囲

Claude Code 2.1.259以上の通常対話sessionと有効なcommand hookを対象とする。
Claude Desktopのチャット、Web、`agent_id`付きの会話は対象外であり、送信前に明示する。
`submitted`はhookへの本文出力を示す。受入試験では親の後続回答も別に確認した。
稼働中の旧MCP接続には再接続が必要で、公開版の試験では新規の通常接続を使った。

現行の契約は[DESIGN](../DESIGN.md)と日英READMEを正とする。
