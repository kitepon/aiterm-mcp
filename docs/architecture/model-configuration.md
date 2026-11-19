# model設定の所有者

## 席の設定の固定（0.70.71、a313）

launcherが席のmodel／effortを固定でき、固定中は席の中のAIのtool呼びでは変えられない（指揮官氏の「AI設定の固定」、`configuration-lock.ts`、入口は`index.ts`の3 tool）。launcherは`agent_configure({ session_id, configuration_lock: "lock"|"unlock", configuration_lock_key })`で固定・解除する（他の設定・`action`・`request`とは併用不可。鍵は記号を含む印字可能なASCII 16〜128文字）。Aitermは鍵のSHA-256だけを`<session>.<launch_id>.configuration-lock.json`へ保存する（席の起動世代に結び付き、`pty_close`の片付けが消す）。固定中は、鍵を示さない次の呼びが`AGENT_CONFIGURATION_LOCKED`で断られ、何も打たれない: `agent_configure`のmodel／reasoning_effort（`configurationFailure`は`not_applied`／`not_started`、`aiterm/configure_error`は`relaunch: false`）、`pty_send`の本文（前置き込み）が先頭で始める`/model`・`/models`・`/effort`・`/reasoning`（`force`でも）、`pty_key`のAlt+P。鍵を付けた`agent_configure`（BellTeamが指揮官氏の変更を適用する道）は通る。fastだけの変更、通常の本文、人が端末へ打つ文字、Aitermが自分の設定替えで打つ命令（core内部の送信）は対象外。鍵が合う`unlock`か席を閉じる事が固定を抜ける道。鍵を持つのはlauncherだけで、席のAIへ渡さない。固定していない席は、誰でも固定できる（BellTeamは席を起こしたらすぐ固定する）。別端末の席は、現地のAitermが同じ検査を行う（古い現地は未知の引数を落とし、固定・解除は「model、reasoning_effort、fast…を指定」で失敗するだけで固定にならない）。

## modelもeffortも指定せずに起動した席の、起動時の設定（a442e）

呼び手が`model`と`reasoning_effort`を省いた（`''`＝CLIの既定）Claude Code・Codexの席は、起動の引数に設定を持たない。再開の手順（`.resume-template.json`）の`model`が`null`のままだと、`refreshAgentResumeRecipe`が手順を作らず、休止（`resume_unavailable`）も本体更新後の再開もできない。Aitermは席が実際に始まった設定を、最初に入力欄が空いた時（`core.waitAgentTuiReady`の`ready`）に一度だけ読み、`meta.model`と再開の手順へ記録する。呼び手の`''`はそのまま（Aitermが呼び手の値を書き換えない）。

| 実ファイル・関数 | 読み先と記録 |
| --- | --- |
| `src/started-settings.ts`: `claudeBannerSettings` | Claude Codeの起動画面の見出し（`Opus 5.5 with high effort`）から、modelのID（`claude-opus-5-5`、1M文脈は`[1m]`付き）とeffortを読む。読めない（見出しが流れた・effortの無いmodel）ときはnull |
| `src/core.ts`: `recordStartedSettings` | Claudeは最初のready（`waitAgentTuiReady`）で見出しから、Codexは最初の番の`turn_context`（Codexの記録に残る、実際に走ったmodelとeffort。`codexWorkingResumeConfiguration`）から読む。Codexはready時と休止の確かめの直前（idle snapshot）に試み、effortが記録に無ければ`vendor_default`。ファイルだけを読み、入力待ちの答えは待たない（catalogやprocessは使わない）。`meta.model`・再開の手順を`confirmed`で書く。読めなければ何も書かず、休止できない現状のまま（推測しない） |

対象はClaude CodeとCodexだけ。Grok・Cursor・Antigravityは再開の手順そのものを持たず（`agentResumeRecipeSchema.kind`）、休止も再開もAitermの契約に無いので、記録の読み手がいない。席の中で`/model`で替えた値は、今までどおり休止・再開では持ち越さない。

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
| `harnesses/claude-configure.ts`: configureClaudeForSessionOnly | picker探索、session-only/effort再確認、s直前beforeChange、新通知・元のreadyと有限Esc後始末。行は1列目の名前か、別名の画面（`Opus ✔  Opus 5.5 · …`）では2列目の実際の機種名（`Default`行を除き1行だけ）で決める。別名（`fable`・`opus`など英字だけ）は、席のcatalogがその別名に版つきの名前（`Opus 5`・`Fable 5.2`）を付けていればその版の行だけを選び、無ければ断る（古い版でもCLIの別名の意味が正）。catalogの名前に版が無い（`Fable`）か別名がcatalogに無い時は、その系統の行のうち一番新しい版の行を選ぶ。版は1列目（`Fable 5.2`）か2列目（別名の行 `Fable` → `Fable 5.1`）から読み、`Default`行は除き、版の読めない行は最後。版つきの画面でも別名の画面でも、その系統の行があれば断らない（0.70.56、キロ氏 2026-11-14: catalogの`fable`が`Fable`と版なしで、版つきの画面の`Fable 5.2`と照合できず断っていた）。IDの指定（`claude-fable-5-2`）は今までどおりその版の行だけ。`opusplan`は、席が既にopusplanの時しか選ぶ画面に出ない（2.1.325）。そのためcore（`switchClaudeOpusPlan`）が先に`/model opusplan`を打つ。Claude Codeはこれを利用者の既定にも保存する（`saved as your default for new sessions`）。席のrootの`settings.json`の`model`は、fastと同じ鍵と戻し方（`keepingUserDefaults`＋`restoreJsonSetting`）で直前の値へ戻す。席のrootの`settings.json`が共有fileへのsymlinkの時（BellTeamの2nd account）、鍵（`settings.json.aiterm-lock`）も戻しの書き込みも、リンクでなく実体のfileに対して行う（0.70.70。以前は戻しがリンクを写しで置き換え、実体の既定が残った。鍵のリンクが指す先が無いと待ちが空回りして止まった）。その後、出た`Opus Plan Mode`の行をいつもの選ぶ画面でsで選び直し、effortもそこで選ぶ（0.70.63、a141）。会話が今のmodelでcacheされている席では`/model opusplan`の後に`Switch model?`の確かめ（`❯ 1. Yes, switch`、機種名なし）が出るので、選ぶ画面と同じく1番が選ばれている時だけEnterで1度答える。`/model opusplan`が触るのは、rootの`settings.json`（書き直し。`model`は直前の値へ戻り、バイトも元どおり）と、`.claude.json`の記録の項目（`tipsHistory`・`tipLifetimeShownCounts`・`tipsHistoryByCommand`・`clientDataCacheSlots`・`additionalModelOptionsAnsweredAt`。modelの既定は無い）と、席自身の`sessions/`・`history.jsonl`（rabbit実測 2026-11-15）。20秒以内に結果の行を読めない時は、確かめの画面・選ぶ画面・読めない画面をEscで最大3回閉じ、入力待ちを待たずに`CLAUDE_MODEL_SWITCH_UNCONFIRMED`（`configureRefusal`付き）で断る（0.70.64、Z27 lab）。s前の拒否はEscで画面が閉じたのを読んでから`configureRefusal`（code・relaunch・selection_excluded）を付ける。`_meta["aiterm/configure_error"]`はこの選ぶ画面の拒否だけに付き、入力待ちでない（番の最中の）拒否には付かない。呼び手はその有無で、番の境目で掛け直す拒否と、頼み手へ返す拒否を分ける（キロ氏 2026-11-14。0.70.56で一度だけ付いた受付記録の`refusal`と`AGENT_CONFIGURE_NOT_READY`は0.70.57で取り下げ）。**番の最中のClaude席（0.70.67、b8、キロ氏・オーナー指示 2026-11-15）**: 番が動いている席へ`/model`を打つと命令でなく普通の入力として並ぶだけで効かない（2.1.325実測）。一方Alt+P（ESC p）は番の最中でも選ぶ画面を開き、`s`で選ぶと同じ番の次のAPI要求から新しいmodelで動く。そこでcoreは、席がClaudeで、番が動いていて、modelかeffort（low〜max）だけを替え、fastを付けず、`opusplan`でも`ultracode`でもなく、Claudeのgoalが動いていない時だけ、断らずに番の中の経路へ進む: 入力待ちの待ちを飛ばし、選ぶ画面を`/model`の代わりにtmux/psmuxのキー名`M-p`（ESC pを1回の書き込みで送る。ESCだけが先に着くと番を止めるので別々には送らない）で開き、あとの行の照合・`s`・`Yes, switch`の確かめ・拒否（`configureRefusal`、`aiterm/configure_error`）は入力待ちの席と同じ。違いは2つ: 読めない画面を閉じるEscを打たない（番の最中のEscは番を止める。Escは選ぶ画面か確かめの画面が出ている間だけ）、切り替えの知らせを読んだ後に入力待ちを待たない（番は続いている）。ほかの変更（fast・opusplan・ultracode・goal中）は今までどおり、何も打たず「入力待ちではありません」で断る。入力待ちの席は今までどおり`/model`。**0.70.70（Z43の実験場の失敗）**: 番の最中は、作業の表示（進行行・道具の枠）の下に選ぶ画面が重なって24行の席を越え、画面の下（`Esc to cancel`の行）が切れて読めなかった。そこで番の中の経路は、選ぶ前に席を縦50行へ広げ（`resize-window`、幅は今のまま）、切り替えの後に元の大きさへ戻す。選ぶ画面が読めない時は、見出し（`Select model`）が見えている間だけEscを打って閉じる（開いたままだと、次に打つ文を選ぶ画面のキーとして受け取り、`Enter`で既定が書かれる）。見出しが無い所のEscは番を止めるので打たない。閉じられた時は`selection_excluded: true`で断る。切り替えの結果は、番の最中は`⎿`の無い字下げの1行（`Model set to sonnet (claude-sonnet-5-5) for this session only`）で出るので、その形も読む。 |
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
