> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 子の回答保存と親配送の現在構造

capacity等のtyped failure（category: capacity / rate_limited / transient / authentication（0.70.23） / other）は`child_failure`、安全な元種類は`child_error_kind`、会話IDは`child_vendor_session_id`として保存し、status receiptと親通知へ渡す。failure境界がある時は元recordのevent_cursor/operation/input_id/child turnへの完全一致を候補copyで検証してから保存recordを変更する。不一致ならそのfailureを保存・配送しない。旧recordのshapeは追加情報がないまま維持する。

Claudeの入力IDはbefore_send→保存boundary→watch/beforeChange/再構築→bound waitへ通す。watchはmarker作成前に始まり得るため、observerが出現を待つ。Stopの入力IDを照合して、同cursorの後続入力の成功を古い要求へ採用しない。分類・turn終端は未実行や旧producer停止の証明ではなく、親配送managerは新しい本文再送・harness切替・回復queueを所有しない。継続の方針はconsumerが既停止/設定条件に従って決める。

基準Aiterm ce575ce8、Steer6734ee86。図は [親配送](parent-delivery.svg) / [PNG](parent-delivery.png)、[vendor受信](../../../steer-refactor-20261102/docs/architecture/steer-receivers.svg) / [PNG](../../../steer-refactor-20261102/docs/architecture/steer-receivers.png)。`parent-delivery.ts` とSteer全25実装fileを全文初読した。private execution adapter内部も後続初読を完了した。全caller/test/fixtureの独立照合と実機配送は未確認である。

## 所有と窓口

| 所有者 | 持つ状態・作用 | 呼出・返却 |
| --- | --- | --- |
| Aiterm `ParentDeliveryManager` | 子のturn境界、回答本文の確保、配送予約、process owner、復旧、親receiverへの依頼 | `prepare` → `request.before_send` を入力前に呼ぶ。`result/status` は配送receipt、`wait_process` はCursorの背景受信起動情報。`beforeChange` は前の回答保存を次入力/closeから保護する |
| Aiterm `observeAnywhere/answerAnywhere` | 固定された子のsession/launch/operation/cursorから完了と本文を読む | managerがwatchする。別launchの完了、running/timeout/not_takenは完了として受けない。remoteは別key・保存rootで区別する |
| Steer receiver | 親とのbinding、queue/hookの所有record、出力、起床 | profileと親endpoint・delivery ID・確定本文を受ける。下表のvendorごとの到達点を返す |
| vendor harness | 実際の親の会話/turn、hook起動、公式queue、表示と業務処理 | Steerの出力・受付だけでは最終回答/表示を証明できない |
| private execution adapter | 元MCP要求/graph/source evidence、作用admissionとcheckpoint契約 | managerの既存callbackから呼ぶ。各adapter/graph実装はprivate基盤・受付・配送・停止図へ接続。public配送へ意味を混ぜない |

## 保存と予約

managerは親kindごとの `parent-deliveries` / `claude-parent-deliveries` / `cursor-parent-deliveries`、remoteは `remote-` 付きrootを使う。root下は `active/<pid-startdigest-uuid>/owner.json` と配送record、`results/<delivery>.json`。公開statusは同local/remote内の3kindを横断する。予約は通常共通 `parent-deliveries/claims/<child-key>.json`、privateの明示rootは独立する。

ownerはPIDと出生identityが取得できなければ構築を拒否する。heartbeatは15秒間隔でmtimeを更新し、60秒以内ならaliveと読む。5秒ごとの回復はまずPID存在とheartbeatを見て、必要な時だけ出生identityをまとめて照合する。PID存在だけを同一processの証明にしない。

`request` は親とprivate要求/evidenceをfreezeする。`before_send` は子keyの同process登録FIFOで `beforeChange(key,true)` → 元record保存 → hard-link予約 → vendor/private binding → watchの順。publicはwaitingから、privateはunknown/preparingから始め、bind/admissionが済んでwaitingへ変える。private checkpoint/bind応答が失われた場合はunknownの元参照を残し、本文再送やwatchの再開で補わない。作用前拒否だけが元予約/recordを除去できる。

## 子の完了から親へ

watchは期限なしで固定境界をobserveする。doneならraw回答を読み、空回答も「完了したが本文は空」の知らせにする。closed/rate_limited/errorも子outcome付きの本文として保存する。観測失敗は `AGENT_RESULT_UNAVAILABLE` をreadyとして保存し、その通知を配送する。この端末の子は、待つ間30秒ごとに `deliveryChildGone` で確かめる（0.70.42）：子の今のlaunchが境界のlaunchでない（再開・起動し直し）、metadataが無い、休止した、休止でないのにnative席が無い、のどれかが2回続けて見えたら、observeを止めて `AGENT_RESULT_UNAVAILABLE: PARENT_DELIVERY_CHILD_GONE: <理由>` を同じ経路で届ける。どれも境界の完了が二度と来ない状態で、それまでは期限なしの待ちが終わらず、親の席はいつまでも子を待つと数えられた。別端末の子は確かめない（現地のobserveに任せる）。

**親の席への数え方**（`pendingChildResultsFor`、pty_observeの `pending_child_deliveries` とseat_turnsの `own_work.child_results`、0.70.42）：activeにある記録を、子のmetadataの `parent_session_id` が名指す席に数える。名指す席がこの端末のAitermの席でない時、子が別端末の時、子のmetadataを読めない時だけ、今までどおり持ち主processが席の中に居る記録を数える。回復で記録を引き取ったmanagerの席（例：execution-native-serverを抱える席）には数えない。0.70.41までは持ち主processで数えたので、引き取った席がいつまでも子を待つと数えられ、休止も閉じもできなかった（キロ、11/13）。

本文保存でreadyとなり、子の予約を解放する。親の出力を待たず次の子入力へ進めるのが現在の責任分界である。private graphへの完了記録失敗だけで保存済みの本物の回答を捨てない。`deliver` はsendingを保存してからvendor receiverを一度呼ぶ。成功はsubmitted、既知の未作用拒否はfailed、受付が不明な失敗はunknown。`failed` callbackは子dispatchが不明になったwaitingをabortしてunknownへ移す。

`finish` は結果rootへ移しjobsから除く。publicはclaim解放→save→move、privateはsave/move→claim解放で、checkpoint不明ではclaimを保持する。この順序の違いを整理ついでに統一しない。保存/rename/link/unlink/fsync失敗はprivateの診断参照を保護する。`diagnoseClaim` は本文なしで元参照・元processと回収後storage ownerを別に返し、clearance=retained/retry=none。読むだけで復旧許可を与えない。

## 停止・取消・回復

`close()` は新規prepareとtimerを止め、回復/登録を待ち、waiting watchだけabortし、進行中capture/deliveryを待ってowner.closedを書き込む。子のnative席や親会話を停止する操作ではない。未完recordは他managerの回復対象として保持する。通常 `status` は読取だが、manager構築/prepareには回復副作用があるため、API全体を一律「読取のみ」としない。

回復はownerがclosed/gone/reused/vanished/unverifiedかを区別する。aliveと新規未判定ownerは引き取らない。既存コードはidentity未確認のownerのrecordも回収経路へ入り得るため、「明示的なPID不在だけで回収」とは図示しない。元recordのrenameを競合点として引き取り、sendingはunknownへ変更し自動再送しない。waiting/readyはprivateなら元source/graphの回復admissionを待つ。publicのreadyは親verify後だけ一度配送する。失敗はpublic failed/private unknown。checkpoint不明のclaimは再構築だけでは解放しない。

旧版のremoval_safe印がない生存ownerがある間はdirectory削除を抑制する。回収済みownerのclosed保存と、空/終了directoryのbest-effort掃除を分ける。削除失敗は次の回へ回すが配送本文の再送にはしない。

## vendorごとの受付・出力・起床

| 経路 | 保存と作用の順序 | 返却が証明する点 / 不明とcleanup |
| --- | --- | --- |
| Codex | productのpendingにdelivery/thread/text SHAをwx保存 → App Server initialize → `thread/queue/add` 一回 → settled → 必要なら別wake process | string受付IDだけをqueue受付とする。queue/addのtimeout/切断/不正返却はunknown。既知の未受付はpendingを撤回、不明はhook用に保持。wake失敗で受付を失敗へ戻さない |
| Codex同期hook | product-owned pendingと公式queue全pageを照合 → 同delivery/thread/text digestをhard-link claim → deletingを保存 → queue/delete → PostToolUse additionalContext / Stop block reasonを出力 → emitted | delete不成立はnot_in_queue、取った項目の例外はunknown。claimを自動再送しない。公開stateはsending/unknown/nullの射影でありnullは不在/未作用証明ではない |
| Claude単発 | PreToolUseのtoolUseIdとsession/親processをrequestへ保存 → binding → answer保存 → async hookがsending→stderr出力→emitted→exit2 | submitはemitted観測まで待ちnull受付IDを返す。送信中hook終了はunknown。元会話終了/親死亡でも確定回答は残す。受信完了後だけrequest directoryをbest-effort削除。native subagent/agent_id付き親は拒否 |
| Claude inbox | 明示SessionStart由来socket/token、呼出元が受領観測を用意 → raw user一通 → 受領観測 | 書込だけはunknown、今回の書込後の確認trueだけaccepted。確認なし/falseも未送信とはしない。connect前/後の失敗でnot_sent/unknownを分け、終了時socketと観測をclose/abort。tokenを返却へ入れない |
| Cursor単発 | tool返却のdelivery IDをhookが実conversationへbind → answer保存 → hookまたは背景receiverがwx claimを取得 | submitはclaim存在を待つ。claimは出力完了ではない。hook追加contextとreceiver出力は別経路で、競合時は再出力しない。receiverはclaim前に読み手をprobeし、reader_goneは回答を保持する。通常stdoutOutput.emitはwrite boolを返却成功条件にしていない既動作も区別する |
| channel | non-Codexはinbox→claim/sending→emit→emitted/unknown、withdrawは同claimと競合。Codexは上の公式queueへ委譲 | 詳細は既存channel図。`receiveFromChannel` のemit省略時は返却用のno-op callback後にemittedへ進むため、全callerで実stdoutの到達証明になるとは記さない |

Codex receiverはstdio App Serverを所有し、finallyでstdin終了、2秒後SIGKILLの保険とclose待ち、reader.closeを行う。配送先会話をkillする処理ではない。wakeはqueueに残る対象ID、source=vscode、rollout末尾のcompleted/noneだけを対象にOS linkを開く。running/interrupted/unknown、CLI thread、openerなしは起こさない。wokenはqueueが動いた観測で、当該本文の業務完了ではない。Linuxのopenerは未提供。保存wake結果は3日超で掃除する。

`withDeliveryEffect` のadmission未指定は従来動作。required resolver欠測、二重作用、lease外出力を拒否する。serialized wake profileはcallbackを送れないためrequiredを保持する。Claude/Cursorのchannelとadmissionの未接続組合せ、Cursor複数scopeでのadmissionは明示拒否であり、分割ついでに有効化しない。

## 確認範囲と既知の制限

図は現在の作用順序である。private execution・remote内部も初読を完了した。[採用設計](refactor-rationale.md)に従い、A4bでrecord契約、S1でchannel状態を分離した。変更窓口は関連試験と型/保存契約を照合済み。全caller/test/fixtureの独立照合、BellTeamの実consumer、3OSでの動作受入は未確認。Windows73failの根因は未確定である。

## A4b候補の所有者

[製品内の配送記録・進行対応](parent-delivery.md)へ正本を追加した。recordSchema/readRecord/answerMessageはparent-delivery-record、manager/receiptはparent-deliveryに残る。schema/typeと2本体、managerクラス全体の一致を照合済み。図は製品repoへ移管し旧diagramsはsymlink。

## 候補の分離後の接続

# 配送記録と配送進行

[全体](current-overview.svg) → [配送の詳細](parent-delivery.svg)。編集正本は同名DOT。

| 実ファイル・関数 | 所有するもの |
| --- | --- |
| `parent-delivery-record.ts`: recordSchema / DeliveryRecord | 既存strict保存形式、private source/request/origin owner一致、remote契約正本への参照 |
| 同: readRecord | JSONとschema・filename/delivery ID検証。ENOENTを元のまま返し、その他は従来のPARENT_DELIVERY_STATE_INVALIDへ包む |
| 同: answerMessage | 既存の子回答の先頭文、ID/harness/launch/turn/outcomeと本文。本文欠測・turn不明の既存投影 |
| `parent-delivery.ts`: ParentDeliveryManager | 予約、owner/heartbeat、claim、watch/capture、checkpoint、ready/sending/unknown、回収、終了とcleanup |
| 同: receipt | Codex hook stateを伴うreceipt投影。記録moduleへ移動しない |

記録moduleからcore/SSH transportへのruntime importはない。managerの公開type/クラス/exportと通常・private入口は保持する。記録読取を汎用store/queueに変えず、元schemaの検証順・例外・保存fieldと本文をそのまま維持する。

停止・取消・途中失敗・結果不明は従来のmanagerが進行を持つ。checkpoint喪失は元claimと回答を保持し、不明を再送しない。送信receiptは親の業務完了や画面反映ではない。旧形式にprivate execution情報を補完しない。
