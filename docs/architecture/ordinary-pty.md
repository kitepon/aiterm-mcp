> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 通常PTYの受付・入力・待機・表示

基準ce575ce8。[現在図](ordinary-pty.svg) / [PNG](ordinary-pty.png)、[core全関数対応](source-index.md)。`src/core.ts`全8675行の初読を完了した。agent turn・親配送の完了とは別に、通常PTYの保持契約を記録する。実席操作・試験は行っていない。

## 所有と返却先

| 責任 | 実関数・保存状態 | callerへ戻すもの・作用 |
| --- | --- | --- |
| 通常session作成 | `openSession` / `openSessionInternal`（core 987–1140付近）、tmux-runtime | env名・session名を検証しnative作成。既存の保存会話席を新規PTYで上書きしない。作成時の特定失敗では自分が作った席を片付ける |
| 入力の前処理 | `prepareSendText` / `splitAgentPreface` / `splitPtyText` | raw/control処理、UTF-8 codepointを切らない256byte分割、64KiB上限。prefaceは本文と別の打鍵になる場合がある |
| 入力直列化・境界 | `send` / `acquireSessionSendFileLock` / `withAgentNativeOperation` | 同sessionのordinary send lock、各作用直前のadmission。managed Claudeは通常sendを拒否し専用operationを保持 |
| 入力作用 | POSIX load-buffer/paste-buffer、Windows direct worker | load/paste途中の失敗とEnter失敗を区別。先行chunkやprefaceが入った可能性は消えない。自動再送しない |
| 待機 | `waitCompletion` / mark file / log size / foreground | is_complete、timeout、nested、dead、quiescent、command rc。処理成功、agent完了、画面反映とは同値でない |
| 読取と表示 | `readOutput` / offset / `stripControl` / `reduceOutput` / `rtk.ts` | delta読取・offset更新とscreen読取を区別。raw、8MiB上限、ANSI/control/CRと表示縮約を保持 |
| 一覧と終了 | `listNativeSessions` / `listSessionsResult` / `closeSessionInternal` | nativeと保存会話席を併記。登録envキーだけを公開。一覧のagent_done=trueは管理方式であって現在turnの完了でない |

正確な各関数の開始行・本体範囲・静的callerは対応表を参照する。MCPの入力schema、結果整形とisErrorは`src/index.ts`が所有し、CLI callerはcoreの例外を各入口へ返す。

## 入力と途中失敗

`send`はcontext/session存在と初手pendingを確認してからordinary send lockを取る。lastcmdは任意の`rtk rewrite`より前の入力で記録される。markを使う場合はrandom IDとshell用sentinelを作り、作用前にmark IDを保存できなければ拒否する。fish/csh/tcshのmarkは拒否する。変換後もbyte上限を検査する。

POSIXはbracketed paste全体をchunkで投入し、chunkごとに固有bufferをload→作用直前検証→paste→短い間を置く。失敗時はbufferを片付けるが、入った前半本文を戻す契約はない。本文が貼られた後のEnter失敗も、本文の再送案内に変えない。WindowsのAUTH/command応答とpartial可能性は[native runtime](native-runtime.md)へ接続する。lockはfinallyで解放し、解放時はtoken一致だけを削除する。

ordinary sendの死んだlockは一覧probeから自動unlinkしない。ABAで他ownerの新lockを消すことを避け、拒否して対象sessionのclose後のcleanupへ委ねる。一方agent sendのqueue/agent-send.lockは専用reap guardと出生/時刻照合を持つ。両者を単一のstale-lock回収規則へ丸めない。

## 完了の強さと画面

`waitCompletion`はperformance時計のdeadline内で、開始offset以降のlogを読み、mark→until→生死/静止とforegroundを判定する。markは32hex ID一致とrcを読む（legacy `1`の互換も保持）、同一内容の時だけ消す。untilはliteralまたは有効regexで、command echoにも一致し得る弱い条件である。mark成立は実行終了の記録で、rc=0の保証ではない。

増加中はsession存在probeを省く。増加なしでsession不在ならdead、2回静止後にforegroundを見てlog sizeを再検査する。通常shellへ戻り新規出力があればquiescent、nested foregroundならnestedとして未完了を返す。foreground欠測は正常完了へ丸めず待ち/timeoutへ戻る。Windows log遅延のsettleと画面の更新は別の観測である。

`reduceOutput`は既読表示をblank/run圧縮、長い出力の先頭30/末尾20行、長行の先頭1200/末尾600文字等へ縮める。rawの保持、親への回答返送、harnessの完了正本を変更しない。`rtk.ts`の読取縮約と`send({rtk:true})`の外部rewriteは別の責任として図示した。

関連する試験入口は`core-pure`、`core-readoutput`、`core-tmux`、`session-environment`、`session-list-launch`、`windows-shell-submission`、`psmux-send-worker`、`pty-observation`、`rtk`等。変更窓口が決まってから全caller/fixture/exportを照合する。今は試験の全精査・実行結果ではない。

## A2の所有者

表示の純粋な8関数と専用定数は`src/pty-output.ts`へ移した。`core.stripControl`/`core.reduceOutput`の既存exportを保持する。ANSI_RE/CTRL_REは入力のprepareSendTextも同じmoduleから参照し、入力処理本体は移動していない。`rtk.ts`の意味別縮約・送信UTF-8境界・native/完了判定は既存所有者に残る。この図の編集正本は候補repoの`docs/architecture/ordinary-pty.dot`、旧diagramsはsymbolic link。
