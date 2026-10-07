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

記録する種類は3つ（`src/runtime-error-store.ts`の`RUNTIME_ERROR_DEFINITIONS`）。どれも、Aitermがその端末で動くための前提が欠けて、
呼び出しが失敗した時だけ書く。記録へ進む道は`telemetryOwnedFailure`（`src/errors.ts`）の1本だけ。

| 種類 | 書く時 | 重さ | 重さの根拠 |
| --- | --- | --- | --- |
| `AITERM.PTY_DEPENDENCY_UNAVAILABLE` | tmux／psmuxが見つからない・起動できない・版が古い（`src/tmux-runtime.ts`） | `high` | その端末では、端末もAIの席も開けない。置き直すか設定を直すまで戻らない |
| `AITERM.PERSISTENCE_WRITE_FAILED` | 席の出力の置き場を作れない・書けない・配管できない（`openSession`） | `high` | 出力を読めない席は捨てる。置き場が直るまで、新しい席を開けない |
| `AITERM.VENDOR_LAUNCHER_FAILED` | AIのCLIが見つからない・起動の命令を席へ入れられない（`openAgent`） | `warn` | その種類のAIだけ起こせない。端末とほかのAIは動く |

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
