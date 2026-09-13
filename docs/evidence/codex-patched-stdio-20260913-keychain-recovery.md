# 改造版App Server起動後のKeychain要求と復旧

確認日: 2026-09-13。対象: macOS arm64のCodex Desktop試用。

## 結果

改造版でDesktopを起動した後、オーナーからKeychain要求が大量に繰り返されると報告された。
公式の通常起動へ設定を戻してDesktopを再起動した後、オーナーから
「キーチェーンの要求は止まったよ」と報告があった。今回の止血・復旧は完了した。
改造版のDesktop受入は不合格であり、模擬モデル試験の成功とは区別する。

## 読み取りで確認した事実

- 障害中のDesktop PIDは86122、その子の試用App Server PIDは86217だった。
  実行ファイルは試用directoryの `patched-runtime/bin/codex` だった。
- 試用CLIの署名は `Signature=adhoc`、`TeamIdentifier=not set`。
  公式standalone CLIの署名は `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)` だった。
- 復旧後のDesktop PIDは2440、子App Server PIDは2469。
  実行ファイルは `/Applications/ChatGPT.app/Contents/Resources/codex` で、
  OpenAIのDeveloper ID署名とTeamIdentifierを確認した。
  試用directoryを実行ファイルに持つprocessは存在しなかった。
- GUI起動環境の `CODEX_CLI_PATH`、`CODEX_APP_SERVER_WS_URL`、
  `CODEX_APP_SERVER_USE_LOCAL_DAEMON`、`CODEX_APP_SERVER_FORCE_CLI` は全件不在だった。
  元の共有daemonへの接続も解除し、Desktop同梱の公式App Serverへ復旧した。

## 原因の確認範囲

同じ公式ソースを再ビルドしても、OpenAIが署名した配布バイナリとOS上の同一性は維持されない。
署名の違いと障害の発生・復旧の順序から、既存Keychain項目へのアクセス確認が有力な原因である。
ただし、各要求の項目名・発生回数・再呼び出し元は採取しておらず、反復の全経路は未特定。

基準source commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340` の
`codex-rs/keyring-store/src/lib.rs` は `Entry::get_password()` で保存内容を読む。
`codex-rs/login/src/auth/storage.rs` はCodex認証用、
`codex-rs/rmcp-client/src/oauth.rs` はMCPの接続先ごとの認証用にこの保存層を呼ぶ。
これらは原因候補を絞るコード上の根拠であり、今回どの項目が要求されたかの実測ではない。
認証ソースに変更がないことを、利用者の既存認証がそのまま使える根拠にしてはいけなかった。

## 復旧操作と今後の再開条件

GUI上書き4件を解除して読み戻し、オーナーがDesktopを完全終了・再起動した。
秘密値の読み取り、Keychainの許可変更、秘密値のファイル移送、署名検査の回避は行っていない。
試用版を再有効化する操作も行っていない。
復旧前後の設定receiptはrepo内の非公開実験directoryに保存した。

実認証と署名の互換性を利用者環境への再投入前に解決する。
キーチェーン要求を利用者が繰り返し許可する運用は受入にしない。
この条件が満たされるまで改造版の選択導入を公開しない。
Steer・終了後再開・npm導入時の選択という元の目的は維持し、全体完了とは扱わない。
