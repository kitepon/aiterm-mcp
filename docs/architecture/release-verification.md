> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 配布・検証の入口とWindows基準失敗

基準Aiterm ce575ce8 / Steer6734ee86。[現在図](release-verification.svg) / [PNG](release-verification.png)。これは既存の供給経路と基準調査の記録。候補の限定検証はverification.mdにまとめ、公開・稼働操作は0。

## 配布物とexportの保持

| 所有者 | 入口 | 維持するもの |
| --- | --- | --- |
| Aiterm package | `package.json` / tsconfig / `scripts/clean-build.mjs` | Node>=18、ES2022/NodeNext strict、8bin、root dist/*.js＋harnesses/*.js、現行公開文書。clean-buildはdist直下JSを削除する実挙動 |
| Aiterm MCPB | `scripts/build-mcpb.mjs` / manifest | package version一致後、既buildのruntime JSを再帰copy、stage自己参照を除外。runtime依存をinstallしvalidator/packする。archive構造の妥当性だけでimport完全性を代用しない |
| Aiterm release | `scripts/release.mjs` / `verify-release-commit.mjs` | main/clean/origin一致、tag未作成、metadata/README/CHANGELOG同期。準備済み同versionは重複commitを省く。npm lifecycleはdefault branch祖先とcleanを照合 |
| npm / Registry | `ci.yml` tag / `registry.yml` release | tag/version/main祖先、npm provenance。Registryはnpm可視化を待ってからOIDC取得、特定duplicateだけ既存成功扱い。script終了≠npm/Registry完了 |
| Steer package | `package.json` / tsconfig / `src/index.ts` | root export＋package.json、型宣言、dist再帰JS/d.ts、1CLI。public field/例外とstorage読取依存は[接点表](external-contracts.md)へ接続 |
| Steer CI | `.github/workflows/ci.yml` | 3OS test、tag/version/main祖先、tag job内test/pack、provenance。今回実行しない |

Aitermの固定sourceはSteer `^0.5.0`、lockは0.5.0のregistry URL/integrityである。今回のSteer調査基準0.5.1と混ぜない。`scripts/fixtures/steer-release-source.json`はproducer6b446f7の通常npm tgzを固定し、CIがcheckout内cacheへ同SHA512をseedして通常npm ciする。未公開source対の確認と、registry供給/provenance確認は別。includes/filesの範囲から外れる新moduleを作る設計では、pack閉包試験まで変更境界に含める。

## 検証範囲と隔離

Owner原文「定義した機能の入出力が守られれば該当機能の試験だけでよい。リファクタの切り分けを活かせ」を優先する。製品固定AGENTSの定型npm test記述を新しい全体試験要求へ流用しない。`product-ci-plan.mjs`はpath分類→別軸のOS選択とreverse import依存の試験選択を持つ。既存direct ruleや分類不能時all、手動test_filesのselected/all、同head同workflowの手動/定期full成功再利用という現行実装を記録する。今は規則を変更せず、新fullも起こさない。変更窓口の実契約と直接境界で必要試験を設計する。

`run-seat-tests.mjs`は明示repository test名だけを許し、`seat-env.mjs`を親とworkerへpreloadする。test外fileを拒否し、環境allowlist＋秘密名除外、短い一時runtime、空HOMEとvendor/gh/git/npmの明示置き場、git helper/hook/template無効化、実harness代わりの拒否bin、Codex wake無効化を保持する。Windows USERPROFILE等はruntime都合で残す一方、vendor storageを名指しする。検査を実行する際も稼働席を継承しない。

試験入口は先にseat-env自身を確認し、失敗したら他試験を起こさない。CIは端末backendとsystem git hook/template設定の有無を確認し、取得不能をunsetへ丸めない。test終了時のsocket生存/不明ではtempを残し、後始末の失敗で試験結果を偽装しない。全testの手読了やruntime受入を意味しない。

`test/core-agent-support.mjs`は偽CLI・HOME・argv/完了記録・cleanupを共有する（今回は1–150/800–874行のみ追加読取）。`agent-fixture-shell.mjs`はWindows pwshとPOSIX child shellのrender/input所有を扱う。`pty-failure-evidence.mjs`は失敗後・元cleanup前にgeneration/metadata/log/screen/processを保存し、before/after launch一致と欠測を明示する。これら試験用本文snapshotと、公開`pty_observe`の本文なしreceiptは別契約。fixtureのdeadline/skip/並列数は維持する。

`release-metadata`はversion/祖先/pack内harnesses/runtime/Steer tgz integrity、`repository-contract`はMarkdown AST上の実効link/HTML/srcsetとpack閉包、CI正本を検査する。既存の公開private module除外とnpm/MCPBの範囲差を保存する。

## 元Windows73failを辿る

原本run41397057670は846pass/73fail/569skip、gate failure、原因未確定。[全73件の試験位置・最初の例外・stack](evidence/windows-baseline-boundaries.json)を元logの行へ結合した。原本SHA-sizeはbaseline-evidence.jsonで固定済み。元logから73件を一回抽出し、件数と名前をassertした。新試験結果ではない。

| 表面化した最初の例外 | 件数 | 図→実装で辿る先 |
| --- | ---: | --- |
| 作成native本人性を取得できない | 51 | [起動/本人性](launch-identity-input.md) → `openAgent` created callback → `captureNativeSessionReceipt` / native session reader |
| 作成native端末の置換拒否（TelemetryOwnedError含む） | 8 | native作成receipt→`openSessionInternal`の同native照合/pipe準備。拒否の根因は未確定 |
| native作成結果の不明 | 1 | `tmuxNewSession`→作成trace/receiptの取得境界 |
| 入力受付にならない（state=idle/reason=composer_ready） | 1 | send queue→`dispatchAgentTurnInLock`→ready gate。表示文字列だけでready成立を補完しない |
| その他assertion/TypeError/MCP timeout等 | 12 | 元caseの最初の例外とstackを個別に辿る。fixture argv、PTY長文/空白path、PowerShell画面、process-start/observe等 |

これらは故障が見えた境界であり、73件の独立根因や同一原因を証明しない。後続のTypeErrorを一次の本人性不良へ勝手に束ねず、native作成拒否をprivate Windows未対応・OS権限・timeout不足へ置換しない。元runはsource8f68f32、release ce575はmetadata更新の対応関係をbaseline記録に保持する。追加試験/再現/修理はこのリファクタcommitへ混ぜない。

## 調査の限界と設計への引渡し

全tracked実装130＋25fileを全文初読し、26図・実関数対応へ反映した。release/config/CI/pack/test隔離と主要fixture入口は初読、全219/24補助testファイルの精査ではない。補助全pathとSHA-sizeはaiterm/steer-auxiliary-inventory.jsonに保存し、変更窓口のcaller/test/fixture/export精査と試験はA1–S1の検証原本へ記録した。prototype/experiments/archive/RAGの全履歴、untracked native CLI/setup補助は全調査済み扱いにしない。

採用設計の6段階は実装済み。現在の責任と関数位置はsource-index、検証と最終整合結果はverificationを正本とする。基準の全source初読と、限定された候補試験の範囲を区別する。
