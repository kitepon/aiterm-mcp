# Aitermの機能図と実装

このdirectoryが製品内部図の編集正本。全体図はAitermとSteerの接点を示し、Steer内部の詳細はSteer製品正本へリンクする。keeper基盤とHost権限運用、本体/Bridge内部は範囲外。

[全体図](current-overview.svg) / [全体説明](current-overview.md) → 各機能詳細 → [全137sourceの責務・関数・位置](source-index.md)。編集原本は各SVGと同名のDOT。図のsourceとコードを同じ差分で保守する。

- [起動・本人性・入力](launch-identity-input.md) / [状態所有・停止・取消・cleanup](lifecycle-state-ownership.md)
- [観測・回答](observation-results.md) / [5vendor・完了・差込](harness-contracts.md)
- [goal・設定・認証・remote](goal-configuration-auth-remote.md) / [設定の分離後](model-configuration.md)
- [起動記録reader](metadata-reader.md) / [通常PTY入出力・表示](ordinary-pty.md)
- [親配送と記録](parent-delivery.md) / [承認・耐久operation・環境](approval-operation-environment.md)
- [private基盤](private-execution.md) / [受付](private-admission.md) / [親配送](private-parent-delivery.md) / [停止](private-stop.md)
- [native/OS/process](native-runtime.md) / [導入・更新](setup-update.md) / [旧relay](codex-relay-runtime.md) / [障害記録](runtime-errors.md)
- [配布と基準失敗](release-verification.md) / [製品間接点](external-contracts.md)
- [採用理由と不採用代替案](refactor-rationale.md) / [候補の検証・未確認](verification.md)

Steer製品の正本は[隣接候補repoの入口](../../../steer-refactor-20261102/docs/architecture/README.md)。別repositoryのため同梱必須ではない。公開repositoryは https://github.com/kitepon/aiterm-steer-delivery 。本体の機能担当接点と運用の承認/予定はBotの進行記録で管理し、製品内部図を本体へ複製しない。

ソース調査の基準はce575ce8、候補ではA1–A4bを実装済み。source-index.jsonのheadはsource snapshot時点を示し、その後の文書だけのcommitはsource SHAに影響しない。[Astra最終整合](final-review.md)を完了し、完成候補をレビュー担当へ引き渡す。公開/本番の受入とは区別する。
