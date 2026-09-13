# ADR 0064: 公開AitermのCodex Steerを受け入れる

- 日付: 2026-09-13
- 状態: accepted

## 判断

Aiterm 0.36.0のmacOS向けCodex Desktop Steerを受け入れ、今回の改良を完了とする。
公開npm packageを導入し、完全再起動後に通常の子起動と同じ子への追加依頼から回答を受け取った。
実行中は同じturnへ反映され、終了後は同じタスクの別turnが自動で開始されることを公式記録と突合した。
親が回答を回収する操作は使っていない。

## 採用する構成

[ADR 0063](0063-codex-steer-installation.md)の構成を維持する。中継と導入処理はAitermのnpm packageに含め、
公式Codex Desktop同梱binaryをそのまま使う。公式App Serverの独自build配布は不要である。
利用者は`aiterm-setup`でAiterm単品とmacOS Desktop Steer付き導入を選べる。
Steerを選んだ環境の接続失敗は明示エラーとし、queueへ自動退避しない。
将来の更新監視タスクや他OS向けnative transportの開発は今回追加していない。

## 根拠

- [公開・導入と3環境CI](../evidence/codex-steer-public-install-20260913.md)
- [公開版の実機配送と受入条件](../evidence/codex-steer-public-live-20260913.md)
- [独立反証・公式sourceとの対応・隔離試験](0063-codex-steer-installation.md)

初回の時間指定による終了後試験は同じturnへ入ったため棄却した。公式の終了記録を待つ別の試験で終了後再開が成立した。
未確認の結果を成功に丸めず、実機の受信・保存されたturn・配送状態の一致を受入根拠とした。

## 終了処理

試験用の子sessionは閉じ、消滅を確認した。記録はrepositoryへ残し、進行中の計画を履歴へ移す。
通常利用は導入済みの公開packageで継続する。設定解除は公開`aiterm-setup --codex-steer disable`を使う。
