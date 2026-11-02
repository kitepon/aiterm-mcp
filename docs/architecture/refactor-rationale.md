# 責務と接続の改善設計

2026-11-02、Astra xhigh。08:30のget_selfで適用済み、fast OFFを確認して設計した。基準はAiterm `ce575ce8abc91b13f8a4e1c7b7b20c4330ee86fd`、Steer `6734ee86a77928640877415fb83981475f7cb142`。これはAstraの採用設計を保持した理由書。6段階の実装は完了し、現在の接続はREADME/各詳細/source-indexを正本とする。

全155実装ファイルの初読、26枚の現在図、[関数対応](source-index.md)、[全ファイルの設計対象](source-index.md)を根拠にする。機能の入出力を変えず、保存形式の読取と画面操作を進行制御から分ける。ファイル数やcoreの行数だけを削減目標にしない。段階・試験・未確認事項は[実装計画](verification.md)。

## 採用する分割

| 段階 | 現在の混在・迂回 | 採用する所有者と効果 |
| --- | --- | --- |
| A1 | coreの起動・送信・観測が、同じファイル内の起動記録選択、旧形式の正規化、5vendorの検証に依存する | `agent-metadata-reader.ts`へ読み取りをまとめる。coreは返った記録とgenerationを使って進行を決め、書込みは既存所有者に残す。記録の拒否をnative操作なしで調べられる |
| A2 | PTYの表示縮約と制御文字処理が、native操作を含むcoreの中にある | `pty-output.ts`へ既存の純粋な表示処理を移す。coreの既存exportを保ち、表示とturn成功判定を分けて検証できる |
| A3 | coreがClaude/Codexの画面選択の全手順と、その前後の排他・goal・設定保存を同時に持つ | `harnesses/claude-configure.ts`と`harnesses/codex-configure.ts`が既存の画面手順を所有する。coreは入力待ち確認・排他・副作用開始の記録・goal・返却を持つ。利用者の既定復元の共通部分は既存`user-config.ts`へ寄せる |
| A4 | 親配送の保存schemaが、remoteのschemaを得るだけでもSSH/MCP中継moduleを参照する。managerが記録の検証・本文組立ても持つ | `remote-contract.ts`へ既存schema/type/説明を、`parent-delivery-record.ts`へ既存record schema/type/read/本文組立てを移す。managerは予約・所有・監視・回収・配送・receipt投影を持つ |
| S1 | `channel.ts`に永続状態の遷移、vendorの本人確認、待機所有、hook出力が同居する | `channel-state.ts`がchannel記録とinbox/claims/emittedを所有する。`channel.ts`はvendor入力の検証、待機と出力、出力結果をsettleする順序を持つ。Bridgeへの公開口と保存形式は維持する |

[改善後の依存図](design-history/ownership.svg) / [設定の作用境界](design-history/configuration.svg) / [channelの状態と出力](design-history/channel.svg)。青枠は移す責務、灰色は既存の所有者。設計時図は検討の履歴であり、現在図と区別する。

### A1 起動記録の読取

移動対象は`loadAgentMetadata`、`loadAgentLineageFields`、`normalizeInitialPromptState`、`tryLoadAgentMetadata`。読取専用といっても純粋関数ではなく、secure state rootの記録・generation・Grokの認証正本を照合する。CLIやnativeを起こす窓口にはしない。`AgentMetadata`、path/generation/書込、lineageの形の共通規則は既存`agent-shared.ts`に残し、現在core内で起動時検証にも使う`AGENT_LINEAGE_RE`だけを同所有者に置く。`UUID_RE`は全参照を確認してreaderへ移す。

旧boolean initial_prompt、欠測時の既定、vendorごとのoptional field、objectのspread順、`node_platform`の投影、Grok認証照合、resume世代の拒否をそのまま維持する。新schemaで一括正規化しない。初回の移動は検証順を保ち、その後同じcommit内で共通検証と5vendor返却が読める大きさに整理する場合も、例外の順序を変えない。

**negative cacheは移さない。** これはreader全体のcacheではなく、`agentReadMetadataSuffix`という表示機能だけの欠測cache。現在のTTL、作成/起動によるdelete、読取の例外をnullにする窓口との差を残す。読み取り失敗を全callerにcacheする変更は不採用。

### A2 表示

`stripControl`、`reduceOutput`とその専用helper/定数だけを移す。送信のUTF-8容量境界、logをbyte位置で読む関数、任意外部`rtk`によるcommand書換えは別責務として移さない。省略文字列、行数と概算token、CR/OSC/DCS、surrogate、elide=falseを同じ値で返す。coreから同名を再exportし、既存の呼出元を一斉に新pathへ変えない。`src/rtk.ts`の意味別縮約と共通化する案は、出力契約が異なるため採用しない。

### A3 設定

coreの`configureAgent`は公開の進行責任を保つ。同じsession/generationと入力待ちを確かめ、既存send/native lock、goal保護、利用者の既定保存、変更未確定の記録を同じ順で行う。画面adapterにlockやmetadata書込みを渡さない。

2adapterが使う小さい内部型`AgentModelUi`を`agent-model-ui.ts`に置く。渡す作用は画面読取、**Enterまで含むcommand送信**、既存menu key送信。Codexには既存`waitForScreenText`、Claudeには既存`waitAgentTuiReady`の接続を追加する。新timeoutやclock設定は公開しない。`GoalNativeUi.paste`は貼付けだけの意味なので流用しない。`beforeChange`はClaudeの`s`、Codexの最後のeffort選択の直前という現在位置を維持する。

Claudeは既存metadataとvendorのresolver/catalogを使う。Codexは選択肢が見つからない分岐に入った時だけA1のreaderで記録を再読し、現在と同じ時点でcatalogを取得する。先にcatalogを取得して、画面作用より前に失敗する変更はしない。現画面の通知数との差、Esc cleanup、Claudeの選択再確認・session-only拒否、キー再試行、反映不明の例外を保持する。長い手順は「画面を開く→候補を調べる→選ぶ直前に照合→作用→新通知/readyを確認」という既存の段階が読めるprivate関数に整理し、vendorを越えた万能pickerにしない。

`restoreUserDefaults`と`keepingUserDefaults`は既存`user-config.ts`へ移す。3回/400msと復元失敗を握ってactionの結果を返す意味を維持する。400msはCodex専用の復元にも使うため定数を同moduleから参照する。起動後のnative/画面観測が必要な`launchKeepingUserDefaults`、Codex公式config書込みとfile fallback、fastの処理はcoreに残す。起動失敗時にもfinally復元するよう変えることは、現動作変更なのでしない。

### A4 配送記録とremote契約

`remote-contract.ts`は接続入力schema/type/説明のみを所有する。`remote.ts`は同じ名前を再exportし、資格のmemory、SSH/MCP接続、request/response、read-only再照会を引き続き所有する。`remoteKey`と`remoteLabel`は今回移さない。記録parserは`remote-contract.ts`を直接参照し、transportを経由しない。公開indexはtransportも使うのでその接続を維持する。

`parent-delivery-record.ts`は`recordSchema`、`DeliveryRecord`、`readRecord`、`answerMessage`を持つ。schema strictness、private source/owner一致のsuperRefine、ファイル名とdelivery ID、ENOENTをそのまま返す区別、その他を既存エラーへ包む処理を保つ。これは汎用storeでも新しい配送queueでもない。

`ParentDeliveryManager`にjobs/owner/heartbeat/claim/AbortController/finishを残す。`receipt`はCodex hook stateの投影を伴うのでrecord moduleへ移さない。通常とprivateのcheckpoint順、ready時の子予約解放、sending→unknown、unknownを自動再送しない条件、closeが監視を止める意味を維持する。回収時のowner欠測の扱いを厳しくする修理も混ぜない。

### S1 channel

新moduleはchannel/item schema、関連type、ChannelError、path、create/read/close、enqueue/dedup、delivery state、withdraw、claim/settle、send sequenceを所有する。既存channel moduleから公的名称を再exportする。非公開の「構成済みChannelを書込」「非Codexをenqueue」「claim済みをsettle」だけを内部の接続にする。pathを外部設定にせず、profileのstate rootを引き続き使う。

`openChannel`のparent検証/Claude request binding、`sendToChannel`のclosed確認とCodex分岐、Claude index/waiter/owner出生照合、Cursor hook binding/index、background receiverはchannel moduleに残す。claimは保存module、出力とその成否の判断はchannel moduleが持つ。`emitClaimed`は出力成功後にemittedを書き、失敗時はunknownを残してthrowする。settle自体の失敗を握る新catchは足さない。

hardlinkによるwithdraw/claim競合、inbox→claims→emitted、queued/sending/emitted/unknown/withdrawn/null、同delivery IDのdedup、closed、PID出生不明、default noop emitterの既存意味を変えない。`emitted`はvendor開始/受理の証明ではない。Claude stderr+exit2、Cursor hook/背景受信、Codex公式queueは共通状態機械へ統一しない。Bridgeが読むUUID directory集合とclaims/pending/settledの保存形式も保持し、列挙APIを新設しない。

## 採らない代替案

| 案 | 採らない理由 |
| --- | --- |
| coreを一度にservice/class群へ置換 | 8675行に跨る共有状態、native owner、複数lockの順序まで移す必要があり、故障位置を追う目的に対して新しい依存が大きい |
| send lock/native lock/private lock/user-config lockを共通化 | 回収・出生証明・再入・期限・書込保証が異なる。名前が似ても同じ契約ではない |
| `prepareAgentLaunch`全体を大量のcallbackで別moduleへ移動 | 作成境界とcleanupを切り離し、引数でcoreを再現するだけになる。記録読取と画面手順を先に独立させ、進行はcoreに残す |
| 全vendorの完了、設定、hook出力を共通adapter registryへ統一 | Codex通常完了/厳密停止、Grok取消継続、Cursor cursor、Claude session-only等の意味が違う。新機能にも当たる |
| metadata読取をagent-sharedへ全部追加 | 下位の共有moduleがharnessの認証/path照合を参照し、逆向き依存が生じる。readerを上位に置く |
| private33moduleを公開経路へ統合、private未対応を修理 | 通常mainは未mount。独立した契約・coverage/fenceを維持する。元Windows失敗の原因説明にも代用しない |
| 新しい包括channel一覧API・store形式変更 | Bridgeは既存読取依存の維持を採用済み。別製品の要請のない公開契約を増やさない |
| 全testを定型再走して同等性とする | Owner指定は変更契約と直接境界。新しい全体greenを作って元Windows73件を説明することもできない |

## 全体の責任と失敗追跡

全機能は[全ファイルの設計対象](source-index.md)に所属を一つずつ記録した。変更しない領域も、入口・状態所有・副作用・返却・停止/取消/途中失敗/unknown/cleanupは現在図の各詳細へ接続する。ファイルの初読完了を全fixture独立照合や全OS動作確認に読み替えない。

故障を追う順は、公開入力/schema→core admission/現在generation→native作成/本人性→入力送信/turn境界→vendor完了正本→回答抽出→親配送queue/hook→consumer画面。設定では受付→選択作用→新通知→ready→返却を分ける。channelでは保存queue→claim→出力→settleを分ける。OSのcode/status/signal/bytes以外に本文や資格を診断へ増やさない。

元Windows73caseは[分類原本](evidence/windows-baseline-boundaries.json)から現在の関数へ辿れる。native作成側60/ready1/その他12は表面化した境界で、原因は未確定。改善後も元失敗・修理成功・全CI greenの主張へ拡張しない。

本設計で新しい公開tool、flag、保存状態、vendor能力、timeout、配布物、依存packageは追加しない。完成候補の実装・限定試験・実際に描画した図とコードのAstra最終確認が済むまで完了扱いしない。稼働席・配置・0.63.2・3hostは不変。
