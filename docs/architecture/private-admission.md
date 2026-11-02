> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# Private実行の受付・native作用・返却

基準ce575ce8。private全33moduleを初読した現構造。図 [受付と返却](private-admission.svg) / [PNG](private-admission.png)、[全private関数対応](source-index.md)。通常mainはprivate factoryを渡さない。稼働経路へ有効化して調べたものではない。

## 呼出元と固定データ

`createAitermServer(options.execution)` の明示注入だけがdispatcherをtools/callへ取り付ける。SDK requestId・process PID/出生・initialize client名・request metadataを同期snapshotし、tool引数や最新jobからsource/操作種別を作らない。非同期lookup前にparent証拠も固定する。入力本体はhandlerへ渡すcopyであり、共有execution storeへ保存しない。

読むだけのroute、inspect、status(sessionなし)、recover等はhandlerへ直接渡すが、通常APIの副作用まで純粋になる意味ではない。agent goal inspectのnative UIなどは [goal/認証](goal-configuration-auth-remote.md) の既存挙動を保持する。participant検証自体はread routeの前にも走る。

BellTeamからは既delivery/room/call refを必要とし、refなしの通常送信を新MCP requestへ付け替えない。例外は空agent_launch・管理close/configure/goal/auth等の明示management。外部refはBellTeamのlaunch/sendだけ、MCP refのtool引数借用は禁止。remote・自動session名・非managed世代・欠測native processは既存制限として拒否する。authだけ専用name allocatorで先に名前を決め、native作成receiptで出生を確定する。

## 受付から作用まで

| 段階 | 所有と保存 | 失敗・取消 |
| --- | --- | --- |
| register | serviceが元request/source/期待target世代を保存。元refの同一再照会はlookup、異なる内容はconflict | native作用なし。source stale・target unknown・停止中・slot競合は拒否 |
| preparing | deferred invokeが実引数のtargetと予約を照合。preflight/ready待ちの間は未発行 | 作用前のcancelは元request tombstoneとnot_sent。新たな送信や席全体停止はしない |
| prepare | 同期transaction内のmetadata準備。before_send boundaryやcompanionを固定 | Promiseの返却・native作用の混入を拒否。refused frameはpoisonされ、catchで握り潰しても成功にしない |
| issued | 最初の実native command直前にsource/target/停止/slot/出生を再検証し、issued slotを耐久commit | commit失敗なら作用を許可しない。rename後の耐久化失敗はpossibleのまま |
| native body | effect gateが同session/native IDへの許可commandを通す。await後の次commandでも再検証 | unknown slotや世代交代後の次作用は拒否。callback/キーを再試行しない |
| returned + bind | 固定slotを残し、現世代を観測してから同slot/元recordと返却targetを再照合・commit | 起動/入力は返ったがbindingをcommitできなければunknownを保存。既成功receiptを消さない |

`invoke`（従来の注入口）はbody前にissuedを保存し、`invokeDeferred`は同期issue callbackまでpreparingを保つ。両方を一つの作用時点として図示しない。未発行noopはtarget=nullを許すが、作用後のtarget=nullは妥当なbindingではない。

sourceの普通input issued slotには、同世代の相互送信を妨げない限定例外がある。sourceのunknown・management・creation slotは例外にしない。target slotは同名席の作用を直列化する。native scopeの再入は物理mutexを共有するが、各transactionのsnapshot/commitは別である。

## native gateと起動の出生

`execution-effect` のALS frameは、session、issue/preparation callback、許可native ID、最初のbefore_send位置、最初の失敗を所有する。`guardTmuxExecution` は実command queueを走査し、exact session selectorまたは先にbindしたnative IDへ限定する。unknown/run-shell/kill-server等への迂回を拒否し、global optionも既環境更新用途に制限する。interrupt frameは指定native IDへの指定key一回と観測commandのみ。native作用が準備callback内に現れたら拒否する。

`tmux-runtime.runTmux` はguard→pinned pane routing→native条件queueの順で変換する。POSIX sttyのようにtmux外の作用は`beforeExecutionEffect`で対象TTYと世代を直前再確認する。共通runtimeも基準初読済みだが、この境界の確認を全OSの動作受入へ拡張しない。

新規作成はpreparation時のserver出生/absenceと、実`new-session -P -F`のnative ID・session名・server PID receiptを照合する。cold serverはその実receipt PIDを再観測して固定する。native ID保存後、managed metadata公開時にlaunchをbindする。新しい同名観測だけで自分が作成した世代へ採用しない。実receiptはsource停止が後着しても保存するが、次の作用許可にはしない。mounted graphはresume transitionを持たず、休止復帰をcreationに偽装しない。

## 結果不明・完了・後始末

handlerがisErrorなら原拒否を保持し、serviceがgate通過有無を別に判定する。native bodyがcleanに返ったreceiptは、後のbindingやcancel記録の失敗でもisErrorへ反転させず、`aiterm/execution_error`のstatus-only不確定を付加する。frame内の握り潰されたnative拒否はclean receiptにならない。元入力を再送する権利は生じない。

SDK AbortSignalはこのrequestの後続未発行stageを止める。callbackから戻った本物のreceiptやissued/accepted/unknown slotは消さず、キー・close・descendant全体の停止を推定しない。終了時は同refのcancel記録を確認し、失敗しても成功receiptを保持する。

runtimeのcompletionはnative waitと世代を検証しfenceを別評価する。**serviceの関係lifetime**は別で、元canonical receiptのtyped完了を再観測し、既slot/unknown操作/親effectがなく、parent returnも終われば当該呼出のtarget_fenceをclosedへ進める。これは全native actorの終了や包括的native fenceの証明ではない。親返送が残ればunknownを保つ。完了観測はwriter lock外で行い、commit時に元recordの変更がないか再確認する。roots/一部nondeferred・管理経路等にはlock内の観測も残る。

`reconcile_launch` は実作成native/serverとraw initial_prompt=none・未配送・同世代・alive/idleを確認できる空起動だけをacceptedへ進める。失われたRPC receiptを再現したとは言わない。終了済みの空起動の明示`close_launch`は別management requestで、一個のunknown launch slot・native本人性・harness false等を検査してclose/absence/metadata commitを結合する。元失敗recordは保持する。通常のunknown sendを明示closeが解放できる限定分岐と、実行中issuedを拒否する条件も維持する。

通常core/OS/runtimeの基準初読は完了。全caller/test/fixtureの独立照合は未完。実入力・起動・close・設定・稼働操作は今回0。
