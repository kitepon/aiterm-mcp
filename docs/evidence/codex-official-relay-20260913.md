# 公式バイナリとstdio中継の試験

確認日: 2026-09-13。隔離試験とmacOS Desktopの接続試験は成功。
実行中のSteer、終了後の同じtaskの自動再開、アプリ内ツールによるtask読取りを実測した。
Aitermの製品配送・選択導入の完了を意味するものではない。

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

## Desktop試験の準備と復元

オーナーの「じゃぁ試してご覧」に基づく試験。起動入口だけを私有の中継launcherへ指定する。
実行されるApp Serverは上記の公式バイナリであり、アプリ本体・署名・認証情報は変更しない。
接続先は本人所有0700の試験ディレクトリ内の、公式実装が作る0600のsocketだけを使う。

再起動前に定めた確認項目:

1. Desktopの直接の子が上記公式バイナリで、親taskが同じsocketから見えること。
2. 通常のアプリ内ツールと既存MCPが使えること。
3. 実行中の同じturnへの試験配送と、終了後の同じtaskの再開。

試験準備・起動設定の読戻し・復元結果は、
`.git/aiterm-experiments/codex-shared-20260913/official-relay-*.json` に保存する。
復元は同ディレクトリの `restore-official-relay.command` を実行し、Desktopを完全終了して再起動する。
復元対象は今回保存した通常構成のGUI起動設定4キーだけである。
次回起動用の `CODEX_CLI_PATH` 設定と、共有URL・local daemon・force CLI指定の不在は読戻し済み。
### 初回再起動の結果と修正

Desktopの直接の子は同じ公式バイナリだったが、中継socketは存在しなかった。
GUI設定はDesktopと子processへ継承されており、アプリの版・バイナリハッシュも試験時と一致した。
実argvの値を公開せず、構造だけを確認すると次の並びだった。

```text
codex -c <設定> app-server --analytics-default-enabled -c <設定>
```

launcherは先頭がapp-serverの場合だけ中継し、それ以外を公式CLIへ通していた。
そのため正常な通常起動となり、中継は有効になっていなかった。
アプリ内ツールの `list_projects` は成功したが、中継経由での成功ではない。

この引数順をfocused testへ追加するとsocketディレクトリが作られず失敗し、原因を再現できた。
root設定引数とその値を認識し、元の引数を保持してapp-serverの位置を判断するよう修正した。
修正後は配送とactive中のEOFの2試験が成功し、Desktopに指定した起動入口でも同じ並びのsmokeが成功した。
この時点のprocessは通常起動のままだったため、修正後にもう一度の再起動を依頼した。
認証情報、署名、アプリ本体、今回のGUI設定はこの修正では変更していない。

## 2回目の再起動と実際の親への配送

2回目の再起動では、Desktop PID 40776の直接の子PID 40807が上記の公式バイナリであり、
`/tmp/aiterm-codex-relay-501/40807.sock` が本人所有・mode 0600で存在した。
追加クライアントの `thread/loaded/list` と `thread/read` で、承認済みの親taskを確認した。
中継稼働中もアプリ内ツールの `read_thread`、AitermのPTY操作、AIShellが成功した。

実機で送った本文は、オーナー承認済みの試験マーカーだけである。
同じtask `01a098cd-2fc8-7261-9d69-d99550653b22` に対する結果を示す。

| 項目 | 実行中の配送 | 終了後の配送 |
| --- | --- | --- |
| マーカー | `AITERM_OFFICIAL_RELAY_STEER_20260913` | `AITERM_OFFICIAL_RELAY_WAKE_20260913` |
| 実行したRPC | `turn/steer` | `turn/start` |
| 送信前のturn | `01a099fe-3a6e-7100-99e3-8ae72e2bb14a`（実行中） | 同じturnの完了を観測 |
| 受理されたturn | 送信前と同じ | `01a09a04-8059-71c0-a9d1-c09624baafe2`（新規） |
| 受理時刻（UTC） | 2026-09-13T09:01:40.303Z | 2026-09-13T09:06:21.411Z |
| 親による実受信 | 同じturnで受信を報告 | 同じtaskが自動再開し、受信を報告 |
| 試験process | 正常終了 | 終了コード0 |

終了後のreceiptは `previous_turn_completed: true`、`method: "turn/start"`、
`new_turn: true` を記録している。アプリ内ツールのtask読取りでも、受理された新turnが
同じtaskで `inProgress` になったことを確認した。送信は各1回で、失敗時の再送は行わない。

私有ディレクトリ内のreceiptのSHA-256:

- `official-relay-live-steer.json`: `c6ca8b5eb7f6a00bc5f84b2ee5599f196494e2107aaf2433a1eb32e4156ff927`
- `official-relay-live-wake-after-idle.json`: `27b844fdd236073dee72a2f9b6843a5e5a377ab54a935b30c0511b271f8f7f35`

アプリ内ツールの成功は上記の読取り操作についての実測であり、全ツール・モデル選択UI・
権限要求UIを網羅した試験ではない。入力メッセージの画面表示は未確認で、機能追加も依頼されていない。
Keychain要求の連発の発生経路を今回特定したとは扱わない。公式バイナリと署名は維持した。

技術判定は [ADR 0062](../adr/0062-codex-official-relay-connection-observation.md) に固定する。

## 未完了

Windows nativeとLinux実機、Aitermの製品配送・選択導入は未完了。
今回の試作はnpmの公開物へ組み込まない。通常製品の配送は引き続き既存のqueueである。
