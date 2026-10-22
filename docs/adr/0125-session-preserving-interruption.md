# 0125. 停止は現在処理を中断し、会話を残す

状態: 指揮官確定指示（2026-10-21、Trony経由）。実adapter/稼働受入は未了。

「処理だけ中断して、会話セッションは残す」「Escで止めるようなやり方」が現条件。
0124のclose/CLI終了を停止ボタン・連鎖・全体停止へ用いる前提は失効した。
AIへの停止依頼や意味判断を使わず、効かなくてもclose/killへ自動昇格しない。
通常の明示的な管理用closeは残すが、中断の受入には数えない。

## 2026-10-22 最新訂正: 停止ボタンは即時の通常中断操作

指揮官指示により、下記旧v2の証明・journal/drainは停止ボタンの実行経路から外す。
明示native entryの正規agent_stopは `{session_id}` または `{session_ids:[...]}` を受ける。
返りは `{session_id?,status:'sent'|'partial'|'failed'|'idle',targets:[{session_id,status:'sent'|'failed'|'idle',error?}]}`。
記録済み未完了graphのatomic-rename snapshotをwriter lock無しで一度読み、leaf→rootで通常の中断キーを送る。
native MCPの参加者登録も通常要求の初回へ遅延し、cold起動の停止前にenroll/checkpointを要求しない。
循環・重複root・共有先はsessionごと1回、外向きの既知関係だけ。完了済branchは再利用しない。
rootは現在launch、子は記録済み期待launchを照合する。graph読取不能でも明示rootへの送信を実行してpartialを返す。

Codex/ClaudeはEscape、Cursor/GrokはCtrl+C。キーは各harnessが所有する定数で選ぶ。
Ctrl+Cは通常の既存pane観測がbusyの時だけ1回送り、idleは送信無し、未知/拒否/送信失敗はfailed。
GrokのEscはturnを取消さず、Ctrl+Cの連打はquitへ昇格するため行わない。
参照: [Claude](https://code.claude.com/docs/en/interactive-mode)、
[Grok](https://docs.x.ai/build/keyboard-shortcuts)、Cursorの既存`ctrl+c to stop`採取/解析。

sentはmultiplexerへ通常中断キーを送れた事実だけで、native処理終了・会話維持の観測を装わない。
graph checkpoint/fsync・全actor生存・claim清算・drain・native終了proofを実行/次入力の前提にしない。
停止操作はgraph/metadata/receiptを変更せず、一時/永久stopping印やjournalを作らない。同session次入力を塞がない。
送信失敗は対象別に返して他対象へ続け、retry/close/killへ昇格しない。旧v2は隔離診断用に残るがnative停止ボタンから呼ばない。
通常mainや稼働席への反映とは別である。

native hooksの設定は `execution-native-setup.configureNativeExecutionHooks(home,{registration,expectedScope,providerFile,codexBinary})`。
MCPと同一command/entry/flags/scope/providerにmodeだけを付け、Claude/Cursor/Codexへ登録する。
Steer providerのnative_hook_args対応が必要。ユーザー設定への実適用・配布は従来条件を維持する。

## 旧v2診断wire（停止ボタンからは呼ばない）

### 2026-10-22: unknown sendからの明示管理close

停止ボタンは引き続き会話を閉じない。返却済みsendがunknownとなり後続登録を拒否する席の
復旧は、利用者が明示する既存`pty_close`を使う。host BellTeamのunbound管理closeも、
実stdioのprocess/request identityで既存mcp参照を登録する。モデル入力が参照を選ぶ機能は足さない。

許可する競合は同期待launchに結合済みのunknown sendだけ。発行中、close/configure/親作用、
target欠測、別世代を除外し、native IDとserver ownerを準備時と各native gateで照合する。
coreのcloseは捕捉したnative IDへ固定し、既存send/wait lockの拒否を通る。
close成功後の不在を確認してから元sendのslotだけを解放する。
元sendのunknown recordをそのまま残し、旧requestの再発行や成功/未送信への変更を許可しない。
slotの消失後も旧frameの各native gateは拒否される。closeの失敗・応答/不在の不明はslotを残す。
graph schema、新ID、queue、retry、全actor証明、別診断入口は追加しない。

handlerが返したisErrorの本文は失わず、execution_errorの不明/未開始判定と共に返す。
lock競合からunknownになる経路は自己fixtureで再現したが、元障害のraw応答が無いため
元発生原因がlock競合だったと断定しない。

tool名はagent_stop。旧close成功と誤認しないよう、このcontrolだけv2とmodeを必須にする。
register/status/finish/rootsのwireは維持。新ID、queue、再送frameworkを作らない。

```ts
{ schema: "aiterm.cascade-stop-request.v2", mode: "interrupt", roots: LaunchRef[] }
{ schema: "aiterm.cascade-stop-result.v2", mode: "interrupt", roots: LaunchRef[],
  status: "confirmed" | "partial" | "unconfirmed", relation_coverage: "complete" | "incomplete",
  unresolved: { request: ExistingRequestRef | null; reason: string }[],
  targets: { launch: LaunchRef; run: ExistingPoint | null;
    key: "Escape" | "C-c" | null; key_receipt: "not_sent" | "accepted" | "unknown";
    interruption: "interrupted" | "already_idle" | "unconfirmed" | "unsupported" | "replaced";
    session_preserved: "confirmed" | "unconfirmed"; reason: string }[] }
```

acceptedはnativeキー入力の受付だけ。現在runの中断・下流終了・会話維持を証明しない。
runは既存launch/operation/turn/cursor境界で、Bot名や最新jobから推測しない。
interruptedにはそのrunの中断証拠、session_preserved=confirmedには前後の同じlaunch・native harness identity・
会話endpointの維持証拠を必要とする。消失/closed/already_closedを成功へ変換しない。
already_idleはキーを送らない局所状態であり、下流や未確認の呼出を終了扱いにしない。
キー受付だけ、run欠測、世代交代、native中断/会話維持の欠測は未確認のまま返す。

既定の隔離controlはread-only planと全対象unsupported/not_sentだけ。キー・停止印・slot・close/killを発行せず、
旧guardedCloseを呼ばない。Bridgeが接続できても中断が実装/受入済みにはならない。

旧finishのkind=interruptedは期待launchの閉鎖を確認する管理用の意味であり、新中断へ流用しない。
中断結果を関係へ反映する責任はAitermに置き、Bridgeから旧finishを代用しない。
旧launch単位の永続stopping印もそのまま使わない。旧要求/親returnの抑止と、確認後の同一launchへの新依頼を、
既存run/request参照で分けるprivate admissionを隔離開発する。native受入と公開接続は未了。
受付/全体ON抑止はBridgeの責任を維持する。

## 既存public口とCLI差（ローカル実装/保存済み証拠）

| CLI | 既存経路 | 不足 |
| --- | --- | --- |
| Codex | pty_key Escape。保存済み記録にturn_aborted(reason=interrupted)がある（ADR0101） | public seat-turnsはrunning/idleで中断理由を返さない。wait doneだけでも区別できず、現在run/期待世代への厳格な結合と会話維持の再観測が必要 |
| Claude | 相関付きsessionのpublic pty_keyはC-cだけ。足元にesc to interruptの既存観測がある | Bridgeからguardを迂回しない。Aiterm所有の相関維持するharness中断口へEscを限定接続し、元operationのStop/中断を確認する工程が必要 |
| Cursor | TUI観測にctrl+c to stop、transcriptにUser aborted requestの扱い | idle境界のC-cがCLI/会話を維持することと元run対応が未受入。Escの等価性も未確認。自動adapterはunsupported |
| Grok | 保存済み画面にCtrl+c:cancel。turn_ended:cancelledを処理できる | send_nowのcancelledは後続turnへの継ぎ目で終了ではない。キーと維持条件の厳格な対応が不足し、自動adapterはunsupported |

稼働版pty_keyの返りはsent key ...という文字列だけ。隔離枝は同じ文字列を保ち、入力受付だけを示す加算の
structuredContentを添える。新tool名やlaunch/turnの推測を作らない。

```ts
{ schema: "aiterm.pty-key-result.v1", session_id: string, key: string,
  outcome: "accepted", interruption: "unconfirmed", session_preserved: "unconfirmed" }
```

acceptedはmultiplexerのsend-keys commandが0終了したことを指し、CLIの処理中断/会話維持の確認ではない。
send-keys非0でもsentと返す不良を修理し、非0なら成否未確認のエラーにする。再発行しない。
相関付きClaudeのpublic C-c限定はこのreceipt追加で緩めない。Ctrl-C連打や別キー・closeへのfallbackも行わない。

### 隔離した最小Esc primitive

core.interruptExpectedAgentRunは、既存のnative admission frameと既存Pointを使うprivate部品。
Codexは現在のnative turn_id、Claudeは現在の相関operation_idが一致するときだけEscを1回送る。
managed metadataのnative ID/server owner、期待launch、唯一のnative harness PID/開始identityを前後に読み、
harness読取の間の世代/native ID/actor/server交代やrun終了も作用前に拒否する。推測の同名補完はしない。
送信先は検証したnative session IDで、CLIへ文章を送らず、Claude operation markerも消さない。
public Claude pty_keyのguardを緩める引数はBridgeへ出さない。

返りは上のキー受付receiptだけで、interruption/session_preservedはunconfirmedのまま。
Cursor/Grok、run境界欠測、旧metadataのnative stamp欠測はunsupported。native送信失敗はpossibleで再発行しない。
この部品は既定agent_stop/通常mainへ未接続。serviceのnative slot内でのfake受付も、処理の中断完了、native終了fence、
会話endpoint維持、古いparent return抑止や同じlaunchの次依頼再開の受入を示さない。

## 隔離したnative部品

### 元runに対応するnative記録のread-only adapter

private `core.observeExpectedAgentRunInterruption(Point)` は、保存済みの元Pointをそのまま返し、
Codex native rolloutの最後の境界を`running/interrupted/completed/other_run/unconfirmed`へ区別する。
`turn_aborted(reason=interrupted)`かつ元turn ID一致だけを記録上のinterruptedと読み、通常完了/idleで代用しない。
native stamp/server owner、期待launch、唯一のharness PID/開始identity、root会話IDと記録file identityを
同じ読取りの前後で再照合する。fileのstatは読取競合の検出にだけ使い、graph寿命や時刻TTLに使わない。

会話IDはnative headerとfile名、完全なdeveloper launch行から読み、cached vendor_session_idや
mtimeで選ばない。fork、部分/破損した境界、曖昧な複数root、旧shared-home以外はunsupported。
複数候補はcached IDで選ばず、native endpointの厳格な別adapterができるまで可用性を限定する。
通常の一覧が読めないdirectoryを飛ばす動作も使わず、全探索の読取失敗やsymlinkは候補欠測として拒否する。
キー作用前のCodex照合にも同じ読取りを使い、同じturn IDでも会話fileが交代すれば拒否する。
Claude/Cursor/GrokにはこのCodex記録判定を流用しない。

これは**native記録/identityの観測部品**であり、公開wire・finish・stopへ未接続。
局所のabortを観測しても、旧要求/parent-returnのfenceと同時切替を排除する受付が未実装なので
`invocation_fence=unknown/session_preserved=unconfirmed`を保つ。stop成功や関係退役へ昇格しない。
元Pointのturn/operation aliasを検証する責任もruntimeに残し、モデルclaimから作らない。

### 中断専用native frame（共有admissionへの結合は未了）

既存execution-effect gateのprivate `withExecutionInterruptEffectScope` は、呼出record/edge/新IDを作らず、
捕捉したnative IDに対する単独Escコマンドだけを1回許す。通常coreの期待run/世代照合は省略しない。
close/respawn/new-session、文章入力、C-c等の別キー、人間名/別native ID、複合command queue、
別native targetへの再結合、普通のwork frameへの入れ替えを拒否する。
native直前の同期issue callbackを使い、Promise admission/bodyとframe終了後の遅着作用を拒否する。
作用後に二度目のEscやfallbackを試みたframeはpossibleのまま失敗し、catchで成功へ変えられない。

このframeは**in-processのnative作用制限部品**。次節のprivate per-run admissionへ隔離接続する。
native受付/全参加者のfenceとcascade controller、稼働版への接続は未了。
callerのnative ID/issue callbackはprivate runtimeが供給する条件で、登録宣言やモデル引数では満たせない。
現agent_stopは引き続きread-only unsupported/not_sent。frameが存在するだけでキーを送らない。

### 既存runごとの共有admission（private、公開stop未接続）

同じFileExecutionStoreの`interruptions`は、元native観測・既存request/delivery参照・phaseだけを保存する。
新ID、配送内容、永続queue、TTL、入力再送を作らない。旧readerは追加fieldを読めないのでlive移行受入は別工程。
`beginInterruption(Point)`はprivate同期native observerで元のrunning turn/launchを検証し、同じlockで
旧要求の参照を固定し未発行だけをnot_sentへ整理する。accepted/issued/unknown receiptを消さない。
元runが同じならcursorが変わっても既存journalを返し、新たなキー発行を作らない。canonical Pointは維持する。

activeな中断は未完の記録済み関係から機械的に到達するlaunchの新受付を抑止する。
遅着した正規child launch receiptは保存し、同じ関係から一時抑止へ加える。旧launch永久stoppingは追加しない。
これはper-run primitiveであり、到達先それぞれの元run確定/中断/部分結果を集めるcontrollerは未実装。
親runをsettleする前に下流の中断受付を独立して確保する責任はそのcontrollerに残る。

`interruptRun(Point, nativeBody)`は関連native-issued/unknown slotが残ればキーを発行しない。
共有lockで既存runをpreparingへ確保し、別processの競合要求が先行のreceiptをnot_sentへ戻せないようにする。
preparingのままcallerが失われた時も自動で引き継がず、元callerの遅着を排除する復旧は別工程。
同期gateが同じ元run/native server/ID/harness/会話recordを再照合し、共有interrupt slotを記録してから
lock外でEscを1回だけ実行する。返ったキーreceiptはacceptedとして保存するがslotは未確認のまま保持する。
作用後のRPC/metadata欠測はissued/unknownを保持し、再構築・abort記録・session消失で再発行を許さない。
作用前拒否はnot_sentとして記録するが、同じrunへの自動再試行はしない。

`settleInterruption(Point)`へ利用者の証拠引数は渡さない。private native observerで元runのinterrupted、
前後の同じnative/harness/会話、session維持confirmed、invocation fence closedを再観測した場合だけ、
accepted journalの一時受付を解除する。通常完了/別turn/closed/idle、キー受付、欠測や宣言だけでは解除しない。
現coreのCodex観測はfence unknown/維持unconfirmedなので**実core接続ではまだ解除できない**。
テストのsynthetic confirmed proofによる同launch再開は実nativeの受入ではない。

解除後も旧request/元native turn/deliveryの拒否参照を残す。同じturnの別cursorを新run扱いしない。
元launchしか無くnative turnが欠けるsourceは未確認、新しいnative turnを検証できるsourceだけを通す。
owner等から来る新しいtarget依頼は同じlaunchを使用できる。旧parent queue/dequeue/emit/wakeは
同じ元deliveryを共有storeで再照合し、別process・再構築後も再開しない。
この拒否参照はgraphの全履歴closureやscope選択の根拠にせず、未完journalだけをroots読取りに残す。

Claude/Cursor/Grokのnative中断証拠/維持、全participant/全作用口のnative fence、作用不明slotの明示復旧、
新native source turn/alias、Windows/bootstrap/auto-name/普通PTY/auth/remote・4CLI受入は未了。
private observer欠測は作用前unsupportedで、通常main/公開controlへ自動mountしない。
同scopeのprivate participant/producerは明示注入したobserverだけを固定して渡し、各読取り直前にscope/actorを再照合する。
local default runtimeへの追加や実行は行わない。

### 現在native runのread-only selector

private `core.selectExpectedAgentRunInterruption(expectedLaunch)` は、明示した期待世代と現在のnative root記録を読み、
Codexのtask_started turnとそのnative rollout内の行頭byte境界を固定する。元dispatch Pointを引数に作らせない。
期待native generation/harness/会話と同じnative境界を再照合し、native記録のinode/size/mtime/ctimeの競合、
欠測/symlinkを拒否する。共通event_fileの長さをCodex cursorへ流用せず、無いnative記録を0で補完しない。
他CLI/idle/終了したturnはunsupported/not_sentでキー推測をしない。

このPointは**現在処理の観測参照**であり、before_sendや元配送へのnative aliasではない。
selectorが使えてもcanonical bindingやincoming MCP caller sourceのturnを補完しない。
元native turnと受理済みrequest/Pointの対応は別のnative相関証拠を必要とする。
関係/metadataを書き換えず、controllerへ明示注入した場合だけ期待native Escの作用へ使える。
現在のnative observerはfence unknown/維持unconfirmedなので、この実core接続も中断成功/再受付を認定しない。

## 正規control入口

### private controller export（通常control未接続）

`ExecutionService.interruptCascade(v2Input)`をprivate部品として追加する。既存graphを唯一の関係正本とし、
全到達launchの現在native runを同期selectorで検証・admitしてからキーへ進む。未完branchのみを辿り、
逆方向の独立callerを追加しない。循環/重複rootでも同じnative runへキーを重ねない。
発行済みRPCをbounded drainし、その間に届いた正規child launch receiptも再計画してadmitする。
不明slot/未drain/世代不一致を無視してキーを発行せず、無関係席のRPCを前置き待機しない。

未解決の元target Pointと選んだnative runが完全一致しない場合はnative_canonical_alias_missingとして保持する。
null native turn、別cursor、現在turn等を元bindingへ書き戻さず、旧receipt/関係を終了扱いにしない。
turnが欠ける元receiptにaliasを作るadapterはこのcontrollerに含めない。
元canonical Pointにnative turnが既に記録されており、到達launchの未完receiptが全て同じPointを参照する場合だけ、
その**元Point**を同期native observerで再観測できる。選択時のnative server/ID、harness PID/開始identity、
会話ID/file identityと元Pointのnative turnが一致することを必要とし、現在観測のcursorへ書き換えない。
複数の異なるcanonical cursor、turn欠測/別turn、operation/steer参照はこの経路で補完しない。
これは既にnative-boundなPointの再照合であり、turn=nullの通常dispatchがnative-boundになったとはしない。
現core observerのfence unknown/維持unconfirmedも変わらず、元Pointが再照合できただけでは関係を終了させない。
下流admission欠測/遅着target/alias欠測時は親の一時受付を解除しない。
解除可能な全対象のproof再観測・metadata整理・最終scope snapshotを一つの共有transactionでcommitし、
途中で親だけ再受付して新しい仕事を旧cascadeへ混入させない。別対象の観測中に先行世代が交代した場合も
最後に再照合し、解除をrollbackする。作用後のcallback拒否はpossibleのままでnot_startedへ戻さない。

private runtimeは既存observeInterruptionSyncに加え、selectInterruptionSync(expectedLaunch)と
interruptKeySync(Point)を明示注入する。function参照と引数は固定/cloneし、participant/producerは各呼出しのscope/actorを再照合する。
local default runtimeはこれらを持たず、通常main/既定agent_stopには接続しない。
明示的に注入したprivate controller exportが利用できることと、MCP公開stopが受入済みであることを区別する。
現在runの選択に証拠が無い、idle/別harness/旧世代の場合はunsupported/not_sentで、既存キーの推測やcloseで補わない。

欠測のある下流は親の解除を止め、受付できていない祖先から到達される対象の解除も保留する。
absentなrootから記録済み子孫へキー作用を行えても、旧祖先の呼出fenceまで証明したことにしない。
一方、独立した明示rootのnative中断/維持/fenceを確認できれば、その対象結果をpartialへ残せる。
未完graphの同一snapshotで全対象の解除条件を決め、先に退役した枝によって後の判定条件を変えない。
source/target世代や未確認の発行結果が欠けるbranchは、局所abortだけで解除しない。

### 正規controlへの明示private注入

`registerExecutionTools(server, service, { interruptCurrentRun: true })` を隔離host compositionにだけ用意する。
同じserver/serviceの既存registrarを通し、同じagent_stop v2 handlerからprivate controllerへ接続する。
tool引数やruntime callbackの存在だけでは有効にならず、登録時のbooleanを固定する。
既定false/未指定、native部品欠測は従来のread-only unsupported/not_sentを維持する。
通常stdio main、static profile、稼働supervisorへの登録/設定は変えない。

このhost注入はnative中断/会話維持/fenceの完成宣言ではない。実coreを注入してEsc受付が返っても、
実native observerの維持unconfirmed/fence unknownはそのままv2へ返し、confirmed/finishへ丸めない。
MCP入力からこの注入を要求する追加引数は受け付けず、close/killや旧v1 stopへfallbackしない。
隔離の実SDK/constructor/dispatcher/handler/service/coreを通すための接続で、本番mount受入は別工程。

同じserverのguarded dispatcherと正規登録した同じExecutionServiceを明示的に結ぶ。
対象はagent_execution/agent_execution_roots/agent_stopの3名だけ。登録前・別service・任意tool名は拒否する。
host source resolverは同じinitialized client名で固定し、BellTeamのmeta欠測をstdio envやclaimで補完しない。
通常stdio mainは18 tools、controls未mountを維持する。

## 既存metadata mutexの明示復旧（中断/fenceの復旧ではない）

private participant storeは、既存の`transaction.lock/owner.json`へ起動時にnative照合した
自分のPID/開始identityだけを記録する。新しい実行IDやleaseを作らず、通常の待機はlockを盗まない。
書込みadmissionはscope/actor/roleをcallback前後で再照合し、不明になればcommitせず既存issued状態を残す。
read-only診断はscope喪失後も保存済み領域を読めるが、登録や書込みを代行しない。

`ParticipantExecutionStore.recoverAbandonedLock(expectedOwner, observeExecutionActor)` は明示private操作。
元owner記録・directory/file identityが一致し、product所有の同期native observerがそのPIDの不在を
2回確認した時だけ、元mutexを`abandoned-transaction-lock-<device>-<inode>`へ原子的に退避する。
native observerは空の一覧だけで不在を証明せず、PID probeのESRCHも必要とする。
PIDが存在する、identityが違う/読めない、probe欠測/非同期、owner記録が無い/部分/競合/差替えの時は解除しない。
開始identityの表記差だけを旧process終了へ変換しないので、PID再利用時も現段階では復旧できない。

退避先は空にせず保持する。同じ元inodeを復旧する競合側が、新しい所有者のmutexをその場所へ
上書きrenameできないための既存filesystem identityであり、実行/配送の新IDではない。
別の復旧lockやTTL、自動takeover/再送は導入しない。旧ownerの記録がないlegacy空lockは未対応のまま。
退避の痕跡があるのにgraphが失われた場合も、empty stateへ初期化しない。

これは**metadata mutexだけ**の修理である。元request/delivery、preparing/issued/unknownの操作、
中断journal/slot、nativeキー受付/会話維持/終了fenceは照合・清算しない。
返りも`operation_state=unreconciled/native_fence=unknown/relation_coverage=incomplete`で、
中断の成功receiptや旧finishの代用にはならない。復旧したactorは旧operationを引き継がず、
未確認のEscや旧parent returnを再発行しない。通常main/公開MCPへ復旧toolを追加しない。

### 中断を発行したMCP callerの既存native参照

scoped MCP storeの`interruptionActor()`だけが、同scope/actorを再照合してキー発行processの
既存PID/開始identityを供給する。worker roleやsource env、target harness PIDから補完しない。
`interruptRun`はpreparingを確保する同じtransactionでcallerをjournalへ保存し、実キー作用直前と
受付receipt保存時にも同じcallerを照合する。旧frameの遅着cleanupが別callerの記録を上書きしない。
このcallerは停止controlの発行processであり、AIの仕事因果やsource native turnではない。
新しいrequest/job/配送IDを作らず、controlを実行graphの仕事edgeへ追加しない。

inventoryはpreparing/issued/accepted/unknownのcallerを、同じ元run/phaseのMCP参照として保持する。
未登録やPID identity不一致/取得不能を診断するだけで、native終了fenceや全参加者被覆を証明しない。
settled/not_sentの履歴から新しい仕事や到達集合を復活させない。
callerが記録されていない旧journalを現在MCPや最新登録者で埋めず、scoped participantはそのjournalの
受付解除を拒否する。旧private fixtureの動作をlive state移行受入に数えない。

callerの不在やmetadata mutexの復旧だけでpreparing/issued/unknownをnot_sentへ戻さず、
キーの再発行や自動takeoverを許さない。native作用/元run/fence欠測の明示清算は引き続き未了。

### 作用前checkpointとpreparingキー試行だけの明示診断

private FileExecutionStoreの全書込みは、0600 temporary fileのwrite/fchmod/file fsync/close、
atomic rename、scope directoryからfilesystem rootまでのdirectory fsync/closeを完了してから返す。
新しく作成したdirectoryの親entryも同期対象にする。任意の段階が失敗すればnative作用へ進まず、
rename後に見えるstateをrollbackしない。issued metadataが見えている場合はそのslotを保つ。
Windowsはこのprivate方式をunsupportedとし、他のfilesystemも同期APIが拒否すれば成功扱いにしない。
これはOSの同期APIの完了保証であり、filesystem/hardware障害からの実復旧受入やnative終了fenceではない。
通常agent metadataのwriteJson0600や通常mainの動作は変更しない。

scoped caller claimは元run/callerの同じrowへ`checkpoint=file_and_directory_sync.v1`を固定する。
この値はwriter protocolの条件であり、fieldが見えるだけで全flush完了やnative作用を証明しない。
旧strict readerは未知fieldを拒否する。旧rowへ現在のwriter保証を補完しない。
実Escはissued row/slotの同期commitが返ってからに限り、file/directory flush失敗時はキー0。

`ExecutionService.reconcilePreparingInterruption(run, expectedCaller, observeExecutionActor)`は明示private操作。
元run/callerが完全一致するpreparing row、新writer protocol、同sessionのinterrupt slot無し、
元callerとは別の同scope MCP、元PID不在の同期native観測2回を共有transaction内で再照合する。
alive/reused/unknown/wrong PID/Promise、旧checkpoint/caller欠測、issued/accepted/unknownは拒否する。
process不在による自動清算・自動takeover・キー再送を追加しない。

成功してもphaseはpreparingのまま`preparing_resolution=key_not_sent`だけを残す。
元callerを現在MCPで置換せず、元request/parent delivery tombstone・旧source/return受付抑止を保つ。
旧frameの遅着native作用とcleanupもこの診断を上書き・解除しない。
返りはkey not_sent / admission retained / interruption unconfirmed / session_preserved unconfirmed /
native_fence unknown。controllerも同じkey未送信事実だけを返し、中断成功/idle/会話維持/元job未送信へ
付け替えない。旧native runの終了と受付解除には別の実証拠が引き続き必要である。

### graph消失と空bootstrapの区別

FileExecutionStoreは最初のgraph commitより先に、既存scope内のimmutable metadata
`relations.initialized.json`（literal `aiterm.execution-store.v1`）を同じ同期手順で保存する。
graph backup、実行ID、配送queueや終了証拠を追加するものではない。
このmarkerまたは旧mutex退避痕跡があるのにrelations.jsonが無ければSTATE_UNAVAILABLEで、
空scopeのcallback、再登録、キーや親returnへ進まない。最初のgraph保存が失敗した場合も同じである。
markerの不正・symlink・読取中の差替えも初期化や修理へ読み替えない。
readonlyの未観測bootstrapはmarkerを作らず、不正stateはmarkerの作成前に拒否する。

有効なlegacy graphは最初の新writer commitでcontinuity markerを得るが、旧journalへの
caller/checkpoint/native proofの補完は行わない。marker導入前にgraphも履歴も失われたlegacy空領域や、
scope directoryごとの喪失を自動復元できるとはしない。旧binaryの参加・実filesystem crash recoveryと
live state移行は未受入であり、通常mainへのmountを許可する追加根拠にはならない。

実席/公式CLI試験・他席操作・本番・公開配布なし。旧closeのfake成功を中断成功へ付け替えない。

## Claude managed operationの最小private Esc参照

Claudeの既存operation markerと空dispatch receiptは、coreが入力を送る前のreserve処理で作る。
その存在をnative入力受理・処理開始・中断完了と見なさない。Stop hookによるmarker消費や
generic agent_doneも、Escが当該処理を中断したこと・旧呼出fence・同会話維持の証拠にはしない。

private selectorは既存未完了graphの実target Point集合を別引数で受け取り、現在markerと同じ
operation_idを持つ**既存参照**を使う。同じlaunch、operation-only boundary、元cursorを保持する。
候補集合はcloneして渡し、thread/current turn、現在event file長、最新job、cached vendor_session_idで補完しない。
現在operationに対応する元Pointが無い場合はunsupported/not_sentで、markerから新しいPointを作らない。
別の仕事/operationや複数cursorが混ざっていても、それだけで到達launchを除外しない。
同じ現在operationの実参照を選び、他のPoint/関係は保持し、対応しないaliasは未確認として残す。
これは元依頼の意味・専有・全入力集合の判定ではなく、実marker/既存参照の機械的照合である。

読み取り観測は別tag `aiterm.claude-managed-interruption-observation.v1`。
recorded_state=unconfirmed、native_boundary=managed_operation_reserved、endpoint.session_id=null、
session_preserved=unconfirmed、invocation_fence=unknownを固定し、native running/abortedへ昇格できない。
同じ期待native server/session・唯一のharness PID/start、markerとreceiptのfile identityを前後で照合し、
別operation、匿名marker、receipt欠測/不正、世代/actor/file差替えを拒否する。

この固定参照への機械的キー作用だけをprivate controllerで許可する。native processing-startを
証明できたという許可ではない。元Pointが今も共有graphに存在することを準備・実キー直前にも確認し、
同じcaller/checkpoint/既存run slotでEscを最大1回発行する。異なるClaude operationをturn=nullだけで
同一runへまとめず、Codex turn/steerとも混同しない。公開Claude pty_keyのguardは変更しない。

キー受付が返ってもaccepted journal/unknown slotと元Point/receipt/関係を保持し、v2は
interruption/session_preserved unconfirmed・managed_operation_native_acceptance_unconfirmedを返す。
キー応答欠測はunknown、再構築/再controlで再送しない。marker消失やStopでsettleせず、
元jobのfinish/interrupted/closed/already_idleへ変換しない。既定stop/通常mainは未接続のまま。
native受付相関と実終了/親return fence、live同会話endpointの厳格adapterと稼働受入は引き続き未了。

### core before_sendと実要求の結合

structured receiptにoperation_idを追加しただけ、またはmodel引数にoperationを置いただけでは
canonical Pointへ採用しない。既存coreが実before_sendの直後に作るPointを同じeffect scopeへ一つだけ
保存する。元session/launch・cursor・既存operationをcloneし、preparingのまま同じ同期準備受付を通す。
これはnative受理の証拠やsource aliasではなく、実要求が準備したtarget参照である。
新しいrequest/queue/IDや永続入力payloadを作らず、未注入の通常coreでは何もしない。

同じframeで違うPointへの上書き、別対象、RPC完了後の遅着captureは拒否する。
dispatcherは成功bodyが返ってからそのimmutableな履歴を読み、現在target/実receiptとの矛盾を照合する。
この履歴readで古いsourceを再受付して成功receiptを失わせず、以後のbinding/state検証はserviceに残す。
矛盾やbinding欠測は元の成功receiptを保持したpossible/status-onlyで、native作用を再送しない。
native steer receiptは実steer IDを優先し、before_send参照で上書きしない。

これでevent_cursorを公開しないclaude_turn.issueも、実core before_send由来の元operation付きPointを
結合できる。普通の匿名Claude turnにnamed operationを補完したとはしない。匿名markerと元境界の対応、
native入力受理/処理開始、Codex native turn aliasは別の未了工程である。

## 匿名Claudeの元before_send参照（private）

named operationを匿名turnへ補完しない。匿名Claudeでは同じactual core before_sendの要求frameに
捕捉した元cursorがある場合だけ、既存markerを`aiterm.claude-operation-marker.v2`で保存する。
内容はoperation_id=nullと元event_cursorだけで、新ID・queue・本文を増やさない。launchは既存の
launch固有marker pathと期待metadataへ照合する。未注入の通常coreはv1を維持する。
v1匿名markerへ後から現在file長/最新jobを足さず、元cursor欠測・不一致ならunsupported。
writerは同じ同期準備受付を通り、preparingのままmarkerを作る。

private selectorはそのv2 markerと一致する**既存target Point**だけを採用し、異なるcursorの
他仕事もgraphに残す。markerのfile identity、期待native server/session/launch/harness PID/startを
前後とキー作用直前にも再照合する。別tag`aiterm.claude-anonymous-interruption-observation.v1`は
recorded_state=unconfirmed、native_boundary=anonymous_turn_reserved、endpoint.session_id=null、
dispatch_receipt=null、loaded_hook=unconfirmed、invocation_fence=unknownを必須にする。
元before_send参照とnative入力受理は分け、汎用のrun/source比較へcursor同一を追加しない。
同じ既存rowの再照合だけでcursorを使い、匿名cursorからnative source/turn aliasを作らない。

この固定匿名参照を同じcaller/checkpoint/一回限りのslotへ結ぶ。Esc accepted後も元Point/receipt、
accepted journal/unknown slotと旧要求/parent return抑止を保持する。service再構築、Stop、marker消費や
消失から再送・finish・idle成功・抑止解除へ進めない。結果は
anonymous_before_send_native_acceptance_unconfirmed/claude_hook_version_unconfirmedを保持する。
public Claude pty_keyのC-c guard、既定stop unsupported、通常main/worker未mountは維持する。

Stop hookとcoreは同じstrict marker decoderを使い、v1/v2を読み分ける。未知版/追加field/不正cursorは
拒否し、旧v1 readerもv2を誤読しない。新hookはv2の同一inodeだけを消費できるが、元cursorを
agent_done/resultへnative終了証拠としてexportしない。これはfixture上のreader互換性であり、
実harnessにロード済みのhook版・全参加者被覆の証明ではない。その欠測は明示したままとする。
実native入力受理・abort・同会話endpoint維持・旧呼出/親return終了fenceの受入は引き続き未了。

### 匿名準備と停止が競合する場合の旧request抑止

現在runを選べないことと、旧requestの未発行stageを取り消せることを分ける。
private controllerはgraphと同じ共有lockで、実source/target世代または予約時の期待target世代が
到達launchと一致する既存recordだけに、既存の`stopping=true`を旧request用の継続した抑止として残す。
名前だけのsource hint、別の期待世代、無関係席、完了済みで下流も無い過去の関係は採用しない。
未完了下流のconnectorは既存branch寿命の判定を使う。新しい配信queue/ID/TTL/別graphは作らない。

not_issued/preparingだけをnot_sentにし、issued/accepted/unknownや元receipt/slotは保存する。
この旧request印は後続のnative作用と既存parent returnの受付でも確認する。
印はsession/launchの停止成功やnative idleを意味しない。run選択がunsupportedでも既発行の部分作用を
not_sentと偽らず、後続作用が拒否された旧issued frameはunknown/possibleと元slotを保持する。
読取statusとgenuineな遅着receiptの保存は拒否せず、別の新依頼へ印をコピーしない。
同じlaunchの新依頼については、別途未解決run/slot/Bridge受付抑止があればその条件を維持する。

発行済みRPCのdrain中に正規receiptが結合され、既存canonical target Point集合が変化した場合だけ、
未admit対象のread-only run選択を再照合する。初回unsupportedを固定せず、元Pointのままadmitする。
これはnative入力/キーの再送ではない。Point集合に変化が無ければ選択を繰り返さず、キーを発行した
既存journalがあればそちらを使う。遅着した元成功とnative中断/会話維持未確認を両方保持する。

stopping fieldのwire形は既存のまま。旧binaryがこのrecord印をnative gateで使う保証は無いため、
旧binary混在/全参加者被覆/稼働移行は未受入で、通常mainへのmountを認める条件にはしない。
既定read-only stopにはこの取消を入れず、明示private host注入だけに限定する。

### native親provenanceを最初のawait前に固定する

private producerは同じnative MCP request参照をdispatcher入口で作り、最初のtarget観測やregisterの
awaitより前に、SDK metadataを実decoderへ一度だけ渡す。独立したnative source/harness/MCP actor
観測とClaude hookのsession/tool/ownerを照合し、元request/source/endpoint/actorの証拠を固定する。
これは既存の実呼出provenanceであり、受信した元入力のnative受理やturn aliasの証明ではない。

固定値は既存ExecutionIngressのprivateなnative_parentに置く。explicit nullはその要求で証拠が
取れなかった意味で、後からhook記録が現れても補完しない。tool引数や公開_metaにこの値を置いても
採用しない。callbackは同期/読取だけで、Promiseを後着proofへ変えない。公開wire/meta key/実行IDを
追加せず、raw SDK metadataや入力本文をgraphへ保存しない。

同じfactoryの実handler/managerは、固定したendpointと同じものだけをcaptureできる。
request/source/client/MCP actorが違うものを拒否し、作用前には同じnative世代/harness/lineageも
再照合する。producerはsnapshot欠測を拒否し、待機後のfresh decoderへのfallbackを持たない。
standaloneな低位primitiveの同期captureは、serving producerの最初のawait前の証拠を代用しない。

ClaudeのPreToolUse ownerは実harnessのPID/startそのものを要求する。単に同じharness配下のMCPや
別hookが生きていることでは代用しない。入口、before_send bind、queue、別processのnative workerで
同じowner条件を使う。hook記録が最初に不正だった場合、target待ち後の書換えで有効化しない。
Codex/Cursorでcurrent producer endpointの独立証拠が無い制限は、このsnapshotで解消しない。

既存ParentSource v1とdelivery bindingは同じ参照を保持し、source boundaryがnullならそのまま。
既存親hookのnative tool/sessionを元入力のoperation/turnへ補完せず、abort・live会話維持・旧呼出の
終了fence・全参加者被覆も未確認。通常main/profile/稼働worker未mountと既定stop unsupportedを維持する。


### SDK request取消は元要求の受付だけを抑止する

既存SDKのnotifications/cancelled(requestId)とtransport closeが供給するhandler extra.signalを、
同じ既存RequestRefへprivateに結ぶ。モデル引数や_metaのsignalは採用しない。read/history/3controlsは
通常作用の取消frameを作らない。host既存refはtargetと固定sourceの照合後だけ取消できる。

signalで即座に要求ローカルの同期gateを閉じ、共有lockが別の観測をawait中でも後続metadata/native作用を
発行しない。同じrefの既存recordだけを共有transactionでstoppingにし、not_issued/preparingをnot_sentへ
変える。未登録ならrecordを作らず、登録との競合は要求終了時に同じrefだけ再照合する。発行済み作用や
issued/accepted/unknown slotを消去しない。native effect/キーの再試行や別launchの停止は行わない。

取消後のgenuine成功receiptと元Pointは通常通り結合し、読取を再受付にしない。取消記録に失敗しても
成功receiptを捨てずpossible/status_onlyを添える。発行後の後続作用が拒否された場合は既存unknown/slotを
保持する。共有record印は旧parent queue/dequeue/emit/wakeにも適用するが、別の新依頼へコピーせず、
同じlaunchの永久停止印やnative終了証拠にしない。

SDKcancel/接続終了はMCP要求の取消であり、CLIがEscで通知すること、元入力のnative受理、中断完了、
同会話維持、source turn aliasや終了fenceの証拠ではない。通常main/worker未mount、全参加者/旧binary
混在の制約は維持する。稼働CLIの通知契約を未検証のまま全中断対応としない。


### parent before_send後のcompanion metadata

元before_sendの非同期child予約待ち後、既存owner record/child claimの保存を同じ要求の
withExecutionPreparation内で行う。graphのbindが応答した後も、Claude/Cursor companion書込の直前に
同じ同期準備受付を再通過する。取消/stop/元source・target世代やscope/actor欠測を後着書込へ持ち越さない。
共有metadata lockを非同期bind/待機全体へ拡大せず、stageをissuedへ早めない。

private managerは同じfactoryで選んだprovider/profileの同期prepareCompanionだけを使う。通常の
static profile/installed helperへfallbackしない。元requestのfrozen native provenance/ownerを再照合し、
後から現れた別deliveryのheaderを上書きしない。Cursor等に独立endpoint証拠が無い制限は保持する。

bind応答後の取消/companion失敗は、元delivery ID/parent/child境界を持つunknown診断を既存manager結果へ
残す。child claimは手放し、watch/queue/native入力は始めず、graph bindingや旧receiptを削除しない。
bind自体が拒否された場合は従来の未結合claim清掃を維持する。partial metadataをnative中断/受理成功へ
昇格せず、元要求/旧親返送の抑止と未確認状態を保存する。

private constructorのerror返却では、static profileによるClaude hook discardを行わない。現在のfileが
元ownerのものと証明できず、graph bindingも既に残る場合があるため、確認済みownerの清算へ保持する。
legacy未注入の通常cleanupは従来通り。これはhook loaded version/全process/legacy混在やnative入力・終了
fenceの解消ではなく、通常main/workerへmountする条件にはならない。


### private入口の親選択は固定ingressだけを読む

private deliveryForRequestはParentManagerExecution.parentFromIngressの同期読取だけを使う。
通常vendor decoder/default hook rootは未注入legacy時だけ使用する。親選択callback欠測・Promise・
不正endpointは未対応として拒否し、明示nullだけをこの要求で親が無い状態として扱う。

同じfactoryのsourceEvidence.endpointFromIngressは、入口で固定されたnative_parent endpoint/proofを
同じrequest/client/source/native actorと照合し、現在のgeneration/harness lineageを独立再観測する。
Claudeはnative hook session/tool/ownerも同じprofile/scopeで再照合する。返すendpointはcloneし、
待機中のmetadata/root/decoderの変化から別親を採用しない。snapshot欠測を現在fileから補わず、
明示nullを後から有効化しない。host delivery/room/callはstdio envを元に親を自動構成しない。

読取はnative親呼出provenanceだけであり、元入力受理/turn alias、中断/会話維持/loaded hookや終了fence
の証明ではない。Codex/Cursorで独立current endpoint証拠が無い制限は、cloneしたendpointで解消しない。
通常main/worker未mount、既定stop unsupported、全参加者/旧binary移行の不足は維持する。


### parent bindの結果不明でも元owner参照を保持する

private managerの既存owner recordへ、同じExecutionRequestと検証済みParentSourceだけをoptionalな
execution参照として添える。raw SDK metadata/入力本文を加えず、新しいIDや配送queueを作らない。
元proofとrequestが不一致なら拒否する。未検証/欠測proofを現在値で補わない。

private予約はunknown/PARENT_DELIVERY_PREPARINGのまま保存し、bind応答とcompanion準備が成立してから
同じ準備frameでwaitingへ進む。bindがcheckpoint作用後にrejectした場合も、possibleやuntyped RPC欠測は
元ID/parent/child/request/proofを持つunknown診断として残す。共有graphの成功やnative受理へ昇格せず、
watch/queue/input/再送を始めない。typed ExecutionErrorのnot_startedだけを既存の未結合清掃へ進める。

diagnostic unknownはmanager再構築でも再送しない。execution参照を持つprivate記録を新しいlegacy
managerが回収しても、adapter無しではunknownとして保存しwatch/返送へ進まない。旧binary readerや
live移行の対応を宣言せず、通常未注入記録/receiptの形は維持する。owner JSONの既存atomic renameは
hardware crash後の耐久性を証明しない。graphの欠測もowner診断からempty/成功へ復元しない。


### private waiting/readyの回収受付

旧ownerのwaiting/readyを監視・既存返送へ戻す前に、保存済みexecution参照を同scopeのgraphへ
read-only照合する。delivery ID/request/親endpoint digest/元source proof/子before_send Pointを
同じbindingへ一致させ、元sendがacceptedでcanonical receiptのcursor等と対応することを確認する。
欠測/preparing/issued/unknown/unsent/退役/停止は待機や推測で埋めない。旧return予約が既に存在する
場合も自動再発行へ進めず明示清算を要する。元proofを現在MCP/native_parent/最新jobから取り直さない。

同じnative世代/actor/実hook owner/headerの独立照合も必要。現在のproducer検証は元MCP actorとの一致を
要求するため、別processへの権限引継をこの受付で成立させない。Codex/Cursorの独立endpoint不足も維持する。
managerはcallback欠測/証拠無し/拒否/true以外の返却をunknownへ保存し、元text/child outcome/requestを
残してwatch/queueを開始しない。照合待ちjobをbeforeChangeへ公開しない。legacy未注入の回収は従来通り。

この読取はgraphを登録/修復/finishせず、receiptのturn=nullや強いbefore_send operationをcanonical aliasへ
昇格しない。ready本文や局所doneをnative終了fenceにしない。読取後の作用は既存の作用直前gateをなお要し、
全参加者・旧binary移行・同会話維持・実CLI受入・公開mountを証明しない。owner JSONのhardware耐久性も未受入。


### private owner checkpointと移動の応答欠測

private managerのowner/record保存は既存execution checkpointのfile fsync→rename→ancestor directory
fsyncを使用する。既存claimのlink/unlinkとrecordの所有者間・結果へのrenameでもdirectoryの同期応答を
要求する。private finishはrecord保存と結果移動の同期後に同じdeliveryのclaimを外す。legacy未注入の
record保存・finish順序は維持する。新queue/実行ID/本文保存方式や外部wireを加えない。

private record/claim checkpointや移動応答が欠ければunknown/service unavailableとし、bind/watch/入力・
queueを進めない。元path/claim/graphを巻き戻したり同じlink/rename/native作用を繰り返したりしない。
rename後欠測は元inodeと一致する移動先だけを診断参照として追い、成功receiptにしない。同一の元recordを
確認できた場合だけunknown診断を一度保存し、その保存自体が失敗しても成功にしない。元recordが無ければ
新規に作って元proofの代用にしない。新受付とtimer回収はservice errorを越えて再開しない。

ready checkpointの失敗でも元のgenuine本文/outcome/turn/requestを保持し、局所doneからfinishやnative
fenceを生成しない。claimのunlinkが作用後に欠測した場合は元記録と未確認を保持し、claimを再作成しない。
元proof/actorの回収条件と旧binary/live移行の不足は変わらない。これはOSがfile/directory同期を応答した
条件であり、hardware crash/電源断や実4CLIの耐久・中断・会話維持を受入済みにしない。

checkpoint未確認のunknown診断を新managerが引き取っても、そのことだけで元claimを外さない。
execution adapter無しの回収でも元CHECKPOINT_UNCONFIRMED診断を上書きせず、同delivery/request/boundaryと
claimを保持する。記録の保管移動は許すが、受付解除はこの回収の成功と別の未了清算条件である。


### 不確実claimのprivate読取診断

同じ保存済みclaimのdelivery/request/parent/子Point/source proofを元graphへ照合し、child inputとparent
returnそれぞれの明示unsent+not_sent記録、受付receipt、発行中/作用不明を区別する。単なるreservedや
operation=not_issued、ready本文/局所done、親return記録が無いことを未発行の確定にしない。
強いbefore_send operationは元canonical receiptを上書きせず、turn=nullはnullのまま返す。

同deliveryのparent_effect、元requestか期待launchへ関連するslot、明示interruption参照、元actorの
既存inventoryを同じread-only transactionで読む。既知の別世代slotや無関係なactor宣言へ範囲を広げず、
未結合/証拠不一致/欠測は不足として残す。native actorの照合は元参照のPID/startだけを使い、PID不在/
再利用/未登録/非同期・欠測観測をnative終了やfenceにしない。既定native observerへの個別fallbackはない。

managerの明示diagnoseClaimはservice error中も読むだけで、recover/登録/claim解除/返送を呼ばない。
claimと同IDのowner recordが無い・複数・参照不一致、graph欠測、adapter無しは未確認を明示する。
現保管場所のowner.jsonと元MCP request actorの記録上一致は分け、移動後の保管ownerを元producerの証明に
しない。結果保存場所には元owner情報が無いので欠測のままにし、現在managerや最新job/時刻から補わない。
本文は返さず、返却値のclearance=retained/retry=none、native endpoint未観測/fence unknownを維持する。

この口はprivate manager/producer内部だけの診断で、公開MCP tools/wire/metaやBridgeの配線を追加しない。
診断成功やOS同期ackはnative入力受理/中断/会話維持/全participant・作用口・旧binary移行の受入ではない。
不確実claimの明示清算と安全な公開mountはなお未了である。


### 新規private recordの元owner参照

新しい元MCP要求のprivate recordでは、requestと固定source proofのMCP PID/startが同じmanager起動時の
native owner identityへ一致する場合、元同期準備frame内でそのPID/startを再照合してexecution.origin_ownerへ
保存する。native照会の欠測/再利用/重複/非同期/不正は保存・claim作成・bind前に拒否する。固定した元ownerを
後着owner.jsonや現在envへ差し替えず、別source/由来を相関できない文脈へownerを推測して付けない。

owner参照は同じ既存delivery/request/proofに束縛したidentityだけで、新IDではない。record schemaは元MCP
requestとproofの同じprocessに一致しないstamp、proof無しや不正なidentityを拒否する。最初のrecord checkpointで
claimより前に保存し、既存の結果移動/unknown診断/回収で参照を持ち越す。旧recordへ後から現在ownerを付けない。

diagnoseClaimは対応するclaim/owner recordへ保存されている元owner参照だけをrecordedと返す。これは由来の
保存記録であり、現在のnative生存/終了fenceや署名認証を証明しない。移動後の保管ownerや現在callerと混同せず、
stamp欠測の旧recordはunprovenを維持する。clearance retained/retry none、native endpoint未観測/fence unknownの
条件を変更しない。旧private binaryのstrict readerと混在移行、実4CLI、明示清算・公開mountは未受入である。

### 保存元ownerの現在native状態は非解除診断

private diagnoseClaimは、claimと同一の元owner recordに保存されたorigin_ownerだけを照会する。
producer runtimeの明示observeOriginOwnerを入口で固定し、同scope/current callerを再照合した上で、既存
observeExecutionActor（PID存在と開始identity、ESRCHのみ不在、他エラー不明）へ結ぶ。注入runtimeの
observer欠測は個別にdefault OSへfallbackせずunknown。旧stamp欠測・record不一致ではnative照会自体を行わない。
legacy回収用existsのfalseや空process配列はこの不在証拠へ流用しない。

返りorigin_owner_nativeはstate=matched/replaced/absent/unknown/unprovenと観測数だけ。
保存PIDへの独立同期読取を2回行い、同じ完全identityが2回ならmatchedまたはreplaced、同PIDの厳格な不在が
2回ならabsent。それ以外の遷移/別PID/不正値/例外/非同期/欠測はunknown。時刻閾値や待機・自動再試行はない。
graph await後とnative読取後に元claim/recordを再照合し、欠測・変更があればunknown、後付け参照を採用しない。
保存されたrecorded_origin_ownerと現在状態は分離し、replacementを元ownerへ書換えない。

この診断は読み取りだけ。native MCP producerの不在であって、CLI/親hook/旧要求の終了fence、元入力未受理、
中断/同会話維持、全participantの証明ではない。明示not_sent記録や局所doneとの組合せでもclaim解除・slot清算・
再送を許可しない。clearance=retained/retry=noneを維持し、公開wire/meta/toolsと通常未注入legacyは変えない。

### Claudeの既存hook/resultを元deliveryへ相関する非解除読取

private producerのclaim診断は、元graphのverified source、同request/deliveryのparent binding、元childの
accepted canonical receiptが対応する場合だけ、同state rootのClaude記録読取adapterへ進む。未受理・世代/元cursor/
endpoint digest/proof不一致を局所doneやresult本文で補わない。既定public tools/wire/metaは増やさない。

親側PreToolUse request.jsonのtool/session/元harness PID・開始identityとdelivery.jsonを固定source proofへ照合し、
子側は保存child Pointの非null operationに限って同launch metadata、result v2、元event_cursor以降の唯一のStopを
照合する。親tool要求と子operationは別参照のまま保持する。result本文のbyte数/digestとStopのmetadataを検査するが、
本文やdigestを返却・新保存せず、canonical Pointへnative turnを足さない。匿名operation=null/Stop理由・turn欠測は
native中断/受理/finish証拠へ変換しない。marker消失、現在vendor cache/同名/最新event/時刻による補完は行わない。

fileは同scope固定pathの同期読取だけで、サイズ上限、元cursorの行境界、symlink/hardlink拒否、fd/path identityと
全snapshotの最終再照合を要する。欠測・別会話/operation・曖昧/部分/不正event・読取中変更・scope交代は未確認。
一式が揃ってもchild_stop=recordedは歴史的記録の対応だけ。native_input/interruption/session_preservedはunconfirmed、
native_fence unknown/clearance retained/retry noneを常に返す。CLI/旧hook/親returnの終了やloaded hookの証明ではなく、
claim解除/slot清算/再送・stop成功/関係退役を実行しない。全native受入・他CLI・公開mountは未完。

## 実用経路を優先する明示native SDK/stdio入口（2026-10-22）

Trony経由の指揮官指示でclaim/Stop provenance診断の次工程を取り下げ、agent_stop v2→実core Escape→同sessionの
次入力へ至る経路を最優先とする。旧診断時刻は着手待ちにしない。実席/本番/配布条件と未確認を成功にしない条件は維持。

private dist/execution-native-server.js のcreateNativeExecutionServer({interruptCurrentRun:true,expectedScope,provider})が
同一participant/serverへcontrolsを正規登録する。明示native組立でのみ実coreのselector/observer/Escを使い、通常index mainと
localProducerRuntimeを自動有効化しない。SDK利用は返りserverを任意のMCP transportへconnectする。注入runtimeは3primitiveと
全I/Oを必須とし、部分fakeからnativeへの個別fallback無し。actorは同MCP PID/start、state/socket scopeは実runtimeと一致が必須。
選択したSteer providerのdecoder/verify/submitを同profileへ使い、installed0.4.7へ黙って戻らない。

stdioコマンドは次の形。state/socketを決める既存環境は起動前に固定し、別scope/旧provider/flag欠測は起動拒否。

```sh
node /absolute/aiterm/dist/execution-native-server.js --execution-interrupt --state-root /absolute/state --socket /absolute/socket --steer-provider /absolute/admission-steer/dist/index.js
```

これはprivate入口の組立であり、実CLI受入や本体公開を意味しない。現在のnative観測はfence unknown/維持unconfirmedで、
Esc受付後の一時admissionを解除できない。native run/会話/期待世代の中断確認と同session次入力の受入、native stampを持つ
隔離新会話のbootstrap、turn-null binding aliasは続く実装の阻害として残る。キー受付だけで成功にせずclose/killへ昇格しない。

同じnative entryと共通prefixへmodeだけを足して本体/4CLI MCP/parent hook登録で共有する。
MCPは--mode mcp（既定）、Claude parent hookは--mode claude-hook、Cursorは--mode cursor-hook。
Codexは--mode codex-hook --codex-home /absolute/native-home --hook-directory /absolute/registered-hook-dir。
各hookは既存Steer run*HookMainへnative worker profileを渡し、stdin/stdout/stderr/exit 2の既存protocolを維持する。
actorはそのhook自身のPID/startを実読取し、MCP actorを継承・推測しない。Cursorは同じ1scopeだけ、複数scope/channelは未対応。
Claudeの独立claude-stop-hook（result writer）はparent receiverとは別であり、このparent-hook modeへ置換しない。
GrokのMCP登録も同mcp modeを使えるが、Grok/Cursorのnative中断primitiveが受入済みという意味ではない。

## 通常完了の関係寿命とwire互換（release候補）

停止ボタンのsentはfinishではない。通常waitUntilDone後の元request/元binding Pointを使うcompletionはruntimeで再観測する。
元処理のcompletedを観測でき、同requestのissued/unknown/slotと既知の親returnが残っていなければ、記録済み呼出の
`target_fence`をclosedとする。ここで閉じるのは元呼出の寿命であり、CLI終了・全native actor終了・中断成功の証明ではない。
既知の未完了下流がある間はconnectorをtrackingで保持し、下流完了後にretiredへ封印する。封印後の同席の別仕事では復活しない。
親return欠測/実行未確認/発行結果不明は引き続き保持。retiredには従来どおりclosedまたはunsentを必須とし、wireに新しいenumや項目を足さない。
agent_stopの即時snapshot/キー発行には保存・finish・証明待ちを加えない。
