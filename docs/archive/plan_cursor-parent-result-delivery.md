# 子の回答をCursor親へ自動配送する実装計画

状態: 公開済み。2026-09-22に0.38.1を導入し、通常HOMEのCursor親で初手と追加依頼の本文差し込みを確認した。
受信口の判断と実測は[ADR 0070](../adr/0070-cursor-parent-hook-receiver.md)。このfileは完了した計画の履歴である。

## 到達点

Cursor親（Cursor Desktop／IDEのAgent chat）がAitermへ子の依頼を送ると、Aitermが完了を検知し、確定した回答本文を
その会話へ届ける。親が作業を続けていれば次のツール返りに本文が差し込まれ、親がターンを終えていれば背景で起動した
受け口processの終了で親が起きる。親はポーリングも`pty_read(agent_transcript:true)`による回答回収も行わない。

Codex親・Claude Code親の配送契約、子harnessごとの完了観測と回答回収、通常PTY、waiterの公開contractは変更しない。

## 着手時の根拠

- 現行のAitermはMCP `initialize`の`clientInfo.name`が`codex-mcp-client`と`claude-code`の時だけ自動配送を作り、
  Cursor親には`wait_process`（`aiterm-wait-cli.js`の起動情報）だけを返す。waiterはoutcomeだけを返し本文を持たない
  （`src/index.ts` `deliveryForRequest`、`src/core.ts` `agentWaitProcess`／`agentDispatchGuide`）。
- gpt-connectorはCursor親へ同じ問題を解いた。`clientInfo.name`が`cursor-vscode`（`cursor-vscode (via mcp-remote ...)`を含む）
  で親を判定し、`~/.cursor/hooks.json`へ`afterMCPExecution`と`postToolUse`を登録する。`afterMCPExecution`で
  tool返りの`delivery.id`とhook入力の`conversation_id`を結び、完了時に受信箱へ本文を置き、`postToolUse`が受信箱を
  原子的に奪って`additional_context`で会話へ差し込む。idle時は`receiveCommand`を背景シェルで回し、完了時に本文を押し込む
  （`/Users/kite/Developer/gpt-connector/src/cursor-parent.ts`、`cursor-hook.ts`、`cursor-inbox.ts`、`setup-cursor-hooks.ts`）。
- Cursor公式hook仕様（`rag/sources/completion-detection/cursor-hooks-2026-08-24.md`）: 全hook入力に`conversation_id`と
  `generation_id`が付く。`afterMCPExecution`入力は`tool_name`、`tool_input`、`result_json`。`postToolUse`出力の
  `additional_context`はツール結果の直後に会話へ注入される。`postToolUse`のmatcherはtool種別で、MCP toolは`MCP:<tool_name>`形。
  MCP要求の`_meta`にはCursorの会話IDは入らない。
- 既存の共通資産: `src/parent-delivery.ts`の`ParentDeliveryManager`が完了境界の保存、完了観測、加工前本文の保存、
  同じ子への連続依頼の`claims`、owner回収、`parent_delivery` receiptを所有する。Claude親はこの上に
  `src/claude-parent-receiver.ts`（識別・束縛・hookとのfile受渡し）と`src/claude-parent-hook.ts`（hook入口）を足しただけで成立した。
  setupは`src/setup-integrations.ts`の`mergeClaudeParentHooks`が他製品のhookを保持して自製品のentryだけを更新する手順を持つ。

### 工程1の決定（2026-09-22）

1. 親名はgpt-connectorがこのCursor Desktopで実測した`cursor-vscode`と、空白以降の派生名。Aitermの稼働中MCPは公開版0.37.10のままなので、この作業treeからの`clientInfo.name`採取は公開導入後の受入で行う。
2. `delivery_id`は`structuredContent.parent_delivery`と、`content[].text`をJSONとして読んだ中の両方から取る。公式の`result_json`／`tool_output`がどちらを含むかで欠落しない。
3. 束縛と差し込みは別eventなので、`afterMCPExecution`と`postToolUse`の二本を登録する。束縛は同じ配送へ重ねても`bind.json`を上書きしない。
4. 公式仕様は`hooks.json`の保存でhookを再読込する（`rag/sources/completion-detection/cursor-hooks-2026-08-24.md`）。再起動が要るかは公開導入後の受入で確認する。
5. hookの`command`はshell文字列。macOSは単一引用符、WindowsはPowerShellの呼出し演算子と単一引用符（この製品のWindows shellはPowerShell 7）。CursorがWindowsでcmdを使うかは未実測で、失敗はhook不在と同じく送信前errorになる。

## 設計

### Cursor固有と共通の境界

| 区分 | 所有 | 内容 |
| --- | --- | --- |
| 共通（変更しない） | `src/parent-delivery.ts` | 完了観測、本文保存、`claims`、owner回収、状態機械、`beforeChange`、receipt |
| 共通（最小の拡張） | `src/parent-delivery.ts` | `Parent`型の和にCursorを追加、`parent_kind:"cursor"`の保存先、`verify`／`submit`の種別分岐 |
| 共通（移動のみ） | `src/agent-shared.ts` | `waitForFileState`を`claude-parent-receiver.ts`から移し、Claude・Cursorの両方が使う。挙動は変えない |
| Cursor固有（新規） | `src/cursor-parent-receiver.ts` | 親の識別、hook登録の確認、配送dirの準備、本文の受渡し、hook処理、受け口process情報 |
| Cursor固有（新規） | `src/cursor-parent-hook.ts` | Cursorが起動するhook入口。stdinのJSONを`cursor-parent-receiver.ts`へ渡す |
| Cursor固有（新規） | `src/cursor-parent-receive.ts` | 親がidleの時に背景で回す受け口CLI。本文を受けてexitする |
| Cursor固有（setup） | `src/setup-integrations.ts` | `~/.cursor/hooks.json`への自製品entryの登録・解除・読戻し |
| 接続 | `src/index.ts` | `deliveryForRequest`と`oninitialized`にCursor判定を追加、receiptの`wait_process`を受け口processへ切替 |
| 案内 | `src/core.ts` | `autoDeliveryParent`／`agentDispatchGuide`／`agentWaitGuide`にCursor文を追加 |

Codex／Claudeの経路は`isClaude`判定に`isCodex`を足す以外触らない。旧版のCodex／Claude readerへ未知のparentを読ませないため、
Cursorの配送記録は`<stateRoot>/cursor-parent-deliveries/`へ分け、子の予約`parent-deliveries/claims`だけを共有する
（Claudeと同じ分離方式）。

### 親の識別

`cursorParentFromRequest(clientName)`は`clientName === "cursor-vscode"`または`"cursor-vscode "`で始まる時だけ
`{ kind: "cursor", hook_root }`を返す。MCP要求の`_meta`は使わない（会話IDが来ないため）。
返す前に`verifyCursorParent`で`~/.cursor/hooks.json`に自製品のhook entryがあることを確認し、無ければ
`CURSOR_PARENT_HOOK_UNAVAILABLE: Cursorのhookが登録されていません。aiterm-setupを実行してください`で子への送信前に止める。
waiterへ黙って切り替えない。

`deliveryForRequest`の判定順はCodex → Claude → Cursorとし、前二者の判定関数は変更しない。

### 状態の配置

```
<stateRoot>/cursor-parent-deliveries/{active,results}/        ParentDeliveryManagerの記録（parent_kind:"cursor"）
<stateRoot>/parent-deliveries/claims/                          子の予約（既存・共有）
<stateRoot>/cursor-parent-hooks/deliveries/<delivery_id>/      配送ごとの受渡しdir（0700）
    bind.json      { conversation_id }                          hookが束縛時に書く
    answer.json    { delivery_id, text }                        MCPが完了時に書く
    claim.json     { channel: "hook" | "receiver", at }         受け取った側が排他的に作る
<stateRoot>/cursor-parent-hooks/conversations/<conversation_id>/<delivery_id>   会話→配送の索引（空file）
```

`claim.json`は`fs.writeFileSync(path, body, { flag: "wx" })`で作る。`O_EXCL`はPOSIXとWindowsの両方で原子的で、
hookと受け口のどちらが先でも一方だけが本文を出す。gpt-connectorが持つ「直前のShellが受け口なら差し込まない」判定は、
排他claimで同じ効果が出るため実装しない。

### 配送の流れ

1. `before_send`（共通）で記録を作り`claims`を取った後、Cursor親なら`prepareCursorDelivery(parent, delivery_id)`が
   `deliveries/<id>/`を作る。receiptは`parent_delivery`（`state:"waiting"`）と、`wait_process`に受け口processの起動情報を持つ。
2. Cursorのhook（`afterMCPExecution`または`postToolUse`。工程1で確定）が同じtool返りを受け、`structuredContent.parent_delivery.delivery_id`
   と入力の`conversation_id`から`bind.json`と`conversations/<conv>/<id>`を書く。dispatch tool以外、`parent_delivery`が無い返りでは何もしない。
3. 子が完了すると共通の`capture`が本文を保存し、`submitCursorParentAnswer`が`answer.json`を書いて`claim.json`の出現を
   `waitForFileState`で待つ（上限24時間）。`claim.json`が現れたら`submitted`。上限到達は
   `CURSOR_PARENT_DELIVERY_UNCLAIMED`で`failed`とし、本文は`answer.json`と記録に残す。自動再送はしない。
4. 差し込み: 親が次に任意のツールを呼ぶと`postToolUse` hookが`conversations/<conv>/`を読み、`answer.json`があり
   `claim.json`が無い配送へ`claim.json{channel:"hook"}`を作れたものだけ本文を集め、`{"additional_context": "<本文>"}`を返す。
   索引fileは読んだ時に消す。複数配送は`created_at`順に連結する。
5. 起床: 親がターンを終えていた場合は、背景で回していた`cursor-parent-receive --delivery <id>`が`answer.json`の出現を
   `waitForFileState`で待ち、`claim.json{channel:"receiver"}`を作れたら本文をstdoutへ1行JSONで出してexit 0する。
   hookが先に奪っていたら`{"outcome":"delivered_by_hook"}`でexit 0し、本文は出さない（会話に既にある）。
   `answer.json`が24時間現れなければ`{"outcome":"timeout"}`でexit 3。

本文の形は共通の`answerMessage`（`delivery_id`、`session`、`harness`、`launch_id`、`turn_id`、`outcome`、本文）をそのまま使う。

### receiptと案内

- `wait_process`は`{ executable: process.execPath, args: [dist/cursor-parent-receive.js, "--delivery", id], windows_start_process_argument_list }`。
  型と`windowsStartProcessArgumentList`は`core.ts`の既存物を使う。`wait_command`はnull（他の自動配送親と同じ）。
- `parent_delivery`は既存schemaのまま（`queued_submission_id`はnull）。
- `agentDispatchGuide`のCursor文: 「回答はこの会話へ自動で届く。作業を続ければ次のツール返りに差し込まれる。
  ターンを終える前に`wait_process`を背景（`block_until_ms: 0`）で起動しておけば、idle中に完了しても起きられる。
  ポーリング・`pty_read(agent_transcript:true)`は不要」。`NON_BLOCKING_RULE`にも同じ一文を足す。

### setup

- `configureIntegrations`のcursor分岐で、`mergeJsonMcp`の後に`mergeCursorParentHooks(join(home, ".cursor", "hooks.json"), registration)`を呼ぶ。
- entryは`{ command: "<quoted node> <quoted dist/cursor-parent-hook.js>", timeout: 15 }`。Cursorのhooks.jsonは
  `{ version: 1, hooks: { <event>: [entry, ...] } }`の平坦な配列で、Claudeの`{matcher, hooks:[...]}`二段とは形が違う。
  自製品entryの識別は`command`が`cursor-parent-hook.js`を含むこと。他製品（gpt-connector、caveat、throughline等）のentryと順序は保持し、
  既に同じentryがあれば`unchanged`。書込みは一時file→`.aiterm-backup`→rename→読戻し照合（`mergeClaudeParentHooks`と同じ手順）。
- 登録event: 工程1の結果により`postToolUse`一本、または`afterMCPExecution`＋`postToolUse`の二本。`postToolUse`にmatcherは付けない
  （どのツール返りにも差し込むため）。
- `aiterm-setup --remove-cursor-parent-hooks`を追加し、自製品entryだけを解除する。`--help`へ一行足す。
- Cursorの検出条件は既存どおり`cursor-agent`の有無または`~/.cursor`の存在。

## 変更ファイル

新規:

- `src/cursor-parent-receiver.ts` — `cursorParentSchema`、`CursorDeliveryError`、`isCursorMcpClient`、`cursorParentFromRequest`、
  `verifyCursorParent`、`prepareCursorDelivery`、`submitCursorParentAnswer`、`handleCursorHook`（bind／inject）、
  `receiveCursorAnswer`、`cursorReceiveProcess`、`cursorParentHooksRegistered(document)`（setupと共用）
- `src/cursor-parent-hook.ts` — hook入口（stdin→`handleCursorHook`→stdout JSON。未対応eventはstderrへ理由を出しexit 2）
- `src/cursor-parent-receive.ts` — 受け口CLI（`--delivery <uuid>`のみ受理。exit 0=delivered／delivered_by_hook、3=timeout、1=自身のエラー）
- `test/cursor-parent-receiver.test.mjs`
- `docs/adr/0070-cursor-parent-hook-receiver.md` — 受信口の選択（hook `additional_context`＋背景受け口、排他claim、hook必須）

変更:

- `src/parent-delivery.ts` — `Parent`和型にCursor、`recordSchema.parent`の和、`parent_kind: "claude" | "cursor"`、
  `recordRoots`へ`cursor-parent-deliveries`、`isCodex`、`verifyParent`／`submitParentAnswer`の分岐、
  `before_send`で`prepareCursorDelivery`、`request()`の返りに`wait_process(): AgentWaitProcess | null`（Codex／Claudeはnull）、
  `deliver`のerror判定に`CursorDeliveryError`
- `src/agent-shared.ts` — `waitForFileState`を移動しexport
- `src/claude-parent-receiver.ts` — `waitForFileState`をimportに置換（挙動不変）
- `src/index.ts` — `deliveryForRequest`と`oninitialized`のCursor判定、`parent_kind`の決定を一箇所の関数に、
  `agent_launch`／`pty_send`／旧aliasのreceiptで`wait_process: delivery ? delivery.wait_process() : core.agentWaitProcess(...)`、
  `NON_BLOCKING_RULE`
- `src/core.ts` — `autoDeliveryParent`と案内文のCursor分岐
- `src/setup-integrations.ts` — `cursorParentHookEntries`、`mergeCursorParentHooks`、`removeCursorParentHooks`、cursor分岐の呼出し
- `src/setup-cli.ts` — `--remove-cursor-parent-hooks`
- `test/parent-delivery.test.mjs`、`test/setup-integrations.test.mjs` — Cursor分の追加
- `README.md`／`README.ja.md` — 「Codex／Claude Code親への回答自動配送」をCursor親を含む節へ、tool表の説明、setup flag
- `docs/DESIGN.md` — 「Cursor親への自動配送」節
- `CHANGELOG.md` — 0.38.0
- `package.json`／`server.json`／`manifest.json`（MCPB） — 版と説明文の同期。`files`は`dist/*.js`で新規CLIを含むためbin追加は不要

## 工程と受入

1. **実測spike**（Grokが最初に行う。製品コードを触らない）
   - `/tmp`へ書くだけのhook scriptを`~/.cursor/hooks.json`へ一時登録し、Cursor親からAitermの`agent_launch`を1回呼んで
     `afterMCPExecution`・`postToolUse`の入力JSON全文と`clientInfo.name`（Aitermの`oninitialized`でstderrへ一時出力）を採取する。
     終わったら一時登録と一時出力を戻す。
   - 採取結果から未知1〜4を確定し、本計画の「登録event」「delivery_idの取り出し元」を1行ずつ更新する。
   - 採取JSONは`docs/evidence/2026-09-22-cursor-hook-payload.json`へ、pathとuser_emailを除いて保存する。
2. **実装**（focused testを先に書く）
   - `cursor-parent-receiver.ts`の純関数（識別、claim排他、hook処理、受け口）→ `parent-delivery.ts`の拡張 → `index.ts`／`core.ts`の接続 → setup。
   - 各段で対象testだけを回す: `node --test test/cursor-parent-receiver.test.mjs`、`test/parent-delivery.test.mjs`、
     `test/claude-parent-receiver.test.mjs`（移動の無影響確認）、`test/setup-integrations.test.mjs`。
3. **実機受入**（通常HOME・`aiterm-setup`で登録）
   - Cursor親から`agent_launch(harness=codex-cli, prompt)`→親が別ツールを1回呼ぶ→`additional_context`で本文が届く。
   - Cursor親から`pty_send`でfollow-up→親がターンを終える→背景の受け口exitで本文が届く。
   - 同じ子への連続依頼で`PARENT_RESULT_PENDING`、hook未登録で`CURSOR_PARENT_HOOK_UNAVAILABLE`、子のclose／errorで`outcome`付き本文。
   - Codex親・Claude親の既存受入（`docs/evidence/2026-09-10-*`と同条件）が変わらないことを1回ずつ確認する。
4. **文書同期と通し試験** — README日英、DESIGN、CHANGELOG、ADR 0070、server／MCPB metadataを同じcommitで揃え、最後に`npm run build && npm test`を一度。
5. **公開** — [RELEASE](../RELEASE.md)に従いmain祖先gate、3環境CI、npm provenance、GitHub Release＋MCPB、Registry、公開package smoke。
   この端末へ`aiterm-setup`で導入し、Cursor親から工程3の初手を1回再現して受入を閉じる。受入結果はADR 0071へ。

受入が実装→導入→公開後確認へ連鎖するため統括レーンとする。writerはGrok 1席、契約クリティカルな反証（親の取り違え、二重差し込み、
Codex／Claude非干渉）だけ読み取り専用の別担当へ依頼する。Latticeは新規適用しない。

## 検証（focused test）

- 識別: `cursor-vscode`／`cursor-vscode (via mcp-remote 0.1.29)`はCursor、`codex-mcp-client`／`claude-code`／undefinedはnull。
  Codex／Claudeの判定関数は同じ入力で同じ結果。
- hook未登録: `verifyCursorParent`が`CURSOR_PARENT_HOOK_UNAVAILABLE`。
- 束縛: dispatch toolの返りから`delivery_id`を取り`bind.json`と索引を書く。`parent_delivery`が無い返り、他toolの返りでは何も書かない。
- 差し込み: `answer.json`ありで`additional_context`に本文、索引が消える。2件は`created_at`順に連結。claim済みは出さない。
- 排他: hookと受け口を同時に走らせて`claim.json`は1つ、本文を出すのは一方だけ。
- 受け口: 先勝ちで本文とexit 0、hook先行で`delivered_by_hook`、`answer.json`不在でtimeout exit 3、`--delivery`不正でexit 1。
- submit: `claim.json`出現で`submitted`、上限到達で`failed`と本文保持、自動再送なし。
- 記録分離: `parent_kind:"cursor"`は`cursor-parent-deliveries`へ、`status()`は三つの保存先を横断、旧Codex readerのfixtureがCursor記録を読まない。
- setup merge: 空file、他製品entryあり、自製品entryあり（unchanged）、旧command形、symlink、不正JSON、読戻し不一致、remove後に他製品が残る。
- 長文: 32K超・改行・引用符・日本語の本文が`answer.json`→`additional_context`で完全一致。
- 非干渉: `parent-delivery.test.mjs`と`claude-parent-receiver.test.mjs`の既存caseが変更なしで通る。

## 非対象

- Cursor Cloud Agent／Background Agent（`afterMCPExecution`がdeferredで、hookが載らない）。実測で`is_background_agent`相当を見分けられれば明示errorにする。
- Cursorの会話終了（`sessionEnd`）による未配送の打ち切り。v1は24時間上限だけとし、必要が実証されたら追加する。
- `stop` hookの`followup_message`による自動再投入。親の意図しない次ターン開始になるため使わない。
- 子harnessとしての`cursor-cli`の回収方法、Codex／Claude親の配送口、waiterの公開contract、Windows以外のOS差の新設。

## Grokへの委譲メモ

- 成功条件は本計画の「検証」全件green、工程3の実機4項目、`npm run build && npm test`の1回green。
- 触ってよいのは「変更ファイル」に列挙したpathだけ。`src/codex-*`、`src/harnesses/*`、`src/tmux-runtime.ts`、`aiterm-wait-cli.ts`は触らない。
- 罠: MCP stdioではstdoutへ診断を出さない（hook／受け口CLIは別processなのでstdoutがJSON面）。`claim.json`は`wx`以外で作らない。
  `~/.cursor/hooks.json`には他製品のentryが既にあり、順序を変えると差分が出る。testで本物の`~/.cursor`へ書かない（`home`を注入する）。
- 実測で計画と食い違ったら、コードを合わせる前に本計画の該当行を直し、理由を1行残す。

## 根拠

- [Cursor Hooks公式](https://prod.cursor.com/docs/hooks)（取り込み: `rag/sources/completion-detection/cursor-hooks-2026-08-24.md`）
- gpt-connectorのCursor親配送実装（`/Users/kite/Developer/gpt-connector/src/cursor-*.ts`、CHANGELOG 0.9.9〜0.9.11）
- [ADR 0057 Claude親の回答配送](../adr/0057-claude-parent-result-delivery.md)、[ADR 0058 Claude親hook受信口](../adr/0058-claude-parent-hook-receiver.md)
- [ADR 0046 platform native wait process boundary](../adr/0046-platform-native-wait-process-boundary.md)

取得日: 2026-09-22。実機結果は工程ごとに追記する。
