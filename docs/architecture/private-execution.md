> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# Private executionの契約・保存・観測

基準ce575ce8。全33private moduleを全文初読し、coreのprivate本人性/中断/管理closeとnative gate接続の該当本体を追加した現在構造。通常core/OSを含む基準全実装の初読は完了。全caller/test/fixtureと実OS動作の網羅確認は未完。通常MCP mainはこのfactoryを既定mountしない。存在するprivate実装を公開の稼働保証へ使わない。

図: [契約と基盤](private-foundation.svg) / [PNG](private-foundation.png)。実関数は [対応表](source-index.md)。

## 所有と契約

| 実装 | 所有するもの / 受渡し |
| --- | --- |
| [execution-contract](../../src/execution-contract.ts) | Zod schema、launch/boundary/request/関係の保持条件、純粋なunfinished抽出とcascade snapshot plan。native作用・待ち・時刻判定を持たない |
| [execution-context](../../src/execution-context.ts) | AsyncLocalStorageに固定requestとtransport ingressを保存。source/metadata/native parentをstructuredCloneし、呼び出しごとのsnapshotを返す。新job IDや「最新job」選択を作らない |
| [execution-wire](../../src/execution-wire.ts) | versioned request/result/meta、typed errorへの射影。host client名bellteamのsource contextと、通常stdio環境を区別する。これはtransport相関であり認証ではない |
| [execution-store](../../src/execution-store.ts) | 同state rootとmultiplexer identityで分離した関係snapshot、stopping、slots、interruptions、participants、既parent delivery IDの付随状態。本文・配送queue・retryを保存しない |
| [execution-checkpoint](../../src/execution-checkpoint.ts) | temp独占作成→file fsync→rename→directory/祖先fsync。完了はmetadata耐久化のOS受付で、native作用の完了ではない |
| [execution-inventory](../../src/execution-inventory.ts) | 宣言済みprocessと残ったrequest/delivery/interruption参照を照合。native actorの出生一致はlaunch/turn/全process列挙やfenceの証明ではない |
| [execution-runtime](../../src/execution-runtime.ts) | 注入された通常core observe/wait結果のschema・session/launch/boundaryと前後観測を検証する。入力callbackやcloseの実装自体は別所有 |

source generationが一致してcaller_boundならsource verified、boundary欠測/不一致は別fieldで残す。verifiedから入力意味の帰属や全入力job網羅を推定しない。launchの世代とrun boundaryは別で、後着turn IDを理由に履歴の識別子を変更しない。delivery/room/call/aiterm/MCPは既存request IDを使い、新たな配送識別子を発行しない。

relationのreserved/unsentはopenのみ。completedにはbound run、interruptedにはbound launchが必要。retiredには未送確定または終端+closed fenceが必要。launch全体の停止計画は途中の完了関係も未完descendantへ繋ぐ場合だけ保持する。全終端のcycleは期限切れとして落とす。source/target世代やboundaryが欠測ならgapを返し、未bound childの世代edgeを捏造しない。pure planはnative停止を行わない。

v1 cascade closeのstopped、v2 interruptのconfirmedは別schemaである。v2は現session/launch/会話の保持と、実interruption、関係coverage complete、unresolvedなしを要求する。Escape/C-cの受付だけではconfirmedにならない。公開との接続状況はprivate-admissionとprivate-stopに記す。

## 保存と途中失敗

snapshotはwriter lock・修復・待ちを持たない。transactionは短いmetadata lockを取り、callback例外なら新snapshotをcommitしない。native作用はcommit後の別工程に置く契約。transactionSyncはPromise結果を拒否し、admitNativeはlock取得を非同期で待ってから同期stack上だけ物理mutexを共有する。nested snapshotを共有してnative作用を巻き戻す仕組みではない。非同期transactionはnativeAdmission中に拒否する。

初期化markerをgraphより先に耐久化し、marker/放棄lock控えがあるのにgraphが欠けた場合は空の成功へ初期化しない。壊れたgraph/schemaはSTATE_UNAVAILABLE。snapshot原子renameと「処理完了」は別である。

checkpointでrename後のdirectory flushが失敗した場合、fileは既に見えていても例外possibleになる。rollbackやissued slot消去、native再実行で補わない。Windowsはこのcheckpointが明示UNSUPPORTED。これをmain Windows73failの原因に代入しない。通常mainから未mount。元73caseの表面化境界は[配布・検証](release-verification.md)へ結合したが、checkpoint未対応との因果は確認していない。

mutexは時間経過で奪わない。既存native出生の照合を要する明示回復はlockだけを解放し、未確定operationや関係を消さない。lock所有者・回復の細部は既読 [状態所有](lifecycle-state-ownership.md) とexecution-lockへ続く。

## 観測と結果不明

runtime sourceはfactory時点の環境snapshot、または固定transport contextから得る。環境の二つのsession名が不一致/不正ならnull。BellTeamのsource未提供は明示unknownとなり、stdio環境や最新jobへ戻さない。sourceEvidenceは現launchを通常observeで確認する。

completionはbound runを要求し、同session/launchを前後と最後に再確認する。operationとsteerの併用は拒否し、steer unknownを完了にしない。typed done/errorだけをcompleted候補とし、fenceは別callbackの陽性証拠がある場合のみclosed。wait closedかつ事後native absenceだけをinterrupted+closedへ対応する。timeout/running/not_taken、malformed、例外、世代交代はunknownを保持する。

participant inventoryは孤立したin-flight parent effectも表示する。probeの例外/非同期結果/重複PID/予期しないPIDを欠測として扱い、登録の穴とnative不一致を分ける。返却は常にparticipant_discovery=unproven/native_fence=unknown/relation_coverage=incomplete。列挙結果だけで停止対象の網羅性を確定しない。

## 詳細と調査の残り

[受付・作用・返却](private-admission.md) → [親配送とnative endpoint](private-parent-delivery.md) → [通常cancel/private中断/管理close](private-stop.md)。service（1450行）、全33private moduleとcore該当本体を初読した。通常core/OS/runtimeも後続初読を完了した。[採用設計](refactor-rationale.md)ではprivateの既存責任分割を維持する。private本体は変更対象外。A4bで変えた記録接点は限定検証済みで、全private caller/fixtureの独立受入・実稼働試験は未実施。
