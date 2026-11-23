# ADR 0102: 通信の失敗と取消は、実行時エラーとして記録しない

状態: 採用。

## 原因

オーナーの指示（2026-10-07。正本はBugHubの`NETWORK_REPORTING.md`、ServerManager `ef578fe`）。

- 通信環境そのものの不調と、その状態へのアプリの対処不良を分ける。
- 通常のオフライン、正常な取消、適切に処理された一時的な失敗を、自動でアプリの欠陥として登録しない。
- 重さは、エラーの値や回数ではなく、実害と、戻れるかどうかで付ける。

Aitermの作りを読み直した（0.57.1）。直す所は無かった。ただし、そうなっている理由がどこにも書かれておらず、
記録する種類を1つ足すだけで崩れる。決まりとして残す。

## 今の作り（変えない）

記録する種類は5つ（`src/runtime-error-store.ts`の`RUNTIME_ERROR_DEFINITIONS`。0.70.106でAI起動の失敗を3つに分けた。下の「追記」）。どれも、Aitermがその端末で動くための前提が欠けて、
呼び出しが失敗した時だけ書く。記録へ進む道は`telemetryOwnedFailure`（`src/errors.ts`）の1本だけ。

| 種類 | 書く時 | 重さ | 重さの根拠 |
| --- | --- | --- | --- |
| `AITERM.PTY_DEPENDENCY_UNAVAILABLE` | tmux／psmuxが見つからない・起動できない・版が古い（`src/tmux-runtime.ts`） | `high` | その端末では、端末もAIの席も開けない。置き直すか設定を直すまで戻らない |
| `AITERM.PERSISTENCE_WRITE_FAILED` | 席の出力の置き場を作れない・書けない・配管できない（`openSession`） | `high` | 出力を読めない席は捨てる。置き場が直るまで、新しい席を開けない |
| `AITERM.VENDOR_LAUNCHER_FAILED` | 席は作れたが、AIの起動の命令を席へ入れられない（`openAgent`の送信。0.70.59の修理の対象） | `warn` | その起動は失敗し、席は残らない。呼んだ側が起こし直せる。端末とほかのAIは動く |
| `AITERM.VENDOR_LAUNCHER_UNRESOLVED` | 起動する実体を決められない: `CLAUDE_BIN`・`GROK_BIN`などの明示指定が、存在しない実体を指す（`resolveAgentBin`が投げる） | `warn` | その種類のAIだけ起こせない。環境の指定を直すまで戻らない。端末とほかのAIは動く |
| `AITERM.VENDOR_CLI_UNAVAILABLE` | AIのCLIが、既定の場所にもPATHにも無い。Windowsのgrokが `grok.exe` でない（`openAgent`） | `warn` | その種類のAIだけ起こせない。導入するまで戻らない。端末とほかのAIは動く |

通信の失敗は、この道を通らない。呼んだ側へ、理由の分かる返りで返す。

- **別端末（SSH）**: `REMOTE_CONNECT_FAILED`、`REMOTE_WAIT_FAILED`、`REMOTE_ANSWER_UNAVAILABLE`。完了待ちの途中でSSHが切れた時は、
  同じ読み位置でつなぎ直す（`observeRemoteAgentDone`）。
- **止めた観測**: `REMOTE_OBSERVE_ABORTED`。
- **AIのCLIが自分のサービスへつながらない**: 席の状態（Grokの`blocked`・`connection_failed`など）と、完了の`outcome`（`error`・`rate_limited`）。
- **起動待ちの時間切れ、認証、model一覧の取得の失敗**: 起動の結果と、エラーの文。
- **BugHubへの送信の失敗**: `delivery_unknown`・`rate_limited`として送信の状態に残す（`aiterm-runtime-errors reporting status`）。
  次のきっかけで、その時点の累計を送り直す（ADR 0079）。

## 決めた事

1. 通信の失敗、取消、待ちの時間切れを、記録する種類として足さない。`timeout`や`Connection refused`といった値、回数の増加を、
   記録の条件にも重さの条件にもしない。
2. これらは今までどおり、呼んだ側へ返す。返りには、何が起きたか（つながらない・止めた・時間切れ）と、Aitermがどうしたか
   （送っていない・つなぎ直した・待ちを止めた）が分かる文か状態を載せる。
3. 通信が失敗した時のAitermの対処が悪い（結果を取り違えて返す、入力を失う、二重に送る、戻れない）と分かった時は、
   製品の不具合として担当が直す。自動の記録には頼らず、調べた記録と担当の報告で扱う。
4. 記録する種類を足す時は、(a) 通信の値・取消・時間切れではない事、(b) 起きた時の実害、(c) 自力で戻るか、を書いてから足す。
   重さは(b)と(c)で決める。`test/runtime-error-store.test.mjs`が、種類と重さの一覧を留める。
5. BugHubへ送る本文の形は変えない。契約に無い項目を足さない。

## 追記（a532、0.70.106）: AI起動の失敗の3つの出どころを、別の種類にする

きっかけ: 2026-11-21 19:45 JSTにMacで `AITERM.VENDOR_LAUNCHER_FAILED` が1件増えた（件数269、版0.70.90）。この種類は、出どころが3つ
（実体を決められない・CLIが無い・起動の命令を入れられない）あり、記録には固定の文面しか無いので、どれか分からなかった。
修理した0.70.59は3つ目だけを直したので、増えたのが修理の対象かも判別できなかった。

決めた事（上の決めた事の4に従う。5のとおり、BugHubへ送る本文の形と項目は変えない。種類を足すだけ）:

| 種類 | (a) 通信・取消・時間切れではない | (b) 実害 | (c) 自力で戻るか | 重さ |
| --- | --- | --- | --- | --- |
| `VENDOR_LAUNCHER_UNRESOLVED` | 環境の指定が存在しない実体を指す | その種類のAIだけ起こせない | 戻らない。指定を直す | `warn` |
| `VENDOR_CLI_UNAVAILABLE` | CLIが無い・向きが違う | その種類のAIだけ起こせない | 戻らない。導入する | `warn` |
| `VENDOR_LAUNCHER_FAILED`（意味を狭める） | 席へ命令を入れる所の失敗 | その起動だけ失敗。席は残さない | 呼んだ側が起こし直せる | `warn` |

指紋は種類ごとなので、新しい2つは新しい案件になる。今までの `VENDOR_LAUNCHER_FAILED` の履歴（件数269まで）は、3つの出どころが混ざったまま残り、
どの出どころだったかは遡れない。以後の増えは、種類で出どころが分かる。

## 及ばない所

- 重さは種類ごとの固定で、記録の後に自力で戻ったかは見ない。記録は`resolve`されるまで`open`のまま残る。psmuxの起動の確かめが
  時間切れになった時（端末が重い時）も、`high`で残る。通信の話ではないので、ここでは変えない。戻った印を自動で付けるなら、
  解決の理由（今は`operator_resolved`だけ）を足す事になり、BugHubの契約の相談が要る。
- Codexの番が、サービスの誤り（500・401・途中で切れる応答）で終わった時、完了は`done`・空の回答として返る
  （利用上限だけが`rate_limited`）。上の3に当たる不具合で、別に直す。

## 確認

- 記録を書く呼び出しは、`src/tmux-runtime.ts`と、`src/core.ts`の`openSession`・`openAgent`だけ。`src/remote.ts`、`src/harnesses/`、
  `src/runtime-error-report.ts`からは書かない。
- 試験: 別端末へつながらない時（`REMOTE_CONNECT_FAILED`）と観測を止めた時（`REMOTE_OBSERVE_ABORTED`）は、記録へ進む型のエラーにならない
  （`test/remote.test.mjs`）。BugHubへ送れなかった時、記録の件数と回数は増えない（`test/runtime-error-report.test.mjs`）。
