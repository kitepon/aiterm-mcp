# model設定の所有者

## 原要求に固定した設定receipt

既`agent_configure`へopt-inの`request`と`action=reconcile`を追加する。[公開入出力と保証限界](../configure-reconcile.md)が契約正本。`configure-request.ts`は原要求UUID/期待launch/要求digest、排他的claim、専用receiptの保存とbounded読取を所有する。`configuration-effect.ts`はその要求のnative作用前checkpointと、保存失敗/終端後の局所継続拒否を所有する。`execution-effect.ts`の既native入口から呼ぶがexecution graphや参加登録は有効にしない。

Claudeの選ぶ画面での拒否のうち、sを打つ前で、Escの後に選ぶ画面も確かめの画面も消えたのを読んだ物だけ、receiptの`native_effect`を`selection_excluded`にする（打った`/model`・矢印・Escは設定を選ばない。設定を決めるのはsと確かめのEnterだけ）。reconcileはこれを`later_effect=excluded`と返す。古い版はこの値を読めず`unavailable`／`unconfirmed`に倒れる。拒否のcodeと、起動し直せばそのmodelを使える見込み（catalogにあるが、この席の選ぶ画面に無い・選べない・この会話だけの選び方が無い）は`_meta["aiterm/configure_error"]`の`{code, relaunch}`で返す。

core.configureAgentはopt-inの期待launchを最初のmetadataと照合し、既generation gateへ接続する。legacy callerの設定動作と返却は保持。tracked applyはPOSIXの既file/directory同期を用い、Windowsでは作用前unsupported。reconcileはrootを作らずfileを読むだけ。current設定はunsupported、元handlerのterminalとnative入力消費は別であり、native作用が一度でも発行され得た要求はlater_effect=unconfirmedのまま返す。receipt不在/破損/途中はunknown。同IDを新しい設定へ再発行しない。

Codex 0.167.0は`-c`上書き付き起動ではin-process app-serverを使い、Aitermは常に`-c`を渡すためnative control socketへ接続できない。従って稼働中Codexのconfigureは既存の拒否契約を保つ。

[全体図](current-overview.svg) → [設定操作](model-configuration.svg) / [goalとの接続](goal-configuration.svg)。編集正本は同名DOT。

| 実ファイル・関数 | 責任と接続 |
| --- | --- |
| `core.ts`: configureAgent / configureAgentInLock | 入力・現在世代・入力待ち、process-local send FIFO/native排他、goal保護、作用前の不明化、metadataと返却を保持。入力待ちの読みは送信（ADR 0101）と同じ証拠: 画面の動作中の行に加え、Codexは記録の最後の境界がturnの開始でprocessが生きている席も番の最中と読み、命令を打たずにnull（呼ぶ側はすぐに「入力待ちではありません」で断る。30秒の見直しは2026-11-07に外した） |
| `core.ts`: agentModelUi | 既存captureScreenの45行、Enterまで含むsendAgentPromptText、既存sendMenuChoiceをadapterへ接続 |
| `agent-model-ui.ts`: AgentModelUi / lineCounts | 内部の画面/命令/keyの型と新通知数の既存集計。native状態を所有しない |
| `harnesses/claude-configure.ts`: configureClaudeForSessionOnly | picker探索、session-only/effort再確認、s直前beforeChange、新通知・元のreadyと有限Esc後始末。行は1列目の名前か、別名の画面（`Opus ✔  Opus 5.5 · …`）では2列目の実際の機種名（`Default`行を除き1行だけ）で決める。別名はcatalogの表示名で照合し、画面の別名行が古い機種を指す時は断る。s前の拒否はEscで画面が閉じたのを読んでから`configureRefusal`（code・relaunch・selection_excluded）を付ける |
| `harnesses/codex-configure.ts`: configureCodexModel / chooseCodexModel | model/effort picker、必要時だけ元のreader/catalog、最終effort選択直前beforeChange、新通知数と有限Esc後始末 |
| `user-config.ts`: keepingUserDefaults / restoreUserDefaults | file lock内でsnapshot→action→finally復元。従来の3回400ms、復元失敗を握りaction結果/例外を返す |
| `core.ts`: keepingCodexDefaults / launchKeepingUserDefaults | Codex公式config復元とfile fallback、起動時のnative観測とcleanup。A3で移動しない |

初期のpickerコマンド/keyとmodel選択の作用境界は区別する。beforeChangeを越えた後の失敗を未作用へ戻さず、coreが元のconfigurationFailureへ射影する。中断・取消・画面取得失敗も元の例外を伝え、既存の画面後始末とfinally復元を通す。再送はしない。readyと画面通知と公開receiptは同じ意味ではない。

adapterへ渡すready/text waitはcoreの元の関数・既定timeoutのまま。catalogは元と同じfallback時点で取得する。Claudeのconfigure内のcatalog（別名の照合・fastの確かめ・fastを外す判定）は、席のroot（meta.claude_home）と席のnative processのlogin（`CLAUDE_CODE_OAUTH_TOKEN`。Linuxは/proc/<pid>/environ、macOSは`ps -wwE`）で読む。席のenvを読めない時（Windows等）だけ呼び手のenvのloginのまま。設定fileの保存形式、3回/400ms、picker再試行の回数・待ち時間、goalと排他の順序を変更しない。

## failed復帰用の現在会話・設定プレビュー（R1準備部品）

`harnesses/idle-settings.ts:inspectCodexResumeSettings`は現在の`/statusline`メニューでthread-id（旧session-id）とmodel/effort/明示速度を読み、strictに一つのUUIDを照合する。既メニュー/欠測/別thread/不整合/閉じた後のready欠測はnull。Escapeで戻り、Enterで選択を保存しない。既inspectIdleSettingsと同じ有限プレビュー操作を共有する。

準備commit3efce36は部品のみだった。R1-L候補ではcore.completeFailedCodexResumeが通常resume/send/launchからこのpreviewを呼ぶ。対応はLinux/Codex/standardの同native。現在threadと明示standardを確認した後、model/effortが不一致なら既configureCodexModelとkeepingCodexDefaultsでrecipeの値へ復元し、最後に新しいpreviewでthread/model/effort/速度を再確認する。別thread/fast/unknownは設定作用前に拒否。cold/H1は別の実装経路で、このUIから起動しない。接続側が同native出生、空composer、input-owner/admissionと作用直前再検証を所有する。UI型だけでこれらを保証しない。実taskイベントを作らず初手前に確認できる条件を、`test/codex-resume-settings.test.mjs`で検証する。関連既callerはcore.inspectAgentIdleSettingsとtest/agent-idle-settings、公開MCP/schema/設定file/exportの変更無し。

直接回帰は`test/failed-resume-settings-core.test.mjs`の直接case。元のuser config保持、旧failed bytes不変・同native/body一回、同名launch→通常configure→send、ready保存失敗後の次休止→resume、別thread/fastでmodel操作0を確認。起動完了の控え（baseline）は0.70.44から使わない（ADR 0141）。修復した席の自分の仕事の数は控え無しで0と読める。既UIのmodel/effort選択順・beforeChange・有限取消・既定復元の待ちは変えない。

設定が異なるR1-Lは既configureWithPausedGoalを共有する。core.agentGoalInContextは保持中のsend ownerを検証し、同じlockを再取得しない。confirmed active goalだけpauseし、native codexTurnSettledを確認できなければ設定・本文前に拒否して自分のpauseを復元する。初手前の欠測をtask_completeへ補完せず待ち時間を増やさない。設定・最終preview・resolutionが終わってから同じgoalだけ再開する。R1の設定不一致時はavailable/confirmedなCodex v1の明示goal値だけを受ける。明示null/pausedは既helperへ進み、unavailable/unsupported/読戻し失敗/goal欠測は設定・本文・resolution前に拒否する。通常agent_configureのunknown時の既契約は変更せず、設定一致の復帰やcold/H1へgoal必須を広げない。
