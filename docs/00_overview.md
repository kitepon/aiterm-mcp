# aiterm-mcp 文書地図

本製品はこのrepositoryだけで開発・導入・運用・診断・復旧・更新・releaseできる。
dotagentsは任意の工場統合を担うが、Aitermの製品正典や実行制御を所有しない。

## 現行正典

- [README](../README.md)／[日本語README](../README.ja.md): 公開API、`aiterm-setup`による依存準備とAI登録、利用、復旧。
- [AGENTS](https://github.com/kitepon/aiterm-mcp/blob/main/AGENTS.md): AI作業者向けの製品境界と変更規律。
- [DESIGN](DESIGN.md): 現行アーキテクチャと不変条件。
- [RELEASE](RELEASE.md): version同期、検証、公開、公開後smoke、巻き戻し。
- [CONTRIBUTING](https://github.com/kitepon/aiterm-mcp/blob/main/CONTRIBUTING.md): contributor向けの環境、開発手順、test。
- [SECURITY](https://github.com/kitepon/aiterm-mcp/blob/main/SECURITY.md): 現行security policy。
- [benchmarks](https://github.com/kitepon/aiterm-mcp/blob/main/docs/benchmarks.md): 出力削減の実測根拠。
- [CHANGELOG](../CHANGELOG.md): 版別変更履歴。

Grok／Composerのsandbox起動拒否については、[DESIGNの失敗と復旧](DESIGN.md#failure-and-recovery)に
検出の所有と適用範囲、[RELEASEの公開後smoke](RELEASE.md#公開後smoke)に検証条件を置く。

Codex親への回答の自動配送は[DESIGN](DESIGN.md#codex親への自動配送)に、対応範囲と失敗時の状態を置く。
Claude Code親の非同期hookによる受信は[DESIGN](DESIGN.md#claude-code親への自動配送)を参照する。

## 履歴と証拠

- [`archive/`](https://github.com/kitepon/aiterm-mcp/tree/main/docs/archive): 完了・棄却・中断・失効・置換により現行制御から外れたsnapshot。
- [`adr/`](https://github.com/kitepon/aiterm-mcp/tree/main/docs/adr): 採択・棄却した設計判断とrelease受入。
- [`evidence/`](https://github.com/kitepon/aiterm-mcp/tree/main/docs/evidence): Lattice／campaignの検証証拠。
- [`rag/`](https://github.com/kitepon/aiterm-mcp/tree/main/rag): 一次資料と調査corpus。

rootに残る短い旧plan fileは、Latticeや過去ADRの固定参照を壊さないためのhistory stubであり、
current文書ではない。本文は必ずarchive側を読む。

## 文書の寿命

- 現行の契約・設計・運用・releaseだけをcurrentに置く。
- 完了・棄却・中断・失効・置換により現行制御から外れたplan、audit、release receiptはarchiveへ移す。未解決で今も必要な作業はcurrent backlogへ移してからarchiveする。
- 同じ目的のcurrent文書を増やさず、上記正本へマージする。
- archive／ADR／evidence／RAG rawの当時の表現は現行値へ書き換えない。
- 工場全体のwire、host配置、製品間compatibilityはdotagentsに置き、製品内部の制御を複製しない。
