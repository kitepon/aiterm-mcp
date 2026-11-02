# Astra最終整合レビュー — 2026-11-02

採用したA1/A2/A3/A4a/A4bとSteer S1の完成候補について、責務・接続・図・変更コードの整合確認を完了した。変更境界に、未解決のruntime修正要求は見つからなかった。文書の2種類の不整合をこの差分で修正した。これは候補の整合確認であり、本番反映・公開・全CI成功の証明ではない。

レビュー時のsourceはAiterm `155c828c8ca82ee1d4f22cd4b81b3d234e354056`、Steer `133e36f722e256ace9ce6995d9f5b04f0fe9f00f`。本レビューの差分は文書・図・その証拠だけで、source/test/package/lockは変更しない。実モデルは11:30:18.776Zの同会話turn_contextで`gpt-6-astra`/`xhigh`、通常設定APIのaccepted/requested一致とfast OFFを確認してから開始した。

## 全体範囲と確認方法

[全体図](current-overview.svg)から、以下の全機能群の入力・状態所有・作用・返却を辿った。[Aiterm source索引](source-index.md)は137file/3058関数本体、[Steer索引](../../../steer-refactor-20261102/docs/architecture/source-index.md)は26file/465本体。callbackを含む静的位置であり、この3523件をすべて独立に動作試験したという件数ではない。

基準155sourceのSol全文初読・Astra設計と、候補の全差分、移動本体の照合、変更窓口のcaller/test/fixture/export記録を結合した。今回Astraが基準全行をもう一度読み直したとはしない。未変更全fixtureを独立再検証する代わりに、Owner指定どおり変更契約と直接境界を確認した。

| 機能群と正本 | 状態・作用・失敗返却の確認点 |
| --- | --- |
| [起動/本人性/入力](launch-identity-input.md)、[lifecycle](lifecycle-state-ownership.md) | metadataとnative出生本人性、送信lock、初手、世代公開、readyを別境界に保持。stopping/hibernated/resuming/failedと作用前rollback・作用後unknown、best-effort cleanupを辿れる |
| [通常PTY](ordinary-pty.md)、[観測/回答](observation-results.md)、[5harness](harness-contracts.md) | native入力receipt、vendor開始、完了正本、表示reducerを区別。wait取消は観測の取消でありnative停止ではない。欠測を成功へ丸めない |
| [goal/設定/認証/remote](goal-configuration-auth-remote.md)、[設定分離](model-configuration.md) | goal/入力guard・beforeChange・catalog照会時機・既定復元・失敗後cleanupの順を維持。認証の本人性/秘密入力とSSH transportは分離した所有者のまま |
| [親配送](parent-delivery.md)と[Steer](../../../steer-refactor-20261102/docs/architecture/README.md) | record検証とmanagerの予約/監視/owner回収、queue受付とhook出力、claim/withdraw/settle/closedを区別。unknownの自動再送なし、emittedをvendor開始/画面反映へ補完しない |
| [private基盤](private-execution.md)、[受付](private-admission.md)、[親配送](private-parent-delivery.md)、[停止](private-stop.md) | pure plan、耐久化、native作用、canonical completion、fence/retirementを分離。通常cancel receipt、v2 interruption proof、v1管理closeは別契約。未mount/未対応を動作可能へ変えない |
| [承認/operation/環境](approval-operation-environment.md) | approval入力と作用、operationのaccepted/pending/completed/unknown、snapshot/復元/cleanupを追跡。設定の復元は従来のbest-effortで、完全rollbackの新保証ではない |
| [native/OS](native-runtime.md)、[setup/update](setup-update.md)、[relay](codex-relay-runtime.md)、[障害記録](runtime-errors.md)、[配布](release-verification.md) | process出生・部分入力・欠測、登録/更新/診断の副作用と返却先、報告ackと修理完了の違いを保持。OS操作を行わず既存実装と図を照合 |
| [外部接点](external-contracts.md)、[BellTeam境界](bellteam-boundary.md) | BellTeamの実行方針/設定適用時機/会話、BridgeのDB/予約/receiptと製品内部を分離。旧module path、公開再export、保存形式への読取依存を維持 |

## 変更窓口の判定

| 段階 | 採用結果と直接境界 | 検証済み |
| --- | --- | --- |
| A1 | metadata readerへ検証/読取を移動。保存・世代・negative cacheは元の所有者。5vendor/旧形式/absent/malformed/例外を保持 | build・11件 |
| A2 | PTY表示の純関数を移動。coreの公開再exportと入力/ログbyte境界を保持 | build・12件 |
| A3 | Claude/Codex画面操作を既存harness責務へ。coreがscreen/完了command/key/readyを供給し、goal/lock/作用境界を所有。user-configが従来の復元3回/400msを所有 | build・20件 |
| A4a | remote schema/type/descriptionをtransportから分離。同名の公開再exportとschema同一性を保持 | build・schema1件 |
| A4b | strict record schema/read/本文形式を分離。manager本体・予約/回収/checkpoint/unknown/cleanup順は不変 | build・20件（public/private直接接点を含む） |
| S1 | channel-stateが保存/claim/settle、channelがvendor本人性/待機/出力を所有。path/hash/profileと公開Error/readerの同一性を保持 | build・21件（既存14、settle失敗1、Bridge surface6） |

関連試験は計85件。原本は[検証索引](verification.md)。後続の文書差分で影響しない成功群や全体試験は再走していない。

独立した[関数本体比較](evidence/review-function-bodies.json)でも、既存top-level関数のAiterm1170/Steer171本体が同一、移動Aiterm20本体のうち17とSteer11は文字列同一、消失0だった。残るAiterm3移動画面関数・configureAgentInLock、Steer openChannel/sendToChannelと新しい3helperは実差分を読み、既存command/Enter/選択/照会時機、channel directory算出と書込/queueの順を確認した。この比較はclass/定数/import評価順の全同値証明ではないため、各抽出原本・公開型比較・静的runtime依存と合わせて判定した。

公開5module面355型は、同値namespace/alias表記3件だけを正規化して差分0。新runtime moduleはnpm dry-run/MCPB stagingに含まれる。新しい公開tool/flag/API/依存/版は追加していない。AitermのSteer lock0.5.0と独立Steer候補0.5.1は維持し、両候補を実consumerとして同時導入した保証はしない。

## レビューで直した文書不整合

1. npmに入るAiterm `docs/00_overview.md`とSteer両READMEが、同梱しない`docs/architecture`を相対参照していた。既存のpack Markdown閉包検査で3件の失敗を確認し、repository上の正本へのURLへ変更。既存npm dry-runのfile一覧と候補Markdown9件を同じ検査へ渡し[全9件成功](evidence/review-pack-links-green.json)。[修正前](evidence/review-pack-links-red.json)も保持した。公開URLの候補内容は採用後に現れるため、現在main上の公開済みを主張しない。
2. 詳細説明の基準版行番号、設計前の予定、調査中の記述が候補へ残っていた。候補索引と段階検証に揃え、native図の旧調査中表示も訂正した。未変更全fixture/実OSの未確認事項は消していない。

28現行図のDOTと機能説明を確認。Solの全28枚再描画/目視来歴を保持し、Astraでは全体・model設定・private停止・Steer channelと更新後native図のPNGを再目視した。native1枚は既存Viz/Resvgで再描画し、切れた文字/重なりを確認。残る27図のDOT/SVG/PNGはSol仕上げから不変。3枚の設計時提案図は履歴として明示し、現行図に数えない。

## 未確認・既知の制限

- 元Windows main CI `41397057670`の846pass/73fail/569skip/gatefailureと原因未確定を保持。60 native作成拒否/1 ready/12その他は表面化境界であり根因ではない。今回の候補で元不具合を修理したとはしない。
- 新しい3OS/5vendor実動・全fixture・Bridge/BellTeam実consumer受入、署名/MCPB公開、Host更新を実施していない。private通常main未mount、native中断proofやWindows等の未対応は各詳細図のまま。
- 関数索引は静的解決できた呼出先で、動的callの網羅性は保証しない。追加8moduleを通るruntime循環0は静的import/reexportの範囲。旧記録の許容、復元/cleanupのbest-effort、結果不明の保持は既存制限を含む。
- 製品間の相対リンクは隣接候補checkoutで検証した。単独checkoutでは外部repositoryの正本を参照する。外部URLの公開内容・候補公開は別工程。

完成候補をレヴィアタンの差分・図・試験結果の確認へ渡す。公開/本番保留は継続。別依頼とSteer/AGY正式受入の予定はこの候補受入まで保留し、受入後に重複/不要予定を整理して再開する。稼働席を守り、独立した修理や新機能をrefactorに混ぜないための処置である。
