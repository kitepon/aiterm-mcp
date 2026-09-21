# Grokの過去の利用上限表示からの復帰 — 実装設計

状態: 設計完了・実装未着手。2026-09-21に確認した事実を根拠とする。
この依頼は設計まで。実装担当への切替後に、以下の仕様を実装する。

## 成功条件と所有

通常の `pty_send(session_id, text)` が、終了済みGrokターンの利用上限パネルを閉じ、
同じセッションへ今回のtextを一度だけ送れること。今回のターンが進行中なら、
過去の上限表示を理由に完了待機を打ち切らないこと。

- 症状の製品: BellTeam。
- 状態の所有製品: Aiterm。Grokの入力方式・画面判定・完了観測は
  `src/harnesses/grok.ts` が所有し、PTY操作の順序は `src/core.ts` が所有する。
- 修理場所の理由: BellTeamは既に通常の `pty_send` とreceiptの `wait_process` を使っている。
  Grokのキー操作をBellTeamへ追加すると既存の責務境界を破る。
- 反対仮説の確認: 単なる認証不在でも、未完了の推論でもない。対象の認証ファイルは存在し、
  最後のターンは `turn_ended: error` を記録済み。現行Aitermにもパネル解除処理がない。
- Composerは同じGrokアダプタなので同じ修正を適用する。他harnessの検出・送信方式は変えない。

今回の復帰は次の送信要求を処理するための入力準備である。期限監視、定期起動、
解除時刻の推定、バックグラウンド再試行、失敗した過去promptの再送は追加しない。
CLIの `Try Again` は過去promptを再投入する操作なので選択しない。
購入、上位プランへの変更、privacyの選択、再ログイン、session再作成も行わない。

## 確認した事実

本番のBellTeamのベルを、既存Aitermの `pty_read(screen:true, raw:true)` で読み取った。
本番へのキー送信、Botへのメッセージ、設定変更、再起動は行っていない。

| 観測 | 結果 |
| --- | --- |
| 最終ターン開始 | 2026-09-17T12:09:51.329Z、turn_number=95 |
| 最終ターン終了 | 2026-09-17T12:11:52.657Z、outcome=error |
| 認証ファイル | 存在だけを確認。内容は取得していない |
| 本番Aiterm | 調査時の導入版は0.31.0 |
| Grok実行ファイル | 調査時のディスク上の版は1.0.24。長時間動いているprocessと同じ版とは断定しない |
| 設計対象の実装 | aiterm-mcp commit `50f6bd76b1ffedca8bfe7cd15b6cb198d5856b9a` |

会話本文・パス・IDを除いた、対象画面の操作部分:

```text
Help improve Grok                         [Opt out] [Opt in]
┃  You hit your weekly limit.
┃  ↑/↓ navigate · y copy                   Enter:submit
Tab:next answer │ Esc:scrollback │ Shift+x:dismiss
```

別の稼働中Grokの画面では、同じprivacy案内と次の入力欄が同時に存在した:

```text
Help improve Grok                         [Opt out] [Opt in]
╭────────────────────────────────────────────────────────╮
│ ❯ <入力欄>
╰──────────────── Grok 4.6 (high) · always-approve ─╯
```

現行の `grokPaneObservation` に上記2種類の画面を渡す最小再現を実行し、
両方とも `blocked / privacy_choice` を返すことを確認した。
上限パネルの分類だけでなく、非モーダルのprivacy案内も復帰を妨げる。

`detectAgentRateLimit` はpane logの末尾16KiBを時点の区別なく検索する。
`observeGrokDone` は現在の完了eventがまだない時にこの検出を呼ぶので、
新しい送信後にも古い文言だけで `rate_limited` を返す経路がある。
これは実コードで確認した因果であり、本番で新しい送信を試した結果ではない。

## 一次資料と操作の選定

公式資料は固定commitから[RAG](../rag/INDEX.md)へ原文保存済み。
以下の公開source commitは調査時の公式mainであり、本番実行ファイルとの同一性は主張しない。

- [キーボード操作](../rag/sources/agent-launchers/grok-dialog-keyboard-20260921.md):
  質問カードの `Shift+X` は閉じる操作。`Esc` はカードを残してscrollbackへ移るので使わない。
- [利用上限パネル](../rag/sources/agent-launchers/grok-billing-dialog-20260921.md):
  上限表示はローカルの質問カード。`Try Again` は保管された前のpromptを再投入する。
- [privacy案内](../rag/sources/agent-launchers/grok-privacy-banner-20260921.md):
  通常agent画面の案内として描画する。表示の存在だけで入力を拒否しない。

`Shift+X` を対象のベルへ送った結果は、この設計段階では未検証。
実装後の実機受入で確認する。設計上の操作は `X` の一回だけに固定し、
異なる結果が出た時にEsc・Enter・再起動へ順番に切り替える処理は作らない。

## 固定する実装

### 1. Grokの現在の画面を分類する

`src/harnesses/grok.ts` に次の純粋関数を追加する。
文言、枠線、キーの知識を `core.ts` へ置かない。

```ts
grokRateLimitDialog(screen: string): { message: string; dismissKey: "X" } | null
```

対応対象は、実測したweekly-limitの質問パネルだけとする。
次の条件を同時に満たす時だけ返す。

1. 現在の質問パネルの見出し行が `You hit your weekly limit.` と一致する。
   前後の空白・枠線は除く。通常の会話文に含まれる同じ文字列は見出しとしない。
2. そのパネルのfooterに `Tab:next answer`、`Esc:scrollback`、`Shift+x:dismiss` がある。
   行の折返しと末尾空行は許す。
3. 検出したパネルより下に新しいcomposer、処理中UI、別の対話footerがない。
   scrollbackに残った以前のパネルは一致させない。
4. `Upgrade tier`、`Buy more credits`、`Try Again` の選択肢は検出条件にしない。
   実画面では選択肢の行が空だったためである。

画面は `captureScreen(name, 0)` により現在のviewportを取得する。
この呼出しは既存の `captureScreen(name, 45)` と違いscrollbackを追加しない。
過去logは復帰判定にもGrokの上限観測にも使わない。

`grokPaneObservation` はこのパネルを `blocked / rate_limited` とし、
既存のprivacy判定より先に返す。

privacy案内については、末尾の入力box内の `│ ❯` または `│ >` と、
その下のGrok/Composer model footerを一組として確認できる時だけ、
`Help improve Grok` をblockingの根拠から外す。
過去の発話markerや単独の `Grok Build\n❯` だけではこの例外にしない。
本来のprivacy選択画面、trust、通信失敗、処理中の判定は維持する。
privacy設定や `GROK_PRIVACY_NOTICE_ROLLOUT` の値は変更しない。

### 2. 通常dispatchに一回の解除を組み込む

`dispatchAgentTurn` の既存の `ensureAgentOwnsPaneInput` の後、
通常のready待機より前に、Grok/Composerだけ次を実施する。

1. 現在のviewportを読み、`grokRateLimitDialog` がnullなら既存処理を続ける。
2. 該当する時は既存のprocess観測でharnessが生存していることを確認する。
   `latestAgentDoneEvent(meta)` で最後のターンが `turn_error` で終了したことも確認する。
   新しい `turn_started` の後に完了eventがない場合は操作しない。
3. 条件不成立は `GROK_RATE_LIMIT_RECOVERY_BLOCKED` のAitermError（code=2）。
   理由と「今回の文字列は未送信」を含める。生存しないharnessや未終了ターンへXを送らない。
4. `sendKey(name, "X")` を一回だけ呼ぶ。Enterは送らない。
5. 既存のready待機で入力受付を確認する。既存のtimeout・poll・安定回数を使い、
   復帰専用の定期タイマーや再試行回数を作らない。
   上限パネルが残る場合はreadyにしない。失敗は
   `GROK_RATE_LIMIT_RECOVERY_FAILED`（code=2）と現在のreason、未送信を返す。
6. ready後に初めて、既存の `agentCompletionCursor` 取得、
   `before_send`、本文paste、Enter、submit残留観測へ進む。
   パネル解除に伴うeventが今回のターンへ混ざらないようcursorの順序を守る。
7. 成功receiptの既存 `pane_input_recovery` 配列に
   `grok_rate_limit_dialog_dismissed` を追加する。新しいtool、引数、ID、永続stateは作らない。
   型コメント・公開説明も「入力の回復操作」としてこの値を説明する。

共通ready待機そのものにキー送信を埋め込まない。
`pty_observe`、`pty_read`、`aiterm-wait`、`agent_configure`、
`agent_steer` から上限パネルを閉じない。
復帰を起動する入口は通常のfollow-up dispatchだけである。
初手promptの未完了管理や `force:true` の仕様は変更しない。

### 3. 今回の上限と過去の表示を区別する

`detectAgentRateLimit` のGrok/Composer分岐は現在のviewportを取得し、
`grokRateLimitDialog` のmessageを使う。
Grokのパターンを共通log検索から外す。Codex/Claudeの既存log検索はそのまま残す。

`observeGrokDone` は次の優先順とする。

| 今回のcursor以後の事実 | 戻す結果 |
| --- | --- |
| 成功の `turn_ended` | 既存どおり `done`。画面より完了記録を優先 |
| エラーの `turn_ended` と現在の上限パネル | `rate_limited`。turn情報と上限messageを保持 |
| エラーの `turn_ended`、現在の上限パネルなし | 既存どおり `error`。表示待ちの追加retryはしない |
| 完了eventなし、現在の上限パネルあり | `rate_limited` |
| 完了eventなし、古いlogだけに上限文言 | `running` または既存期限で `timeout` |

waiterはreaderのままにする。
上限時の認証不在を扱う `aiterm-wait-cli.ts` の既存catchも、
更新された `detectAgentRateLimit` を通す。古いlogだけで現在の認証エラーを
`rate_limited` に置換してはならない。認証の再作成・copyは行わない。
実際の上限継続を検知した後は今回の要求を失敗として返し、再送しない。

## 変更ファイルと試験

| ファイル | 変更 |
| --- | --- |
| `src/harnesses/grok.ts` | 現在のパネル認識、privacy案内の区別、Grok wait結果の分類 |
| `src/core.ts` | dispatch前の一回の解除、Grokの現在画面の読取、既存receiptへの記録 |
| `src/aiterm-wait-cli.ts` | 上限観測の説明を現行画面に合わせる。CLI引数・exit契約は変更しない |
| `test/grok-rate-limit.test.mjs`（追加） | 純粋な画面判定と `observeGrokDone` のfixture試験 |
| `test/harness-pane-observation.test.mjs` | 案内＋実入力boxはidle、案内だけの選択待ちはblocked |
| `test/core-agent.test.mjs` | 既存の模擬Grok PTYを使い、解除キー→ready→本文一回→完了境界を確認 |
| `test/aiterm-wait.test.mjs` | 古いpane log単独をGrok上限としていた期待を修正。現在パネルの検出と認証不在の組合せを維持 |
| `docs/DESIGN.md`、日英README、CHANGELOG | 実装後の公開挙動と復帰記録を同期 |
| `docs/adr/` | 実装完了時の判断と受入結果。本書を完了済みとしてarchiveする |

必要な回帰ケース:

1. 実測の空の選択肢、privacy案内付きパネルを `rate_limited` と判定する。
2. 会話中の引用、古いパネル＋その下の新composer、古い上限log＋処理中は上限にしない。
3. 案内＋枠付きの現composerはidle。案内だけ、信頼確認、通信失敗、処理中をidleにしない。
4. 完了済みエラー＋パネルからのdispatchはX一回、本文一回、Enter一回。
   session/launch/vendor_session IDを維持し、cursorは解除後・本文前。
5. 解除してもパネルが残る、またはharness不在・ターン未終了なら本文送信ゼロ。
   購入操作・Try Again・Esc・Ctrl+C・再起動を送らない。
6. 解除なしの通常Grok/Composer送信を維持。別harnessへXを送らない。
7. 旧上限logがあっても今回の新turnはrunning→done。
   新しい上限パネルが出たらrate_limited、普通のAPI errorはerror。
8. waiter/observeを何回呼んでもキー送信とstate書込みはゼロ。
9. auth不在＋現在パネルは既存のexit 6、auth不在＋古いlogだけなら認証エラー。
10. 模擬PTY試験は、入力したXが削除対象のパネルへ届くことを実際の送信経路で確認する。
    mockの呼出し回数だけを成功証拠にしない。

実装中は次を使う。まず新しい回帰ケースで現行失敗を確認し、修正後に対象を通す。

```sh
npm run build
node --test test/grok-rate-limit.test.mjs test/harness-pane-observation.test.mjs
node --test --test-name-pattern='Grok|grok|Composer|composer|rate.limit|上限' test/core-agent.test.mjs test/aiterm-wait.test.mjs
npm run test:docs
```

通し試験は実装確認に使わず、[RELEASE](RELEASE.md)の現行手順と製品CIに従う。
設計段階では製品コードを変更していないため、製品の全試験は実行しない。

## 実装後の公開・本番受入の順序

1. 実装差分とfocused testを確認し、Aitermの通常release手順を完了する。
   公開versionはrelease時に決め、本書へ現役版を固定しない。
2. 本番を再buildする前に、公開済みpackageを標準の
   `npm exec --yes --package=aiterm-mcp@<公開版> -- aiterm-mcp`
   で短命のMCP接続として起動する。通常のBot用環境と同じHOME/stateを使う。
   開発版distのcopyや本番設定の直接編集は行わない。
3. 保存してある停止中のベルに対し、公開 `pty_send` を一度呼び、
   復帰記録、同じsession/launch、今回のreceipt cursor以後のturn、
   `wait_process` のdone、今回の確定回答を確認する。
   実機では未知の操作を探しながら送らず、設計したX一回で失敗したら記録して止める。
   上限が本当に継続中なら失敗をそのまま残し、復帰成功とは報告しない。
4. BellTeamの `Dockerfile` の `AITERM_VERSION` だけを公開版へ更新する。
   本番反映はBellTeam正典の `scripts/deploy.sh "<日本語メッセージ>"` を使う。
   これでBotが停止するため、同一セッションでの復帰検証を必ず先に終える。
5. BellTeamの通常配送経路で一回の確認メッセージを届け、確定回答まで確認する。
   Bot台帳、共有CLI設定、待機行列、失敗済み履歴は手編集しない。
   他の停止Botへ一括再開メッセージを送らない。

公開packageでの同一セッション復帰と、BellTeamへ導入後の通常配送の両方が実装の完了条件。
設計担当はここを未実施のまま実装担当へ渡す。本番の停止状態は設計中に消さない。

## 実装担当への引継ぎ

この設計を読み、対象関数の現行コードを確認してから、上記の変更範囲だけを実装する。
設計上の選択は確定済みであり、汎用の復帰フレームワークや新APIへ作り替えない。
実物と設計の前提が違ったら、その差分を報告し、別のキーや復旧経路を推測して追加しない。
実装前の文書commitに製品修理・公開・実機復帰を実施済みと書かない。
