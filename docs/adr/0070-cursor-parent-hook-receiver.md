# ADR 0070: Cursor親の受信口に公式hookと背景受け口を使う

日付: 2026-09-22

## 判断

Cursor親の回答配送は、gpt-connectorが同じCursor Desktopで使っている公式hookをAitermの既存配送へ載せる。
完了観測、加工前本文の保存、同じ子への予約、配送状態は`ParentDeliveryManager`をそのまま使う。
Cursor固有の識別、会話への束縛、差し込み、idle時の受け口は`src/cursor-parent-*.ts`に閉じる。

- 親はMCP `initialize`の`clientInfo.name`が`cursor-vscode`（または空白以降の派生名）であることで識別する。
  会話IDはMCP要求に来ないため、`_meta`は使わない。
- `afterMCPExecution`とdispatch toolの`postToolUse`が、tool返りの`parent_delivery.delivery_id`とhook入力の
  `conversation_id`を結ぶ。本文の取り出しは`structuredContent`と、`content` textのJSONの両方を読む。
- 親が次のツールを呼ぶと`postToolUse`が`additional_context`で本文を会話へ差し込む。
- 親がターンを終える場合は、receiptの`wait_process`で`cursor-parent-receive`を背景起動する。
  本文が届くとstdoutへ出して終了する。`wait_command`はnull。
- hookと受け口の受け取りは`claim.json`の排他作成で一つに決める。両方へ本文を出さない。
- hook未登録は子への送信前に`CURSOR_PARENT_HOOK_UNAVAILABLE`で止める。24時間以内にclaimが無ければ
  `failed`とし、本文は残して自動再送しない。
- 配送記録は`cursor-parent-deliveries`へ分け、子の予約`claims`だけをCodex／Claudeと共有する。
- `aiterm-setup`が`~/.cursor/hooks.json`の自製品entryだけを追加・更新・解除する。他製品のhookと順序は保持する。

`stop` hookの`followup_message`は親の次ターンを自動開始するため使わない。
Cursor Cloud Agent／Background Agentはhookが載らないため対象にしない。

## 未実施

通常HOMEのCursor親から子を起動し、差し込みと背景受け口の両方で本文が届くことは、この判断の時点では未実施。
公開前の受入で確認する。

## 根拠

- [Cursor Hooks](https://prod.cursor.com/docs/hooks)（`rag/sources/completion-detection/cursor-hooks-2026-08-24.md`）
- gpt-connectorのCursor親配送（`cursor-parent.ts`、`cursor-hook.ts`、`cursor-inbox.ts`）
- [ADR 0058](0058-claude-parent-hook-receiver.md)
- [実装計画](../plan_cursor-parent-result-delivery.md)
