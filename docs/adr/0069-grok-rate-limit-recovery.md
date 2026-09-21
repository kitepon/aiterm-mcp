# ADR 0069: Grokの過去の上限パネルを通常送信で解除する

状態: 採用。2026-09-21、実装・公開・BellTeam導入・通常応答を受入済み。

## 判断

Grok／Composerの終了済みerrorターンにweekly-limitカードが残った場合、次の通常
`pty_send`で現在のviewportとharness生存を確認し、`X`を一回送る。
既存ready gateの後に完了cursorを取得し、今回の本文だけを送る。
解除条件不成立・解除後の入力受付失敗は原因と未送信を返す。
過去promptの再投入、購入、privacy選択、再ログイン、定期再試行は行わない。

Grokの画面とキーの知識はGrokアダプタ、操作順序はcoreが所有する。
BellTeamは通常の送信APIを使い続ける。新しいtool・引数・状態形式は追加しない。
完了観測には現在のパネルだけを使い、古いpane logで新turnを上限扱いしない。
公開契約は[DESIGN](../DESIGN.md#failure-and-recovery)へ統合した。
根拠と試験仕様は[完了計画](../archive/grok-rate-limit-recovery-plan.md)に残す。

## 受入証拠

- 実装: `e88e0e2178c162891606ed84c8ff53ad789ba0d5`。
  release: `b6bf1376c12d9b6888730e0b8972b44a8b8ec88b`、[v0.37.9](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.37.9)。
- 新規回帰10件は画面・完了観測と、模擬CLIへの実PTY入力を検証。
  X一回、本文一回、解除後cursor、同一session、失敗時未送信を確認。
  公開npm packageを標準installした一時環境でも10件すべて成功。
- 関連試験31成功・Windows専用1件skip、文書7成功。
  手元の全試験は517成功・27件skip・失敗0。
- [実装CI](https://github.com/kitepon/aiterm-mcp/actions/runs/35549055987)はmacOS・Linux・Windowsすべて成功。
  独立した読取専用反証でも合意仕様への重大な違反は見つからなかった。
- npm provenance付き公開、GitHub ReleaseとMCPB、Official MCP Registryのname/version照合を完了。
  npmの配信処理中の404を、公開済み・取得可能として扱わず待機した。
- BellTeamのDockerfile更新は`ea92d07`、本番deployの独立commitは`1e33dcb`。
  BellTeam全試験169成功。health正常、実MCP接続が`aiterm 0.37.9`を返した。
  通常配送で対象Grok Botの回答`AITERM_0_37_9_OK`とdeliveredを確認
  （2026-09-21T01:04:11.686Z）。

## 観測の限界

元の停止PTYは、設計後に依頼された既存公開版更新で終了した。
その実Grok CLIのカードにXが届いて解除された場面は未観測であり、
模擬CLIの実PTY試験および導入後の通常Grok応答と区別する。
レート上限そのものの解除時刻や、すべてのGrok UI形式への対応は保証しない。

設計commitのWindows Codex設定試験3件の失敗は、今回のCIでは再発していない。
原因未確認のWindows実装へ変更を加えず、成功した今回の結果と失敗履歴を分けて記録した。
