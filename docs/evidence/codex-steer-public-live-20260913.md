# 公開AitermのCodex親配送・実機受入

2026-09-13、npmで公開・導入したAiterm 0.36.0について、Codex Desktopの完全再起動後に受入を完了した。
親自身が作業中の回答と終了後の回答を受信し、公式App Serverの記録およびAitermの配送receiptと照合した。
導入・CI・公開の証拠は[再起動前の記録](codex-steer-public-install-20260913.md)、最終判断は[ADR 0064](../adr/0064-codex-steer-public-acceptance.md)にある。

## 受入結果

| 条件 | 実測結果 |
| --- | --- |
| 公開物からの導入 | npm 0.36.0をglobal install。38個のruntimeファイルがrelease buildと一致 |
| 再起動による設定反映 | 公開`aiterm-setup --codex-steer status`が`ready`、終了コード0 |
| 公式binaryの維持 | PID 5063の公式App ServerがPID 5032のDesktopの直接の子。binary SHA-256は試作・隔離試験時と同一 |
| 製品の接続 | 製品のsocket `/tmp/aiterm-codex-501/5063.sock`を使用。試作のsocketを使用していない |
| アプリ内機能 | native `read_thread`が同じタスクの実行中状態を取得できた |
| 通常の子起動 | 公開`agent_launch`からCodex CLIを起動。初手開始確認後に非ブロックで返り、親配送receiptを取得 |
| 実行中Steer | 初手の回答を親が受信。同じ親turnのuser messageとして1回保存されていた |
| 同じ子への追加依頼 | 公開`pty_send`で同じlaunchへ依頼。初手とは別のdelivery IDで配送された |
| 終了後の自動再開 | 子が親の公式`task_complete`を確認してから回答。完了済みの親turnとは別のturnが同じタスクで開始され、親が回答を受信 |
| 配送状態 | 3回答とも`submitted`、`child_outcome=done`、`queued_submission_id=null`、`error_code=null` |
| 親による回収 | 親は子のwaiter・transcript回収を呼ばずに回答を受信。`pty_observe`は受信後の検証にだけ使用 |
| 試験の終了 | 試験用sessionを公開`pty_close`で閉じ、`pty_observe`の`exists=false`と元のharness PIDの消滅を確認 |

初手の実行中配送は`AITERM_PUBLIC_STEER_20260913`、終了後配送は`AITERM_PUBLIC_WAKE_AFTER_IDLE_20260913`で識別した。
前の親turnは`01a09a43-c222-7be3-ba04-a0c7921e320d`、終了後に開始された親turnは
`01a09a4c-0ab0-7951-add9-cdced5054b78`。宛先タスクは両方とも`01a098cd-2fc8-7261-9d69-d99550653b22`だった。

最初に時間を指定して遅らせた2回目の回答は、親の同じ実行中turnへ配送された。
会話を閉じたように見えることや経過時間だけでは公式turnの完了を保証できず、終了後試験の証拠には採用しなかった。
別の3回目の試験では、読取り専用の試験helperが当該親turnの公式終了記録を確認してから子が回答した。
このhelperは試験だけに使い、公開製品の配送へ待機処理や再試行を追加していない。

## 保持した証拠

非公開receiptは`.git/aiterm-experiments/codex-shared-20260913/`に保存した。

| receipt | 内容 |
| --- | --- |
| `public-install-receipt.json` | 公開物と起動設定の照合 |
| `public-setup-after-restart.json` | 再起動後のready |
| `public-live-steer.json` | 同じ親turnへの1回保存 |
| `public-live-wake.json` | 前turnのcompletedと同じタスクの別turnへの1回保存 |
| `public-smoke-deliveries.json` | 公開toolが返した3件の配送状態 |
| `public-smoke-closed.json` | 試験sessionの消滅 |

公式binaryのSHA-256は`ecad78dbf98adb89ec475edac86630406cbe59d9f3070b17d88065f136b94bcb`。
接続の識別には同じDesktopの直接の子・loaded task・本人所有のsocketを用い、資格情報や生argvを証拠に保存していない。

## 検証の範囲

macOS Desktopの公開package導入・再実行・完全再起動・実際の親配送まで確認した。
隔離した公式binaryの2試験は、各回答の1回保存とモデル入力、承認拒否、中継切断の分離、通常時と実行中の終了を検証済み。
関連34試験、文書検査、3環境CIとnpm provenance・GitHub Release・MCP Registry公開も成功している。
独立反証で指摘されたログイン設定の永続化と単独App Serverのfalse readyは再現して修正し、再確認を受けた。
Linux・WindowsはAiterm単品の対応を維持し、Desktop Steerの選択は明示unsupportedとする契約である。
ログイン時の設定はLaunchAgentの登録・読戻しと試験で確認した。OSログアウトそのものを実行した証拠ではない。
