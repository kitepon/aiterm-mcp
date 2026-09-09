# 公開セッションAPIの公開受入

## Decision

2026-09-10、Aitermの公開セッションAPI補完を受け入れ、0.33.0の公開工程を完了とする。
設計判断は[ADR 0052](0052-public-session-observation.md)、検証・公開・導入の証拠は
[実機検証記録](../evidence/20260910-public-session-api.md)を正とする。

## 受入根拠

- Grokによる独立反証と実装監査を行い、親が最小再現で確定したdialog分類の指摘を修理した。
- 変更に直結する個別試験、関連試験、3環境の製品CIが成功した。
- mainに統合した版から公式release入口でnpm provenance、GitHub Release、MCPB、Official MCP Registryへ公開した。
- 公開npmをMac・Linux・Windowsへ導入し、setupの実効設定保持と再実行のbyte一致を確認した。
- 公開MCPを通じて通常PTYと実harnessの起動、送信、完了、回答、観測、終了を確認した。

## 残る条件と所有

元のsetup検証におけるMac SSH未提供とWSL接続待ちは
[既存計画](../plan_setup-real-host-verification.md)のままとし、ローカルMacの成功で代用しない。
LinuxのClaude認証、Linux／WindowsのCursor CLI、WindowsのCodex CLIが利用できない環境では
実harnessの試験を行っていない。認証・CLI導入をAitermの独自操作で補っていない。

Peertableへの公開契約と導入完了通知を引き渡した。Peertableの移行・公開と工場の横断受入は
各所有者の工程であり、Aitermのrepositoryから書き換えていない。
