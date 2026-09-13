# ADR 0060: Codex共有App Serverの接続・配送観測を受け入れる

日付: 2026-09-13。状態: 接続・配送の観測を採択。製品構成の採択は未了。

## 判断

オーナーの承認とDesktopの完全再起動後、同じtaskを保持する共有App Serverへ接続できた。
実行中はturn/steerで同一turnへ本文が届き、正常終了後はturn/start一回で同じtaskが自動再開した。
親は双方の試験本文を実際に受信したため、人による再起動後の接続観測を完了として受け入れる。

実測receiptと検証範囲は[配送の証拠](../evidence/codex-shared-app-server-20260913-delivery.md)に固定する。
既存task、model設定、Aitermのshell操作は維持できている。

## 未達と継続条件

共有daemonにはCodexアプリ固有のMCPが必要とする接続環境が渡らず、起動失敗を観測した。
Desktopのモデル選択UI・権限要求UIも実操作では未確認である。
したがって、この観測の採択を普段使いの全機能受入やAiterm製品配送の変更完了にはしない。

Aitermの製品コードは未変更。実行中Steerと終了後再開の目的を維持し、
アプリ連携を正規に保てる構成を次に確認する。署名検査やComputer Use制限の回避は行わない。
進行中の工程は[接続試験計画](../plan_codex-shared-app-server.md)に残す。
