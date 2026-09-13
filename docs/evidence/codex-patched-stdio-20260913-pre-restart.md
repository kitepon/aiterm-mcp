# 公式ソース改造版のDesktop再起動前記録

2026-09-13、オーナーの公式repo Clone・改造・再適用記録・選択導入の指示を受けた試験準備。
承認範囲の原文と残作業は [計画正本](../plan_codex-shared-app-server.md) にある。

## 作成と確認

- 開発用Cloneは、追加指示に従って `/Users/kite/Developer/aiterm-codex-app-server` へ改名済み。
- 公式tagを基準に、stdio起動分岐へ公式control socket acceptorを追加した。
- 基準commitとパッチSHA-256は `vendor/codex-app-server/source.json` に保存した。
- ビルド準備のlock同期はcommit `bbdd4d0de`、機能と試験はcommit `dee88f61f` に分離した。
- macOS arm64で改造後CLIのビルドと `--version` が成功した。
- 同一task参照・要求ID分離と接続終了条件の2試験、実行中Steer・終了後開始・各入力一回保存の1試験が成功した。
- 保存したパッチを未変更の上流3ファイルへ適用し、開発Cloneの内容との完全一致を確認した。

## 次の起動で使う試験構成

Desktopが通常どおりstdioの子processとして起動するCodex実行ファイルを、改造版へ指定する。
実行ファイルは私有試験directoryの `patched-runtime/bin/codex`。
同じ版の公式packageに含まれるhelperとresourcesを同梱し、認証・署名検査は変更しない。
元の公式standalone packageとDesktop app bundleは保持する。

GUIユーザーの `CODEX_CLI_PATH` を試験実行ファイルに設定し、先行試験の
`CODEX_APP_SERVER_WS_URL` を解除する。変更前の値は私有領域へ保存済み。
`launchctl asuser` によってGUIユーザーのbootstrap domainを指定できることを、既存値の読取りで確認した。

目的: Desktopから継承する環境と通常機能を維持し、同じApp ServerにAiterm用接続を追加できるかを実測する。
影響: 次の完全再起動から試験用の改造版を使用する。再起動中は作業が中断する。
戻し方: 保存したGUI環境変数を復元してDesktopを完全再起動する。
稼働中の共有App Serverは観測が完了するまで停止しない。

## 再起動後の受入

1. Desktopのstdio子processが改造版であり、そのPIDのAiterm用socketがある。
2. 同じ親taskをsocketの公式RPCで確認できる。
3. Codexアプリ固有MCPが接続し、通常のツールが使える。
4. 実行中配送と終了後再開を、同じtaskで確認する。

Desktop実機検証とAitermの製品配送・npm選択導入は未完了である。
Windows native・Linuxも未検証。継続更新の予約やメインサーバーの定期taskは作成していない。

私有資産: `.git/aiterm-experiments/codex-shared-20260913/` の `patched-runtime/`、
`patched-runtime-gui-before.json`、`activate-patched-runtime.py`。
Desktopの終了・起動操作は、Computer UseのCodex操作禁止に従いオーナーが行う。
