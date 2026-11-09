> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 現在の全体図：リファクタリング候補

[描画済みSVG](current-overview.svg) / [PNG](current-overview.png) / [DOT原本](current-overview.dot)。候補の入口と接続を表す。全155実装fileの初読を完了し、内部経路は以下の各詳細図へ接続した。未確認は全caller/test/fixture独立照合と新しい動作受入であり、実装初読の残りとは区別する。[改善設計](refactor-rationale.md)は別図に置く。

| 現在の責務 | 実ファイル・入口 | 状態/返却 |
| --- | --- | --- |
| 公開MCP境界 | Aiterm `src/index.ts` `createAitermServer` / `registerRemoteAwareTool` / `launchAgent` / `fail` | schema検証、公開receipt/isError、呼出元へ返す。受付・完了を同一扱いしない |
| Runtime generation adoption | [runtime overlap/lifecycle/setup contract](runtime-adoption.md) | Explicit host standby/activate/status/retire; default public entry unchanged; no native seat restart |
| 席とagentの進行 | Aiterm `src/core.ts` `openAgent` / `openAgentWithInitialPrompt` / `dispatchAgentTurnInLock` / `resumeAgentInLock` / `closeSessionInternal` | session/launch/turnとnative進行、metadata・lifecycleを読む。全coreの対応はsource-indexと各詳細へ |
| 保存する本人性と状態 | Aiterm `agent-shared.ts` / `agent-lifecycle.ts` / `state-root.ts` | launch ID、generation、idle/resume、event file。公開launch receiptへのID提供と現在観測は別契約 |
| OSへの作用 | Aiterm `tmux-runtime.ts` / `process-start.ts` / `process-runtime.ts` / `process-tree-stop.ts` | tmux/psmux、出生本人性、process観測、停止。取得不能と不在を区別 |
| 子完了から親配送 | Aiterm `parent-delivery.ts` / `parent-delivery-cli.ts` / `steer-profile.ts` | child completionとparent deliveryを結合。親のvendor操作はSteer経由 |
| 観測と回答 | Aiterm `core.ts` / `agent-screen-observation.ts` / `aiterm-wait-cli.ts` | [liveness・画面・turn完了・本文](observation-results.md)を分け、hostの表示へ渡す |
| goal・設定・認証・remote | Aiterm `agent-goal*.ts` / `configure-goal.ts` / `model-catalog.ts` / `claude-catalog-root.ts` / `user-config.ts` / `remote.ts` / core | [native所有と作用/結果](goal-configuration-auth-remote.md)。goal inspectのUI作用、失敗不明と未発行、client接続終了と席closeを区別 |
| Terminal seats (C3/C7/C8) | Aiterm launch tools' `terminal` + `cwd` (`index.ts` -> `remote-terminal.ts` -> `remote.ts`) / terminal `--private-env-stdin` / `aiterm-transcript-read`; `aiterm-remote-terminal` for binding, reachability, C8 | [one launch path / data flow](remote-terminal.md). Same launch tool as local; later calls by session; trusted binding, private env line, exact cwd, transcript cursor, seat BellTeam MCP over a reverse forward. Self-service before open: `authorize-key` (password once over stdin), `provision` (macOS user-local runtime from release assets), fixed path ops |
| 共通の親配送 | Steer `index.ts` / `*-receiver.ts` / `*-hooks.ts` / `hook-main.ts` | profile・parent・delivery IDを受け、公式queue/hook/背景受信へ渡す |
| 継続channel | Steer `channel-state.ts`（保存・遷移） / `channel.ts`（本人確認・待機・出力） | channel/inbox/claim/emitted/closedと受信者の出力状態。Bridge DBは所有しない |
| 別製品の意味付け | BellTeam / grokbot-bridge | Bot/通話/予約/receipt/再起動など相手製品の責務。接点のみを調査する |

候補の全ファイル・静的関数・行・列・呼出は [Aiterm索引](source-index.md) / [機械可読原本](source-index.json)と[Steer索引](../../../steer-refactor-20261102/docs/architecture/source-index.md)にある。図と初読を全caller/fixture/実機の網羅確認には代用しない。

通常5harnessのbinding・完了・回答と、差込/途中表示は [vendor契約詳細](harness-contracts.md) / [関数対応](source-index.md) へ続く。

Private executionの契約・保存・観測は [private基盤](private-execution.md) / [関数対応](source-index.md) に明記した。通常mainの有効経路と区別する。

Private全33moduleの受付・完了・親配送・停止の詳細は [private受付](private-admission.md) → [private親配送](private-parent-delivery.md) → [停止/管理close](private-stop.md)。通常main・通常配送entryと、明示注入されたtrackingを区別する。

OS/nativeとprocess・通常shell・RTKは [native runtime](native-runtime.md)、導入と更新は [setup/update](setup-update.md)、旧Codex接続は [relay](codex-relay-runtime.md)、記録・診断・報告は [runtime errors](runtime-errors.md) へ続く。coreを含む130moduleとrelease/test隔離入口を初読済み。全test/fixture独立照合は未完。

## 全実装初読後の詳細接続

[通常PTY入出力](ordinary-pty.md)は上図のPTY入出力・表示から、[承認/operation/環境/Throughline](approval-operation-environment.md)は起動・送信・回収から、[配布/検証/元Windows失敗](release-verification.md)はsetup/update・製品供給から辿る。28図は候補の現在の動作を表す。採用案は[設計正本](refactor-rationale.md)、全体の変更/維持判断は[候補137file対応](source-index.md)へ続く。

## 採用6段階の責任分離

全体図の編集正本は[Aiterm候補のDOT](current-overview.dot)へ移管した。旧diagramsのDOT/SVG/PNGは同正本へのsymbolic link。起動記録の読取は[製品内の詳細・コード対応](metadata-reader.md)へ辿る。coreは進行と書込、readerは選択・検証・投影を所有する。全詳細図も各製品repoのdocs/architectureへ移管済み。A2の純表示はpty-output、A3のUIはagent-model-uiとharness configure、既定復元はuser-config、A4aのschemaはremote-contract、A4bのrecordはparent-delivery-record、S1の保存・遷移はSteer channel-stateが所有する。進行・副作用の順序と公開再exportは保持した。

## failed復帰の安全記録候補 D1

`agent-resume-diagnostic.ts`は新しい復帰処理の失敗だけを世代別`.resume-failure.json`へbest-effort保存する。最初に保存できた1件を残し、既failed/resuming継続拒否で上書きしない。phase/許可reason/型付き元codeだけを持ち、本文・path・生例外を保存しない。本文not_sentとnative_outcome unknownを区別する。元例外・attemptの作用順・6field公開返却は維持。正常成功の記録は作らない。既close cleanupが対象fileも片付ける。既runtime集計/collection/reportingには接続しない。公開読取D2はこのcommitでは未提供、同会話修復は証明不足で未提供。

H1の部分候補は[offline checkpoint reader](resume-checkpoint.md)。strict bundleと読取専用source検証を追加した。未公開候補CLI/非起動restoreを追加した。供給の停止/保存/起動前接続は外部runtimeと未結合。native停止は供給callerの前提で、checkpoint成功へ補完しない。


Host-controller initialization role, legacy compatibility and interim caller routing: [function map/data flow](host-controller.md).


All-five seat activity follows the managed observation-span function/DFD in [observation-results](observation-results.md); Codex tracking is inherited and other four use current original-pane occupancy with null tracking.
