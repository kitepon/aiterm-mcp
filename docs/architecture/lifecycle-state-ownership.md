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
| `.lifecycle.json` | `core.checkAgentIdle`のbegin/finish/cancel、`agent-lifecycle.ts`のschema/read/write | stopping→hibernated。停止作用前だけcancelでstoppingを消せる。作用後不明なら停止中の記録を保持 |
| `.resume-attempt.json` | `resumeAgentInLock`が旧launchのfileへ書く | old→nextのresuming/ready/failed。nextのpointer公開とready確認は別時点。failed/resumingを自動再試行しない |
| `.activity.jsonl` | `agent-activity.ts` | created/input/turn_endをappend。完成eventのdigestで重複を数えない。metadata snapshotをhookとsenderが上書きし合わない |
| `.idle-clock.json`とsleep worker | `agent-idle-clock.ts` / `core.serviceAgentIdleClock` | token・owner PID/出生本人性・anchor/wake時刻。既send lock下でarm/retire。clock自体を独立した入力受付にしない |
| 同processの送信行列 | `core.ts agentSendQueues` / `withAgentSendLock` | 到着順に前の処理を待つ。timeoutした待機者の後ろも前の所有者を追い越さない |
| agent send file lock / `.reap` | `tryCreateOwnedLock` / `acquireAgentSendFileLock` / `releaseOwnedLock` | O_EXCL/tokenで所有。死亡/PID再利用を確認してreap、照会不能なら生存扱い。stuck reap markは自動回収しない |
| 普通PTY send lock / agent wait lock | `acquireSessionSendFileLock` / `probeWaitLock` / `liveWaitLocks` | agent send lockや私的transaction lockと別の対象。foreign live wait/sendはcloseを拒否 |
| 私的metadata transaction lock | `execution-lock.ts`、store/participant caller | inode/owner原本を照合。明示recoverはnative PID不在を2回確認して非空quarantineへrename。native作用/入力/完了/graph回復の証明にはしない |

`core.ts`の入力排他と`execution-lock.ts`の短いmetadata排他は、所有者・待機・回復条件が異なる。共通のlockという名前だけで統合する設計はまだ行っていない。

## 起動の段階と失敗返却

入口は `index.launchAgent` → `openAgentWithInitialPrompt`。同期`openAgent`は`prepareAgentLaunch`が返すcreateを直ちに実行する。非同期の公開入口はfast計画、Grok/Cursor既定設定の保存・復元、必要なnative admissionを挟んでcreateを呼ぶ。

`prepareAgentLaunch`はmodel/effort/env名/operation ID/lineage/bin/cwd/auth/catalogなどをnative作成前に検証する。Antigravity hook設定やCLIのcatalog照会も含むため、単純な「引数を受けてprocessをspawnする関数」とは扱わない。これらの詳細は各harnessの調査へ引き継ぐ。

managed Claude/Codexの通常作成は`withNativeSessionCreation`の中で行う。tmux/psmuxが返す作成receiptをparseし、created callbackでserver/paneの出生本人性を読む。この時点ではnative端末の作成作用は済んでおり、本人性を取得できなかった事を「何も作成していない」と扱わない。callbackのどの行で失敗したかにより、lock取得・metadata作成・cleanup到達が違う。

出生本人性を取得後、agent send lockと休止状態を再確認し、metadata/初期activity/native proofを記録し、vendorの起動行をPTYへ送る。作成後のmetadata/起動行処理のcatchは`closeSessionInternal(sid,false)`をbest-effortで呼び、元の失敗を優先する。初期created callback内の出生本人性欠測はこのcatchより前に起きる。どの失敗でも同じ後始末になるとは記述しない。

初回promptが無い場合は`not_requested`。trust_project未指定ならstartupは通常`not_checked`、trust_project=trueなら入力可能とharness生存を確認する。fast切替の準備待ちはさらに別条件。promptがある場合はready後、入力前に`submitted_unconfirmed/dispatch_in_progress`を保存して送る。開始観測が取れればstarted、取れなければunconfirmedを残す。初回処理失敗の`AgentLaunchPromptError`は作成したsessionを調査/復旧用に保持し、起動receiptのstartup/initial_promptを返す。

## 休止と復帰

[状態遷移SVG](lifecycle-states.svg) / [PNG](lifecycle-states.png)。`agent-idle.ts`が判定の順序、coreがmetadata/native/画面/recipeの観測と停止作用、process-tree-stopが本人性を検証した木の停止を所有している。

1. idle/composer_ready、未接続、保留child0、起動後process0、vendor会話既知、resume情報、番終了、入力時刻、期限、native設定確認を揃える。unknownは条件成立と扱わない。
2. 既存send lockの下でstoppingを保存。signal直前にも世代・pane・recipe・入力時刻・接続等を確認し、TERM→猶予→KILLを同じ本人性の木だけへ送る。native端末が残れば同じ作成receiptで閉じる。終了確認後だけhibernatedを保存する。
3. 停止作用を出す前の失敗ならstopping取消を試みる。作用後や取消失敗はunconfirmed/stoppingを残す。結果は`.idle-check.json`へ返し、clockはhibernated/unconfirmed/dead/missingで再armしない。
4. 復帰要求はsend lockを保持し、旧metadata/hibernated/attempt欠測/recipe/proofとnative不在を確認。next metadata・新recipe・old attempt=resumingを保存し、native作成とvendor resume起動行を発行する。同じvendor会話IDを保持するがnative/launchは新しくなる。
5. 起動行を出した後にold→next pointerを公開し、その後にTUI/native readyを確認する。標準速Codexだけnative running turnがあればbusyも受ける。fastの復帰はidleを経てfastへ戻す。最後にtemplate/recipeとold attempt=readyを保存する。
6. attempt作成後の失敗はfailed保存を試み、失敗してもresumingが再送を止める。`AgentResumeError`は今回の本文をnot_sentと返す。nativeが作成・起動されたか、保留通知をvendorが別に処理したかまで取り消す意味ではない。

## dispatch・差し込み・取消・close

[入力受付SVG](send-admission.svg) / [PNG](send-admission.png)、[取消/closeSVG](close-interrupt.svg) / [PNG](close-interrupt.png)。

`sendAgentMessage`はprefaceを行列待ち前に検証し、send lock→必要なresume→native pin→harness生存と画面/turn状態→新turn dispatchか差し込みへ分岐する。`dispatchAgentTurn`も同じ排他と復帰を通るが、公開引数と返却は分けたまま。

dispatchでは入力回復・既知のmodal/上限処理・readyを確認し、完了cursorを切り、before_sendで親配送を結ぶ。submitの直前にClaude operation/anonymous markerとinterim境界を記録する。貼付→必要な表示確認→Enterの後、残留/ユーザーhook拒否を確認しdispatch receiptを返す。receiptはturnの作業完了ではない。

差し込みでは本文を一度貼付した後、Grok/Cursorのqueue表示・native受理を確認し、必要な「今すぐ送る」を行う。Grokが既に新turnで受理した時は本文を再投入せず、その完了配送を結んでdispatch receiptを返す。queue不明/残留はtyped sendFailureのunknownで、再送せず返す。

`interruptSessionNow`は入力行列を待って繰返しキーを打つ処理ではない。現在native ID/任意expected launchを検証し、C-cでidle CLIを終了しないようidleを除外、busyが分からなければ拒否。受理されたキーの返りも`interruption:unconfirmed/session_preserved:unconfirmed`で、停止や会話保持を確定しない。close/killへ自動昇格しない。

`closeSessionResult`はforeign live wait/sendの拒否を先に通す。hibernated論理席やnative不在のmanaged席は、generation/lifecycle/attemptと同名native不在を再照合した上でstateだけ片付ける。動くnativeがある場合は保存したnative proofへpinし、必要なClaude終了要求、kill-session、Windowsのserver終了確認を行う。closeの文字列/typed outcomeと実際の全file cleanupを同一視しない。

## 保持すべき現在の制限・未調査

- `cleanupAgentState`と複数のfile削除はbest-effort。元のエラーを優先する箇所とnative close未確認を例外にする箇所を維持する。
- generic closeの`finish`ではkill-sessionの非0を一律例外にはしておらず、私的management targetの時に明示拒否する。これを今回の抽出で黙って変えない。改善/不具合判定は別commitの議題に分ける。
- Windows出生本人性はstatus/JSON/行数/order/形式等の不成立がnullへ射影される。基準73件の欠測原因はこのコード読取で確定しない。
- 後続調査で全vendor・private execution・親配送を含む155実装fileの初読を完了した。全caller/test/fixtureの独立照合と実動作受入は未確認。[全体の設計判断](refactor-rationale.md)に保持する責任を記録した。
