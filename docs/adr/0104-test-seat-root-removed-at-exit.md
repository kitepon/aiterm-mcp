# ADR 0104: 試験の前処理が作った置き場を、processの終わりに消す

状態: 採用。ADR 0087の続き。

## 原因

`test/seat-env.mjs`は、試験processごとに`/tmp/at-XXXXXX`（Windowsは`TEMP`の下）を作り、`TEMP`・`TMP`・`XDG_RUNTIME_DIR`・`TMPDIR`をそこへ向ける（ADR 0087）。
作った置き場は、誰も消していなかった。試験fileごとに1つ出来るので、全部の試験を1回流すと約100個残る。

- 実物（2026-10-08）: rabbit（Linux）に2042個・約258MB、macbook（macOS）に2069個・約348MB。10/4からの4日分。
  7割は空で、残りは試験の席の記録、npmが書く`node-compile-cache`、tmuxのsocketのfile。
- socketのfileは両方で約230本残っていて、つながるserverは0だった。tmuxは、serverが終わってもsocketのfileを消さない
  （`kill-server`の後も、最後のsessionを閉じた後も残る。tmux 3.5aで確認）。

## 決めた事

1. 前処理は、置き場を作ったprocessの`exit`で、その置き場を消す。
2. 置き場にsocketのfileがある時は、消す前に、つながるかを見る（別processのnodeで`net.connect`）。
   つながるserverが1つでもあれば、置き場を消さず、場所とsocketを標準エラーへ1行書く。試験が閉じ忘れた席の手掛かりを残すため。
   fileの有無では見ない（終わったserverのfileが残るので、ほとんどの置き場が残ってしまう）。
3. 消せなかった時（Windowsで開かれたままのfileなど）は、置き場を残す。試験の結果と終了コードは変えない。
4. 変えない物: 置き場の場所と名前、向ける環境変数、引き継がない環境変数。製品の動きは変えない。

## 及ばない所

- signalで止められた試験process（時間切れで止められた試験fileなど）は`exit`を通らないので、置き場が残る。
- 置き場を消した後も動いている、試験が起こしたprocess（tmuxのserverのほか）は見ていない。

## 確かめ

- `test/seat-env.test.mjs`: 前処理つきのprocessが終わると置き場が消える。終わったserverのsocketだけが残った置き場は消える。
  生きたserverのsocketが残った置き場は残り、場所とsocketが標準エラーへ出る。直す前の前処理では3件とも落ちる。
- 手元（Linux）で、tmuxを使う試験を含む7本（111件）を流し、`/tmp/at-*`が0のままである事。
