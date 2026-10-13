# ADR 0087: 試験の保存場所とsocketの削除範囲

2026-10-04、採用。

## 起きた事

BellTeamの席から試験を起動した時、TMPDIRでtmux socketだけを分離しても、親から渡ったAITERM_STATE_BASEが
本番を指したままだった。core.killAllはsocketを終了してからagentsディレクトリ全体を消すため、
別socketの4席のagent.jsonが消えた。pty_sendは文を送った後でmode=sentを返し、BellTeamが
AITERM_DISPATCH_RECEIPT_INVALIDとして失敗させた。消えた登録は対象席の再起動で復旧した。

## 決定

- npm test、文書試験、CI、公開scriptの試験processはtest/seat-env.mjsを読み、席のstate、系譜、tmux環境を引き継がない。
  TEMP、TMP、XDG_RUNTIME_DIRはprocessごとの短い一時領域へ向ける。POSIXはTMPDIRも揃える。
  WindowsのTMPDIRは外して、socketをTEMP、stateをXDG_RUNTIME_DIRで隔離する。個別試験はXDGだけでstateを切り替えられる。
- killAllは終了前にsocketのsession一覧とsocket内の残存ファイルから対象sessionを決める。
  待機lockの保護と登録の削除はその対象だけに行う。agents全体を走査して削除しない。
- 一覧取得やserver終了が通常の「server無し」以外の理由で失敗した時は、登録を消さずエラーを返す。

## 確かめ

2つの試験用socketで1つの試験用stateを共用する。片方のkillAllで、その片方の登録が消える一方、
他方の登録・完了記録・生きた待機lockが残り、sessionがagentとして見分けられることを検証する。
旧版では別socketのagent.jsonが消えてENOENTとなることを確認した。
親の席を模した環境から前処理を読み、継承を外すことと個別試験の保存場所を選べることを検証する。

公開toolの返却形式、登録形式、stateの保存先の通常の選び方は変えない。過去版への巻き戻しでstateの変換は要らない。
同名のsessionを別socketで1つのstateに登録する運用は引き続き対象外とし、試験はstateも分離する。

## 追記（2026-10-13）: 入口を通らずに流された試験file

BellTeamの席で、別の製品の試験の走者へ空の引数が渡り、`node --test ""`がfile systemの根から試験fileを拾って流した（BellTeamのSEC-012）。
この製品の作業ツリーの試験fileも、入口（`npm test`の`--import ./test/seat-env.mjs`）を通らずに、席の環境のまま動いた。

- 0.51.3以前の作業ツリー2つの`killAll`が、席から継いだ`AITERM_STATE_BASE`の登録を全部消した（上の「決定」より前の作り）。
  席が起こし直され、動いていた仕事が19件閉じた。
- 今の`killAll`は消さないが、試験の席の登録（`t1`ほか）が本番の置き場へ書かれて残った。
- 席の環境は、harnessと道具の本物の置き場（`CODEX_HOME`・`GROK_HOME`・`GH_CONFIG_DIR`・`GIT_CONFIG_GLOBAL`）と、鍵も名指ししていた。
  前処理が外していたのは、Aitermの置き場と系譜、tmux、`HOME`とXDGだけだった。製品は`CODEX_HOME`・`GROK_HOME`を`HOME`より先に見る。

決めた事:

1. `test/`の試験fileは、最初のimportで`./seat-env.mjs`を読む。入口の`--import`と同じmoduleなので、入口を通った時は1回だけ評価される。
   製品のmodule（`../dist/…`）より前に評価されるよう、最初のimportに置く。
2. 前処理は、試験へ渡す環境を、要る物だけにする（許可の一覧）。残すのは、OS・端末・道具が動くのに要る物、Nodeと走者の物、CIの入口が渡す物、
   端末の本体とbashの場所を名指しする口（`AITERM_TMUX`ほか）、試験が利用者から受け取る物（`AITERM_TEST_`で始まる変数）。
   残す中でも、名前が鍵の形（`TOKEN`・`KEY`・`SECRET`・`PASSWORD`・`PASSWD`・`CREDENTIAL(S)`・`AUTH`で終わる）の物は外す。
   名前の形だけで外す作りは、形の違う名前の鍵と、席を置いている製品の環境を残すので、やめた。
3. 前処理は、全OSで`HOME`を試験processの置き場の中の空のhomeへ向け、harnessと道具の置き場を、その中に名指しする:
   `CODEX_HOME`・`GROK_HOME`・`CLAUDE_CONFIG_DIR`・`CURSOR_HOME`、XDGの4つ、`GH_CONFIG_DIR`、`GIT_CONFIG_GLOBAL`（空のfile）、npmの`userconfig`と`cache`。
   gitは認証の補助を使わず（`GIT_CONFIG_COUNT`で`credential.helper`を空で上書き）、端末へ問い合わせない。
   外すだけでは足りない。Windowsでは、本物のharnessとnpmが`USERPROFILE`を、ghが`APPDATA`を見るので、名指しが無いと利用者の本物の置き場へ戻る。
4. 前処理は、走者の子（`NODE_TEST_CONTEXT`）が流すfileがこの作業ツリーの外に在る時、そのfileを読み込む前に終了コード1で止める。
   入口から起こした走者が空の引数でよその試験fileを拾っても、よその試験は動かない。
5. CIの入口（`scripts/run-product-ci-tests.mjs`）は、選んだ試験の名前が、空・試験fileの形でない・無いfileの時、組む前に落ちる。
6. CIの入口と`npm test`は、ほかの試験より先に`test/seat-env.test.mjs`だけを流す。落ちたら、ほかの試験は起こさない。
   前処理が効いていない端末で、全部の試験が利用者の置き場に触るのを防ぐ。
7. 一般の試験は、端末に入っている本物のharnessを起こさない。製品は、実行ファイルを、名指しの変数（`CLAUDE_BIN`・`CODEX_BIN`・`GROK_BIN`・
   `CURSOR_AGENT_BIN`）→ 決まった場所（homeの下）→ `PATH`の順で探す。前処理は、4つの変数を、起きたら断って終わる偽物（置き場の中）へ向け、
   同じ名前の偽物を`PATH`の先頭にも置く。偽物は呼ばれた事を置き場の記録へ書き、前処理は、記録が在ればprocessの終わりに知らせて失敗にする。
   偽物を使う試験は、今までどおり自分で変数を立てる。実物のharnessで確かめる試験は、利用者が`AITERM_TEST_`で始まる変数
   （`AITERM_TEST_CODEX_BINARY`ほか）で実行ファイルを渡した時だけ動き、渡されなければ飛ぶ。

及ばない所:

- 古い作業ツリーは防げない。席から見える場所に、0.51.3以前のコミットを出したままにしない。
- よその走者（入口を通らない`node --test`）がこの作業ツリーの`test/fixtures/*.mjs`と`scripts/experiments/*.test.mjs`を拾った時、
  それらは前処理を読まない。どちらも席を開かず、製品の置き場に触らない。
- `npm test -- <引数>`の引数は、走者が受け取る前には確かめない。空の引数で走者がよその試験fileを拾った時は、4が止める。
- Windowsの利用者フォルダの変数（`USERPROFILE`・`LOCALAPPDATA`・`APPDATA`）は差し替えない（ADR 0121）。psmux・PowerShell・npmの本体が見ている。
  psmuxは利用者フォルダの`.psmux`へ端末の控えを書く。WindowsのCursorの実行ファイルは`LOCALAPPDATA`の決まった場所を`PATH`より先に見るので、
  `CURSOR_AGENT_BIN`を外して探し方を確かめる試験は、`LOCALAPPDATA`を自分で立てる。
- 読んだ・書いた事の有無は、製品が決める置き場と、偽の置き場の中身で確かめている。開かれたfileを全部記録する確かめではない（Linuxで手で計ったのはADR 0121）。
- 7は、製品の探し方を通らずに実行ファイルを絶対pathで起こす試験には効かない。`scripts/experiments/codex-stdio-relay.test.mjs`が、
  何も渡されない時にmacOSのDesktop同梱のCodexを名指しで起こす作りだった（一時のhomeと模擬のモデルを使い、ログインは使わない）。
  `AITERM_TEST_CODEX_BINARY`を渡した時だけ動くように直した。`test/`と`scripts/`のほかの試験に、実物のharnessの場所を名指しする物は無い。

確かめ（`test/seat-env.test.mjs`）:

- 全部の試験fileが、最初のimportで前処理を読んでいる。
- 親が偽の置き場（親の席の記録と、試験の席と同じ名前の記録を置いた物）を`AITERM_STATE_BASE`で指し、系譜とtmuxも渡した環境から、
  入口を通さないprocessが席を登録し、閉じ、`killAll`を呼ぶ。偽の置き場の記録は、名前も中身も更新時刻も変わらない。
  試験の席の登録は、process自身の置き場に書かれて消える。子の最初のimportを抜くと「親の置き場へ書かれた」で落ちる。
- 親が、本番に見立てた偽の置き場（各harnessのログインと設定、ghとgitとnpmの設定、席の記録）を、homeと名指しの変数の両方で指し、
  形の違う名前の鍵28個と席の環境を持っている。前処理を通ったprocess（入口つき／最初のimportだけ、の2通り）では、
  親の値が`USERPROFILE`のほかに1つも残らず、製品が決めるharnessと状態の置き場が全部試験の置き場の中で、gitは親の設定と認証の補助を見ず、
  偽の置き場の中身は名前も中身も更新時刻も変わらない。`AITERM_TEST_`の変数は残る。
- 親が、harnessが入っている端末に見立てた偽物を、名指しの変数・homeの決まった場所・`PATH`の全部に持っている。前処理を通ったprocessでは、
  製品の探し方が4つとも置き場の中の断る偽物を返し、変数を外して探しても同じで、返った物を起こしても親の偽物は1つも起きず、
  起こした事がprocessの失敗として出る。7を抜いた前処理では、`PATH`の親の偽物が返って落ちる。
- 作業ツリーの外に置いた試験fileを、前処理つきの走者へ渡す。fileは動かず、走者は失敗で終わる。前処理が無ければ動く。
- CIの入口へ、空の名前・`/`・フォルダ・`..`を含む名前・無いfile・試験fileでない名前・空の一覧を渡す。どれも組む前に終了コード1。
- 手で1回（2026-10-13、Linux）: 一時の置き場を`AITERM_STATE_BASE`に渡し、席の環境のまま、入口を通さずに`core-agent.test.mjs`の2本を流した。
  直した後は置き場が書かれず2本とも通る。最初のimportを抜いた写しでは、置き場に試験の席の登録が残り、1本落ちる。
- 手で1回（2026-10-13、Linux。4つのharnessが入っている席）: 7を入れて全部の試験を流し、断る偽物が呼ばれた回数は0。
