# ADR 0051: 製品が導入とAI登録を所有する

- 状態: 採択
- 日付: 2026-09-09

## 判断

導入後の一括入口は`aiterm-setup`とする。OSの依存準備、公開MCP経由の端末実行、
検出したAIへの登録と確認をAitermが所有し、外部の工場に設定形式やOS差を実装させない。
npm lifecycleでの自動登録は行わない。一時cache、CI、rootでのpackage取得をユーザー設定変更へ結び付けないためである。

登録対象はglobal packageの絶対パスとし、Claude Code／Cursorは原子的JSON更新、
Codex／Grokは公開CLIを使う。他サーバーと設定全体を保持し、変更前JSONをbackupする。
失敗・対応外・未検出はJSONの公開結果へ残す。Windows依存はwinget、macOSはHomebrew、
Ubuntu／Debianはaptで導入する。未知の自動導入手順を推測しない。

## 検証

Windowsの一時global prefixと一時HOMEへnpm packを導入し、初回と再実行で
端末実行と4種類のAIの登録がreadyとなった。Claudeの公式getでもstdio接続と登録先を確認した。
JSON保持・不正設定・部分失敗・OS別導入・最低psmux版はfocused testで確認する。
macOSとLinuxの最終試験は製品CIが所有する。

別ベンダーの読み取り専用反証では、Claudeの登録先への指摘が一度出た。
一時HOMEとCLAUDE_CONFIG_DIRの公式CLI読戻しを再確認し、2026-09-09の同一監査セッションで指摘を撤回、受入可と判定した。
