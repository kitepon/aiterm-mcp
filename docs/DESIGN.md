# Aiterm design

## 目的と所有

Aitermは、AIがローカルshell、SSH、container、REPL、別agentの対話TUIを、再接続可能な永続PTYとして
操作するstdio MCP serverである。install、session、state、schema、diagnostics、recovery、releaseは
このrepositoryが所有し、外部の工場管理製品がなくても単独で動く。

## Terminal model

プリミティブはlocal PTYを1つ開き、text／keyを送り、画面を読み、閉じることだけである。
SSHやcontainerを別toolにせず、PTY内で実行するcommandとして扱う。sessionはPOSIXではtmux、
Windows nativeではpsmux 3.3.8以上に保存され、MCP serverやclientの再起動をまたぐ。

`pty_read`は制御文字除去、反復圧縮、head＋tail、command別reducerでcontext量を減らす。
完了はprocess exit、shell sentinel、literal／regex `until`、shell復帰を伴うquiescence、timeoutを区別する。
要求されたsentinel／untilを静止判定より優先し、nested shellで証拠がない状態を完了へ丸めない。

## Agent model

標準入口`agent_launch`は`claude-code`、`codex-cli`、`grok-cli`、`cursor-cli`のharnessとmodelを別軸で選ぶ。
harnessがagent loop、認証、hook、session、transcript、model catalogを所有する。Aitermは通常の
project／user環境を置換せず、launch相関と完了回収に必要なstateだけを加える。
Throughlineの補足記憶はpathを透過搬送するだけで、内容、project束縛、context予算はThroughlineが所有する。

agent turnは常に非ブロックdispatchである。receiptの`event_cursor`がturn境界、`wait_process`が
platform nativeな別process起動情報を返す。waiterは純readerで、親のforeground turnを塞がない。
回答はharness所有transcriptから同じturnへ相関して回収し、欠落・曖昧・timeout時にpromptを再送しない。
`agent_steer`は実行中のCodex／Grok turnへ追加textを差し込み、idleなら送信せず状態を返す。
Cursorのsubmitはadapterがextended keyboard protocolのEnterへ変換し、呼び出し側は通常のdispatchだけを使う。
起動直後のClaude sessionへの初回dispatchは、他harnessと同じくTUIの入力受付を確認してから貼付とEnterを送る。

## Layer ownership

```text
MCP schema (index)
  -> PTY／共通進行 (core)
    -> harness固有 adapter (harnesses)
      -> 相関state (agent-shared／state-root)
        -> multiplexer／OS adapter (tmux-runtime／agent-resolver)
```

harness固有のready、auth、catalog、transcriptは`src/harnesses/`、OSとmultiplexer差は
`src/tmux-runtime.ts`／`src/agent-resolver.ts`、共通進行は`src/core.ts`に置く。
stdio stdoutはJSON-RPC専用とし、diagnostic logを混ぜない。

Aitermはtransport、schema、turn相関だけを検証する。command／prompt本文の意味を分類して拒否せず、
harness所有credentialの内容・権限・linkも検査しない。command policyとcredential policyは、実行する
shell、接続先、各harnessの公式CLIが所有する。

## Failure and recovery

入力が64KiBを超える、送信lockが残る、harnessがblocking UIにいる、model catalogが一致しない等の
境界失敗は明示errorにする。retry、別model、別harness、別backendへ自動fallbackしない。
stale send lockは並行processとのABAを避けるため自動削除せず、公開APIでは対象sessionを`pty_close`して
同じIDで再作成する。全session一括停止は公開しない。

Grok／Composerのread-only sandbox起動拒否は、`src/harnesses/grok.ts`の
`assertGrokSandboxNotRejected`がCLIのエラー表示から検出する。`src/core.ts`の共通入力受付待機は
Grok／Composerの場合だけこの判定を呼び、`GROK_SANDBOX_STARTUP_FAILED`で原因と未送信を返す。
初回prompt付き起動と通常dispatchに適用され、他harnessの入力受付判定には適用しない。
promptなしの起動応答はPTYへの起動要求を示し、入力受付の確認は後続の送信時に行う。

hookパスのシンボリックリンク等を拒否する判断はGrok CLIが所有する。AitermはCLIが出した拒否を伝え、
hookのコピー、設定の置換、sandboxの解除は行わない。原因を設定の管理元で修正した後、対象sessionを
閉じて起動し直す。検出の回帰試験は`test/grok-startup.test.mjs`に置く。

Grok／Composerのmanaged起動は公式`--trust`を渡し、指定cwdの信頼状態はGrok CLIが管理する。
`grokLaunchBlockingDialog`は信頼確認を入力受付から除外し、scrollbackのshell promptを取り違えない。
`grokTuiBusy`は応答中の表示だけを実行中の根拠にし、完了後も残る`[hooks: 成功/失敗]`を含めない。
これらのCLI固有判定は`src/harnesses/grok.ts`が所有し、共通処理は判定を呼び出す。

## Platform contract

- macOS／Linux／WSL2: tmux。
- Windows native: psmux 3.3.8以上、PowerShell 7、harness内部用Git for Windows。
- Windows PowerShell 5.1、PowerShell 6、`cmd.exe`、WSL bridgeへfallbackしない。
- multiplexer serverをまたぐ入力はUTF-8安全な256-byte chunkとdrainで直列化する。

## Diagnostics and local error state

`diagnostics`はread-onlyで、PTY backendとagent dependencyを検査する。runtime error aggregateは
製品所有のlocal stateに固定codeと集約metadataだけを保存し、network I/Oを持たない。工場reporterとの
連携は明示opt-inの任意adapterであり、未設定時もAiterm本体は単独動作する。raw error、prompt、出力、
transcript、path、credentialを保存・公開しない。

## 変更条件

公開schema、完了境界、state ownership、platform backendを変える時は、原因の最小再現、focused test、
関連ADR、日英README、CHANGELOGを同じ変更で同期する。現行制御から外れた完了・棄却・中断・失効・置換済みの設計planはcurrentへ残さずarchiveへ移す。
旧設計draftは[`archive/01_design-plan.md`](https://github.com/kitepon/aiterm-mcp/blob/main/docs/archive/01_design-plan.md)に保存する。
