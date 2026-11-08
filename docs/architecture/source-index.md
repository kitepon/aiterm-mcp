# 実装の所有者と関数対応

現在の設定receipt追加分は[設定図](model-configuration.md)と[公開契約](../configure-reconcile.md)へ接続する。`src/configure-request.ts`（原要求receiptの保存/読取）と`src/configuration-effect.ts`（要求局所のnative作用前記録/終端拒否）を追加。以下のSHA/行番号表とJSONは作成時のsnapshotで、新規moduleの現在対応は上記を正本とする。

候補source 137 file。解析対象は下表のSHA256で固定。名前付き関数・メソッドを列挙し、匿名callbackを含む全本体と静的callはsource-index.json。静的解析は動作試験/全fixture精読の代用ではない。

## src/agent-activity.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-activity.ts](../../src/agent-activity.ts)。SHA256 `6fd3bca8bfc4966978f7aad06e8a7413c9eef5f3e2c601ea032793964aec0528`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [activityPath](../../src/agent-activity.ts#L14) | 14 | 3 |
| [validTime](../../src/agent-activity.ts#L15) | 15 | 4 |
| [unreadable](../../src/agent-activity.ts#L16) | 16 | 7 |
| [read](../../src/agent-activity.ts#L18) | 18 | 2 |
| [readAgentActivity](../../src/agent-activity.ts#L42) | 42 | 1 |
| [append](../../src/agent-activity.ts#L44) | 44 | 2 |
| [initializeAgentActivity](../../src/agent-activity.ts#L49) | 49 | 2 |
| [recordAgentInput](../../src/agent-activity.ts#L54) | 54 | 2 |
| [recordAgentTurnEnd](../../src/agent-activity.ts#L59) | 59 | 3 |

## src/agent-auth-ui.ts

責務: 認証。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-auth-ui.ts](../../src/agent-auth-ui.ts)。SHA256 `6cc9661e7b70c9fa2871ce98646ca8b3c23a3cce901b7e6f7ced7ba5805d536a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [authPromptDigest](../../src/agent-auth-ui.ts#L30) | 30 | 4 |
| [authUi](../../src/agent-auth-ui.ts#L33) | 33 | 1 |

## src/agent-auth.ts

責務: 認証。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-auth.ts](../../src/agent-auth.ts)。SHA256 `e034f8da79a20a81b934ed9faf53dd0cb0a3d176b54bf7f3374bd89c9b9c7fa3`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [authUrl](../../src/agent-auth.ts#L52) | 52 | 6 |
| [authUserCode](../../src/agent-auth.ts#L65) | 65 | 1 |

## src/agent-goal-native-result.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-goal-native-result.ts](../../src/agent-goal-native-result.ts)。SHA256 `782cc56589eef3aacd21436198ee11b14e75e2454024a8f9c6ec4b651ca8ca23`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [manageGrokAgentGoal](../../src/agent-goal-native-result.ts#L25) | 25 | 1 |
| [unavailable](../../src/agent-goal-native-result.ts#L35) | 35 | 3 |
| [manageClaudeAgentGoal](../../src/agent-goal-native-result.ts#L72) | 72 | 1 |
| [snapshot](../../src/agent-goal-native-result.ts#L92) | 92 | 3 |

## src/agent-goal-ui.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-goal-ui.ts](../../src/agent-goal-ui.ts)。SHA256 `ce44817cbf3706e23f463f73d89ea9183f50de4dfa6275c5ab41c8b6c2772199`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [nativeGoalClickBytes](../../src/agent-goal-ui.ts#L11) | 11 | 1 |
| [nativeGoalStyledRows](../../src/agent-goal-ui.ts#L18) | 18 | 2 |

## src/agent-goal.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-goal.ts](../../src/agent-goal.ts)。SHA256 `6c69e24c96f0eac3730ac648d7ed4595e5964cdb304582cb94fcf30b2054ea0e`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [goalOriginFromHost](../../src/agent-goal.ts#L27) | 27 | 2 |
| [sameGoalTarget](../../src/agent-goal.ts#L63) | 63 | 12 |
| [capabilities](../../src/agent-goal.ts#L86) | 86 | 4 |
| [manageAgentGoal](../../src/agent-goal.ts#L88) | 88 | 1 |
| [same](../../src/agent-goal.ts#L97) | 97 | 6 |
| [read](../../src/agent-goal.ts#L108) | 108 | 3 |
| [reject](../../src/agent-goal.ts#L135) | 135 | 6 |

## src/agent-idle-cli.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-idle-cli.ts](../../src/agent-idle-cli.ts)。SHA256 `31e4d1f1443bbef10186b6f03606fd9c97dd0c5ac8c40efccf4ca097738ea50f`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseIdleArgs](../../src/agent-idle-cli.ts#L8) | 8 | 1 |
| [main](../../src/agent-idle-cli.ts#L20) | 20 | 0 |

## src/agent-idle-clock.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-idle-clock.ts](../../src/agent-idle-clock.ts)。SHA256 `4f125fb2fb64e8d89b1aab01e2bf314b4c7e1e006666e07d24ac53e7ed591350`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [idleClockDeadline](../../src/agent-idle-clock.ts#L16) | 16 | 1 |
| [detached](../../src/agent-idle-clock.ts#L20) | 20 | 2 |
| [quote](../../src/agent-idle-clock.ts#L25) | 25 | 2 |
| [isAgentIdleClockOwner](../../src/agent-idle-clock.ts#L46) | 46 | 1 |
| [armAgentIdleClock](../../src/agent-idle-clock.ts#L51) | 51 | 1 |
| [requestAgentIdleClock](../../src/agent-idle-clock.ts#L72) | 72 | 4 |

## src/agent-idle.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-idle.ts](../../src/agent-idle.ts)。SHA256 `0f4ff15da169a18e3784abac147ebf28eb566140cb977497dcc1e4280c4f0e2a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [idleMinutes](../../src/agent-idle.ts#L26) | 26 | 1 |
| [decideIdleSeat](../../src/agent-idle.ts#L34) | 34 | 3 |
| [checkIdleSeat](../../src/agent-idle.ts#L72) | 72 | 1 |
| [verify](../../src/agent-idle.ts#L87) | 87 | 2 |

## src/agent-lifecycle.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-lifecycle.ts](../../src/agent-lifecycle.ts)。SHA256 `0d2c43c2387a716cca3f20f02202734734714e16db45e938524b26a7214b5fbe`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [file](../../src/agent-lifecycle.ts#L25) | 25 | 10 |
| [unavailable](../../src/agent-lifecycle.ts#L26) | 26 | 16 |
| [read](../../src/agent-lifecycle.ts#L27) | 27 | 6 |
| [readAgentResumeRecipe](../../src/agent-lifecycle.ts#L36) | 36 | 6 |
| [writeAgentResumeRecipe](../../src/agent-lifecycle.ts#L41) | 41 | 3 |
| [agentResumeRecipeDigest](../../src/agent-lifecycle.ts#L46) | 46 | 6 |
| [readAgentLifecycle](../../src/agent-lifecycle.ts#L49) | 49 | 20 |
| [writeAgentLifecycle](../../src/agent-lifecycle.ts#L54) | 54 | 2 |
| [cancelAgentStopping](../../src/agent-lifecycle.ts#L59) | 59 | 1 |
| [readAgentResumeAttempt](../../src/agent-lifecycle.ts#L70) | 70 | 7 |
| [writeAgentResumeAttempt](../../src/agent-lifecycle.ts#L75) | 75 | 3 |
| [readAgentResumeNative](../../src/agent-lifecycle.ts#L86) | 86 | 7 |
| [writeAgentResumeNative](../../src/agent-lifecycle.ts#L91) | 91 | 2 |
| [readAgentIdleClock](../../src/agent-lifecycle.ts#L101) | 101 | 4 |
| [writeAgentIdleClock](../../src/agent-lifecycle.ts#L106) | 106 | 1 |
| [retireAgentIdleClock](../../src/agent-lifecycle.ts#L111) | 111 | 1 |
| [readAgentResumeTemplate](../../src/agent-lifecycle.ts#L122) | 122 | 4 |
| [writeAgentResumeTemplate](../../src/agent-lifecycle.ts#L127) | 127 | 4 |
| [captureAgentResumeTemplate](../../src/agent-lifecycle.ts#L132) | 132 | 1 |
| [finishAgentResumeConfiguration](../../src/agent-lifecycle.ts#L140) | 140 | 1 |
| [refreshAgentResumeRecipe](../../src/agent-lifecycle.ts#L146) | 146 | 2 |

## src/agent-metadata-reader.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [metadata-reader.md](metadata-reader.md)。source: [src/agent-metadata-reader.ts](../../src/agent-metadata-reader.ts)。SHA256 `789a5d3e620fd4aef95137487fc48674bb05c7f859c1650672fff8d6cdda2ce4`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [normalizeInitialPromptState](../../src/agent-metadata-reader.ts#L15) | 15 | 5 |
| [loadAgentLineageFields](../../src/agent-metadata-reader.ts#L31) | 31 | 5 |
| [loadAgentMetadata](../../src/agent-metadata-reader.ts#L61) | 61 | 54 |
| [tryLoadAgentMetadata](../../src/agent-metadata-reader.ts#L285) | 285 | 31 |

## src/agent-model-ui.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [model-configuration.md](model-configuration.md)。source: [src/agent-model-ui.ts](../../src/agent-model-ui.ts)。SHA256 `cbe72450ba123ca82a10626a0d08ac1303bf03c21bc378a23c7e22a023adf613`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [lineCounts](../../src/agent-model-ui.ts#L8) | 8 | 3 |

## src/agent-resolver.ts

責務: モデル・解決・利用者設定。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/agent-resolver.ts](../../src/agent-resolver.ts)。SHA256 `8bbef4e7ea1b4b19253b1ae445ccdf16bb8b7a66ef31d4a023ee0aeb68643edd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [isUsableExecutableFile](../../src/agent-resolver.ts#L12) | 12 | 7 |
| [isWindowsDrivePath](../../src/agent-resolver.ts#L23) | 23 | 2 |
| [isWindowsNativeExecutable](../../src/agent-resolver.ts#L27) | 27 | 2 |
| [isUsableAgentExecutableFile](../../src/agent-resolver.ts#L36) | 36 | 4 |
| [resolveWindowsCodexShim](../../src/agent-resolver.ts#L46) | 46 | 3 |
| [agentBinForPaneShell](../../src/agent-resolver.ts#L69) | 69 | 2 |
| [spawnAgentControlCommand](../../src/agent-resolver.ts#L73) | 73 | 10 |
| [windowsControlArgs](../../src/agent-resolver.ts#L95) | 95 | 2 |
| [runAgentProtocolCommand](../../src/agent-resolver.ts#L117) | 117 | 2 |
| [finish](../../src/agent-resolver.ts#L142) | 142 | 2 |
| [stop](../../src/agent-resolver.ts#L148) | 148 | 2 |
| [resolveWinPaneShell](../../src/agent-resolver.ts#L169) | 169 | 7 |
| [resolveAgentBin](../../src/agent-resolver.ts#L199) | 199 | 20 |
| [resolveThroughlineBin](../../src/agent-resolver.ts#L250) | 250 | 1 |
| [runThroughlineHandoffContext](../../src/agent-resolver.ts#L259) | 259 | 1 |
| [windowsAgentLaunchLine](../../src/agent-resolver.ts#L287) | 287 | 2 |
| [psq](../../src/agent-resolver.ts#L289) | 289 | 4 |
| [windowsAgentArgv](../../src/agent-resolver.ts#L306) | 306 | 2 |

## src/agent-screen-observation.ts

責務: 観測・回答。詳細: [observation-results.md](observation-results.md)。source: [src/agent-screen-observation.ts](../../src/agent-screen-observation.ts)。SHA256 `f3adb4137e6f99f1e539bdb6c08b10607882071fdc3ba2578a0a80e8884d4d9b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [agentPaneObservation](../../src/agent-screen-observation.ts#L62) | 62 | 7 |
| [isAgentTuiReady](../../src/agent-screen-observation.ts#L70) | 70 | 2 |
| [isAgentTuiBusy](../../src/agent-screen-observation.ts#L81) | 81 | 6 |
| [isAgentTuiIdleReady](../../src/agent-screen-observation.ts#L91) | 91 | 4 |
| [isAgentTuiActionRequired](../../src/agent-screen-observation.ts#L97) | 97 | 1 |
| [launchEchoIsLastOnScreen](../../src/agent-screen-observation.ts#L119) | 119 | 1 |
| [waitAgentTuiReadyImpl](../../src/agent-screen-observation.ts#L130) | 130 | 3 |
| [inTime](../../src/agent-screen-observation.ts#L163) | 163 | 3 |
| [normalizeResidueText](../../src/agent-screen-observation.ts#L212) | 212 | 3 |
| [agentSubmitResidueTail](../../src/agent-screen-observation.ts#L216) | 216 | 2 |
| [agentSubmitResidueOnScreen](../../src/agent-screen-observation.ts#L225) | 225 | 2 |
| [detectAgentSubmitResidueImpl](../../src/agent-screen-observation.ts#L268) | 268 | 2 |
| [waitCursorPromptVisibleImpl](../../src/agent-screen-observation.ts#L299) | 299 | 2 |
| [settleAgentDoneScreenImpl](../../src/agent-screen-observation.ts#L317) | 317 | 1 |
| [__testSetAgentTuiReadyStableSamples](../../src/agent-screen-observation.ts#L350) | 350 | 0 |

## src/agent-shared.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/agent-shared.ts](../../src/agent-shared.ts)。SHA256 `f510f87cae25870db09c710c895c531ec3303a408e54f73f6024d6d301b3bb17`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [sleep](../../src/agent-shared.ts#L106) | 106 | 54 |
| [safeStatSize](../../src/agent-shared.ts#L111) | 111 | 39 |
| [readTailLinesNewestFirst](../../src/agent-shared.ts#L123) | 123 | 2 |
| [scanLinesNewestFirst](../../src/agent-shared.ts#L140) | 140 | 5 |
| [readFileRange](../../src/agent-shared.ts#L172) | 172 | 30 |
| [writeJson0600](../../src/agent-shared.ts#L194) | 194 | 24 |
| [writeText0600](../../src/agent-shared.ts#L215) | 215 | 0 |
| [createEmpty0600](../../src/agent-shared.ts#L224) | 224 | 7 |
| [shq](../../src/agent-shared.ts#L232) | 232 | 16 |
| [pollGate](../../src/agent-shared.ts#L247) | 247 | 3 |
| [assertSessionName](../../src/agent-shared.ts#L266) | 266 | 49 |
| [stateRoot](../../src/agent-shared.ts#L271) | 271 | 5 |
| [stateRootCandidates](../../src/agent-shared.ts#L282) | 282 | 1 |
| [ensureStateRoot](../../src/agent-shared.ts#L288) | 288 | 7 |
| [agentsDir](../../src/agent-shared.ts#L300) | 300 | 18 |
| [waitForFileState](../../src/agent-shared.ts#L305) | 305 | 0 |
| [finish](../../src/agent-shared.ts#L311) | 311 | 4 |
| [check](../../src/agent-shared.ts#L319) | 319 | 2 |
| [agentEventPath](../../src/agent-shared.ts#L333) | 333 | 6 |
| [agentMetadataPath](../../src/agent-shared.ts#L339) | 339 | 23 |
| [generationPath](../../src/agent-shared.ts#L348) | 348 | 2 |
| [readAgentGeneration](../../src/agent-shared.ts#L352) | 352 | 5 |
| [publishAgentGeneration](../../src/agent-shared.ts#L365) | 365 | 2 |
| [selectAgentMetadataFile](../../src/agent-shared.ts#L387) | 387 | 2 |
| [agentWaitLockPath](../../src/agent-shared.ts#L398) | 398 | 0 |
| [writeAgentMetadata](../../src/agent-shared.ts#L465) | 465 | 19 |
| [agentLabel](../../src/agent-shared.ts#L469) | 469 | 16 |
| [agentHarness](../../src/agent-shared.ts#L480) | 480 | 36 |
| [subagentInstruction](../../src/agent-shared.ts#L503) | 503 | 6 |
| [writeScopeLaunchNote](../../src/agent-shared.ts#L531) | 531 | 4 |
| [agentLineageFields](../../src/agent-shared.ts#L549) | 549 | 6 |

## src/aiterm-wait-cli.ts

責務: 観測・回答。詳細: [observation-results.md](observation-results.md)。source: [src/aiterm-wait-cli.ts](../../src/aiterm-wait-cli.ts)。SHA256 `a82d6d5b330d97402ff21db376482edf3b679dce62ae3485650ca36ec5f0e3bd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseArgs](../../src/aiterm-wait-cli.ts#L29) | 29 | 1 |
| [emit](../../src/aiterm-wait-cli.ts#L76) | 76 | 3 |
| [main](../../src/aiterm-wait-cli.ts#L93) | 93 | 0 |
| [isDirectExecution](../../src/aiterm-wait-cli.ts#L130) | 130 | 0 |

## src/antigravity-hook.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/antigravity-hook.ts](../../src/antigravity-hook.ts)。SHA256 `ebc041b1fd20f14cd9e110c988f729261ba4162d280cb55811c0ddbc6d2071f6`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [main](../../src/antigravity-hook.ts#L12) | 12 | 0 |

## src/claude-config-root.ts

責務: Claude設定rootの受入（BellTeam 1st/2nd）。詳細: [launch-identity-input.md](launch-identity-input.md)。source: [src/claude-config-root.ts](../../src/claude-config-root.ts)。2026-11-08追加（snapshot後）。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [claudeDefaultConfigRoot](../../src/claude-config-root.ts#L13) | 13 | 1 |
| [resolveClaudeConfigurationRoot](../../src/claude-config-root.ts#L21) | 21 | 2 |
| [withClaudeConfigRoot](../../src/claude-config-root.ts#L35) | 35 | 2 |

## src/claude-operation-marker.ts

責務: 通常受付・進行。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/claude-operation-marker.ts](../../src/claude-operation-marker.ts)。SHA256 `67274dfc8428d2862d59ec799eccb9707a51dfa9d8799c01ef92e8c4b678a20a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseClaudeOperationMarker](../../src/claude-operation-marker.ts#L4) | 4 | 2 |

## src/claude-parent-hook.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/claude-parent-hook.ts](../../src/claude-parent-hook.ts)。SHA256 `e59d2282bfa54c065e60ba358173a148710da58a4c3f5224928038cfe936ca18`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/claude-parent-receiver.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/claude-parent-receiver.ts](../../src/claude-parent-receiver.ts)。SHA256 `fce981e5b3d6ba897b61702b4065835100a644b819d117979eb1b39316380775`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [defaultRoot](../../src/claude-parent-receiver.ts#L16) | 16 | 5 |
| [prepareClaudeHookRequest](../../src/claude-parent-receiver.ts#L18) | 18 | 0 |
| [claudeParentFromRequest](../../src/claude-parent-receiver.ts#L21) | 21 | 2 |
| [verifyClaudeParent](../../src/claude-parent-receiver.ts#L24) | 24 | 1 |
| [bindClaudeParentDelivery](../../src/claude-parent-receiver.ts#L25) | 25 | 1 |
| [discardClaudeHookRequest](../../src/claude-parent-receiver.ts#L27) | 27 | 1 |
| [closeClaudeParentSession](../../src/claude-parent-receiver.ts#L31) | 31 | 0 |
| [submitClaudeParentAnswer](../../src/claude-parent-receiver.ts#L32) | 32 | 1 |
| [runClaudeResultHook](../../src/claude-parent-receiver.ts#L35) | 35 | 0 |

## src/claude-stop-hook.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/claude-stop-hook.ts](../../src/claude-stop-hook.ts)。SHA256 `24e40a21784ae152a846d751aa3f11c819aa0ea121b6a09ce1ee7002f2b24a58`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [fail](../../src/claude-stop-hook.ts#L16) | 16 | 19 |
| [noop](../../src/claude-stop-hook.ts#L21) | 21 | 2 |
| [hasAitermEnv](../../src/claude-stop-hook.ts#L25) | 25 | 1 |
| [agentsDir](../../src/claude-stop-hook.ts#L35) | 35 | 1 |
| [readStdin](../../src/claude-stop-hook.ts#L44) | 44 | 1 |
| [writeResult](../../src/claude-stop-hook.ts#L56) | 56 | 1 |
| [appendEvent](../../src/claude-stop-hook.ts#L78) | 78 | 1 |
| [readOperationMarker](../../src/claude-stop-hook.ts#L103) | 103 | 1 |
| [consumeOperationMarker](../../src/claude-stop-hook.ts#L130) | 130 | 1 |
| [seatVendorSessionId](../../src/claude-stop-hook.ts#L150) | 150 | 1 |
| [main](../../src/claude-stop-hook.ts#L160) | 160 | 0 |

## src/codex-delivery-error.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-delivery-error.ts](../../src/codex-delivery-error.ts)。SHA256 `32f093c3cc9a55522a09f010161721c913126dc043dd7c852275c7332356ec2b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/codex-desktop-binary.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-desktop-binary.ts](../../src/codex-desktop-binary.ts)。SHA256 `d0f866134e8de11d88e745fd23a059c34c7b6e543f0daa1b401dbdc5820db806`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [currentCodexDesktopBinary](../../src/codex-desktop-binary.ts#L8) | 8 | 0 |

## src/codex-goal-connection.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/codex-goal-connection.ts](../../src/codex-goal-connection.ts)。SHA256 `1c20caecfdb847c850fdb94cc2af7c28f38a4419fe6eddc251bbc54ecae2c5b5`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [nativeCodexGoalSocket](../../src/codex-goal-connection.ts#L8) | 8 | 1 |

## src/codex-hook-state.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-hook-state.ts](../../src/codex-hook-state.ts)。SHA256 `4385cc82ef74297d9f812666cbe78ab3edd6843a68981b1770aca6345bceee1b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [codexHookDirectory](../../src/codex-hook-state.ts#L9) | 9 | 5 |
| [readCodexHookConfig](../../src/codex-hook-state.ts#L10) | 10 | 5 |
| [registerCodexHookInput](../../src/codex-hook-state.ts#L11) | 11 | 0 |
| [finishCodexHookSubmission](../../src/codex-hook-state.ts#L14) | 14 | 0 |
| [codexHookDeliveryState](../../src/codex-hook-state.ts#L15) | 15 | 2 |
| [ownedCodexHooks](../../src/codex-hook-state.ts#L18) | 18 | 0 |
| [assertCodexHooksReady](../../src/codex-hook-state.ts#L19) | 19 | 0 |
| [assertCodexHookParentCurrent](../../src/codex-hook-state.ts#L20) | 20 | 0 |

## src/codex-parent-hook.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-parent-hook.ts](../../src/codex-parent-hook.ts)。SHA256 `4e050c0427f21552f613729f7497b72eeb31c0a6ac11f24da80ee73947ff8f9c`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/codex-parent-hooks.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-parent-hooks.ts](../../src/codex-parent-hooks.ts)。SHA256 `7ee9cf8144cc40fc3f7095df35262abec8dd5096ce009fa944f953481835269b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [runCodexResultHook](../../src/codex-parent-hooks.ts#L6) | 6 | 0 |

## src/codex-parent-receiver.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/codex-parent-receiver.ts](../../src/codex-parent-receiver.ts)。SHA256 `3f52522ef0141c48009ecb57efa3caa1ef99c89541a1a5fa928add683df2139d`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [relaySocket](../../src/codex-parent-receiver.ts#L19) | 19 | 3 |
| [withCodexReceiver](../../src/codex-parent-receiver.ts#L26) | 26 | 2 |
| [verifyCodexParent](../../src/codex-parent-receiver.ts#L35) | 35 | 1 |
| [checkCodexParent](../../src/codex-parent-receiver.ts#L55) | 55 | 1 |
| [submitCodexParentAnswer](../../src/codex-parent-receiver.ts#L66) | 66 | 2 |

## src/codex-relay-arguments.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-arguments.ts](../../src/codex-relay-arguments.ts)。SHA256 `dc55fdb5b38186cd38a04fe29dd784fe7e106a1d1c8c553fb586b08c306e81ef`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [codexServerArguments](../../src/codex-relay-arguments.ts#L2) | 2 | 2 |

## src/codex-relay-client.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-client.ts](../../src/codex-relay-client.ts)。SHA256 `63c75ea0229d22674ce31a2727476831511b3be698b68c8bc0b1f20e4ca7822c`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [withCodexRelay](../../src/codex-relay-client.ts#L10) | 10 | 6 |
| [fail](../../src/codex-relay-client.ts#L30) | 30 | 4 |
| [request](../../src/codex-relay-client.ts#L49) | 49 | 0 |
| [verifyLoadedParent](../../src/codex-relay-client.ts#L77) | 77 | 4 |

## src/codex-relay-config.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-config.ts](../../src/codex-relay-config.ts)。SHA256 `98c12d978d2d1e80ea5b83799b78e06a184cfa039546568ec85297d3fe932386`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [relayConfigDirectory](../../src/codex-relay-config.ts#L18) | 18 | 5 |
| [readRelayConfig](../../src/codex-relay-config.ts#L22) | 22 | 4 |
| [prepareRelayDirectory](../../src/codex-relay-config.ts#L31) | 31 | 1 |
| [verifyRelaySocket](../../src/codex-relay-config.ts#L40) | 40 | 3 |
| [parentRelaySocket](../../src/codex-relay-config.ts#L49) | 49 | 1 |

## src/codex-relay-launcher.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-launcher.ts](../../src/codex-relay-launcher.ts)。SHA256 `a9f1a960018b6d869a97a6ab59b619f61337b24068f443f0973f08868fc08f91`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [quote](../../src/codex-relay-launcher.ts#L5) | 5 | 1 |
| [codexRelayLauncher](../../src/codex-relay-launcher.ts#L7) | 7 | 1 |
| [preparePosixRelayLaunch](../../src/codex-relay-launcher.ts#L16) | 16 | 0 |

## src/codex-relay-login.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-login.ts](../../src/codex-relay-login.ts)。SHA256 `851962ec13269a739d54377b598c416208ced4ed5412970240d7bca8e8d58fc6`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [xml](../../src/codex-relay-login.ts#L9) | 9 | 1 |
| [relayLoginPlist](../../src/codex-relay-login.ts#L10) | 10 | 2 |
| [context](../../src/codex-relay-login.ts#L14) | 14 | 2 |
| [installRelayLogin](../../src/codex-relay-login.ts#L25) | 25 | 0 |
| [removeRelayLogin](../../src/codex-relay-login.ts#L35) | 35 | 0 |

## src/codex-relay-setup.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-setup.ts](../../src/codex-relay-setup.ts)。SHA256 `0c1c9e898642a90769df42a38d0f232466a7092fbfa0b56fe42bab84197da87b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [configureRelay](../../src/codex-relay-setup.ts#L23) | 23 | 3 |

## src/codex-relay-stdio.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-relay-stdio.ts](../../src/codex-relay-stdio.ts)。SHA256 `b8b9ca1af794ebee361bbd6ef1d106f50c8252b61152ceb94d4611fc9e7a7299`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [relayCodexStdio](../../src/codex-relay-stdio.ts#L7) | 7 | 2 |
| [stop](../../src/codex-relay-stdio.ts#L17) | 17 | 2 |
| [end](../../src/codex-relay-stdio.ts#L21) | 21 | 5 |
| [outputFailed](../../src/codex-relay-stdio.ts#L22) | 22 | 0 |
| [drain](../../src/codex-relay-stdio.ts#L24) | 24 | 0 |

## src/codex-stdio-relay.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/codex-stdio-relay.ts](../../src/codex-stdio-relay.ts)。SHA256 `37ef570599752a951f79cc9950434397225e90ac0f539bd05b785507a6a4da98`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [runCodexStdioRelay](../../src/codex-stdio-relay.ts#L10) | 10 | 0 |

## src/configure-goal.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/configure-goal.ts](../../src/configure-goal.ts)。SHA256 `76f07789e99a4c419916c9fcf5645dc49e4949c4f032963b8193b0d261a2a9e6`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [confirmed](../../src/configure-goal.ts#L10) | 10 | 5 |
| [goalState](../../src/configure-goal.ts#L14) | 14 | 3 |
| [configureWithPausedGoal](../../src/configure-goal.ts#L20) | 20 | 1 |

## src/core.ts

責務: 通常受付・進行。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/core.ts](../../src/core.ts)。SHA256 `feec6e44bc8e19cba4299f37989373160e7d177a9b79aa3195861db036dcf3f4`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [pauseSync](../../src/core.ts#L311) | 311 | 5 |
| [tmux](../../src/core.ts#L331) | 331 | 58 |
| [tmuxCleanup](../../src/core.ts#L334) | 334 | 4 |
| [sessionExists](../../src/core.ts#L338) | 338 | 13 |
| [paneCurrentCommand](../../src/core.ts#L342) | 342 | 2 |
| [classifyPaneTtyProcesses](../../src/core.ts#L382) | 382 | 2 |
| [termiosIsCooked](../../src/core.ts#L413) | 413 | 2 |
| [paneTtyInputOwnerReady](../../src/core.ts#L420) | 420 | 1 |
| [paneTtyOf](../../src/core.ts#L439) | 439 | 4 |
| [ensureAgentOwnsPaneInput](../../src/core.ts#L451) | 451 | 3 |
| [observe](../../src/core.ts#L461) | 461 | 2 |
| [paneCurrentCommandForMark](../../src/core.ts#L520) | 520 | 1 |
| [pasteBufferSupportsNoSanitizeFlag](../../src/core.ts#L524) | 524 | 1 |
| [splitPtyText](../../src/core.ts#L540) | 540 | 1 |
| [assertSendTextSize](../../src/core.ts#L558) | 558 | 2 |
| [existingAgentsDir](../../src/core.ts#L565) | 565 | 5 |
| [savedAgentSessionNames](../../src/core.ts#L579) | 579 | 3 |
| [cleanupAgentState](../../src/core.ts#L587) | 587 | 3 |
| [logpath](../../src/core.ts#L638) | 638 | 14 |
| [offsetpath](../../src/core.ts#L641) | 641 | 3 |
| [lastcmdpath](../../src/core.ts#L644) | 644 | 4 |
| [markpath](../../src/core.ts#L648) | 648 | 7 |
| [sendLockPath](../../src/core.ts#L651) | 651 | 2 |
| [agentSendLockPath](../../src/core.ts#L656) | 656 | 11 |
| [agentSendReapPath](../../src/core.ts#L661) | 661 | 2 |
| [readOffset](../../src/core.ts#L665) | 665 | 2 |
| [writeOffset](../../src/core.ts#L673) | 673 | 2 |
| [writeLastcmd](../../src/core.ts#L676) | 676 | 1 |
| [readLastcmd](../../src/core.ts#L683) | 683 | 1 |
| [attachHint](../../src/core.ts#L691) | 691 | 3 |
| [autoName](../../src/core.ts#L704) | 704 | 1 |
| [nonceName](../../src/core.ts#L715) | 715 | 1 |
| [captureScreen](../../src/core.ts#L719) | 719 | 66 |
| [waitCompletion](../../src/core.ts#L728) | 728 | 1 |
| [completionSuffix](../../src/core.ts#L847) | 847 | 3 |
| [rtkRewrite](../../src/core.ts#L858) | 858 | 1 |
| [assertNoDormantSession](../../src/core.ts#L873) | 873 | 3 |
| [openSession](../../src/core.ts#L881) | 881 | 3 |
| [openSessionInternal](../../src/core.ts#L887) | 887 | 2 |
| [assertAgentPreface](../../src/core.ts#L1019) | 1019 | 3 |
| [claudeWrapsPaste](../../src/core.ts#L1043) | 1043 | 1 |
| [splitAgentPreface](../../src/core.ts#L1054) | 1054 | 3 |
| [prepareSendText](../../src/core.ts#L1067) | 1067 | 6 |
| [send](../../src/core.ts#L1073) | 1073 | 9 |
| [writePty](../../src/core.ts#L1137) | 1137 | 3 |
| [sendKey](../../src/core.ts#L1225) | 1225 | 9 |
| [sendKeyResult](../../src/core.ts#L1232) | 1232 | 2 |
| [sendKeyResultInNative](../../src/core.ts#L1245) | 1245 | 1 |
| [receipt](../../src/core.ts#L1250) | 1250 | 2 |
| [readInterruptionTarget](../../src/core.ts#L1269) | 1269 | 3 |
| [interruptSessionNow](../../src/core.ts#L1281) | 1281 | 0 |
| [interruptSessionNowInNative](../../src/core.ts#L1295) | 1295 | 1 |
| [interruptionLaunchId](../../src/core.ts#L1325) | 1325 | 0 |
| [interruptExpectedAgentRun](../../src/core.ts#L1335) | 1335 | 0 |
| [verifyRun](../../src/core.ts#L1339) | 1339 | 2 |
| [current](../../src/core.ts#L1355) | 1355 | 2 |
| [observeExpectedAgentRunInterruption](../../src/core.ts#L1393) | 1393 | 1 |
| [snapshot](../../src/core.ts#L1398) | 1398 | 2 |
| [matchesClaudeInterruptionMarker](../../src/core.ts#L1434) | 1434 | 3 |
| [observeManagedClaudeInterruption](../../src/core.ts#L1441) | 1441 | 3 |
| [files](../../src/core.ts#L1445) | 1445 | 2 |
| [identity](../../src/core.ts#L1448) | 1448 | 4 |
| [snapshot](../../src/core.ts#L1465) | 1465 | 2 |
| [reference](../../src/core.ts#L1487) | 1487 | 3 |
| [selectExpectedAgentRunInterruption](../../src/core.ts#L1505) | 1505 | 0 |
| [utf8SafeEnd](../../src/core.ts#L1549) | 1549 | 1 |
| [isCont](../../src/core.ts#L1551) | 1551 | 1 |
| [utf8SafeSliceStart](../../src/core.ts#L1570) | 1570 | 2 |
| [readOutput](../../src/core.ts#L1576) | 1576 | 1 |
| [readOutputInNative](../../src/core.ts#L1579) | 1579 | 1 |
| [readRange](../../src/core.ts#L1606) | 1606 | 2 |
| [decodeActivityCursor](../../src/core.ts#L1733) | 1733 | 3 |
| [selectHarnessProcesses](../../src/core.ts#L1746) | 1746 | 3 |
| [matches](../../src/core.ts#L1747) | 1747 | 1 |
| [sameFile](../../src/core.ts#L1755) | 1755 | 1 |
| [processKey](../../src/core.ts#L1779) | 1779 | 5 |
| [startupProcessShapes](../../src/core.ts#L1782) | 1782 | 1 |
| [postStartupProcessCount](../../src/core.ts#L1798) | 1798 | 1 |
| [relayChild](../../src/core.ts#L1803) | 1803 | 1 |
| [ownProbe](../../src/core.ts#L1809) | 1809 | 1 |
| [emptySessionObservation](../../src/core.ts#L1838) | 1838 | 1 |
| [agentDormantState](../../src/core.ts#L1850) | 1850 | 10 |
| [observeSession](../../src/core.ts#L1865) | 1865 | 10 |
| [absentHarnessAlive](../../src/core.ts#L1893) | 1893 | 1 |
| [observeSessionNative](../../src/core.ts#L1902) | 1902 | 2 |
| [observeNativeSession](../../src/core.ts#L1954) | 1954 | 5 |
| [observeSessionGeneration](../../src/core.ts#L2005) | 2005 | 1 |
| [checkAgentIdle](../../src/core.ts#L2013) | 2013 | 1 |
| [metadata](../../src/core.ts#L2027) | 2027 | 7 |
| [native](../../src/core.ts#L2037) | 2037 | 4 |
| [snapshot](../../src/core.ts#L2051) | 2051 | 1 |
| [serviceAgentIdleClock](../../src/core.ts#L2161) | 2161 | 1 |
| [maintainAgentIdleClocks](../../src/core.ts#L2185) | 2185 | 2 |
| [observeExecutionSessionGeneration](../../src/core.ts#L2199) | 2199 | 13 |
| [result](../../src/core.ts#L2201) | 2201 | 4 |
| [observeExecutionAuthSessionGeneration](../../src/core.ts#L2218) | 2218 | 0 |
| [selectExecutionAuthSessionName](../../src/core.ts#L2225) | 2225 | 0 |
| [observeExecutionCreatedLaunch](../../src/core.ts#L2229) | 2229 | 0 |
| [observeExecutionExitedCreatedLaunch](../../src/core.ts#L2234) | 2234 | 0 |
| [observeEmptyCreatedLaunch](../../src/core.ts#L2237) | 2237 | 2 |
| [unknown](../../src/core.ts#L2239) | 2239 | 5 |
| [generation](../../src/core.ts#L2240) | 2240 | 2 |
| [read](../../src/core.ts#L2244) | 2244 | 2 |
| [observeExecutionParentProcess](../../src/core.ts#L2268) | 2268 | 3 |
| [listNativeSessionsResult](../../src/core.ts#L2286) | 2286 | 6 |
| [list](../../src/core.ts#L2292) | 2292 | 2 |
| [listSessionsResult](../../src/core.ts#L2329) | 2329 | 4 |
| [listSessions](../../src/core.ts#L2357) | 2357 | 1 |
| [agentSessionChildren](../../src/core.ts#L2383) | 2383 | 0 |
| [readOnlyPtyListDiagnostic](../../src/core.ts#L2398) | 2398 | 1 |
| [assertSessionClosable](../../src/core.ts#L2416) | 2416 | 1 |
| [requestClaudeExit](../../src/core.ts#L2469) | 2469 | 1 |
| [__testSetClaudeExitBeforeClose](../../src/core.ts#L2488) | 2488 | 0 |
| [letClaudeExitBeforeClose](../../src/core.ts#L2497) | 2497 | 1 |
| [closeSessionInternal](../../src/core.ts#L2516) | 2516 | 3 |
| [finish](../../src/core.ts#L2519) | 2519 | 3 |
| [unavailable](../../src/core.ts#L2553) | 2553 | 2 |
| [closeSession](../../src/core.ts#L2568) | 2568 | 2 |
| [closeSessionResult](../../src/core.ts#L2586) | 2586 | 1 |
| [absentExecutionServer](../../src/core.ts#L2601) | 2601 | 2 |
| [readExecutionNativeSessionList](../../src/core.ts#L2611) | 2611 | 2 |
| [read](../../src/core.ts#L2612) | 2612 | 2 |
| [observeExecutionNativeSessions](../../src/core.ts#L2626) | 2626 | 5 |
| [observeExecutionNativeCreationScope](../../src/core.ts#L2636) | 2636 | 3 |
| [read](../../src/core.ts#L2639) | 2639 | 2 |
| [closeExpectedAgentSession](../../src/core.ts#L2658) | 2658 | 0 |
| [sessions](../../src/core.ts#L2664) | 2664 | 0 |
| [launch](../../src/core.ts#L2669) | 2669 | 0 |
| [kill](../../src/core.ts#L2673) | 2673 | 0 |
| [killAll](../../src/core.ts#L2680) | 2680 | 0 |
| [readAgentLineageSeed](../../src/core.ts#L2747) | 2747 | 1 |
| [createAgentLineageContext](../../src/core.ts#L2777) | 2777 | 1 |
| [runAgentApproval](../../src/core.ts#L2825) | 2825 | 1 |
| [runAgentApprovalInNative](../../src/core.ts#L2829) | 2829 | 1 |
| [writeClaudeOperationMarker](../../src/core.ts#L2924) | 2924 | 2 |
| [readClaudeOperationMarker](../../src/core.ts#L2938) | 2938 | 13 |
| [reserveClaudeOperation](../../src/core.ts#L2967) | 2967 | 1 |
| [reserveAnonymousClaudeTurn](../../src/core.ts#L3000) | 3000 | 2 |
| [managedClaudeOperation](../../src/core.ts#L3012) | 3012 | 2 |
| [clearClaudeApiErrorOperation](../../src/core.ts#L3024) | 3024 | 1 |
| [canonicalClaudeApprovalScreen](../../src/core.ts#L3043) | 3043 | 1 |
| [parseClaudeApprovalScreen](../../src/core.ts#L3051) | 3051 | 2 |
| [assertExpectedClaudeOperation](../../src/core.ts#L3094) | 3094 | 2 |
| [runClaudeApproval](../../src/core.ts#L3108) | 3108 | 1 |
| [runClaudeApprovalInNative](../../src/core.ts#L3112) | 3112 | 1 |
| [hasClaudeDispatchReceipt](../../src/core.ts#L3193) | 3193 | 1 |
| [setInitialPromptState](../../src/core.ts#L3206) | 3206 | 11 |
| [isPidAlive](../../src/core.ts#L3224) | 3224 | 3 |
| [probeWaitLock](../../src/core.ts#L3237) | 3237 | 5 |
| [unlinkStaleWaitLock](../../src/core.ts#L3258) | 3258 | 0 |
| [liveSendLocks](../../src/core.ts#L3268) | 3268 | 2 |
| [acquireSessionSendFileLock](../../src/core.ts#L3289) | 3289 | 4 |
| [__testSetAgentSendLockWaitMs](../../src/core.ts#L3361) | 3361 | 0 |
| [tryCreateOwnedLock](../../src/core.ts#L3367) | 3367 | 5 |
| [releaseOwnedLock](../../src/core.ts#L3388) | 3388 | 5 |
| [probeAgentSendLock](../../src/core.ts#L3401) | 3401 | 3 |
| [agentSendLockOwnerReplaced](../../src/core.ts#L3410) | 3410 | 2 |
| [agentSendReapMarkStuck](../../src/core.ts#L3426) | 3426 | 2 |
| [reapDeadAgentSendLock](../../src/core.ts#L3435) | 3435 | 2 |
| [agentSendBusyError](../../src/core.ts#L3460) | 3460 | 3 |
| [acquireAgentSendFileLock](../../src/core.ts#L3468) | 3468 | 1 |
| [withAgentNativeOperation](../../src/core.ts#L3510) | 3510 | 6 |
| [unavailable](../../src/core.ts#L3517) | 3517 | 2 |
| [execute](../../src/core.ts#L3518) | 3518 | 1 |
| [withAgentSendLock](../../src/core.ts#L3532) | 3532 | 12 |
| [cleanupAgentSendLock](../../src/core.ts#L3586) | 3586 | 1 |
| [liveWaitLocks](../../src/core.ts#L3599) | 3599 | 2 |
| [parseAgentDoneEvent](../../src/core.ts#L3622) | 3622 | 4 |
| [scanAgentDoneLines](../../src/core.ts#L3677) | 3677 | 3 |
| [bindAgentHarnessSession](../../src/core.ts#L3711) | 3711 | 5 |
| [bindCompletedInitialPrompt](../../src/core.ts#L3720) | 3720 | 2 |
| [latestAgentDoneEvent](../../src/core.ts#L3783) | 3783 | 5 |
| [completedClaudeOperationEvent](../../src/core.ts#L3809) | 3809 | 1 |
| [recoverAgentHarnessSession](../../src/core.ts#L3834) | 3834 | 1 |
| [agentCompletionCursor](../../src/core.ts#L3872) | 3872 | 4 |
| [transcriptUnavailable](../../src/core.ts#L3890) | 3890 | 4 |
| [transcriptNotFound](../../src/core.ts#L3897) | 3897 | 1 |
| [readTranscriptLines](../../src/core.ts#L3904) | 3904 | 1 |
| [claudeCompletionWasPublishedAfterMarker](../../src/core.ts#L3915) | 3915 | 1 |
| [settlePublishedClaudeCompletionMarker](../../src/core.ts#L3932) | 3932 | 1 |
| [readSessionInterimWords](../../src/core.ts#L3961) | 3961 | 1 |
| [readSeatTurns](../../src/core.ts#L3984) | 3984 | 1 |
| [readAgentTranscriptResult](../../src/core.ts#L4001) | 4001 | 3 |
| [readAgentTranscript](../../src/core.ts#L4086) | 4086 | 0 |
| [inferAgentFrontend](../../src/core.ts#L4093) | 4093 | 1 |
| [agentReadMetadataSuffix](../../src/core.ts#L4104) | 4104 | 3 |
| [assertInitialPromptNotPendingForSend](../../src/core.ts#L4132) | 4132 | 1 |
| [quoteWindowsProcessArgument](../../src/core.ts#L4155) | 4155 | 0 |
| [windowsStartProcessArgumentList](../../src/core.ts#L4173) | 4173 | 2 |
| [agentWaitProcess](../../src/core.ts#L4179) | 4179 | 4 |
| [autoDeliveryParent](../../src/core.ts#L4208) | 4208 | 4 |
| [setParentClient](../../src/core.ts#L4215) | 4215 | 1 |
| [agentWaitLaunchForm](../../src/core.ts#L4222) | 4222 | 2 |
| [agentDispatchGuide](../../src/core.ts#L4230) | 4230 | 2 |
| [agentWaitGuide](../../src/core.ts#L4250) | 4250 | 10 |
| [detectAgentRateLimit](../../src/core.ts#L4264) | 4264 | 3 |
| [observeAgentDone](../../src/core.ts#L4279) | 4279 | 4 |
| [observeAgentDoneInternal](../../src/core.ts#L4296) | 4296 | 1 |
| [plain](../../src/core.ts#L4312) | 4312 | 1 |
| [screen](../../src/core.ts#L4336) | 4336 | 2 |
| [observation](../../src/core.ts#L4359) | 4359 | 6 |
| [agentTurnSettled](../../src/core.ts#L4443) | 4443 | 2 |
| [waitAgentTuiReady](../../src/core.ts#L4454) | 4454 | 11 |
| [waitAgentTuiReadyByKind](../../src/core.ts#L4472) | 4472 | 0 |
| [detectAgentSubmitResidue](../../src/core.ts#L4485) | 4485 | 4 |
| [retryCursorSubmitIfResidueImpl](../../src/core.ts#L4489) | 4489 | 2 |
| [retryCursorSubmitIfResidue](../../src/core.ts#L4500) | 4500 | 3 |
| [waitCursorPromptVisible](../../src/core.ts#L4514) | 4514 | 1 |
| [initialPromptUnconfirmedNote](../../src/core.ts#L4526) | 4526 | 2 |
| [launchStartUnconfirmed](../../src/core.ts#L4535) | 4535 | 1 |
| [agentSubmitResidueWarning](../../src/core.ts#L4542) | 4542 | 2 |
| [assertAgentSubmitDelivered](../../src/core.ts#L4552) | 4552 | 2 |
| [__testAssertAgentSubmitDelivered](../../src/core.ts#L4561) | 4561 | 0 |
| [__testSettleAgentDoneScreen](../../src/core.ts#L4570) | 4570 | 0 |
| [__testIsAgentTuiReady](../../src/core.ts#L4587) | 4587 | 0 |
| [__testWaitAgentTuiReady](../../src/core.ts#L4591) | 4591 | 0 |
| [__testIsAgentTuiIdleReady](../../src/core.ts#L4619) | 4619 | 0 |
| [__testDetectAgentSubmitResidue](../../src/core.ts#L4623) | 4623 | 0 |
| [__testWaitCursorPromptVisible](../../src/core.ts#L4643) | 4643 | 0 |
| [__testRetryCursorSubmitIfResidue](../../src/core.ts#L4662) | 4662 | 0 |
| [submitAgentComposerText](../../src/core.ts#L4692) | 4692 | 3 |
| [admit](../../src/core.ts#L4707) | 4707 | 2 |
| [sendAgentPromptText](../../src/core.ts#L4742) | 4742 | 10 |
| [startupBlockedHint](../../src/core.ts#L4762) | 4762 | 2 |
| [setInitialDelivery](../../src/core.ts#L4770) | 4770 | 5 |
| [waitStartupSelection](../../src/core.ts#L4780) | 4780 | 2 |
| [prepareAgentInput](../../src/core.ts#L4790) | 4790 | 4 |
| [running](../../src/core.ts#L4794) | 4794 | 0 |
| [wait](../../src/core.ts#L4796) | 4796 | 2 |
| [sendInitialAgentPrompt](../../src/core.ts#L4843) | 4843 | 1 |
| [sendInitialAgentPromptInLock](../../src/core.ts#L4855) | 4855 | 2 |
| [isAgentSession](../../src/core.ts#L4954) | 4954 | 4 |
| [waitForScreenText](../../src/core.ts#L4995) | 4995 | 1 |
| [waitForGrokConfigurationResult](../../src/core.ts#L5006) | 5006 | 1 |
| [sendMenuChoice](../../src/core.ts#L5037) | 5037 | 19 |
| [recoverCodexRateLimitModelSwitch](../../src/core.ts#L5045) | 5045 | 2 |
| [waitAgentTuiReadyAfterCodexRateLimitRecovery](../../src/core.ts#L5061) | 5061 | 2 |
| [authMetadataPath](../../src/core.ts#L5079) | 5079 | 9 |
| [authPlan](../../src/core.ts#L5084) | 5084 | 1 |
| [authStatus](../../src/core.ts#L5094) | 5094 | 4 |
| [authPane](../../src/core.ts#L5104) | 5104 | 4 |
| [loadAuthMetadata](../../src/core.ts#L5114) | 5114 | 8 |
| [readExecutionAuthMetadata](../../src/core.ts#L5138) | 5138 | 3 |
| [authSessionExists](../../src/core.ts#L5149) | 5149 | 4 |
| [authSessionEnvironment](../../src/core.ts#L5153) | 5153 | 2 |
| [disableAuthLogging](../../src/core.ts#L5166) | 5166 | 2 |
| [readAuthBinding](../../src/core.ts#L5171) | 5171 | 2 |
| [respondAgentAuth](../../src/core.ts#L5187) | 5187 | 1 |
| [check](../../src/core.ts#L5196) | 5196 | 5 |
| [checkReadbackGeneration](../../src/core.ts#L5262) | 5262 | 2 |
| [launchAuthProcess](../../src/core.ts#L5284) | 5284 | 2 |
| [authenticateAgent](../../src/core.ts#L5296) | 5296 | 2 |
| [result](../../src/core.ts#L5301) | 5301 | 28 |
| [pendingExitRefusal](../../src/core.ts#L5374) | 5374 | 3 |
| [listAgentModels](../../src/core.ts#L5432) | 5432 | 1 |
| [inspectAgentIdleSettings](../../src/core.ts#L5450) | 5450 | 2 |
| [__testInspectAgentIdleSettings](../../src/core.ts#L5463) | 5463 | 0 |
| [grokCatalogForFast](../../src/core.ts#L5514) | 5514 | 2 |
| [modelIsFastVariant](../../src/core.ts#L5522) | 5522 | 5 |
| [assertClaudeFastSupported](../../src/core.ts#L5531) | 5531 | 4 |
| [assertCodexFastSupported](../../src/core.ts#L5542) | 5542 | 4 |
| [planLaunchFast](../../src/core.ts#L5552) | 5552 | 1 |
| [launchKeepingUserDefaults](../../src/core.ts#L5603) | 5603 | 2 |
| [parseJsonObject](../../src/core.ts#L5637) | 5637 | 3 |
| [cursorDefaultsWritten](../../src/core.ts#L5648) | 5648 | 0 |
| [grokDefaultsWritten](../../src/core.ts#L5655) | 5655 | 0 |
| [grokUserConfigPath](../../src/core.ts#L5663) | 5663 | 2 |
| [restoreGrokDefaults](../../src/core.ts#L5664) | 5664 | 2 |
| [restoreCursorDefaults](../../src/core.ts#L5666) | 5666 | 2 |
| [recordAgentFast](../../src/core.ts#L5671) | 5671 | 9 |
| [switchAgentFast](../../src/core.ts#L5679) | 5679 | 1 |
| [switchClaudeFast](../../src/core.ts#L5692) | 5692 | 2 |
| [toggleCodexFast](../../src/core.ts#L5735) | 5735 | 2 |
| [switchCodexFast](../../src/core.ts#L5757) | 5757 | 2 |
| [keepingCodexDefaults](../../src/core.ts#L5786) | 5786 | 2 |
| [fixInFile](../../src/core.ts#L5792) | 5792 | 2 |
| [redrawCursorComposer](../../src/core.ts#L5823) | 5823 | 4 |
| [waitCursorPickerView](../../src/core.ts#L5832) | 5832 | 10 |
| [moveCursorParameterTo](../../src/core.ts#L5849) | 5849 | 2 |
| [keepingCursorDefaults](../../src/core.ts#L5865) | 5865 | 2 |
| [switchCursorFast](../../src/core.ts#L5870) | 5870 | 2 |
| [toggleCursorFast](../../src/core.ts#L5876) | 5876 | 1 |
| [closeWithoutChange](../../src/core.ts#L5882) | 5882 | 5 |
| [sendGrokModelCommand](../../src/core.ts#L5937) | 5937 | 2 |
| [switchGrokFast](../../src/core.ts#L5949) | 5949 | 2 |
| [applyLaunchFast](../../src/core.ts#L5984) | 5984 | 2 |
| [agentGoal](../../src/core.ts#L6000) | 6000 | 4 |
| [resolve](../../src/core.ts#L6004) | 6004 | 3 |
| [goalUi](../../src/core.ts#L6020) | 6020 | 7 |
| [check](../../src/core.ts#L6023) | 6023 | 7 |
| [rejectOwner](../../src/core.ts#L6030) | 6030 | 6 |
| [checkRow](../../src/core.ts#L6067) | 6067 | 1 |
| [read](../../src/core.ts#L6073) | 6073 | 0 |
| [paste](../../src/core.ts#L6074) | 6074 | 0 |
| [keys](../../src/core.ts#L6076) | 6076 | 0 |
| [click](../../src/core.ts#L6086) | 6086 | 0 |
| [grokPort](../../src/core.ts#L6101) | 6101 | 3 |
| [read](../../src/core.ts#L6103) | 6103 | 2 |
| [run](../../src/core.ts#L6134) | 6134 | 1 |
| [pauseAgentGoalForStop](../../src/core.ts#L6154) | 6154 | 0 |
| [agentConfigureNotReady](../../src/core.ts#L6170) | 6170 | 2 |
| [configureAgent](../../src/core.ts#L6174) | 6174 | 1 |
| [beforeChange](../../src/core.ts#L6179) | 6179 | 1 |
| [checkGeneration](../../src/core.ts#L6197) | 6197 | 4 |
| [configure](../../src/core.ts#L6202) | 6202 | 1 |
| [configureAgentInLock](../../src/core.ts#L6255) | 6255 | 1 |
| [configured](../../src/core.ts#L6277) | 6277 | 5 |
| [rememberModel](../../src/core.ts#L6286) | 6286 | 4 |
| [dropFastIfUnsupported](../../src/core.ts#L6342) | 6342 | 2 |
| [__testCodexConfigureChoices](../../src/core.ts#L6472) | 6472 | 0 |
| [attachImages](../../src/core.ts#L6495) | 6495 | 2 |
| [userHookBlockedMessage](../../src/core.ts#L6517) | 6517 | 2 |
| [assertCursorPromptNotHookBlocked](../../src/core.ts#L6530) | 6530 | 1 |
| [verifyAgentResumeNative](../../src/core.ts#L6555) | 6555 | 5 |
| [unavailable](../../src/core.ts#L6556) | 6556 | 1 |
| [verifyCreatedNative](../../src/core.ts#L6561) | 6561 | 2 |
| [unavailable](../../src/core.ts#L6562) | 6562 | 2 |
| [withAgentResumeTarget](../../src/core.ts#L6575) | 6575 | 7 |
| [confirmedAgentResumeRecipe](../../src/core.ts#L6587) | 6587 | 4 |
| [unavailable](../../src/core.ts#L6588) | 6588 | 3 |
| [resumeAgentInLock](../../src/core.ts#L6602) | 6602 | 3 |
| [uncertain](../../src/core.ts#L6604) | 6604 | 15 |
| [dispatchAgentTurn](../../src/core.ts#L6710) | 6710 | 1 |
| [dispatchAgentTurnInLock](../../src/core.ts#L6727) | 6727 | 2 |
| [grokSteerQueued](../../src/core.ts#L6885) | 6885 | 1 |
| [cursorSteerQueued](../../src/core.ts#L6889) | 6889 | 4 |
| [waitSteerScreen](../../src/core.ts#L6898) | 6898 | 2 |
| [__testSteerQueued](../../src/core.ts#L6908) | 6908 | 0 |
| [codexTurnRunningBehindIdleScreen](../../src/core.ts#L6924) | 6924 | 1 |
| [clearClaudeSelectMenuBeforeInput](../../src/core.ts#L6949) | 6949 | 1 |
| [sendAgentMessage](../../src/core.ts#L6980) | 6980 | 1 |
| [sendAgentMessageInLock](../../src/core.ts#L6996) | 6996 | 1 |
| [assertAgentSendHarness](../../src/core.ts#L7019) | 7019 | 7 |
| [agentSendTurnRunning](../../src/core.ts#L7033) | 7033 | 2 |
| [recordSteerPosition](../../src/core.ts#L7065) | 7065 | 1 |
| [steerRunningTurn](../../src/core.ts#L7076) | 7076 | 2 |
| [stillRunning](../../src/core.ts#L7107) | 7107 | 0 |
| [steerUnknownFailure](../../src/core.ts#L7171) | 7171 | 3 |
| [runClaudeOperation](../../src/core.ts#L7179) | 7179 | 1 |
| [inspectClaudeOperation](../../src/core.ts#L7221) | 7221 | 1 |
| [composePortableForkPrompt](../../src/core.ts#L7265) | 7265 | 1 |
| [portableForkPrompt](../../src/core.ts#L7269) | 7269 | 1 |
| [harnessLauncherDiagnostic](../../src/core.ts#L7305) | 7305 | 5 |
| [buildAgentCmd](../../src/core.ts#L7314) | 7314 | 1 |
| [agentVendorSessionEnv](../../src/core.ts#L7334) | 7334 | 1 |
| [agentEnvEntries](../../src/core.ts#L7342) | 7342 | 3 |
| [agentEnvPrefix](../../src/core.ts#L7365) | 7365 | 1 |
| [buildAgentLaunchNote](../../src/core.ts#L7373) | 7373 | 2 |
| [claudeLaunchRequestDigest](../../src/core.ts#L7386) | 7386 | 2 |
| [requireMatchingClaudeLaunch](../../src/core.ts#L7411) | 7411 | 3 |
| [existingAgentLaunchResult](../../src/core.ts#L7425) | 7425 | 2 |
| [openAgent](../../src/core.ts#L7438) | 7438 | 0 |
| [prepareAgentLaunch](../../src/core.ts#L7465) | 7465 | 2 |
| [create](../../src/core.ts#L7605) | 7605 | 1 |
| [openAgentWithInitialPrompt](../../src/core.ts#L7776) | 7776 | 1 |
| [launch](../../src/core.ts#L7887) | 7887 | 2 |
| [admitted](../../src/core.ts#L7888) | 7888 | 1 |
| [switchAfterReady](../../src/core.ts#L7911) | 7911 | 2 |
| [agentModelUi](../../src/core.ts#L7985) | 7985 | 2 |

## src/cursor-parent-hook.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/cursor-parent-hook.ts](../../src/cursor-parent-hook.ts)。SHA256 `c4d14b41e080d494e171dc4db528a64cdbb86352df7f71123a59698ec99aab00`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/cursor-parent-receive.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/cursor-parent-receive.ts](../../src/cursor-parent-receive.ts)。SHA256 `ceabea64169ea702d9367e8976497cc05f295531daa6e8e561f75c6ef77fdcf6`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [cursorReceiveProcess](../../src/cursor-parent-receive.ts#L9) | 9 | 1 |
| [waitProcessCommandLine](../../src/cursor-parent-receive.ts#L14) | 14 | 1 |
| [main](../../src/cursor-parent-receive.ts#L20) | 20 | 0 |

## src/cursor-parent-receiver.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/cursor-parent-receiver.ts](../../src/cursor-parent-receiver.ts)。SHA256 `9194777908143d2749b1c9a4409004904474487ad48b07b00595759966119670`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [cursorHookRoot](../../src/cursor-parent-receiver.ts#L17) | 17 | 3 |
| [cursorHookRoots](../../src/cursor-parent-receiver.ts#L21) | 21 | 1 |
| [cursorParentHooksRegistered](../../src/cursor-parent-receiver.ts#L24) | 24 | 0 |
| [verifyCursorParent](../../src/cursor-parent-receiver.ts#L25) | 25 | 1 |
| [cursorParentFromRequest](../../src/cursor-parent-receiver.ts#L26) | 26 | 2 |
| [handleCursorHook](../../src/cursor-parent-receiver.ts#L33) | 33 | 0 |

## src/delivery-provider.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/delivery-provider.ts](../../src/delivery-provider.ts)。SHA256 `fe06faea3bf117f8f2d0ddaa5931a8ad6446cc2f89d33a8b184b33776440bd81`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [deliveryProviderFile](../../src/delivery-provider.ts#L15) | 15 | 1 |
| [writeDeliveryProvider](../../src/delivery-provider.ts#L23) | 23 | 0 |

## src/delivery-wake-cli.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/delivery-wake-cli.ts](../../src/delivery-wake-cli.ts)。SHA256 `77c92e70385801a92f3efdb4dfa0265027adfce07cc942e841433dc106e72d15`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [processExists](../../src/delivery-wake-cli.ts#L29) | 29 | 0 |
| [linuxStartedAt](../../src/delivery-wake-cli.ts#L36) | 36 | 0 |
| [ownerGone](../../src/delivery-wake-cli.ts#L47) | 47 | 1 |
| [shouldWakeForDeliveries](../../src/delivery-wake-cli.ts#L63) | 63 | 1 |
| [main](../../src/delivery-wake-cli.ts#L107) | 107 | 0 |
| [invokedDirectly](../../src/delivery-wake-cli.ts#L115) | 115 | 0 |

## src/errors.ts

責務: 公開例外。詳細: [release-verification.md](release-verification.md)。source: [src/errors.ts](../../src/errors.ts)。SHA256 `3e1cbce0f68492aad0815087c15d4f46e704407f0ff6382c9b33e1bd94834982`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [telemetryOwnedFailure](../../src/errors.ts#L55) | 55 | 2 |
| [ownTelemetryFailure](../../src/errors.ts#L62) | 62 | 8 |
| [ptyDependencyError](../../src/errors.ts#L66) | 66 | 7 |

## src/execution-checkpoint.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-checkpoint.ts](../../src/execution-checkpoint.ts)。SHA256 `4aee426282a7673af15ba04d429ad98126d3bc50a6be382ffb5d17dee14c3afa`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [syncExecutionDirectories](../../src/execution-checkpoint.ts#L11) | 11 | 5 |
| [writeExecutionCheckpoint](../../src/execution-checkpoint.ts#L39) | 39 | 6 |

## src/execution-close.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-close.ts](../../src/execution-close.ts)。SHA256 `6439a3dcb967fb8719c751df33d2d47fb976213ebd4eedce7f6fbbe4f5f6a2dd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseExecutionNativeSessions](../../src/execution-close.ts#L19) | 19 | 2 |
| [closeExpectedExecution](../../src/execution-close.ts#L31) | 31 | 1 |
| [snapshot](../../src/execution-close.ts#L33) | 33 | 3 |
| [current](../../src/execution-close.ts#L37) | 37 | 2 |

## src/execution-context.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-context.ts](../../src/execution-context.ts)。SHA256 `86c901ab0352c6b4586f6344898b847cf121e4b5a32dc54fe3838f8470f286d9`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [withExecutionRequest](../../src/execution-context.ts#L17) | 17 | 2 |
| [currentExecutionRequest](../../src/execution-context.ts#L22) | 22 | 1 |
| [currentExecutionIngress](../../src/execution-context.ts#L26) | 26 | 4 |

## src/execution-contract.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-contract.ts](../../src/execution-contract.ts)。SHA256 `113dae59f75973e46d1445bb16df7852b121afdc29fc8f83b9f89590bac7679b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [confirmed](../../src/execution-contract.ts#L69) | 69 | 0 |
| [executionRequestStartsWork](../../src/execution-contract.ts#L88) | 88 | 2 |
| [equal](../../src/execution-contract.ts#L112) | 112 | 7 |
| [assessExecutionSource](../../src/execution-contract.ts#L114) | 114 | 1 |
| [result](../../src/execution-contract.ts#L117) | 117 | 3 |
| [requestTarget](../../src/execution-contract.ts#L128) | 128 | 2 |
| [relationActivity](../../src/execution-contract.ts#L188) | 188 | 2 |
| [unfinishedExecutionRelations](../../src/execution-contract.ts#L225) | 225 | 3 |
| [planCascadeStop](../../src/execution-contract.ts#L230) | 230 | 12 |
| [gap](../../src/execution-contract.ts#L237) | 237 | 7 |

## src/execution-dispatch.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-dispatch.ts](../../src/execution-dispatch.ts)。SHA256 `58812a6b8fe5b457db1af28033b3fee896c2cbe9ad2489b4de114d35bddc4529`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-dispatch.ts#L26) | 26 | 4 |
| [routeFor](../../src/execution-dispatch.ts#L28) | 28 | 1 |
| [requestCancellation](../../src/execution-dispatch.ts#L56) | 56 | 2 |
| [persist](../../src/execution-dispatch.ts#L63) | 63 | 2 |
| [abort](../../src/execution-dispatch.ts#L66) | 66 | 0 |
| [assert](../../src/execution-dispatch.ts#L70) | 70 | 4 |
| [finish](../../src/execution-dispatch.ts#L71) | 71 | 1 |
| [createExecutionDispatcher](../../src/execution-dispatch.ts#L99) | 99 | 1 |
| [authGeneration](../../src/execution-dispatch.ts#L106) | 106 | 1 |
| [observe](../../src/execution-dispatch.ts#L122) | 122 | 2 |
| [prepareControlRegistration](../../src/execution-dispatch.ts#L136) | 136 | 0 |
| [dispatch](../../src/execution-dispatch.ts#L149) | 149 | 0 |
| [run](../../src/execution-dispatch.ts#L151) | 151 | 1 |

## src/execution-effect.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-effect.ts](../../src/execution-effect.ts)。SHA256 `1cef3ee9548da5dc1bc8f7ed4db654c9ea8d1a0746a2ecad78ed229e31dadf13`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [requireExecutionEffectScope](../../src/execution-effect.ts#L27) | 27 | 2 |
| [assertExecutionContext](../../src/execution-effect.ts#L31) | 31 | 30 |
| [withExecutionPreparation](../../src/execution-effect.ts#L44) | 44 | 19 |
| [captureExecutionSendBoundary](../../src/execution-effect.ts#L57) | 57 | 2 |
| [readExecutionSendBoundary](../../src/execution-effect.ts#L68) | 68 | 2 |
| [prepareInScope](../../src/execution-effect.ts#L77) | 77 | 2 |
| [synchronous](../../src/execution-effect.ts#L78) | 78 | 2 |
| [withExecutionEffectScope](../../src/execution-effect.ts#L102) | 102 | 4 |
| [withExecutionNativeAdmission](../../src/execution-effect.ts#L115) | 115 | 16 |
| [withExecutionInterruptEffectScope](../../src/execution-effect.ts#L137) | 137 | 2 |
| [runEffectScope](../../src/execution-effect.ts#L161) | 161 | 2 |
| [refuse](../../src/execution-effect.ts#L172) | 172 | 36 |
| [issueEffect](../../src/execution-effect.ts#L176) | 176 | 3 |
| [hasExecutionCreationScope](../../src/execution-effect.ts#L186) | 186 | 7 |
| [assertExecutionResumeSupported](../../src/execution-effect.ts#L188) | 188 | 3 |
| [prepareExecutionCreation](../../src/execution-effect.ts#L193) | 193 | 1 |
| [executionCreatedNativeBinding](../../src/execution-effect.ts#L215) | 215 | 2 |
| [captureExecutionCreatedNative](../../src/execution-effect.ts#L224) | 224 | 3 |
| [bindExecutionCreatedLaunch](../../src/execution-effect.ts#L247) | 247 | 2 |
| [bindExecutionNativeTarget](../../src/execution-effect.ts#L263) | 263 | 4 |
| [bindExecutionManagementCloseTarget](../../src/execution-effect.ts#L275) | 275 | 2 |
| [executionManagementCloseTarget](../../src/execution-effect.ts#L281) | 281 | 1 |
| [beforeExecutionEffect](../../src/execution-effect.ts#L285) | 285 | 10 |
| [guardTmuxExecution](../../src/execution-effect.ts#L307) | 307 | 1 |

## src/execution-immediate-stop.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-immediate-stop.ts](../../src/execution-immediate-stop.ts)。SHA256 `6aff63c47e9d12783254b3e5a5b2f6a416de101b6e77b09cb9feaa422ecb732d`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [stopPlan](../../src/execution-immediate-stop.ts#L24) | 24 | 2 |
| [visit](../../src/execution-immediate-stop.ts#L34) | 34 | 3 |
| [sendStopTarget](../../src/execution-immediate-stop.ts#L55) | 55 | 3 |
| [finishStop](../../src/execution-immediate-stop.ts#L70) | 70 | 3 |
| [interruptKnownSessions](../../src/execution-immediate-stop.ts#L78) | 78 | 2 |
| [interruptKnownSessionsAndGoals](../../src/execution-immediate-stop.ts#L85) | 85 | 1 |

## src/execution-interruption.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-interruption.ts](../../src/execution-interruption.ts)。SHA256 `e1c36b1951c88360d268a59e2188d6f55f7a0b48a72ecea2e42cdfa99a1808c7`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [interruptionKeyReference](../../src/execution-interruption.ts#L74) | 74 | 4 |
| [interruptionIdentity](../../src/execution-interruption.ts#L96) | 96 | 6 |
| [sameInterruptionRun](../../src/execution-interruption.ts#L99) | 99 | 3 |
| [sameInterruptionRowRun](../../src/execution-interruption.ts#L104) | 104 | 1 |
| [activeTargets](../../src/execution-interruption.ts#L110) | 110 | 2 |
| [interruptionBlocksLaunch](../../src/execution-interruption.ts#L114) | 114 | 3 |
| [interruptionBlocksRequest](../../src/execution-interruption.ts#L117) | 117 | 8 |
| [assertInterruptionSource](../../src/execution-interruption.ts#L121) | 121 | 2 |
| [interruptionBlocksParent](../../src/execution-interruption.ts#L133) | 133 | 2 |
| [interruptionSlots](../../src/execution-interruption.ts#L138) | 138 | 3 |

## src/execution-inventory.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-inventory.ts](../../src/execution-inventory.ts)。SHA256 `dd046938177e1840c0252c197f85335817624fec8fbb49ef3f2bcdc994e311ff`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [key](../../src/execution-inventory.ts#L25) | 25 | 4 |
| [executionParticipantInventory](../../src/execution-inventory.ts#L31) | 31 | 2 |
| [get](../../src/execution-inventory.ts#L34) | 34 | 2 |
| [add](../../src/execution-inventory.ts#L43) | 43 | 4 |
| [mcp](../../src/execution-inventory.ts#L48) | 48 | 4 |

## src/execution-invocation.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-invocation.ts](../../src/execution-invocation.ts)。SHA256 `636054194bf836fd89eb913c9794307f31bf1ade861e387aea5f41645d0f2cdc`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [invokeExecutionAction](../../src/execution-invocation.ts#L9) | 9 | 1 |
| [run](../../src/execution-invocation.ts#L12) | 12 | 2 |

## src/execution-launch-recovery.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-launch-recovery.ts](../../src/execution-launch-recovery.ts)。SHA256 `29dd320ea890fd52502b76e25266f5ce007b466fc96eff7141eed9bce3932e68`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/execution-lock.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-lock.ts](../../src/execution-lock.ts)。SHA256 `8bf495e81f66616f057a16ed24503d4818a20a65527079ebd8ef159794306fa9`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [sameIdentity](../../src/execution-lock.ts#L19) | 19 | 4 |
| [sameActor](../../src/execution-lock.ts#L20) | 20 | 2 |
| [fail](../../src/execution-lock.ts#L21) | 21 | 12 |
| [readLock](../../src/execution-lock.ts#L23) | 23 | 3 |
| [sameLock](../../src/execution-lock.ts#L37) | 37 | 4 |
| [createLock](../../src/execution-lock.ts#L46) | 46 | 1 |
| [acquireExecutionLock](../../src/execution-lock.ts#L54) | 54 | 3 |
| [releaseExecutionLock](../../src/execution-lock.ts#L61) | 61 | 3 |
| [recoverExecutionLock](../../src/execution-lock.ts#L76) | 76 | 1 |
| [absent](../../src/execution-lock.ts#L85) | 85 | 2 |

## src/execution-native-server.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-native-server.ts](../../src/execution-native-server.ts)。SHA256 `35e82dfe5c5edaeb9bc673296b2e064ad0f20c6a41323d1d8237c07ff0fa2edb`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [createNativeDeliveryServer](../../src/execution-native-server.ts#L25) | 25 | 1 |
| [createNativeExecutionServer](../../src/execution-native-server.ts#L58) | 58 | 0 |
| [nativeProcessExists](../../src/execution-native-server.ts#L117) | 117 | 0 |
| [nativeProcessRunning](../../src/execution-native-server.ts#L121) | 121 | 0 |
| [nativeParentDependencies](../../src/execution-native-server.ts#L124) | 124 | 1 |
| [createNativeExecutionWorker](../../src/execution-native-server.ts#L133) | 133 | 0 |
| [parseNativeExecutionArguments](../../src/execution-native-server.ts#L144) | 144 | 2 |
| [main](../../src/execution-native-server.ts#L160) | 160 | 0 |

## src/execution-native-setup.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-native-setup.ts](../../src/execution-native-setup.ts)。SHA256 `553a28874e598f8c2e5851c0bbb2a85a5accdf6606e1d98d7aa3510646293344`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [configureNativeExecutionHooks](../../src/execution-native-setup.ts#L15) | 15 | 0 |
| [hook](../../src/execution-native-setup.ts#L40) | 40 | 2 |
| [quote](../../src/execution-native-setup.ts#L41) | 41 | 0 |
| [command](../../src/execution-native-setup.ts#L42) | 42 | 2 |

## src/execution-parent-alias.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-alias.ts](../../src/execution-parent-alias.ts)。SHA256 `40c3f88b130c9f61c6e8d1e90e4409f95f024871ceb6bd3ad601db9b1ab31a9e`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent-alias.ts#L25) | 25 | 6 |
| [parentHookReference](../../src/execution-parent-alias.ts#L31) | 31 | 1 |
| [readAcceptedParentHookReference](../../src/execution-parent-alias.ts#L55) | 55 | 0 |

## src/execution-parent-claude-records.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-claude-records.ts](../../src/execution-parent-claude-records.ts)。SHA256 `bfb93eb356189de949628865aa3cd3c4ccca35855b48aac41cb5ac7e1d1402ff`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent-claude-records.ts#L14) | 14 | 3 |
| [createClaudeParentRecordDiagnosis](../../src/execution-parent-claude-records.ts#L29) | 29 | 1 |
| [stable](../../src/execution-parent-claude-records.ts#L41) | 41 | 4 |
| [read](../../src/execution-parent-claude-records.ts#L43) | 43 | 5 |

## src/execution-parent-endpoint.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-endpoint.ts](../../src/execution-parent-endpoint.ts)。SHA256 `dd02fa0029666ff9d8dbb8ab5f56712fc5683816d19bc9ecdb43c763c399bc81`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent-endpoint.ts#L19) | 19 | 3 |
| [root](../../src/execution-parent-endpoint.ts#L20) | 20 | 6 |
| [read](../../src/execution-parent-endpoint.ts#L25) | 25 | 3 |
| [createNativeParentEndpointEvidence](../../src/execution-parent-endpoint.ts#L29) | 29 | 2 |

## src/execution-parent-manager.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-manager.ts](../../src/execution-parent-manager.ts)。SHA256 `5691a89edad92f988640dad5b47f4c3090764e0862f15bec0e927991569cb18f`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [createParentManagerExecution](../../src/execution-parent-manager.ts#L39) | 39 | 1 |
| [parentFromIngress](../../src/execution-parent-manager.ts#L58) | 58 | 0 |
| [outcomeUnknown](../../src/execution-parent-manager.ts#L69) | 69 | 0 |
| [prepareCompanion](../../src/execution-parent-manager.ts#L80) | 80 | 0 |
| [submit](../../src/execution-parent-manager.ts#L98) | 98 | 0 |

## src/execution-parent-native.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-native.ts](../../src/execution-parent-native.ts)。SHA256 `8460262ebf868cf5723cafa777ed49f3e61dae92bd3bc6144d9e11964ae16997`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent-native.ts#L18) | 18 | 13 |
| [requestFor](../../src/execution-parent-native.ts#L19) | 19 | 3 |
| [endpointDigest](../../src/execution-parent-native.ts#L21) | 21 | 1 |
| [canonical](../../src/execution-parent-native.ts#L22) | 22 | 2 |
| [createParentNativeAdmission](../../src/execution-parent-native.ts#L42) | 42 | 2 |
| [read](../../src/execution-parent-native.ts#L44) | 44 | 6 |
| [verify](../../src/execution-parent-native.ts#L58) | 58 | 5 |
| [run](../../src/execution-parent-native.ts#L70) | 70 | 1 |
| [issue](../../src/execution-parent-native.ts#L105) | 105 | 0 |

## src/execution-parent-process.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-process.ts](../../src/execution-parent-process.ts)。SHA256 `11cbe09fed75af011f746e6573839eefb758cbeb4d7de447135c84a3c1f20075`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [readExecutionParentProcess](../../src/execution-parent-process.ts#L5) | 5 | 1 |
| [identity](../../src/execution-parent-process.ts#L25) | 25 | 2 |

## src/execution-parent-producer.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-producer.ts](../../src/execution-parent-producer.ts)。SHA256 `01ae6642a9070ad51b0b607540283d9d0f12dae8e4fa54b327198ed50f2bab34`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [createExecutionParentProducer](../../src/execution-parent-producer.ts#L61) | 61 | 1 |
| [observe](../../src/execution-parent-producer.ts#L91) | 91 | 0 |

## src/execution-parent-queue.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-queue.ts](../../src/execution-parent-queue.ts)。SHA256 `785d890dfc46e3bfb1761aec4dbe7dc87b93f4738bd27a7de88ca2c266fa5161`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent-queue.ts#L16) | 16 | 4 |
| [read](../../src/execution-parent-queue.ts#L17) | 17 | 3 |
| [createParentQueueEndpointEvidence](../../src/execution-parent-queue.ts#L21) | 21 | 1 |
| [verifyIngress](../../src/execution-parent-queue.ts#L30) | 30 | 3 |
| [verify](../../src/execution-parent-queue.ts#L51) | 51 | 0 |

## src/execution-parent-source.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-source.ts](../../src/execution-parent-source.ts)。SHA256 `91044c6bd5e1a9d0f8a81573bbae89e801b55950030ef8edc9e60bdf05d388ea`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [requireParentEndpointEvidence](../../src/execution-parent-source.ts#L26) | 26 | 2 |
| [same](../../src/execution-parent-source.ts#L38) | 38 | 12 |
| [processIdentity](../../src/execution-parent-source.ts#L39) | 39 | 2 |
| [canonical](../../src/execution-parent-source.ts#L40) | 40 | 3 |
| [equalEndpoint](../../src/execution-parent-source.ts#L43) | 43 | 2 |
| [createParentSourceEvidence](../../src/execution-parent-source.ts#L56) | 56 | 2 |
| [observe](../../src/execution-parent-source.ts#L58) | 58 | 4 |
| [nativeEndpoint](../../src/execution-parent-source.ts#L72) | 72 | 3 |
| [compatible](../../src/execution-parent-source.ts#L78) | 78 | 4 |
| [lineage](../../src/execution-parent-source.ts#L83) | 83 | 4 |
| [fresh](../../src/execution-parent-source.ts#L101) | 101 | 2 |
| [captureIngress](../../src/execution-parent-source.ts#L123) | 123 | 1 |
| [endpointFromIngress](../../src/execution-parent-source.ts#L132) | 132 | 1 |
| [capture](../../src/execution-parent-source.ts#L145) | 145 | 4 |
| [verify](../../src/execution-parent-source.ts#L164) | 164 | 4 |
| [verifyActor](../../src/execution-parent-source.ts#L178) | 178 | 4 |

## src/execution-parent-worker.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent-worker.ts](../../src/execution-parent-worker.ts)。SHA256 `6419e3601a35df1f0db8ad3195421fd15423ffe0508d70286b7bbeee96758daf`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [currentLocalActor](../../src/execution-parent-worker.ts#L33) | 33 | 0 |
| [same](../../src/execution-parent-worker.ts#L52) | 52 | 1 |
| [scope](../../src/execution-parent-worker.ts#L53) | 53 | 2 |
| [createExecutionParentEnvironment](../../src/execution-parent-worker.ts#L62) | 62 | 2 |
| [assertContract](../../src/execution-parent-worker.ts#L71) | 71 | 2 |
| [assertScope](../../src/execution-parent-worker.ts#L89) | 89 | 26 |
| [createExecutionParentWorker](../../src/execution-parent-worker.ts#L102) | 102 | 1 |

## src/execution-parent.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-parent.ts](../../src/execution-parent.ts)。SHA256 `b60d85da9a7e276308c7ed59514d119b358c03c24ea9d56167ca307a983349f0`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-parent.ts#L20) | 20 | 34 |
| [stopped](../../src/execution-parent.ts#L22) | 22 | 2 |
| [createExecutionParentAdapter](../../src/execution-parent.ts#L42) | 42 | 1 |
| [digest](../../src/execution-parent.ts#L44) | 44 | 4 |
| [canonical](../../src/execution-parent.ts#L45) | 45 | 2 |
| [verifyEndpoint](../../src/execution-parent.ts#L55) | 55 | 4 |
| [observe](../../src/execution-parent.ts#L61) | 61 | 6 |
| [read](../../src/execution-parent.ts#L69) | 69 | 4 |
| [original](../../src/execution-parent.ts#L74) | 74 | 4 |
| [waitForReceipt](../../src/execution-parent.ts#L98) | 98 | 2 |
| [captureEndpointEvidence](../../src/execution-parent.ts#L113) | 113 | 1 |
| [diagnoseClaim](../../src/execution-parent.ts#L116) | 116 | 1 |
| [actorKey](../../src/execution-parent.ts#L141) | 141 | 6 |
| [addRequestActor](../../src/execution-parent.ts#L142) | 142 | 2 |
| [verifyRecovery](../../src/execution-parent.ts#L211) | 211 | 1 |
| [recordChildCompletion](../../src/execution-parent.ts#L234) | 234 | 1 |
| [bind](../../src/execution-parent.ts#L248) | 248 | 1 |
| [submit](../../src/execution-parent.ts#L277) | 277 | 1 |
| [lookup](../../src/execution-parent.ts#L316) | 316 | 0 |

## src/execution-participant-store.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-participant-store.ts](../../src/execution-participant-store.ts)。SHA256 `ffb0d13d4a35ce33bf02cec3d62778f941f69a3832393735db80c1ea20d814ea`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [enroll](../../src/execution-participant-store.ts#L16) | 16 | 4 |
| [ensureEnrolled](../../src/execution-participant-store.ts#L29) | 29 | 2 |
| [check](../../src/execution-participant-store.ts#L34) | 34 | 4 |
| [transactionSync](../../src/execution-participant-store.ts#L38) | 38 | 0 |
| [transaction](../../src/execution-participant-store.ts#L51) | 51 | 0 |
| [recoverAbandonedLock](../../src/execution-participant-store.ts#L66) | 66 | 0 |
| [interruptionActor](../../src/execution-participant-store.ts#L70) | 70 | 1 |
| [interruptionCheckpoint](../../src/execution-participant-store.ts#L75) | 75 | 0 |
| [inventory](../../src/execution-participant-store.ts#L82) | 82 | 2 |

## src/execution-participant.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-participant.ts](../../src/execution-participant.ts)。SHA256 `3960118465f425f27252fa25a5503a3461847603c094a1c50b027245480eef6a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [snapshotRuntime](../../src/execution-participant.ts#L16) | 16 | 1 |
| [createExecutionParticipant](../../src/execution-participant.ts#L27) | 27 | 2 |

## src/execution-runtime.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-runtime.ts](../../src/execution-runtime.ts)。SHA256 `cc6d4c9f2a7464a94184d8772e4c395fa749f869445227a09fb53a4e1051a36d`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [executionSourceFromEnvironment](../../src/execution-runtime.ts#L25) | 25 | 2 |
| [same](../../src/execution-runtime.ts#L72) | 72 | 4 |
| [createExecutionRuntime](../../src/execution-runtime.ts#L74) | 74 | 1 |
| [parseObservation](../../src/execution-runtime.ts#L80) | 80 | 2 |
| [observe](../../src/execution-runtime.ts#L88) | 88 | 0 |
| [sourceEvidence](../../src/execution-runtime.ts#L121) | 121 | 0 |
| [completion](../../src/execution-runtime.ts#L134) | 134 | 0 |
| [close](../../src/execution-runtime.ts#L170) | 170 | 0 |
| [coverage](../../src/execution-runtime.ts#L174) | 174 | 0 |

## src/execution-service.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-service.ts](../../src/execution-service.ts)。SHA256 `2f391aca956f0e8e6d54d24755964b25b7454fb0845bd2c0fe4ac43aa0c21f18`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/execution-service.ts#L49) | 49 | 69 |
| [key](../../src/execution-service.ts#L50) | 50 | 26 |
| [stopped](../../src/execution-service.ts#L51) | 51 | 21 |
| [openParentEffect](../../src/execution-service.ts#L53) | 53 | 7 |
| [pendingParentReturn](../../src/execution-service.ts#L60) | 60 | 2 |
| [find](../../src/execution-service.ts#L73) | 73 | 23 |
| [managementClose](../../src/execution-service.ts#L78) | 78 | 2 |
| [recoverableCloseSlots](../../src/execution-service.ts#L83) | 83 | 6 |
| [targetBlocked](../../src/execution-service.ts#L102) | 102 | 4 |
| [assertCloseLaunchExpectation](../../src/execution-service.ts#L106) | 106 | 6 |
| [view](../../src/execution-service.ts#L116) | 116 | 12 |
| [blocksSource](../../src/execution-service.ts#L126) | 126 | 2 |
| [sourceAdmission](../../src/execution-service.ts#L138) | 138 | 4 |
| [interruptionRelatedRecords](../../src/execution-service.ts#L148) | 148 | 3 |
| [cancelUnissuedInterruptionActions](../../src/execution-service.ts#L158) | 158 | 3 |
| [retireSettledBranches](../../src/execution-service.ts#L171) | 171 | 7 |
| [interruptObservation](../../src/execution-service.ts#L198) | 198 | 5 |
| [assertManagedInterruptionPoint](../../src/execution-service.ts#L212) | 212 | 2 |
| [beginInterruption](../../src/execution-service.ts#L223) | 223 | 1 |
| [interruptRun](../../src/execution-service.ts#L248) | 248 | 1 |
| [checkCheckpoint](../../src/execution-service.ts#L253) | 253 | 2 |
| [readCaller](../../src/execution-service.ts#L260) | 260 | 3 |
| [reconcilePreparingInterruption](../../src/execution-service.ts#L334) | 334 | 0 |
| [check](../../src/execution-service.ts#L344) | 344 | 2 |
| [settleInterruption](../../src/execution-service.ts#L373) | 373 | 0 |
| [settleInterruptionState](../../src/execution-service.ts#L377) | 377 | 2 |
| [assertInterruptionProof](../../src/execution-service.ts#L391) | 391 | 2 |
| [cancelRequestActions](../../src/execution-service.ts#L404) | 404 | 2 |
| [prepareCreation](../../src/execution-service.ts#L417) | 417 | 1 |
| [managementCloseNative](../../src/execution-service.ts#L432) | 432 | 2 |
| [proveExitedLaunchClose](../../src/execution-service.ts#L447) | 447 | 4 |
| [verifyCreationServer](../../src/execution-service.ts#L458) | 458 | 1 |
| [captureCreatedNative](../../src/execution-service.ts#L466) | 466 | 1 |
| [bindCreatedLaunch](../../src/execution-service.ts#L489) | 489 | 1 |
| [withExpectedCloseEffect](../../src/execution-service.ts#L512) | 512 | 1 |
| [execute](../../src/execution-service.ts#L535) | 535 | 6 |
| [closeLaunch](../../src/execution-service.ts#L547) | 547 | 1 |
| [admitNative](../../src/execution-service.ts#L585) | 585 | 2 |
| [roots](../../src/execution-service.ts#L594) | 594 | 1 |
| [register](../../src/execution-service.ts#L647) | 647 | 2 |
| [previous](../../src/execution-service.ts#L648) | 648 | 1 |
| [expectTarget](../../src/execution-service.ts#L693) | 693 | 6 |
| [invoke](../../src/execution-service.ts#L706) | 706 | 1 |
| [invokeDeferred](../../src/execution-service.ts#L715) | 715 | 2 |
| [invokeInternal](../../src/execution-service.ts#L721) | 721 | 2 |
| [checkCloseNative](../../src/execution-service.ts#L779) | 779 | 2 |
| [checkOrIssue](../../src/execution-service.ts#L785) | 785 | 2 |
| [prepared](../../src/execution-service.ts#L787) | 787 | 4 |
| [issue](../../src/execution-service.ts#L866) | 866 | 0 |
| [prepare](../../src/execution-service.ts#L867) | 867 | 0 |
| [unissued](../../src/execution-service.ts#L868) | 868 | 2 |
| [reconcileLaunch](../../src/execution-service.ts#L979) | 979 | 1 |
| [finish](../../src/execution-service.ts#L1024) | 1024 | 1 |
| [finishCompletion](../../src/execution-service.ts#L1060) | 1060 | 1 |
| [eligible](../../src/execution-service.ts#L1061) | 1061 | 2 |
| [settled](../../src/execution-service.ts#L1071) | 1071 | 2 |
| [changeSession](../../src/execution-service.ts#L1098) | 1098 | 0 |
| [interruptCascade](../../src/execution-service.ts#L1144) | 1144 | 1 |
| [gap](../../src/execution-service.ts#L1154) | 1154 | 12 |
| [pendingNative](../../src/execution-service.ts#L1157) | 1157 | 3 |
| [describe](../../src/execution-service.ts#L1161) | 1161 | 1 |
| [snapshot](../../src/execution-service.ts#L1167) | 1167 | 1 |
| [stop](../../src/execution-service.ts#L1325) | 1325 | 2 |
| [closeCascade](../../src/execution-service.ts#L1346) | 1346 | 0 |
| [closeExpected](../../src/execution-service.ts#L1402) | 1402 | 1 |
| [result](../../src/execution-service.ts#L1403) | 1403 | 5 |
| [interruptRelations](../../src/execution-service.ts#L1441) | 1441 | 4 |

## src/execution-steer.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-steer.ts](../../src/execution-steer.ts)。SHA256 `020ac5ed196e0d711294f7112efdda7d4c2995c96399e89e4cf90c2a0c33ff72`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [createSteerExecutionAdmission](../../src/execution-steer.ts#L11) | 11 | 3 |
| [run](../../src/execution-steer.ts#L15) | 15 | 0 |

## src/execution-store.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-store.ts](../../src/execution-store.ts)。SHA256 `5e4be43a9619c0e6b280129848fec4ab06373428a4a1b7800cba642d4b07c08f`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [emptyExecutionState](../../src/execution-store.ts#L79) | 79 | 2 |
| [executionStoreDirectory](../../src/execution-store.ts#L87) | 87 | 2 |
| [snapshot](../../src/execution-store.ts#L101) | 101 | 1 |
| [recoverAbandonedLock](../../src/execution-store.ts#L105) | 105 | 1 |
| [initialized](../../src/execution-store.ts#L109) | 109 | 2 |
| [write](../../src/execution-store.ts#L126) | 126 | 2 |
| [read](../../src/execution-store.ts#L134) | 134 | 3 |
| [transactionSync](../../src/execution-store.ts#L153) | 153 | 3 |
| [admitNative](../../src/execution-store.ts#L171) | 171 | 1 |
| [nativeBody](../../src/execution-store.ts#L191) | 191 | 2 |
| [transaction](../../src/execution-store.ts#L199) | 199 | 1 |

## src/execution-tools.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-tools.ts](../../src/execution-tools.ts)。SHA256 `38d2ef653b86b13171b7d045cb7fe5aac41ee98d806659b230f4dac68f4bc178`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [executionBindingMeta](../../src/execution-tools.ts#L26) | 26 | 3 |
| [attachExecutionControlRegistrar](../../src/execution-tools.ts#L52) | 52 | 1 |
| [createExecutionToolHandlers](../../src/execution-tools.ts#L57) | 57 | 1 |
| [agent_execution](../../src/execution-tools.ts#L66) | 66 | 0 |
| [agent_stop](../../src/execution-tools.ts#L89) | 89 | 0 |
| [agent_execution_roots](../../src/execution-tools.ts#L97) | 97 | 0 |
| [registerExecutionTools](../../src/execution-tools.ts#L106) | 106 | 1 |
| [runBoundExecution](../../src/execution-tools.ts#L140) | 140 | 0 |
| [runDeferredBoundExecution](../../src/execution-tools.ts#L148) | 148 | 2 |
| [runExecutionReceipt](../../src/execution-tools.ts#L154) | 154 | 2 |

## src/execution-wire.ts

責務: private execution。詳細: [private-execution.md](private-execution.md)。source: [src/execution-wire.ts](../../src/execution-wire.ts)。SHA256 `6c6e0d1b023f8ad69052176356e0e8ae918f1afddcb9d27dd44f49b78ca02d74`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [executionHostSourceFromMeta](../../src/execution-wire.ts#L21) | 21 | 3 |
| [receipt](../../src/execution-wire.ts#L134) | 134 | 1 |
| [executionErrorResult](../../src/execution-wire.ts#L140) | 140 | 8 |
| [executionRefFromMeta](../../src/execution-wire.ts#L149) | 149 | 2 |

## src/fast-mode.ts

責務: モデル・解決・利用者設定。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/fast-mode.ts](../../src/fast-mode.ts)。SHA256 `bfbf738ef707c02a15ee75d3fba8490445c0b29478124931a59e647f01ca877e`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [launchContinuesWithoutFast](../../src/fast-mode.ts#L38) | 38 | 0 |
| [fastModeFailure](../../src/fast-mode.ts#L42) | 42 | 1 |

## src/grok-stop-hook.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/grok-stop-hook.ts](../../src/grok-stop-hook.ts)。SHA256 `15a980d2f59b0daf6844903a9ce040cc62c311c4a1d5b9dff18f0e8b14d8c092`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [fail](../../src/grok-stop-hook.ts#L11) | 11 | 7 |
| [noop](../../src/grok-stop-hook.ts#L16) | 16 | 1 |
| [hasAitermEnv](../../src/grok-stop-hook.ts#L20) | 20 | 1 |
| [agentsDir](../../src/grok-stop-hook.ts#L30) | 30 | 1 |
| [str](../../src/grok-stop-hook.ts#L38) | 38 | 4 |
| [readStdin](../../src/grok-stop-hook.ts#L42) | 42 | 1 |
| [appendEvent](../../src/grok-stop-hook.ts#L54) | 54 | 1 |
| [main](../../src/grok-stop-hook.ts#L71) | 71 | 0 |

## src/harnesses/antigravity.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/antigravity.ts](../../src/harnesses/antigravity.ts)。SHA256 `92ec8e50e112eab1f75c38fd7988fd2e8d87f83a90232d3701ea57c5c8bf50e7`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [antigravityCatalog](../../src/harnesses/antigravity.ts#L17) | 17 | 1 |
| [rows](../../src/harnesses/antigravity.ts#L18) | 18 | 2 |
| [realAntigravityHome](../../src/harnesses/antigravity.ts#L37) | 37 | 1 |
| [antigravityModelChoices](../../src/harnesses/antigravity.ts#L41) | 41 | 3 |
| [run](../../src/harnesses/antigravity.ts#L42) | 42 | 3 |
| [antigravityAuthStatus](../../src/harnesses/antigravity.ts#L52) | 52 | 2 |
| [antigravityAuthPane](../../src/harnesses/antigravity.ts#L59) | 59 | 2 |
| [antigravityAuthChoiceKey](../../src/harnesses/antigravity.ts#L106) | 106 | 1 |
| [antigravityPaneObservation](../../src/harnesses/antigravity.ts#L117) | 117 | 4 |
| [antigravityStartupAction](../../src/harnesses/antigravity.ts#L126) | 126 | 1 |
| [normalize](../../src/harnesses/antigravity.ts#L130) | 130 | 2 |
| [antigravityCurrentModel](../../src/harnesses/antigravity.ts#L137) | 137 | 2 |
| [antigravityHookFile](../../src/harnesses/antigravity.ts#L145) | 145 | 2 |
| [mergeAntigravityHooks](../../src/harnesses/antigravity.ts#L149) | 149 | 2 |
| [command](../../src/harnesses/antigravity.ts#L156) | 156 | 2 |
| [createAntigravityAgentMetadata](../../src/harnesses/antigravity.ts#L168) | 168 | 1 |
| [antigravityAgentArgv](../../src/harnesses/antigravity.ts#L179) | 179 | 2 |
| [antigravityBindingFile](../../src/harnesses/antigravity.ts#L183) | 183 | 2 |
| [antigravityBinding](../../src/harnesses/antigravity.ts#L188) | 188 | 3 |
| [bindAntigravitySession](../../src/harnesses/antigravity.ts#L197) | 197 | 1 |
| [antigravityResultPath](../../src/harnesses/antigravity.ts#L204) | 204 | 2 |
| [antigravityTranscriptText](../../src/harnesses/antigravity.ts#L209) | 209 | 1 |
| [antigravityTurn](../../src/harnesses/antigravity.ts#L217) | 217 | 1 |

## src/harnesses/claude-configure.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [model-configuration.md](model-configuration.md)。source: [src/harnesses/claude-configure.ts](../../src/harnesses/claude-configure.ts)。SHA256 `45c4ee29b357f56c0b264a98ca19f2910dbf5b1d79fc5afc86b5456d3c0c7684`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [configureClaudeForSessionOnly](../../src/harnesses/claude-configure.ts#L14) | 14 | 1 |
| [screen](../../src/harnesses/claude-configure.ts#L23) | 23 | 5 |
| [until](../../src/harnesses/claude-configure.ts#L24) | 24 | 3 |
| [refuse](../../src/harnesses/claude-configure.ts#L34) | 34 | 11 |
| [picker](../../src/harnesses/claude-configure.ts#L44) | 44 | 2 |
| [cursorOf](../../src/harnesses/claude-configure.ts#L45) | 45 | 7 |
| [press](../../src/harnesses/claude-configure.ts#L48) | 48 | 3 |

## src/harnesses/claude-goal.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/harnesses/claude-goal.ts](../../src/harnesses/claude-goal.ts)。SHA256 `0fdee62e152b24faf1d3e4a4d74fc38743909aad05ef9545ae0d642fa4c75cda`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [claudeCurrentSessionOwner](../../src/harnesses/claude-goal.ts#L5) | 5 | 1 |
| [observeClaudeGoalStatus](../../src/harnesses/claude-goal.ts#L34) | 34 | 1 |
| [readFreshClaudeGoal](../../src/harnesses/claude-goal.ts#L70) | 70 | 0 |
| [plain](../../src/harnesses/claude-goal.ts#L96) | 96 | 2 |
| [claudeGoalComposer](../../src/harnesses/claude-goal.ts#L97) | 97 | 3 |
| [claudeGoalComposerEmpty](../../src/harnesses/claude-goal.ts#L115) | 115 | 3 |
| [observeClaudeGoalDialog](../../src/harnesses/claude-goal.ts#L118) | 118 | 2 |
| [submitClaudeGoalCommand](../../src/harnesses/claude-goal.ts#L151) | 151 | 3 |
| [validateClaudeGoalObjective](../../src/harnesses/claude-goal.ts#L165) | 165 | 1 |
| [boundedWidth](../../src/harnesses/claude-goal.ts#L173) | 173 | 1 |
| [setClaudeGoalObjective](../../src/harnesses/claude-goal.ts#L177) | 177 | 1 |
| [clearClaudeGoal](../../src/harnesses/claude-goal.ts#L184) | 184 | 1 |
| [readClaudeGoalDialog](../../src/harnesses/claude-goal.ts#L193) | 193 | 1 |

## src/harnesses/claude.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/claude.ts](../../src/harnesses/claude.ts)。SHA256 `cfd55ad2cf27eed1cb74782bc3236256841778fa424a6d6f42091c95c68fe0d7`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [agentManagedClaudeSettingsPath](../../src/harnesses/claude.ts#L38) | 38 | 2 |
| [agentClaudeResultPath](../../src/harnesses/claude.ts#L44) | 44 | 2 |
| [agentClaudeOperationPath](../../src/harnesses/claude.ts#L50) | 50 | 5 |
| [agentClaudeApprovalReceiptPath](../../src/harnesses/claude.ts#L56) | 56 | 1 |
| [agentClaudeDispatchReceiptPath](../../src/harnesses/claude.ts#L62) | 62 | 3 |
| [claudeHookScriptPath](../../src/harnesses/claude.ts#L69) | 69 | 1 |
| [hookNodeExecutable](../../src/harnesses/claude.ts#L77) | 77 | 1 |
| [nodeHookCommand](../../src/harnesses/claude.ts#L84) | 84 | 1 |
| [createClaudeCorrelationSettings](../../src/harnesses/claude.ts#L88) | 88 | 1 |
| [validateOperationId](../../src/harnesses/claude.ts#L122) | 122 | 10 |
| [readClaudeResultText](../../src/harnesses/claude.ts#L129) | 129 | 2 |
| [claudeModelChoices](../../src/harnesses/claude.ts#L193) | 193 | 4 |
| [claudeFastStatePending](../../src/harnesses/claude.ts#L234) | 234 | 1 |
| [claudeFastUnavailable](../../src/harnesses/claude.ts#L255) | 255 | 1 |
| [claudeCatalogFromInitialize](../../src/harnesses/claude.ts#L265) | 265 | 1 |
| [assertClaudeAuthenticationReady](../../src/harnesses/claude.ts#L306) | 306 | 1 |
| [claudeAgentArgv](../../src/harnesses/claude.ts#L359) | 359 | 3 |
| [claudeResumeArgv](../../src/harnesses/claude.ts#L387) | 387 | 1 |
| [buildClaudeAgentCmd](../../src/harnesses/claude.ts#L395) | 395 | 1 |
| [claudeLaunchNote](../../src/harnesses/claude.ts#L405) | 405 | 1 |
| [claudeComposerBox](../../src/harnesses/claude.ts#L416) | 416 | 1 |
| [claudeSecurityNotes](../../src/harnesses/claude.ts#L424) | 424 | 2 |
| [claudeTuiReady](../../src/harnesses/claude.ts#L431) | 431 | 3 |
| [claudeTurnProgress](../../src/harnesses/claude.ts#L453) | 453 | 1 |
| [claudeTuiBusy](../../src/harnesses/claude.ts#L467) | 467 | 2 |
| [claudeInterruptHint](../../src/harnesses/claude.ts#L481) | 481 | 1 |
| [claudePaneObservation](../../src/harnesses/claude.ts#L493) | 493 | 4 |
| [claudeUsageLimit](../../src/harnesses/claude.ts#L512) | 512 | 1 |
| [claudeLiveSelectMenu](../../src/harnesses/claude.ts#L544) | 544 | 3 |
| [lastLineIndex](../../src/harnesses/claude.ts#L579) | 579 | 3 |
| [claudeModelPicker](../../src/harnesses/claude.ts#L584) | 584 | 5 |
| [claudeModelPickerRow](../../src/harnesses/claude.ts#L616) | 616 | 2 |
| [claudeModelSwitchConfirm](../../src/harnesses/claude.ts#L632) | 632 | 2 |
| [claudeModelSwitchResult](../../src/harnesses/claude.ts#L647) | 647 | 1 |
| [claudeLoginMethodMenu](../../src/harnesses/claude.ts#L667) | 667 | 3 |
| [claudeStartupAction](../../src/harnesses/claude.ts#L674) | 674 | 3 |
| [createClaudeAgentMetadata](../../src/harnesses/claude.ts#L701) | 701 | 2 |
| [claudeConfigDir](../../src/harnesses/claude.ts#L748) | 748 | 7 |
| [claudeProjectSlug](../../src/harnesses/claude.ts#L753) | 753 | 1 |
| [claudeSessionTranscriptPath](../../src/harnesses/claude.ts#L757) | 757 | 8 |
| [claudeApiErrorFromLine](../../src/harnesses/claude.ts#L772) | 772 | 3 |
| [claudeApiErrorAfter](../../src/harnesses/claude.ts#L795) | 795 | 1 |
| [claudeAuthPlan](../../src/harnesses/claude.ts#L815) | 815 | 1 |
| [claudeAuthStatus](../../src/harnesses/claude.ts#L817) | 817 | 1 |
| [claudeAuthorizationUrl](../../src/harnesses/claude.ts#L830) | 830 | 1 |
| [claudeAuthInput](../../src/harnesses/claude.ts#L849) | 849 | 1 |
| [claudeAuthPane](../../src/harnesses/claude.ts#L888) | 888 | 1 |
| [claudeFastResult](../../src/harnesses/claude.ts#L906) | 906 | 1 |
| [count](../../src/harnesses/claude.ts#L907) | 907 | 2 |
| [claudeFastIndicatorShown](../../src/harnesses/claude.ts#L928) | 928 | 1 |

## src/harnesses/codex-configure.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [model-configuration.md](model-configuration.md)。source: [src/harnesses/codex-configure.ts](../../src/harnesses/codex-configure.ts)。SHA256 `a56de52acd818a3c0ab7602b683dbb15f3f5071899afdb678da127a434873da8`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [configureCodexModel](../../src/harnesses/codex-configure.ts#L9) | 9 | 1 |
| [chooseCodexModel](../../src/harnesses/codex-configure.ts#L24) | 24 | 1 |

## src/harnesses/codex-goal-editor.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/harnesses/codex-goal-editor.ts](../../src/harnesses/codex-goal-editor.ts)。SHA256 `28e69fda639558d302fb0b0bb8b212fd48ee452faac968059855b70884be1ab9`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [plain](../../src/harnesses/codex-goal-editor.ts#L7) | 7 | 6 |
| [codexGoalUiState](../../src/harnesses/codex-goal-editor.ts#L8) | 8 | 7 |
| [wait](../../src/harnesses/codex-goal-editor.ts#L36) | 36 | 5 |
| [submitCodexGoalCommand](../../src/harnesses/codex-goal-editor.ts#L42) | 42 | 2 |
| [editableCodexGoal](../../src/harnesses/codex-goal-editor.ts#L50) | 50 | 2 |
| [createCodexGoalObjective](../../src/harnesses/codex-goal-editor.ts#L54) | 54 | 1 |
| [editCodexGoalObjective](../../src/harnesses/codex-goal-editor.ts#L86) | 86 | 1 |

## src/harnesses/codex-goal.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/harnesses/codex-goal.ts](../../src/harnesses/codex-goal.ts)。SHA256 `6ae94f70cf0ce490be3886aa177dbbbbd34300e1322caeaad6983d2626b5cf2b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [withCodexGoal](../../src/harnesses/codex-goal.ts#L11) | 11 | 1 |
| [withOrdinaryCodexGoal](../../src/harnesses/codex-goal.ts#L37) | 37 | 1 |

## src/harnesses/codex.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/codex.ts](../../src/harnesses/codex.ts)。SHA256 `8483846a0a64fc61cc26b74d217b911301becf3861c07d2d7c61b3f2769b36f7`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [realCodexHome](../../src/harnesses/codex.ts#L40) | 40 | 6 |
| [readCodexConfigPins](../../src/harnesses/codex.ts#L48) | 48 | 4 |
| [pick](../../src/harnesses/codex.ts#L58) | 58 | 3 |
| [codexConfigSummary](../../src/harnesses/codex.ts#L71) | 71 | 1 |
| [valueOf](../../src/harnesses/codex.ts#L82) | 82 | 2 |
| [findLatestCodexTranscript](../../src/harnesses/codex.ts#L98) | 98 | 1 |
| [visit](../../src/harnesses/codex.ts#L102) | 102 | 2 |
| [listCodexTranscripts](../../src/harnesses/codex.ts#L131) | 131 | 3 |
| [visit](../../src/harnesses/codex.ts#L134) | 134 | 2 |
| [codexLaunchVerdict](../../src/harnesses/codex.ts#L160) | 160 | 7 |
| [codexTranscriptMatchesLaunch](../../src/harnesses/codex.ts#L207) | 207 | 0 |
| [codexTranscriptSessionId](../../src/harnesses/codex.ts#L211) | 211 | 5 |
| [codexRolloutCreation](../../src/harnesses/codex.ts#L230) | 230 | 2 |
| [codexLaunchVerdictMemoFor](../../src/harnesses/codex.ts#L239) | 239 | 1 |
| [codexLaunchOthersFor](../../src/harnesses/codex.ts#L254) | 254 | 1 |
| [codexBoundTranscript](../../src/harnesses/codex.ts#L265) | 265 | 5 |
| [codexSwitchedTranscript](../../src/harnesses/codex.ts#L286) | 286 | 1 |
| [codexRootTranscript](../../src/harnesses/codex.ts#L318) | 318 | 12 |
| [codexRolloutSessionId](../../src/harnesses/codex.ts#L344) | 344 | 4 |
| [bindCodexTranscriptSession](../../src/harnesses/codex.ts#L353) | 353 | 3 |
| [codexCompletionEvent](../../src/harnesses/codex.ts#L364) | 364 | 4 |
| [codexTurnError](../../src/harnesses/codex.ts#L395) | 395 | 4 |
| [codexTurnErrorLine](../../src/harnesses/codex.ts#L411) | 411 | 3 |
| [codexUsageLimit](../../src/harnesses/codex.ts#L421) | 421 | 2 |
| [codexTurnBoundaryLine](../../src/harnesses/codex.ts#L434) | 434 | 3 |
| [codexLatestTurnBoundary](../../src/harnesses/codex.ts#L451) | 451 | 3 |
| [codexInterruptionRecord](../../src/harnesses/codex.ts#L481) | 481 | 5 |
| [listStrict](../../src/harnesses/codex.ts#L491) | 491 | 2 |
| [visit](../../src/harnesses/codex.ts#L493) | 493 | 2 |
| [header](../../src/harnesses/codex.ts#L506) | 506 | 1 |
| [codexTurnSettled](../../src/harnesses/codex.ts#L577) | 577 | 2 |
| [codexCompletedTurnId](../../src/harnesses/codex.ts#L585) | 585 | 1 |
| [codexRunningTurn](../../src/harnesses/codex.ts#L597) | 597 | 5 |
| [latestCodexCompletion](../../src/harnesses/codex.ts#L602) | 602 | 3 |
| [observeCodexDone](../../src/harnesses/codex.ts#L626) | 626 | 1 |
| [anchored](../../src/harnesses/codex.ts#L634) | 634 | 2 |
| [observation](../../src/harnesses/codex.ts#L647) | 647 | 5 |
| [codexAgentArgv](../../src/harnesses/codex.ts#L769) | 769 | 3 |
| [codexResumeArgv](../../src/harnesses/codex.ts#L795) | 795 | 1 |
| [buildCodexAgentCmd](../../src/harnesses/codex.ts#L802) | 802 | 1 |
| [codexLaunchNote](../../src/harnesses/codex.ts#L821) | 821 | 1 |
| [describePin](../../src/harnesses/codex.ts#L832) | 832 | 2 |
| [codexTuiReady](../../src/harnesses/codex.ts#L856) | 856 | 2 |
| [currentCodexDialog](../../src/harnesses/codex.ts#L873) | 873 | 4 |
| [codexHelperProcess](../../src/harnesses/codex.ts#L884) | 884 | 1 |
| [codexTuiBusy](../../src/harnesses/codex.ts#L895) | 895 | 2 |
| [codexPaneObservation](../../src/harnesses/codex.ts#L899) | 899 | 9 |
| [codexRateLimitModelSwitchDialog](../../src/harnesses/codex.ts#L929) | 929 | 3 |
| [codexStartupFailure](../../src/harnesses/codex.ts#L947) | 947 | 2 |
| [codexApprovalDialog](../../src/harnesses/codex.ts#L960) | 960 | 1 |
| [codexStartupAction](../../src/harnesses/codex.ts#L991) | 991 | 1 |
| [codexLaunchBlockingDialog](../../src/harnesses/codex.ts#L1022) | 1022 | 1 |
| [codexModelChoice](../../src/harnesses/codex.ts#L1034) | 1034 | 3 |
| [codexEffortChoice](../../src/harnesses/codex.ts#L1046) | 1046 | 4 |
| [codexCurrentEffort](../../src/harnesses/codex.ts#L1064) | 1064 | 1 |
| [codexModelChangeNotices](../../src/harnesses/codex.ts#L1070) | 1070 | 1 |
| [codexMoreReasoningChoice](../../src/harnesses/codex.ts#L1077) | 1077 | 3 |
| [codexTranscriptText](../../src/harnesses/codex.ts#L1089) | 1089 | 1 |
| [codexTurnAnswer](../../src/harnesses/codex.ts#L1148) | 1148 | 2 |
| [add](../../src/harnesses/codex.ts#L1152) | 1152 | 2 |
| [text](../../src/harnesses/codex.ts#L1163) | 1163 | 2 |
| [createCodexAgentMetadata](../../src/harnesses/codex.ts#L1170) | 1170 | 2 |
| [codexModelChoices](../../src/harnesses/codex.ts#L1212) | 1212 | 4 |
| [codexModelHasFastTier](../../src/harnesses/codex.ts#L1236) | 1236 | 1 |
| [codexCatalogFromPages](../../src/harnesses/codex.ts#L1242) | 1242 | 1 |
| [codexAuthPlan](../../src/harnesses/codex.ts#L1275) | 1275 | 1 |
| [codexAuthStatus](../../src/harnesses/codex.ts#L1285) | 1285 | 1 |
| [codexAuthPane](../../src/harnesses/codex.ts#L1310) | 1310 | 1 |
| [codexServiceTierNotices](../../src/harnesses/codex.ts#L1319) | 1319 | 2 |
| [codexFooterShowsFast](../../src/harnesses/codex.ts#L1331) | 1331 | 1 |
| [codexFastCommandOffered](../../src/harnesses/codex.ts#L1337) | 1337 | 1 |
| [restoreCodexDefaults](../../src/harnesses/codex.ts#L1349) | 1349 | 1 |
| [restoreCodexDefaultInFile](../../src/harnesses/codex.ts#L1361) | 1361 | 1 |
| [codexResumeProofPath](../../src/harnesses/codex.ts#L1399) | 1399 | 3 |
| [resumeProofUnavailable](../../src/harnesses/codex.ts#L1400) | 1400 | 14 |
| [codexResumedProof](../../src/harnesses/codex.ts#L1402) | 1402 | 5 |
| [codexResumeCursor](../../src/harnesses/codex.ts#L1422) | 1422 | 7 |
| [codexResumeTurnId](../../src/harnesses/codex.ts#L1426) | 1426 | 4 |
| [codexResumeProofDigest](../../src/harnesses/codex.ts#L1430) | 1430 | 5 |
| [readCodexResumeProof](../../src/harnesses/codex.ts#L1433) | 1433 | 5 |
| [captureCodexResumeProof](../../src/harnesses/codex.ts#L1448) | 1448 | 1 |

## src/harnesses/cursor.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/cursor.ts](../../src/harnesses/cursor.ts)。SHA256 `4b05012006b4a154b0c90084d2e746b21e1cc495567fad0e78d6232a63a5ade1`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [realCursorHome](../../src/harnesses/cursor.ts#L46) | 46 | 3 |
| [cursorWorkspaceId](../../src/harnesses/cursor.ts#L51) | 51 | 1 |
| [cursorTranscriptRoot](../../src/harnesses/cursor.ts#L55) | 55 | 2 |
| [cursorTranscriptForSession](../../src/harnesses/cursor.ts#L60) | 60 | 1 |
| [listCursorTranscripts](../../src/harnesses/cursor.ts#L66) | 66 | 1 |
| [cursorTranscriptMatchesLaunch](../../src/harnesses/cursor.ts#L84) | 84 | 1 |
| [cursorTranscript](../../src/harnesses/cursor.ts#L111) | 111 | 9 |
| [cursorTranscriptSessionId](../../src/harnesses/cursor.ts#L124) | 124 | 3 |
| [bindCursorTranscriptSession](../../src/harnesses/cursor.ts#L129) | 129 | 2 |
| [cursorTurnError](../../src/harnesses/cursor.ts#L148) | 148 | 2 |
| [cursorCompletionEvent](../../src/harnesses/cursor.ts#L162) | 162 | 2 |
| [cursorTranscriptState](../../src/harnesses/cursor.ts#L190) | 190 | 4 |
| [cursorTurnBoundary](../../src/harnesses/cursor.ts#L223) | 223 | 1 |
| [latestCursorCompletion](../../src/harnesses/cursor.ts#L228) | 228 | 6 |
| [observeCursorDone](../../src/harnesses/cursor.ts#L243) | 243 | 1 |
| [observation](../../src/harnesses/cursor.ts#L257) | 257 | 8 |
| [cursorTranscriptText](../../src/harnesses/cursor.ts#L314) | 314 | 1 |
| [createCursorAgentMetadata](../../src/harnesses/cursor.ts#L355) | 355 | 1 |
| [validateCursorModelEffort](../../src/harnesses/cursor.ts#L385) | 385 | 3 |
| [cursorModelArgument](../../src/harnesses/cursor.ts#L393) | 393 | 3 |
| [cursorModelIsFastVariant](../../src/harnesses/cursor.ts#L400) | 400 | 1 |
| [cursorModelCatalog](../../src/harnesses/cursor.ts#L408) | 408 | 1 |
| [cursorModelLines](../../src/harnesses/cursor.ts#L412) | 412 | 2 |
| [cursorBaseModel](../../src/harnesses/cursor.ts#L456) | 456 | 2 |
| [cursorModelChoices](../../src/harnesses/cursor.ts#L473) | 473 | 2 |
| [cursorCatalogFromLines](../../src/harnesses/cursor.ts#L478) | 478 | 1 |
| [assertCursorModelAvailable](../../src/harnesses/cursor.ts#L514) | 514 | 3 |
| [cursorEffortNavigation](../../src/harnesses/cursor.ts#L531) | 531 | 1 |
| [assertCursorAuthenticationReady](../../src/harnesses/cursor.ts#L546) | 546 | 1 |
| [cursorAgentArgv](../../src/harnesses/cursor.ts#L569) | 569 | 2 |
| [buildCursorAgentCmd](../../src/harnesses/cursor.ts#L589) | 589 | 1 |
| [cursorPromptWithLineage](../../src/harnesses/cursor.ts#L611) | 611 | 2 |
| [cursorLaunchNote](../../src/harnesses/cursor.ts#L615) | 615 | 1 |
| [cursorTuiBusy](../../src/harnesses/cursor.ts#L630) | 630 | 6 |
| [cursorTuiReady](../../src/harnesses/cursor.ts#L634) | 634 | 2 |
| [cursorProviderFailure](../../src/harnesses/cursor.ts#L643) | 643 | 2 |
| [cursorUsageLimit](../../src/harnesses/cursor.ts#L665) | 665 | 3 |
| [cursorHookBlocked](../../src/harnesses/cursor.ts#L686) | 686 | 2 |
| [cursorPromptHooksRunning](../../src/harnesses/cursor.ts#L707) | 707 | 2 |
| [cursorPaneObservation](../../src/harnesses/cursor.ts#L712) | 712 | 2 |
| [cursorAuthPlan](../../src/harnesses/cursor.ts#L725) | 725 | 1 |
| [cursorAuthStatus](../../src/harnesses/cursor.ts#L727) | 727 | 1 |
| [cursorAuthPane](../../src/harnesses/cursor.ts#L742) | 742 | 1 |
| [cursorPickerView](../../src/harnesses/cursor.ts#L751) | 751 | 3 |
| [cursorParameterLines](../../src/harnesses/cursor.ts#L759) | 759 | 4 |
| [cursorParameterRows](../../src/harnesses/cursor.ts#L767) | 767 | 2 |
| [cursorEffortSelected](../../src/harnesses/cursor.ts#L775) | 775 | 1 |
| [cursorFastParameter](../../src/harnesses/cursor.ts#L783) | 783 | 2 |
| [cursorHeaderShowsFast](../../src/harnesses/cursor.ts#L794) | 794 | 3 |
| [cursorUserConfigPath](../../src/harnesses/cursor.ts#L811) | 811 | 2 |

## src/harnesses/grok-goal.ts

責務: goal。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/harnesses/grok-goal.ts](../../src/harnesses/grok-goal.ts)。SHA256 `f2f7d22f95bac4d7014c3b2630017099df04e2755e80a663f0640ab3d05883f4`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [grokCurrentSessionOwner](../../src/harnesses/grok-goal.ts#L11) | 11 | 1 |
| [grokGoalFromFreshStatus](../../src/harnesses/grok-goal.ts#L42) | 42 | 1 |
| [composer](../../src/harnesses/grok-goal.ts#L52) | 52 | 5 |
| [plainScreen](../../src/harnesses/grok-goal.ts#L81) | 81 | 3 |
| [fullHeader](../../src/harnesses/grok-goal.ts#L82) | 82 | 4 |
| [emptyFullComposer](../../src/harnesses/grok-goal.ts#L89) | 89 | 3 |
| [detailFrame](../../src/harnesses/grok-goal.ts#L97) | 97 | 6 |
| [grokGoalFromDetail](../../src/harnesses/grok-goal.ts#L113) | 113 | 1 |
| [field](../../src/harnesses/grok-goal.ts#L117) | 117 | 2 |
| [readGrokGoalDetail](../../src/harnesses/grok-goal.ts#L124) | 124 | 1 |
| [localGoalCommand](../../src/harnesses/grok-goal.ts#L155) | 155 | 2 |
| [readFreshGrokGoal](../../src/harnesses/grok-goal.ts#L192) | 192 | 1 |
| [grokGoalClearReady](../../src/harnesses/grok-goal.ts#L202) | 202 | 1 |
| [clearGrokGoal](../../src/harnesses/grok-goal.ts#L203) | 203 | 1 |
| [guard](../../src/harnesses/grok-goal.ts#L208) | 208 | 0 |

## src/harnesses/grok.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/grok.ts](../../src/harnesses/grok.ts)。SHA256 `a6a3124996921838536fcadbe97b6dffa4c532216511a52479308498831ff132`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [realGrokHome](../../src/harnesses/grok.ts#L46) | 46 | 4 |
| [resolveAndValidateGrokAuth](../../src/harnesses/grok.ts#L50) | 50 | 2 |
| [grokModelCatalog](../../src/harnesses/grok.ts#L60) | 60 | 1 |
| [grokModelChoices](../../src/harnesses/grok.ts#L93) | 93 | 5 |
| [grokCatalogFromInitialize](../../src/harnesses/grok.ts#L111) | 111 | 1 |
| [baseOf](../../src/harnesses/grok.ts#L145) | 145 | 1 |
| [grokFastVariants](../../src/harnesses/grok.ts#L158) | 158 | 1 |
| [grokFastBase](../../src/harnesses/grok.ts#L170) | 170 | 0 |
| [assertGrokModelAvailable](../../src/harnesses/grok.ts#L174) | 174 | 2 |
| [grokSessionDirectory](../../src/harnesses/grok.ts#L186) | 186 | 6 |
| [grokEventsTranscript](../../src/harnesses/grok.ts#L193) | 193 | 6 |
| [grokCompletionEvent](../../src/harnesses/grok.ts#L198) | 198 | 4 |
| [latestGrokCompletion](../../src/harnesses/grok.ts#L225) | 225 | 2 |
| [grokTurnSettled](../../src/harnesses/grok.ts#L250) | 250 | 2 |
| [grokInitializationComplete](../../src/harnesses/grok.ts#L265) | 265 | 0 |
| [observeGrokDone](../../src/harnesses/grok.ts#L286) | 286 | 1 |
| [observation](../../src/harnesses/grok.ts#L308) | 308 | 8 |
| [grokAgentArgv](../../src/harnesses/grok.ts#L407) | 407 | 2 |
| [buildGrokAgentCmd](../../src/harnesses/grok.ts#L435) | 435 | 1 |
| [grokLaunchNote](../../src/harnesses/grok.ts#L445) | 445 | 1 |
| [grokEnvTokens](../../src/harnesses/grok.ts#L460) | 460 | 1 |
| [grokEnvEntries](../../src/harnesses/grok.ts#L464) | 464 | 2 |
| [assertGrokSandboxNotRejected](../../src/harnesses/grok.ts#L472) | 472 | 1 |
| [grokLaunchBlockingDialog](../../src/harnesses/grok.ts#L486) | 486 | 4 |
| [grokTuiReady](../../src/harnesses/grok.ts#L502) | 502 | 2 |
| [grokTuiBusy](../../src/harnesses/grok.ts#L510) | 510 | 4 |
| [grokPromptAwaitingAccept](../../src/harnesses/grok.ts#L522) | 522 | 1 |
| [grokUnacceptedPromptRestored](../../src/harnesses/grok.ts#L531) | 531 | 3 |
| [grokRateLimitDialog](../../src/harnesses/grok.ts#L546) | 546 | 4 |
| [grokFramedComposer](../../src/harnesses/grok.ts#L559) | 559 | 1 |
| [grokPaneObservation](../../src/harnesses/grok.ts#L563) | 563 | 3 |
| [grokStartupAction](../../src/harnesses/grok.ts#L577) | 577 | 1 |
| [grokFooterHasConfiguration](../../src/harnesses/grok.ts#L584) | 584 | 2 |
| [grokUserPrompt](../../src/harnesses/grok.ts#L597) | 597 | 1 |
| [grokTranscriptText](../../src/harnesses/grok.ts#L614) | 614 | 1 |
| [createGrokAgentMetadata](../../src/harnesses/grok.ts#L667) | 667 | 1 |
| [grokAuthPlan](../../src/harnesses/grok.ts#L702) | 702 | 1 |
| [grokAuthStatus](../../src/harnesses/grok.ts#L712) | 712 | 1 |
| [grokAuthPane](../../src/harnesses/grok.ts#L727) | 727 | 1 |
| [grokModelsLine](../../src/harnesses/grok.ts#L754) | 754 | 3 |
| [readGrokModelDefaults](../../src/harnesses/grok.ts#L763) | 763 | 0 |
| [grokModelDefaultsFromBody](../../src/harnesses/grok.ts#L770) | 770 | 4 |
| [pick](../../src/harnesses/grok.ts#L773) | 773 | 2 |
| [withoutGrokDefaults](../../src/harnesses/grok.ts#L782) | 782 | 2 |
| [restoreGrokModelDefaults](../../src/harnesses/grok.ts#L796) | 796 | 1 |
| [grokFooterModelName](../../src/harnesses/grok.ts#L837) | 837 | 2 |
| [grokModelFromFooter](../../src/harnesses/grok.ts#L847) | 847 | 3 |

## src/harnesses/idle-settings.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/idle-settings.ts](../../src/harnesses/idle-settings.ts)。SHA256 `8c2724d9a76775446ab52597f153e20348da7f734020073e6fdfa2d9e5a32f8a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [codexSettingsPreview](../../src/harnesses/idle-settings.ts#L13) | 13 | 4 |
| [codexPreviewMatchesSettings](../../src/harnesses/idle-settings.ts#L29) | 29 | 1 |
| [claudeFastMenu](../../src/harnesses/idle-settings.ts#L36) | 36 | 2 |
| [until](../../src/harnesses/idle-settings.ts#L40) | 40 | 6 |
| [inspectIdleSettings](../../src/harnesses/idle-settings.ts#L48) | 48 | 1 |
| [inMenu](../../src/harnesses/idle-settings.ts#L51) | 51 | 3 |
| [close](../../src/harnesses/idle-settings.ts#L53) | 53 | 2 |
| [select](../../src/harnesses/idle-settings.ts#L66) | 66 | 1 |
| [row](../../src/harnesses/idle-settings.ts#L69) | 69 | 1 |

## src/harnesses/pane-tokens.ts

責務: vendor正本・hook。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/harnesses/pane-tokens.ts](../../src/harnesses/pane-tokens.ts)。SHA256 `963d4d8ad17b0fb51a8b41cd45772e93a2f75fd3837aa2501e7134c724500229`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [paneTokenHint](../../src/harnesses/pane-tokens.ts#L2) | 2 | 1 |

## src/index.ts

責務: 通常受付・進行。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/index.ts](../../src/index.ts)。SHA256 `966b1ee60bdfb3c039cd37ea2b8ede7e20d54d81ede921ca933fd14261faf5c1`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [createAitermServer](../../src/index.ts#L61) | 61 | 3 |
| [deliveryParentKind](../../src/index.ts#L112) | 112 | 5 |
| [deliveryForRequest](../../src/index.ts#L118) | 118 | 5 |
| [deliveryIdLine](../../src/index.ts#L143) | 143 | 4 |
| [completionWait](../../src/index.ts#L151) | 151 | 3 |
| [ok](../../src/index.ts#L187) | 187 | 5 |
| [fail](../../src/index.ts#L190) | 190 | 21 |
| [factoryDiagnostics](../../src/index.ts#L215) | 215 | 1 |
| [remoteNote](../../src/index.ts#L267) | 267 | 5 |
| [forwardRemote](../../src/index.ts#L271) | 271 | 4 |
| [registerRemoteAwareTool](../../src/index.ts#L282) | 282 | 13 |
| [remoteToolHandler](../../src/index.ts#L293) | 293 | 1 |
| [sendRemote](../../src/index.ts#L313) | 313 | 0 |
| [registerRemoteDelivery](../../src/index.ts#L342) | 342 | 2 |
| [remoteCompletionWait](../../src/index.ts#L348) | 348 | 2 |
| [seatTurnsMeta](../../src/index.ts#L786) | 786 | 1 |
| [interimWordsMeta](../../src/index.ts#L835) | 835 | 1 |
| [kindForHarness](../../src/index.ts#L1140) | 1140 | 3 |
| [agentModelDesc](../../src/index.ts#L1148) | 1148 | 1 |
| [agentEffortDesc](../../src/index.ts#L1157) | 1157 | 1 |
| [launchRemoteAgent](../../src/index.ts#L1180) | 1180 | 1 |
| [launchAgent](../../src/index.ts#L1207) | 1207 | 2 |
| [registerAgentTool](../../src/index.ts#L1284) | 1284 | 3 |
| [main](../../src/index.ts#L1471) | 1471 | 0 |

## src/interim-words.ts

責務: 差込・途中表示。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/interim-words.ts](../../src/interim-words.ts)。SHA256 `2914d887f3b7dc9d4b2da21ff84c367b7fa962af079b7cf57cdfef6c4287e970`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [interimFromToken](../../src/interim-words.ts#L53) | 53 | 2 |
| [parseInterimFrom](../../src/interim-words.ts#L57) | 57 | 3 |
| [agentInterimBoundaryPath](../../src/interim-words.ts#L99) | 99 | 2 |
| [interimCallerFromMeta](../../src/interim-words.ts#L106) | 106 | 4 |
| [interimRequestFromMeta](../../src/interim-words.ts#L115) | 115 | 1 |
| [parse](../../src/interim-words.ts#L125) | 125 | 5 |
| [claudeText](../../src/interim-words.ts#L139) | 139 | 2 |
| [claudeInterimWords](../../src/interim-words.ts#L145) | 145 | 2 |
| [codexInterimWords](../../src/interim-words.ts#L165) | 165 | 2 |
| [grokRealUser](../../src/interim-words.ts#L203) | 203 | 2 |
| [grokUserCount](../../src/interim-words.ts#L207) | 207 | 2 |
| [grokInterimWords](../../src/interim-words.ts#L214) | 214 | 2 |
| [cursorInterimWords](../../src/interim-words.ts#L234) | 234 | 2 |
| [claudeTranscriptSize](../../src/interim-words.ts#L261) | 261 | 1 |
| [grokChatHistory](../../src/interim-words.ts#L266) | 266 | 4 |
| [readLines](../../src/interim-words.ts#L271) | 271 | 9 |
| [recordInterimBoundary](../../src/interim-words.ts#L283) | 283 | 2 |
| [readInterimBoundary](../../src/interim-words.ts#L302) | 302 | 1 |
| [interimFromNow](../../src/interim-words.ts#L319) | 319 | 1 |
| [codexLinesFrom](../../src/interim-words.ts#L331) | 331 | 2 |
| [interimWordsFrom](../../src/interim-words.ts#L343) | 343 | 1 |
| [readInterimWords](../../src/interim-words.ts#L356) | 356 | 1 |

## src/lazy-relay.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/lazy-relay.ts](../../src/lazy-relay.ts)。SHA256 `d0ca6203b72c185889f91cb5094923dd16d1e8e45e617748349e0b010e1a5c3b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [lazyRelayExecutable](../../src/lazy-relay.ts#L7) | 7 | 2 |

## src/live-node.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/live-node.ts](../../src/live-node.ts)。SHA256 `b6cf06deebf1650b2b4948fa11af9c10129b6a6bd562469f39d7203e64c8a404`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [liveNodeExecutable](../../src/live-node.ts#L10) | 10 | 10 |

## src/model-catalog.ts

責務: モデル・解決・利用者設定。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/model-catalog.ts](../../src/model-catalog.ts)。SHA256 `d4a72afbec325332504916a1cafbcd0bbcc48beb7ffe0df8f57066ccc42e128e`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [sortEfforts](../../src/model-catalog.ts#L40) | 40 | 2 |
| [rank](../../src/model-catalog.ts#L42) | 42 | 2 |
| [catalogUnavailable](../../src/model-catalog.ts#L50) | 50 | 7 |
| [catalogInvalid](../../src/model-catalog.ts#L54) | 54 | 23 |
| [checkedCatalog](../../src/model-catalog.ts#L59) | 59 | 5 |
| [agentModelsResult](../../src/model-catalog.ts#L78) | 78 | 1 |
| [processSummary](../../src/model-catalog.ts#L93) | 93 | 2 |
| [findJsonLine](../../src/model-catalog.ts#L100) | 100 | 3 |

## src/native-session.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/native-session.ts](../../src/native-session.ts)。SHA256 `d6941d070393924fa87f60a8fb43f99b8b6f292161086eb5e0383285160c9350`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseNativeSessionReceipt](../../src/native-session.ts#L5) | 5 | 3 |
| [nativePaneTarget](../../src/native-session.ts#L13) | 13 | 4 |
| [nativeSessionTarget](../../src/native-session.ts#L18) | 18 | 1 |
| [nativeSessionCondition](../../src/native-session.ts#L23) | 23 | 2 |

## src/parent-delivery-cli.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/parent-delivery-cli.ts](../../src/parent-delivery-cli.ts)。SHA256 `05242ec5ca87b70d82d20db42ab2bafd8491735ce64f7b5affacc84b9c7d39d9`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [deliveryRecorded](../../src/parent-delivery-cli.ts#L39) | 39 | 1 |
| [option](../../src/parent-delivery-cli.ts#L46) | 46 | 3 |
| [uuid](../../src/parent-delivery-cli.ts#L54) | 54 | 3 |
| [parent](../../src/parent-delivery-cli.ts#L61) | 61 | 3 |
| [readText](../../src/parent-delivery-cli.ts#L67) | 67 | 1 |
| [deliveryState](../../src/parent-delivery-cli.ts#L96) | 96 | 1 |
| [pathWithNode](../../src/parent-delivery-cli.ts#L139) | 139 | 0 |
| [providerDescription](../../src/parent-delivery-cli.ts#L151) | 151 | 1 |
| [runParentDelivery](../../src/parent-delivery-cli.ts#L155) | 155 | 0 |
| [isDirectExecution](../../src/parent-delivery-cli.ts#L183) | 183 | 0 |

## src/parent-delivery-owners.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/parent-delivery-owners.ts](../../src/parent-delivery-owners.ts)。SHA256 `077aa45695ce443dbab22f23840ceb21ccfe7cb2f42c5e328e58f998ef46db84`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [deliveryOwnerPrefix](../../src/parent-delivery-owners.ts#L11) | 11 | 1 |
| [unfinishedDeliveriesOwnedBy](../../src/parent-delivery-owners.ts#L16) | 16 | 1 |

## src/parent-delivery-record.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/parent-delivery-record.ts](../../src/parent-delivery-record.ts)。SHA256 `48094ecefd5799c281b6acc9332f2720c6a7e074a890c60ad1c7a960b2f837cd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [readRecord](../../src/parent-delivery-record.ts#L51) | 51 | 6 |
| [answerMessage](../../src/parent-delivery-record.ts#L63) | 63 | 1 |

## src/parent-delivery.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/parent-delivery.ts](../../src/parent-delivery.ts)。SHA256 `01392384cced8a24af34440568123d1c46125999c7e588b7381ae883ba9e5c68`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [deliveryKey](../../src/parent-delivery.ts#L30) | 30 | 5 |
| [boundaryKey](../../src/parent-delivery.ts#L33) | 33 | 5 |
| [isClaude](../../src/parent-delivery.ts#L48) | 48 | 5 |
| [isCursor](../../src/parent-delivery.ts#L49) | 49 | 6 |
| [isCodex](../../src/parent-delivery.ts#L50) | 50 | 1 |
| [verifyParent](../../src/parent-delivery.ts#L52) | 52 | 2 |
| [submitParentAnswer](../../src/parent-delivery.ts#L58) | 58 | 1 |
| [ownerHeartbeatAt](../../src/parent-delivery.ts#L93) | 93 | 1 |
| [processExists](../../src/parent-delivery.ts#L98) | 98 | 0 |
| [ownerSetupInProgress](../../src/parent-delivery.ts#L105) | 105 | 1 |
| [receipt](../../src/parent-delivery.ts#L111) | 111 | 1 |
| [reportServiceError](../../src/parent-delivery.ts#L181) | 181 | 6 |
| [prepare](../../src/parent-delivery.ts#L186) | 186 | 1 |
| [request](../../src/parent-delivery.ts#L193) | 193 | 1 |
| [reserve](../../src/parent-delivery.ts#L226) | 226 | 1 |
| [save](../../src/parent-delivery.ts#L321) | 321 | 7 |
| [checkpointFailure](../../src/parent-delivery.ts#L329) | 329 | 6 |
| [moveRecord](../../src/parent-delivery.ts#L347) | 347 | 2 |
| [finish](../../src/parent-delivery.ts#L367) | 367 | 8 |
| [releaseClaim](../../src/parent-delivery.ts#L379) | 379 | 5 |
| [watch](../../src/parent-delivery.ts#L396) | 396 | 2 |
| [capture](../../src/parent-delivery.ts#L412) | 412 | 2 |
| [captureFailure](../../src/parent-delivery.ts#L442) | 442 | 1 |
| [deliver](../../src/parent-delivery.ts#L452) | 452 | 3 |
| [beforeChange](../../src/parent-delivery.ts#L476) | 476 | 5 |
| [files](../../src/parent-delivery.ts#L496) | 496 | 2 |
| [records](../../src/parent-delivery.ts#L516) | 516 | 2 |
| [status](../../src/parent-delivery.ts#L525) | 525 | 2 |
| [diagnoseClaim](../../src/parent-delivery.ts#L533) | 533 | 0 |
| [references](../../src/parent-delivery.ts#L537) | 537 | 2 |
| [unchanged](../../src/parent-delivery.ts#L583) | 583 | 2 |
| [sample](../../src/parent-delivery.ts#L593) | 593 | 2 |
| [recover](../../src/parent-delivery.ts#L632) | 632 | 3 |
| [heartbeat](../../src/parent-delivery.ts#L641) | 641 | 1 |
| [recoverOrphans](../../src/parent-delivery.ts#L657) | 657 | 1 |
| [close](../../src/parent-delivery.ts#L822) | 822 | 2 |

## src/parent-hook-diagnostic.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/parent-hook-diagnostic.ts](../../src/parent-hook-diagnostic.ts)。SHA256 `ef43879abe03b1e18e05f54de5f698f466aadb9c02c720d782a5648f2977d354`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [record](../../src/parent-hook-diagnostic.ts#L21) | 21 | 2 |
| [required](../../src/parent-hook-diagnostic.ts#L23) | 23 | 5 |
| [readSettings](../../src/parent-hook-diagnostic.ts#L26) | 26 | 2 |
| [detected](../../src/parent-hook-diagnostic.ts#L34) | 34 | 1 |
| [claudeParentHookDiagnostic](../../src/parent-hook-diagnostic.ts#L40) | 40 | 1 |
| [cursorParentHookDiagnostic](../../src/parent-hook-diagnostic.ts#L55) | 55 | 1 |
| [parentDeliveryDiagnostic](../../src/parent-hook-diagnostic.ts#L62) | 62 | 1 |

## src/process-runtime.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/process-runtime.ts](../../src/process-runtime.ts)。SHA256 `32d0fc676ced5d0fd22f2da99d46da188db4ee65f1628231eedb21fcdaba89ef`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [macKeepAwakeProcess](../../src/process-runtime.ts#L31) | 31 | 1 |
| [processIdentity](../../src/process-runtime.ts#L37) | 37 | 4 |
| [parseCpuTime](../../src/process-runtime.ts#L44) | 44 | 1 |
| [parsePosixProcessTable](../../src/process-runtime.ts#L51) | 51 | 1 |
| [aitermProcessProbe](../../src/process-runtime.ts#L101) | 101 | 2 |
| [windowsConsoleHost](../../src/process-runtime.ts#L109) | 109 | 1 |
| [processReadError](../../src/process-runtime.ts#L115) | 115 | 5 |
| [readRuntimeProcesses](../../src/process-runtime.ts#L125) | 125 | 8 |
| [signalRuntimeProcess](../../src/process-runtime.ts#L162) | 162 | 2 |
| [pidExists](../../src/process-runtime.ts#L186) | 186 | 0 |
| [readProcessIdentities](../../src/process-runtime.ts#L197) | 197 | 12 |
| [observeExecutionActor](../../src/process-runtime.ts#L261) | 261 | 0 |
| [parsePosixElapsed](../../src/process-runtime.ts#L276) | 276 | 1 |
| [processElapsedSeconds](../../src/process-runtime.ts#L286) | 286 | 1 |
| [parentProcess](../../src/process-runtime.ts#L308) | 308 | 8 |
| [processSubtree](../../src/process-runtime.ts#L316) | 316 | 7 |
| [lazyRelayProcess](../../src/process-runtime.ts#L333) | 333 | 1 |
| [backgroundProcesses](../../src/process-runtime.ts#L338) | 338 | 1 |
| [readLinuxProcessRegistrationIdentity](../../src/process-runtime.ts#L351) | 351 | 2 |
| [idleClockCommand](../../src/process-runtime.ts#L363) | 363 | 2 |
| [quote](../../src/process-runtime.ts#L370) | 370 | 0 |

## src/process-start.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/process-start.ts](../../src/process-start.ts)。SHA256 `a8fc71739b76780739dfd66e1e83c2098f12d5883949df019e141be2c1140571`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [processStartIdentities](../../src/process-start.ts#L6) | 6 | 4 |
| [processStartIdentity](../../src/process-start.ts#L25) | 25 | 7 |

## src/process-tree-stop.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/process-tree-stop.ts](../../src/process-tree-stop.ts)。SHA256 `8470b9b4acc3eae14ee0ca6bbe6ba9497aa2ab3f601a95c617d0922f992ed94c`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [same](../../src/process-tree-stop.ts#L11) | 11 | 5 |
| [stopProcessTree](../../src/process-tree-stop.ts#L20) | 20 | 1 |
| [inSession](../../src/process-tree-stop.ts#L30) | 30 | 2 |
| [key](../../src/process-tree-stop.ts#L36) | 36 | 2 |
| [childrenFirst](../../src/process-tree-stop.ts#L37) | 37 | 2 |
| [depth](../../src/process-tree-stop.ts#L38) | 38 | 2 |
| [refresh](../../src/process-tree-stop.ts#L45) | 45 | 4 |
| [signal](../../src/process-tree-stop.ts#L57) | 57 | 2 |

## src/psmux-send-worker.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/psmux-send-worker.ts](../../src/psmux-send-worker.ts)。SHA256 `11fd364e0a39e0bbda5f355fe243ea820c11db319ef29967ba83bb702741ca39`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [readPayload](../../src/psmux-send-worker.ts#L15) | 15 | 1 |
| [psmuxDataDir](../../src/psmux-send-worker.ts#L27) | 27 | 1 |
| [sendCommand](../../src/psmux-send-worker.ts#L36) | 36 | 2 |
| [finish](../../src/psmux-send-worker.ts#L41) | 41 | 5 |
| [delay](../../src/psmux-send-worker.ts#L64) | 64 | 2 |
| [send](../../src/psmux-send-worker.ts#L68) | 68 | 0 |

## src/pty-output.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [ordinary-pty.md](ordinary-pty.md)。source: [src/pty-output.ts](../../src/pty-output.ts)。SHA256 `ae0616c7cc51a8b86aded3bcb29c5337887aded871d5350542bcc1769379495b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [estimateTokens](../../src/pty-output.ts#L17) | 17 | 4 |
| [stripControl](../../src/pty-output.ts#L21) | 21 | 8 |
| [collapseBlanks](../../src/pty-output.ts#L38) | 38 | 1 |
| [dedupRuns](../../src/pty-output.ts#L55) | 55 | 1 |
| [surrogateSafeEnd](../../src/pty-output.ts#L70) | 70 | 1 |
| [surrogateSafeStart](../../src/pty-output.ts#L76) | 76 | 1 |
| [elideLongLines](../../src/pty-output.ts#L82) | 82 | 1 |
| [reduceOutput](../../src/pty-output.ts#L93) | 93 | 3 |

## src/remote-contract.ts

責務: 分離した記録読取/表示/設定UI/入力契約/配送記録。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/remote-contract.ts](../../src/remote-contract.ts)。SHA256 `0bfda52724fce89183244ad4ac03fb19a8e08045f21009786e0fede456857816`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/remote.ts

責務: remote契約と中継。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/remote.ts](../../src/remote.ts)。SHA256 `c01201e711e553150db5d0dc6dd093927342f826dee34380ca47e53755d94ba6`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [remoteKey](../../src/remote.ts#L22) | 22 | 4 |
| [remoteLabel](../../src/remote.ts#L26) | 26 | 9 |
| [acceptRemote](../../src/remote.ts#L31) | 31 | 2 |
| [remoteDir](../../src/remote.ts#L37) | 37 | 1 |
| [controlPath](../../src/remote.ts#L43) | 43 | 1 |
| [askpassScript](../../src/remote.ts#L57) | 57 | 1 |
| [passphraseFor](../../src/remote.ts#L67) | 67 | 1 |
| [sshInvocation](../../src/remote.ts#L77) | 77 | 4 |
| [classifyRemoteShell](../../src/remote.ts#L110) | 110 | 1 |
| [remoteShell](../../src/remote.ts#L121) | 121 | 4 |
| [posixCommand](../../src/remote.ts#L141) | 141 | 2 |
| [remoteServerCommand](../../src/remote.ts#L147) | 147 | 1 |
| [callRemoteTool](../../src/remote.ts#L159) | 159 | 4 |
| [remoteWaitCommand](../../src/remote.ts#L186) | 186 | 2 |
| [remoteWaitProcess](../../src/remote.ts#L199) | 199 | 1 |
| [runSsh](../../src/remote.ts#L207) | 207 | 2 |
| [abort](../../src/remote.ts#L215) | 215 | 0 |
| [observeRemoteAgentDone](../../src/remote.ts#L225) | 225 | 2 |
| [readRemoteAgentAnswer](../../src/remote.ts#L256) | 256 | 1 |
| [observeAnywhere](../../src/remote.ts#L274) | 274 | 2 |
| [answerAnywhere](../../src/remote.ts#L279) | 279 | 0 |

## src/rtk.ts

責務: RTK表示。詳細: [native-runtime.md](native-runtime.md)。source: [src/rtk.ts](../../src/rtk.ts)。SHA256 `3233f8b00a8520ac870f09eef32802e122e6a8f65aa360605f62ab5b1f3e7f51`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [truncate](../../src/rtk.ts#L26) | 26 | 5 |
| [stripShellFrame](../../src/rtk.ts#L38) | 38 | 1 |
| [reducePytest](../../src/rtk.ts#L63) | 63 | 1 |
| [flush](../../src/rtk.ts#L70) | 70 | 3 |
| [parsePytestCounts](../../src/rtk.ts#L202) | 202 | 1 |
| [compactPath](../../src/rtk.ts#L233) | 233 | 1 |
| [cleanGrepLine](../../src/rtk.ts#L241) | 241 | 1 |
| [parseGrepLine](../../src/rtk.ts#L262) | 262 | 1 |
| [reduceGrep](../../src/rtk.ts#L278) | 278 | 1 |
| [reduceGitStatus](../../src/rtk.ts#L345) | 345 | 1 |
| [gitLogBounds](../../src/rtk.ts#L377) | 377 | 1 |
| [reduceGitLog](../../src/rtk.ts#L392) | 392 | 1 |
| [applyFilter](../../src/rtk.ts#L449) | 449 | 1 |
| [basenameCmd](../../src/rtk.ts#L474) | 474 | 3 |
| [classify](../../src/rtk.ts#L497) | 497 | 1 |
| [shellWords](../../src/rtk.ts#L514) | 514 | 1 |
| [argsAfterVerb](../../src/rtk.ts#L545) | 545 | 2 |
| [grepPattern](../../src/rtk.ts#L562) | 562 | 1 |
| [gitLogArgs](../../src/rtk.ts#L598) | 598 | 1 |
| [estimateTokens](../../src/rtk.ts#L612) | 612 | 2 |
| [reduce](../../src/rtk.ts#L621) | 621 | 1 |

## src/runtime-error-os.ts

責務: 障害記録と報告。詳細: [runtime-errors.md](runtime-errors.md)。source: [src/runtime-error-os.ts](../../src/runtime-error-os.ts)。SHA256 `be5c0043b5875a045f2e8b833b7035e30891f534914b5482ecc50c4c2562b149`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [defaultRuntimeErrorPaths](../../src/runtime-error-os.ts#L10) | 10 | 1 |
| [defaultRuntimeErrorReportPaths](../../src/runtime-error-os.ts#L31) | 31 | 5 |
| [runtimeErrorReportingStatus](../../src/runtime-error-os.ts#L56) | 56 | 4 |
| [windowsPrivateDaclCommand](../../src/runtime-error-os.ts#L91) | 91 | 1 |
| [windowsPrivateDaclVerifyCommand](../../src/runtime-error-os.ts#L99) | 99 | 1 |
| [expectedHostProfiles](../../src/runtime-error-os.ts#L108) | 108 | 1 |
| [assertPrivatePosixStat](../../src/runtime-error-os.ts#L118) | 118 | 2 |
| [readBoundedFile](../../src/runtime-error-os.ts#L124) | 124 | 5 |
| [forceKill](../../src/runtime-error-os.ts#L147) | 147 | 2 |

## src/runtime-error-report.ts

責務: 障害記録と報告。詳細: [runtime-errors.md](runtime-errors.md)。source: [src/runtime-error-report.ts](../../src/runtime-error-report.ts)。SHA256 `1b58dc92ff836b03e672532672d95acab9cf1b9c3e98496f226ab3ee7c2410fd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [buildRuntimeErrorReport](../../src/runtime-error-report.ts#L42) | 42 | 1 |
| [reportBodyDigest](../../src/runtime-error-report.ts#L64) | 64 | 1 |
| [signReport](../../src/runtime-error-report.ts#L69) | 69 | 1 |
| [reportAuthorization](../../src/runtime-error-report.ts#L73) | 73 | 1 |
| [verifyReportResponse](../../src/runtime-error-report.ts#L78) | 78 | 1 |
| [readProductCredential](../../src/runtime-error-report.ts#L94) | 94 | 2 |
| [setRuntimeErrorReporting](../../src/runtime-error-report.ts#L115) | 115 | 1 |
| [EMPTY_REPORT_STATE](../../src/runtime-error-report.ts#L140) | 140 | 3 |
| [readReportState](../../src/runtime-error-report.ts#L145) | 145 | 2 |
| [writeReportState](../../src/runtime-error-report.ts#L153) | 153 | 1 |
| [reportRuntimeErrors](../../src/runtime-error-report.ts#L174) | 174 | 2 |
| [result](../../src/runtime-error-report.ts#L178) | 178 | 9 |
| [finish](../../src/runtime-error-report.ts#L223) | 223 | 7 |
| [triggerRuntimeErrorReport](../../src/runtime-error-report.ts#L267) | 267 | 3 |

## src/runtime-error-store.ts

責務: 障害記録と報告。詳細: [runtime-errors.md](runtime-errors.md)。source: [src/runtime-error-store.ts](../../src/runtime-error-store.ts)。SHA256 `87d0d6be1fe9a4248d1df8e7db4f28fb00c9e7e9dbe5596e5ae1f1e80875c9af`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [EMPTY_STATE](../../src/runtime-error-store.ts#L105) | 105 | 3 |
| [isObject](../../src/runtime-error-store.ts#L111) | 111 | 10 |
| [exactKeys](../../src/runtime-error-store.ts#L114) | 114 | 8 |
| [validUtc](../../src/runtime-error-store.ts#L118) | 118 | 3 |
| [validateRuntimeObservation](../../src/runtime-error-store.ts#L122) | 122 | 4 |
| [validateCanonicalConfig](../../src/runtime-error-store.ts#L131) | 131 | 1 |
| [collectionStatus](../../src/runtime-error-store.ts#L155) | 155 | 1 |
| [platformName](../../src/runtime-error-store.ts#L166) | 166 | 1 |
| [fingerprintFor](../../src/runtime-error-store.ts#L169) | 169 | 2 |
| [projectRecord](../../src/runtime-error-store.ts#L173) | 173 | 3 |
| [validateRecord](../../src/runtime-error-store.ts#L177) | 177 | 1 |
| [validateState](../../src/runtime-error-store.ts#L200) | 200 | 2 |
| [collectionStatus](../../src/runtime-error-store.ts#L250) | 250 | 5 |
| [assertPrivateDirectory](../../src/runtime-error-store.ts#L255) | 255 | 2 |
| [readState](../../src/runtime-error-store.ts#L265) | 265 | 5 |
| [applyWindowsDacl](../../src/runtime-error-store.ts#L287) | 287 | 7 |
| [ensurePrivateDirectory](../../src/runtime-error-store.ts#L295) | 295 | 2 |
| [atomicWrite](../../src/runtime-error-store.ts#L303) | 303 | 3 |
| [readLock](../../src/runtime-error-store.ts#L323) | 323 | 3 |
| [publishOwnerFile](../../src/runtime-error-store.ts#L353) | 353 | 2 |
| [withLock](../../src/runtime-error-store.ts#L368) | 368 | 3 |
| [compactAcknowledgedResolved](../../src/runtime-error-store.ts#L496) | 496 | 1 |
| [record](../../src/runtime-error-store.ts#L501) | 501 | 2 |
| [tryRecord](../../src/runtime-error-store.ts#L533) | 533 | 0 |
| [snapshot](../../src/runtime-error-store.ts#L539) | 539 | 6 |
| [changeStatus](../../src/runtime-error-store.ts#L549) | 549 | 2 |
| [resolve](../../src/runtime-error-store.ts#L561) | 561 | 1 |
| [reopen](../../src/runtime-error-store.ts#L562) | 562 | 1 |
| [acknowledge](../../src/runtime-error-store.ts#L564) | 564 | 2 |
| [diagnostic](../../src/runtime-error-store.ts#L576) | 576 | 1 |
| [fixedStoreFailure](../../src/runtime-error-store.ts#L589) | 589 | 1 |
| [defaultWorkerTimeoutMs](../../src/runtime-error-store.ts#L590) | 590 | 2 |
| [recordRuntimeError](../../src/runtime-error-store.ts#L595) | 595 | 1 |
| [report](../../src/runtime-error-store.ts#L601) | 601 | 3 |
| [validDiagnostic](../../src/runtime-error-store.ts#L615) | 615 | 1 |
| [runtimeErrorStoreDiagnostic](../../src/runtime-error-store.ts#L622) | 622 | 1 |
| [finish](../../src/runtime-error-store.ts#L626) | 626 | 6 |
| [processExists](../../src/runtime-error-store.ts#L646) | 646 | 4 |

## src/runtime-error-worker.ts

責務: 障害記録と報告。詳細: [runtime-errors.md](runtime-errors.md)。source: [src/runtime-error-worker.ts](../../src/runtime-error-worker.ts)。SHA256 `6abf0b922db6f0e4aa9339b7595e8535bdb6d9e7f3f3c0c802735b811b18073b`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [main](../../src/runtime-error-worker.ts#L6) | 6 | 0 |

## src/runtime-errors-cli.ts

責務: 障害記録と報告。詳細: [runtime-errors.md](runtime-errors.md)。source: [src/runtime-errors-cli.ts](../../src/runtime-errors-cli.ts)。SHA256 `b6519f12e148f61bd8c543c41e3895ee07bdf5593a77f512520d3985114fff7a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [parseArgs](../../src/runtime-errors-cli.ts#L18) | 18 | 1 |
| [emit](../../src/runtime-errors-cli.ts#L36) | 36 | 6 |
| [reportingStatus](../../src/runtime-errors-cli.ts#L41) | 41 | 1 |
| [main](../../src/runtime-errors-cli.ts#L55) | 55 | 0 |
| [isDirectExecution](../../src/runtime-errors-cli.ts#L87) | 87 | 0 |

## src/setup-cli.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup-cli.ts](../../src/setup-cli.ts)。SHA256 `354775176569ab4aeb9fe059894fe4aa8d3e75a731998812abc3eb6b899abac4`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/setup-codex-hooks.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup-codex-hooks.ts](../../src/setup-codex-hooks.ts)。SHA256 `c7ebf48dbc96f1b03ffa5fbcc8724fc16bd4af90decfae294d795e9a75933613`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [codexSteerSelected](../../src/setup-codex-hooks.ts#L12) | 12 | 1 |
| [mergeCodexParentHooks](../../src/setup-codex-hooks.ts#L15) | 15 | 0 |
| [verifyCodexHookRegistration](../../src/setup-codex-hooks.ts#L19) | 19 | 0 |
| [configureCodexSteer](../../src/setup-codex-hooks.ts#L23) | 23 | 2 |
| [ensureCodexParentSteer](../../src/setup-codex-hooks.ts#L41) | 41 | 0 |

## src/setup-codex-relay.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/setup-codex-relay.ts](../../src/setup-codex-relay.ts)。SHA256 `387fb2cdecc4017811ac467675ad7c79fbfc0088197e328b77cf96d38b598f91`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [command](../../src/setup-codex-relay.ts#L22) | 22 | 3 |
| [getGui](../../src/setup-codex-relay.ts#L28) | 28 | 0 |
| [desktopBundledCodex](../../src/setup-codex-relay.ts#L39) | 39 | 1 |
| [findDesktopBinary](../../src/setup-codex-relay.ts#L47) | 47 | 0 |
| [verifyRelayLauncher](../../src/setup-codex-relay.ts#L68) | 68 | 0 |
| [fail](../../src/setup-codex-relay.ts#L79) | 79 | 2 |
| [liveRelay](../../src/setup-codex-relay.ts#L100) | 100 | 0 |
| [writeConfig](../../src/setup-codex-relay.ts#L121) | 121 | 0 |
| [configureCodexSteer](../../src/setup-codex-relay.ts#L127) | 127 | 1 |

## src/setup-integrations.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup-integrations.ts](../../src/setup-integrations.ts)。SHA256 `26e55f8d16cd65cb22d2709b80c153e0ce35e45d70207a2580c938a1feb878ab`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [record](../../src/setup-integrations.ts#L19) | 19 | 3 |
| [sameRegistration](../../src/setup-integrations.ts#L28) | 28 | 3 |
| [mergeJsonMcp](../../src/setup-integrations.ts#L37) | 37 | 2 |
| [hookRuntime](../../src/setup-integrations.ts#L77) | 77 | 4 |
| [claudeParentHookEntries](../../src/setup-integrations.ts#L81) | 81 | 0 |
| [mergeClaudeParentHooks](../../src/setup-integrations.ts#L85) | 85 | 1 |
| [removeClaudeParentHooks](../../src/setup-integrations.ts#L90) | 90 | 0 |
| [cursorParentHookCommand](../../src/setup-integrations.ts#L94) | 94 | 0 |
| [mergeCursorParentHooks](../../src/setup-integrations.ts#L98) | 98 | 2 |
| [removeCursorParentHooks](../../src/setup-integrations.ts#L102) | 102 | 0 |
| [registerClaudeParentHooks](../../src/setup-integrations.ts#L106) | 106 | 2 |
| [configureParentHooks](../../src/setup-integrations.ts#L117) | 117 | 1 |
| [configureIntegrations](../../src/setup-integrations.ts#L137) | 137 | 1 |

## src/setup-node.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup-node.ts](../../src/setup-node.ts)。SHA256 `59bdd8a1a2e02483b6a2718e0d38009843282f635c340e8ce21a75028a991df2`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [setupNodeExecutable](../../src/setup-node.ts#L5) | 5 | 2 |

## src/setup-platform.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup-platform.ts](../../src/setup-platform.ts)。SHA256 `52a7f0b985bc6cc996fe053f2b018dcdb15dcb135e4063e87b49a9ca193c46cc`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [runSetupCommand](../../src/setup-platform.ts#L16) | 16 | 0 |
| [dependencyInstallCommand](../../src/setup-platform.ts#L27) | 27 | 1 |
| [prepareBackend](../../src/setup-platform.ts#L42) | 42 | 1 |
| [ensure](../../src/setup-platform.ts#L45) | 45 | 4 |

## src/setup.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/setup.ts](../../src/setup.ts)。SHA256 `2518e557522a6c153043ad8a54bb2c8222c89f11562c1bc214aa0eee7c96405a`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [nodeDefaultGlobalRoot](../../src/setup.ts#L16) | 16 | 1 |
| [globalRegistration](../../src/setup.ts#L24) | 24 | 2 |
| [same](../../src/setup.ts#L29) | 29 | 0 |
| [verifySetupRuntime](../../src/setup.ts#L39) | 39 | 0 |
| [call](../../src/setup.ts#L44) | 44 | 4 |
| [runSetup](../../src/setup.ts#L72) | 72 | 0 |
| [runParentHooksSetup](../../src/setup.ts#L135) | 135 | 0 |

## src/state-root.ts

責務: 本人性・保存・idle。詳細: [lifecycle-state-ownership.md](lifecycle-state-ownership.md)。source: [src/state-root.ts](../../src/state-root.ts)。SHA256 `6c4b070c857571a349c730f9811fd419762b2b5b242a4ddff82c534a044b88e2`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [currentUid](../../src/state-root.ts#L8) | 8 | 8 |
| [runtimeStateBase](../../src/state-root.ts#L19) | 19 | 7 |

## src/steer-follow.ts

責務: 差込・途中表示。詳細: [harness-contracts.md](harness-contracts.md)。source: [src/steer-follow.ts](../../src/steer-follow.ts)。SHA256 `5d807b2845530fe79497c93f92f45e2413fda7f4a9d32e079313e6c8fba72dbf`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [steerLedgerPath](../../src/steer-follow.ts#L81) | 81 | 2 |
| [squeeze](../../src/steer-follow.ts#L87) | 87 | 6 |
| [steerNeedle](../../src/steer-follow.ts#L89) | 89 | 1 |
| [parseSteerEntry](../../src/steer-follow.ts#L95) | 95 | 2 |
| [recordSteer](../../src/steer-follow.ts#L108) | 108 | 1 |
| [readSteerEntry](../../src/steer-follow.ts#L136) | 136 | 2 |
| [fate](../../src/steer-follow.ts#L172) | 172 | 19 |
| [read](../../src/steer-follow.ts#L183) | 183 | 3 |
| [behind](../../src/steer-follow.ts#L205) | 205 | 0 |
| [baseObservation](../../src/steer-follow.ts#L208) | 208 | 5 |
| [observeSteerDone](../../src/steer-follow.ts#L232) | 232 | 1 |
| [grokSteerAcceptance](../../src/steer-follow.ts#L256) | 256 | 2 |
| [completeLines](../../src/steer-follow.ts#L261) | 261 | 2 |
| [codexUserText](../../src/steer-follow.ts#L305) | 305 | 1 |
| [observeCodexSteerDone](../../src/steer-follow.ts#L320) | 320 | 1 |
| [anchored](../../src/steer-follow.ts#L327) | 327 | 1 |
| [finish](../../src/steer-follow.ts#L347) | 347 | 2 |
| [pending](../../src/steer-follow.ts#L355) | 355 | 4 |
| [claudeTextBlocks](../../src/steer-follow.ts#L433) | 433 | 2 |
| [claudePromptText](../../src/steer-follow.ts#L440) | 440 | 1 |
| [observeClaudeSteerDone](../../src/steer-follow.ts#L457) | 457 | 1 |
| [observed](../../src/steer-follow.ts#L483) | 483 | 8 |
| [codexTurnMark](../../src/steer-follow.ts#L587) | 587 | 1 |
| [codexSeatTranscript](../../src/steer-follow.ts#L597) | 597 | 2 |
| [codexSeatTurn](../../src/steer-follow.ts#L610) | 610 | 1 |
| [__testResetSeatTurns](../../src/steer-follow.ts#L682) | 682 | 0 |

## src/steer-profile.ts

責務: 親配送・Steer接続。詳細: [parent-delivery.md](parent-delivery.md)。source: [src/steer-profile.ts](../../src/steer-profile.ts)。SHA256 `9cda0f3a6455ae14466dc43a07f6d2146e3c4640e139eadb87e3c581b6b616da`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/tmux-runtime.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/tmux-runtime.ts](../../src/tmux-runtime.ts)。SHA256 `9b05b9eadc91dc9c9ce2c134f7a87befb5e0c1211f8e3e709c46cb1185ee5524`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [nativeTargetUnavailable](../../src/tmux-runtime.ts#L23) | 23 | 12 |
| [verifyNativeTarget](../../src/tmux-runtime.ts#L24) | 24 | 6 |
| [withNativeSessionTarget](../../src/tmux-runtime.ts#L31) | 31 | 2 |
| [hasVerifiedNativeSessionTarget](../../src/tmux-runtime.ts#L37) | 37 | 2 |
| [withNativeSessionCreation](../../src/tmux-runtime.ts#L43) | 43 | 2 |
| [captureNativeSessionReceipt](../../src/tmux-runtime.ts#L48) | 48 | 2 |
| [nativeSessionArgs](../../src/tmux-runtime.ts#L59) | 59 | 1 |
| [nativeConditionalArgs](../../src/tmux-runtime.ts#L93) | 93 | 1 |
| [quote](../../src/tmux-runtime.ts#L97) | 97 | 0 |
| [psmuxBin](../../src/tmux-runtime.ts#L126) | 126 | 3 |
| [psmuxVersionSupported](../../src/tmux-runtime.ts#L134) | 134 | 1 |
| [ensureWinPsmux](../../src/tmux-runtime.ts#L142) | 142 | 5 |
| [psmuxDesktopAccessWanted](../../src/tmux-runtime.ts#L177) | 177 | 1 |
| [psmuxServerAccessScript](../../src/tmux-runtime.ts#L185) | 185 | 1 |
| [runPsmuxServerAccessScript](../../src/tmux-runtime.ts#L224) | 224 | 0 |
| [openPsmuxServerToDesktop](../../src/tmux-runtime.ts#L239) | 239 | 1 |
| [tmuxMissingMessage](../../src/tmux-runtime.ts#L288) | 288 | 2 |
| [resolveTmux](../../src/tmux-runtime.ts#L304) | 304 | 4 |
| [tmuxSpawnEnv](../../src/tmux-runtime.ts#L337) | 337 | 4 |
| [tmuxCommandWithInput](../../src/tmux-runtime.ts#L347) | 347 | 3 |
| [runTmux](../../src/tmux-runtime.ts#L357) | 357 | 9 |
| [macOutsideAqua](../../src/tmux-runtime.ts#L405) | 405 | 2 |
| [macGuiServerWanted](../../src/tmux-runtime.ts#L414) | 414 | 1 |
| [xmlText](../../src/tmux-runtime.ts#L420) | 420 | 5 |
| [macGuiTmuxPlist](../../src/tmux-runtime.ts#L426) | 426 | 1 |
| [startTmuxInMacGui](../../src/tmux-runtime.ts#L446) | 446 | 1 |
| [spawnInMacGuiWhenOutsideAqua](../../src/tmux-runtime.ts#L452) | 452 | 2 |
| [runInMacGui](../../src/tmux-runtime.ts#L459) | 459 | 2 |
| [read](../../src/tmux-runtime.ts#L496) | 496 | 3 |
| [tmuxCommand](../../src/tmux-runtime.ts#L505) | 505 | 6 |
| [sendPsmuxPayload](../../src/tmux-runtime.ts#L509) | 509 | 1 |
| [loadPtyBufferChunk](../../src/tmux-runtime.ts#L544) | 544 | 1 |
| [pasteBufferBaseArgs](../../src/tmux-runtime.ts#L560) | 560 | 1 |
| [paneCommandArgs](../../src/tmux-runtime.ts#L568) | 568 | 2 |
| [tmuxHasSessionEnvironmentFlags](../../src/tmux-runtime.ts#L573) | 573 | 2 |
| [sessionEnvironmentLaunch](../../src/tmux-runtime.ts#L580) | 580 | 1 |
| [quote](../../src/tmux-runtime.ts#L594) | 594 | 1 |
| [sessionCallerEnvironment](../../src/tmux-runtime.ts#L602) | 602 | 1 |
| [updateEnvironmentPatterns](../../src/tmux-runtime.ts#L612) | 612 | 1 |
| [tmuxEnvironmentNames](../../src/tmux-runtime.ts#L620) | 620 | 3 |
| [registeredSessionEnvironment](../../src/tmux-runtime.ts#L630) | 630 | 2 |
| [registerSessionEnvironment](../../src/tmux-runtime.ts#L636) | 636 | 2 |
| [tmuxNewSession](../../src/tmux-runtime.ts#L646) | 646 | 1 |
| [attachCommand](../../src/tmux-runtime.ts#L724) | 724 | 1 |
| [normalizePaneCommand](../../src/tmux-runtime.ts#L731) | 731 | 3 |
| [atomicShellMultiline](../../src/tmux-runtime.ts#L743) | 743 | 5 |
| [markShellCommand](../../src/tmux-runtime.ts#L762) | 762 | 2 |
| [paneShellForSubmission](../../src/tmux-runtime.ts#L787) | 787 | 2 |
| [adaptShellSubmission](../../src/tmux-runtime.ts#L801) | 801 | 1 |
| [appendMarkSentinel](../../src/tmux-runtime.ts#L809) | 809 | 1 |
| [modeBitsWorldAccessible](../../src/tmux-runtime.ts#L825) | 825 | 1 |
| [paneCwdArgument](../../src/tmux-runtime.ts#L831) | 831 | 2 |
| [settlePaneLog](../../src/tmux-runtime.ts#L839) | 839 | 4 |

## src/update-cli.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/update-cli.ts](../../src/update-cli.ts)。SHA256 `ccb6cb15e5c14d118a4a4d1353394873c6c69f52870778d8a9f311b0e31616cf`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [ok](../../src/update-cli.ts#L39) | 39 | 0 |

## src/update.ts

責務: setup・update。詳細: [setup-update.md](setup-update.md)。source: [src/update.ts](../../src/update.ts)。SHA256 `dd842d43d5694310e32b90b39157972953110945acb8860844efaddc951fff4f`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [runUpdateCommand](../../src/update.ts#L34) | 34 | 0 |
| [npm](../../src/update.ts#L42) | 42 | 2 |
| [tail](../../src/update.ts#L43) | 43 | 4 |
| [packageRoot](../../src/update.ts#L45) | 45 | 2 |
| [installedVersion](../../src/update.ts#L49) | 49 | 2 |
| [resolveTargetVersion](../../src/update.ts#L54) | 54 | 1 |
| [countRunningServers](../../src/update.ts#L70) | 70 | 1 |
| [parseLastJson](../../src/update.ts#L88) | 88 | 2 |
| [globalPrefixOf](../../src/update.ts#L103) | 103 | 1 |
| [updateLocal](../../src/update.ts#L122) | 122 | 0 |
| [remoteUpdateCommand](../../src/update.ts#L176) | 176 | 1 |
| [remoteUpdateResult](../../src/update.ts#L204) | 204 | 1 |
| [updateRemote](../../src/update.ts#L213) | 213 | 1 |
| [failed](../../src/update.ts#L215) | 215 | 2 |

## src/user-config.ts

責務: モデル・解決・利用者設定。詳細: [goal-configuration-auth-remote.md](goal-configuration-auth-remote.md)。source: [src/user-config.ts](../../src/user-config.ts)。SHA256 `bc37e9c2a146f2e017d0b881b4a07d355bf98efbc65a479d6e6ce96aa0a5deab`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [sleep](../../src/user-config.ts#L9) | 9 | 2 |
| [withUserConfigLock](../../src/user-config.ts#L21) | 21 | 4 |
| [readFileOrNull](../../src/user-config.ts#L53) | 53 | 5 |
| [writeInPlace](../../src/user-config.ts#L57) | 57 | 2 |
| [restoreJsonSetting](../../src/user-config.ts#L78) | 78 | 3 |
| [restoreUserDefaults](../../src/user-config.ts#L110) | 110 | 2 |
| [keepingUserDefaults](../../src/user-config.ts#L117) | 117 | 3 |

## src/windows-codex-connection.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-connection.ts](../../src/windows-codex-connection.ts)。SHA256 `ce12ff108a8f32737ce63571e93f2cadda98368c0a44a3ddadbfa56e85e8ec86`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [readWindowsProcesses](../../src/windows-codex-connection.ts#L19) | 19 | 4 |
| [invalid](../../src/windows-codex-connection.ts#L23) | 23 | 9 |
| [readWindowsRelay](../../src/windows-codex-connection.ts#L25) | 25 | 3 |
| [findWindowsParentSocket](../../src/windows-codex-connection.ts#L47) | 47 | 1 |
| [windowsSocketConnection](../../src/windows-codex-connection.ts#L72) | 72 | 1 |
| [windowsDesktopRelay](../../src/windows-codex-connection.ts#L82) | 82 | 1 |

## src/windows-codex-launcher.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-launcher.ts](../../src/windows-codex-launcher.ts)。SHA256 `9f8bfc456743ff3e3315abb4e8e4f4b14b13c875badd2559ac9dda9857c8b931`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [windowsLauncherSource](../../src/windows-codex-launcher.ts#L4) | 4 | 1 |
| [literal](../../src/windows-codex-launcher.ts#L5) | 5 | 4 |

## src/windows-codex-native.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-native.ts](../../src/windows-codex-native.ts)。SHA256 `106213e2cb090cfe5b6b6c9478f862a9275cfeac88f79e4a3a86f9ecb1773867`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |

## src/windows-codex-relay.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-relay.ts](../../src/windows-codex-relay.ts)。SHA256 `12bf4ae03254de0f7e3a58d03f782499fa18b77a5a22f1c81e8d0a9a665d6e51`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [prepareWindowsRelay](../../src/windows-codex-relay.ts#L16) | 16 | 0 |
| [serveWindowsRelay](../../src/windows-codex-relay.ts#L36) | 36 | 0 |

## src/windows-codex-setup.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-setup.ts](../../src/windows-codex-setup.ts)。SHA256 `a0b369bbe8907ce70a6a872b996479d2137656f6060f3e2edeabadace39db0cd`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [findWindowsCodexCache](../../src/windows-codex-setup.ts#L20) | 20 | 1 |
| [digest](../../src/windows-codex-setup.ts#L23) | 23 | 2 |
| [findWindowsCodexBinary](../../src/windows-codex-setup.ts#L35) | 35 | 0 |
| [getGui](../../src/windows-codex-setup.ts#L48) | 48 | 0 |
| [setGui](../../src/windows-codex-setup.ts#L52) | 52 | 0 |
| [buildWindowsLauncher](../../src/windows-codex-setup.ts#L70) | 70 | 1 |
| [live](../../src/windows-codex-setup.ts#L84) | 84 | 0 |
| [windowsCodexRuntime](../../src/windows-codex-setup.ts#L93) | 93 | 2 |
| [configureWindowsCodexSteer](../../src/windows-codex-setup.ts#L111) | 111 | 0 |
| [save](../../src/windows-codex-setup.ts#L115) | 115 | 0 |

## src/windows-codex-state.ts

責務: 接続runtime・旧relay。詳細: [codex-relay-runtime.md](codex-relay-runtime.md)。source: [src/windows-codex-state.ts](../../src/windows-codex-state.ts)。SHA256 `843b4f6171c71bedd22d5511043234155819036da908d105241785e48eb2769e`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [quotePowerShell](../../src/windows-codex-state.ts#L8) | 8 | 7 |
| [windowsPowerShellSync](../../src/windows-codex-state.ts#L10) | 10 | 5 |
| [makePrivate](../../src/windows-codex-state.ts#L22) | 22 | 2 |
| [ensurePrivateDirectory](../../src/windows-codex-state.ts#L44) | 44 | 2 |
| [makeFilePrivate](../../src/windows-codex-state.ts#L49) | 49 | 5 |

## src/windows-powershell.ts

責務: OS・native作用。詳細: [native-runtime.md](native-runtime.md)。source: [src/windows-powershell.ts](../../src/windows-powershell.ts)。SHA256 `5f6b1921e0c298580fe991a159ef052494a67ec025bbf0442324a3892fecbaaf`。

| 関数 | 行 | 静的caller |
| --- | ---: | ---: |
| [powershellInvocation](../../src/windows-powershell.ts#L11) | 11 | 3 |
| [literal](../../src/windows-powershell.ts#L12) | 12 | 0 |
| [defaultProbe](../../src/windows-powershell.ts#L23) | 23 | 0 |
| [resolveWindowsPowerShell7](../../src/windows-powershell.ts#L28) | 28 | 14 |
| [fail](../../src/windows-powershell.ts#L35) | 35 | 1 |
| [windowsPowerShell7Command](../../src/windows-powershell.ts#L50) | 50 | 2 |

PTY readiness修理は既index/core/tmux-runtime内。readOnlyTmuxListは解決/一覧共通deadlineと固定失敗型、readOnlyPtyListDiagnosticは厳密同socket不在と安全理由、factoryDiagnosticsは同toolのv1互換/v2射影を所有する。[観測契約](observation-results.md)と[native境界](native-runtime.md)参照。新module無し。
