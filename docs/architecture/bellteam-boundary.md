# BellTeam機能担当との接点

2026-11-02 Owner指示をトロニーから受領し、PR252 `341535d5bced58c551152129fcf8f26abcdf06ad` の全体・担当・接続先を読んで反映した。本体source段階の担当/契約であり、本番共通指示の配布完了や各機能の分離完了とは扱わない。

本体の正本は[全体図](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/feature-map.md)、[担当・変更手順](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/module-ownership.md)、[Aiterm接続登録](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/aiterm/README.md)。本体の内部図と共通手順本文をここへ複製しない。

## 接続登録へ渡す製品正本

製品内部の入口は[このrepoの機能図索引](README.md)。Botの進行記録はこの入口へのリンクを維持する。[現在の全体図](current-overview.md) → [SVG](current-overview.svg)から、[起動/本人性/入力](launch-identity-input.md)、[観測/回答](observation-results.md)、[goal/設定/認証/remote](goal-configuration-auth-remote.md)、[親配送](parent-delivery.md)、[Steer](../../../steer-refactor-20261102/docs/architecture/steer-setup-runtime.md)、[導入/更新](setup-update.md)の詳細と実ファイル・関数へ辿る。編集原本は各図と同名のDOT。

[改善設計](refactor-rationale.md)と[提案図](design-history/ownership.svg)は設計時の履歴。候補は採用6段階を実装済みで、28現在図と設計時3図を区別する。BellTeamの`modules/aiterm`にはこの入口と接点をリンク登録し、製品内部図をコピーしない。製品候補へ必要な図を移管する際も入口を索引として維持し、編集正本を二重に持たない。

## 公開窓口と責任

本体の登録名`aiterm.native`は以下の公開窓口の総称。変更通知は該当機能担当と全体統合のトロニーへ渡す。

| 本体側の正本・担当 | 提供する窓口 | 本体 / 製品の責任 |
| --- | --- | --- |
| [execution](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/execution/README.md)・キロ | `agent_launch`、`pty_send`、`pty_observe`、`pty_close`、`agent_configure`、`agent_goal`、待機/回答/turn/interimの既存MCP契約 | 本体はBot/session-slot・配送job・設定適用時機と再開/停止の方針。Aitermはnative出生本人性・入力受付・vendor作用/完了観測・typed receipt/例外 |
| [runtime](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/runtime/README.md)・エピネル | `aiterm-mcp`/`aiterm-setup`/`aiterm-update`、既存setup exportと登録形式 | 本体は席実行機構・CLI/MCP/hook登録・共有設定同期・移行/更新実行。製品は自身のsetup/update実装と互換性。OS/共有host管理はホスト担当 |
| [usage](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/usage/README.md)・ミカ | `agent_auth` start/status/respond/cancelと公開返却 | 本体は認証案内・質問/秘密入力・通知。製品は公式vendor認証接続・専用PTY・応答本人性。資格保存の正本はvendor CLI。例外: claude-codeの`login: "oauth_token"`はsetup-tokenの出したtokenをAitermが`<HOME>/.bellteam-accounts/claude/<slot>/oauth-token`（0600）へ書き、receiptへ`login`を返す（0.70.20） |
| [conversation](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/conversation/README.md)・N102 | 実行制御経由の回答/途中表示、`aiterm/caller`等の既存metadata、親配送の本文形式 | 本体は会話分類・履歴・画像・SSE/画面への引渡し。製品は完了正本からの回答抽出・配送出力。新しい本体私有DB参照を作らない |
| [integration](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/integration/README.md)・トロニー | 上記contract、isError/code/未作用・結果不明の区別、供給原本 | 本体共通入口・エラー射影・契約統合・本番はトロニー。製品内部の原因修理と製品版はエレグ |
| [distribution](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/distribution/README.md)・センチ | 公式npm/MCPB/Registryの版・integrity・package供給契約 | コンテナ同梱・候補受入・配布はセンチ。Aiterm/Steerの製品公開はエレグ。現在の本番/一般配布保留を維持 |

既存setup依存は`dist/setup-integrations.js`の`mergeClaudeParentHooks`/`mergeCursorParentHooks`、`dist/setup-node.js`の`setupNodeExecutable`、`globalRegistration()`のnode絶対path+entry形、同じ直接/mcp-lazy登録を維持する判定。module path依存も互換契約として残し、分担変更を理由にexportを移さない。

`AGENT_SEND_BUSY`の未送信判定、launchのstartup/initial_prompt、resume拒否のsession/launch/input/recovery、configureのnot_applied/not_startedとoutcome_unknown/effect:possible、認証relogin/status/cancel、親配送本文の先頭は既consumer契約として保持する。受付・処理完了・画面反映は別。公開0.63.2のlaunch receiptにlaunch_idはなく、`pty_observe`の現在観測と区別する。保存model値だけで現在実動を証明しない。

Steer SDK/CLIとBridgeの保存形式読取依存は[接点表](external-contracts.md)が正本。Bridgeの台帳/予約/receiptはリター、channel/hookの状態と出力はエレグ。emittedをvendor開始へ拡張しない。運用で使うget_self/update_self/sendmessage/予定はBellTeam MCPであり、製品内部のAPIと混同しない。

## 公開の入口（package exports、0.70.58、bd04）

指揮官氏 2026-11-14：製品の間は図にある契約の入口だけで繋ぐ。BellTeamは今、`/usr/local/lib/node_modules/aiterm-mcp/dist/*.js` を絶対パスで読み込んでいる（トロニー氏の洗い出し product-connections-inventory-20261114.md 16-23行目）。Aitermが約束する入口は `package.json` の `exports` に載せた次の物だけ。名前で読む（`import("aiterm-mcp/setup-node")`）。載せていない `dist` のファイル、関数、引数は、版の間で予告なく変わる。

| 入口 | 中身（読む物） | データの流れ（誰が何を読み書きするか） | 使う側（BellTeam） |
| --- | --- | --- | --- |
| `aiterm-mcp/setup-node` | `mcpRegistration()` → `{command, args}`（nodeの絶対path＋このpackageの`dist/index.js`。`aiterm-setup` が書く形と同じ。npmを呼ばない）、`setupNodeExecutable()` | Aitermが自分の起動の形を返す。各CLIの設定へ書くのはBellTeam（mcp-lazyの中継で包むかもBellTeam） | aiterm-hooks.mjs・harness-config.mjs（16・19行目のMCP登録の形） |
| `aiterm-mcp/setup-integrations` | `mergeClaudeParentHooks(file, registration)`、`mergeCursorParentHooks(file, registration)`、`ensureCodexParentSteer(home, {binary})` | 渡されたfile（`~/.claude/settings.json`・`~/.cursor/hooks.json`）とCodexのhook設定を、Aitermが書く | aiterm-hooks.mjs |
| `aiterm-mcp/execution-parent-worker` | `localParentWorkerRuntime.scope()` → `{state_root, multiplexer.key}` | 読むだけ | aiterm-hooks.mjs（実行の席の登録） |
| `aiterm-mcp/execution-native-setup` | `configureNativeExecutionHooks(home, {registration, expectedScope, providerFile, codexBinary})` | 席のhook設定をAitermが書く | aiterm-hooks.mjs |
| `aiterm-mcp/execution-native-server` | `parseNativeExecutionArguments(args)`。このファイル自体が実行の席のMCPの入口（`--execution-interrupt --state-root --socket --steer-provider`）。`import.meta.resolve("aiterm-mcp/execution-native-server")` でpathを得る | 読むだけ（読み込んでも起動しない） | aiterm-hooks.mjs |
| `aiterm-mcp/child-result` | `CHILD_RESULT_PREFACE`（子の結果を親へ渡す文の1行目の頭）、`answerMessage(record)` | Aitermが親の席へ送る文の頭。BellTeamは比べるだけ | self-turns.mjs（23行目） |
| `aiterm-mcp/state-compat.json` | `aiterm.state-compat.v1` | Aitermが宣言し、BellTeamが読んで置き場を移す | aiterm-state-compat.mjs（20行目） |
| `aiterm-mcp/package.json` | 版 | 読むだけ | 配布の確かめ |

`--steer-provider` に渡すSteer（`aiterm-steer-delivery`）は、aiterm-mcpの依存packageとして、`execution-native-server` の場所から解決してよい（Steerの公開入口。Steerの約束はSteerの製品正本）。

約束しない物：
- `model-handoff-transport.js`・`model-handoff-control-transport.js`・`model-handoff-control.js`（17・18行目）。公開の版に無い（取り込んでいない私の枝 `feat/handoff-platform-elegg-20261105` などにだけある）。BellTeamは外すか、`ai.aiterm/handoff.*.v1` の能力の確かめの後ろに置く（bd05）。
- 状態の置き場（`AITERM_STATE_BASE`）の中の並びと、入れたpackageの中のファイル一覧（21・22行目）。約束は環境変数 `AITERM_STATE_BASE` と `state-compat.json` だけ。packageは版とintegrityで丸ごと扱う。
- 子の結果の文の2行目以降（`delivery_id=` などの並び）。頭だけが約束。

BellTeamがやめる事（キロ氏 bd05・モリー氏 bd06 が移す）：
- `dist/*.js` を絶対パスで読む事（16行目）→ 上の表の名前で読む。`execution-native-server` のpathは `import.meta.resolve("aiterm-mcp/execution-native-server")`。
- `model-handoff-*` を読む事（17・18行目）→ 外す（公開の版に無い）。
- Aitermの起動の形を手で組む事（19行目）→ `mcpRegistration()` の `{command, args}` を使う。mcp-lazyの中継で包む事と各CLIの設定へ書く事はBellTeamの受け持ちのまま。
- 子の結果の文の頭を写して持つ事（23行目）→ `CHILD_RESULT_PREFACE`。
- 入れた `aiterm-mcp` packageの中で `npm ci` を流す事（22行目）→ 公開のtarballを `npm install` で入れる（依存はpackageの `dependencies` で入る）。packageの中のファイルを並べて照らす事もやめ、版とintegrityで照らす。
- 状態の置き場（21行目）は今のまま：約束は `AITERM_STATE_BASE` と、`state-compat.json` が古いと宣言した置き場をBellTeamが移してよい事（20行目）。

移り方：0.70.58は `exports` を足すだけで、今の絶対パスの読み込みは壊れない（`exports` は名前での読み込みにだけ効く）。BellTeam（キロ氏 bd05・モリー氏 bd06）が名前での読み込みへ移した後も、絶対パスの読み込みを塞ぐ手立てはAitermに無い。約束の外として扱う。

## 今回の変更範囲

担当連絡先、正本リンク、着手手順を更新した。公開入力/返却/状態所有/機能接続の構造は不変なので、製品内部図・本体の生成済み全体図の直接編集と動作試験再走は不要。接続登録のリンク追加はトロニーへ成果を渡す。他席checkout編集0。

各コード変更前は本体と製品の全体・担当・呼出元/使用先の図を読み、共通手順に沿って変更要否と範囲を記録する。必要な図とコードは同じ差分に含める。対象図は製品repoの`docs/architecture/`へ正本を移し、旧場所はリンクに置換する。自席外の進行資料だけで代用せず、現行/未実装設計/完成候補を区別する。

モデルの現在値と希望値を区別し、運用の設定適用記録は本体側で保持する。本体の適用時機/待機契約はキロ、Aitermのnative設定契約はエレグ。双方の修理を今回の製品refactor commitへ混ぜない。
