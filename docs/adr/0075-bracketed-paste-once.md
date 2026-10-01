# ADR 0075: agent TUIへの貼り付けは全体を1回だけ包む

状態: 実装（2026-10-01、0.45.1）。

## 背景

2026-10-01 03:17、トロニー氏のClaude Code席へ画像4枚付きのメッセージ（約500byte）を送った時、入力欄の文が崩れた。
先頭に「。」だけが来て、1枚目の画像pathは途中で切れ、`[Image #1]`〜`#4`の札が付いたのに画像は3枚だけ読まれた。

POSIXのtmuxは、PTYの欠落を避けるため本文を256byteのchunkに分けて流す（ADR 0001）。agent dispatchは
chunkごとに`paste-buffer -p`を使っていたので、chunk 1つずつが別々のbracketed pasteになっていた。
Claude Codeは貼り付け1回ごとに画像pathを探して`[Image #N]`へ置き換えるため、chunkの切れ目にかかったpathは
画像として読まれず、最後の1文字だけの貼り付けは入力欄の先頭へずれた。Windows psmuxは元から全体を1回だけ包んでいた。

## 決定

agent dispatch（`bracketedPaste`）では、POSIXでも本文全体を`ESC[200~`と`ESC[201~`で1回だけ明示で包み、
包んだ全体を従来どおり256byteのchunkに分けて`paste-buffer`（`-p`なし、使えれば`-S`）で流す。

`-p`はpaneが貼り付けモード（`ESC[?2004h`）を要求している時だけ包むが、tmux 3.3aには要求の有無を読む書式が無く、
最初と最後のchunkだけを包む使い方もできない。`bracketedPaste`を立てるのはready gateを通ったagent TUIへの
送信だけで、Windowsでは4ハーネスとも明示の包みを受け付けているので、POSIXも同じ約束にする。

## 影響

- agent TUIへの長い本文が、TUIからは1回の貼り付けに見える。画像pathや行がchunkの切れ目で切れない。
- 貼り付けモードを要求していないpaneへも印が届く。例えばmacOSの`/bin/bash` 3.2は`00~echo …01~`と崩す。`bracketedPaste`は公開引数ではなく、agent dispatch以外は使わない。
- 試験の偽TUI（行を読むだけのshell）は、本物と同じく行の前後の印を外す。偽Claudeが終わって残ったshellへagent dispatchを流していた承認の試験は、印を外して行を実行する偽TUIで受ける。
