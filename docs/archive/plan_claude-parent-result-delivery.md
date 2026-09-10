# 子の回答をClaude親へ自動配送する実装計画

状態: 完了。2026-09-10の「次はClaude親に対応させろ」に基づき、公開版0.35.1の3環境受入まで実施した。
最終判断と未確定な起動観測は[ADR 0059](../adr/0059-claude-parent-result-delivery-acceptance.md)を参照する。

## 到達点

Claude Code親がAitermへ子の依頼を送ると、Aitermが完了を検知し、確定した回答本文を親へ届ける。
親は別の作業を続けるかターンを終え、届いた回答で続行する。
親のwaiter起動・ポーリング・通常の回答回収と、子への返送コマンド指示を不要にする。
通常の結果は現在の親ターンを中断せず、順番待ちから処理する。

Codex親で既に実装した本文保存・依頼相関・配送状態を再利用する。
Claudeの公式Channelsを受信口候補として実測した後、通常起動で使える公式`asyncRewake` hookを採用した。
通常HOME、認証、MCP、plugin、skill、permissionを維持し、Claudeの設定や履歴を独自形式で複製しない。

## 着手時の根拠と未知

- ベースラインはmainの `5bdea7fa4483d2e24dd967de60c42a270181e790`。直前の3環境CIと関連試験が成功し、working treeとstashは空。
- 公式Channelsは同じMCP接続から本文を受け、busy時は次ターンへ順番待ちする。
- Channelsはsessionごとの明示有効化を必要とする。通常のMCP登録だけでは受信しない。
- 通知に受領ACKはなく、無効な接続への通知もserverからは成功に見える。transportへの書込みを受信済みと呼ばない。
- 既存caveatに、旧版の `--mcp-config` とchannel名解決の差、Claude Desktopの未対応がある。現行CLIで再確認する。
- 未確認: MCP要求の親識別、実効channel有効化の確認方法、再接続時の同一親の識別、設定の正規導入、長文の完全性。

## 所有と変更範囲

| 所有 | 責務 |
| --- | --- |
| `src/index.ts` | MCP要求から親を識別し、受信口とdispatchを接続 |
| `src/parent-delivery.ts` | 完了境界、本文保存、状態管理と同じ子への連続依頼 |
| Claude親の専用module | 公式asyncRewake hook、依頼相関・会話終了・本文出力 |
| `src/setup-integrations.ts`等のsetup | 公開入口の導入条件と読戻し |
| README、DESIGN、CHANGELOG、関連test | 公開挙動・設計・回帰・受入 |

他製品へ状態や修理を移さない。子harnessごとの回収方法、Codexの公式受信キュー、既存の通常PTYを作り直さない。
Claude Desktop・Web・第三者providerなど候補の公式受信口がない環境を、推測で対応済みにしない。
権限確認の代理承認や組織policy変更は本機能に含めない。

## 工程と受入

1. 実機の最小MCPで識別情報、有効化、idle/busyの受信、本文と再接続の境界を確認する。
2. 実測した契約を最小の親adapterへ閉じ込め、先にfocused testを作って実装する。
3. 通常のMCP登録からClaude親が子を呼び、初手とfollow-upを自動受信して続行することを確認する。
4. 公開契約を同期し、関連gate、独立反証、最後の通し試験、3環境CIを確認する。
5. main祖先のrelease、3環境への公式導入、公開後smokeまで届け、最終判断を別ADRへ保存して本計画をarchiveする。

受信口の成立から実装、導入、公開後確認へ受入が連鎖するため統括レーンとする。
Fは親識別・公開契約・配送保証・受入・公開、Aは仕様確定後の実装とfocused test、Hは外部CI・配布完了待ち。
受信口の実測が実装の仕様を決めるためwriterは直列とし、契約クリティカルな独立反証だけ別担当へ依頼する。
Latticeは新規適用しない。既存の別工程を本依頼へ取り込まない。

## 検証

対象は親の取り違え、無効hook、別接続、切断・再接続、即完了、初手・同じ子のfollow-up、
長い日本語・改行・引用符の本文保存、子の失敗、通知結果不明と無断再送、Codex既存契約。
各機能はfocused testで確認してから関連gateを通し、全体試験は最後の確認にだけ使う。
実機受入は通常HOME・登録を使い、親がwaiter・回収を呼ばず、子に返送指示を含めない条件で行う。

現在地: 通常HOMEのClaude Code 2.1.259で、初手と同じ子への追加依頼の本文自動受信を確認。
hookが45秒待機中にも16秒後に別turnの回答を完了し、その後に子の結果で自動再開した。
32,164文字のhook通知では先頭・末尾と最後の行まで記録された。
`/clear`だけでは素のhookが止まらないことを再現し、SessionEndによる停止を実装。
製品では新しい会話への旧回答不着、本文保存、`CLAUDE_PARENT_SESSION_CLOSED`を確認した。
初期試験のClaude記録が0.34 readerに拒否されることも再現し、保存場所の分離と共有claimsのfocused testで修理した。
初期試験の3記録は証拠へ退避済みで、以後の製品試験は分離した保存場所だけを使う。

独立反証: Grok 4.6×highの読み取り専用監査で、通常起動の宛先・会話終了・結果不明・導入互換に重大欠陥なし。
`--agent`の主会話にも`agent_id`が付く指摘を受け、拒否対象を文書とerror本文へ明記した。
この担当には書込み、ビルド、通し試験、公開操作を委譲しない。

関連試験103件とbuildが成功。LinuxとWindowsのClaude Codeも必要版以上を確認した。
採用した受信口と配送保証は[ADR 0058](../adr/0058-claude-parent-hook-receiver.md)に固定した。

mainの実装commitは3環境CIを通過した。独立レビュー中のsteerで、Grokの次turnが完了回収より先に始まる競合を
実際に踏んだ。対象turnのeventと履歴のprompt_indexを相関する修正を行い、最小再現と回収試験10件、
元の実historyに残る初回回答3,447文字との完全一致を確認した。この追加修正への限定反証も問題なし。
修正版の3環境CI、0.35.0の公開と導入後受入へ進む。

0.35.0を公開し、3環境へ公式導入済み。WindowsとLinuxで親の初回・追加依頼の自動受信が成功した。
Macでは配送自体は成功したが、リンク経由のcwdとClaudeの実体パスの差で会話記録を見失った。
起動metadataへ実体パスを保存する修正を加え、失敗を再現したfocused testを含む3件が成功した。
修理を0.35.1として公開し、導入後受入を確定する。

## 根拠

- [Channels](https://code.claude.com/docs/en/channels)
- [Channels reference](https://code.claude.com/docs/en/channels-reference)
- [公式hook仕様](https://code.claude.com/docs/en/hooks)
- [既存のCodex親対応](../adr/0056-codex-parent-result-delivery-acceptance.md)

取得日: 2026-09-10。実機結果は実測後に追記する。
