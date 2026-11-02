> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# Private親配送の固定参照・出力・受理の境界

基準ce575ce8。図 [親配送の接続](private-parent.svg) / [PNG](private-parent.png)。通常親配送は [既存manager](parent-delivery.md)、public Steerは [受信/設定/runtime](../../../steer-refactor-20261102/docs/architecture/steer-setup-runtime.md)。privateの図を通常配送の有効化/受入証拠にしない。

## 元の要求から子の完了まで

producerは同state/socket scope・自process PID/出生・profile・Steer capabilityを固定する。participant宣言は当processの役割だけで、全entrypoint網羅や関係coverageを保証しない。deferEnrollmentでは最初のtransaction時に宣言保存を行い、read-only指定でも最初の登録は書込を伴う。raw inventoryは欠けた宣言を勝手に修復しない。

parent-sourceは実MCP ingressで既decoderを一回呼び、元request・source launch・client・MCP process・その親系統のharness出生とvendor endpointを固定する。process表に重複PID/出生欠測/循環/親が子より新しい状態があれば拒否。非同期待ちの後に別endpointや最新会話で補わない。明示native_parent=nullは親なしのまま。後のdeliveryは元MCP processより長生きできるが、worker自身の現在の親系統と独立endpoint確認を必要とする。

実before_sendは既delivery UUID発行後に、verified parent・子launchと送信前boundary・endpoint digest・source証拠を結合する。endpoint objectの順序はcanonical JSONでdigest化する。子の入力受付後はserviceの**canonical receipt point**と照合し、before_sendが持つ強いoperation証拠を別のrun keyへ付け替えない。子の完了はそのcanonical pointで通常waitを再観測する。保存回答やwaiter削除だけでは完了にしない。

## Queue・dequeue・emit・wake

parent adapterは子sendのpreparing/issued中だけ有界metadata待ちを行う（既定2秒）。元send receipt欠測、停止/retired、未知slotは先へ進めない。待ちがqueue/入力を再実行することはない。

返送は同delivery UUIDの`kind=delivery` requestを一回登録し、sourceをcanonical child、期待targetを元parent launchに固定する。queueの実作用直前にendpointとslotを検証し、独立したdeferred frameで発行する。AsyncResource.bindで発行callbackを元frameへ結び、別continuationのALSを借用しない。

workerのdequeue/emit/wakeは同deliveryの既accepted返送recordを読み、その段階の未発行を検査する。複数deliveryを一つのhook出力へまとめる場合も、全ID・同parent世代・endpoint・各sourceを一transactionで記録する。issued effectとparent slotを先に保存し、native作用が返った後にacceptedへcommit。後段commit失敗ならunknownを保持し、本物のnative返却値がある場合はその値を失わせない。既issued/unknown/accepted段階を同workerや再構築で再実行しない。

emitのhook referenceはvendor session/turn/tool use/conversation等の**hook context**であり、どの親実行turnが本文を受け取ったかのcanonical aliasではない。accepted referenceの読取もretired/未発行/unknownを除外するだけで、受理/完了/fenceを確定しない。

## 実装されているendpointと制限

queue producerの独立proofはClaude PreToolUseのrequest.json・delivery.json・closed有無・元CLI owner出生の一致を実装する。初回bind前はdelivery.json未作成を許すが、既存競合は拒否し、queue時には同delivery保存を必須にする。Codex/Cursorのingress provenanceを保存できても、producerの現queue endpoint能力へ昇格しない。

native hook endpointはCodex home/threadとhook native session、Claude root/request/session/tool_useと元CLI owner、Cursor delivery UUIDに結ばれたbind.json conversationを確認する。wake/openerのようにnative contextを持たない経路はunsupported。producer内native resolverはCodex homeを与えない一方、別worker factoryは明示codexHomeを受けられる。引数schemaがあることだけで全vendor経路を有効としない。

Steer0.5.1（基準6734ee86）の実exportには`withDeliveryEffect`と`DELIVERY_ADMISSION_CONTRACT`があり、native_context/cursor_profile_parameter/serialized_required/multi_delivery_emitの検査を満たす宣言がある。Aiterm内の「public0.4.7にはない」というコメントを現在版の機能欠落へ引用しない。Steerのcallbackはone-shotで、requiredだけserializeされprocess resolverが欠けた場合は拒否し、legacy actionへ迂回しない。今回接点変更は0。

## 回復と診断

verifyRecoveryは保存owner・元source証拠・canonical child・delivery binding・現endpointを照合し、既return reservationがあれば再送へ進めない。diagnoseClaimはchild/parent入力のnot_sent_recorded/receipt_recorded/unconfirmed、slot、actor inventoryの欠測を別に返し、clearance=retained/retry=noneを維持する。

Claude historical records診断はowner-only相当の正規single-link file、上限、前後dev/ino/size/mtime/ctime、JSONL行境界・結果SHA/bytes・一意Stopを照合する。途中で一つでも検証不能なら部分陽性を破棄する。child_stop=recordedでもnative_input/interruption/session_preservedはunconfirmed、fence=unknown。本文は診断結果へ返さず、claim解放を許可しない。

全caller/test/fixture照合と実runtime受入は未実施。Bridge内部や稼働hook/configの変更は0。
