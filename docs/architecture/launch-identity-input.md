> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 起動・本人性・PTY入力：現在図と既失敗の位置

[描画済みSVG](launch-identity-input.svg) / [PNG](launch-identity-input.png) / [DOT原本](launch-identity-input.dot)。Aiterm基準 `ce575ce8`。

| 境界 | 実コード | 読取/作用/返却 |
| --- | --- | --- |
| MCP要求 | `src/index.ts` `launchAgent` | 引数とcontextから [openAgentWithInitialPrompt](../../src/core.ts#L7776) へ。`startup` と `initial_prompt` を別々に返す |
| 起動前・既席判断 | `src/core.ts` [openAgentWithInitialPrompt](../../src/core.ts#L7776)、[openAgent](../../src/core.ts#L7438) | session/既metadata/休止状態を調べ、新規作成と復帰を分岐。世代・停止・取消・cleanup条件はlifecycle-state-ownershipへ接続 |
| native作成 | `src/core.ts` [openSessionInternal](../../src/core.ts#L887) → `src/tmux-runtime.ts:646` `tmuxNewSession` → `captureNativeSessionReceipt` | shell/env構成とnative receipt。tmux/psmuxへの副作用。managed Claude/Codexは作成callbackへ戻る |
| 出生本人性 | `src/core.ts` のcreated callback → `src/process-start.ts:6` `processStartIdentities` | server/pane PIDからOSの開始本人性を読む。nullなら `AGENT_RESUME_UNCONFIRMED`。Windows default1000ms/PowerShell取得結果の理由保持は既実装どおり、修理しない |
| CLI起動行 | `src/core.ts` [openAgent](../../src/core.ts#L7438) 内create/send | native本人性を確認した後にmetadataや起動行を進める。元のHOME/vendor設定を使う。入力・設定の失敗と返却はlifecycle/設定/観測の各詳細に接続 |
| 起動準備・復帰準備 | `src/core.ts` [prepareAgentInput](../../src/core.ts#L4790)、[resumeAgentInLock](../../src/core.ts#L6602) | TUIの状態とnative harness生存を照合。復帰Codexのbusyを受けるにはnative running turnが必要 |
| 遅い観測の安定確認 | `agent-screen-observation.waitAgentTuiReadyImpl` | 連続11観測、または2回以上の連続idleが既定5秒を隔てて成立。観測完了時刻を使い、途中non-idle/settled取消で起点をリセット。既存期限とnative作用直前の照合は維持 |
| 本文入力 | `src/core.ts` [submitAgentComposerText](../../src/core.ts#L4692) | paste、Cursorの表示確認または既delay、Enterの順。admission/checkInput/beforePasteを維持 |
| 開始確認・結果 | `dispatchAgentTurnInLock` / [openAgentWithInitialPrompt](../../src/core.ts#L7776) → `index.ts` | submit残存・turn開始・未確認を区別。本文を書いた事とturnの完了は異なる |
| 後続観測 | `index.ts` `pty_observe` → `core.observeSession` | current launch/exists/native identityを読む。起動receiptの欠測を過去へ補完しない |

基準CI `41397057670` Windowsでは `process-start.test.mjs` の自身の出生本人性がnullになり、初期native作成callbackで拒否する多数のcase、argv fixture期限・PTY入力/出力の失敗を観測した。これは故障箇所の候補位置であり、原因を確定したものではない。元ログと5snapshot/24filesは `integrations/papillon-resume-20261102/publication/` に保全済み。基準のまま修理を混ぜず、停止・取消・作成後cleanupとresumeの例外順序は下記詳細へ接続した。

06:35工程の詳細は [状態所有・途中失敗・取消・cleanup](lifecycle-state-ownership.md)、[関数と静的caller/test参照](source-index.md)へ追加した。初期native本人性取得と、その後のmetadata/CLI起動行のcatchは別の位置にあり、同じcleanupが必ず走ると説明しない。

R1-C候補は公開済みfailedかつnative不在のCodexへ新出生のnativeを作り、同vendor IDを再開する。元failedをhibernatedへ変更せず、正規recovery-originとfresh root floorを既resume作成へ渡す。詳細/返却/unknown/cleanupは[lifecycle正本](lifecycle-state-ownership.md)へ接続する。生きている同名別nativeの採用や旧本文の再送は行わない。
