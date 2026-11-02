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
| [usage](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/usage/README.md)・ミカ | `agent_auth` start/status/respond/cancelと公開返却 | 本体は認証案内・質問/秘密入力・通知。製品は公式vendor認証接続・専用PTY・応答本人性。資格保存の正本はvendor CLI |
| [conversation](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/conversation/README.md)・N102 | 実行制御経由の回答/途中表示、`aiterm/caller`等の既存metadata、親配送の本文形式 | 本体は会話分類・履歴・画像・SSE/画面への引渡し。製品は完了正本からの回答抽出・配送出力。新しい本体私有DB参照を作らない |
| [integration](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/integration/README.md)・トロニー | 上記contract、isError/code/未作用・結果不明の区別、供給原本 | 本体共通入口・エラー射影・契約統合・本番はトロニー。製品内部の原因修理と製品版はエレグ |
| [distribution](https://github.com/kitepon/BellTeam/blob/341535d5bced58c551152129fcf8f26abcdf06ad/docs/architecture/modules/distribution/README.md)・センチ | 公式npm/MCPB/Registryの版・integrity・package供給契約 | コンテナ同梱・候補受入・配布はセンチ。Aiterm/Steerの製品公開はエレグ。現在の本番/一般配布保留を維持 |

既存setup依存は`dist/setup-integrations.js`の`mergeClaudeParentHooks`/`mergeCursorParentHooks`、`dist/setup-node.js`の`setupNodeExecutable`、`globalRegistration()`のnode絶対path+entry形、同じ直接/mcp-lazy登録を維持する判定。module path依存も互換契約として残し、分担変更を理由にexportを移さない。

`AGENT_SEND_BUSY`の未送信判定、launchのstartup/initial_prompt、resume拒否のsession/launch/input/recovery、configureのnot_applied/not_startedとoutcome_unknown/effect:possible、認証relogin/status/cancel、親配送本文の先頭は既consumer契約として保持する。受付・処理完了・画面反映は別。公開0.63.2のlaunch receiptにlaunch_idはなく、`pty_observe`の現在観測と区別する。保存model値だけで現在実動を証明しない。

Steer SDK/CLIとBridgeの保存形式読取依存は[接点表](external-contracts.md)が正本。Bridgeの台帳/予約/receiptはリター、channel/hookの状態と出力はエレグ。emittedをvendor開始へ拡張しない。運用で使うget_self/update_self/sendmessage/予定はBellTeam MCPであり、製品内部のAPIと混同しない。

## 今回の変更範囲

担当連絡先、正本リンク、着手手順を更新した。公開入力/返却/状態所有/機能接続の構造は不変なので、製品内部図・本体の生成済み全体図の直接編集と動作試験再走は不要。接続登録のリンク追加はトロニーへ成果を渡す。他席checkout編集0。

各コード変更前は本体と製品の全体・担当・呼出元/使用先の図を読み、共通手順に沿って変更要否と範囲を記録する。必要な図とコードは同じ差分に含める。対象図は製品repoの`docs/architecture/`へ正本を移し、旧場所はリンクに置換する。自席外の進行資料だけで代用せず、現行/未実装設計/完成候補を区別する。

モデルの現在値と希望値を区別し、運用の設定適用記録は本体側で保持する。本体の適用時機/待機契約はキロ、Aitermのnative設定契約はエレグ。双方の修理を今回の製品refactor commitへ混ぜない。
