# 0124. 未完了の実呼出を辿る連鎖停止・Bridge接続案

**2026-10-21夜の指揮官訂正: 停止ボタン/連鎖/全体停止のclose/CLI終了方式は失効。**
現契約は[0125](0125-session-preserving-interruption.md)。現在処理を中断しsession/launch/会話を残す。
以下の閉鎖結果・launch消失によるfinish・closeのfake受入は、新中断へ流用しない。
旧破壊的primitiveは明示的なcloseCascadeへ分け、agent_stopから呼ばない。実呼出関係/寿命/欠測の原則は維持する。

状態: Proposed（2026-10-21、指揮官の混在停止確定指示と寿命相談を反映）。
初稿fd5d59fの「混在/共有先は除外」「source元依頼の意味帰属/入力集合completeを必須」は失効。
指揮官の確定指示は、混在を判定せず、対象へ到達した実行は他仕事があっても停止すること。
その後の「昔に呼んだ先まで止めると最後は全員」という相談に対し、本稿は未完了関係の寿命で範囲を絞る案。
経過時間の閾値や欠測の切捨ては未裁定であり、本稿から既定値を作らない。

`src/execution-*.ts`にローカルwire v1、共有metadata、発行済み操作/停止fence、終了証拠の再観測を要求する
サービスと注入可能なMCP登録口を実装。fakeで接続検証する段階で、現行`index.ts`の18 toolsには未登録。
実runtimeのsource/終了解釈adapter、全変更口の共通受付、期待世代の閉鎖実装、復旧の受入はまだ残る。

## 所有境界

Aitermは実行世代/境界の照合、関係の記録/寿命、停止計画、受付競合、期待launchの閉鎖/観測と対象別結果を持つ。
BellTeamはBridge参照adapter、配送/起動/予定の受付抑止、単体API、全体ON/OFF、配送整理を持つ。
UIはベル。BellTeam本体が停止処理を呼ぶため、root席の終了でexecutorは消えない。
新ID体系、永続配送queue、本文保存、自動再送は足さない。開発承認済み。
公開配布/本番反映の既存個別条件は維持。実席停止/本番試験/既存作業終了は今回行わない。

## 二つの照合を区別する

**実際に呼んだ関係の採用:** source/targetのlaunch世代と実際のlaunch/sendを照合すれば採用する。
元の仕事の意味、独立/共有の分類、入力集合の完全性、単独active jobは採用条件にしない。
同一turnへ複数入力が混ざっても、実際に発行したcall edgeはすべて保持し、到達先を止める。
`shared_busy`という結果/除外は廃止する。独立した別の呼出元へ逆向きには辿らない。

**古い関係を終了する照合:** 対応する実行境界の終了と、その境界から呼んだ下流の終了を機械的に照合する。
ここで必要なのはruntimeのturn/dispatchの区切りであって、どの意味の仕事に帰属するかの推測ではない。
境界が欠けても確認済み世代の実呼出関係は採用する。寿命の欠測を報告し、記録済み関係ごとunknownへ捨てない。

Bot名/lineageだけでは世代は分からない。`X-Bellteam-Seat`だけを現在launchへ昇格させない。
launchヘッダーは既存runtime環境値の輸送であり、tool引数からverifiedを指定する口ではない。

## 最小参照

```ts
type LaunchRef = { session_id: string; launch_id: string }; // 既存32hex
type Boundary = {
  event_cursor: number;
  operation_id: string | null; // 既存sha256、通常Claudeのみ
  turn_id: string | null;     // native記録で確定したとき
  steer_id: string | null;    // 既存steer参照
};
type Point = { launch: LaunchRef; boundary: Boundary | null };
type RequestRef =
  | { kind: "delivery"; delivery_id: string; target_session_id: string }
  | { kind: "room"; message_id: string; target_session_id: string }
  | { kind: "call"; call_session_id: string; event: "session.message" | "session.reply";
      seq: number; target_session_id: string }
  | { kind: "aiterm"; launch: LaunchRef; boundary: Boundary };
type SourceClaim = { launch: LaunchRef | null; boundary: Boundary | null };
```

state/socket scopeは呼び出したローカルAitermへ束縛する。同名remoteは別scope。
roomは実fan-outのtargetごとに登録する。返信者以外への通知も実行を呼ぶなら対象。
callの既存seqが無くても既存delivery_idがあればdelivery参照でよい。groupIdが同じ既存IDなら増やさない。
Boundaryはadapterが同じ実行を指す不変な既存参照へ正規化する。後で分かったnative turnはaliasとして結ぶ。
steerが同じturnを取ったことを確認できれば同じ実行境界、next_turnなら次の境界。
単にcursorが近い、時刻が近いという理由で同一視しない。未確定ならboundary=nullを保持する。

## Bridgeが渡す情報・取得時点・不足

| 必要な物 | 現行にある物/不足 | いつ結ぶか |
| --- | --- | --- |
| 呼出元席/世代 | Bot IDはある。HTTPにsource launchはない | MCP要求受信時のruntime環境から固定。queueの後で現在値に置換しない |
| source実行境界 | native turn/dispatchの呼出コンテキストが共通には無い | 実tool呼出の受付前に取れる既存境界を固定。無いならnull。元依頼の意味は不要 |
| 実際の配送参照 | delivery_id、room message_id、callイベント/seqまたはdelivery_id | queue/launch/send前にreservation。実fan-outごと |
| 実target世代 | launch/send receiptのsession_id/launch_id | launch受理直後に結び、send直前に再照合 |
| target実行境界 | dispatch event_cursor/operation、追跡可能なsteer参照 | Aitermの実before_sendとreceiptから結ぶ。後から近いjobへ当てはめない |
| 終了証拠 | 対応waitのdoneとnative turn/operation、既存job状態 | 通知受付でなく実行終了時。同じ参照/世代/境界に対応させる |
| source受付fence | 現行Bridgeの世代情報/未決登録drainには追加が必要 | terminalを受けても発行済み関係の確定前には退役しない |

最小Bridge追加はruntime固定の`AITERM_AGENT_LAUNCH_ID`輸送、既存IDでの登録、target receipt対応、
対応する完了/未送信/中断の報告。環境ヘッダー等は各harness設定とBridge受信の両側で整合させる必要がある。
Aitermは呼出元runtimeと期待launchを検証するadapterを持つ。任意tool引数のID文字列だけで検証済みにしない。
source native turnが取れないことを、世代まで取れた実配送の不採用条件にしない。

現0.60.1の`seat_turns`はCodexのみ。他harnessや旧版でnullを返すことがあり、全経路の現在境界が取れるとは未確認。
`lineage`は親名だけで親launch/turnを持たず、全Bridge関係の代用にはならない。

## 登録と寿命

隔離実装の入口は`agent_execution` register/status/finishと`agent_stop`、読取専用の`agent_execution_roots`。
稼働版のtools/listへはまだ追加していない。
既存RequestRefで冪等照合し、同じ参照でsource/targetを変える再登録はconflict。送信は再発行しない。

```ts
// register。未知のtarget launchは未起動時だけnull。
{ schema: "aiterm.execution-reservation.v1", request: RequestRef,
  source: SourceClaim, target: { session_id: string; expected_launch_id: string | null } }
```

1. queue/launch/sendより前にreservationを登録する。これは実呼出済みedgeではない。
   停止は未発行分を拒否/未送信確定し、起動済みの空席があるなら実launchを関係に含める。
2. 実launch/sendの発行前に、同じ登録を要求_metaの`aiterm/execution`へ結ぶ案。
   Aitermがsource/target世代とstoppingを同じ受付排他で確認する。
   通った実呼出を`invoked`、発行結果不明は`submitted_unknown`で記録する。
   既存receiptのtarget launch/event_cursor/operation/steer参照を同じRequestRefへ結ぶ。
3. `running/steered`、通知受理、配送UIの`delivered`だけでは実行完了にしない。
   対応wait/native終了を確認したときだけ、当該target境界の`completed`を確定する。
   明示的な未送信は`unsent`。実行中断は当該境界か、期待launch全体の閉鎖確認で`interrupted`。
   waiterをabortしただけ、RPC reject/timeout、rate_limitedだけは終了解釈に使わない。
4. **局所完了とedge退役を分ける。** A→Bが完了しても、そのB境界のB→Cが未完了ならA→Bを接続として残す。
   source/target境界が確認できるときは同じruntime実行だけを結ぶ。別のB turnからの新しい呼出で古いA→Bを復活させない。
   境界欠測がある既知世代の下流候補は、元の記録済み接続を保守的に保持して欠測を出す。
   source世代さえ欠けた下流は推測で新しいedgeにせず、同定不足として残す。
5. 実行終了、発行済み関係の応答確定、下流の全終了を確認したbranchを`retired`へ封印する。
   terminal通知より前に発行した呼出の遅着があり得るので、終わった瞬間に接続を消さない。
   同一source境界の受付fenceを閉じ、発行済み登録/変更をdrainしてから退役する。
   遅着した旧境界の呼出は新しいcurrent境界へ繋ぎ替えず、旧登録の確定/拒否/未確認として処理する。
6. 全部terminalの循環は互いを未完了として保持しない。未完了から逆向きに必要な接続を求める最小固定点とし、
   未完了の出口が無いterminal成分はまとめて退役できる。実停止の巡回はlaunchの訪問済み集合で重複を防ぐ。
   退役済みIDは必要最小のtombstoneで遅着/重複を拒否し、実行graphからは外す。全履歴本文や無期限Bot名graphを作らない。

純粋fixtureの`planCascadeStop`は、runtimeが証拠照合したsnapshotを入力にした計画だけである。
サービスは`completion`と`target_fence`を分け、doneでも発行済み呼出の締切/応答確定が未確認なら接続を保持する。
`finish`は外部claimをそのまま信じず、注入されたruntime adapterへ対応境界の再観測を要求する。
実際の4 CLIに対するfence証拠の取得は未了。source境界nullはedge採用可、寿命のfenceをclosedと捏造する理由にはしない。

## ローカルwire v1（実装固定、隔離接続用）

正本schemaは`execution-wire.ts`の`EXECUTION_TOOL_CONTRACT`。MCPへ載せる関数は`registerExecutionTools`、
fake/Bridge直接接続に使えるhandlerは`createExecutionToolHandlers`。実サービスは`ExecutionService`。
runtimeをfakeに置き換えた同一handlerでMCP初期化→tools/list→register/status/finish/stopまで検証する。
schema文字列は要求/結果の既存v1を使う。本段階でこのwireは固定するが、稼働版にtoolが追加された意味ではない。

```ts
// tool: agent_execution
{ action: "register", source_session_id: string | null,
  reservation: { schema: "aiterm.execution-reservation.v1", request: RequestRef,
    source: SourceClaim, target: { session_id: string; expected_launch_id: string | null } } }
{ action: "status", request: RequestRef }
{ action: "finish", request: RequestRef,
  evidence: { kind: "not_sent" }
    | { kind: "completion"; target: Point }
    | { kind: "interrupted"; target: LaunchRef } }
```

registerのsource_session_idはHTTP受信時の席のhint。既知source.launchがあれば同じsessionに限る。
unknown sourceをBot名で現在launchへ昇格させない。停止中/変更結果不明の同名sourceの呼出も、世代未確認のまま通さない。
target expected_launch_id=nullは新規起動前だけ。既存席にnullを渡すと世代不一致。
statusは既存RequestRefだけで引ける。同じregisterは同じ記録、内容を変えた同じ参照はconflictで送信しない。

launch/sendの要求_metaと返却_metaはキーを分ける。既存steer/interim等の_metaを上書きしない。

```ts
// agent_launch / pty_send の要求_meta（同じreservationの既存参照）
_meta["aiterm/execution"] = { schema: "aiterm.execution-ref.v1", request: RequestRef };
// 成功/照会の結果_meta
_meta["aiterm/execution_binding"] = {
  schema: "aiterm.execution-binding.v1", request: RequestRef,
  source: { status: "verified" | "unknown" | "stale", reason: string,
    point: Point | null, boundary_status: "matched" | "missing" | "mismatch" },
  target: Point | null, phase: "reserved" | "invoked" | "submitted_unknown" | "unsent"
};
```

成功structuredContentは`aiterm.execution-record.v1`。reservation、source_session_id、source照合結果、
relation（source/target、phase、completion、target_fence、lifecycle）、operations、stoppingを返す。
operationsはlaunch/send別にnot_issued/issued/accepted/not_sent/unknown。本文/画像/path/再送payloadは含めない。
初手promptを実行したlaunchは同じ参照のsendもacceptedとする。空launchだけが後続pty_sendへ進める。
同じ参照のsendを二度呼んで実際に再送することはない。状態照会が新しい起動/送信へ化けることもない。

finish completionはbindingのPointを渡す。サーバーが同じ保存境界から再観測し、
done/当該中断と、その実行の発行済み関係fenceを別に記録する。
not_sentでも既に空launchが成功していれば、その実launch edgeは消さず保持する。
interruptedは期待launchの消失と未決変更が無いことを再観測する。RPC reject後の単なる消失はこれに当たらない。
確定済みの同じ終了証拠は冪等。doneでもtarget_fence=unknownならlifecycle=trackingであり退役完了ではない。

### 席absent・job消失後のroot世代読取

```ts
// tool: agent_execution_roots （新規登録/停止をしない）
{ session_id: string }
// structuredContent
{ schema: "aiterm.execution-roots.v1", session_id: string,
  observation: "present" | "absent" | "unknown", current: LaunchRef | null,
  roots: LaunchRef[], relation_coverage: "complete" | "incomplete",
  unresolved: { request: RequestRef | null; reason: string }[] }
```

同じAiterm state scopeの共有metadataと現在観測を短い同じ排他内で読み、metadataは書き換えない。
rootsは、現在観測で確定したlaunchに加え、未完了branchに保存された同席のsource/実target、
未送信reservationの確認済み期待target、発行済み/結果不明slotの期待世代だけ。
局所完了でも未完了下流を持つ接続は含む。完了/退役済み履歴から最新一件を選ばない。
source_session_id hintだけでlaunchを生成せず、別席のincoming親をrootへ混ぜない。
同席に未完了の旧世代と現在世代があれば、両方を既存参照で明示する。

jobやBridge本体が失われてもAitermの記録が残っていれば、このrootsをagent_stopの期待rootsへ渡せる。
queryとstopは別要求なのでsnapshotであり、query自体は受付fenceではない。
世代交代はagent_stop側でも再照合し、query時の旧世代を同名新launchへ繋ぎ替えない。
rootsが空でもcoverage不足、世代/現在観測不明、発行済みslot不明なら未確認を返す。
空配列だけから「未記録の子孫まで停止済み」と判断しない。状態破損/放棄lockは型付き拒否で、空の成功結果へ変えない。
BridgeはBot IDから世代を推測せず、この読取結果または保持済みbindingの期待世代を使う。

### 型付きエラーとreceiptを失わない返り

```ts
_meta["aiterm/execution_error"] = {
  schema: "aiterm.execution-error.v1", code: ExecutionErrorCode,
  effect: "not_started" | "possible", follow_up: "none" | "status_only"
};
```

| code | 意味 |
| --- | --- |
| EXECUTION_INVALID | wire/参照形式不正 |
| EXECUTION_NOT_FOUND | 既存参照の登録無し |
| EXECUTION_CONFLICT | 同じ参照の内容変更、再発行、終了境界不一致 |
| EXECUTION_STOPPING | 確定した停止fenceを越える未発行呼出 |
| EXECUTION_STALE_GENERATION | 期待source/target世代の不一致 |
| EXECUTION_UNCONFIRMED | 発行/結果/境界/存在の確定不足、slot保留 |
| EXECUTION_BUSY | 共有metadata transaction lockを取得できない |
| EXECUTION_STATE_UNAVAILABLE | metadata破損/保存/読取り等の確定不足 |
| EXECUTION_UNSUPPORTED | adapterまたはscope未対応 |

tool handler内の拒否はisError=true、本文はcode、上記_metaを返す。MCP自身のschema/transport拒否は既存MCP契約。
effectは当該経路に作用が無いと確認できた場合だけnot_started。発行済み/結果不明をpossibleから下げない。
follow_up=status_onlyは既存参照の照会だけで、自動retry許可ではない。通信rejectをtoolの明示拒否へ変換しない。
未知例外の本文/pathをwireへ出さない。

**作用成功後の関係結合失敗:** `runBoundExecution`は成功した元のstructured receiptと既存_metaを保持し、
execution_error（possible）を追加する。元が成功ならそれをisErrorへ変えて捨てさせない。
Bridgeは受理済みturnの完了観測を続けつつ関係を未確認として扱い、同じsendを再実行しない。
statusでoperations=unknownが残り、観測上消失しても同名slotを新launch/send/configureへ解禁しない。

### 共有state・停止サービスの実装範囲

`FileExecutionStore`はAiterm state scope内に注入するdirectoryのmetadataだけを所有する。
短いmkdir lockと原子的置換で、既存参照のrecords、期待launchのstopping、発行済み/結果不明slotsを共有する。
作用前にissuedを保存、作用はtransaction外で一回だけ実行、返りを同じ参照へ結合する。
作用中はstate lockを握らず、別MCP実体からの停止受付/照会ができる。
再構築したserviceでもunknown slotは消えない。time-based lock奪取や破損時の空graph再作成はしない。
放棄lockの診断/安全な復旧、state lifecycleの運用受入は未了で、本番導入条件に残る。

`stop`はroot/到達先をfenceしてからidleを待たず発行済み操作だけbounded drainし、期待launchごとにclose一回と後観測を要求する。
未発行reservationはunsentにする。drainが時間切れなら未確認を返し、遅れてboundしたtargetにもstoppingを立てる。
`changeSession`は既存close/configureの発行/結果不明を同じslotへ結ぶadapter。restartはcloseと新launchを別受付にする。
close/configure中のsourceからの新規呼出も、未確認のまま先へ通さない。
runtime.closeは同じ受付規律の中で期待launchを再照合して作用する必要があり、単なる名前だけのcloseへ置き換えない。
runtime.coverageは全実入口が対応している場合だけcomplete。graphが空という理由でcompleteを返してはならない。

現行index/coreへの接続は未了。4 CLIの世代ヘッダー実受信、source/finishの証拠adapter、直接launch/sendと全変更口の
共通受付・scope対応を受入するまでは、稼働版の完全連鎖停止として使えない。

### 既存observe/waitの証拠adapter

`execution-runtime.ts`の`createExecutionRuntime`は、既存`pty_observe`/`observeAgentDone`の構造化契約を検証する。
schema、session、launchを照合し、不整合や取得例外をunknownへ残す。exists=falseなのにlaunchを持つ返りも消失証拠にしない。
保存境界のcursor/operation/steerをそのままtimeout=0で再観測し、native turn/operationが既知ならその一致も必要。
steerのplacementがunknown/取得不能、rate_limited、timeout/running/not_taken、generic tool/RPC errorは完了にしない。
coreの型付きoutcome=errorはharnessが記録したturn終了解釈であり、generic RPC errorとは分けて局所終了にできる。
typed closedでも後観測の期待席消失を要求する。終了の読み取り中に同名launchが替わればunknown。

sourceはruntime/Bridge transport側のsourceContext resolverを明示注入する。wire claimや最新jobをそのまま証拠にしない。
resolverが無ければcaller proof無し。source境界nullでもtransportのlaunchと現在世代を照合できれば採用できる。
明示したsource世代が既にabsent/置換なら新規登録をstaleで拒否し、単なるunknown sourceに格下げして実行しない。
明示source世代のcaller proofが足りない登録は保持できるが、未検証のままinvokeしない。
旧資料等のgeneration無し関係を、これで新たに検証済みに昇格させることもない。

終了fence証拠resolverが無ければunknown、coverage resolverが無ければincomplete。
guardedCloseが無ければEXECUTION_UNSUPPORTEDで作用前に拒否し、名前だけのcloseへのfallbackは無い。
evidence resolverはserviceの短いtransaction内で呼ぶので同じstoreへ再入しない。
guardedCloseはtransaction外で呼び、既に発行したslotを使って期待世代を実作用時にも守る必要がある。
既存core関数へのmount/共通受付、runtime/transport resolverと実fence証拠は依然として残実装。

### stdio呼出元の既存環境名

`executionSourceFromEnvironment`は、CLI起動時の`AITERM_SESSION_ID`、その既存別名
`AITERM_AGENT_SESSION_ID`、`AITERM_AGENT_LAUNCH_ID`をtransport起動時にsnapshotする。
席IDは片方でもよいが、両方があれば一致が必要。欠落、不正値、未展開の変数参照、別名不一致はnull。
Bot IDやlineage、最新jobから補わない。native turn/tool境界はnullを維持し、
採用には既存observeによる現在世代の照合が別途必要。環境値はローカルtransportの相関であり、
敵対的な同一利用者や任意のHTTP clientを認証する仕組みではない。

Codex/Cursorのstdio MCP継承へ上記3名と`AITERM_STATE_BASE`を追加する。
識別子はsupervisorに無い場合もCLI起動時に付くため、supervisorの環境の有無で除外しない。
`TMPDIR`、`XDG_RUNTIME_DIR`、Windowsの`TEMP`/`TMP`は存在する値を保持する。
これらはstate/socket選択でありsource証拠ではない。未定義を空文字や未展開の`${env:...}`に置換しない。
Cursorの任意値は生成元だけの有無判定でCLI固有の値を落とさないよう扱いを分ける。
scopeの同一性が未検証ならcoverageをcompleteにしない。

`createExecutionRuntime({sourceEnvironment, ...})`は明示したstdio環境を構築時に一度だけ読み、
各register時にはそのsnapshotと現在世代を照合する。後から環境を書き換えても呼出元を差し替えない。
Bridgeのtrusted transport resolverは`sourceContext`を別途注入し、envだけでHTTP sourceを検証した扱いにしない。
coreの端末作成は`sessionCallerEnvironment`で名札を除く呼出元環境を端末ごとに渡すため、
存在するTMPDIR等を起動経路が既に保持する。CLIからstdio MCPへの継承設定はそれとは別途必要。

### process間で共有する保存範囲と隔離検証

`executionStoreDirectory`へ既存stateRootと実際のmultiplexer識別を明示する。
POSIXはsocket path、Windowsは既存のWIN_NSを渡す想定。kindと識別から安定した保存directoryを選び、
同じstateRootに別socketの同名席があっても関係/停止印/slotを混ぜない。これは保存範囲のhashであり、
新しい仕事IDや配送IDではない。import時に保存先を選んだりlive stateへfallbackしたりしない。
実mount側での値の供給は未実装。

隔離した2つのNode processへ同じFileExecutionStoreを渡し、停止印の共有、発行済み送信のdrainと
遅れて結び付いたtargetの一度だけのclose、発行後のprocess消失を再構築後も未確認として保持すること、
別processのconfigure発行中/応答欠測後の受付抑止を確認した。runtimeは合成file/IPCのみでcoreをimportせず、
PTY/実CLI/実席は操作しない。これは実MCP mountや本番復旧の受入を代替しない。

## rootの現在境界と到達範囲

### Bridgeのhost source context

registerの引数は変更せず、HTTP ingressで固定したsourceをhost用要求_metaへ別途渡す。

```ts
_meta["aiterm/execution_source"] = {
  schema: "aiterm.execution-source.v1", source: Point | null
}
```

Bridgeは本文のclaimから補完せず、固定contextを発行前にcloneする。未指定は明示null。
`executionHostSourceFromMeta(meta, initializedClientName)`は既存client名`bellteam`についてのみこのhost相関を読む。
他CLIは起動時のstdio envを用い、このmetaで差し替えできない。client名はtool引数から取らず、
initialize済みtransportから得る。これは同一OS利用者や任意clientに対する暗号認証ではない。

`registerExecutionTools(server, service, {sourceContext: extra =>
executionHostSourceFromMeta(extra._meta, server.server.getClientVersion()?.name)})`でhost adapterを明示する。
設定無しのhandlerはhost source metaをUNSUPPORTEDで拒否する。host context欠落/nullは明示unknownで、
stdio env、register claim、最新jobへfallbackしない。handlerは要求ごとにcontextをdetachし、
service.executeとruntime.sourceEvidenceへ内部引数で渡す。共有global context/要求間の書換えは使わない。
claim・source_session_id・context・実runtime現在launchが一致して初めて世代を採用する。
native境界はnullでも記録済み実呼出edgeを採用でき、寿命fenceの欠測とは分ける。

既存`readSeatTurns`はCodexのnative active turnを読めるが、そのevent_cursorはtask_started行の位置。
dispatch receiptのbefore_send位置と同じとは限らない。native turnのaliasを元receiptへ照合するadapter無しに、
これを同じcanonical boundaryと扱わない。遅れたBridge登録へ現在turnを当てる補完もしない。
現段階はsource境界nullを維持し、必要なalias/fence証拠が無ければbranch寿命を未確認に残す。

### 共通受付へ渡す実引数と実閉鎖adapter

実作用を持つhandler用に`runDeferredBoundExecution(service, meta, stage, actualTargetSessionId, body)`を追加した。
`invokeDeferred`は、同じ既存RequestRefを`operations.launch/send=preparing`として保存してからpreflightを開始する。
この間のrelation phaseはreservedで、target slotはまだ発行しない。重複呼出はpreparingの持ち主を上書きしない。
停止は準備中の予約を取り消して進み、idle待ちや前提照会の終了を待たない。
旧callbackが後から戻っても最初のnative effectで拒否する。

`FileExecutionStore.transactionSync`は同じmetadata lockへ待ち無しで入る。
asyncの持ち主が居ればBUSYを作用前に返すため、同じNodeのevent loopを止めてlock解放を待たない。
`ExecutionRuntime.observeSync`を明示提供し、同じschema/session/launchでsource/targetを再検証する。
`core.observeSessionGeneration`は既存一覧とmanaged metadataだけを同期で読み、OS process/画面の活動採取を省く。
sync store/observerが無ければdeferred口はUNSUPPORTEDで、従来の発行時点へfallbackしない。

native側の`execution-effect` scopeは、最初の作用直前にissueを同期commitする。
tmux/psmuxのnew-session/send-keys/paste-buffer/respawn-pane/kill-session、buffer/環境/pipeの変更と
Windowsの直接payload workerを同じ入口へ繋いだ。tmuxのcommand queue全件の対象を先に照合し、
セッション名の作用先を完全一致の`=name:`へ揃える。window/pane指定は保持する。
未知native command、global killや対象違いは拒否する。捕捉済みnative IDは期待世代close primitiveだけがbindする。
scope内で拒否をcatchしてもframeをpoisonし、別の作用へのfallbackや偽成功receiptへ変えない。
最初の作用前の失敗はnot_started、発行印を越えた後の失敗はpossibleとしてslotを残す。
正規の作用成功receiptだけは、後の結合失敗でも保持する。

`withExpectedCloseEffect(expected, body)`は停止印とその期待世代のissued close slotを照合し、
その一回のnative killへscopeを供給する。通常closeのdeferred受付は、同じ期待世代の消失を後観測し、
対応incoming relationをinterruptedへ更新する。

直接stdioの参照には、既存native processのpid/started_identityと既存JSON-RPC request ID、実tool/action、
実target_session_idを`RequestRef.kind=mcp`へ保存できる。新しい仕事IDは採番しない。
この参照はserving dispatcherが内部生成する。公開register handlerからのmcp参照登録はUNSUPPORTEDとし、
モデル引数でcontrol操作の名札を選びAI呼出をgraphから隠す形にはしない。
同じprocessが扱うstdio接続の既存request IDを想定し、HTTP経路はBridgeの既存delivery/room/call参照を使う。
launch/send/issue、実行を開始/再開し得るkey/approval respondは実呼出edge、configure/auth/close等は変更受付として機械的に扱う。
後者は停止fence/drainの対象になるが、他AIへの仕事依頼edgeを新たに作らない。
empty launchは実launch参照とboundary=nullを保存でき、cursor=0等を捏造しない。

preparingはrecord.operationsの追加状態。既存register/status/finish/stopの引数・基本結果・meta keyは維持する。
Bridge側のstatusはaccepted/not_sentの確定以外で未確認を解かないことを確認した。
既存の即時注入fixture用`runBoundExecution`も残すが、実preflight/idle待ちを持つ製品handlerにはdeferred口を用いる。

これらは隔離実装のnative admission経路であり、現在はrequireExecutionEffectScopeを製品全体へ有効化していない。
indexでの実native process identity取得/実default factory供給、auto-name、普通PTY/authのmanaged launch無しの世代、
remote source-only admission、全参加processでのparent queue/hookのmandatory scopeは稼働未接続。
全handlerへのframe供給は以下の隔離constructor接続で検証し、通常のstdio mainには有効化しない。
この状態では一般PTYをunsupportedへ変える一括有効化やpublic mountを行わない。coverageはincompleteを維持する。

隔離constructor接続として`createAitermServer({execution: server => ...})`を追加した。`index.ts`が実際に
登録する同じ18 toolsのtools/callを、SDKの既存handlerの前でdispatcherへ渡す。引数/metadataを要求時に
detachし、SDK extraのsignal/通知関数を保持する。既存handlerは固定された引数/extraを読み、親managerも
そのwithExecutionRequestにあるnative ingress/sourceを受ける。不完全なprivate dispatcher/親callbackは
constructorでunsupportedとし、remote親やlegacy配送へfallbackしない。未対応task背景実行も作用前拒否する。

constructorはstdio接続/終了/diagnostics/reporterを起動しない。mainの直接実行は従来どおり18 toolsを起こし、
private execution factoryを**渡さない**。bin symlinkはcanonical pathで直接実行と判定する。native/networkを全て
拒否するpreloadで隔離stdio子processのinitialize/tools/listを確認し、vendor CLI/PTYを起動しない。
これは全handlerへのframe供給の隔離接続であり、全core直接入口/全参加processのmandatory scopeや
稼働mount/coverage completeの証拠ではない。新しい公開execution toolsもここでは登録しない。

`createExecutionDispatcher`は、名前が固定されたmanaged targetについて、実SDKの`extra.requestId`と
serving processの既存pid/started_identityを内部mcp参照へ結ぶ隔離adapter。
既存handlerはdispatcherが固定したargs/extraを使い、最初のnative作用で共有slotを発行する。
SDK extraのsignal/通知関数はそのまま保持し、source meta/引数だけを要求ごとにcloneする。
初期化済client名/stdio環境/native identityはモデル引数から取得しない。
source環境の一部欠落/不一致を独立operatorへ読み替えず、作用前に未確認とする。

BellTeamのlaunch/sendはregisterで固定済みの既存delivery/room/call参照を使う。
後続要求へhost source metaの再添付は要求しない。明示添付されたcontextが保存sourceと違う時は拒否する。
direct CLIがそのhost参照やmcp参照のcontrol名をtool引数で借りることは認めない。
無追跡steerは世代edgeとして保持し、新しいdispatch cursorを作らない。
receipt後の結合欠測では元成功receiptを維持し、unknown slotとstatus-onlyを残す。
auto-name/普通PTY/remoteはこのadapterへまだ接続せず、adapter単体を一括mountしない。

`createExecutionParentAdapter`は既存parent-delivery IDに、元dispatch参照・検証済parent Point・
実before_send child Point・vendor受信先contextのdigestだけを同scopeへ保存する。
parentの世代をvendor thread名/現在Bot名から補完しない。本文や配送queueを増やさない。
`verifyParentEndpoint`による実managed metadataとnative vendor endpointの照合を必須とし、
resolver無し/違う受信先は作用前拒否する。parentのlaunchだけの照合では別threadへの入力を許可しない。

submitは元dispatchのaccepted receiptとbefore_send cursor/世代の一致を確認し、元receipt Pointを
immutableなsource境界として、同じ既存delivery IDでchild→parentの実再開を予約する。
公式queueの作用直前に独立したdeferred frameのeffect callbackを呼び、source/targetの停止と世代を再照合する。
callbackはAsyncResourceへ明示bindし、別要求から呼ばれても元frameへ戻る。body終了後の逃げたcallbackを通さない。
queue受理はtarget boundary=nullの実呼出であり、parent実行の完了/fence閉鎖にはしない。
未発行のreturnは子/親の停止で取り消され、発行済みreturnはdrainし、到達した共有parentも停止する。
元before_sendにだけoperationがある場合も、receiptのcanonical境界と別keyに分裂させない。

これは保存・submit受付adapterの隔離実装である。実ParentDeliveryManagerからのrequest-local参照供給、
vendor endpoint aliasの実証拠resolver、公式queue/hook/emit/wakeそれぞれの実作用口、
別processでqueue受理後にemit/wakeする段階のfence/drainと復旧は未接続。
現在launchを観測できない閉鎖済childからのreturnも、履歴だけで新規作用を許可せず未確認へ止める。
pending companionを含む実invocation fence証拠が揃うまでは、局所doneからbranch退役を主張しない。
既存recordだけでbindingが無い配送へsame-name fallbackは無く、全体のcoverageはincompleteを維持する。

### Queue受理後のnative段階（隔離接続）

`createParentNativeAdmission`は、同じ既存deliveryのdequeue/emit/wakeを別processが引き取る口。
parent_effectsへ既存delivery ID/段階/issued・accepted・unknown/native actor pid+started_identityを保存する。
payload/再送queue/新しいbatch IDは無い。複数deliveryの一回のstdoutは同じ親launchを照合して一度だけ発行し、
全deliveryのnative段階と全child sourceを保持する。共有slotのsourcesで各childの停止からもdrainする。
その間のfinish/退役は、最初のdeliveryだけでなく全参加deliveryで未確認へ止める。

queueの応答がまだissued/preparingなら、native receiverはboundedなmetadata preflightとして待つ。
native slotを取らず停止を妨げない。queue/emitの再発行ではなく、期限でgraphを退役させるTTLでもない。
unknownなqueue結果は待って成功へ昇格させず保持する。actual native callbackはAsyncResourceへbindする。
発行後の失敗/actor消失は既存slot/actorを残し、再構築後も再発行しない。

queue受理前の閉鎖済childから新しいreturnを作ることは引き続き拒否する。
**既に受理済みの同じreturn**のemit/wakeは、保存済みchild世代と現在の期待parent、停止印を照合して続けられる。
閉鎖済childを現在の同名launchへ付け替えるわけではない。
genuine native receipt後のmetadata不確定でも元receiptを保持し、unknown slotを消さない。
native emit/wake受理はtarget境界の完了やinvocation fence閉鎖を意味しない。

`withExecutionRequest`はdispatcherが固定した既存参照だけを要求別ALSでParentDeliveryManagerへ渡す。
managerはbefore_sendで同じ既存delivery IDと親/子/実endpointをcompanionへ結び、bind失敗時はchild claimを解放する。
missing context/remoteは未対応。background/recoveryは旧RPCのissued callbackを再利用せず、
`createParentManagerExecution`の実steer callbackへ入る。公開steer0.4.7のままではcapability不在で拒否する。
`createSteerExecutionAdmission`はqueueのnative受理と、後続native段階を別々の共有受付へ繋ぐ。

自分の別隔離repo `aiterm-steer-cascade` に低位callbackを追加し、実SDK風Node fixture→実queue/hook/
Cursor単一scope出力/Claude再開信号との接続を検証する。製品への依存更新・public mountは未実施。
required resolverを子へ輸送できない時は入力拒否。実worker factory/native alias証拠/復旧/全変更口/coverageと
Cursor複数scope/channelは残る。native_contextは既存session/turn/tool/conversation参照の検証用で、
その値からcanonical event_cursorを作ったり、近い実行へ意味で帰属したりしない。

具体的なlaunch/send handlerは`runBoundExecution(..., body, actualTargetSessionId)`の最後の引数へ
実際に発行するimmutableな対象引数を渡す。serviceは予約と一致しない対象を作用/slot発行前に拒否する。
返却receiptの対象違いだけを作用後に検出する形へしない。省略形は既存の注入adapter互換用であり、
製品の具体的なhandlerの実引数照合を代替しない。

close/configureの`changeSession(..., sourceLaunch)`はtransportで固定/照合した呼出元の世代を既存slotへ保持できる。
sourceが停止済み/absent/世代交代なら作用前拒否。停止はsourceから発行済みの変更もdrainし、
応答欠測を再構築後も未確認として保持する。設定変更だけからAI実呼出のgraph edgeを作らない。

`core.closeExpectedAgentSession(expected)`は共有の発行済みclose slotを持つadapter向けの実閉鎖primitive。
実native一覧、期待metadata、native identity再取得とmetadata再照合を同期で行い、
捕捉した`$<session id>`だけへkillを一回発行する。同名が新世代へ替わっても名前へfallbackしない。
一覧形式/metadata/世代が不明なら作用前拒否、kill失敗/応答欠測/後観測不足はpossible。
idle/graceful終了を待たず、名前によるlog/metadata cleanupもしない。serving serviceはさらに対象席の後観測を行う。
異なるmultiplexer/server再作成を含む非協調な外部操作をこのprimitive単独で排他できるわけではない。
全製品変更口との共通受付と同じscopeのslot所有が前提であり、それが未接続の現在はpublic mountへ使用しない。
既存の通常`pty_close`契約とそのcleanupは変更しない。

共通受付の実装対象を、現在の公開18 toolsの作用で分ける。tool名だけのread判定はしない。

| 入口 | 受付が必要な作用と既存境界 |
| --- | --- |
| agent_launch / claude_agent / codex_agent / grok_agent | session選択・作成、managed metadata、初手、fast/trust。空launchからsendまで同じ予約を維持する |
| pty_open | 明示/自動採番した同名slotの作成。managed launch無しを偽世代で埋めない |
| pty_send | managed dispatch/steerの両方とordinary/force入力。既存before_sendはsteerへ呼ばれないため、それだけでは覆えない |
| pty_key | control入力。source停止と対象世代/slotを照合する |
| pty_close | 通常closeと停止closeを同じslotで排他。期待世代stopのnative primitiveへ名前だけのcloseを代入しない |
| agent_configure | idle待ちの前から保持する旧依頼の世代を、実入力時にも照合。発行済みだけdrainする |
| agent_auth | start/cancelに加え、session付きstatusも対象。公式login終了後のonboardingでrespawn-pane/launchAuthProcessが走るため、statusという名前からread-onlyにしない |
| agent_approval / claude_approval | inspectはread、respondは実control入力。inspectのdigestだけで世代照合を省かない |
| claude_turn | recoverは実入力無し、issueはoperation境界の送信。通常pty_sendと同じ排他を使う |
| pty_list / pty_read / pty_observe / agent_models / diagnostics | 対象への新規入力/起動ではない。既存観測/metadata更新を新しい仕事の実行と混同しない |

remote指定は元のローカルsource fenceを通した上で両端契約を照合する。未対応をローカル成功へfallbackしない。
別processのParentDeliveryManager/background watcher、公式queue/hookのsubmit/emit/wake、
aiterm-parent-deliveryからの受付も別に覆う必要がある。現parent-delivery recordのparentはvendor contextであり、
親の期待launchが直接保存されているわけではない。子boundary/親vendor contextだけから現在の同名席へ付け替えない。
呼出元が閉じても停止executorが続くというBridge本体の所有条件も維持し、
対象launch配下のstdio MCPを閉じて自身のexecutorが消えるケースを成功保証に含めない。
上記未接続経路が残る現在はcoverage=incomplete、public mount未実施とする。

stopの外部入力は期待`LaunchRef[]`。受付排他内でrootの現在のnative turn/before_send境界をsnapshotする。
対象にするのは現在の実行と、局所完了しても未解決の下流を持つ既存branch。全て終了した過去境界は対象外。
rootに未解決の前のbranchが残っていれば現在分と併せて辿る。この範囲を単独の最新active jobへ狭めない。
対象へ到達したlaunchは混在/共有を調べず停止するため、そのlaunchからの現在有効な実呼出も辿る。
独立した別のincoming親へ逆には辿らない。明示root自体はidleでも通常停止として閉じる。

例: A→Bが終わり、下流も終了済みなら、その後BがCを呼んでもA停止ではB/Cへ行かない。
A→Bが局所完了でも同じB実行からのCがまだ動いていればA→B→Cを保持する。
この場合Bが別仕事も始めていても、同じ到達launchならBを止める。意味による仕事分割はしない。
同名新launchへ自動追従せず、旧launchの記録した未解決子孫だけを辿り、置換自体は対象別に報告する。

停止中に先行して受理済みのlaunch/sendがあれば応答確定まで追い、新たに確定した到達先を加えて収束させる。
fence後の呼出は未送信拒否。sourceが停止中に送ったという理由で未記録の新関係を見逃さない。

## 完了を取れない経路とowner選択

dispatchはreceiptの待ち境界と対応doneで追える。追跡可能なsteerは`steer_id`と取り込まれたturnの終了を使う。
0.59.1以前や控え取得不能のsteer、placement=unknown、完了相関のない外部経路は、
Bridgeの親job終了/通知配送だけで閉じず`completion_missing`等の欠測にする。
launch開始だけでprompt/実行境界が無い関係も、CLIがidleという理由で自動終了にはしない。
ハーネスの明示終了解釈は個別adapterで判定し、実行が再開し得る利用上限を終了解釈にしない。

開発案の既定は、**終了証拠が無い記録は未確認として保持し、確認できた期待世代の停止は進める**。
既知の実呼出まで全unknownへ捨てず、同定/寿命/停止の欠測理由を個別に返す。
閉鎖確認で当該launch全体の中断を確定できれば、境界不明の局所寿命を解決できることがある。
未記録の下流/外部まで解決したことにはならない。

時間で欠測を外すと古い未完了実行を残し得る。このtradeoffの裁定が必要なのは次の選択だけ。

- 証拠が取れるまで未確認を保持する（保守案）。欠測が長く残る場合は古い対象も含み得る。
- ownerが明示した時刻窓/上限で欠測の候補を範囲外へ出す。除外記録と未確認を返し、全停止成功にしない。

後者の閾値、時計の基準/ずれ、切捨て時の表示/結果はまだ選ばれていない。
タイムスタンプは記録/順序補助に残すが、初版が勝手にTTLを決めたり、時刻だけで完了扱いにしたりしない。
トロニーがownerへの範囲相談を持ち、Aitermは機械的な終了証拠の追加と保守案で独立に開発を進める。

## native親要求のprovenanceと別process hook

`execution-context`は、dispatcherが固定した既存request、検証済みsource Point、initialized client、
serving MCPのnative PID/started_identity、元SDK metadataのコピーをrequest-localに保持する。
モデル引数、変更後のingress object、別requestのcontextやhost stdio envで補完しない。
sourceが未検証、host参照だけ、native actor不明なら親配送provenanceはunsupported。
これは記録済みの実呼出edgeを意味判定で捨てる条件ではなく、未発行の親配送を正しい実世代へ結ぶ受付条件。

`execution-parent-source`は元SDK metadataを既存native decoderへ渡してendpointの一致を確認する。
`core.observeExecutionParentProcess`/`execution-parent-process`は、同じmanaged metadata、native pane、
唯一のharnessとprocess表を読み、前後のpane/launch一致も確認する。画面、argv、env、cached vendor_session_idを
証拠に含めない。PIDだけではなくstarted_identityと親子順序を照合し、切断・循環・PID再利用・重複行は欠測。
MCPからharnessへ辿れることをbefore_sendで再照合する。新native turn IDやgraph IDは作らない。

既存parent-delivery IDのcompanionに、元request、source世代、MCP/harness native identity、
native endpointのthread/session/tool参照だけを追加する。本文やhome/hook path、metadata全文は保存しない。
元requestと違う証拠は拒否し、復旧時もこの記録を読む。後続配送で元MCP processが自然終了していても
別processへ付け替えず、同じ期待harnessと独立したendpoint証拠を要求する。
provenanceだけで「そのthreadが現在もloaded」とはしない。queueの独立したruntime endpoint verifierも必須。
同期native issue境界のverifierは実boolean trueだけを受け入れ、未完Promise/欠測を真値として採らない。

`execution-parent-endpoint`は別processのnative hook出力に、現在のactorのnative lineageも要求する。
Codexはnative session/threadとturn参照、Claudeは実PreToolUse request.jsonのsession/tool/native ownerと
同じdelivery.json、Cursorはそのdelivery IDのbind.jsonとnative conversation/eventを照合する。
Claude closed/agent_id、別conversation、別scope、別actorは別席へredirectしない。
複数配送を一回でemitする場合は全件をpreflight/実作用直前の両方で再照合する。
hook turn/conversation参照はendpoint相関であり、before_send cursorのaliasや実終了fenceではない。

`createExecutionParentWorker`は、processごとのnative callback用required profileを作る隔離factory。
実装既定は既存coreのstate root/socketまたはnamespace、現在processのnative identity、上記観測口を使う。
旧public steer 0.4.7や不完全な注入runtimeを、OS/stateへの個別fallback前にunsupportedで拒否する。
producerから渡された期待scopeと実processのscope/product rootを照合し、同じFileExecutionStoreを開く。
実作用前にもscopeと実libraryのcallback capabilityを確認する。profileはコピーで作りstatic profileを変えない。
native workerはqueue producerではなく、新registerや旧submitへfallbackしない。

現時点で実default factoryは呼ばず合成runtimeで受入。static AITERM_PROFILE、実worker/hook、公開18toolsへは
未mount。全参加process/全変更口の被覆証明は別工程で、factoryが作れてもcoverage=incomplete。
native contextの無いCodex opener/wake、Cursor背景stdout・複数scope/channel等は、この厳格endpoint verifierでは
unsupportedを維持する。独立したqueue alias証拠、終了fence/self-turn、旧actor/放棄lockの復旧も未了。
現在のhook/file相関は同一OS利用者内のlocal correlationであり、暗号認証ではない。

`createExecutionParentProducer`は同じscope環境factoryを使い、MCPのnative actorと既存requestのactorが
一致する場合だけqueue producerになる。source envは既存source/scopeの8名だけを固定し、SDK metadataは
実native decoderへ渡す。runtimeの部分注入から実OSへ個別fallbackしない。
Claude queueは実PreToolUse request.jsonのowner/tool/session、closed/agent_id無し、同じdelivery.jsonを要求する。
before_sendのcompanion bind時はnative delivery.jsonを次工程で作るが、既存の別IDは上書きを認めない。
実queue時にはnative bindingが必須。Codex/Cursorの現在producer endpoint証拠は未実装でunsupportedを維持する。

ParentDeliveryManagerが子の回答を保存した後、元request/正確なcanonical receiptでserviceのfinishを再観測する。
保存した本文やwaiterの成功だけからcompleted/fence closedにしない。欠測してもgenuineな保存済み回答は保持して届ける。
本文保存時点で旧child claimを解放し、実行metadataの応答待ちで次の依頼を妨げない。
元dispatchのreceiptがまだpreparing/issuedなら、metadataだけをbounded preflightで待つ。
停止/未送信はBUSY待ちより先に判定し、queue/native slotを取らず取消す。入力の再送やgraph TTLではない。

未発行の既存parent returnも、その子のinvocation fenceに含む。局所doneはcompletedとして残すが、
結合済みparent deliveryが未解決ならtarget_fence=unknownを維持しbranchを退役させない。
queueのacceptedも実完了ではない。確認済みnot_sentまたは後続の実完了/閉鎖が揃い、native fenceを再観測して
初めて退役できる。終了済みbranchを同名や後のjobから復活させる処理は加えない。
独立したprovider packageのDeliveryAdmissionErrorも、その実providerのconstructorで確かめてcertaintyを扱う。
同名fieldを付けた汎用RPC例外は未確認のままとし、not_startedへ丸めない。

### native hook参照と実行完了の区別

具体的なnative endpoint/actor/scope verifierがemit作用直前に照合した参照だけを、既存parent_effectsの
`hook_reference`として保存する。Codexはsession/turnとPostToolUse/Stop（旧contextはnull）、Claudeは
session/tool、Cursorはconversation/hook eventを持つ。raw metadata、本文、pathや新たなgraph IDは持たない。
batch emitも全既存deliveryへ別々に保存する。generic metadata callbackには参照の生成を許さない。

`readAcceptedParentHookReference`は同じdeliveryのinvoked/accepted/非retired record、親子launch、
source proofと正確なemit receiptを照合して読む。issued/unknown/欠測はnull、矛盾は未確認とし、
過去のbranchを復活させない。参照だけでcanonical cursor/source境界を変更しない。

特にCodex Stop hookのdecision:blockは、返した本文をそのhookのturnが処理し終えた証拠ではない。
native hook参照は受取execution aliasやfinish証拠ではなく、後続で受取受付・実世代・実終了を別に
対応付けるための材料。Claude toolやCursor conversationから架空のturnを作らず、終了fenceは未確認に保つ。
この変更は隔離schemaだけでpublic mount/公開wire/installed依存の更新を行わない。

### tmux以外のcore native作用

POSIXの`ensureAgentOwnsPaneInput`によるstty raw/-echoはtmux gateを通らないので、実発行直前に
`beforeExecutionEffect`を明示する。tty観測は`=session:`でprefix matchを避け、同じdeviceを再確認して
から共通受付のsource/target世代・stoppingを確認する。foreground child toolの端末は変更しない。
unmounted既定の回復は維持する。これは全core変更口の被覆完了を示さず、coverageはincompleteのまま。

RPCの最初の作用をissuedにした後も、後続のnative commandは同じslotのissued状態、source/targetの
世代と停止を再確認する。readiness待ち等の間にstop・世代交代・slot欠測が入れば後続作用は拒否する。
先行作用は消さず、RPC全体はpossible/unknownとして保持し、再発行しない。
launchのexpected IDがnullのまま新たな同名席を観測しただけでは、その席を作った世代だと認めない。
以下の限定adapterが供給されない経路では後続作用をunsupportedで拒否する。公開mountの前提には
全native作成/世代読取/閉鎖adapterと全変更口の被覆を含み、合成の単一作用launch成功で省略しない。

### 作成したnative sessionとmanaged launchの段階結合

`runDeferredBoundExecution`のlaunch frameだけが内部creation callbacksを供給する。モデル引数/公開registerに
native IDや作成世代を選ぶ欄を増やさない。既存POSIX serverのPID+started_identityを作成前に固定する。
`core.observeExecutionNativeCreationScope`は同scopeの完全なnative session一覧とnative process identityを
前後に読み、server PID混在/PID再利用/欠測/一覧交代をunknownとする。時刻の近さで対応付けない。

guarded new-sessionは`-P -F`でその作成自身のsession ID/name/server PIDを受け取る。後から同名を列挙した値を
作成receiptへしない。先行するglobal環境設定とglobal復元は同じcommand queueに置き、session向けの設定は
receipt捕捉後に分離する。issued slotへcreated_native_id/created_serverを保持し、その後の対象付き変更/読取を
捕捉済みnative IDへ固定する。server owner/物理IDを各作用直前に再照合する。環境検証失敗時の再createは行わない。

coreのmetadata constructorは既存managed launch IDを内部生成する。その直前にも物理shell受付を確認し、
保存されたmetadata/current generationと元native ID/serverを照合してslot.expected_launch_idとrelation.targetへ結ぶ。
launch再結合/別要求への転用は拒否する。結合receiptはsource停止後も保持し、到達したlaunchにも停止印を引き継ぐが、
入力を解禁しない。先行作用後の欠測/交代はpossible/unknownと元slotを保持し、再送や同名cleanupを行わない。

この隔離実装は**既存POSIX server・固定名managed launch**に限る。serverが無くownerを取れない起動や、
Windows固有のserver作成は作用前unsupported。古いmanaged metadataが残り物理shellと世代を結べない場合も未確認。
既定legacy launcherは変更せず、private producer factoryの追加observerにも注入runtimeからOSへの個別fallbackを作らない。
auto-name/通常PTY/auth、全参加者/全変更口と復旧は別工程で未了。
同じnative IDがserver再起動で再利用され得るので、ID単独の一致を受入条件にしない。

### RPC終了後のnative作成証拠と期待close

coreは要求scopeの作成receipt/native server proofだけから、managed metadataへ
`execution_native={schema:"aiterm.execution-native.v1",native_id,server:{pid,started_identity}}`を保存する。
モデル引数から受けず、後の同名一覧から自動補完しない。metadata loaderは厳格検証し、各vendorの
既存更新でもこの項目を保持する。RPCのslotを解放しても作成証拠は残る。

private `observeExecutionSessionGeneration`は完全native一覧/ownerとmetadataを前後照合する。
物理消失はabsent、同名席が存在してもstamp欠測/破損、native ID/owner/世代交代があればpresentかつ
generation未確認を返す。古いmetadataにあるlaunchをそのまま現在世代へ昇格させない。
private parent worker/producerの既定generation observerもこちらを使い、注入runtimeの欠測へfallbackしない。
legacy公開のobserve契約は維持する。未登録の既存席はこのprivate runtimeでは未確認であり、自動登録/再起動しない。

`core.closeExpectedAgentSession`はこの作成証拠を各snapshot/launch照合でも確認し、共有slotに結合した
実native IDへ一回だけkillする。stamp欠測はunsupported、確認済み別launchはstaleとして作用前拒否する。
同名replacementのmetadataをcleanupしない。実閉鎖確認後に同じ名前で新世代を作れても、旧branchは退役のまま。
source停止/世代欠測等のExecutionErrorはvendor起動失敗のtelemetryへ分類しない。
これらはPOSIX/fakeでの限定受入。server bootstrap/Windows/全core・MCP admissionとcoverage、実受取番/fence、復旧と
安全mountが未了なので、実runtime全体/本番/公開配布の完了を示さない。

一次資料は[tmux 3.3a manual source](https://raw.githubusercontent.com/tmux/tmux/3.3a/tmux.1)と
[psmux 3.3.8 flag reference](https://raw.githubusercontent.com/psmux/psmux/v3.3.8/docs/tmux_args_reference.md)。
flagが存在してもcreator/serverの証拠は別に必要。新規取得分はrag/ingest.py経由でrag/sources/backendsとmanifestへ保存した。

## 同processのparticipant組立て

private `createExecutionParticipant`は、producerの共有service/store、実18 handlerのserver、dispatcher、
同process用worker profileを同じstate/socket scope・native actorへ結ぶ。source環境は既存8名だけを
一度読んで固定し、serviceとdispatcherが別時点のsourceを採用することを防ぐ。未要求の環境値は保存しない。
native actorはこのMCP processのPIDと開始identityであり、任意の別process値をserver ownerとして使わない。
scopeとactorは作用前のobserverでも再照合する。異なるactorやscope、旧provider、不完全なruntimeはunsupported。

provider/profile/expected scope/runtime methodは構築時に固定し、呼出側objectの後変更を新しい証拠や実装へしない。
既存observerが返す現在scope/actorの変化は拒否する。source欠測を最新jobや同名席から補完しない。
注入runtimeにはparent managerの全必要依存も明示させ、個別OS fallbackを作らない。managerの保存先は
participantのstate root、ownerは同じnative actorへ照合する。別process workerは同scopeへ自分のnative actorで参加し、
MCP actorをserializeして流用しない。

この組立ては隔離constructorまでであり、default factory/native観測の実受入や静的profile/通常stdioへのmountではない。
全core直接入口・全参加process inventory・実終了fence/復旧が未了のためcoverage incompleteを維持する。

同producer serviceのguarded closeは`withExpectedCloseEffect`で、その期待世代の停止印・発行済みclose slotを
照合してから同期の`closeExpectedSession`へ渡す。default primitiveは既存POSIXの厳格なcore closeであり、
注入runtimeでこの欄が無い場合はunsupported。個別のcore/OS fallbackを行わない。
native kill直前のgateでも同期generation observerを呼び、scope/actor/期待launchを再照合する。
preflight後の同名replacementを許さず、作用後の応答欠測を消失観測やservice再構築で成功へ変えない。
そのunknown slotは後続の同名作用を抑止し、closeを自動再発行しない。
期待closeのframeは同期primitive用であり、注入callbackが非同期に遅らせた作用は失効frameで拒否する。
返されたPromise自体はawaitし、遅着拒否を観測不能なPromiseへ捨てない。

完了adapterは元のpointを固定し、終了fence callbackにもそのコピーを渡す。fence応答後の世代再照合が欠測/交代なら
完了を未確認とし、旧branchを退役させない。単なるnative doneではfence unknownを維持する。
これはfenceの世代検証であり、native受取番alias・全参加者のmandatory受付・実終了fence証拠そのものの実装ではない。

### private processのcore直接入口

private producer/worker factoryの成功時に、そのprocessのnative effect scopeを必須にする。
coreのlaunch/PTY作成、send/key/close/期待close、初手/dispatch/steer、configure、auth start/cancelとsession付きstatus、
approval respond、Claude issue、tty回復は、最初の準備前に同じ対象のrequest contextを要求する。
scope無しや対象違いからnative/公式認証/lock・metadata準備へ進めない。名前未確定の直接作成とglobal killも拒否する。
inspect/recoverやsession無しauth status等のread解釈は維持する。

入口のcontext確認はpreparingをissuedへ変えず、native作用直前のsource/target/slot照合を省略しない。
process modeはserver closeでlegacyへ戻さない。通常stdio mainはこれらprivate factoryを呼ばず、公開既定は変更しない。
この拒否はguarded process内のcore入口とnative command gateに限る。別processのstatic profile/未登録worker、
親配送の全経路、非同期準備中の各metadata作用、全参加者inventory/native終了証拠の完成を示さない。

### 同期の準備再照合

deferred serviceは同じ既存request/stageから、`issue`と別に同期の準備callbackをframeへ渡す。
準備時にも元source/期待targetの世代、停止印、slot競合、runtimeのscope/actorを照合する。
graphのread-only transactionでcallbackを呼び、sourceの停止受付とcompanion metadata更新の間を同じ短いlockで直列化する。
準備中の要求はpreparingのままで、native slotを作らず、native作用をissuedへ早めない。

`assertExecutionContext`はこのcallbackがあるframeで再照合する。`withExecutionPreparation`は同期のmetadata actionを
同じtransaction内で行う。nested helperは同じlockに留まり、別対象、native発行、Promise返却やnested失敗はframeを失敗にする。
拒否をcatchしても成功receiptへ変えない。RPC終了後の継承callbackも元frameの期限切れで拒否し、metadataを後書きしない。
これは時間TTLではなく、同じ実RPCの終了に結ぶ寿命である。

coreのmanaged metadata constructor/hook生成・native stampの保存、およびconfigureのmodel保存へ明示接続する。
作成したmanaged launchをslotへ結ぶ処理はgraphを更新するので、準備transactionを抜けてから既存の別照合で行う。
metadataだけの準備と新launchの実発行を混同しない。既定mainはframe無しのlegacy挙動を維持する。
設定復元・残る親配送metadata・全参加者inventoryやnative終了証拠まで完了したとはしない。

### private参加者の宣言と欠測inventory

private producer/同process worker/stdio MCP、および別process workerのfactoryは、同じstate/socket scopeへ
実観測した既存PIDとstarted_identity、接続した役割だけを宣言する。新しい参加者IDや配送queueは作らない。
同じPIDの開始identityが交代しても旧宣言・要求・結果不明slotを上書きせず、別のnative identityとして保持する。
private storeの各transactionは同じlock内で自分の宣言と必要な役割を照合し、欠測時はunsupported。
使用時の自動登録・役割補完はせず、明示的なfactory再構築も旧issued/unknown slotを消さない。

inventoryは既存MCP request、未解決parent delivery/source、native emit/wake/dequeueのactor参照を読むだけで、
要求・delivery・native actorを別IDへ付け替えない。bounded native identity読取が欠ける/不正/非同期ならunavailable、
同じPIDの開始identityが違えばreplacedとする。未登録と役割欠測を別に示し、観測値をenv claimから補完しない。
受付済みparent effectも元要求/returnの退役前やcompanion欠測では保持し、両branchの確定退役後は参照から外す。
新しい同名仕事から古いbranchを復活させない。registryの行をBot名の停止graphとして走査しない。

このinventoryは共有lock内のread-only処理で、修復・終了fence・retirementや作用を発行しない。
全行がnative PID/startに一致しても、launch/source/turn証拠・未登録processの発見・全変更口のmandatory接続は未証明。
`participant_discovery=unproven`、`native_fence=unknown`、`relation_coverage=incomplete`を維持する。
有効な記録済みcall edgeをinventoryや意味/混在判定で除外しない。公開wireと通常mainには追加しない。

private state.v1のparticipants欄は旧記録の欠測を空配列として読む。新欄を読めない旧strict readerは拒否するため、
これは隔離storeだけの実装であり、稼働stateの相互運用/移行を受入済みとはしない。
native作用後に宣言やmetadata受付が失われた場合、cleanupの未発行エラーを外へ上書きせずpossibleを返す。
真の成功receiptは保持し、commit不能なら既存issued slotを残して再構築後の再発行を抑止する。

## 結果と残実装

```ts
{ schema: "aiterm.cascade-stop-request.v1", roots: LaunchRef[] }
{ schema: "aiterm.cascade-stop-result.v1", roots: LaunchRef[],
  status: "stopped" | "partial" | "unconfirmed", relation_coverage: "complete" | "incomplete",
  unresolved: { request: RequestRef | null; reason: string }[],
  targets: { launch: LaunchRef;
    outcome: "closed" | "already_closed" | "unknown" | "unsupported" | "replaced"; reason: string }[] }
```

relation_coverageは追跡可能な実呼出の記録/世代/寿命/停止の確認範囲であり、意味的な全入力の完全性ではない。
schemaだけで全対象網羅を証明できない。registry/executorが計画対象全件と未解決を照合して結果を作る。
未知launchは偽IDで埋めずunresolvedへ。既存同名slotの通信上結果不明は保持し、launch/send/configureを解禁しない。
期待launch照合、発行済み変更drain、close一回と後観測をAitermの同じ排他の下で行う必要がある。
現行`pty_close`のreceipt単独は全process終了を証明しない。切り離したOS子/外部副作用の取消は保証しない。
remoteは既存権限と両端契約が無ければunsupported/未確認。新しいSSH権限を開発承認から作らない。

残工程は、runtime世代/境界と終了fenceの証拠adapter、共有state/復旧の運用受入、直接launch/sendおよびBridge_meta接続、
全変更口の共通受付、期待世代を守る実閉鎖adapter、Bridge統合と製品のfake受入。
既知のfixtureが通っても実装/実席受入/公開/配布の完了ではない。
