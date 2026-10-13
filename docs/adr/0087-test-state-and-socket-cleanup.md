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

BellTeamの席で、別の製品の試験の走者へ空の引数が渡り、`node --test ""`がfile systemの根から試験fileを拾って流した。
この製品の作業ツリーの試験fileも、入口（`npm test`の`--import ./test/seat-env.mjs`）を通らずに、席の環境のまま動いた。
0.51.3より前の作業ツリー2つの`killAll`が本番の登録を全部消し、席が起こし直されて、動いていた番が切れた。
今の`killAll`は消さないが、試験の席の登録（`t1`ほか）が本番の置き場へ書かれて残った。

- `test/`の試験fileは、最初のimportで`./seat-env.mjs`を読む。入口の`--import`と同じmoduleなので、入口を通った時は1回だけ評価される。
  製品のmodule（`../dist/…`）より前に評価されるよう、最初のimportに置く。`test/seat-env.test.mjs`が全部の試験fileで確かめる。
- 古い作業ツリーは防げない。席から見える場所に、0.51.3以前の作業ツリーを置いたままにしない。

