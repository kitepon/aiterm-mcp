# model設定の所有者

[全体図](current-overview.svg) → [設定操作](model-configuration.svg) / [goalとの接続](goal-configuration.svg)。編集正本は同名DOT。

| 実ファイル・関数 | 責任と接続 |
| --- | --- |
| `core.ts`: configureAgent / configureAgentInLock | 入力・現在世代・入力待ち、send/native排他、goal保護、作用前の不明化、metadataと返却を保持 |
| `core.ts`: agentModelUi | 既存captureScreenの45行、Enterまで含むsendAgentPromptText、既存sendMenuChoiceをadapterへ接続 |
| `agent-model-ui.ts`: AgentModelUi / lineCounts | 内部の画面/命令/keyの型と新通知数の既存集計。native状態を所有しない |
| `harnesses/claude-configure.ts`: configureClaudeForSessionOnly | picker探索、session-only/effort再確認、s直前beforeChange、新通知・元のreadyと有限Esc後始末 |
| `harnesses/codex-configure.ts`: configureCodexModel / chooseCodexModel | model/effort picker、必要時だけ元のreader/catalog、最終effort選択直前beforeChange、新通知数と有限Esc後始末 |
| `user-config.ts`: keepingUserDefaults / restoreUserDefaults | file lock内でsnapshot→action→finally復元。従来の3回400ms、復元失敗を握りaction結果/例外を返す |
| `core.ts`: keepingCodexDefaults / launchKeepingUserDefaults | Codex公式config復元とfile fallback、起動時のnative観測とcleanup。A3で移動しない |

初期のpickerコマンド/keyとmodel選択の作用境界は区別する。beforeChangeを越えた後の失敗を未作用へ戻さず、coreが元のconfigurationFailureへ射影する。中断・取消・画面取得失敗も元の例外を伝え、既存の画面後始末とfinally復元を通す。再送はしない。readyと画面通知と公開receiptは同じ意味ではない。

adapterへ渡すready/text waitはcoreの元の関数・既定timeoutのまま。catalogは元と同じfallback時点で取得する。設定fileの保存形式、3回/400ms、picker再試行の回数・待ち時間、goalと排他の順序を変更しない。

## failed復帰用の現在会話・設定プレビュー（R1準備部品）

`harnesses/idle-settings.ts:inspectCodexResumeSettings`は現在の`/statusline`メニューでthread-id（旧session-id）とmodel/effort/明示速度を読み、strictに一つのUUIDを照合する。既メニュー/欠測/別thread/不整合/閉じた後のready欠測はnull。Escapeで戻り、Enterで選択を保存しない。既inspectIdleSettingsと同じ有限プレビュー操作を共有する。

準備commit3efce36は部品のみだった。R1-L候補ではcore.completeFailedCodexResumeが通常resume/send/launchからこのpreviewを呼ぶ。対応はLinux/Codex/standard・現在設定一致の同nativeに限り、設定不一致UI復元とcold/H1は未実装。接続側が同native出生、空composer、input-owner/admissionと作用直前再検証を所有する。UI型だけでこれらを保証しない。実taskイベントを作らず初手前に確認できる条件を、`test/codex-resume-settings.test.mjs`で検証する。関連既callerはcore.inspectAgentIdleSettingsとtest/agent-idle-settings、公開MCP/schema/設定file/exportの変更無し。
