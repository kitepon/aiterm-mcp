# Aiterm design

## 目的と所有

Aitermは、AIがローカルshell、SSH、container、REPL、別agentの対話TUIを、再接続可能な永続PTYとして
操作するstdio MCP serverである。install、session、state、schema、diagnostics、recovery、releaseは
このrepositoryが所有し、外部の工場管理製品がなくても単独で動く。

## 導入と登録

`aiterm-setup`はglobal packageからだけ実行し、依存準備、公開MCP経由の端末実行、
検出したAIのユーザー設定への登録と読戻しを連続実行する。npm lifecycleでユーザー設定を変更しない。
共通の順序と結果は`src/setup.ts`、公式package managerとOS差は`src/setup-platform.ts`、
各AIの登録形式は`src/setup-integrations.ts`が所有する。既存の他サーバーは保持し、
Claude／CursorのJSONは参照先を原子的に更新して変更前backupを残す。Codex／Grokは公式CLIで登録・確認する。
各AIの読戻しは登録内容の確認であり、端末の実動作はその前の公開MCP試験で確認する。
失敗は理由付きJSONと非ゼロ終了で返す。対応外の自動導入と全AI未検出を成功扱いしない。

## Terminal model

プリミティブはlocal PTYを1つ開き、text／keyを送り、画面を読み、閉じることだけである。
SSHやcontainerを別toolにせず、PTY内で実行するcommandとして扱う。sessionはPOSIXではtmux、
Windows nativeではpsmux 3.3.8以上に保存され、MCP serverやclientの再起動をまたぐ。

`pty_read`は制御文字除去、反復圧縮、head＋tail、command別reducerでcontext量を減らす。
完了はprocess exit、shell sentinel、literal／regex `until`、shell復帰を伴うquiescence、timeoutを区別する。
要求されたsentinel／untilを静止判定より優先し、nested shellで証拠がない状態を完了へ丸めない。
sentinelの方言は端末runtimeが実効shellから決める。SSH先の現在の標準PowerShell promptを
検出した場合は、Aiterm hostのOSに関係なくPowerShell構文を使う。過去のpromptでは切り替えない。

`pty_list`はtextと構造化したsession一覧を返す。`env_keys`は帰属等の非秘密キーの明示照会だけで、
psmuxが出力した余分な環境値を返さない。通常PTYとagentへ`AITERM_SESSION_ID`を注入し、
`env_vars`の継承とsessionへの登録もAitermが所有する。古いtmuxは子へのenv注入とsession登録を使う。

`pty_observe`は存在、pane／harnessの生存、画面状態と理由、native process identityを分ける。
PIDは開始識別子・argv digestと組にし、paneとharnessを同一視しない。特定できないidentityはnull。
POSIXの停止状態はOSのprocess表から取得し、SIGSTOP中は残画面より優先して`blocked/harness_stopped`を返す。
画面本文とargv本文は返さず、活動cursorには画面digestとprocess別CPUだけを持たせる。
初回とpane再作成後の差分はnull。区間中にprocessが消えた時は観測できたCPU増分だけを返し、
`cpu_delta_complete=false`を付ける。background活動はpane開始から60秒以降に生成された子孫だけを数える。
`token_hint`は画面の直近表示であり、usageの累積正本ではない。

## Agent model

標準入口`agent_launch`は`claude-code`、`codex-cli`、`grok-cli`、`cursor-cli`のharnessとmodelを別軸で選ぶ。
harnessがagent loop、認証、hook、session、transcript、model catalogを所有する。Aitermは通常の
project／user環境を置換せず、launch相関と完了回収に必要なstateだけを加える。
Throughlineの補足記憶はpathを透過搬送するだけで、内容、project束縛、context予算はThroughlineが所有する。

agent turnは常に非ブロックdispatchであり、receiptの`event_cursor`がturn境界になる。
Codex親にはAitermのMCP processが完了を観測し、回答本文を公式受信キューへ自動配送する。
それ以外の親には`wait_process`がplatform nativeな別process起動情報を返す。
waiterは純readerで、親のforeground turnを塞がない。
回答はharness所有transcriptから同じturnへ相関して回収し、欠落・曖昧・timeout時にpromptを再送しない。
Grok／Composerの記録先はCLIと同じOS絶対パスへcwdを正規化して導出し、完了通知と回答で同じ関数を使う。
`agent_steer`は実行中のCodex／Grok turnへ追加textを差し込み、idleなら送信せず状態を返す。
Cursorのsubmitはadapterがextended keyboard protocolのEnterへ変換し、呼び出し側は通常のdispatchだけを使う。
起動直後のClaude sessionへの初回dispatchは、他harnessと同じくTUIの入力受付を確認してから貼付とEnterを送る。

### Codex親への自動配送

`src/parent-delivery.ts`が依頼の送信前に宛先と完了境界を保存し、完了観測、加工前の回答保存、配送を所有する。
宛先はCodexのMCP handshakeと各要求の`_meta.threadId`から取得する。modelが指定したIDや環境変数で代用しない。
`src/codex-parent-receiver.ts`は同じ`CODEX_HOME`の公式app-serverへstdioで接続し、`thread/read`と
`thread/queue/list`で宛先を確認した後、`thread/queue/add`へ本文をJSONで渡す。
親のload／resume、Desktop固有通信、子への送信指示、別daemonは使わない。
setupは公式`queue`入口を確認し、各dispatchでは実際の親threadの受入可否を確認する。
native sub-agentを親にした外部queue入力はCodex自身が拒否するため、子への送信前に明示errorにする。

通常結果は親の実行中turnを中断せず、親がidleになった後に処理される。
`parent_delivery`が配送IDと状態を返し、自動配送時の`wait_process`／`wait_command`はnullになる。
`pty_observe`の`parent_deliveries`で状態を確認できる。`submitted`はキュー受付済みを示し、modelの読了を意味しない。
次の依頼へ進める前に前回の回答を保存し、harness所有記録を後の回答と取り違えない。

配送記録と本文はAiterm stateの`parent-deliveries`へ保存する。ownerのPIDと開始識別子で生存を判定し、
再接続後は終了したownerの記録だけを原子的に引き継ぐ。`waiting`は同じ境界から観測を再開し、
`ready`は保存した本文を送る。送信中断は`unknown`として本文を残し、自動再送しない。
受信口が明示拒否した場合は`failed`、子の異常終了はそのoutcomeを配送する。
このstateは既存のPTY／harness stateと独立し、旧版は配送を再開しない。

`trust_project:true`は対象projectの既知のworkspace、hooks、MCP初期同意を起動準備として進める意図である。
promptなしでも入力受付とharness生存を確認して`startup.ready`を返す。指定なしのpromptなし起動は
従来どおり`startup.not_checked`で返す。初手receiptは未要求・未送信・送信済み未確認・開始確認を分ける。
開始の証拠は送信後の実行表示、実行中の既知承認、または同じcursor以降の完了だけとし、残存なしでは代用しない。
Codexの設定エラー等でCLIが終了した場合は、残った画面へ送らず未送信で止める。

`agent_approval`はCodexの現在のcommand／MCP承認を検査し、launch IDを含むdigestと単発の選択へ束縛する。
応答はsend lock内で再観測し、変更・未知・取得失敗では入力しない。Claudeの既存`claude_approval`は維持する。

## Layer ownership

```text
MCP schema (index)
  -> PTY／共通進行 (core)
    -> harness固有 adapter (harnesses)
      -> 相関state (agent-shared／state-root)
        -> multiplexer／OS adapter (tmux-runtime／agent-resolver)
```

harness固有のready、auth、catalog、transcriptは`src/harnesses/`、OSとmultiplexer差は
`src/tmux-runtime.ts`／`src/agent-resolver.ts`／`src/process-runtime.ts`、共通進行は`src/core.ts`に置く。
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
`trust_project`指定なしのpromptなし起動応答はPTYへの起動要求を示し、入力受付の確認は後続の送信時に行う。

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
