> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 起動世代・休止・入力・終了の状態所有

基準Aiterm `ce575ce8` の現在コードを読む工程。設計変更案ではない。既知のWindows73件は原因未確定のまま、以下のどの境界で止まったかを辿る。

## 状態を持つ場所

| 状態・データ | 現在の所有者と読書き | 受渡しと保持条件 |
| --- | --- | --- |
| `<session>.<launch>.agent.json` | harness metadata constructorと`agent-shared.ts`、`agent-metadata-reader.loadAgentMetadata` | session/kind/vendor会話/設定/lineage。現在の同名nativeだけから元launchを補わない |
| `<session>.active-launch.json` | `agent-shared.ts publishAgentGeneration` / `selectAgentMetadataFile` | 完成したnext metadataの後だけpointerを公開。旧/新のharness・vendor・lineage・resumed_fromを検証。複数世代でpointer欠測/破損時はfallbackしない |
| `.resume-native.json` | `agent-lifecycle.ts` / `prepareAgentLaunch`のcreated callback / `resumeAgentInLock` | native ID/session/server PID/pane ID/PIDと出生本人性。`verifyCreatedNative`は現在の全項目を照合し、dead-pane closeだけpane終了を許容 |
| `.resume-template.json` / `.resume.json` | `captureAgentResumeTemplate` / `finishAgentResumeConfiguration` / `refreshAgentResumeRecipe` | model/effort/fast/cwd/executable/config rootと明示env。秘密名のenvをrecipeへ永続化しない。confirmed以外から復帰可能と補完しない |
| `.lifecycle.json` | `core.checkAgentIdle`のbegin/finish/cancel、`core.commitWorkingAgentResume`（require_existing_resumeと、native消失を確認した通常入力）、`agent-lifecycle.ts`のschema/read/write | stopping→hibernated。停止作用前だけcancelでstoppingを消せる。作用後不明なら停止中の記録を保持。native消失はorigin:restartのhibernatedで表し、復帰できない席は`AGENT_SESSION_REQUIRED`で未送信（[restart-resume-only](restart-resume-only.md)） |
| `.resume-attempt.json` | `resumeAgentInLock`が旧launchのfileへ書く | old→nextのresuming/ready/failed。nextのpointer公開とready確認は別時点。resuming/未公開nextは再試行しない。公開failedは下記の明示された正常要求と再検証で回復する |
| `.activity.jsonl` | `agent-activity.ts` | created/input/turn_endをappend。完成eventのdigestで重複を数えない。metadata snapshotをhookとsenderが上書きし合わない |
| `.idle-clock.json`とsleep worker | `agent-idle-clock.ts` / `core.serviceAgentIdleClock` | token・owner PID/出生本人性・anchor/wake時刻。既send lock下でarm/retire。clock自体を独立した入力受付にしない。sweep（`core.maintainAgentIdleClocks` → `requestAgentIdleClocks`）はtmuxの`list-sessions`に居る席だけを対象にし、owner確認は1回の`ps`。休止・閉じた・死んだ席はclockをすぐretireするので、sweepの対象にすると一覧のたびにcheckerを起こし続ける（0.70.16で除外）。close（`closeSessionInternal`・killAll・同名の新規起動）の`cleanupAgentState`は記録を消す前に`endAgentIdleClock`でそのsleep workerを終わらせる：owner PIDと出生本人性が一致した時だけ、POSIXはdetachedで作った自分のprocess group（sh・sleep・起床中のchecker）へSIGTERM、WindowsはPowerShellの本人をKill。呼んだprocess自身の時計（checker本人・その親）は止めない。止められなかった時は従来どおり有限sleepが起床後のtoken検査で終わる（0.70.24。前は閉じた席の時計が起床時刻まで残った） |
| 同processの送信行列 | `core.ts agentSendQueues` / `withAgentSendLock` | 到着順に前の処理を待つ。timeoutした待機者の後ろも前の所有者を追い越さない |
| agent send file lock / `.reap` | `tryCreateOwnedLock` / `acquireAgentSendFileLock` / `releaseOwnedLock` | O_EXCL/tokenで所有。死亡/PID再利用を確認してreap、照会不能なら生存扱い。stuck reap markは自動回収しない |
| 普通PTY send lock / agent wait lock | `acquireSessionSendFileLock` / `probeWaitLock` / `liveWaitLocks` | agent send lockや私的transaction lockと別の対象。foreign live wait/sendはcloseを拒否 |
| 私的metadata transaction lock | `execution-lock.ts`、store/participant caller | inode/owner原本を照合。明示recoverはnative PID不在を2回確認して非空quarantineへrename。native作用/入力/完了/graph回復の証明にはしない |

`core.ts`の入力排他と`execution-lock.ts`の短いmetadata排他は、所有者・待機・回復条件が異なる。共通のlockという名前だけで統合する設計はまだ行っていない。

## 起動の段階と失敗返却

入口は `index.launchAgent` → `openAgentWithInitialPrompt`。同期`openAgent`は`prepareAgentLaunch`が返すcreateを直ちに実行する。非同期の公開入口はfast計画、Grok/Cursor既定設定の保存・復元、必要なnative admissionを挟んでcreateを呼ぶ。

`prepareAgentLaunch`はmodel/effort/env名/operation ID/lineage/bin/cwd/auth/catalogなどをnative作成前に検証する。Antigravity hook設定やCLIのcatalog照会も含むため、単純な「引数を受けてprocessをspawnする関数」とは扱わない。これらの詳細は各harnessの調査へ引き継ぐ。

managed Claude/Codexの通常作成は`withNativeSessionCreation`の中で行う。tmux/psmuxが返す作成receiptをparseし、created callbackでserver/paneの出生本人性を読む。この時点ではnative端末の作成作用は済んでおり、本人性を取得できなかった事を「何も作成していない」と扱わない。callbackのどの行で失敗したかにより、lock取得・metadata作成・cleanup到達が違う。

Native setup rollback is owned by `tmux-runtime.withNativeSessionSetupRollback` around `openSessionInternal`, only inside the existing managed creation scope. Creation installs a random initial window witness atomically; receipt capture stores the native tuple before the created callback. Tuple + window witness transfers ownership to `@aiterm_create_token`, then restores the window name and inherited automatic rename (psmux explicitly restores its global value to clear manual naming). Setup errors, including unavailable initial birth identity, environment registration and log/offset writes, invoke one conditional close using tuple + marker, without a birth read. The original error remains. After the conditional close, one complete `list-sessions` decides the result (0.70.5): the session name absent marks the error `nativeSessionAbsent` (an already absent native, such as one the created callback closed, is a finished rollback); the created native still listed, or the listing unavailable, adds `creation_rollback_unconfirmed`; a same-name replacement gets neither. On a fresh launch `core.freshLaunchFailure` turns the mark into `AGENT_LAUNCH_NOT_STARTED` unless a dormant record holds the name, and renames an unproven `AGENT_RESUME_UNCONFIRMED` to `AGENT_LAUNCH_UNCONFIRMED`; a resume keeps its own codes. Each native identity refusal names its site as `native_reason=<site>`. Replacement/marker mismatch never authorizes close or deletion of name-based files. Inert local marker metadata survives successful setup until native destruction; it is absent from harness env, resume recipes and public receipts.

State/data flow: `allocation + witness → captured receipt → marker transfer → birth callback → environment/log/offset setup → committed openSession`. A throw from any setup stage leads to `conditional own-native rollback → complete listing → no created shell (fresh: AGENT_LAUNCH_NOT_STARTED) → later same-name launch`; replacement mismatch leads to `successor preserved`, while unavailable native cleanup is reported as unconfirmed. No persistent guard or timer is introduced. Resume setup rollback removes only the new physical shell and preserves the saved conversation and attempt/lifecycle records. Later metadata/launch-command failures retain their existing `closeSessionInternal(sid,false)` catch. Async startup, initial-prompt failure and transport disappearance retain their existing behavior.

初回promptが無い場合は`not_requested`。trust_project未指定ならstartupは通常`not_checked`、trust_project=trueなら入力可能とharness生存を確認する。fast切替の準備待ちはさらに別条件。promptがある場合はready後、入力前に`submitted_unconfirmed/dispatch_in_progress`を保存して送る。開始観測が取れればstarted、取れなければunconfirmedを残す。初回処理失敗の`AgentLaunchPromptError`は作成したsessionを調査/復旧用に保持し、起動receiptのstartup/initial_promptを返す。

## 休止と復帰

[状態遷移SVG](lifecycle-states.svg) / [PNG](lifecycle-states.png)。`agent-idle.ts`が判定の順序、coreがmetadata/native/画面/recipeの観測と停止作用、process-tree-stopが本人性を検証した木の停止を所有している。

1. idle/composer_ready、未接続、保留child0、起動後process0、vendor会話既知、resume情報、番終了、入力時刻、期限、native設定確認を揃える。unknownは条件成立と扱わない。
2. 既存send lockの下でstoppingを保存。signal直前にも世代・pane・recipe・入力時刻・接続等を確認し、TERM→猶予→KILLを同じ本人性の木だけへ送る（子の居た木で根だけが残ったら根へHUP: TERMを無視する対話shellを待たない）。native端末が残れば同じ作成receiptで閉じる。終了確認後だけhibernatedを保存する。
3. 停止作用を出す前の失敗ならstopping取消を試みる。作用後や取消失敗はunconfirmed/stoppingを残す。結果は`.idle-check.json`へ返し、clockはhibernated/unconfirmed/dead/missingで再armしない。
3a. 明示休止：`pty_close {hibernate:true}` → `core.hibernateAgentSession` → `checkAgentIdle(…, immediate=true)`。同じ判定・stopping/hibernated記録・停止作用を使い、期限・接続中の拒否・画面での設定確認（native設定確認）を外す。明示休止は保存recipeで再開する（席の中で替えたmodel等は持ち越さない。0.70.43。それまでは設定確認が要り、BellTeamのClaude recipeは`opus`等の別名で`inspectIdleSettings`の入口で必ず未確認になり、Claudeの席は明示休止できなかった。設定確認は画面へ`/model`・`/fast`を打つ）。Claudeは最後の入力の後の会話記録にrate_limitedのAPIエラーがあれば（`claudeRateLimitedAt`、wait結果と同じ`claudeFailureCategory`）、Stop無し・上限の待ち画面でも番の終わりとする。turn・子process・子配送・番終了未確認は`AGENT_BUSY`、他は`AGENT_HIBERNATE_UNAVAILABLE`で席に触らない。失敗の結果は`content`の文が`aiterm: <CODE>: <reason>: …`。端末の席では本体が`_meta["aiterm/error_code"]`（`aiterm.error-code.v1`、code）を足す（`withErrorCode`）。停止作用後の照合は新しい入力が無い事だけを見る。
4. 復帰要求はsend lockを保持し、旧metadata/hibernated/attempt欠測/recipe/proofとnative不在を確認。next metadata・新recipe・old attempt=resumingを保存し、native作成とvendor resume起動行を発行する。同じvendor会話IDを保持するがnative/launchは新しくなる。
4a. Claudeの設定root替え（BellTeam 1st/2nd）：休止席の再開入口（session_name、require_existing_resume可）だけで`configuration_root`を受け、保存recipeとrootが違う時は`<root>/projects/<cwd slug>/<vendor_session_id>.jsonl`が在る時だけ、recipeのroot/CLAUDE_CONFIG_DIRを差し替えて`resumeAgentInLock`へ渡す。無ければrequire_existing_resumeは`AGENT_RESUME_UNAVAILABLE`、他は`AGENT_RESUME_CONFLICT`。旧recipeとlifecycle digestは変えず、next recipeが新rootを持つ。他の設定差は従来どおり衝突。
4b. Claudeのログイン（BellTeamの枠ごとの1つのlogin、0.70.23）：同じ再開入口で`env_vars`を渡した時、`CLAUDE_CODE_OAUTH_TOKEN`は設定でなくloginとして名前の比較から外す（Aitermがrootから足す`CLAUDE_CONFIG_DIR`も外す。これが全Claude recipeに在るので、`env_vars`を渡す再開はいつも衝突していた）。名指せば値は起こす側のlaunch値（私的env行、無ければprocess env）を席へ、名指さないか値が無ければ外す（席はrootのloginで再開）。`env_vars`を省けば起こす側のlaunch値。0.70.41から値はrecipeへ書かない（4c）：送信時の自動再開（pty_send・dispatch）はloginを名指すrecipeを断る。再開の起動行は値を打たない：POSIXも新規起動と同じ0600のlaunch-env fileを読んで消す（Windowsは従来から0600の.launch.ps1）。
4c. 秘密の名前のenv（E8、0.70.41）：秘密の名前＝`(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$`か、端末の席で本体がheaderから移した`AITERM_MCP_HEADER_n`（`isSecretEnvName`）。0.70.40までは名指すだけでtemplateを書かず、休止も再開もできなかった。今はtemplate/recipeが`secret_environment`（名前だけ、整列）を持ち、`environment`は秘密の値を持たない（値はdiskへ書かない。0.70.40までのrecipeの`environment`に秘密の名前が在れば、値は使わず秘密の名前として読む）。休止は従来と同じ判定で許す。agent_launchの再開（session_name）は、秘密の名前ごとに起こす側のlaunch値（私的env行、無ければprocess env）を取る。Claudeのloginだけは4bのまま（`env_vars`で名指さなければ外してrootのlogin）。値の無い名前が1つでもあれば`AGENT_RESUME_SECRET_MISSING`で作用前に断り（not_started、席はhibernatedのまま）。値は0600のlaunch-env fileだけで渡し、tmuxのenvにもnext recipeにも入れない。送信時の自動再開（pty_send・dispatch・消えた席の採用）は値を持たないので`AGENT_RESUME_SECRETS_REQUIRED`で断り本文を送らない（呼び手がagent_launchで再開する）。断りは`_meta["aiterm/resume_secrets"]`（`aiterm.agent-resume-secrets.v1`）と`_meta["aiterm/error_code"]`で返す（0.70.43。それまでのstructuredContentは、tool一覧を読んだSDKの呼び手では出力schemaの検査で-32602になり、codeが消えた）。idle時計（immediateでない）はこういう席を休止しない（`resume_needs_launch_values`で見送り）。再開で`mcp_config`を渡すと、席に呼び手MCP fileが在ってserver名が同じ時はそのfileを書き直す（端末の転送のPが替わった時のため）。名前が違えば`AGENT_RESUME_CONFLICT`、fileの無い席では従来どおり使わない。4bのloginも値はdiskへ書かず名前だけ残す（名指さないか値が無ければ名前も外す）。
5. 起動行を出した後にold→next pointerを公開し、その後にTUI/native readyを確認する。0.63.14のCodex復帰は既定50秒、他harnessは30秒。明示timeoutは0を含めて優先する。50秒は描画と連続安定確認を含む準備段階の予算で、RPC全体の保証ではない。標準速Codexだけnative running turnがあればbusyも受ける。fastの復帰はidleを経てfastへ戻す。最後にtemplate/recipeとold attempt=readyを保存する。
6. attempt作成後の失敗はfailed保存を試み、失敗してもresumingが再送を止める。`AgentResumeError`は今回の本文をnot_sentと返す。nativeが作成・起動されたか、保留通知をvendorが別に処理したかまで取り消す意味ではない。

## dispatch・差し込み・取消・close

[入力受付SVG](send-admission.svg) / [PNG](send-admission.png)、[取消/closeSVG](close-interrupt.svg) / [PNG](close-interrupt.png)。

`sendAgentMessage`はprefaceを行列待ち前に検証し、send lock→必要なresume→native pin→harness生存と画面/turn状態→新turn dispatchか差し込みへ分岐する。`dispatchAgentTurn`も同じ排他と復帰を通るが、公開引数と返却は分けたまま。

dispatchでは入力回復・既知のmodal/上限処理・readyを確認し、完了cursorを切り、before_sendで親配送を結ぶ。submitの直前にClaude operation/anonymous markerとinterim境界を記録する。貼付→必要な表示確認→Enterの後、残留/ユーザーhook拒否を確認しdispatch receiptを返す。receiptはturnの作業完了ではない。

差し込みでは本文を一度貼付した後、Grok/Cursorのqueue表示・native受理を確認し、必要な「今すぐ送る」を行う。Grokが既に新turnで受理した時は本文を再投入せず、その完了配送を結んでdispatch receiptを返す。queue不明/残留はtyped sendFailureのunknownで、再送せず返す。

`interruptSessionNow`は入力行列を待って繰返しキーを打つ処理ではない。現在native ID/任意expected launchを検証し、C-cでidle CLIを終了しないようidleを除外、busyが分からなければ拒否。受理されたキーの返りも`interruption:unconfirmed/session_preserved:unconfirmed`で、停止や会話保持を確定しない。close/killへ自動昇格しない。

`closeSessionResult`はforeign live wait/sendの拒否を先に通す。hibernated論理席やnative不在のmanaged席は、generation/lifecycle/attemptと同名native不在を再照合した上でstateだけ片付ける。動くnativeがある場合は保存したnative proofへpinし、必要なClaude終了要求、kill-session、Windowsのserver終了確認を行う。closeの文字列/typed outcomeと実際の全file cleanupを同一視しない。

## 保持すべき現在の制限・未調査

- `cleanupAgentState`は記録を消す前に、Claude/Codexの席の最後の会話（kind・cwd・vendor_session_id・claude_homeかCodexのrollout）を`<seat>.fork-source.json`へ写す（ADR 0140、閉じた席のfork元。席名ごとに1つ、次のcloseで上書き、書く時に30日より古い物を消す）。この控えは席を起こさず、再開・送信の根拠にしない。
- `cleanupAgentState`と複数のfile削除はbest-effort。元のエラーを優先する箇所とnative close未確認を例外にする箇所を維持する。
- generic closeの`finish`ではkill-sessionの非0を一律例外にはしておらず、私的management targetの時に明示拒否する。これを今回の抽出で黙って変えない。改善/不具合判定は別commitの議題に分ける。
- Windows出生本人性はstatus/JSON/行数/order/形式等の不成立がnullへ射影される。基準73件の欠測原因はこのコード読取で確定しない。
- 後続調査で全vendor・private execution・親配送を含む155実装fileの初読を完了した。全caller/test/fixtureの独立照合と実動作受入は未確認。[全体の設計判断](refactor-rationale.md)に保持する責任を記録した。

## failed復帰の安全記録候補 D1

`agent-resume-diagnostic.ts`は新しい復帰処理の失敗だけを世代別`.resume-failure.json`へbest-effort保存する。最初に保存できた1件を残し、既failed/resuming継続拒否で上書きしない。phase/許可reason/型付き元codeだけを持ち、本文・path・生例外を保存しない。本文not_sentとnative_outcome unknownを区別する。元例外・attemptの作用順・6field公開返却は維持。正常成功の記録は作らない。既close cleanupが対象fileも片付ける。既runtime集計/collection/reportingには接続しない。D1単独時点で公開読取D2と同会話修復は未提供だった。現在候補のR1は後続節、D2は別枝。

## 公開済みfailed Codexの同native復帰候補（R1-L）

`core.failedCodexResumeRecipe`がLinux/Codex/standard speed・current/previous/old failed/recipe/proofを固定し、`completeFailedCodexResume`が既send lock/native出生pin内で入力待ちと現在会話・設定を再確認する。元task完了の新規発生を条件にしない。死んだCLI・busy・別会話・不明なcomposerは本文前拒否。設定不一致は現在threadとstandardを確定後、既model設定adapter/利用者既定保持で復元し、新previewで再検証する。別thread/fastは設定前拒否。入力へ命令を貼る前とEnter前を確認し、既存draftと合成された文字列をsubmitしない。

元failedは変更せず、strict `.resume-resolution.json`を別に保存・読戻す。`hasCompletedResumeRecovery`を通常resumeとdormant判定で共有し、後続configureで変わるcurrent recipeを履歴の失効条件にしない。close cleanupが新記録も片付ける。同名agent_launchの設定衝突検査を維持して同じ復帰処理へ接続する。画面parserは`harnesses/idle-settings.ts:codexRecoveryComposer`、現在thread/設定previewも同module。cold復帰とcheckpoint/restoreは別節の独立経路を参照。

実入口回帰は`test/agent-idle-core.test.mjs`末尾、strict保存と旧attempt保持は`test/agent-resume-resolution.test.mjs`、現在会話/UI/入力parserは`test/codex-resume-settings.test.mjs`。既三resume caller、dormantを使うobserve/list/設定/closeと公開6fieldの直接境界を確認対象とする。実vendor/3OS/本番受入は別。

## failedから同vendorを新nativeへ復帰する候補（R1-C）

`core.prepareColdCodexRecovery`は既send lock内で、元failed対応・recipe・現在世代とnative不在を確認する。`assertFailedCodexNativeAbsent`は既native一覧のknown/同名不在、旧pane PIDが残る場合の実出生、Linux通常resume argvに残るvendor UUIDのprocessを照合し、孤児/unknownも拒否する。読めないprocess表を空として扱わない。metadata準備作用直前にも同じ確認を行う。

Bの`.resume-recovery-origin.json`は元A.failed attempt/native/recipe/proof digestを束縛するcold sourceであり、正常停止完了ではない。`agent-lifecycle.confirmedAgentResumeRecoveryOrigin`がstrict schema/参照を確認し、`core.resumeSourceRecord`と`codexResumedProof`が正規hibernationと区別する。既resume本体で新C、新出生、同vendor、C.resumed_from=Bを作り、B.attemptを進める。A.failedとBの旧出生は歴史として保持する。

`harnesses/codex.codexNativeRootRecord`が既厳密root選択を共有し、公開済み内部`codexInterruptionRecord`の完了/中断返却意味は維持する。`captureCodexRecoveryProof`は元rootの安定した末尾を新floorにし、元新taskの欠測や未完をtask_completeへ変換しない。新世代は復帰前の完了を受け取らない。元root置換/partial/別会話/複数rootは拒否する。

直接回帰：`agent-idle-core.test.mjs`のcold正常系・orphan/一覧unknown/root置換/vendor mismatch拒否、`codex-resume-proof.test.mjs`の初手前/未完task/cold provenanceと新floor。H1 offline保存/復元はresume-checkpoint正本へ。online sealは提供せず、実供給の停止とboot採用はcaller責任であり商用供給成功へ拡張しない。

R1-L直接回帰では、同名launchでresolutionを完成→通常configureでcurrent recipe変更→sendを確認し、元startup baselineを保持するready-save失敗からは次の正常休止/同vendor resumeも確認した。baseline欠測の初期失敗は既unknownを保ち、復帰後に子をbaselineへ取り込まない。全既失敗を無条件に休止可能にする変更ではない。


Resume-only admission on normal launch is defined in [restart-resume-only](restart-resume-only.md); it reuses the existing send lock and lifecycle/recipe owner, without a new store or writer.


0.63.9 restart-only admission can write an origin:restart hibernated variant after confirmed native absence and validated saved configuration. Unlike idle-timeout stopping, it has no old pane/native identity to assert. The existing lifecycle file remains the owner; exact flow is in restart-resume-only.md.


Resume-only0.63.10 retained working preparation may bind a Codex UUID/model only from the strict launch-bound root/current-turn configuration (restart-resume-only.md). Its existing recipe/template can carry reasoning_effort_source:vendor_default with null effort; unknown null without that origin is incomplete. Native owns binding/config proof, existing generation/lock/default preservation and cleanup; execution still owns prior-active selection and summary.


Managed-input update: process-local owner/order remains, but agent-send file locks are no longer an input or fresh-agent-launch prerequisite. Caller serialization is required across independent MCP/SSH clients. Native generation/birth, saved resume recipe and effect admission still own target safety; a missing legacy socket/log directory is not readiness. See native-runtime.md for the current input function map/DFD. Logical close and historical cleanup are unchanged.
