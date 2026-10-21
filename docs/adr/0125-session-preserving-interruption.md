# 0125. 停止は現在処理を中断し、会話を残す

状態: 指揮官確定指示（2026-10-21、Trony経由）。実adapter/稼働受入は未了。

「処理だけ中断して、会話セッションは残す」「Escで止めるようなやり方」が現条件。
0124のclose/CLI終了を停止ボタン・連鎖・全体停止へ用いる前提は失効した。
AIへの停止依頼や意味判断を使わず、効かなくてもclose/killへ自動昇格しない。
通常の明示的な管理用closeは残すが、中断の受入には数えない。

## 最小wire

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
