# 0124. 未完了の実呼出を辿る連鎖停止・Bridge接続案

状態: Proposed（2026-10-21、指揮官の混在停止確定指示と寿命相談を反映）。
初稿fd5d59fの「混在/共有先は除外」「source元依頼の意味帰属/入力集合completeを必須」は失効。
指揮官の確定指示は、混在を判定せず、対象へ到達した実行は他仕事があっても停止すること。
その後の「昔に呼んだ先まで止めると最後は全員」という相談に対し、本稿は未完了関係の寿命で範囲を絞る案。
経過時間の閾値や欠測の切捨ては未裁定であり、本稿から既定値を作らない。

`src/execution-contract.ts`は未接続schema/純粋snapshot計画、同名testは隔離fixture。
実際のsource検証、関係保存、finish検証、受付排他、閉鎖executor、MCP公開口はまだ実装していない。

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

提案入口は`agent_execution` register/status/finishと`agent_stop`。まだtools/listへ追加していない。
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
`completion`や`retired`を外部claimから信じる実装ではない。fence/drain/退役の永続処理は未実装。

## rootの現在境界と到達範囲

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

残工程は、runtime世代/境界adapter、関係保存とfinish証拠照合、process間の受付fence/drainと退役、
直接launch/sendおよびBridge_meta接続、期待世代を守る閉鎖executor、fake MCP受入の順。
既知のfixtureが通っても実装/実席受入/公開/配布の完了ではない。
