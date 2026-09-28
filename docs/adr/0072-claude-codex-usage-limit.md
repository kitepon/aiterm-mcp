# ADR 0072: Claude CodeとCodexの利用上限を、今の画面とturnの記録で見分ける

日付: 2026-09-28

## 判断

完了待ち（`wait_process`・`aiterm-wait`・`observeAgentDone`）が返す`rate_limited`は、「このturnが今、上限で止まっている」ことを表す。
Claude CodeとCodexは、これまでpane logの末尾16KBから上限の文字を探していたが、それをやめる。

- Claude Code（0.42.1）: 現在の画面で、最後の入力欄（`❯`）の下の枠線より後に`Usage limit reached`がある時だけ上限とする。
  上限で止まっている間、Claude Codeはここに`⚠ Usage limit reached · continuing automatically at … · esc to cancel`を出し、
  次のturnが始まると足元を描き直して消す。会話欄の`● Usage limit reached …`は上限が明けた後も残るので数えない。
- Codex（0.42.2）: turnを終える`task_complete`の`error.codex_error_info`が`"usage_limit_exceeded"`の時だけ上限とし、
  `error.message`を`rate_limit`に入れる。画面とpane logは見ない。`rate_limit_exceeded`（短い間の混雑）は上限に数えない。

## 採らなかった案

- dispatch時のpane logの大きさより後ろだけを探す: 依頼文そのものがpane logへ書かれる。上限の文字を引用した依頼
  （2026-09-28、誤判定の報告そのもの）で同じ誤判定をする。Codexでは道具の出力にも文字が出る。
- Codexの`token_count.rate_limits`で`used_percent`が100%かつ`resets_at`が先なら上限とする: macbookの記録では、
  100%のまま返事と道具の実行が数分〜数時間続いた`token_count`が7千件以上あった。100%は止まっていることを意味しない。
  `rate_limit_reached_type`も42万件すべて`null`だった。

## 実測

- Claude Code: BellTeamコンテナのpane log（2026-09-28 14:01の上限）。足元の知らせは次のturnの描き直しで消え、
  会話欄の知らせは残った。旧判定は上限が明けた後も`Usage limit reached`を返し、新判定は返さない。
- Codex: macbookの実記録（2026-08-07 06:23:58、上限のturn）。
  `{"type":"task_complete","last_agent_message":null,"error":{"message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 12:35 PM.","codex_error_info":"usage_limit_exceeded"},"duration_ms":587}`。
  codex-cli 0.158.0の本体にも`codex_error_info`と`usage_limit_exceeded`がある。
  BellTeamコンテナでは、Botが回したスクリプトの出力に上限の文字が入った記録が4つあり、旧判定はこれで誤判定しうる。
