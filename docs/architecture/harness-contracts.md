> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 5ハーネスの本人性・完了・回答

基準Aiterm ce575ce8。通常5adapter、Stop hook、steer-follow/interimを全文初読した現在構造。全caller/test/fixtureの確認と実動試験は未完。関数の位置は [対応表](source-index.md)、図は [vendor完了](vendor-completion.svg) / [PNG](vendor-completion.png) と [差込・途中表示](steer-interim.svg) / [PNG](steer-interim.png)。

## 状態の所有と返却

Aitermのmetadataはsession・launch・保存home・vendor bindingを所有し、vendorが会話・入力・turn・本文を記録する。adapterは記録の解釈とCLI/UIの差を持つ。coreは入力排他、操作receipt、公開返却を持つ。BellTeamはreceiptを受けるconsumerで、表示と本体jobを所有する。native起動・入力受付・vendor完了・本文回収・画面描画の到達点を一つにしない。

| adapter / 記録 | 会話本人性 | 完了を待つ位置と終端 | 回答 |
| --- | --- | --- | --- |
| [Claude](../../src/harnesses/claude.ts) / projectsのJSONL + Aiterm Stop result/event | 起動時UUID、保存したreal cwdのslug、per-launch metadata優先。Stopは継承envを持つ別会話を除外 | event byte位置/operation。Stopの同session/launch/vendor/operationと本文SHA/bytes。API errorはStopなしも検出 | owner-only resultの正規file・size・正確なfield・SHA/bytesを検査。operationとの相関を保持 |
| [Codex](../../src/harnesses/codex.ts) / sessions rollout JSONL | 共有home内のroot CLI会話、developer instructionのlaunch印。初回複数候補は拒否。binding後の同process新会話を通常読取が追跡 | rollout byte位置、task_complete/turn_abortedとturn ID。usage_limitとその他errorを区別。休止復帰前のturnを除外 | exact completionでは同turnのlast_agent_message等。通常互換口にはlast final_answer等のfallbackがあり、厳密口と同一視しない |
| [Grok](../../src/harnesses/grok.ts) / events + chat_history | 起動時UUID、保存homeとencoded cwd配下 | event byte位置。turn_ended completed/cancelled/error。send_nowに伴うcancelは継続境界で完了にしない | completed turnのturn_numberと実user prompt_indexを一意照合。次の実userまでの最後のassistant。synthetic入力を除外 |
| [Cursor](../../src/harnesses/cursor.ts) / workspace transcript | 最初のuser本文中のlaunch印、複数一致は拒否。binding後は固定UUID | **user行数**。前turn末尾が次turn開始で書き換わるため、EOF byteを通常完了cursorにしない。新user数と末尾turn_endedを確認 | 完了snapshotの最後の非空text塊。未知partしかない場合はnull、既知の空text/tool_useだけなら空本文 |
| [Antigravity](../../src/harnesses/antigravity.ts) / SessionStart・Stop hook + native transcript | SessionStartでlaunch/env/workspaceと許可配下transcriptを検査してbind。vendor IDの乗換えを拒否 | StopのfullyIdle、execution番号/terminationReason。user stepとexecutionを合わせ、turn別resultを先に保存してevent公開 | native transcript末尾4MiB内のUSER_INPUT後のDONE planner response。user step 0も有効。error側は本文要求を緩めるが成功には昇格しない |

Codexの**停止本人性**は通常完了待ちより厳しい。候補全列挙、symlink/読取失敗拒否、完全headerの印、一意endpoint、前後statと再列挙を照合する。通常読取の新会話追跡へこの一意性を機械的に当てはめたり、停止経路へ通常fallbackを流用したりしない。復帰proofは旧file出生、prefix digest、cursor下限、旧完了turnを保持し、新launchの開始位置と区別する。

## 認証・model・起動UI

model一覧は5通りのnative窓口に依存する。Claudeは一時settingsでhook/MCP/会話保存を抑えたstream-json初期化、Codexは既Steer receiver経由app-server model/list、GrokはmodelsとACP初期化、Cursorはmodels CLIのeffective ID分解、Antigravityはtab形式のmodel選択肢を使う。model/effort/fastの許可組合せとunsupportedはadapter/catalog側で検証する。認証や一覧を読んだことをpromptの実行成功にしない。

Claudeはauth statusのloggedIn陽性を必要とし、Codexはlogin statusとtoken非取得のAPIを照合する（旧API拒否時の互換分岐あり）。Grokは明示auth pathの絶対path検証とnative modelsの判定を分け、否認を一回再確認する。Cursorのpreflightと詳細authStatusには確認条件の差がある。既存差を統一する修理は今回行わない。許可URL・device code・onboardingの解釈をadapterに残し、資格本文は図/原本へ出さない。

pane parserは現composer/現footer/現dialogを優先し、過去の引用や古いrate-limit表示からbusy/blockedを決めない。ready・busy・承認待ち・認証待ち・不明と、vendorのturn境界は別の証拠。cancel keyはClaude/CodexがEscape、Grok/CursorがC-c。readonly sandbox、trustProject、vendor既定引数とuser-defaultの退避/復元もadapter固有。復元の既存best-effortを全設定復元保証へ広げない。

## Stopの公開順序と途中失敗

[Claude Stop](../../src/claude-stop-hook.ts) は結果を一時fileへ書き、短書込確認/fsync/renameの後にdone eventを追記する。event短書込はftruncateで戻す。operation markerは読み取ったdev/inoが一致する場合だけ、event/activity保存後に消費する。失敗はstderr診断となり、偽の完了を作らない。idle clock依頼失敗は取得済みの結果を消さない。v2 markerのcursorは送信前の位置であり、native入力受理や取消完了の証明ではない。

[Antigravity hook](../../src/antigravity-hook.ts) は同turn resultが既存ならreturnし、失敗時は固定診断と空JSONへ収束する。result保存後のevent追記が失敗すると、再hookも既存resultでreturnするため通知が欠測し得る。この作用順序を既存分岐として記録し、今回修理しない。[Grok Stop互換](../../src/grok-stop-hook.ts) は通常Grok events-transcript routeとは別。旧event書込口・配布/test参照があり、通常adapterで使わないことだけを理由に消さない。Claudeとのfsyncやpayload条件の差も既存契約として残す。

## 差し込みと途中表示

[steer-follow](../../src/steer-follow.ts) は送信直前の位置・本文識別子をper-launch台帳へ保存する。保存失敗で送信を止めず、追跡の手がかりが欠測になる。256KiBを超えた台帳は妥当な最新100行へ縮約する。これを配送receiptやvendor受理の証明にしない。

Codexはuser行の先頭160非空白文字（4文字未満は識別不能）とturn IDを追い、Claudeはenqueue/remove/userと、その後の回答SHA・Stopを照合する。識別不能時は既存plain待ちへ戻りplacement=unknownを保つ。Grokは新規historyの**本文全体digest**とprompt_index/turn_numberを一意照合し、照合不能を旧turn完了で代用しない。Cursorはqueue操作で確認した現turnのplain待ち。same_turn/next_turn/unknown/not_takenを混同しない。取消signalは観測のみを止め、入力撤回や席停止を意味しない。

Codexのseat turnは記録上の最後のtask_started/complete/abortedを読むだけで、pane/harness livenessを見ない。harnessが落ちて完了印を書かなければrunningが残る。欠測/書込途中はnull。cache512席、会話再探索60秒、未binding再探索5秒という既存観測間隔がある。保存metadata bindingを書き換えない。

[interim-words](../../src/interim-words.ts) はBellTeam caller印だけへ_metaを返し、dispatch境界または不透明なfrom位置とseqで途中の言葉を読む。Claudeはtool_use前text、Codexはcommentary、Grokは実user後でtool_callsのあるtext、Cursorは後続tool_useで確定したtextだけを対象にする。最終回答・思考は対象外、Antigravityはこの口の対応なし。不正fromを別turnのdispatch境界へ黙って戻さない。boundary書込失敗は送信を妨げず、callerはevent_cursor差を確認する。

## 読取上限・結果不明・未確認

Codex通常待ちは4MiBずつ読み、1行1MiB超をmalformed扱い、巨大未完行を破棄する一方、turn全体は固定総容量に縛らない。Grok通常待ちは開始位置以後の総増分16MiB上限。Grok差込照合は各増分4MiB以内・完全改行・一意照合を要求し、超過/曖昧ならunknown。steerのLineFollowerは4MiB chunkだが未改行carryの独自上限は持たず、interimは対象増分/履歴をまとめて読む。違いを未検証の共通streamingへ置換しない。

not_takenの30秒、完了後の8秒猶予、Grok error後の描画確認、各rate-limit観測間隔などは既動作のまま。private execution、通常PTY待ち/OS/RTK/runtime errors/setup/update/releaseの入口も後続初読を完了した。全test/fixtureとの独立照合と実装受入は未確認。Windows73fail原因は未確定。実vendor/実席試験は今回0。
