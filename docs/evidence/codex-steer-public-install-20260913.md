# Codex Steerの公開・導入記録（再起動前）

2026-09-13にAiterm 0.36.0を公開し、macOS実機へnpmから導入した。
この記録の到達点は導入と再起動準備であり、公開packageによる実際の親配送は再起動後に確認する。
契約は[ADR 0063](../adr/0063-codex-steer-installation.md)、残作業は[進行中の計画](../plan_codex-shared-app-server.md)を参照する。

| 項目 | 結果・根拠 |
| --- | --- |
| 実装 | `7f3522bfe74b4884c31af8356df99a9bbba1c76a` |
| 公開入口のbuild前提修正 | `2aca3c7e8c66a0fceb091bb1f729bf6e23730476` |
| 公開commit | `07304553b3ef44fe0a6e792ae5591bbb43a70bf9`、main上の`v0.36.0` |
| 新機能の3環境CI | [macOS・Linux・Windowsで成功](https://github.com/kitepon/aiterm-mcp/actions/runs/34750375443) |
| 公開commitのCI | [配布metadata・文書・packの確認が成功](https://github.com/kitepon/aiterm-mcp/actions/runs/34750613078) |
| npm | [provenance付きpublishが成功](https://github.com/kitepon/aiterm-mcp/actions/runs/34750613765)。`npm view aiterm-mcp@0.36.0 version`で`0.36.0`を確認 |
| GitHub Release | [v0.36.0とMCPB](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.36.0)を公開 |
| MCP Registry | [登録が成功](https://github.com/kitepon/aiterm-mcp/actions/runs/34750641213) |
| npmからの導入 | `npm install -g aiterm-mcp@0.36.0`が成功。配布された38個のruntimeファイルがrelease buildとSHA-256で一致 |
| 初回setup | `aiterm-setup --json --codex-steer enable`でtmux実動作とClaude・Codex・Grok・Cursorの登録がすべて`ready` |
| 再実行 | `aiterm-setup --json`でSteer選択を維持し、同じ登録確認が成功 |
| Desktopの切替状態 | 初回・再実行とも`restart_required`、終了コード3。再起動前を`ready`と判定していない |
| 起動設定 | 製品launcherへのGUI設定読戻し、専用LaunchAgentの登録を確認。解除時の復元先は試作launcherではなく元の未設定状態 |
| 公式バイナリ | 署名検査成功。SHA-256は`ecad78dbf98adb89ec475edac86630406cbe59d9f3070b17d88065f136b94bcb`で試作・隔離試験時と同一 |

公開コマンドの初回失敗は、clean cloneに`dist/`がないまま配布検査を始めたことが原因だった。
公開入口自身にbuildを加え、関連14試験と次のclean cloneで成功した。最初の失敗時点ではcommit・tag・publish前だった。
その後のGitHub Release作成はHTTP 500で一度失敗したが、未作成をAPIで確認して作成操作だけを再実行し、成功した。
npmの受理から配信反映までの待ち時間は再publishせず、公開版が取得可能になってから導入した。

実機の既存設定は導入前に非公開tarへ退避した。非公開receiptはrepositoryの`.git/aiterm-experiments/codex-shared-20260913/`にあり、
`public-install-receipt.json`が照合結果、`public-setup.json`と`public-setup-repeat.json`が公開入口の応答である。
認証情報、MCP設定の本文、生ログはこの公開記録へ含めていない。

人によるDesktopの完全再起動、公開packageの通常の子起動からのSteerと終了後再開、実ログアウト後の設定復元は未観測。
現在動作している試作relayの成功を、公開packageによる実機配送の成功へ読み替えない。
