# ADR 0110: Grokが文を受け取らなかった時は、待ち続けず、次の文と混ぜない

状態: 採用。

## 原因

Grok（1.0.50）は、送った文を中のagentが受け取らないと、10秒で足元の表示を「Waiting for the agent to accept the prompt…」に変え、
120秒で自分から取り消して、文を入力欄へ戻す（「The agent did not accept your prompt within 120s. Your text is back in the input box;
press Enter to retry.」）。会話の記録（`events.jsonl`）には、番の行が1つも出ない。

Windowsの実物では、起こすstdioのMCPが8個以上の時に毎回こうなる（2026-10-11。Grokの側の不具合で、Aitermでは直らない）。
その時のAitermの返りが、起きている事と合っていなかった（Windows、Aiterm 0.58.1、Grok 1.0.50で見た）。

1. **完了待ちが、時間切れ（既定600秒）まで待つ。** Aitermは番の終わりを記録で知る。記録に何も出ないので、Grokが文を取り消した後も待ち続けた。
2. **戻された文が、次の文とつながる。** 入力欄に前の文が残ったまま次の文を貼るので、2つが1通になって送られた
   （`Reply with the single word OK. Do not use tools.Reply with the single word SECOND. Do not use tools.`）。
3. **受け取り待ちの間に送った文が、待ち行列に残る。** 画面が動作中なので差し込みの道へ入り、文はGrokの待ち行列へ入る。
   差し込む先の番が無いので動かず、`STEER_STILL_QUEUED`で断るか、Grokの取り消しと重なると`agent_steer`（成功）で返った。
   どちらでも、文は待ち行列に残った。

## 決めた事

1. **完了待ちは、画面の知らせで終わりを知る。** 知らせが出ていて、その後に動いている表示が無く、入力欄に文があり、
   この待ちの間に番が始まっていない（記録に`turn_started`が無い）時、結果なしの終了（`error`、exit 7）で返す。
   `error`の文に、Grokが受け取らなかった事と、文が入力欄へ戻っている事を書く。
   - 知らせは次の番が始まった後も画面の上に残る。送った直後の一瞬を読み違えないよう、間を置いた2回の読み（2秒おき）が続けて同じ時だけ返す。
     待たずに1回だけ見る照会（`--timeout 0`）では返さない。
   - 画面を読む回数は増やさない。上限の知らせを見るために読んでいた1枚を使う。
2. **新しい番を送る前に、戻された文を消す。** `C-c`を1回送り、入力欄が空になったのを見てから貼る。返りの`pane_input_recovery`に
   `grok_unaccepted_prompt_cleared`を足す。消えなければ、送らずに断る（`GROK_UNACCEPTED_PROMPT_NOT_CLEARED`）。
   - 入力欄に文がある時の`C-c`は、入力欄を空にするだけ（Grok 1.0.46と1.0.50の実物）。空の入力欄で押すと終了の構えになるので、
     知らせがあって入力欄に文がある時だけ押す。
3. **受け取り待ちの間は、送らずに断る。** `GROK_PROMPT_NOT_ACCEPTED_YET`。文は打たない。前の文の完了待ちは、1のとおり120秒ほどで終わる。

## 変えなかった事

- 受け取らなかった文を、Aitermからは送り直さない。受け取らない席は、送り直しても同じになる。送り直すかは呼び手が決める。
- 知らせが出ている席の状態（`pty_observe`）は、今までどおり`idle / composer_ready`。
- Grokが文を受け取らない事そのものは、直らない。

## 確かめ

- `test/grok-unaccepted-prompt.test.mjs`: 実物から写した画面での読み分け、完了待ちの2回読み、
  模擬のGrok（1通目を受け取らない）で「受け取り待ちの間は断る→取り消しの後に完了待ちが`error`で終わる→戻された文を消して次の文だけを送る→答えが届く」。
- 実物（Windows、MCPが10個の設定のGrok 1.0.50）での確かめは、CHANGELOGに書く。
