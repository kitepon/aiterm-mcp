# ADR 0071: BellTeamへ合間の言葉を渡す口を`pty_observe`の`_meta`に置く

日付: 2026-09-28

## 判断

BellTeamは、Botがturnの途中で書き、そのあと道具を使った言葉（合間の言葉）を会話画面のログへ出す。
Aitermは、`pty_observe`の要求の`params._meta`に`"aiterm/caller": "BellTeam"`がある時だけ、
結果の`_meta["aiterm/interim_words"]`へ、そのsessionの現在（または直前）のturnの合間の言葉を返す。
値が`"BellTeam"`でない時と`_meta`が無い時は何も足さない。本文、`structuredContent`、ツールの説明、引数は変えない。

- 前回受け取った最後の`seq`を`"aiterm/interim_after"`に渡すと、それより後の言葉だけを返す。
- 返す形は`schema: "aiterm.interim-words.v1"`、`session_id`、`launch_id`、`harness`、`event_cursor`、
  `operation_id`、`last_seq`、`words[]`（`seq`、`text`、`kind: "interim" | "error"`、`at`、`turn_id`）。
  `event_cursor`はそのturnを始めたdispatch receiptの`event_cursor`で、呼び手はこれで自分の依頼のturnか確かめる。
  起動時promptのturnとまだ送っていないsessionでは`null`。
- 最後の回答と思考は含めない。Claude CodeのAPIエラーとsession limitの知らせ（`isApiErrorMessage`）は`kind: "error"`で含める。
  Codex・Grok・Cursorは、2026-09-28時点でエラーの本文を記録へ書かないので出せない。
- dispatchの送信直前に、そのturnの言葉が記録のどこから始まるかを`<session>.<launch>.interim.json`へ残す。
  Claude Code・Codexは記録のbyte位置、Grok・Cursorは記録中のuser発話の数を使う。差し込み（steer）は境界を動かさず、
  同じturnの言葉として続く。境界の記録に失敗しても送信は止めない。
- 見分け方: Claude Codeは`message.stop_reason: "tool_use"`の`text`、Codexは`phase: "commentary"`の本文、
  Grokは`content`が空でなく`tool_calls`を持つassistant、Cursorはあとに`tool_use`が続く`text`。
  Cursorは道具が終わってから行を書くので、道具の実行時間だけ遅れて届く（BellTeamのオーナーがこのままでよいと判断）。

## 説明と引数に出さない理由

合間の言葉が要るのはBellTeamだけで、Aitermは他の場面でも多く使われる。ツールの一覧を読むAIが要らないのに指定しないよう、
説明にも引数の一覧にも出さない（BellTeamのオーナーの決定）。引数の定義にないキーはSDKの検証で捨てられるが、
`params._meta`は定義と関係なく`extra._meta`に届き、ツールの一覧にも出ない。
利用者向けREADMEには書かず、コード（`src/interim-words.ts`の冒頭と`src/index.ts`）に、BellTeamのためにあると注記する。

## 実測

2026-09-28、このコンテナで手元のdistを使い、promptなしで起動してから`pty_send`で2回頼み、
各turnで「言葉→8秒の道具」を2回書かせた。実行中に1秒おきに`pty_observe`を呼んだ。
Claude Code・Codex・Grok・Cursorとも、2つの言葉が順番どおり`seq` 1・2で届き、回答と前のturnの言葉は含まれず、
`event_cursor`はreceiptと一致した。Cursorは3回続けて試した。

## 根拠

- BellTeam側の設計と調査: トロニー（bot-7b140b27）の`docs/interim-words.md`
- [ADR 0070](0070-cursor-parent-hook-receiver.md)（Cursor記録の読み方）
