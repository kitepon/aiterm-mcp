# 公式App Serverへ再適用するパッチ

上流repo、基準commit、パッチcommitとSHA-256は `source.json` が正本である。
開発用Cloneは `aiterm-codex-app-server` と命名する。

パッチは通常のstdio起動に、同じprocessへ接続するAiterm用ソケットを追加する。
公式のtransport実装を再利用し、Core、認証、署名検査、承認処理、thread APIは変更しない。
ソケットは `source.json` の相対directory内にprocess IDごとに作り、stdio終了時に削除する。
追加接続が切断されても親taskを停止しない。

Aitermからの配送は、親を読み込んでいる同じprocessへ公式 `turn/start` を送る。
この基準commitのCoreは、実行中なら同一turnへSteerし、idleなら新turnを開始する。
受理応答はturn IDを返すが、Steered／Startedの区別は返さない。
設定overridesを省略し、Review等で拒否された入力をqueueへ退避しない。

## 再適用とビルド

1. `source.json` の公式repoをCloneし、基準commitをcheckoutする。
2. Cloneのrootで `git apply --check <このdirectory>/0001-aiterm-stdio-socket.patch` を実行する。
3. check成功後、同じpathを `git apply` に渡して適用する。
4. `rust-toolchain.toml` のtoolchainと公式build依存を準備する。
5. `codex-rs` で `cargo build -p codex-cli --bin codex` を実行する。
6. rootで `just test -p codex-app-server -E 'test(aiterm_socket)' --retries 0 --show-progress none` を実行する。

この基準tagではCargo.lockのworkspace packageのversionがCargo.tomlと不一致のため、
初回は公式releaseと同様に `--locked` を使わずビルドする。外部依存を変更せずに
workspace内のversionだけが同期されることを確認した。lockの機械的な同期は機能パッチに含めない。

上流更新時は、適用できたことに加えてtransport、stdio終了、入力受理の挙動を再検証する。
競合を無視した適用や、未検証targetの対応済み表示はしない。
定期更新、監視、継続ビルドの予約はここでは作成していない。

## 現在の確認範囲

macOS arm64で公式sourceのビルドと3件のfocused testが成功した。
同一task参照・要求ID分離、追加接続とstdioの終了条件、実行中Steerと終了後の新turn開始を確認した。
模擬モデルを使い、回答は各turnに一度だけ保存されることを検証した。
Desktop実機の全機能、Aitermの製品配送、npmでの選択導入、Windows nativeとLinuxは未完了である。

2026-09-13のDesktop実機試用では、再ビルドしたCLIの起動後に大量のKeychain要求が報告され、
起動設定を公式の通常構成へ戻した。試用CLIはad-hoc署名であり、OpenAIのDeveloper ID署名を
持つ公式配布物とOS上の同一性が異なる。認証ソースに差分がなくても実認証の互換性は未成立で、
このパッチの模擬モデル試験の成功だけでは、利用者環境への導入を受け入れられない。
公式版へ戻した後、改造版processの終了と、オーナーによるKeychain要求の停止確認が得られた。
認証・署名の互換性が未解決のため、改造版の再投入と選択導入の公開は保留している。

更新を継続する配布では、ビルド間で維持される署名者・製品IDと初回認証を設計する必要がある。
さらに調査対象のmacOS Desktopは、アプリ内ツールのpeerと親process等について
OpenAIのTeam IDを検査する。独自署名の付与だけではこの条件を満たせない。
キーチェーンの対話抑止だけを全機能の解決扱いしない。
実測と次の確認点は[署名調査](../../docs/evidence/codex-patched-stdio-20260913-keychain-investigation.md)を参照する。
