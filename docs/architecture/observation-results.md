> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 観測・完了・回答の現在構造

## capacity・利用上限・一時失敗

既`AgentWaitObservation`にoptional `failure`を加える。harness adapterが実error記録からcategoryを分類し、core/steerの観測、parent-delivery-recordの保存・検証とreceipt/通知まで同じ値を保持する。outcomeとwait CLI exitの既存対応は維持する。provider失敗は`execution:not_started`を発行しない。既tool/assistant記録は`started`、欠測は`unknown`。`terminal`は当該turn記録だけで、`future_effects:unknown`は旧invocationの遅いhook、queue、native自動再試行、別producerを排除する証拠がない意味である。

Codexは既task_complete.errorの種類/固定capacity文言から分類する。boundaryは元wait cursorとその最初の完了turnとの観測相関で、本文受理・未実行の証明ではない。会話自動追跡で読取先が変わればboundary=null。steerは分類を保持しても境界の受理証明へ昇格せずboundary=null。

Claudeは初手/dispatchの入力前、既operation marker v3へ生成したinput_id、元event_cursor/op、vendor会話、transcript cursor/BigInt由来のdevice/inode文字列を必須保存する。保存失敗なら入力前に拒否する。before_sendの親watchがmarker作成より先でも、期限/signal内で出現を待ってから送信前位置を採用する。APIエラーはroot・同sessionの記録だけを読み、最初のuser以後のparent UUID鎖を照合する。後続の別user入力は対応を失効し、tool_resultだけは同じ鎖として追う。正規root user/error鎖が欠ければboundary=null/terminal=false。画面上限だけでも同様。これはnativeの本文受理/旧producer停止receiptではない。

Stop hookはv3 markerのinput_idをagent_doneへ保持し、bound waiterは成功eventも同じIDだけを読む。markerが次の入力へ変われば拒否する。hookが記録したIDはその時のAiterm予約との対応で、native turn取消/非波及/将来作用fenceへは使わない。旧v1/v2 markerは互換読取し、旧StopにIDを後付けしない。新しい呼出元は返りのwait_processをそのまま実行する。remoteも同じinput IDを転送し、親watch/beforeChange/再構築は保存した元IDを保持する。

基準Aiterm ce575ce8。図は [観測と結果](observation-results.svg) / [PNG](observation-results.png)。公開index全文、agent-shared/resolver/screen-observationとwait CLIを初読し、coreの観測・metadata・完了・回答取得の該当本体を辿った。通常5harnessとsteer-follow/interimの全parserも初読し、[vendor詳細](harness-contracts.md)へ分岐を追記した。全fixture照合は未完。

| 問い | 窓口と所有 | 何を返すか / 何を確定しないか |
| --- | --- | --- |
| どの席・起動か | `pty_list` / core.listSessionsResult、metadataとactive pointer | session/launch/harness/vendor ID。MCP入口はidle clock維持も呼ぶ。単なる一覧表示をfresh操作admissionへ代用しない |
| 今そこにいるか | `pty_observe` → observeSession / observeSessionNative | 正規native一覧→pane PID/dead→process表→launch argvまたはsubtreeからharnessを選択。0件/複数候補/Windows終了追跡はfalse/null/ambiguousを区別する。raw画面/argvを返さない |
| 何をしているか | observeNativeSession → agentPaneObservation → harness parser | busy/idle/blocked/unknownとreason。stopped processもblocked。画面のidleだけでturn完了や本人性を確定しない |
| 前回との差 | activity cursor → decodeActivityCursor | sessionとpane出生identityが一致する時だけoutput digest/CPU差分を返す。processが消えた差分はcomplete=false。初回・作り直したpaneはnull。起動控えの親/argv shapeで既存足場の立て直しを除く |
| 子の作業が終わったか | observeAgentDone / aiterm-wait | 固定launch/cursor/operationからdone/running/timeout/closed/rate_limited/error/not_taken。終了観測と成功/本文は別。CLI exitはこのoutcomeの射影 |
| 本文はどれか | `pty_read(agent_transcript:true)` → readAgentTranscriptResult | 同session/launchのdoneとturn/operationを照合してharnessごとの記録から本文を回収。空の本文はtext=""/answer_empty=true、取得不能は例外。旧回答を新完了へ流用しない |
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

回答回収はtimeout後も本文を再送せず行える。Claudeのactive operation markerがあればStop公開とmarker消去の短い待ちを経てもactiveなら拒否する。harness sessionの後着bindingを回収側が保存する一方、完了waiterはbindingを書かない。`completion`付き内部回収はdone/session/launch、必要なturn/operationとの一致を確認し、置換は拒否する。raw=trueで親配送は縮約を避ける。人向けdisplayの空回答通知やメタと、機械向けtextを混同しない。

screen-observationはsample/sleep/clockを引数で受け、native入力を持たない。ready連続観測、settled-turnによる短縮、起動echoだけの場合の初回描画待ち、既知modal、submit residueの有界観測を所有する。residue=falseは「残存未観測」、submit成功ではない。done後の画面settleも描画安定の観測で、turn完了の起点ではない。待ち時間・sample数は今回変更しない。

## 未確認

MCP createAitermServerはschema・親配送・remote wrapper・typed error変換を所有し、importだけではstdio/diagnostics/reporterを起動しない。mainは既定factoryを起動し、private execution factoryを渡さない。private実装が存在することと、通常製品の経路で有効なことを分ける。oncloseは親配送managerのcloseを呼び、native席を一律closeしない。

通常PTYのwaitCompletion内部、reducer/RTK、private executionも後続初読を完了した。全caller/test/fixture独立照合は未確認。実装初読と公開schema読了を全caller/全fixtureの確認とはしていない。Windows73failの原因は未確定のまま。

## FactoryのPTY readiness

`diagnostics {}`は既factory v1と親hookの2textを維持する。同toolの`format:"v2"`は第1textをfactory v2にし、PTYの固定`reason_code`を追加する。tmux-runtimeが選択binary/同socketのread-only一覧と依存解決を共通5000msのsubprocess予算/1MiB上限で実行、coreが成功・厳密不在・依存/権限/期限/信号/出力過大/未知を射影する。stdout/exit1/選択SOCKの完全一致が揃ったcoldだけnot_applicable。広いfailed-to-connectや他socket/相反stdoutを不在扱いしない。native書込・PTY作成・認証/AI無し、OSの同期syscallやschedulingのhard realtime保証はしない。legacy非診断nativeの期限/返却は維持。


## A-1 managed observation spans (Root/Kiro15:24, 2026-11-07)

This section supersedes Codex-only seat activity. Public seat-turns.v1 retains row and six running keys. Codex tracking remains unchanged. Other four use an opaque Aiterm-managed observed parent-work-span ID and the captured start of the observed span, with event_cursor/interim_from/wait_process explicitly null. This is not a vendor-native UUID or historical native birth.

| Function | Ownership/effect |
| --- | --- |
| `core.readSeatTurns` | Existing synchronous caller opt-in; Codex unchanged; other four invoke current native observation. Dormant behavior retained. |
| `core.readManagedSeatTurn` | Existing single-worker/process/native selection, current visible frame with no scrollback, and matching post-read generation/birth. Reject failed/over15s reads, stopped/ambiguous/dead workers. Use the managed-span owner-token mutex only for identity transition serialization; a busy lock yields null, dead owner uses existing reap. Protects span identity from concurrent overwrite; owner release/dead-owner reap exits contention. No input is sent and no settings change. |
| `agent-screen-observation.parentPaneEvidence` | Reuse native harness parser and constrain to actual composer/progress/footer. Queue/preprompt spinner/quoted output are not occupancy. Current parent busy/attached wait always wins over old completion. |
| `managed-seat-turn.observeManagedSpan` | Atomic0600 per-launch `.seat-span.d/span.json`, original pane/worker birth/current conversation binding. Persist immutable ID/start only on positive live work, not inputs. No periodic active writes. Persistence is identity bookkeeping, never freshness. |
| Terminal/recovery | Positive native root completion corroborated by settled whole-parent ready ends span. First ready sample is not terminal; confirm on a later valid read. Busy continuation/Stop veto/child completion does not end span. Unknown/failed read yields null and retains identity only. Restart reconciles stored binding with fresh live evidence; corrupt state stays null until a positively settled idle boundary can reset it. Changed binding captures a new observed span without borrowing old identity. |
| `core.cleanupAgentState` | Existing logical close removes new per-launch identity file; native runtime/global/vendor files unaffected. |

DFD: existing pty_list metadata -> readSeatTurns -> Codex existing tracking OR original live pane/worker -> current visible frame -> harness parent evidence + existing root completion -> post-read same generation/birth/freshness -> managed span identity -> six-key running / positive idle / raw null -> unchanged seat-turns.v1 -> Kiro all-five CurrentWork. Legacy wait remains Codex-only.

State transitions: no span + positive busy => capture ID/start; active + fresh busy/attached wait => retain; active + ambiguous => raw null with identity retained; active + native terminal plus repeated settled ready => retire and idle; idle + positive busy => new ID/start. Late/child terminal while busy => retain. Invalid binding => no old identity; missing observations never become terminals. A silent wait without a distinguishable native occupancy cue stays unavailable; detached child is not parent proof. An observed span does not certify invisible native transitions between polls.

Affected checks: four live-frame branches, queue/hook/output false positives, long unchanged wait and absorbed steer, positive terminal/late child/Stop veto, identity persistence/restart/current generation, loss/corruption/concurrent capture, six keys/null tracking. Build/new fixtures only; no old successful suites or native/probe/AI launch. Source candidate is not real-host latency or3OS acceptance.


Implementation refinement before source: the observer uses a per-launch `.seat-span.d` directory with atomic0600 identity JSON. Its short cross-reader mutex publishes a fully written nonempty owner directory by rename, so no partially written lock can become authoritative. It never waits: contention returns null. Existing PID/birth observation reconciles a dead/reused owner; one atomic rename to the old directory inode's retained nonempty quarantine prevents competing recovery from moving a new owner. Normal owner release removes only its own inode/token. Quarantines remain until existing logical-close cleanup. This protects identity overwrite only; it is not an input lock, native work fence, heartbeat or activity evidence. Positive live capture happens inside the short identity transaction; successful reads do not rewrite active IDs. Unknown external state corruption stays unavailable until a positive settled idle boundary repairs identity, rather than fabricating a start. No synthetic timers refresh activity.

Current-frame harness dispatch stays in the existing sole screen-dispatch owner `agent-screen-observation.ts`; `managed-seat-turn.ts` owns identity/persistence only. Native capture is rechecked against the15s budget after bookkeeping/release, and non-Codex rows that age out while later seats are read become null before the shared reply. Codex timing/tracking behavior remains inherited.

Terminal witness identity comes from complete stable native records, never read-time fallback timestamps. Cursor/Grok adapter-generated observation `at` is excluded; classic hook events must have their own captured parseable `at` in the matching raw record. A partial tail or changed file generation cannot furnish a new terminal.

Implemented idle needs an existing complete root completion record and repeated current readiness (>=250ms). It does not use a completed-looking UI line as a fallback. Missing completion remains null even if a composer is visible; positive current occupancy can still yield working. Existing registered vendor binding/path is reused, without claiming a live private native UUID reader. The narrow frame readers inherit installed-version UI limitations; real-host performance and3OS runtime acceptance remain unmeasured.

Platform refinement: native stopped=true is an unavailable capture; Windows stopped=null means that optional OS detail is not supplied, and does not negate a positively live/occupied original worker. The new metadata fixture uses mocked platform-native process replies on each OS; it never invokes tmux/psmux, PowerShell or a vendor CLI.
