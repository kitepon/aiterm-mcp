# ADR 0106: Cursorのturnが誤りで終わった時、完了ではなく`error`・`rate_limited`で返す

状態: 採用。ADR 0103（Codex）と同じ決まりを、Cursorへ当てる。

## 原因

Cursorは、turnが誤りで終わると、記録（agent transcript）の`turn_ended`へ`status: "error"`と文を書く。普通の終わりは
`status: "success"`で、`error`は無い。

- 実物の記録（2026-10-08に読んだ。macbook 23件・rabbit 1件、2026-08-24〜09-28。BellTeamのコンテナの268本には0件）にあった文:
  - `[unavailable] Error` 3件、`[resource_exhausted] Error` 1件。サービスの誤り。
  - `You've hit your usage limit You've saved $… Your usage limits will reset when your monthly cycle ends on …` 9件、
    `Other Models usage limit reached Switched to … after reaching Other Models usage limit.` 1件。利用上限。
  - `User aborted request` 10件。席で止めたturn。
- Aitermの完了待ちは、`turn_ended`の`status`を見ずに、どれも`done`で返していた。`aiterm-wait`はexit 0、親への配送は`outcome=done`。
  呼んだ側には、失敗が、空の（または途中までの）回答の完了に見える。
- 利用上限は、画面の知らせ（`Error: You've hit your usage limit`）から`rate_limited`で返していた。記録を先に読むので、
  user turnが記録に残った時は、画面を読む前に`done`で返っていた。

## 決めた事

1. `turn_ended`の`status`が`error`の時、完了待ちは、文で3つに分けて返す。
   - 文に`usage limit`がある: `outcome: "rate_limited"`。`rate_limit`にその文（1行、600字まで）。画面から読めた時と同じ返り。
   - `User aborted request`で始まる: 今までどおり`done`。止めたのは席の前の人か、鍵を送った呼び出し側で、失敗ではない。
   - ほか: `outcome: "error"`。`aiterm-wait`はexit 7。`error`は1行の文（改行を畳み、URLを「…」に置き換え、200字で切る）。
     文が無い時は、理由の記録が無い事を書いた文。
2. 種類は、文の頭の角括弧の名前を`error_kind`で返す（`unavailable`・`resource_exhausted`など。無ければ`null`）。
   `aiterm.agent-wait-result.v1`に前からある項目で、足す項目は無い。
3. 完了の出来事の`done_status`は、1の「ほか」と利用上限の時に`turn_error`（Grokと同じ）。
4. 変えない物: `status: "success"`の返り、引数、断りの文面、送信の振り分け（`turn_ended`があればturnは終わっている、の読み）、
   回答の読み出し、合間の言葉、利用上限とhookの拒否を画面から読む道、Claude Code・Codex・Grokの席。

## 取らなかった形

- **席で止めたturnも`error`で返す。** Codexの止めたturn（`turn_aborted`）は誤りに数えていない。取消を失敗として返さない（ADR 0102）。
- **利用上限を`error`で返す。** 画面から読めた時は`rate_limited`で返している。同じ出来事の返りが、読めた場所で変わらないようにする。
- **`[resource_exhausted]`を利用上限に数える。** 短い間の混雑か、月の上限かを、文から決められない。実物の利用上限の文は別にある。

## 及ばない所

- 本物のサービスを誤らせて確かめてはいない（通信を乱す試験はしない）。確かめたのは、実物の記録と同じ形を書いた記録の読み。
- user turnを記録に残さずに`turn_ended`（`error`）だけが書かれた時（実物の利用上限で8件）は、完了の条件（user turnが増えている）に
  当たらない。今までどおり、画面の知らせで`rate_limited`を返す。利用上限でない誤りがこの形で書かれるかは、実物に無い。
- 知らない`status`（`success`でも`error`でもない値）は、今までどおり`done`で返す。実物には無い。

## 確かめ

- `test/cursor-agent.test.mjs`: 実物の4種類の文で、`error`と種類、`rate_limited`と文、止めたturnの`done`が返る事。
  誤りで終わった後の次のturnが`done`で返る事。文の整え方（改行、URL、長さ、文が無い時）。
- 普通のturnは、3台の実物のCursorの席で、起動から完了まで流す。
