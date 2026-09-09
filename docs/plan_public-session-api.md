# 公開セッション観測と起動結果の補完

## 目的と所有境界

現在地: 公開API実装とMac・Linuxの個別実機検証、独立実装監査の1件修理まで完了。
Windowsは先行観測試験後にSSH timeoutとなり、最新harness試験が未実施。main CI・公開・公開後smokeは未着手。
判断は[ADR 0052](adr/0052-public-session-observation.md)、実測は[検証記録](evidence/20260910-public-session-api.md)を参照。

Peertableが内部tmux／psmux操作とTUI文字列解析を撤去できるよう、Aitermが所有する
セッション・harness状態、活動、起動・承認、内側からの識別を公開APIへ揃える。
ユーザーの2026-09-10依頼とPeertable担当からの要求に基づく。Peertable・dotagentsの
repositoryは変更しない。共有AI設定の導入は対象端末をPeertable担当へ連絡して直列で行う。

- 症状の製品: Peertable。内部PTY操作とharness方言を補完している。
- 状態の所有製品: Aiterm。PTY、harness相関、起動、観測を所有する。
- 修理する理由: 公開APIに構造化した観測・未送信結果・通常PTYの自己識別が不足している。
- 反証: 実コードと最小再現を根拠に、公開契約を別ベンダーで反証してから公開する。

## 確認済みの不足

基準はmain `a3b6b5e`、公開npm `0.32.0`。Macの現在のMCP登録実体は旧版で、
setup実機確認のSSH接続待ちは前の計画に保持する。

1. 公開`pty_list`は文字列だけ。指定sessionの存在・pane／harnessの生存・状態・理由を
   構造化して返す面がない。公開MCPの最小再現でもstructuredContent欠落を確認した。
2. 既存の預け仕事はsession envの帰属、画面変化、process subtreeの累積CPU差分で観測する。
   生のargvや環境全量は公開せず、非秘密キーの明示照会と活動観測が必要。
3. `initial_prompt=not_sent`を呼び出し元が解析し、dialogと初手を補完している。
   起動時の既知trust等、実行中の承認、初手の送信・ターン開始を公開receiptで区別する必要がある。
4. agentには`AITERM_SESSION_ID`が既に入るが通常PTYにはない。
   sessionとprocess group／harnessのnative PID、開始識別子、argv digestも必要。

Peertable提供fixtureにはGrokの通信失敗＋Waiting表示、通信失敗なしのWaiting、
20行折返しの通信失敗、CodexのMCP／command承認、古い承認より新しいbusy／idleを
優先する例、28行折返しの承認がある。これらをAitermの回帰条件にする。

## 最小設計の作業案

- `pty_list`を後方互換のtext付き構造化結果にし、列挙と明示した非秘密envキーの照会を所有する。
- 新しい`pty_observe`で指定sessionの存在、pane／harnessの生存、
  busy／idle／blocked／dead／missing／unknown、理由、観測時刻、process identityを返す。
  画面本文を返さず、harness方言は各adapterに置く。
- 活動差分は前回のopaque観測cursorとの比較で返す。processのPID再利用・session再作成を
  混同せず、出力変化とCPU実働を別fieldにする。初回／取得不能を活動ゼロへ丸めない。
- 起動receiptには初手未要求・未送信・開始確認済み・未確認の区別と理由を加える。
  送信しただけ／入力欄から消えただけをターン開始の証拠にしない。未知dialogはtyped error。
- 実行中の承認はinspect／respondの公開操作にし、提示された選択・session相関・
  現在のdialog digestを確認してから送信する。無差別承認や権限設定の書換えはしない。
- 通常PTYにも`AITERM_SESSION_ID`を入れ、登録・PID変換・OS差を製品に閉じ込める。

具体schemaと対応dialogは実測と独立反証後に確定する。OSのprocess観測はruntime、
harnessの表示・起動差はharnesses、MCP schemaはindex、共通進行はcoreが所有する。

## 小修理

通常shellのheredoc末尾へ`mark:true`が`; printf ...`を連結し、delimiterを壊す再現が
2担当で発生した。`src/tmux-runtime.ts`の`appendMarkSentinel`が所有する。
公開API補完と分けたfocused回帰で修理し、同じ公開工程へ含める。

## 進め方と受入

親が設計・実装・releaseを担当し、境界と公開契約を別ベンダーで反証する。
公開schema・core・harnessが結合するためwriterは直列とする。Lattice工程は新規適用しない。
独立した読み取り・反証は実装と並行できる。

最小再現、focused試験、必要な関連試験、全文書点検、3環境CI、main統合・push、
製品release入口、公開npm再導入、公開MCP smokeまでを受入に含める。
setupは作り直さず、既存の成功試験は変更影響があるものだけ再実行する。

現在地: 公開面と利用コードを照合済み。Windowsのenv／PID観測を実測中。
実装・独立反証・公開は未着手。
