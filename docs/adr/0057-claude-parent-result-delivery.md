# ADR 0057: Claude親への回答自動配送に着手する

日付: 2026-09-10

## 判断

オーナーの実装指示に基づき、Claude Code親が子の確定回答を自動受信して続行できるようにする。
親の待機process・回答回収と子の返送操作を不要にし、既存のCodex親対応と本文保存を共有する。
受信口は公式Channelsを実機で検証してから採用し、通知の書込みとモデルの受信を区別する。
未対応環境や有効化失敗を別経路への黙示切替で隠さない。

受信口の実測から実装、3環境受入、公開後確認へ受入が連鎖するため統括レーンとする。
planned_interruption=false、chained_acceptance=true、multi_repo_write_coordination=false、
decision_evidence_required=false。riskはstandard、behavior-changeとする。

本決定は着手と目的を固定する。[計画](../plan_claude-parent-result-delivery.md)に従って検証し、
成立した契約と最終受入は別ADRへ記録する。Latticeの新規適用は含めない。
