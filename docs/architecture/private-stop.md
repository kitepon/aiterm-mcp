> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 停止キー・private中断証明・管理closeの区別

基準ce575ce8。図 [停止と管理の経路](private-stop.svg) / [PNG](private-stop.png)。コードは [private対応表](source-index.md) とcore該当行へ続く。ここで説明する作用を実行したものではない。

| 窓口 | 選択と作用 | 確定するもの / 限界 |
| --- | --- | --- |
| createNativeDeliveryServer / interruptKnownSessions | graphの一回snapshotから子→親順、cycleをvisitedで止め同sessionは一回。coreの通常cancel key | sent=キー受付。中断完了/会話保持の証明ではない。journal/drain/retry/closeなし |
| service.stop（private v2既定） | pure planだけをread-onlyで作る | adapter_missing/unsupported。metadata停止barrierもキーも作らない |
| service.interruptCascade（明示注入時） | run選択→関係tombstone→drain→issued key→再観測/settle | native中断・同run本人性・会話保持・fenceが全て必要。不足はunconfirmed/partial |
| service.closeCascade（private v1保守） | generationごとのbarrier/issued close/absence確認 | 破壊的管理口。停止ボタンのfallbackではない。通常tool registrationへ公開しない |
| close_launch / closeExpectedAgentSession | 元unknown空起動の管理request、または期待世代のissued close slot | native IDに固定したcloseとabsence。入力受理や元失敗の成功へ変えない |

## 通常cancel keyと目標停止

core.interruptSessionNowは登録harness/name/launchを使い、認証準備やtranscript/operation証明の欠測をcancelの阻害条件にしない。native IDで同名の別席を避け、期待launchがあれば作用直前にも一致を検査する。Claude/CodexはEscape、Grok/Cursor/AntigravityはC-c。C-cはidle CLI自体を終了し得るため現paneがbusyの時だけ送り、idleならidle、判別不能なら拒否する。休止席は同launch/hibernated再観測が一致した時だけidleを返す。通常send中でも即時性を保つnative lock modeを使う。

graph読取失敗でも明示rootへの通常keyは残し、結果をpartialとする。キー失敗はtargetごとにfailed、他rootを巻き込んで失敗値を消さない。pause_goalsはtrustedなuser originだけが使える非同期口で、子の目標停止を待って親を処理する。独立rootは並行し、一方の期限を他方へ継がない。goal停止がunknownでも明示keyを残し、goal結果を別fieldで返す。同期口でpause_goalsを指定すれば拒否する。

`execution-native-server` のCLI mainのmode=mcpは現在createNativeDeliveryServerを起動し、tracking participantを作らない。hook modeも通常Steer mainを呼ぶ。parseArgsにexecution-interrupt/scope/providerが存在しても、trackingが有効になった証拠ではない。`configureNativeExecutionHooks`も旧private登録を外して通常index/hookへ戻す構造で、返却relation_scope=untracked。今回はこれらを実行していない。

## Privateのrunとjournal

Codexは厳密root transcript本人性とtask_started/turn ID、Claudeは元operation/匿名v2 before_send markerを照合する。Claudeの予約markerはnative受理・running・停止の証拠ではなく、匿名cursorはsource aliasへ昇格しない。Cursor/Grok/AGYへ推測でEscape/C-cを送るprivate証明口は未実装。通常cancelと対応範囲が違う。

beginInterruptionは同runの元request/delivery参照をsnapshotし、未発行stageだけnot_sentにしてdrainingを保存する。既issued/accepted/unknownと実receiptは保持する。同runの既journal照会はキーを再発行しない。interruptRunはcaller actorとcheckpointを固定してpreparing→issued+interrupt slotを耐久化してから、同期Escape一回を許可する。受付後もslotはunknownで、中断とfenceは未確定。作用後失敗はpossible、reconstructionから再送しない。

死んだcallerのpreparing回復は、同checkpoint protocol・同row・元caller不存在の二回観測を要する。key_not_sent診断を追記するだけでphase/preparing barrier/tombstoneを残す。issued/accepted/unknownはcaller消失で回復しない。これはnative run終了やslot解放の証拠ではない。

settleはaccepted journal、他pending slotなし、native recorded_state=interrupted/fence closed/session_preserved confirmedと本人性一致の反復観測を必要とする。成功しても旧request/delivery tombstoneは残す。cascadeは先に全到達対象をadmitしてからkeyを送り、drain中の新receiptで対象を増やす。未admit祖先・未対応子・canonical alias欠測・late target・unknown発行があるbranchは解放しない。独立rootの結果は別に保持する。

現在のcore Codex証拠はabort記録を読めてもfence=unknown/session_preserved=unconfirmed、Claudeはmanaged/anonymousの予約証拠まで。通常callbackでsettle/confirmedが成立するとは扱わない。fake完全proofの試験成功を実nativeへ代用しない。

## 管理closeとcleanup

期待closeはnative一覧とmetadataの世代を前後再確認し、捕捉native IDだけを一回killして同native ID不在を検査する。人間向けnameで後始末して別世代を消さない。private serviceは実issued slotとscopeを別途要求し、close後のmetadata/関係commitまで確認する。古いunknown送信のrecordsはunknownのまま残る。

全caller/test/fixtureと通常OS経路の確認は未完。実キー送信・停止・close・goal/config/hook更新は0。Windows73failは原因未確定の基準を維持する。
