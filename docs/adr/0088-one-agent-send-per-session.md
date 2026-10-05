# ADR 0088: 同じagent sessionへの送信を1本ずつ通す

状態: 採用。

## 原因

`pty_send`（`sendAgentMessage`）は、送る時点の子の状態を見て、差し込みか新しいturnかを決める。
見てから決めた通りに送り終えるまでの間に待ちが挟まり、その区間を守るものが無かった。

- Claude Codeは、turnの印（`claude-operation.json`）の有無で振り分ける。印を取るのは`dispatchAgentTurn`の送信直前で、
  その前に、起動直後の入力受付待ち（最長30秒。画面が起動コマンドのままなら起動から50秒）と`before_send`の待ちがある。
- 既にある送信lock（`<name>.send.lock`）は`send()`の貼り付け1回ぶんだけを守る。貼り付けとEnterの間、
  振り分けと貼り付けの間は守らない。

実物（2026-10-05 07:56 JST、Aiterm 0.52.0、BellTeam、Claude Codeの席）: 起こした直後の席へ1通目、8秒後に2通目。
2通目は「印なし」と読んで同じ入力受付待ちへ入り、1通目が先に印を取った後で
「operation_idなしのClaude turn が未解決です」と断られた。文は打たれていない。送り直しは通った。

手元の再現（0.52.0、偽Claude、state・socket分離）: 起動直後の席へ`sendAgentMessage`を2本同時に呼び、0.3秒後に入力受付にした。
1本目は`agent_dispatch`、2本目は同じ文面で断り。

Codex・Grok・Cursorは画面で振り分けるので断りにはならない。2本とも新しいturnへ進み、同じ入力欄へ2回貼ってから
Enterが2回届く。偽Codexでは、2通が1行につながって届いた。

## 判断

agent sessionへ文を送る処理は、sessionごとに1本ずつ通す。後の1通は、前の1通が終わってから振り分け直す。

- 守る範囲: `sendAgentMessage`（振り分け〜Enterの確認）、`dispatchAgentTurn`（`claude_turn issue`）、
  `sendInitialAgentPrompt`（起動時promptの準備〜開始の確かめ）。
- 順に送った時と同じ動きになる。新しい振る舞いは足さない。Claude Codeへ重なった後の1通は、印があるので
  差し込み（`mode=agent_steer`）で返る。`claude_turn issue`が重なった時は、前と同じく印で断る。
- 同じprocessの中は、sessionごとの待ち行列で着いた順に通す。別のprocessの間は、
  `<name>.agent-send.lock`（socketの置き場）で排他する。別のprocessの間の順番は決めない。
- 送信lock（`<name>.send.lock`）は使い回さない。`send()`が中で取るので外から重ねて取れず、待ちが同期で
  MCP processの他の呼び出しを止める。新しいlockは非同期に待つ。
- 待つ上限は、起動から最初の描画を待つ上限と貼り付けの上限の和（POSIX 60秒、Windows 180秒）。前の1通が
  正常に進んでいる間は待ち切れる長さにした。越えたら`AGENT_SEND_BUSY`と「文字列は送信していません」で断る。

### 持ち主が死んだlock

送信lockは、残骸を自動で消さない（確かめてから消すまでの間に別のprocessが同じpathへ新しいlockを作ると、
生きたlockを消す）。同じ方針のままだと、今回のlockは持つ時間が長い（最長で1分前後）ので、親のCLIが送信の途中で
終わるたびに、子のsessionを閉じて作り直す事になる。子の会話を失う。

そこで、死んだ持ち主のlockは、消す役を1つに絞ってから消す。

1. lockの持ち主のpidが死んでいたら、`<name>.agent-send.lock.reap`を`O_EXCL`で作る。作れたprocessだけが消す役になる。
2. 消す役は、lockをもう一度読み、まだ死んだ持ち主のものなら消す。生きていれば何もしない。
3. 消す役の印を消し、lockを取り合う列へ戻る。

lockが在る間は誰も新しいlockを作れず、消すのは消す役だけなので、確かめた後で別のlockに入れ替わる事が無い。
消す役の印そのものが残った時（1〜3の途中で消す役が死んだ時）は自動で消さず、送信lockと同じ案内
（`pty_close`して同じIDで作り直す）で断る。

消す役の印は、持ち主が終了しているか、5秒より古ければ、残った物と読む。印を持つのは一瞬なので、
古さで読めばpidの使い回しに左右されない。

### 持ち主のpidが使い回された時

持ち主の生死は、まずpidで見る。終了した持ち主のpidを別の生きたprocessが使うと、pidだけでは生きて見える。
そこで、pidが生きて見える持ち主は、初めて見た時に1回、本人かを確かめる。

- processが始まってからの経過（POSIXは`ps -o etime=`、Windowsは`Win32_Process`の開始時刻）を取り、
  lockを作ってからの時間と比べる。経過の方が5秒を越えて短ければ、lockより後に始まった別のprocessと読む。
- 別のprocessと読んだlockは、持ち主が終了したlockと同じ手順で片付ける。消す役は、確かめた時と同じlock
  （中の印が同じ）の時だけ消す。
- OSへ照会できない時は、生きていると読む（誤って片付けるより断る方に倒す）。
- 開始時刻そのものでなく経過で比べる。POSIXの`ps`が出す開始時刻は、time zoneの設定と時計合わせで読みが変わる。
- 照会を払うのは、lockが在って持ち主が生きて見える時だけ（送信が実際に重なった時と、閉じる時にlockが残っていた時）。
  重なっていない送信は払わない。

0.52.1はpidだけで見ていた。使い回された時は、そのprocessが終わるまで`AGENT_SEND_BUSY`が続き、
`pty_close`してもlockが残り、閉じて同じIDで起動し直しても同じ断りだった（0.52.2で直した）。
BellTeamのコンテナのpidは1日半ほどで一巡する（上限4194304、起動から95分で約19万）。長く送っていないsessionで起き得た。

### socketの置き場が無い時

lockはsocketの置き場に作る。置き場ごと無くなっている時（agentの登録だけが残った時）は、lockを作れない。
この時はlockを取らずに先へ進め、送信側の今まで通りの断り（「入力受付状態になりません。文字列は送信していません。」）を返す。
置き場が無ければsessionにも届かないので、守る相手が無い。置き場を作り直す事もしない。

0.52.1はここで`ENOENT`の生のエラーを返していた（0.52.2で直した）。lockの層は、送れない時の断りの文面を変えない。

### 閉じる時

`pty_close`は、このlockが生きていても断らない（送信lockは今まで通り断る）。閉じる側を止めると、
起動直後の入力受付待ちの間、sessionを閉じられなくなる。閉じた後、死んだ持ち主のlock、pidを使い回されて生きて見えるlock、
残った消す役の印を片付ける。画面が無くなったsessionを閉じた時（`already_closed`）も同じ。
本人と確かめた生きた持ち主のlockは残す。その送信は、sessionが無くなった所で失敗して自分のlockを外す。

## 確かめ

本物のCLI（2026-10-05、Linux）。別々のAiterm process 2本から、起動した直後のsessionへ同時に`pty_send`した。

- 直す前（0.52.0）のClaude Code: 1通目は`agent_dispatch`、2通目は上の文面で断り。
- 直した版: Claude Code・Codex・Grok・Cursorの4つとも、1通目は`agent_dispatch`（5.5〜5.6秒）、2通目は`agent_steer`（5.9〜9.7秒）。
  2通の目印が同じ回答に出た。

偽の席の試験は`test/agent-send-serial.test.mjs`。直す前のbuildでは全件が落ちる。

## 採らなかった案

- 呼び手に順番を守らせる。`pty_send`は、呼び手が子の状態を知らないまま呼べる唯一の送信口である。
  BellTeamは自分の側で順に送るようにしたが、他の呼び手と、別のprocessからの送信は残る。
- 印を先に取り、入力受付待ちをその後に回す（Claude Codeだけの直し）。待ちの途中で失敗した時に印を戻す処理が要り、
  Codex・Grok・Cursorの2回貼りは直らない。
- 後の1通を、待たずに断る。断りの文面は変わるが、呼び手が送り直す事は変わらない。
- lockに期限を付け、古いlockを誰でも消せるようにする（pidの使い回しへの手当てとして）。期限を正しく決められない。
  起動時promptは確認画面の数だけ入力受付待ちを繰り返し、Windowsの貼り付けは2分を越え得る。短ければ生きた送信のlockを消す。

## 影響

- `aiterm.pty-send-result.v1`・`aiterm.agent-dispatch.v1`・`aiterm.agent-steer.v1`の形は変えない。
- `AGENT_SEND_BUSY`の断りは、先頭の「`AGENT_SEND_BUSY: agent session '<名前>' は`」と文中の「文字列は送信していません。」を
  連携元（BellTeam）が未送信の見分けに使う。この2か所は試験で留めてある。変える時は連携元へ先に知らせる。
- 消す役の印が残った時の断りは`pty_close`を案内する。`pty_close`がこの印を片付ける事と、画面が無いsessionへの`pty_close`が
  `already_closed`で返る事は試験で留めてある。連携元（BellTeam）はこの断りを見分けていない
  （見分けて起動し直す直しは2026-10-05に取り消された）。この断りを受けたsessionは、誰かが`pty_close`するまで送れない。
- 重なった後の1通は、前の1通が終わるまで返らない。前の1通が起動直後の入力受付待ちなら、その分だけ遅れる。
- socketの置き場に`<name>.agent-send.lock`と`<name>.agent-send.lock.reap`が増える。state schemaは変えない。
  旧版へ戻す時の手当ては要らない（旧版はこのfileを見ない。残っても`pty_close`の掃除の対象外になるだけ）。
- `pty_send(force:true)`・`pty_key`・`claude_approval`・`agent_configure`は今まで通りで、この列に並ばない。
