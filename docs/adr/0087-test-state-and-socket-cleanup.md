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
