# Windows Codex親へのSteerの公開確認

2026-09-13。Aiterm 0.37.1の公開packageをWindows nativeへ導入し、実際のCodex Desktop親へ
子の初回回答と同じ子への追加依頼の回答が届いた。両方とも親でwaiter・transcript回収を呼ばずに受信した。

## 単独動作と設定

launcher、中継、認証付きloopback接続、親processの識別、設定・解除をAiterm自身が所有する。
gpt-connectorとdotagentsの実行時importはない。gpt-connectorのMIT実装を参照し、LICENSEへ帰属を記録した。

0.37.0の公開packageを使い、一時設定領域と未設定のGUI環境でAiterm自身のlauncher生成・公式CLIのRPC・
`restart_required`・解除後の未設定復元を確認した。0.37.1でこのsetup実装は変更していない。
公式CLIの隔離試験もAiterm自身のrelayを使い、外部launcherを必要としない。

この実機には既存の互換launcherがあったため、公式binary・Desktopの祖先関係・ACL・RPCを検証して任意共有した。
公開入口`aiterm-setup --json --codex-steer enable`はpsmux・Claude・Codex・Grok・Cursor・Steerすべて`ready`。
`aiterm-setup --codex-steer status`も`ready`。既存launcherの設定は保持した。

## 実測結果

| 確認 | 結果 |
| --- | --- |
| Windows接続・設定などの関連37試験 | 28成功、9件OS条件skip、失敗0 |
| 公式CLIを使った隔離2試験 | 実行中の同じturnへのSteer、終了後の同じtask再開、本文各一回の保存とモデル入力、承認拒否、RPC分離、通常EOFとモデル応答待ちEOFが成功 |
| Windows全体496試験（0.37.0実装） | 433成功、63件条件skip、失敗0 |
| 実機で発見した起動停止の関連11試験 | 修正前に再現、修正後11成功。promptなしの実機起動も`ready` |
| 公開前の配布metadata・文書14試験 | 14成功、失敗0 |
| 公開MCPによる初回配送 | `done`・`submitted`。本文「Windows公開版の初手配送を確認」を同じ親taskで実受信 |
| 同じ子への追加依頼 | `done`・`submitted`。本文「Windows公開版の追加配送を確認」を同じ親taskで実受信 |
| 配送経路 | 両方の`queued_submission_id`はnull。親でwaiter・transcript回収を使用せず |
| 終了 | `pty_close`後の`pty_observe.exists=false`、公開MCPの終了コード0 |

実機の起動停止は、Windowsのhook画面の`esc to go back`とnpm shimの中間Node processを扱えていないことが原因だった。
Codex adapterの画面認識とAitermのprocess相関を修理した。手動承認、別harness、prompt再送で回避していない。
独立反証で共有接続の開始時刻表記差も再現して修理し、今回の起動修理には追加の重大指摘がなかった。

公式Windows CLIのSHA-256は`081e4de4be8e38fac6ed4d95e3b1a0b9f6d31c090ddc36e1696b349fe406f575`。
隔離試験は一時HOMEとローカルResponses fixtureを使用し、実機配送試験だけ通常の認証と設定を使用した。
外部command子孫の終了と実ログアウト後の設定継続は、この試験の観測対象に含めていない。

## 公開物とCI

- 実装: `71ddd0cf184c89ece28d79b42670bc8d498884b9`。起動修理: `b6689ddafd03db26b2dbd0068c5a8f40ee79419b`。
- 公開commit: main上の`0f61d56885ab8bb0be8f2fa9ac646cace3ff609c`、tag `v0.37.1`。
- Windows対応の[3環境CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34759791832)は成功。
- 起動修理の[3環境CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34760723513)も成功。各373試験で、Windowsは326成功・47件条件skip、macOSは360成功・13件条件skip、Linuxは359成功・14件条件skip、すべて失敗0。
- 公開commitの[配布CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34760740310)と[npm provenance publish](https://github.com/kitepon/aiterm-mcp/actions/runs/34760741831)は成功。
- [GitHub ReleaseとMCPB](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.37.1)を公開し、[Official MCP Registry登録](https://github.com/kitepon/aiterm-mcp/actions/runs/34760759106)も成功。
- `npm view aiterm-mcp@0.37.1 version`で取得可能なことを確認後、global installと公開setupを完了した。

試験receiptとログは`.git/aiterm-experiments/windows-steer-20260913/`へ非公開保存する。
認証情報、接続token、実機設定本文をこの記録へ含めていない。

この親taskで元から接続されているMCP processは0.36.0のままなので、公開版の新しいMCP processを通常の親から
起動して実測した。通常のtool接続を0.37.1へ切り替えるにはCodexの完全終了・再起動が必要であり、
この記録は既存MCP接続の切替完了を主張しない。
