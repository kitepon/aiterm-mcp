# ClaudeのAPIエラー終了後の送信判定

## 実測と原因

Claude Code 2.1.283とAiterm 0.41.2の組合せで、Claudeが`reasoning_extraction`の拒否を会話記録へ`isApiErrorMessage: true`として書いた後も、Aitermのturnの印が残った。次の`pty_send`は、入力待ちに戻ったClaudeへ送っているのに`agent_steer`を返した。利用側は差し込みとして処理し、拒否後の新しい回答を追跡できなかった。

上流の安全判定の拒否と、Aitermの実行中判定は別の問題である。公開発言の表示についての相談は、新しいClaudeセッションで回答できた。上流の拒否判定そのものの原因は確定していない。

## 修理

`src/harnesses/claude.ts`が現在のturn開始後のAPIエラー記録を確認する。`src/core.ts`の送信処理が、そのエラーで終了したturnの印だけを解除し、次の依頼を新しいturnとして送る。過去のエラーで次のturnの印を解除しない。waiterは読取専用のままとし、上流の拒否はエラーとして返す。

修理commitは`5e1862c`、公開commitは`73f8415`。修正版は[0.41.3](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.41.3)。npmとOfficial MCP Registryへの公開を確認した。

## 検証

- 修理前の最小再現は、次の送信が`agent_steer`となって失敗した。
- 修理後は、エラー後の新規送信、次のturnへの差し込み、tool処理中の差し込み、Stop後の新規送信の4件が成功した。
- 関連する純粋関数と文書検査は76件成功した。
- 修理commitの[CI](https://github.com/kitepon/aiterm-mcp/actions/runs/36415338925)はMac・Linux・Windowsの選択された関連試験がすべて成功した。
- npmから隔離導入した0.41.3でも、上記の送信テスト4件が成功した。APIエラー記録は実測と同じ形式の試験データで再現した。
- 利用側では対象Botだけを正規の再起動APIで起動し直し、承認された公開発言についての補足を送った。通常回答が会話APIへ戻り、配送状態が`delivered`になることを確認した。

## 未完了の項目

一次資料を保存したcommitの[全試験CI](https://github.com/kitepon/aiterm-mcp/actions/runs/36415561119)は、WindowsのCodex登録の3件で失敗した。`test/windows-codex.test.mjs`の保存先の権限設定で`CODEX_WINDOWS_OPERATION_FAILED`を返しており、原因は未特定。今回のClaude修理では該当するWindows登録処理を変更していない。全試験をすべて成功したとは扱わない。

利用側の本番への導入は、コンテナ再起動の承認待ち。通常のdeployには別作業の未反映commitも含まれるため、公式npmによるAitermだけの更新とコンテナ再起動を、通常手順の例外として提案している。承認後は処理待ちの保存、更新、再起動、導入版と通常の回答の確認まで行う。巻き戻す場合は公開済みの0.41.2へ戻して再起動する。
