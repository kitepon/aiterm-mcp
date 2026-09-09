# 公開setupの実機受入完了と対象の訂正

## Decision

2026-09-10、オーナーの「Macはこの端末だからSSHする必要ない」「WSLは廃止済み」という
指示に基づき、Macは現端末のローカル検証を正式な受入とし、WSLを対象から除外する。
公開setupと公開セッションAPIの導入・検証は完了と判定する。接続待ちの残件はない。

## 訂正する判断

[ADR 0053](0053-public-session-api-release.md)と既存の検証記録にあるMac SSH・WSL接続待ちは、
対象の扱いを誤った判断であり、本Decisionで取り消す。過去の実測自体は変更しない。
WindowsでCodex CLIが未検出であることも、検出済みAIを登録するsetupの未完了理由にしない。
未導入のAI CLIや認証の準備は今回の受入条件に追加しない。

## 完了の根拠

[公開版の実機記録](../evidence/20260910-public-session-api.md)で、以下を確認済み。

| 受入対象 | 導入・setup | 公開MCP | 実AIの確認 |
| --- | --- | --- | --- |
| Mac・現端末 | 公式npm、初回・再実行成功、所有外の実効設定保持、再実行byte一致 | 通常PTY・観測・終了成功 | Codex・Grok・Claude・Cursor |
| Linux main-server | 同上 | 同上 | Codex・Grok |
| Windows native | 同上 | 同上 | Grok・Claude |

実AIは起動・非ブロック送信・完了通知・回答回収・終了を確認し、観測済みprocessの残存もゼロだった。
3環境の製品CI、npm provenance、GitHub ReleaseとMCPB、Official MCP Registryへの公開も完了している。
成立済みの検証を反復したり、文書訂正のために製品を増版したりする必要はない。

旧setup計画はarchiveへ移し、固定参照には完了と訂正先だけを残す。
Peertable担当へも訂正を引き渡す。他製品のrepositoryや廃止済みWSLは変更しない。
