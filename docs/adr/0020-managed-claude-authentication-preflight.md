# ADR 0020: managed Claudeは共有認証を起動前検証し、session内の認証変更を許さない

日付: 2026-08-01

## Status

Accepted。認証preflightとsession内`/login`／`/logout`拒否は現行。関連test 99/99、release full regression 317/317と、独立Node/MCP相当processからの実Fable 3 process×2波
（計6 process）の同時・反復起動、done観測、exact result回収、closeまでgreen。

2026-08-04追補: タイトルと本文の「managed」は当時のlauncher環境を示す歴史語。v0.22.0は通常の
vendor credential／config storeをその場で使い、完了相関stateだけをaitermが所有する。認証契約は維持し、
環境境界は[ADR 0025](0025-shared-agent-environment-and-lineage.md)を正とする。

2026-11-10追補: timeoutは拒否しない。`auth status`が5秒で終わらない時は状態不明のまま起動へ進み、
未認証なら起動後の画面判定（`Select login method:` -> `blocked`/`vendor_onboarding_required`）が止める。
macOSでClaude Codeの更新直後の初回実行（Gatekeeper・ESETの検査）と高負荷（load 700前後）が重なり、
loggedIn:trueの席が`CLAUDE_AUTH_STATUS_TIMEOUT`で起こせなかった（BellTeam a36210f4、2026-11-10 12:07 JST）。
遅いだけの確認で止まる状態には自分で抜ける遷移が無かった。`loggedIn:false`・malformed・失敗exitの拒否は維持する。
`CLAUDE_AUTH_STATUS_TIMEOUT`はこの版の前の端末だけが返す。

## Context

`claude_agent`はlaunchごとのStop hook settingsとPTY stateを隔離する一方、Claude Codeの認証は
vendorが所有する通常のcredential storeを共有する。macOSではClaude Codeが認証をKeychainへ保存する。

従来はCLI・引数・cwdだけをsession作成前に検証し、認証はTUI起動後に初めて判明した。このため
credential storeが未認証・lock・保存失敗の状態でも未認証TUIを複数作成でき、各session内で
`/login`を繰り返す誘因と残骸を生んだ。同一vendorの複数sessionが正常な共有認証を反復利用する
受入も欠けていた。

## Decision

1. 新しいClaude CLIを起動する直前、tmux session作成より前に同じCLIで
   `claude auth status --json`を実行する。timeoutは5秒、stdout上限は64KiBとする。
2. exit 0、JSON object、`loggedIn === true`の三条件をすべて満たした時だけ起動する。
   `loggedIn === false`は未認証として、malformed JSON・失敗exit・timeoutは状態不明として明示エラーにする。
   どちらもsession・agent metadata・event/result fileを作らない。
3. 相関済みpromptless launchのexact replayはCLIを再起動しないため、認証preflightを再実行しない。
   既存receiptの回収可能性を現在の認証状態へ従属させない。
4. 認証正本はClaude Codeに所有させる。Aitermはcredentialを複製・symlink・copy-backせず、
   Keychain／credential fileへ独自lockを足さず、loginを自動実行しない。
5. managed Claude sessionへexact `/login`または`/logout`を送る操作は、通常dispatchと`force:true`の
   どちらもoperation marker・metadata・PTYへ触れる前に拒否する。認証操作は通常端末で一度だけ行う。
6. Claude launcher全体を直列化しない。正常な共有認証の読み取り後は、launchごとのPTY・settings・eventを
   従来どおり独立させ、複数sessionを同時稼働させる。
7. Claude Stop hookはresult→done event→active marker削除の順に永続化する。done event観測直後だけ
   marker削除が未完了になり得るため、回収側は同じmarkerより新しいresultと相関済みdone eventを確認した時だけ
   最大1秒marker cleanupをsettleする。古いresultや新しいturnのactive markerを完了へ丸めない。

## Acceptance

- 未認証、malformed status、失敗exitはいずれもsession作成前に失敗し、残骸ゼロである。
- `loggedIn: true`の共有認証で3 sessionを2波反復起動でき、全session IDとagent metadataが独立する。
- managed Claudeへの`/login`・`/logout`はdispatch／force送信の双方で副作用前に拒否される。
- done event公開直後にactive markerが残る順序を再現し、回収がmarker削除を待ってexact resultを返す。
- 既存の相関済みlaunch replayは認証状態にかかわらず同じreceiptを返し、CLIを再送しない。
- 実Claude Codeで複数Fableを同時起動・完了・closeし、次の波も再認証なしで完了する。

## Verification

- `npm run build`
- `node --test test/core-agent.test.mjs test/launcher-structured.test.mjs test/smoke.test.mjs` — 99/99
- `npm test` — 317/317
- 実Claude Code v2.1.220／Fable 5 low effortで独立Node/MCP相当processを3本同時起動し、
  2波計6 processすべて`outcome=done`、期待markerをexact resultから回収、各波でclose。追加loginなし。

## 根拠

- [Claude Code Authentication](../../rag/sources/safety/claude-code-authentication.md)
