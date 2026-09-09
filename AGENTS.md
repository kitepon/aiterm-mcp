# AGENTS.md

aiterm-mcpで働くAIのプロジェクト正典。利用者向け公開契約は[README](README.md)／
[日本語README](README.ja.md)、設計は[DESIGN](docs/DESIGN.md)、文書地図は
[docs overview](docs/00_overview.md)、公開工程は[RELEASE](docs/RELEASE.md)を正とする。
版別の変更と完了証拠は[CHANGELOG](CHANGELOG.md)、`docs/adr/`、`docs/archive/`に置き、
このファイルへrelease日誌を複製しない。

## 製品と所有境界

本repositoryはAitermを単独で開発・導入・運用・診断・復旧・更新・releaseできる状態を所有する。
install、設定、PTY/session、agent相関state、schema、migration、diagnostics、recovery、公開物の正本は
このrepository内に置く。dotagentsは任意の工場統合、host wire、製品間compatibilityと統合受入を担うが、
Aitermの製品判断・実行・releaseを制御せず、通常利用の必須依存でもない。

## 現行契約

- 導入後の正規入口は`aiterm-setup`。依存準備、MCP端末の実行、検出したAIのユーザー登録と読戻しを所有する。
  npm lifecycleからは設定を変更せず、外部工場の設定補完を前提にしない。
- Node.js 18以上。POSIXはtmux、Windows nativeはpsmux 3.3.8以上＋Git for Windowsを使う。
  Windowsの対話shellはPowerShell 7だけとし、Windows PowerShell 5.1、PowerShell 6、`cmd.exe`、
  WSL bridgeへfallbackしない。
- 公開面は18 tools。PTY 7、標準`agent_launch` 1、deprecated互換launcher 4、
  `agent_configure`、`agent_steer`、`agent_approval`、`claude_turn`、`claude_approval`、`diagnostics`である。
- `pty_list`は明示した非秘密envキーだけを照会し、`pty_observe`はpaneとharnessの生存・native PID・
  状態・活動を区別する。取得不能はnull／unknownで返し、生argvと画面本文を観測receiptへ出さない。
- `trust_project:true`のlaunchはpromptなしでも既知の起動準備とharness生存を確認する。
  初手の未送信・送信済み未確認・開始確認を区別し、終了したharnessの残画面へ送信しない。
- `agent_launch`はharnessとmodelを別軸にする。harnessはagent loop、認証、hook、session、
  transcriptを所有し、modelはそのharness上で選ぶ。ComposerはGrok CLIのmodel presetである。
- launcherは直接CLIと同じ通常`HOME`、project／user設定、MCP、plugin、skill、permission、trust、
  memory、historyを使う。Aitermはlaunch相関、完了event、bounded result、cleanup metadataだけを所有し、
  credential／設定をcopy、snapshot、filterしない。
- agentへの送信は非ブロックdispatchで即返す。完了はreceiptの`wait_process`を別processとして起動し、
  `outcome`を判定する。親自身のturnをforeground waiterで止めない。回答回収は
  `pty_read(agent_transcript:true)`または`claude_turn recover`を使い、timeout後にpromptを再送しない。
- 公開復旧は`pty_list`で対象を確認し、該当sessionを`pty_close`して同じIDで作り直す。
  公開toolに全session一括停止はない。`core.killAll()`は内部test cleanupであり、利用者へ案内しない。
- runtime error storeは製品所有のlocal stateで、network I/Oを持たない。工場reporter configによる収集は
  明示opt-inの任意adapterであり、未設定でもPTY／agent／diagnosticsは単独で動く。prompt、transcript、
  path、credential、生stack／stderrを保存・公開しない。

## コード所有

- `src/setup.ts`／`src/setup-cli.ts`: 導入の順序・公開結果。`src/setup-platform.ts`: OSと公式導入経路。
  `src/setup-integrations.ts`: AI別のMCP登録と読戻し。
- `src/index.ts`: MCP toolとschema。
- `src/core.ts`: PTY、入出力整形、出力削減、完了検出、harness共通進行。
- `src/harnesses/`: Claude／Codex／Grok／Cursor固有の起動、ready、完了、transcript、catalog。
- `src/harnesses/grok.ts`: Grok／Composerのfolder trust、入力受付、sandbox起動拒否の検出と原因付きエラーも所有する。
  `src/core.ts`は該当harnessで判定を呼び出すだけとし、CLIの拒否文言や設定の修復処理を持たない。
- `src/agent-shared.ts`／`src/state-root.ts`: harness中立の相関state。
- `src/tmux-runtime.ts`／`src/psmux-send-worker.ts`／`src/agent-resolver.ts`: OS・multiplexer差。
- `src/process-runtime.ts`: native process identity、親子関係、CPU時間のOS差。
- `src/runtime-error-*.ts`: 製品所有のoffline error aggregate。
- `src/rtk.ts`: 自前reducer。pytestはrtk 0.42.0と一致し、`FAILED`理由全文保持だけ意図的に異なる。
- `prototype/python/`: 旧MVPとreducer移植元。参照専用。

依存方向はcore → harnesses → agent-shared → runtime／errorsの一方向を保つ。harness差をcoreへ、
OS差をharnessへ戻さない。stdioはJSON-RPC通信路なのでproductionコードからstdoutへ出力しない。

## 作業規律

- 原因を最小再現してから修理し、別経路へのfallback、retry、成功丸めで症状を隠さない。
- 変更に直結するfocused testを先に実行し、関連gate完了後に`npm test`を一度だけ行う。
- agentの認証・model catalog・設定・updateは各harness所有者の公式CLIへ委ねる。Aiterm独自の代替配布や
  credential操作を加えない。
- `.claude/settings.local.json`、`.vscode/tasks.json`、`Zone.Identifier`等の端末固有fileは触らない。
- 設計判断を変えたらDESIGNと関連ADR、公開挙動なら日英READMEとCHANGELOG、公開metadataなら
  package／server／MCPBを同じ変更で同期する。

## 文書の寿命

- currentには現行の契約、設計、運用、release手順だけを置く。
- 完了・棄却・中断・失効・置換により現行制御から外れたplan、audit、release receipt、旧promotion文書は`docs/archive/`へ移す。未解決で今も必要な作業はcurrent backlogへ移してからarchiveする。
- 同じ目的のcurrent文書を増やさず、README、DESIGN、RELEASE、CONTRIBUTING、SECURITYの既存正本へ統合する。
- `docs/adr/`と`docs/evidence/`は判断・証拠の履歴であり、current手順として列挙しない。
- Latticeや過去ADRが固定pathを参照する場合だけrootに短いhistory stubを残し、本文はarchiveへ置く。

## 調査資産

外部仕様を調べる前に`rag/INDEX.md`を読む。新しい一次資料は`rag/ingest.py`で取得し、front matter、
`rag/manifest.json`、INDEXを同期する。既存raw corpusは現行文言へ書き換えない。

## 検証とrelease

```bash
npm run build
npm test
```

GitHub Actionsは変更した実装の依存関係から必要なテストを選び、共通変更はmacOS native、Linux workstation、Windows nativeで実行する。依存を確定できない変更は全テストへ広げ、版番号だけの変更はLinuxの配布確認へ絞る。分類と検証範囲の詳細は[RELEASE](docs/RELEASE.md)を正とする。
製品の受入コマンドと3環境runner契約は、このrepositoryの`.github/workflows/product-full-ci.yml`が所有する。
dotagentsの工場CIは製品gateの結果を横断受入へ使えるが、製品workflowの正本ではない。
releaseは[docs/RELEASE.md](docs/RELEASE.md)のmain祖先gate、3環境CI、npm provenance、GitHub Release＋
MCPB、Official MCP Registry、公開package smokeまでを満たす。
