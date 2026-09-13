# 公式バイナリとstdio中継の試験

確認日: 2026-09-13。隔離試験は成功。Desktop実機の受入は再起動後に確認する。

## 試作と実測

`scripts/experiments/codex-relay-launch.py` が公式CLIへ同じPIDでexecし、
`codex-stdio-relay.mjs` がDesktop相当のJSONLと公式のUnix socketを中継する。
公式CLIの会話・承認・追加接続の処理をそのまま使う。

公式バイナリ: macOS Desktop同梱の `Contents/Resources/codex`。
SHA-256: `ecad78dbf98adb89ec475edac86630406cbe59d9f3070b17d88065f136b94bcb`。
試験前後でハッシュが一致した。一時HOME・CODEX_HOME、ローカル模擬モデルを使用した。
中継起動入口の別smokeでも、`--version` の転送、initialize、公式バイナリ・親PIDの維持、
stdio終了を確認した。同梱版の表示は `codex-cli 0.154.0-alpha.6.2` だった。

| 確認項目 | 結果 |
| --- | --- |
| 起動前後のPID・親PID・公式実行ファイル | 維持 |
| 同じ要求IDを使う2接続の応答 | 混同なし |
| 実行中のSteer | 同じturnで受信 |
| 終了後の回答 | 同じtaskの次turnを開始 |
| 入力の保存とモデル要求 | 各1回保存、次のモデル要求へ本文を反映 |
| 承認要求への拒否 | 中継成功。試験用touchは未実行 |
| 追加接続だけを切断 | 親の処理を継続 |
| 全turn完了後のstdio EOF | サーバー終了、socket除去 |
| 応答待ち・追加接続ありのstdio EOF | 修正後にサーバー終了、socket除去 |
| 本物の認証情報・アプリ内ツール | この隔離試験では使用していない |

## 失敗の再現と修正

Unix transportの公式実装は最初のSIGTERMで実行中turnの完了を待つ。
モデル応答を止めたままstdio EOFを送る最小試験は、最初の試作で1.5秒以内に終了せず失敗した。
中継は直接の親へSIGTERMを送り、100ms後も同じ親が生存する場合に2回目を送る。
公式の2段階終了処理を使い、同じ試験が約440msで成功した。

独立した反証は、上記の終了契約の穴を指摘した。再現・修正後の実ファイルを読み、
残る具体的なP0/P1なしとして修正受入可と回答した。検証者は実認証やDesktopへ接続していない。

## Desktopで次に確認すること

オーナーの「じゃぁ試してご覧」に基づく試験。起動入口だけを私有の中継launcherへ指定する。
実行されるApp Serverは上記の公式バイナリであり、アプリ本体・署名・認証情報は変更しない。
接続先は本人所有0700の試験ディレクトリ内の、公式実装が作る0600のsocketだけを使う。

再起動後に確認する項目:

1. Desktopの直接の子が上記公式バイナリで、親taskが同じsocketから見えること。
2. 通常のアプリ内ツールと既存MCPが使えること。
3. 実行中の同じturnへの試験配送と、終了後の同じtaskの再開。

試験準備・起動設定の読戻し・復元結果は、
`.git/aiterm-experiments/codex-shared-20260913/official-relay-*.json` に保存する。
復元は同ディレクトリの `restore-official-relay.command` を実行し、Desktopを完全終了して再起動する。
復元対象は今回保存した通常構成のGUI起動設定4キーだけである。
次回起動用の `CODEX_CLI_PATH` 設定と、共有URL・local daemon・force CLI指定の不在は読戻し済み。
現在動いているDesktopの接続は変更していない。完全終了・再起動後の実測は未実施。

## 未完了

Desktop実機連携、Windows nativeとLinux実機、Aitermの製品配送・選択導入は未完了。
今回の試作はnpmの公開物へ組み込まない。通常製品の配送は引き続き既存のqueueである。
