> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 観測・完了・回答の現在構造

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
