# ADR 0058: Claude親の受信口に公式asyncRewake hookを使う

日付: 2026-09-10

## 判断

Claude Codeの公式`PostToolUse` command hookを`asyncRewake:true`で登録し、
子の完了後に本文をstderrへ出してexit 2で親を再開する。
Claudeがhook processと次turnへの受渡しを所有し、Aitermが依頼相関・本文保存・配送状態を所有する。
`aiterm-setup`が専用のPreToolUse、PostToolUse、SessionEndを既存設定へ追加する。
公開toolは18のままとし、親のwaiter起動・回答回収や子への返送コマンドを要求しない。

公式Channelsでも受信は成立したが、会話ごとの起動flagと開発channel承認を必要とする。
通常のCLI起動で成立し、hook待機中も別turnを進められることを実測したasyncRewakeを採用する。
最小対応版は実機確認済みのClaude Code 2.1.259とする。

## 相関と配送保証

- 親はMCP要求の`claudecode/toolUseId`と、その直前に実行したPreToolUseのsession IDで識別する。
  起動時の環境変数は`/clear`で古くなるため宛先として使わない。
- SessionEndでその会話の未送信依頼を閉じる。同じsessionのresume後の新規依頼は別toolUseIdとして受け付ける。
- 子の本文は配送前に永続化する。`submitted`はhookへの出力完了を表し、モデルが本文を処理した証明ではない。
  出力前の明確な失敗と出力中の結果不明を区別し、不明な配送を自動再送しない。
- Claudeの配送記録は専用の保存場所へ置き、0.34のCodex readerへ未知のparent形式を渡さない。
  同じ子への予約は両方式で共有する。
- Claudeのnative subagent、hook無効化、未対応版は、子へ依頼する前にtyped errorで拒否する。
  Claude Desktop等の別clientにこの受信口を推測適用しない。

## 実測

通常HOMEのClaude親からCodex子へ初手と追加依頼を送り、親のwaiter・回収なしで各回答を受信した。
45秒待機するhookを残した状態で16秒後に別turnを完了し、hook終了後に自動再開した。
32,164文字の日本語通知は先頭・末尾・最終行まで記録された。
素のhookが`/clear`後も新しい会話を再開することを再現し、SessionEnd連携で旧回答を抑止した。
確定本文は保存され、配送状態は`CLAUDE_PARENT_SESSION_CLOSED`になった。

関連試験103件は成功した。3環境CIと公開後受入は別の完了判断に記録する。

## 根拠

- [公式hook仕様](https://code.claude.com/docs/en/hooks)
- [着手判断](0057-claude-parent-result-delivery.md)
- [実装時の実測](../evidence/2026-09-10-claude-parent-delivery.json)

取得日・実測日: 2026-09-10。
