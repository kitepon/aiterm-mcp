# ADR 0092: 回答が空で終わったturnは、読めなかった時と分けて返す

状態: 採用。

## 原因

`pty_read(agent_transcript:true)`は、読み取った本文が空白だけだと、4つのharnessとも
「最終 assistant メッセージを特定できませんでした」の誤りを返していた（`src/core.ts`の`readAgentTranscriptResult`）。

連携元（BellTeam）の本番で、Codex（0.160.1）の席が、伝える事を道具（`sendmessage`）で送ってから回答を空で終えた
（2026-10-06、5ターン）。Codexはこのturnを、`phase: "final_answer"`で`text`が空のassistant messageとして、turn ID付きで
記録に残す。`task_complete`の`last_agent_message`は`null`で、`error`は無い。記録には「回答は空」と書いてある。

それでも誤りになるので、次の2つを呼び出し側が見分けられなかった。

- 回答を空で終えただけのturn（欠けた物は無い）。
- 記録の形が変わって、回答を読めなくなった時（直す必要がある）。

同じ根で、親への自動配送（完了turnを指定する読み方）は、Codexの空の回答で「transcript がまだありません。ターン完了後に
再取得してください」になり、親へ`AGENT_RESULT_UNAVAILABLE`・`outcome=error`で届いていた。turnは終わっているのに、
後で取り直すよう伝えていた。

## 判断

「回答の場所が記録にあって、中身が空」と「回答の場所が見つからない」を分ける。

- 各harnessの読み取りは、回答の場所を見つけたら文字列（空でもよい）、見つからなければ`null`を返す。
  誤り（文面は変えない）にするのは`null`の時だけ。
- 場所があって空白だけの時、`pty_read(agent_transcript:true)`は誤りにせず、`text`を空文字列、`answer_empty`を`true`で返す
  （`aiterm.pty-read-result.v1`へ`answer_empty`を足す。回答がある時は`false`、terminalの読み取りは`null`）。
  人とAIが読むcontentには「このターンは完了しましたが、回答の本文は空でした。」と書く。
- 親への自動配送は、空の時「子のターンは完了しましたが、回答の本文は空でした。」を本文にして、`outcome=done`で届ける。
  親が完了を知る手段はこの配送だけなので、黙って捨てない。

「回答の場所がある」の決まり。

| harness | 場所がある | 根拠 |
|---|---|---|
| Codex | turn ID付きのassistantの`output_text`が1つ以上ある。または`task_complete.last_agent_message`が文字列 | 0.160.1の実記録（空の`final_answer`） |
| Claude Code | Stop hookの結果file（`last_assistant_message`が文字列の時だけ書く。digestで照合済み） | hookの作り |
| Grok | 範囲に、`content`が文字列のassistant行がある | 道具を呼ぶだけの行は`content`が空文字列で残る（実記録） |
| Cursor | 完了turnにassistant行があり、partが`text`と`tool_use`だけ | 実記録253本で、partはこの2種類だけ |

- Cursorで知らない種類のpartがあるturnは、本文がそこへ移ったのかもしれないので、空とは言わず誤りのままにする。
- Codexのturn IDが無い旧形式（`event_msg`の`agent_message`）は、空でない時だけ使う。どのturnの物か確かめられないので、
  空の証拠にはしない。turn ID付きの本文が記録にある時は、空でもそれを回答とし、旧形式へは落とさない
  （前のturnの回答を、空で終えたturnの回答として返さない）。

## 退けた案

- 誤りのまま、種類の違う誤り（別のcode）にする: 完了したturnの回答が空なのは、読み取りの失敗ではない。呼び出し側は
  誤りの文の文字合わせで見分ける事になる。`claude_turn recover`は前から、空の本文を`completed`で返している。
- 空白だけなら、場所を確かめずに「空」で返す: 記録の形が変わった時も「空」に見え、直す必要に気づけなくなる。

## 影響

- 今まで誤りだった「回答が空のturn」が成功で返る。本文が空の時の扱いは、呼び出し側が`answer_empty`で決める。
- `answer_empty`は出力schemaでoptional。`remote`付きの`pty_read`は現地の結果をそのまま返すので、この項目が無い
  旧版（0.53.2以前）の現地の結果も通す。現地が旧版の時、空の回答は今までどおり誤りになる。
- 回答の場所が見つからない時の誤りの文面は変えていない。

## 確かめ

- 試験: 4つのharnessで、空の回答が`answer_empty: true`になる事と、場所が見つからない記録が誤りのままである事。
  Codexは完了turnを指定する読み方でも空で返る事、前のturnの旧形式の本文を拾わない事。親配送が知らせの文を
  `outcome=done`で届ける事。
- 本番の実記録（Codexの5ターン、読むだけ）を、0.53.2と直した版の読み取りへ通した。
- 実物のCodex（0.160.1）: 道具を1回動かして回答を空で終えるturnで、0.53.2は誤り、直した版は`answer_empty: true`。
  同じsessionの次のturn（普通の回答）は`answer_empty: false`で本文が返る。
- 実物のClaude Code（2.1.289）・Grok・Cursorは、同じ頼み方では回答を空で終えなかった（Claude Codeは、表示する応答が
  無いと自分でもう一度modelへ求める）。この3つの空の回答は、記録の形に合わせた試験までで、実物では見ていない。
