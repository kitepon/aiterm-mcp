# 撤回済み: 共有execution記録を配送受付に使う設計

2026-10-24のOwner直接指示で撤回。以下は過去の実装記録であり、通常配送・停止・親hookへ再適用しない。

## 開発中: 連鎖停止

2026-10-21夜の指揮官訂正を優先し、停止ボタン/連鎖/全体停止は現在処理を中断してsession/launch/会話を残す。
[ADR0125](https://github.com/kitepon/aiterm-mcp/blob/main/docs/adr/0125-session-preserving-interruption.md)が現契約。
正規native入口のagent_stopは `{session_id}` / `{session_ids:[...]}` を受け、Aitermが記録する未完了呼出関係を
leaf→rootで辿り、対象ごとに通常中断キーを1回送る。Codex/ClaudeはEscape、Cursor/GrokはCtrl+C。
Ctrl+Cは既存paneのbusy時だけ、idleは送信せずidle、不明/拒否/送信失敗はfailedを返す。
結果のsentはキー送信受付でありnative終了観測ではない。会話をclose/killしない。
停止経路はgraph snapshot読取だけで、writer lock/fsync/drain/journal/全actor・native終了proofを待たず、
同sessionの次入力を永久に抑止しない。旧v2の確認controllerは停止ボタンから外した。
通常main/稼働登録への反映は別で、native hooksは同scope/providerのexecution-native-setupが生成する。

実行関係のsource/target世代、Bridgeの既存参照、未完了関係の寿命と混在先も含む停止計画は
[ADR 0124の契約案](https://github.com/kitepon/aiterm-mcp/blob/main/docs/adr/0124-cascade-stop-execution-contract.md)で設計中。
`execution-*.ts`は隔離枝のwire、snapshot計画、共有metadata、受付/停止サービスと注入可能なMCP口。
fake MCPで検証中であり、runtime証拠adapterと全変更口への接続は未了。現行公開toolの停止契約は変更していない。
native親配送は、要求時に固定したSDK metadata・検証済みsource世代・MCP/native harness identityを結ぶ。
serving producerは最初のawait前にnative decoder/session/tool/ownerを元requestへ固定し、欠測を後で補完しない。Claude ownerは同じharness PID/startで、別のMCP/hook descendantを代用しない。source入力のnative受理/turn aliasではない。
別processのhookは同じscopeと既存delivery bindingを照合し、callback欠測時に旧配送へfallbackしない。
processごとのrequired profile factoryは隔離実装中であり、static profileや稼働hookへは未接続。
scope一致やhook返却だけで全参加者の被覆・native turn alias・終了fenceを証明したことにはしない。
Claudeのproducerは実PreToolUse owner/tool/sessionと配送bindingを作用直前にも確認する隔離factoryを持つ。
既存parent returnが未解決なら局所doneのfenceを閉じず、元dispatch receiptの遅着は入力を再送せずmetadataだけを待つ。
native emit直前に照合したhook参照は既存deliveryへ保存する。CodexのStop/PostToolUse、Claudeのtool、Cursorのconversationを
受取executionの完了と同一視せず、canonical cursorを作らない。受取番の対応と終了fenceの証拠は別に必要。
POSIXのraw tty回復もnative作用であり、tmux打鍵と同じ受付を通す。ttyは正確なsession selectorで読み、
実stty直前にも同じdeviceを確認する。停止や世代/tty交代後に古いdeviceへ回復を発行しない。
一つのRPCが複数のnative作用を発行するときも、各回に同じissued slotとsource/target世代・停止を再確認する。
agentの貼付け・Enterの同期区間は、既存metadata mutexを非同期に取得してから実行する。
native作成後に再開する起動準備も同じ非同期取得を通す。pane所有検査、fg/stty回復、
起動メニューの各キーを短い同期区間で実行し、待機後の停止・世代・slot検査を省略しない。
mutexをawait中へ持ち越さず、同じ同期stack内の各gateが発行記録を永続化してからnative作用へ進む。
検証済みsourceと同世代への通常sendがissuedである間も、そのsourceの送信先が別ならoutgoing RPCは継続できる。
incomingのslotを解放・書換・成功扱いせず、unknown・管理操作・世代不一致は従来どおり拒否する。
incomingの完了待ちをoutgoingへ課して相互送信を循環待ちにしない（ADR 0127）。
BellTeamのpromptなし明示管理launchは、管理close同様にserving process/request identityへ結合する。
promptやThroughline読出しを含む未登録送信、auto-name、remoteはこの管理例外へ含めない。
BellTeamのrefなしagent_configureも同じnative process/request identityの管理RPCとして受ける。
model/effort/fastの各stageは同じ既存世代・slot・source・停止のgateを通り、途中で変われば続きの打鍵を拒否する。
発行後の途中失敗はpossible/unknownを保持する。CLI結果待ち後のfast metadata書込も同じ準備受付で再検査する（ADR 0129）。
新launchは、既存POSIX serverのnative owner、またはserver未作成の完全な空観測を受付時と発行直前に確認する。
冷間時は最初のnew-session自身でserverを作り、その実receiptのnative IDとserver PIDを、作成後の安定したnative一覧とprocess開始識別子で照合する。
既存server時も冷間時も、作成したsessionのnative ID・server owner・core内部のlaunch世代を同じ要求slotへ段階結合する。
物理shell準備はnative IDへ固定し、未結合の同名世代を採用しない。冷間起動のための補助sessionや再送は作らない。
作成時のnative ID/server ownerをmanaged metadataへ保存し、private runtimeの世代読取と期待closeでも再照合する。
古いmetadataの欠測を現観測で補わず、既存席の自動登録は行わない。
証拠の無い新server起動、Windows固有のserver作成、一般のauto-name/通常PTY等はまだunsupported。認証専用PTYはADR 0130の限定経路で受け付ける。
実18 toolsのhandlerを作るconstructorは、private dispatcher/親execution callbackを明示注入して隔離SDKで検証できる。
通常のstdio mainは注入せず、全参加process/全core作用口・native fenceが揃うまで公開有効化しない。
private participant factoryはproducer/service/dispatcher/同process用worker profileを同じscopeとnative actorで組む。
source環境の既存8名は一度だけ読み、必要な値だけを固定してproducerとdispatcherへ渡す。
呼出側のprovider/profile/runtime methodの差替えは構築済みparticipantへ混入させず、現在のscope/actorの変化は作用前に拒否する。
親managerの保存先とownerも同じscope/actorへ照合する。別processのhookはactorを流用せず、自分のworker factoryで接続する。
native runtimeの自己actorは、現在実行中のprocessのPIDと開始identityを一度だけOSで確定して保持する。
同processの生存中に開始identityは変わらないため、scope確認ごとの自己PID照会を行わない。
初回の欠測・失敗は確定値として保持せず、返すobjectも複製する。注入runtimeのactor、他process・server・
source/target世代の観測は保持せず、従来どおり各受付で再照合する。
注入runtimeへ欠けたparent依存を既定OS処理で補わず、完全なfake依存を要求する。このfactoryも通常mainには未注入。
同producer serviceの停止closeは、既存のissued close slotを持つ間だけ同期の期待世代primitiveへ渡す。
実killの直前にもruntimeの同期世代読取を通し、scope/actor/期待launchの交代を拒否する。
注入runtimeのclose欠測をcore既定処理で補わず、作用後の応答欠測は消失観測があってもunknown slotを保持する。
完了の照会点は固定し、終了fenceの非同期応答後にも現在世代を確認する。実受取番/終了fenceの証拠adapterは未了。
通常のcompletion終了確認は元request/Pointを共有lock内で固定し、native/transcript観測をlock外で行う。
反映時に同じrecord全体・issued/unknown・元slot・親作用を再照合し、途中変更があれば反映しない。
親返却のpending判定は反映時のstateで行い、元unknownの解除や送信の再実行には使わない。
実行登録も同じrequestの既存予約を短い共有lock内で確認してから、source/targetの非同期観測をlock外で行う。
登録反映時に同じ予約・取消・source/targetの受付条件を再確認し、実作用直前の同期世代gateは維持する。
launch/sendの返却結果は元issued slotを固定してlock外で世代観測し、同じslotとissued状態だけに結合する。
途中のunknown化・slot交代・観測した世代の不一致はpossibleとして保持し、元作用を再実行しない。
遅延した要求取消は本物の受付結果を消さず、共有lock内へ非同期の観測待ちを戻さない。
private producer/worker factoryを構築したprocessではnative effect scopeを必須にする。
coreの公開変更入口も、打鍵や設定・認証・lock/metadata準備に入る前に対象のrequest contextを要求する。
この入口確認はissuedへの昇格ではない。実作用時には既存の同期受付を別に通す。
通常stdio mainはprivate factoryを使わず既定挙動を維持する。別processの未登録参加者や非同期準備中の全metadata作用を
この入口だけで覆ったとはしない。全参加者inventoryと各実作用の接続を確認するまでcoverage incompleteを維持する。
deferred frameには既存requestと期待世代を再照合する同期の準備callbackを渡す。
core入口の再確認と、managed metadata/hook生成・設定model保存は同じsource/target/slot条件を使う。
準備callbackは短い共有metadata lock内で動き、execution graphはread-onlyのまま、preparingをissuedへ変えない。
native作用やawaitをcallbackへ入れず、停止・世代/actor/scope交代・RPC終了後の遅着を拒否する。
これらの明示接続以外の設定復元や親配送metadata経路はまだ未了であり、既定mainへの有効化条件を満たさない。
private factoryは同scopeの共有stateへ既存PID/開始identityと役割を宣言し、各受付の同じlock内で欠測を拒否する。
遅延登録する参加者の最初の非同期要求は、既存の上限付きmetadata受付内で宣言を保存してから進む。
待機後にもscope/actorを照合し、read-only要求でも宣言だけは独立して保存する。
同期入口の即時拒否、登録削除後の拒否、停止snapshotの登録不要条件は変えず、入力や要求を再送しない。
MCP/parent-effectの既存参照とnative identityを読むinventoryはread-onlyで、役割やenvから世代・終了を補完しない。
開始identity交代や未登録actorを示しても旧slotを消さず、parent受付だけで参照を退役させない。
全行のidentity一致でも参加者の全発見/native終了fence/全経路の接続を証明せず、coverage incompleteを維持する。
作用後のmetadata受付欠測では成功receiptとpossibleを保ち、issued slotを再構築や消失観測で再実行可能へ変えない。


## 旧README記載

### README.md

In the opt-in POSIX native execution entry, an ordinary message arriving at a verified caller can overlap that caller's outgoing send. It does not replace the caller's generation or clear either request's slot. A newly connected participant also waits within the existing bounded metadata admission to commit its declared roles before its first asynchronous request; that wait never replays input. Agent paste/submit segments wait for metadata mutex contention before input; uncertain operations, generation changes and stops still prevent input. BellTeam may explicitly recreate a closed session with a promptless management `agent_launch`; sending a prompt still requires its original execution reference.

### README.md

An explicit `agent_execution` action `reconcile_launch` can bind an existing empty launch after a lost launch result in this opt-in entry. Supply the original `request` and exact `target: {session_id, launch_id}`. The server checks the original native/server identity, current managed generation, raw no-prompt state and a live ready harness under metadata admission, then releases only that unknown launch slot. Repeating an accepted empty launch before its send also rechecks the current generation, readiness and absence of competing session operations; a saved acceptance alone cannot confirm a later generation. It never launches, types, closes or resends. `issued` RPCs, unknown input and changed or unverified generations remain blocked. Any subsequent body uses the original reference through normal send admission once; a successful reconciliation does not prove the lost RPC receipt.

### README.md

For an empty unknown launch whose harness has exited, the BellTeam native entry accepts `agent_execution({action: "close_launch", request, target: {session_id, launch_id}})`. The original request and generation are atomic expectations, checked within admission and immediately before the native close. Raw initial prompt must be `none`, initial delivery absent, send unissued, and the original native/server and managed identity must match. The private runtime proof covers Claude Code and Codex; live, issued, sent, missing or replaced targets remain refused. No session-only close fallback or automatic relaunch/send occurs. Older servers reject this action.

### README.md

Success retains the original unknown record and returns the serving SDK's distinct management execution record in `structuredContent`. `_meta["aiterm/closed_launch"]` is a strict receipt with `schema: "aiterm.closed-launch.v1"`, `version: 1`, `action: "close_launch"`, `outcome: "closed"`, the original `request`, exact `target`, and `management_ref` (the serving MCP request, `tool: "pty_close"`). Its `evidence` contains original `native` binding, `initial_prompt: "none"`, `initial_prompt_delivery: null`, `harness_alive: false`, `absence_confirmed: true`, and `metadata_committed: true`. Only confirmed close, absence and committed slot release produce this receipt. Errors or lost/uncertain results do not. Hosts must match the original pending operation and local stop/version state before clearing its uncertainty; historical receipts cannot clear later uncertainty.

### README.md

For a returned unknown launch whose harness has exited, the same native entry admits explicit `pty_close` only after synchronous proof of the original native/server and managed generation, raw no-initial-prompt state, an unissued body send and an exited harness. It releases the failed launch slot after successful close and confirmed absence, preserving the original unknown record. Issued RPCs, live harnesses and missing input or generation evidence remain blocked. The old request is never replayed; a later ordinary request may create a fresh generation.

### README.md

BellTeam model, effort and fast changes use a native management request bound to the existing session generation. Later stages stop if that generation, its admission slot or stop state changes. A partial change remains an uncertain effect and must not be blindly repeated.

### README.md

In the opt-in POSIX native entry, `agent_auth` also supports omitted session names, authenticated no-op starts and the normal v1 status/onboarding/cancel receipts. Authentication PTYs are bound to their actual native creator and generation. Ref-less BellTeam input or keys are allowed only for those proven authentication PTYs; ordinary agent messages still require their delivery reference. Legacy authentication metadata without creator proof is not automatically enrolled.

### README.ja.md

POSIXの明示native入口でも、`agent_auth`の名前なし開始、認証済みで何も起こさない開始、既存v1の確認・初回案内・取消を受け付ける。認証PTYは実際の作成元nativeと世代へ結合する。BellTeamの参照なし入力・キーは、この証拠がある認証PTYにだけ許可し、通常agentの本文には配送参照を引き続き必要とする。作成証拠のない旧認証metadataを自動登録しない。

### README.ja.md

この明示入口では `agent_execution` の `reconcile_launch` に元の `request` と正確な `target: {session_id, launch_id}` を渡し、結果不明の空起動を既存世代へ結合できる。保存したnative/serverと現在のmanaged世代、raw状態で初期promptなし、生存して入力待ちのharnessをmetadata受付内で照合し、該当するunknown launch枠だけを解放する。受付済みでも本文未発行なら、照合を繰り返すたびに現在世代・入力待ち・競合操作なしを再確認する。保存した受付結果だけで後の世代を確認済みとしない。起動・打鍵・close・本文再送は行わない。issuedのRPC、入力状態不明、世代交代や世代未確認は拒否する。後続本文は元参照で通常のsend受付を通して一度だけ発行する。照合成功は失われた元RPC receiptの回収を意味しない。

### README.ja.md

CLIが終了した結果不明の空起動には、BellTeam native入口の `agent_execution({action: "close_launch", request, target: {session_id, launch_id}})` を明示的に使う。元requestと期待世代を受付内とnative close直前で照合し、原native/server・managed世代一致、raw初期prompt `none`・初期配送なし・send未発行・現在CLI終了の正規probeがすべて必要になる。Claude CodeとCodexで同じ証明条件を使う。生存・issued・送信済み・欠測・世代交代は拒否し、sessionだけのcloseへの代用や自動再起動・再送はしない。旧版は新actionを拒否する。

### README.ja.md

成功時の `structuredContent` は応答するSDKの別管理requestのExecutionRecordで、元unknown recordは変えない。`_meta["aiterm/closed_launch"]` に厳密なreceiptを返す。固定項目は `schema: "aiterm.closed-launch.v1"`、`version: 1`、`action: "close_launch"`、`outcome: "closed"`、元 `request`、正確な `target`、`management_ref`（応答SDKのMCP request、`tool: "pty_close"`）。`evidence` は原 `native` binding、`initial_prompt: "none"`、`initial_prompt_delivery: null`、`harness_alive: false`、`absence_confirmed: true`、`metadata_committed: true` を持つ。実close・不在確認・slot解放commitが揃った場合だけ返し、失敗や結果不明には返さない。本体が不明を解除する際は元pending操作と自身のstop/versionも照合する。過去receiptで後発の不明を解除しない。

### README.ja.md

同じ明示入口で、返却済みunknown launchのCLIが終了している場合は、元native/server・managed世代とraw初期promptなし・本文未発行・harness終了を同期検証できた時だけ通常の`pty_close`で対象席を閉じられる。成功と不在を確認して該当枠だけを外し、元unknown requestを保持する。発行中RPC、生存harness、入力や世代の欠測は拒否する。旧requestを再実行せず、必要な後続は新しい通常要求として行う。

### README.ja.md

POSIXの明示native実行構成では、検証済みcallerへ通常メッセージが届く間も、そのcallerから別席への送信を継続できる。callerの世代や各requestのslotは書き換えない。新しく接続した参加者も、初回の非同期要求で宣言済みの役割を保存する際は、既存の上限付きmetadata受付で競合を待つ。この待機は入力を再送しない。agentの貼付け・Enterはmetadata mutexの競合を入力前に待ち、不明な操作・世代交代・停止では入力を止める。BellTeamは閉じた席をpromptなしの明示管理`agent_launch`で再作成できる。promptを送る呼出しには元の実行参照が必要である。


## 旧復旧契約

実行ラッパーの要求参照の検証とMCP receipt整形は`execution-tools.ts`、native作用の進行は
`execution-invocation.ts`が所有する。実行・保存の判断は既存`ExecutionService`へ委ねる。
receiptの観測は、通常経路ではbody返却直後、deferred経路ではnative frameの正常返却後に行う。
その後の結合失敗でも観測済みreceiptを保持し、frame内のnative拒否を成功へ変換しない。
native一覧は終了コード1・空stdout・単独の`server exited unexpectedly`だけを20ms間隔、最長500msで再観測する。
再観測は呼出元の同じissued枠と世代検査の中で行う。不在の証拠は既存の同socket・終了コード1・空stdoutの
厳密な診断に限定し、正常一覧は従来のnative/server識別検査を通す。上限・別error・曖昧な一覧はunknownを保つ。
close・送信・その他native作用は再実行しない（ADR 0133）。
POSIXの明示native execution構成では、返却済みsendのunknown枠が対象席の管理closeまで
永久に拒否しないよう、通常`pty_close`だけを同じ期待launch/native IDで受付できる。
unknown send枠を保持したまま既存core closeへ進み、native close成功と席の不在を確認した後だけ
該当send枠を解放する。元recordのphase/completion/sendはunknownのまま残し、再送や成功化をしない。
旧callbackは未知/消失した元slotで拒否され、同IDの新launchへnative作用を発行できない。
issued、管理close自体のunknown、親作用のslot、世代/native/serverの不明・交代は対象外。
既存の送信・待機lockの拒否も維持し、他席やissuerの停止を復旧条件へ追加しない。
返却済みunknown launchも、元native/server・managed世代が一致し、raw initial_prompt:none・初期配送なし・
send:not_issuedで、harnessの終了を現在の同期primitiveが証明できる場合だけ、同じ明示管理closeを許す（ADR 0131）。
受付時とnative作用直前にこの証拠を検査し、closeと不在確認後に該当slotを外す。元unknown recordを保ち、
旧requestのlaunch/sendは再実行しない。生存harnessはreconcile_launchの対象として維持する。
本体からの明示復旧には既存agent_executionのclose_launch actionを使う（ADR 0132）。元requestと
target(session_id,launch_id)を原子的な期待条件として受付と作用直前に照合し、応答SDK自身の管理refで
既存close primitiveへ進む。呼出元がobserveしたsessionだけをcloseする手順で代用しない。
close・不在確認・metadata commit後だけ_meta["aiterm/closed_launch"]のversion1 receiptを返す。
structuredContentは別管理requestのrecord、元unknown recordは不変。結果不明や保存失敗にはclosed証明なし。
本体は元pending操作・stop/versionを別途照合し、後発不明を過去receiptで解除しない。
非同期launcherはCLIの検証をgraph mutex外で行い、実create→metadata公開→世代結合→CLI入力の同期区間を
一度のnative admission内で通す。起動準備のawaitをmutex内に持ち込まず、待機後には通常の世代・停止・slot検査を行う。
空起動の結果不明は明示 `agent_execution/reconcile_launch` で既存世代へ結合できる（ADR 0128）。
対象は返却済みunknown launch、send:not_issued、元native/server stamp付きの単独slotだけ。
同じmetadata transaction内のprivate同期primitiveで現在のnative/managed世代、生のinitial_prompt:none・初期配送なし、
harness生存とidleを照合する。既存recordのlaunchをaccepted、targetを当該世代へ結合し、該当slotだけを外す。
これは現在世代の明示採用で、失われたRPC receiptの復元ではない。本文・初期prompt・claim・nativeには作用しない。
同じaccepted targetへの再照合もsend:not_issuedなら現在のmanaged世代・生の未入力状態・入力待ちを再確認し、
同じsessionへの競合slotや親の未確定作用があれば拒否する。保存済みacceptedを後の世代の不明解除の証拠にしない。
issued、入力済み・不明、停止、別slot、世代/native/serverの不一致は拒否。後続sendは元source世代を含め通常受付を通る。
遅着した元callbackはまだ所有するissued stage/slotがある時だけunknownを書け、照合後や別stageを上書きしない。
native handlerのisErrorは元の本文を保持し、`aiterm/execution_error`のcode/effectを併記する。
native作用後の不明はpossibleのままで、原因説明を再送可否や成功receiptへ変換しない。
