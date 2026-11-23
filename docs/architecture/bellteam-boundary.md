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
| [usage](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/usage/README.md)・ミカ | `agent_auth` start/status/respond/cancelと公開返却 | 本体は認証案内・質問/秘密入力・通知。製品は公式vendor認証接続・専用PTY・応答本人性。資格保存の正本はvendor CLI。例外: claude-codeの`login: "oauth_token"`はsetup-tokenの出したtokenをAitermが許可folder（環境変数`AITERM_CLAUDE_TOKEN_ROOTS`。a532b3、0.70.99。未設定の間は中立の`<HOME>/.aiterm/claude-accounts`と従来の`<HOME>/.bellteam-accounts/claude`）の`<slot>/oauth-token`（0600）へ書き、receiptへ`login`を返す（0.70.20） |
| [conversation](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/conversation/README.md)・N102 | 実行制御経由の回答/途中表示、`aiterm/caller`等の既存metadata、親配送の本文形式 | 本体は会話分類・履歴・画像・SSE/画面への引渡し。製品は完了正本からの回答抽出・配送出力。新しい本体私有DB参照を作らない |
| [integration](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/integration/README.md)・トロニー | 上記contract、isError/code/未作用・結果不明の区別、供給原本 | 本体共通入口・エラー射影・契約統合・本番はトロニー。製品内部の原因修理と製品版はエレグ |
| [distribution](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/distribution/README.md)・センチ | 公式npm/MCPB/Registryの版・integrity・package供給契約 | コンテナ同梱・候補受入・配布はセンチ。Aiterm/Steerの製品公開はエレグ。現在の本番/一般配布保留を維持 |

既存setup依存は`dist/setup-integrations.js`の`mergeClaudeParentHooks`/`mergeCursorParentHooks`、`dist/setup-node.js`の`setupNodeExecutable`、`globalRegistration()`のnode絶対path+entry形、同じ直接/mcp-lazy登録を維持する判定。module path依存も互換契約として残し、分担変更を理由にexportを移さない。

`AGENT_SEND_BUSY`の未送信判定、launchのstartup/initial_prompt、resume拒否のsession/launch/input/recovery、configureのnot_applied/not_startedとoutcome_unknown/effect:possible、認証relogin/status/cancel、親配送本文の先頭は既consumer契約として保持する。受付・処理完了・画面反映は別。公開0.63.2のlaunch receiptにlaunch_idはなく、`pty_observe`の現在観測と区別する。保存model値だけで現在実動を証明しない。

Steer SDK/CLIとBridgeの保存形式読取依存は[接点表](external-contracts.md)が正本。Bridgeの台帳/予約/receiptはリター、channel/hookの状態と出力はエレグ。emittedをvendor開始へ拡張しない。運用で使うget_self/update_self/sendmessage/予定はBellTeam MCPであり、製品内部のAPIと混同しない。

## Claude machine harness（0.70.85、a471、ruling 13・14）

`agent_launch` の `harness` に `claude-machine`（機械Claude。[ADR 0144](../adr/0144-claude-machine-is-its-own-harness.md)）。この席の公開の `harness` は全て `claude-machine`、`vendor`・`provider` は `claude`（Goalの `kind` はvendorの `claude-code`）。休止席のwakeは名指しのharness（または保存した値）で同じ会話を再開（両方向）。断りは `REMOTE_AITERM_TOO_OLD`（別端末が0.70.85未満）と `AGENT_MACHINE_UNAVAILABLE`（席を残さない）。古いlocal Aitermは `agent_launch` の `harness` の列挙に無いので、tools/listの `inputSchema.properties.harness.enum` で見分ける。

machine席の出力は**データ**で渡す（[ADR 0143](../adr/0143-machine-seat-stream-is-data.md)、[契約](claude-machine-stream.md)）。新しい公開tool `stream_read`（claudeのstream-jsonの行をそのまま、cursor・long poll）と `stream_send`（user・control_request・control_response。型の許可表だけ）。AskUserQuestionはstream上の `can_use_tool` のcontrol_requestで、答えは呼び手が作るcontrol_response（Aiterm側に形は無い）。既存のtool（pty_send・pty_observe・claude_approval・agent_stop・agent_configure・agent_goal）はmachine席でも同じ形で答える。BellTeam側（execution＝キロ氏が運び、conversation＝N102が表示・答えを作る）は、Aitermの内部形式（file）を読まない。

## 公開の入口（package exports、0.70.58、bd04）

指揮官氏 2026-11-14：製品の間は図にある契約の入口だけで繋ぐ。BellTeamは今、`/usr/local/lib/node_modules/aiterm-mcp/dist/*.js` を絶対パスで読み込んでいる（トロニー氏の洗い出し product-connections-inventory-20261114.md 16-23行目）。Aitermが約束する入口は `package.json` の `exports` に載せた次の物だけで、**`exports` の表そのものが約束**。各入口の値は、packageの根の中のファイルを指す文字列（`./` で始まる。条件の分岐は使わない）。読む側は、自分が選んだ版のpackageの根（BellTeamはruntimeの世代が決める `lib/node_modules/aiterm-mcp`）の `package.json` の `exports` から入口の値を読み、`<根>/<値>` を読み込むか node で走らせる（キロ氏 2026-11-14。素の `import("aiterm-mcp/...")` は読む側の node_modules の写しに当たるので使わない）。載せていない `dist` のファイル、関数、引数は、版の間で予告なく変わる。

| 入口 | 中身（読む物） | データの流れ（誰が何を読み書きするか） | 使う側（BellTeam） |
| --- | --- | --- | --- |
| `aiterm-mcp/setup-node` | `mcpRegistration()` → `{command, args}`（nodeの絶対path＋このpackageの`dist/index.js`。`aiterm-setup` が書く形と同じ。npmを呼ばない）、`setupNodeExecutable()` | Aitermが自分の起動の形を返す。各CLIの設定へ書くのはBellTeam（mcp-lazyの中継で包むかもBellTeam） | aiterm-hooks.mjs・harness-config.mjs（16・19行目のMCP登録の形） |
| `aiterm-mcp/setup-integrations` | `mergeClaudeParentHooks(file, registration)`、`mergeCursorParentHooks(file, registration)`、`ensureCodexParentSteer(home, {binary})` | 渡されたfile（`~/.claude/settings.json`・`~/.cursor/hooks.json`）とCodexのhook設定を、Aitermが書く | aiterm-hooks.mjs の予備の分岐だけ（nativeの登録が作れなかった時。モリー氏がその分岐を外すまで残す、2026-11-14） |
| `aiterm-mcp/execution-parent-worker` | `localParentWorkerRuntime.scope()` → `{state_root, multiplexer: {kind, key}}`（0.70.104からこの1つだけ。worker本体は消した） | 読むだけ | aiterm-hooks.mjs（実行の席の登録） |
| `aiterm-mcp/execution-native-server` | `parseNativeExecutionArguments(args)`、`createNativeDeliveryServer`（通常配送と `agent_stop`。0.70.104から実行の記録を載せた `createNativeExecutionServer` / `createNativeExecutionWorker` は無い）。このファイル自体が実行の席のMCPの入口（`--execution-interrupt --state-root --socket --steer-provider`）。pathは `exports` の値から得る | 読むだけ（読み込んでも起動しない） | aiterm-hooks.mjs |
| `aiterm-mcp/child-result` | `CHILD_RESULT_PREFACE`（子の結果を親へ渡す文の1行目の頭）、`answerMessage(record)` | Aitermが親の席へ送る文の頭。BellTeamは比べるだけ | self-turns.mjs（23行目） |
| `aiterm-mcp/resume-state-cli` | node で走らせるCLI（読み込まない）。`restore --session <席名> --launch <32桁hex> --sha256 <64桁hex>`：標準入力にcheckpointのbytes、成功は終了0と標準出力に1行のJSON `aiterm.resume-state-result.v1` `{operation, session_id, launch_id, checkpoint_sha256, outcome: restored｜already_restored}`。`checkpoint --session --launch`：標準出力にbytes、標準エラーに同じ形の1行（outcome saved）。失敗は終了2と標準エラーに1行の誤り（本文を出さない）。同じbinは `aiterm-resume-state` | 本体の起動時に、BellTeamが席の利用者で走らせる。checkpointの中身はAitermが読み書きする | runtime-resume.mjs（28行目）・compose.aiterm-checkpoint.yaml |
| `aiterm-setup harness-entries --json`（bin、0.70.58、bd14。0.70.60で `execution-native-setup` の入口を置き換えた） | CLIの設定ファイルへ入れるAitermのhookを `bellteam.harness-entries.v1`（E1 v1.1）で返す。引数・出力・書く物は setup-update.md「CLIのhookの項目を返す」 | Aitermは自分の置き場（codex-parent-hooks/config.json）だけ書く。CLIのファイルとCodexの承認はBellTeamが1人で書く | BellTeamのCLI登録（モリー氏 bd14。aiterm-hooks.mjs の hook設定の呼び出しを置き換える） |
| `aiterm-mcp/state-compat.json` | `aiterm.state-compat.v1` | Aitermが宣言し、BellTeamが読んで置き場を移す | aiterm-state-compat.mjs（20行目） |
| `aiterm-mcp/package.json` | 版 | 読むだけ | 配布の確かめ |

`--steer-provider` に渡すSteer（`aiterm-steer-delivery`）は、aiterm-mcpの依存packageとして、`execution-native-server` の場所から解決してよい（Steerの公開入口。Steerの約束はSteerの製品正本）。

約束しない物：
- `model-handoff-transport.js`・`model-handoff-control-transport.js`・`model-handoff-control.js`（17・18行目）。公開の版に無い（取り込んでいない私の枝 `feat/handoff-platform-elegg-20261105` などにだけある）。BellTeamは外すか、`ai.aiterm/handoff.*.v1` の能力の確かめの後ろに置く（bd05）。
- 状態の置き場（`AITERM_STATE_BASE`）の中の並びと、入れたpackageの中のファイル一覧（21・22行目）。約束は環境変数 `AITERM_STATE_BASE` と `state-compat.json` だけ。packageは版とintegrityで丸ごと扱う。
- 子の結果の文の2行目以降（`delivery_id=` などの並び）。頭だけが約束。

BellTeamがやめる事（キロ氏 bd05・モリー氏 bd06 が移す）：
- `dist/*.js` を絶対パスで決め打ちする事（16行目）→ 選んだ版の根の `exports` から入口の値を読んで、そのファイルを読む（`execution-native-server` と `resume-state-cli` のpathも同じ）。
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

## Approval Box door on remote hosts（a516e、0.70.94 に追加、0.70.103 で削除）

Aitermの `aiterm-approval-door`、`approval-door.ts`、`registerDoor` は0.70.103で消した。同じ役目のドアはBellTeam側（`~/.bellteam/approval-box-door.sock`、Windowsは `\\.\pipe\bellteam-approval-box-door-<user>`）が持ち、`post_launch`（0.70.100）で起動・復帰の度に席を登録する。アドレスが違うので、ホストでの作業は要らない。Aitermは決裁箱の名も本体の `/api/seat-mcp/approval-box/local` も持たない。

## 端末の席との画像（a521、0.70.96）

BellTeamは今までどおり `pty_send` に `image:[本体の上の絶対path]` を付けて送る。端末の席へはAitermが画像のバイト列を現地の一時フォルダへ運び、現地のpathで添付する（画像だけ。画像以外の添付ファイルと、端末の席への `agent_launch` の `image` は運ばない）。席が作った画像は公開tool `image_read({session_id, path})` で1枚ずつ読む（png/jpeg/gif/webp、25 MiBまで、席の作業フォルダと一時フォルダの中だけ。結果はMCPの `image` と `aiterm.image-read.v1`）。誤りのcodeと正本: [remote-terminal.md](remote-terminal.md) R23・R24。コンテナのAitermはimageの版で、0.70.96を載せた本体から使える。

## BellTeam固有の部品の移行表（a532b2、キロ氏の表の写し。トロニー氏の裁定 a532）

正本はBellTeam main `45af2be3` の `docs/architecture/modules/execution/aiterm-boundary-move.md`。ここは、Aitermの側から見た写し（図とAiterm側の外す条件）で、本文は複製しない。原則はOwnerの裁定: Aitermは機械の口にある機能を素直に届け、BellTeam固有の機能はBellTeam側へ。段階ごとに、BellTeamの置き換えが本番で動いてから、Aitermが外す。外す間もAitermは単独で使える。

### 機能図（BellTeamのどの部分がAitermのどの部品を呼ぶか）

| BellTeam側（担当） | 呼ぶAitermの部品 | 段階 | Aitermが外す条件 |
| --- | --- | --- | --- |
| `execution-bridge.mjs`（キロ。本番では `executionBridge: null`、試験だけ） | `agent_execution`、`agent_execution_roots`、execution store（`execution-*.ts` の大半） | 1b | 済み: キロ氏の1a（BellTeam PR #2368）が本番で動き、Aiterm側は0.70.104で削除。消した物と残した物は [private-execution.md](private-execution.md) の頭 |
| なし（`src` に呼び手なし。他製品の呼び手も確認できず） | `throughline_source_session` / `throughline_supplement_file` | 1 | 外さない。BellTeamの名前を持たない汎用のforkとして残す（トロニー氏の裁定） |
| `remote-seats.mjs`（キロ・クラスト） | `mcp_config` の席への道の書き換え（`rewriteSeatMcpConfig`、`ensureSeatForward`） | 2 | BellTeamが最終のconfigを作り、Aitermは書き換えずに渡す形が本番で動いた後（端末の席の仕組みはb4でクラスト氏へ） |
| `#seatTurns`・route resume（キロ） | `pty_list` の `seat_turns` / `route_since` / `unread` | 3 | 0.70.108で、番と `own_work` を `pty_list` の `sessions[]` へ汎用の名前で足した（`include: ["turn", "own_work"]`、呼び手の印なし）。BellTeamが `sessions[]`・`forward_status`・`pty_observe` から同じ値を出し、影の比較で差が0になった後に、`seat_turns` の `_meta` と `route_since`・`unread` を外す。`interim_from` と `own_work` はAitermに残す（汎用の事実。裁定、キロ氏との往復 2026-11-23） |
| `waitProcess`・`steerFollow`・`waitUntilDone`（キロ） | steer-follow（`wait_process`、`steer_id`、`input_id`、`aiterm-wait --steer`） | 4 | **Aitermに残す（裁定A）**。外さず、名前だけ中立にする（下の「steer-followの裁定A」）。0.70.105で `input_ref` / `--input-ref` を足し（古い名前も併存、出し分けは外した）、キロ氏の切り替え後の0.70.107で `steer_id` と `wait_process` の `--steer` を外した（ADR 0122 追記2）。BellTeamは自分の消費側だけを持つ |
| `sendSessionStop`（キロ） | `agent_stop` | 5 | **Aitermに残す（トロニー氏の裁定A、キロ氏経由 2026-11-23）**。BellTeamの入口だけにあった `agent_stop` を、0.70.110から既定のサーバーの中立な公開toolにする（BellTeamの語も呼び手の絞り込みも無い。入力 `{session_id \| session_ids, pause_goals?}`、全体の停止の `_meta["aiterm/goal"] {origin:"user"}`、結果の形は変えない） |
| `aiterm-hooks.mjs`・`harness-entries.mjs`（モリー） | `execution-native-server`、`execution-parent-worker`、`execution-native-setup`、`bellteam.harness-entries.v1` | 5 | ランタイムが汎用のAitermの入口で動く形（モリー氏）が本番に出た後 |
| クラスト（a532b1） | 決裁箱のドア（`approval-door.ts`、`registerDoor`） | b1 | 済み: BellTeamのドアが3台で動き、Aiterm側は0.70.103で削除（`post_launch` は0.70.100） |
| クラスト（a532b4、最後） | 端末の席の仕組み一式（`remote-terminal*.ts`、`aiterm-remote-terminal`） | b4 | クラストの計画（最後に決める）が本番に出た後 |

### データの流れ

新しいデータの道は作らない。各段階は、Aitermの形をした事実を、BellTeamが汎用のAitermの事実（`pty_list`・`pty_observe`・席のeventと会話記録）から導いた値で置き換え、両方を影で比べ、切り替え、その後でAitermが形をした方を外す。状態ファイルはAitermの物（state root）のままで、BellTeamは道具とCLIを通してだけ読む。

### steer-followの裁定A（トロニー氏、キロ氏経由）

steer-followは機械の口の機能（動いているCLIの番へ文を差し込んだ後、その文がどうなったかを、各vendorの会話記録から読む）なので、Aitermに残す。動かすのではなく名前を直す: `steer_id` → `input_ref`、`aiterm-wait --steer` → `--input-ref`、BellTeamの語と `aiterm/caller` による出し分けを外す。BellTeamは自分の消費側だけを持つ。併存: 最初の版で新しい名前を足し（古い名前も同じ値で受け、返す）、BellTeamが新しい名前へ切り替えて本番で動いたら、次の版で古い名前を外す。外す版は、キロ氏の切り替えを受けてから決める。


## 起動後の汎用hook（a532b1、0.70.100）

決裁箱のドアをBellTeamへ移すため（トロニー氏の裁定 a532）、`agent_launch` に任意の `post_launch {command: string[]}` を足す。席が起きた後（起動・復帰のどちらも）に、席を作ったAitermがその端末の上で1つだけ走らせる汎用の口で、BellTeamの語も決裁箱の語も持たない。環境の事実（席の名前、席への道の番号、生存確認の命令、起動が使った秘密の値）は[launch-identity-input.md](launch-identity-input.md)と[remote-terminal.md](remote-terminal.md) R25。移行後に `approval-door.ts` と `registerDoor` を外す（BellTeamの新しいドアが3台で動いた後の版）。

## 汎用の入口（a532b2 段階5、0.70.109。モリー氏の登録とhookの項目の置き換え先）

BellTeamのruntimeが、親のAiterm接続と席のhookの登録に使う口を、BellTeamの名前の無い入口へ移す（トロニー氏の裁定 a532、モリー氏の要請）。0.70.109から両方を出し、モリー氏が新しい入口で1作業期間動かしてから、古い方を1回の版で外す。

| 用途 | 今（外す） | 汎用（0.70.109から） |
| --- | --- | --- |
| 親のAitermの入口（MCPとhookの各mode） | `aiterm-mcp/execution-native-server`（`--execution-interrupt --state-root --socket --steer-provider [--mode ...]`） | `aiterm-mcp/native-entry`（`dist/native-entry.js`、`exports` に `./native-entry`）。引数は同じで `--execution-interrupt` が要らない（古い引数列も受けて無視するので、移行中は同じ列で両方を起こせる） |
| 引数の読み取り | `parseNativeExecutionArguments(args)` | `parseNativeEntryArguments(args)`（戻りは同じ形: `{mode, codexHome, hookDirectory, expectedScope: {state_root, multiplexer: {kind, key}}, providerFile, runtimeAdoption?}`） |
| 場所の読み取り | `aiterm-mcp/execution-parent-worker` の `localParentWorkerRuntime.scope()` | `aiterm-mcp/native-entry` の `localScope()`（戻りは同じ `{state_root, multiplexer: {kind, key}}`） |
| CLIのhookの項目 | `aiterm-setup harness-entries --json ...` → `bellteam.harness-entries.v1`（`aiterm-mcp/execution-native-setup`） | `aiterm-setup hook-entries --json --home <p> --state-root <p> --socket <p> --steer-provider <p> [--codex-binary <p>] [--clients claude,cursor,codex]` → `aiterm.hook-entries.v1`。中身（hooks、書く物、失敗の形）は同じ。`owns.commandIncludes` は hookのscript 3つに加えて `native-entry.js` と、移行中だけ `execution-native-server.js` |

外す版: モリー氏が新しい入口で1作業期間動かしたと伝え、キロ氏の停止（段階5）が本番に出た後の、最初の版。番号はその時に私が決めて伝える（それより前の版は両方を持つ）。imageは、0.70.109以上を取っていれば新しい入口を使える。古い入口を使い続ける間、imageの版の下限は要らない。

