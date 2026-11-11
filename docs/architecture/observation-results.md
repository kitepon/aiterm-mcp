> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 観測・完了・回答の現在構造

## capacity・利用上限・一時失敗・ログイン切れ

既`AgentWaitObservation`にoptional `failure`を加える。harness adapterが実error記録からcategoryを分類し、core/steerの観測、parent-delivery-recordの保存・検証とreceipt/通知まで同じ値を保持する。outcomeとwait CLI exitの既存対応は維持する。provider失敗は`execution:not_started`を発行しない。既tool/assistant記録は`started`、欠測は`unknown`。`terminal`は当該turn記録だけで、`future_effects:unknown`は旧invocationの遅いhook、queue、native自動再試行、別producerを排除する証拠がない意味である。

Codexは既task_complete.errorの種類/固定capacity文言から分類する。boundaryは元wait cursorとその最初の完了turnとの観測相関で、本文受理・未実行の証明ではない。会話自動追跡で読取先が変わればboundary=null。steerは分類を保持しても境界の受理証明へ昇格せずboundary=null。

Claudeは初手/dispatchの入力前、既operation marker v3へ生成したinput_id、元event_cursor/op、vendor会話、transcript cursor/BigInt由来のdevice/inode文字列を必須保存する。保存失敗なら入力前に拒否する。before_sendの親watchがmarker作成より先でも、期限/signal内で出現を待ってから送信前位置を採用する。APIエラーはroot・同sessionの記録だけを読み、最初のuser以後のparent UUID鎖を照合する。後続の別user入力は対応を失効し、tool_resultだけは同じ鎖として追う。正規root user/error鎖が欠ければboundary=null/terminal=false。画面上限だけでも同様。CLIの`error`欄が`rate_limit`のAPIエラー記録は、文面やHTTP状態の有無に依らず`rate_limited`。`error`欄が`authentication_failed`か`apiErrorStatus`が401の記録は`authentication`（0.70.23。実測2.1.310/2.1.319はapiErrorStatus無しで`Login expired · Please run /login`／`Not logged in · Please run /login`）。両方とも無い記録だけ、文の`Please run /login`・`OAuth token revoked`・`Invalid API key`で`authentication`。利用上限の判定が先。利用上限ではStopも走るため、done eventを得た時はStopの時刻までの最後のroot・同session記録を見て、それがAPIエラーのassistant行ならdoneでなくerrorを返す（先にuser行が来たら判定しない。前の番の誤りを持ち出さない）。これはnativeの本文受理/旧producer停止receiptではない。

Stop hookはv3 markerのinput_idをagent_doneへ保持し、bound waiterは成功eventも同じIDだけを読む。markerが次の入力へ変われば拒否する。hookが記録したIDはその時のAiterm予約との対応で、native turn取消/非波及/将来作用fenceへは使わない。旧v1/v2 markerは互換読取し、旧StopにIDを後付けしない。新しい呼出元は返りのwait_processをそのまま実行する。remoteも同じinput IDを転送し、親watch/beforeChange/再構築は保存した元IDを保持する。

基準Aiterm ce575ce8。図は [観測と結果](observation-results.svg) / [PNG](observation-results.png)。公開index全文、agent-shared/resolver/screen-observationとwait CLIを初読し、coreの観測・metadata・完了・回答取得の該当本体を辿った。通常5harnessとsteer-follow/interimの全parserも初読し、[vendor詳細](harness-contracts.md)へ分岐を追記した。全fixture照合は未完。

| 問い | 窓口と所有 | 何を返すか / 何を確定しないか |
| --- | --- | --- |
| どの席・起動か | `pty_list` / core.listSessionsResult、metadataとactive pointer | session/launch/harness/vendor ID。MCP入口はidle clock維持も呼ぶ（`maintainAgentIdleClocks`: tmuxで生きている席だけ、全clock ownerを1回のprocess読みで確かめ、ownerの居ない席だけcheckerを起こす。0.70.16。前は休止・閉じた席にも毎回checkerを起こしていた）。単なる一覧表示をfresh操作admissionへ代用しない |
| 今そこにいるか | `pty_observe` → observeSession / observeSessionNative | 正規native一覧→pane PID/dead→process表→launch argvまたはsubtreeからharnessを選択。0件/複数候補/Windows終了追跡はfalse/null/ambiguousを区別する。raw画面/argvを返さない |
| 何をしているか | observeNativeSession → agentPaneObservation → harness parser | busy/idle/blocked/unknownとreason。stopped processもblocked。画面のidleだけでturn完了や本人性を確定しない |
| 前回との差 | activity cursor → decodeActivityCursor | sessionとpane出生identityが一致する時だけoutput digest/CPU差分を返す。processが消えた差分はcomplete=false。初回・作り直したpaneはnull。起動控えの親/argv shapeで既存足場の立て直しを除く |
| 子の作業が終わったか | observeAgentDone / aiterm-wait | 固定launch/cursor/operationからdone/running/timeout/closed/rate_limited/error/not_taken。終了観測と成功/本文は別。CLI exitはこのoutcomeの射影 |
| 本文はどれか | `pty_read(agent_transcript:true)` → readAgentTranscriptResult | 同session/launchのdoneとturn/operationを照合してharnessごとの記録から本文を回収。空の本文はtext=""/answer_empty=true、取得不能は例外。旧回答を新完了へ流用しない。Claudeは`input_id`（dispatch receiptの値）でその入力のagent_doneへ束縛でき、後の番のactive markerでは拒否しない |
| 画面や通常PTY出力は何か | `pty_read` → readOutput / waitCompletion | screen snapshotまたはlogの増分。offsetは読取側state。rangeはoffsetを進めず、UTF-8の端を調整、巨大fullは上限。terminalのsentinel/until/静止はagent turn完了とは別 |
| BellTeamの途中表示 | `aiterm/caller` metadata → seatTurnsMeta/interimWordsMeta | 席turn・差込追跡・合間の言葉を専用_metaに載せる。対応しないcallerへ付けない。欠測/不正fromはerror射影で、最後の別turnの言葉を代用しない |

## metadataと本人性

agent-sharedがstate root・per-launch path・generation pointer・共通型を所有し、agent-metadata-reader.loadAgentMetadataがharness別の記録検証を持つ。session名/launch形式、event path、resumed_fromとpointer、hook route、per-launch home、lineage、Claudeのresult/settingsとoperation digest、Grokの認証正本を確認する。Codex/Cursor/Grok homeは保存された絶対pathを使い、現在のMCP環境のhomeへの一致を要求しない。

pointer欠測でmetadataが複数なら拒否、壊れたpointerを最新file選択で補わない。`tryLoadAgentMetadata` は例外をnullへ畳む便宜口なので、strict loaderと同じ意味で図示しない。agent pathの一部はensureStateRootを経るため、観測API全体をfile生成もない純粋関数としない。

hibernatedはlifecycle/recipe、native不在、metadata不変を再確認した場合だけ返す。stopping/resuming/failed/unknownとnative衝突はunknownのまま。古いpaneのactivity cursorを休止後の差分へ使わない。

## 完了を待つ流れ

cursorはdispatch receiptの境界を優先し、Claudeのoperationがあれば0、両方なければwait開始時EOFを使う。Codex/Cursor/Grokは既定routeのvendor transcript、Claude/Antigravity等のevent routeは改行完結イベントを増分走査する。イベントのvendor/session/launch/operationと必要digestを検査し、曖昧vendor IDや容量超過を拒否する。rate limitは過去logでなく現画面またはvendor turn記録で読む。

timeout=0の一回観測で未完ならrunning、それ以外はtimeout。取消signalはobserverを止め、PTY/子turnを止めない。外部waiterはmetadata binding/送信lockを所有しないが、done/errorを得るとactivityのturn_end追記とidle clock要求を行う。この記録に失敗しても本物の完了resultは保持し、診断だけstderrへ出す。CLI冒頭の「純リーダー」はこの限定付きで読む。

wait CLIはdone0/running5/timeout3/closed4/rate_limited6/error7/not_taken8、自身の失敗1。rate limitをauth欠測から補う旧Grok互換は期待launchなしの場合だけで、現在viewportの陽性証拠を必要とする。exitだけを回答本文や正常終了の証明にはしない。

### Claude answer bound to one input (Kiro request, 2026-11-08)

`pty_read(agent_transcript:true, input_id)` binds the read to the Claude input that `pty_send` returned in its dispatch receipt. Unbound reads mean "latest turn of the seat", so the next input (its active marker, or its overwrite of the single per-launch `claude-result.json`) breaks a read that started after the earlier turn ended.

| Step | Owner | Result |
| --- | --- | --- |
| Validate | index pty_read schema → readAgentTranscriptResult | `input_id` is 32 lowercase hex, Claude session only, not with `operation_id`; otherwise argument error |
| Select | latestAgentDoneEvent(meta, null, inputId) | newest agent_done in the event tail whose `input_id` matches. The active operation marker is not consulted: a later turn does not own this read |
| None yet | readAgentTranscriptResult | `AITERM_TRANSCRIPT_INPUT_PENDING` (retry later; nothing is resent) |
| Read | harnesses/claude.readClaudeResultText | result file must match that event's digest/bytes; a later turn already written → `AITERM_TRANSCRIPT_INPUT_REPLACED` (terminal for this input, no older copy kept) |
| Return | unchanged `aiterm.pty-read-result.v1` structuredContent | same text / answer_empty / correlation fields as the unbound read |

Existing transcript read errors carry a code token first, rendered by the MCP error path as `aiterm: <CODE>: <text>`: `TRANSCRIPT_TURN_ACTIVE` (active Claude marker on an unbound read), `TRANSCRIPT_UNAVAILABLE`, `TRANSCRIPT_NOT_FOUND`, `TRANSCRIPT_RESULT_MISMATCH`. Callers match the token, not the text. Per-input result retention is not added: one result file per launch stays the storage contract, and INPUT_REPLACED is the named exit when it has moved on.

回答回収はtimeout後も本文を再送せず行える。Claudeのactive operation markerがあればStop公開とmarker消去の短い待ちを経てもactiveなら拒否する。harness sessionの後着bindingを回収側が保存する一方、完了waiterはbindingを書かない。`completion`付き内部回収はdone/session/launch、必要なturn/operationとの一致を確認し、置換は拒否する。raw=trueで親配送は縮約を避ける。人向けdisplayの空回答通知やメタと、機械向けtextを混同しない。

screen-observationはsample/sleep/clockを引数で受け、native入力を持たない。ready連続観測、settled-turnによる短縮、起動echoだけの場合の初回描画待ち、既知modal、submit residueの有界観測を所有する。0.63.15の通常readyは連続11観測、または2回以上の連続idleで最初と最後の観測完了が5秒以上離れていれば成立する。速い観測は従来の500ms×10間隔、遅い観測は同じ安定期間を2〜3回で確認する。最初の観測自身の所要時間は期間へ入れず、non-idleとsettled取消で起点を数え直す。既存のsettled2回/100ms短縮と各期限は保持。residue=falseは「残存未観測」、submit成功ではない。done後の画面settleも描画安定の観測で、turn完了の起点ではない。

### 0.63.15 readiness function map and state/data flow

`core.waitAgentTuiReady` / `waitAgentTuiReadyByKind` -> supplied native screen sample + monotonic clock -> `waitAgentTuiReadyImpl`. It owns only counters/time, never input or native metadata. `readyStreak=0` -> first idle completes -> capture readySince; next consecutive idle -> existing sample-count rule OR >=2 observations spanning `(stableSamples-1)*pollMs`; established-settled path retains2samples/100ms. Non-idle resets both count and origin, known modal returnsblocked, settled true-to-false starts again at current sample. Positive deadline is rechecked after synchronous screen/transcript reads before ready/steer can authorize the next core step. Expiry returnsfalse; startup-echo extension retains its existing ceiling. There is no edge from expiry to a longer stabilization budget or from an unknown frame to input. The next native admission still checks current generation/harness before paste and Enter.

This changes the sampling contract, not the RPC deadline: slow observations produce fewer samples within the same stabilization duration and do not extend the wait beyond its existing deadline. Sparse positive frames cannot exclude an unobserved intermediate redraw. MCP cancellation is not a certificate that native input was stopped; a timed-out invocation remains unknown and must not be replayed.

## 未確認

MCP createAitermServerはschema・親配送・remote wrapper・typed error変換を所有し、importだけではstdio/diagnostics/reporterを起動しない。mainは既定factoryを起動し、private execution factoryを渡さない。private実装が存在することと、通常製品の経路で有効なことを分ける。oncloseは親配送managerのcloseを呼び、native席を一律closeしない。

通常PTYのwaitCompletion内部、reducer/RTK、private executionも後続初読を完了した。全caller/test/fixture独立照合は未確認。実装初読と公開schema読了を全caller/全fixtureの確認とはしていない。Windows73failの原因は未確定のまま。

## FactoryのPTY readiness

`diagnostics {}`は既factory v1と親hookの2textを維持する。同toolの`format:"v2"`は第1textをfactory v2にし、PTYの固定`reason_code`を追加する。tmux-runtimeが選択binary/同socketのread-only一覧と依存解決を共通5000msのsubprocess予算/1MiB上限で実行、coreが成功・厳密不在・依存/権限/期限/信号/出力過大/未知を射影する。stdout/exit1/選択SOCKの完全一致が揃ったcoldだけnot_applicable。広いfailed-to-connectや他socket/相反stdoutを不在扱いしない。native書込・PTY作成・認証/AI無し、OSの同期syscallやschedulingのhard realtime保証はしない。legacy非診断nativeの期限/返却は維持。


## A-1 managed observation spans (Root/Kiro15:24, 2026-11-07)

This section supersedes Codex-only seat activity. Public seat-turns.v1 retains row and six running keys. Codex tracking remains unchanged. Other four use an opaque Aiterm-managed observed parent-work-span ID and the captured start of the observed span, with event_cursor/interim_from/wait_process explicitly null. This is not a vendor-native UUID or historical native birth.

| Function | Ownership/effect |
| --- | --- |
| `core.readSeatTurns` | Existing synchronous caller opt-in; Codex unchanged; other four invoke current native observation. Dormant behavior retained. Codex fresh launch (0.70.16): Codex writes no rollout before its first input, so `codexSeatTurn` reads null; `freshCodexSeatTurn` answers idle only when `steer-follow.codexSeatAwaitingRollout` (unbound launch, last look found no rollout), the activity record is tracked with no `input` (Aiterm records every input it types, prompt launch included), and `observeSession` reads the pane idle. Any recorded input leaves the rollout as the only source (null until it exists). Per-seat existence checks (`observeSession`, `observeSessionNative`, auth/parent reads) use `nativeSessionExists`: the same tmux listing and failures as pty_list, names only, so one seat no longer loads every seat's metadata (0.70.25; before, cost grew with seats squared: 10-27 s for ~140 members on production). |
| `core.readManagedSeatTurn` | Existing single-worker/process/native selection, current visible frame with no scrollback, and matching post-read generation/birth. Reject failed/over15s reads, stopped/ambiguous/dead workers. Use the managed-span owner-token mutex only for identity transition serialization; a lock held by another live reader yields `SPAN_HELD`, and `readSeatTurns` lists that seat in `unread` with no row (0.70.10; before, a null turn), dead owner uses existing reap. Protects span identity from concurrent overwrite; owner release/dead-owner reap exits contention. No input is sent and no settings change. |
| `agent-screen-observation.parentPaneEvidence` | Reuse native harness parser and constrain to actual composer/progress/footer. Queue/preprompt spinner/quoted output are not occupancy. Current parent busy/attached wait always wins over old completion. Claude: an idle block that starts with `⏺ Compacted while idle` is `ready_compacted` (0.70.10). |
| `managed-seat-turn.observeManagedSpan` | Atomic0600 per-launch `.seat-span.d/span.json`, original pane/worker birth/current conversation binding. Persist immutable ID/start only on positive live work, not inputs. No periodic active writes. Persistence is identity bookkeeping, never freshness. |
| Terminal/recovery | Positive native root completion corroborated by settled whole-parent ready ends span. First ready sample is not terminal; confirm on a later valid read. A launch binding that has recorded neither a span nor a terminal (fresh seat, nothing ever busy) settles ready, or Claude `ready_no_completion`, the same way to idle with no terminal; once a span or terminal was recorded, an unreadable terminal stays null. Busy continuation/Stop veto/child completion does not end span. Claude idle compaction shows a busy spinner and sends no Stop: its `ready_compacted` notice, settled like ready, ends the span without a new terminal (0.70.10; before, the span stayed open and every read was null until the next real turn). Unknown/failed read yields null and retains identity only. Restart reconciles stored binding with fresh live evidence; corrupt state stays null until a positively settled idle boundary can reset it. Changed binding captures a new observed span without borrowing old identity. |
| `core.cleanupAgentState` | Existing logical close removes new per-launch identity file; native runtime/global/vendor files unaffected. |

DFD: existing pty_list metadata -> readSeatTurns -> Codex existing tracking OR original live pane/worker -> current visible frame -> harness parent evidence + existing root completion -> post-read same generation/birth/freshness -> managed span identity -> six-key running / positive idle / raw null -> unchanged seat-turns.v1 -> Kiro all-five CurrentWork. Legacy wait remains Codex-only.

State transitions: no span + positive busy => capture ID/start; fresh binding (no span, no terminal, no current terminal) + settled ready or Claude ready_no_completion => idle; active + fresh busy/attached wait => retain; active + ambiguous => raw null with identity retained; active + native terminal plus repeated settled ready => retire and idle; idle + positive busy => new ID/start. Late/child terminal while busy => retain. Invalid binding => no old identity; missing observations never become terminals. A silent wait without a distinguishable native occupancy cue stays unavailable; detached child is not parent proof. An observed span does not certify invisible native transitions between polls.

Affected checks: four live-frame branches, queue/hook/output false positives, long unchanged wait and absorbed steer, positive terminal/late child/Stop veto, identity persistence/restart/current generation, loss/corruption/concurrent capture, six keys/null tracking. Build/new fixtures only; no old successful suites or native/probe/AI launch. Source candidate is not real-host latency or3OS acceptance.


## A-1b start position and terminal seats (Kiro, 2026-11-10)

Supersedes the null `interim_from` above for Claude and Grok rows. Other fields and rules of A-1 stay.

| Function | Ownership/effect |
| --- | --- |
| `core.managedSpanStart` | Claude/Grok only: `interimFromToken(interimFromNow(meta, agentCompletionCursor(meta)))`, the same token grammar as steer (`v1:<c>:b:<byte>` Claude, `v1:<c>:u:<users>` Grok). Cursor rewrites its transcript tail at turn start and Antigravity has no word reader: null. A read failure is null. |
| `managed-seat-turn.observeManagedSpan` | Each positive settled idle stores `settled_from` = start position of the binding's next span (written only when it changed). A new span copies it to `span.interim_from`; a binding never seen settled idle, or a changed binding, gets null. A running row returns the stored value unchanged on every read. event_cursor and wait_process stay null. |
| `index.seatTurnsMeta` (pty_list, caller opt-in) | Local rows as before, then for each terminal in `terminal-seats.json` one relayed `pty_list` with the same request `_meta`; only that terminal's own bound sessions are taken from its `aiterm/seat_turns`. Terminals are called in parallel within 4 s. A terminal that fails or does not answer in time contributes no rows, and its bound sessions are listed in `unread: [session_id]` (0.70.7): no observation this tick, not gone. A session missing from a terminal that did answer is absent. `unread` is present (possibly empty) whenever the caller opted in. No call without bound sessions. Overlapping callers with the same request `_meta` share one in-flight relay per terminal (0.70.10), and the terminal's own `unread` (seats another reader held) is kept for that terminal's bound sessions. The relays start before the synchronous local read (one `setImmediate` yield after creating them, because `callRemoteTool` spawns its ssh only after an `await`; before 0.70.16 every relay actually started after the local read), and their 4 s is event-loop time (`remote.loopDeadline`: a blocked stretch counts at most 150 ms), so another call's synchronous read cannot run the budget out while the answer waits in the pipe (0.70.11; before, overlapping calls left most relays `unread`). The relayed request's own timeout is 15 s wall clock. |

DFD: settled idle -> transcript position token -> span.json `settled_from` -> next busy -> `span.interim_from` -> seat-turns.v1 row -> BellTeam watchTurn interim reads from that token (BellTeam execution owns the watch). Terminal seats: pty_list (BellTeam marker) -> bound terminal relay pty_list (same `_meta`) -> remote readSeatTurns -> filtered rows appended; no answer in 4 s or a failed call -> that terminal's bound sessions in `unread`; the terminal's `unread` -> filtered to its bound sessions -> appended to `unread`.

Affected checks: managed-seat-turn start position test (settled position, late busy poll, new binding null); remote relay `_meta` test. Words between the settled idle and the new turn's first busy poll belong to the new turn because a settled idle has no running words.

Implementation refinement before source: the observer uses a per-launch `.seat-span.d` directory with atomic0600 identity JSON. Its short cross-reader mutex publishes a fully written nonempty owner directory by rename, so no partially written lock can become authoritative. It never waits: contention returns null. Existing PID/birth observation reconciles a dead/reused owner; one atomic rename to the old directory inode's retained nonempty quarantine prevents competing recovery from moving a new owner. Normal owner release removes only its own inode/token. Quarantines remain until existing logical-close cleanup. This protects identity overwrite only; it is not an input lock, native work fence, heartbeat or activity evidence. Positive live capture happens inside the short identity transaction; successful reads do not rewrite active IDs. Unknown external state corruption stays unavailable until a positive settled idle boundary repairs identity, rather than fabricating a start. No synthetic timers refresh activity.

Current-frame harness dispatch stays in the existing sole screen-dispatch owner `agent-screen-observation.ts`; `managed-seat-turn.ts` owns identity/persistence only. Native capture is rechecked against the15s budget after bookkeeping/release, and non-Codex rows that age out while later seats are read become null before the shared reply. Codex timing/tracking behavior remains inherited.

Terminal witness identity comes from complete stable native records, never read-time fallback timestamps. Cursor/Grok adapter-generated observation `at` is excluded; classic hook events must have their own captured parseable `at` in the matching raw record. A partial tail or changed file generation cannot furnish a new terminal.

Implemented idle needs an existing complete root completion record and repeated current readiness (>=250ms), except the fresh binding above that never recorded a span or terminal. It does not use a completed-looking UI line as a fallback. Missing completion remains null even if a composer is visible; positive current occupancy can still yield working. Existing registered vendor binding/path is reused, without claiming a live private native UUID reader. The narrow frame readers inherit installed-version UI limitations; real-host performance and3OS runtime acceptance remain unmeasured.

Platform refinement: native stopped=true is an unavailable capture; Windows stopped=null means that optional OS detail is not supplied, and does not negate a positively live/occupied original worker. The new metadata fixture uses mocked platform-native process replies on each OS; it never invokes tmux/psmux, PowerShell or a vendor CLI.

Test-contact refinement: the four pure native-frame/span checks remain in managed-seat-turn.test.mjs; the one mocked native metadata/projection case is managed-seat-turn-core.test.mjs. Mac fixture now uses the existing grokEventsTranscript path builder instead of realpath-normalizing its own cwd (macOS /tmp→/private/tmp). This is fixture construction only; production runtime bytes are unchanged from445ff55. Existing successful Linux/Windows and Mac pure checks are inherited; rerun only the failed Mac core contact.

Quiet-wait refinement before source: Claude's composer is present during work, so composer visibility plus an old/late Stop is insufficient to settle a span. Claude readiness for this activity projection additionally requires the current native completed-progress line (star-prefixed, `for` duration, no running ellipsis). Plain composer/no occupancy/no completed-progress is `ready_no_completion` (not ready): observeManagedSpan treats it as unknown whenever the binding recorded a span or terminal or a current terminal exists, even when a late completion record exists. Only a fresh binding that never saw work (a no-prompt launch such as after a harness switch has no turn and so no completed-progress line) settles it to idle after the same 250 ms. This changes only the activity reader; ordinary input readiness remains unchanged.
