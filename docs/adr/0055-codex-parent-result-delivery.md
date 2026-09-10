# ADR 0055: Codex親へ子の回答を自動配送する

日付: 2026-09-10

## 判断

Codex親がAitermへ子の依頼を送ると、AitermのMCP processが完了を観測し、確定した回答本文を
Codexの公式受信キューへ配送する。親によるwaiter起動と通常の回答回収を不要にする。
通常の完了報告は順番待ちとし、親の実行中ターンをステアしない。

親の宛先はMCP要求の `_meta.threadId` から取得する。Codexの公式app-serverへstdioで接続し、
`thread/queue/add` を使う。親threadを別processでload／resumeしない。Desktop独自機能は使わない。
Claude Code親への対応は後続作業とし、既存の完了待機と回答回収を維持する。

子のharnessと親の種類は独立させ、既存の各harnessの完了記録と本文取得を使う。
本文を保存してから送信し、曖昧な送信結果を成功や自動再送へ変換しない。
公開挙動の実装と検証・releaseは[計画](../plan_parent-result-delivery.md)に従う。

## 作業の区分

受信口の実測、配送処理、3環境の製品受入、公開後smokeが連鎖するため統括レーンとする。
planned_interruption=false、chained_acceptance=true、multi_repo_write_coordination=false、
decision_evidence_required=falseとする。工程は単一repoで行う。

通常リスクの挙動変更として扱う。新しい認証・権限・設定の代替機構を追加せず、
既存の公式受信口とAiterm所有stateを使う。障害時は原因と配送状態を保持する。
本番公開はmain祖先gateと既存release手順に従い、旧公開版への再導入で戻せる状態を維持する。

## 着手時の根拠

- 公式キューのCLI経路で、待機中のCodex CLIと実行中の親への本文配送・次ターン開始を確認済み。
- 公式app-server経路で60,000文字（UTF-8で136,000 bytes）の受付本文が完全一致した。
- 実モデルのMCP呼出しから取得したthread IDが、親のthread/start結果と一致した。
- 変更前のbuildと完了観測・公開APIに関する31件のテストが成功した。

これらは配送実装全体の受入を意味しない。最終判断は実装と関連検証の後に別ADRへ記録する。
