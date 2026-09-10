# ADR 0056: Codex親への回答自動配送の受入

日付: 2026-09-10

## 判断

[ADR 0055](0055-codex-parent-result-delivery.md)で決めたCodex親対応を受け入れ、完了とする。
Aitermの公開版をmacOS、Linux、Windows nativeへ導入し、通常登録のMCPから子を起動して、
子の回答が自動で親へ届き、親が次のターンを完了するところまで確認した。
親によるwaiter起動・回答回収、子への返送コマンド指示は不要だった。

公開対象はmain上の `994242af1a7c7a4d1d4c7935c7086773a8c9ce1f`、版は0.34.0。
これは受入時点の固定記録であり、現行版の案内はREADMEと配布metadataを参照する。

## 受入結果

| 条件 | 結果と根拠 |
| --- | --- |
| 公式受信口・MCP宛先 | Codexの実モデル呼出しでthread IDが一致。stdioの公開APIで60,000文字・136,000 bytesが完全一致 |
| 本文と依頼の対応 | 初手、同じ子へのfollow-up、即完了、別の親、次回答保存後の前回答、失敗と再接続のfocused testが成功 |
| 子のharness | Codex子の実機配送、Claude子の初手とfollow-upの実機配送が成功 |
| macOS | 公開npm版の導入、setupと再実行、Codex CLI親の自動受信・次ターン完了が成功 |
| Linux | 公開npm版の導入、setupと再実行、Codex CLI親の自動受信・次ターン完了が成功 |
| Windows native | 公開npm版とpsmuxで導入、setupと再実行、Codex CLI親の自動受信・次ターン完了が成功 |
| 既存消費者 | 直接core利用・従来waiterを含む関連試験と最終試験が成功 |
| 最終試験 | 453件中445件成功、環境条件による8件skip、失敗0件 |
| 製品CI | macOS、Linux、Windowsの必要試験と集約gateが成功 |
| 公開 | npm provenance、GitHub ReleaseとMCPB、Official MCP Registryへの登録が成功 |

識別情報、実際の子と親の回答、公開先、CI、試験出力のhashは
[公開後証拠](../evidence/2026-09-10-codex-parent-delivery-release.json)に保存した。
実装段階のCodex子・Claude子の試験と修理根拠は
[実装時証拠](../evidence/2026-09-10-codex-parent-delivery.json)に保存した。

## 独立反証と修正確認

Grok CLIによる読み取り専用の独立反証は、Codexのturn ID付き `output_text` 形式の互換性を指摘した。
現行CLIの完了本文は実機で成功しており、全般的に動かないという仮説は棄却した。
既存fixtureの別形式で配送専用読取りの失敗を再現できたため、その互換性を修理した。
対象turnの本文だけを回収する試験と、誤ったlaunchや保存失敗時の送信を拒否する試験が成功した。

別MCP接続から同じ子へ並行依頼すると、2件とも予約できる欠陥をfocused testで再現した。
保存記録のhard linkを原子的に作成して1件だけを受け付けるようにし、同じ試験で修正を確認した。
最初の製品CIで出た初回promptエラー状態の差も、最小試験で原因を確定してから修理し、
その後の3環境CIと最終試験で成功した。

これらの修正後に公開版の実機試験を行った。公開後の製品コード変更はない。

## 確認範囲と残る契約

Codex Desktopのこの親タスクでも、公式共通キューの本文受信と次ターン開始を確認した。
公開版を通常のMCP登録から通した3環境試験の親はCodex CLIである。
稼働中DesktopのMCP接続を差し替える試験は行っていない。既存接続には再接続が必要になる。

Codex native sub-agentを親にした外部キュー入力はCodex自身が拒否する。
Aitermは子へ依頼する前に原因付きエラーを返す。この対象は今回の対応範囲に含めない。
Claude Code親への自動配送も合意どおり後続対象で、今回の未完了条件にはしない。

`submitted` はキュー受付を示す。モデルの処理完了とは区別し、公開後試験では両方を別々に確認した。
送信結果不明は `unknown` として本文を保持し、自動で再送しない。
現在の契約は[DESIGN](../DESIGN.md#codex親への自動配送)と日英READMEを正とする。
