# Codex共有App Server: 配送の実測と残る接続条件

確認日: 2026-09-13。適用計画: `docs/plan_codex-shared-app-server.md`。
本書は試験時点の証拠であり、製品の現行運用手順ではない。

## 判定

同じCodex Desktopタスクへの実行中Steerと、正常終了後の自動再開は成功した。
再起動後の共有接続観測を受け入れる。
Aitermの製品配送は未変更であり、共有構成の全機能受入と製品化は未完了である。

| 確認対象 | 結果 | 根拠 |
| --- | --- | --- |
| 共有App Serverへの接続 | 成功 | 同じtaskをthread/readでactiveと取得 |
| 実行中Steer | 成功 | expectedTurnIdと応答turnIdが一致し、親が本文を同じturnで受信 |
| 正常終了後の自動再開 | 成功 | 旧turnのcompletedとtaskのidleを観測後、turn/start一回で新turnが開始 |
| 既存taskとmodel設定 | 成功 | 同じtaskで続行し、gpt-6-astra / xhighを読戻し |
| Aitermの実操作 | 成功 | 再開したturnから既存PTYへコマンド送信・結果読取が成功 |
| 通常のMCP接続 | 一部成功 | Aiterm 18、AIShell 11、codex_apps 230 toolsがconnected |
| Codexアプリ固有のMCP | 失敗 | codex_appは必要なpipe環境変数が不足して起動失敗 |
| モデル選択UI・権限要求UI | 未実施 | 設定読戻しはUI操作の成功を証明しない |
| Aiterm製品としての自動配送 | 未実施 | 本書の送信元は試験用process。製品コードはqueueのまま |

## 配送receipt

対象task: `01a098cd-2fc8-7261-9d69-d99550653b22`。

実行中試験の応答:

```json
{"delivered":"steer","expectedTurnId":"01a09942-87e8-72a0-964c-ad3490d98481","turnId":"01a09942-87e8-72a0-964c-ad3490d98481","sameTurn":true}
```

親は `AITERM_SHARED_STEER_20260913` を受信し、同じturnで成功を報告した。
続いて独立processを起動し、親は最終返答を出して正常終了した。
独立processの保存receiptには次が残った:

```json
{"armed":true,"previousTurnId":"01a09942-87e8-72a0-964c-ad3490d98481","maximumWaitSeconds":180}
{"observed":"idle-after-completion","previousTurnId":"01a09942-87e8-72a0-964c-ad3490d98481","previousTurnStatus":"completed"}
{"delivered":"wake","turnId":"01a09945-250f-7df3-8814-c25a8a7848f3","status":"inProgress"}
```

親は `AITERM_SHARED_WAKE_20260913` を受信して同じtaskで再開した。
試験processの終了コードは0。再開後のthread/readもactiveだった。
試験processだけが最大180秒、1秒間隔で終了を観測した。親モデルによるpollingでも、
製品へのpolling実装でもない。親への入力は一回だけで、再送待機processは残っていない。

## アプリ連携の未達

公式 `mcpServerStatus/list` を当該taskに対して実行した結果:

```text
codex_app: failed, tools=0
Codex did not provide CODEX_APP_TOOLS_PIPE_PATH to the app tools MCP.
```

専用stdio起動ではDesktopがアプリ連携の環境と設定を子processへ渡す。
今回の直接WebSocket接続では、既に起動した共有daemonへそのprocess環境は継承されない。
現在のmissing-envエラーは実測。通常接続時の同じMCPの成功receiptは未取得なので、
全機能の前後比較に成功したとは扱わない。

他に外部MCP二件の接続失敗も見られたが、共有切替との因果を確認していない。
本試験で外部サービスの修理や認証変更は行っていない。
公開APIから読める接続状態と、権限要求UIの実動作を混同しない。

## 接続構成と再起動で分かったこと

- 公式installerからstandalone 0.154.0を導入し、公式daemon startで起動した。
- Unix socketは `/Users/kite/.codex/app-server-control/app-server-control.sock`、mode 0600。
- GUIのAqua環境で `CODEX_APP_SERVER_WS_URL` を
  `ws+unix://localhost/Users/kite/.codex/app-server-control/app-server-control.sock:/rpc` に設定した。
- 二回目のDesktop完全再起動後に共有接続と配送が成立した。
- 初回はAitermのBackground環境にだけlocal-daemon flagを設定したため、GUIへ届かなかった。
- さらに現行Desktopのlocal-daemon分岐はconfig overrideがあると選ばれない。
  現行版はアプリツール有効化のoverrideを返すため、当該flagだけでは共有に切り替わらなかった。
- local-daemon flagはAquaとBackgroundから解除した。
- 共有接続後のshellはBackground環境に属する。そのlaunchctl getterをGUI設定の確認に使わない。
- hostnameをlocalhostにしてDesktopの外部向けSOCKS設定を選ばず、Unix socketに接続した。
- app-server proxyはWebSocketの生バイト中継であり、JSONLを直接送る最初の試験はタイムアウトした。
  Desktop相当のWebSocket接続とperMessageDeflate:falseでinitializeとthread/readが成功した。

これらはローカル実装と実測に基づく。未公開のDesktop起動設定を公式の安定接続契約とは呼ばない。
Codexアプリの編集、再署名、署名検査の回避はしていない。

## 保存と変更範囲

私有資産: `.git/aiterm-experiments/codex-shared-20260913/`。
下記SHA-256は本記録作成時点の値。

| 資産 | SHA-256 |
| --- | --- |
| wake-after-idle-receipt.log | 8dea25994f248267a9b3252f8d6b0be7c3e7d03324b6b80cf2c291b294666b67 |
| compatibility-receipt.log | fcf9360fa428503caf91396761efcde097fd2e784bcb43db99859807a82e6fe2 |
| probe.mjs | 1cec0eddcb3452310bd59a28b839ba18e3b25c6b12e6a81bb7b74895b0dc0b74 |

`config.toml`、`.zprofile`、`.zshrc`は準備時のtarと一致していた。
CLIの可視リンクとstandaloneのcurrentリンクは公式installerで更新された。
自動更新は起動していない。daemonと共有接続設定は試験後も動作中。
Aiterm製品コードは未変更のため、build・製品テスト・releaseは本接続試験の合否に使っていない。
