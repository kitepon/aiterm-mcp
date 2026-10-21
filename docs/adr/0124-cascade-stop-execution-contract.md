# 0124. 連鎖停止の実行境界・Bridge接続案

状態: Proposed（2026-10-21）。所有境界・共有先保留はトロニー氏と合意済み。
公開tool名・wire schema・source検証adapterは本稿で提案する段階。
`src/execution-contract.ts`は未接続の型/検証fixtureで、MCP公開口や実停止の実装ではない。

## 所有境界

Aitermは期待launchを照合した停止計画・受付競合・対象席の実行/観測・対象別結果を持つ。
BellTeamはBridge因果adapter、配送/起動/予定の受付抑止、単体API、全体ON/OFF、配送整理を持つ。
アプリUIはベル。停止を実行する呼出元はBellTeam本体で、対象root席の終了に依存しない。
新ID体系、永続配送queue、本文保存、自動再送を導入しない。既存の配送/実行参照を関連付ける。
開発は明示承認済み。公開配布・本番反映の既存個別条件は維持する。

## 現在の不足を隠さない

`X-Bellteam-Seat`はBot IDで、source launch/turnの証明ではない。
`parent_session_id/lineage`は起動時の親名で、親launch世代や今の依頼の専有を証明しない。
現在の親配送も全Bridge配送の仕事因果を網羅しない。

Bridgeが渡す値はclaim。照合結果の`verified`や`input_coverage=complete`を外部要求が指定してはならない。
live launchの照合と、当該tool呼出を既存の依頼へ結ぶ検証は別である。
今のBridgeにないsource情報を、最新/唯一のactive jobで補完しない。

## 参照型（ローカル初版）

ローカルのstate/socket領域は呼び出したAitermへ束縛される。pathをwireへ運ばない。
同名remoteは別scopeであり、初版のローカル参照へ変換しない。

```ts
type LaunchRef = { session_id: string; launch_id: string }; // 既存32桁hex launch_id
type Boundary = {
  event_cursor: number;
  operation_id: string | null;  // 既存sha256相関。Claude以外は通常null
  turn_id: string | null;       // harnessから確定できた時だけ
  steer_id: string | null;      // 既存_meta["aiterm/steer"]の参照
};
type RequestRef =
  | { kind: "delivery"; delivery_id: string; target_session_id: string }
  | { kind: "room"; message_id: string; target_session_id: string }
  | { kind: "call"; call_session_id: string; event: "session.message" | "session.reply";
      seq: number; target_session_id: string }
  | { kind: "aiterm"; launch: LaunchRef; boundary: Boundary };
type SourceClaim = {
  launch: LaunchRef | null;
  boundary: Boundary | null;
  request: RequestRef | null; // 送り手が受けた元依頼。今回送るdelivery_idとは別
};
```

roomは同一message_idでも実target別の入力。返信者一覧だけに限定せず実fan-outを登録する。
callはsessionだけでは識別しない。seqが無い受信でもBellTeamが付けた既存delivery_idがあるなら
delivery参照を使える。どちらも無ければ識別不足としてunknownを維持する。
`groupId`が既存delivery/message IDと同じなら別IDとして二重登録しない。

## sourceに最低限必要な情報と証拠

| 項目 | 渡す時点・出所 | Aitermでの判定 |
| --- | --- | --- |
| source session_id | MCP要求を受けた時のruntimeの席情報 | 登録済みの現在launchと照合。Bot ID単独ならunknown |
| source launch_id | その要求を送るruntimeに付けた既存AITERM_AGENT_LAUNCH_ID | 現在metadata/生存/呼出元との束縛を照合。IDの文字列一致だけをcaller証明にしない |
| 元のRequestRef | Bridgeが保持する元配送・room target・callイベント、または直接Aiterm実行境界 | 入力台帳と照合。今回の送信先配送を元依頼と取り違えない |
| source Boundary | その呼出を発した現在のharness/依頼の確定境界 | 元入力・tool呼出との対応がAitermで確認できる時だけ採用 |
| 候補入力集合 | Bridge jobs/dispatch/steerとAiterm直接入力の対応 | 一件だけでも証明の代わりにしない。未登録入力があり得ればcoverage不完全 |

HTTP Bridge接続では、必要なら既存環境値を運ぶlaunchヘッダー等を追加するが、これは候補の輸送である。
それだけで`caller_bound`や`invocation_bound`をtrueにしない。
Aiterm側に、runtime/harnessの呼出コンテキストを現在launchと既存依頼境界へ結ぶ検証adapterが要る。
native tool-use/turn等の既存参照を使う。提供できないharnessや経路はunknownのままにする。
共通の全harnessでその情報が現在取得できるとは確認していない。この点は次の実装工程の課題である。

内部の`ExecutionSourceEvidence`はwire inputではなく、その検証adapterだけが生成する。
`assessExecutionSource`はこの内部証拠との純粋比較をfixtureで確認するもので、証拠の取得はまだ行わない。

判定は次のとおり。

- launchを確定できない/呼出元を束縛できない: unknown。
- 同名だがlaunchが違う: stale。新launchを古い関係へ結ばない。
- 入力集合が不完全: unknown。判明している候補を返す。
- 同一実行へ独立入力が混在: mixed。active jobを一つ選ばない。
- 一つの入力でも個別tool呼出との対応が無い: unknown。
- source launch、呼出、元依頼、境界、入力集合のすべてが一致: verified。

ユーザー/予定等の独立root入力は、Bridgeの当該入口の事実とAitermのroot受付を結ぶ別の内部証拠で登録する。
SourceClaimがnullという理由だけで、モデルからの呼出を独立rootへ昇格させない。
混在入力が全て同じ停止rootに属することを証明できる最適化は初版では行わず、mixedを保留する。

## 登録時点とreceiptの対応

提案する汎用入口は`agent_execution`のregister/status/finishと`agent_stop`。
名前はまだMCP tools/listへ追加していない。

1. Bridgeは既存delivery/message/event参照を採番した後、配送queue/起動/本文貼付より前にregisterする。
   送り手情報はMCP受信時点のsnapshotを運び、後から別turnで解決した情報へ取り替えない。
   未送信入力も登録するが、本文・画像・再送payloadは保存しない。
2. registerの入出力は次の案。証拠不明でもunknownとして登録でき、後の完全停止の対象漏れとして残る。
   同一RequestRefの同一内容は同じ登録。内容を違える再登録はconflictであり別の送信を作らない。

```json
{
  "schema": "aiterm.execution-reservation.v1",
  "request": {"kind":"delivery","delivery_id":"existing-outgoing-id","target_session_id":"bot-b"},
  "source": {
    "launch":{"session_id":"bot-a","launch_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    "boundary":null,
    "request":null
  },
  "target":{"session_id":"bot-b","expected_launch_id":null}
}
```

この例のsourceはverifiedではない。現在のBot IDだけならlaunchもnullにする。
稼働済みの受け手はexpected_launch_idにその既存launchを指定し、未起動だけnullを許す。
registerは停止中root/受付済み関係と同じAiterm側排他で判断する必要がある。
独立したregisterだけ成功して後のsendが無条件で通る実装にはしない。

3. `agent_launch`と`pty_send`は要求_metaの`aiterm/execution`で同じRequestRefを渡す案。
   Aitermは送信lockの中で関係と停止状態を再確認し、未送信なら拒否する。
   wakeが必要な場合はlaunchも同じ登録へ結び、launch receiptで実target世代を束縛してから本文を送る。
   起動後の停止競合で、空の新席だけが未登録で残ることも防ぐ。
4. Aitermが実際の`before_send`境界を記録し、send receiptの既存mode/session/launch/event_cursor/operationと
   差し込み_metaのsteer_idを登録へ結ぶ。Bridgeが後から一番近いreceiptへ当てはめない。
   追加の結果_meta案は次の形。

```ts
{
  schema: "aiterm.execution-binding.v1",
  request: RequestRef,
  target: LaunchRef,
  boundary: Boundary,
  source: { status: "verified" | "mixed" | "unknown" | "stale", reason: string },
  state: "admitted" | "submitted_unknown"
}
```

返却されたmode=agent_steerが同じtarget turnへ混在すれば、その関係を上書きせず多入力として保持する。
RPC応答消失/部分貼付はsubmitted_unknownとして残し、receiptが無いことを未送信の証明にしない。
回復は既存参照のstatus照会とし、登録やsendを自動再送しない。

5. finishはBridgeの通知受付時点では行わず、対応するAiterm完了/中断/明示未送信の確定後に行う。
   target launchとboundaryを再照合し、completed/cancelled/unsent/unknownを区別する。
   元のturnが返っても未解決の下流依頼がある間は因果を消さない。
   rootの寿命を時刻だけで打ち切ったり、返答イベントで逆向きの新しい親を自動作成したりしない。

## 停止要求と結果

```ts
// 呼び出したローカルAitermのscope。全体ONも明示root配列で渡す。
{ schema: "aiterm.cascade-stop-request.v1", roots: LaunchRef[] }
{
  schema: "aiterm.cascade-stop-result.v1",
  roots: LaunchRef[], status: "stopped" | "partial" | "unconfirmed",
  relation_coverage: "complete" | "incomplete",
  targets: { launch: LaunchRef,
    outcome: "closed" | "already_closed" | "shared_busy" | "unknown" | "unsupported" | "replaced",
    reason: string }[]
}
```

同名新launchを閉じず、root世代と対象別世代を排他の中で照合する。
共有/混在/不明の子は席全体をcloseしない。未送信分と今後の当該因果呼出を抑止し部分結果へ残す。
循環・多親は既存参照で訪問済みを管理し、同じlaunchを二重closeしない。
停止受付と新たな関係登録/送信を直列化し、受付済みの下流関係も確定してから収束を判定する。
`stopped`は関係coverageがcompleteで、明示root全てと全対象の閉鎖確認がある時だけ返せる。
初版schema fixtureもこの条件を検証する。既知targetsが空だから成功にはしない。
同定不足の未起動先等、LaunchRefをまだ作れない対象の詳細表現はwire最終化で追加する必要がある。
それまではcoverage=incompleteを維持し、存在しないlaunch_idを生成して埋めない。

停止executorはBellTeam本体からのAiterm呼出で存続する。MCP process間の関係共有/排他と、再起動後の
結果不明保持もAiterm側の実装範囲。常駐daemonや独立の配送queueを足す案にはしない。
旧変更のRPC reject/timeoutは取消完了ではない。同名slotを解禁せず対象別unknownへ残す。
rootの停止でも切り離されたOS子や別端末、既に実施した外部副作用の取消までは保証しない。
remoteは別scopeとして、既存権限・両端契約が整うまではunsupported/coverage不完全にする。

## 隔離受入と実装順

この段階のbuildと`test/execution-contract.test.mjs`の10件は通過。source判定/参照照合/完全停止結果の
純粋fixtureだけであり、runtime証拠取得、関係保存、停止計画、閉鎖executorはまだ接続していない。

次の実装順:

1. source検証adapterと既存入力台帳への対応。現行HTTPのsource不明はunknownのままで接続できること。
2. MCP process間の関係保存・受付/停止の排他。既存参照の冪等register/statusとfinish。本文を持たないこと。
3. source/targetの期待世代を含む直接launch/sendとBridge_metaの共通受付。未送信/送信済み不明の保持。
4. graph計画とexecutor。循環、多親、独立仕事を持つ共有先、混在、unknown、未登録、同名置換、
   停止中の新規呼出、発行済み応答遅延/欠測、部分失敗/未対応をfixtureで確認する。
5. ローカルMCPのfake入口で登録→dispatch/steer receipt→停止計画/結果→次の独立新依頼を受入。
   Bridge側の因果登録/admission順序と返りをトロニー氏が統合受入する。

実席停止・本番試験・既存作業終了・公開配布・本番反映は、この契約返却とfixture確認には含めない。
