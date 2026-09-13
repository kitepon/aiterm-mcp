# Codex公式App ServerへのパッチとAitermの選択導入

## 緊急復旧: 改造版起動後のKeychain要求（2026-09-13）

改造版でDesktopを再起動した後、オーナーからKeychain要求が大量・無限に出ると報告された。
Desktop実機の受入は不合格であり、改造版の再有効化と製品導入を進めない。
署名の読み取りでは、試用CLIはad-hoc署名・TeamIdentifierなし、公式CLIは
OpenAIのDeveloper ID署名だった。実行中Desktopの子processが試用CLIであることも確認した。
署名変更による既存Keychain項目のアクセス確認が有力な原因だが、要求項目と反復箇所は未特定。
認証コードを変更していなくても、再ビルドでOSから見た実行ファイルの同一性が変わることを
実機投入前に評価できていなかった。模擬認証のfocused testを実認証の受入に代用しない。

止血としてGUI起動環境の `CODEX_CLI_PATH`、`CODEX_APP_SERVER_WS_URL`、
`CODEX_APP_SERVER_USE_LOCAL_DAEMON`、`CODEX_APP_SERVER_FORCE_CLI` を解除し、
`launchctl print gui/501` の対象キーで全件不在を確認した。
共有daemonへの接続も解除し、次のDesktop起動は公式の通常構成に戻す。
実行中の試用processは設定解除だけでは止まらないため、オーナーへ完全終了・再起動を依頼した。
Codex自身のアプリ操作は禁止されているため、別の入口で終了を代行しない。
再起動後、試用processが存在せず、Desktopの子processがアプリ同梱の
`/Applications/ChatGPT.app/Contents/Resources/codex` へ戻ったことを確認した。
同梱CLIのOpenAI Developer ID署名とGUI上書き設定4件の不在も確認した。
オーナーから「キーチェーンの要求は止まったよ」と報告があり、今回の止血・復旧は完了した。
改造版の実認証互換性と大量要求の詳細な発生経路は未解決であり、改造版の再投入は行っていない。
秘密値の読み取り、Keychainの許可変更、署名検査の回避は行っていない。
復旧前設定と読戻しreceiptは `.git/aiterm-experiments/codex-shared-20260913/keychain-containment-*.json` に保存した。
復旧後の根拠と次に必要な観測は
[Keychain障害の復旧記録](evidence/codex-patched-stdio-20260913-keychain-recovery.md) に保存した。

## 2026-09-13の最新ユーザー指示（以降の作業の正本）

オーナーは共有daemonへの接続試験の続きとして、公式App Serverを基礎にした改造を明示した。
以下を原文で保存する。この指示は後続の試験メッセージやcontext compaction後も維持する。

> 公式AppServerのリポジトリをCloneして、俺の目的通りにパッチを当てて、ビルドしてインストールし続けるのが大事だ。
>
> 更新して、パッチを当てて、ビルドし続ける仕事は、メインサーバー上でタスクを後で作るから、そこまではお前はやらなくていい。
>
> お前が今やってもらいたいのは、
> 公式AppServerを　Developer フォルダにCloneして、今回のAitermの目的に沿うように改造、その改造内容を正しく記録する（後から新ビルドに追従するために）のが仕事。
>
> なお、AitermのNPMのインストール時に、AppServerの置き換えまで守備範囲にしないとユーザーは困りますね。
> そこは選択肢気にしないといけない。Steerがなくてもいいなら、AIterm単品。
> Steerが欲しいなら改造版AppServerもインストール。
> NPMインストール時にオプションで選べるようにしなければならない。

### 維持する目的・受入条件

- Aitermの子から親Codexへの回答は、実行中なら同じturnにSteerする。
- 親turnの正常終了後に回答が届いた場合も、同じtaskを自動再開する。終了後の自動再開がない案は却下済み。
- 普段のCodex Desktopの機能と起動時の連携を維持する。アプリ固有MCPの欠落を成功扱いしない。
- 公式 `openai/codex` を `/Users/kite/Developer/` 配下へCloneし、公式App Serverを改造する。
- 上流commit／tag、改造理由、パッチ、再適用・ビルド・試験手順、互換条件を後から追跡できる形で残す。
- Aitermのnpm導入で「Aiterm単品」と「Steer対応の改造版App Serverを含む導入」を明示的に選べるようにする。
  オプトインした利用者のApp Server導入・切替・実効確認までをAitermが所有する。
- macOS、Windows native、Linuxの差を調べ、未検証環境を対応済みと呼ばない。
- gpt-connectorは使わない。アプリの署名検査・操作制限を回避しない。

### 今回の範囲と対象外

今回: 公式repoのClone、最小パッチ、ビルドと機能検証、更新追従用の記録、Aitermの選択導入と配送の実装。
継続更新の自動化はオーナーが後でメインサーバー上に作る。定期タスク、更新監視、継続ビルド運用は今回作らない。
既存公式バイナリやDesktop本体へ場当たり的なバイナリ編集を行わない。

### 作業順序と現在地

オーナーの追加指示により、Cloneの名前は用途が明確な
`/Users/kite/Developer/aiterm-codex-app-server` とする。
最初の `/Users/kite/Developer/codex` から、公式ソースの初回ビルドが終了コード0で完了した後に改名済み。
これは開発用Cloneの改名であり、稼働中のApp Serverの移動ではない。

- [x] 最新指示をこの正本へ原文と受入条件付きで記録する。
- [x] Developer配下へ公式repoをCloneし、適用するAGENTSと上流baselineを確認する。
- [x] 公式App Serverの既存stdio起動・環境継承を保つ改造箇所を最小再現で確定する。
- [x] 公式ソースへのパッチとfocused testを実装し、ビルドする。
- [ ] Aitermの単品／Steer付き導入の入口と、回答配送を実装する。
- [ ] 改造版でSteer・終了後再開・Desktop連携を実機確認する。
- [ ] パッチ再適用とビルド手順、OSごとの確認結果、変更の正本を保存する。

公式 `openai/codex` の `rust-v0.154.0`、commit
`6b9826e3aa83b1a5947db50f4332cb9c65f1b340` をClone済み。
作業branchは `kitepon-rgb/aiterm-parent-steer`。Rust 1.95.0による
`cargo build -p codex-cli --bin codex` は2026-09-13に成功した。
公式tagのCargo.lockはローカルworkspace packageのversionがCargo.tomlと不一致だったため、
公式releaseと同じく `--locked` なしで初回ビルドした。外部依存のversion・source・checksumは変わっていない。
元のlockはClone内の `.git/aiterm-build/upstream-Cargo.lock` に保存済み。
公式ソースのstdio起動分岐へ `$CODEX_HOME/aiterm/<PID>.sock` の受付を追加済み。
追加接続とstdioの同一task参照・要求ID分離、追加接続切断後の親の継続、stdio終了時のsocket削除の2試験が成功した。
同じsocketから `turn/start` を送り、実行中は同一turnへ、正常終了後は同一taskの新turnへ
各回答が一度だけ保存されるfocused testも成功した。新しい試験は計3件で、macOS上の模擬モデルを使用している。
初回のAIShell経由nextestはtest一覧取得で停止したためrun_observeで取消し、
同じ公式nextestをAitermのPTYから実行した。停止原因は未特定で、パッチの失敗・成功とは区別する。
WebSocket圧縮を無効にした公式 `codex app-server proxy --sock` 経由のinitializeも確認済み。
再適用用の差分と基準manifestを `vendor/codex-app-server/` に保存した。
未変更の上流へ再適用した3ファイルが開発Cloneと完全一致することを確認した。
改造後CLIのビルド、試験packageのinitialize・socket作成・stdio終了も成功した。
公式Cloneの機能commitは `dee88f61f`、ビルド準備のlock同期は `bbdd4d0de`。
Aiterm製品コード改造・選択導入は未完了。

Desktopの通常機能を保持できることが製品導入の前提なので、次は人による再起動でそこを確認する。
GUIユーザーの `CODEX_CLI_PATH` を私有試験packageへ指定し、共有daemon用の
`CODEX_APP_SERVER_WS_URL` を解除して読戻しを確認した。
現時点では設定準備だけが完了しており、Desktop自体はまだ再起動していない。
受入と復旧は [改造版の再起動前記録](evidence/codex-patched-stdio-20260913-pre-restart.md) を参照する。
同じControlの人による再起動観測taskは記録済み（revision 4）。
アプリの署名検査・操作制限を回避しない。再起動後に残る製品配送・npm選択導入も、この依頼の続きとして扱う。
既存の共有daemon試験構成は稼働中で、
通常起動への復元は未実施。現在の試験タスクを動かしているprocessを途中で停止しない。
複数repoの変更を調整するため統括レーンを継続する。Latticeと定期タスクは作らない。
パッチの接続契約が導入・配送の前提なので、まず親が公式ソースと契約を確定し、
契約確定前の実装委譲はしない。独立した反証は契約が具体化した時点で行う。

---

以下は先行する共有接続試験の記録。上記の最新指示を優先し、共有daemon構成の製品採用方針とはしない。

## 目的と承認

2026-09-13、オーナーの「よし やってみてくれ」に基づく実機試験。
普段のCodex Desktopを使い、Aitermの回答を実行中の親へSteerし、親のターン終了後に
届いた回答でも同じタスクを自動再開できる構成を検証する。

Desktopの再起動による中断を予定するため統括レーンとする。
実行TODOの正本は本書。Latticeは使用しない。親が構成変更と技術判定を担当し、
Desktopの終了・再起動は人による操作とする。依存関係が直列なので委譲しない。

## 検証する構成

- DesktopとAitermが同一ユーザーの共有App Serverへ接続する。
- 実行中の親には公式 `turn/steer`、完了済みの親には公式 `turn/start` を使う。
- 同一のCODEX_HOMEを使う。親を別プロセスでresumeしても実行中turnの共有にはならない。
- Desktopの共有接続は未公開の起動設定である。アプリ本体は変更しない。
- 試験時点の接続設定、実測値、失敗原因は
  [再起動後の証拠](evidence/codex-shared-app-server-20260913-delivery.md)を参照する。

## TODOと受入

- [x] 現行経路を確認。Desktopは専用stdio接続、Aitermは別App Server経由の共有queue。
- [x] Desktopの静的実装に共有ソケット接続分岐が存在することを確認。
- [x] 変更前の設定・CLIリンクを保存し、復旧手順を用意する。
- [x] 公式standaloneを現行CLIと同じ版へそろえ、公式daemonを起動する。
- [x] 共有ソケットでinitializeと読取要求が成立することを確認する。
- [x] 人による完全再起動後に、同じ親taskが共有サーバーでactiveであることを確認する。
- [x] 実行中の親へ試験本文を送り、同一turnで受信したことを確認する。
- [x] 親の正常終了後に試験本文を一度送り、同じtaskの新turnが自動開始することを確認する。
- [x] 同じtaskの継続、設定中のmodel、Aitermのshell操作、通常MCP接続を確認する。
- [ ] Codexアプリ固有のMCP連携が正常に使える構成を確認する。
- [ ] Desktopのモデル選択UIと権限要求UIを実操作で確認する。

Aitermの製品配送はまだqueueである。直接RPCによる配送試験の成功と、
Aitermの製品変更・公開完了を区別する。試験コードは私有領域だけに置く。

## 現在地と次に必要な確認

実行中Steerと終了後の自動再開は実測で成立した。独立した試験processは送信一回で正常終了済み。
人による再起動観測は完了として受け入れる。

共有接続で `codex_app` MCPは `CODEX_APP_TOOLS_PIPE_PATH` 不足により起動に失敗している。
Aiterm、AIShell、通常の外部コネクタは接続できている。この差を解消する正規のDesktop連携方法は
未確認であり、「普段の全機能を保った構成」の受入は未完了とする。
当該pipeの署名検査を回避するための直接接続、偽装、アプリの再署名は行わない。

次に必要なのは、Desktopが所有するアプリ連携の接続情報を共有サーバーへ正規に渡す仕組みの確認。
製品化ではその接続条件を利用者の手作業や暗黙のqueueへの退避にしない。
実行中・終了済みの両方へ配送する目的は維持する。

## 既知の条件

- コンポーザーの「今すぐ反映」は外部queueに効かないことを実測済み。
- Codex app-toolsの署名検査とComputer UseのCodex操作禁止を回避しない。
- 接続先は同一ユーザーのローカルUnix socketだけ。gpt-connectorは使用しない。
- queueの削除を送信より先に行わない。無関係のtaskやqueue項目を変更しない。
- daemonの自動更新や外部ネットワーク公開を試験のために追加しない。

## 私有資産と復旧

試験資産は `.git/aiterm-experiments/codex-shared-20260913/` に保存する。
`before.tar` と `before.json` が変更前の設定・リンク、各receiptが試験結果。
`probe.mjs` の既定は読取だけ。送信試験の宛先は承認済みの親taskに固定してある。

共有設定を戻す場合はGUIのTerminalから `rollback.command` を実行し、Desktopを完全再起動する。
通常のstdio接続に戻ったことを確認してから、試験daemonを公式stopで停止し、必要ならCLIリンクを保存物へ戻す。
会話データベースは巻き戻さない。現在の共有接続は継続しており、この復旧操作は未実施。
