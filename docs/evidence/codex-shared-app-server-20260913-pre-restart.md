# Codex共有App Server: Desktop再起動前の記録

確認日: 2026-09-13。適用する計画は `docs/plan_codex-shared-app-server.md`。

## 判断

オーナーは共有App Server構成の説明を受けて「よし やってみてくれ」と試験を承認した。
Desktopの完全再起動で実行が中断するため、planned_interruptionを根拠に統括レーンとする。
目的は同じDesktopタスクの実行中Steerと終了後の自動再開。接続試験と配送試験の成功を区別する。

設定変更・試験準備は親が実施した。Desktop自身の自動操作はComputer Useの制限対象なので、
完全終了と再起動はユーザーに依頼する。設定切替は承認済みで、追加承認を待つものではない。

## 実測

- 公式installerの `--release 0.154.0` でstandalone一式の導入に成功。
- `codex app-server daemon start` は `status=started, backend=pid`。
- `daemon version` はCLI・managed・app-serverともに `0.154.0`。
- 共有Unix socketは所有ユーザーだけが利用できるmode 0600。
- WebSocketのinitialize、thread/readが成功し、対象親タスクを確認できた。
- 再起動前の対象task statusは `notLoaded`。親を別processでresumeしていない。
- `launchctl getenv CODEX_APP_SERVER_USE_LOCAL_DAEMON` は `1`。
- `config.toml`、`.zprofile`、`.zshrc`は変更前tarと一致。
- Aitermの製品コードとCodexアプリ本体は変更していない。

## 未実施

Desktop再起動後の共有接続、実行中Steer、終了後再開、Desktop固有機能の受入は未実施。
この記録は準備完了の証拠であり、目的達成の証拠ではない。

## 復旧

共有用のlaunchctl環境変数を解除してDesktopを再起動する。
その後、必要に応じて試験daemonを公式stopで停止し、保存したCLIリンクへ戻す。
変更前tarと復旧用commandは `.git/aiterm-experiments/codex-shared-20260913/` に保存した。
