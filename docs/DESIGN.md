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
global packageは、npmの現在のglobal rootか、実行中のNodeの既定のglobal rootにあるものを指す。
CodexとGrokは登録が同じなら公式CLIで作り直さない。`aiterm-setup --hooks-only`はClaude Code・Cursorの親配送hookだけを登録し、
依存準備、端末の実動作確認、MCP登録、Codex Steerに触れない。判断はADR 0077。

## Terminal model

プリミティブはlocal PTYを1つ開き、text／keyを送り、画面を読み、閉じることだけである。
SSHやcontainerを別toolにせず、PTY内で実行するcommandとして扱う。sessionはPOSIXではtmux、
Windows nativeではpsmux 3.3.8以上に保存され、MCP serverやclientの再起動をまたぐ。

sanitize済みの複数行は、POSIX shellでもPowerShellでもscript全体を取り込んでから記述順に実行する。
`src/tmux-runtime.ts`が改行を持たない1回の入力へ適合させ、POSIXは`eval`、PowerShellは
UTF-8のBase64を復元したscriptblockのdot-sourceを使う。変数と作業場所は現在のshellに残す。
生LFをPowerShellへキー入力として流さないため、Windowsの`Ctrl+Enter`による行順の反転を防ぐ。
単一行、`raw:true`、非shell前面は直接PTYへ送る。`enter:false`では後続のEnterまで実行しない。

`pty_read`は制御文字除去、反復圧縮、head＋tail、command別reducerでcontext量を減らす。
完了はprocess exit、shell sentinel、literal／regex `until`、shell復帰を伴うquiescence、timeoutを区別する。
要求されたsentinel／untilを静止判定より優先し、nested shellで証拠がない状態を完了へ丸めない。
sentinelの方言は端末runtimeが実効shellから決める。SSH先の現在の標準PowerShell promptを
検出した場合は、Aiterm hostのOSに関係なくPowerShell構文を使う。過去のpromptでは切り替えない。

`pty_list`はtextと構造化したsession一覧を返す。`env_keys`は帰属等の非秘密キーの明示照会だけで、
psmuxが出力した余分な環境値を返さない。通常PTYとagentへ`AITERM_SESSION_ID`を注入し、
`env_vars`の継承とsessionへの登録もAitermが所有する。古いtmuxは子へのenv注入とsession登録を使う。

新しい端末の環境は、その端末を開いたprocessの環境にする（ADR 0081）。tmuxはserverを起こしたclientの環境を
全sessionへ配るので、`new-session`の間だけ`update-environment`を差し替えてclientの環境をsessionへ写し、
共通環境にしか無い変数はsessionで消す。`AITERM_SESSION_ID`・`AITERM_AGENT_*`・`TMUX`・`TMUX_PANE`は継がない。
sessionの表には環境が丸ごと入るので、名指しで登録した名前をsessionのoption `@aiterm_env_keys`に控え、
`env_keys`はその名前だけを返す。psmuxは元から端末ごとに呼び出し元の環境を継ぐ。

`pty_observe`は存在、pane／harnessの生存、画面状態と理由、native process identityを分ける。
PIDは開始識別子・argv digestと組にし、paneとharnessを同一視しない。特定できないidentityはnull。
同じlaunchに属するnpm shimとnative本体は、中間の非候補processも含めた祖先関係から一つの起動として扱う。
祖先を共有しない候補は別々に残し、複数候補を一つと推測しない。
POSIXの停止状態はOSのprocess表から取得し、SIGSTOP中は残画面より優先して`blocked/harness_stopped`を返す。
sessionを閉じると失うものは数で返す（ADR 0080）。`activity.post_startup_process_count`は起動完了の時点に居なかったprocessの数、
`pending_child_deliveries`はそのsessionが親として待つ未配送の数。数えられない時はnullで、0と区別する。
harnessと中継が自分のために立てるprocessは数えない（Codexの`codex-code-mode-host`、中継`mcp-lazy`の直接の子。ADR 0082）。その下は数える。
harnessが同じ親の下に同じargvで立て直した起動時のprocessも数えない（ADR 0083）。
Aitermがprocess表を引くために起こしたprocess（`ps`、WindowsのPowerShellと付いて立つconsole host）も数えない（ADR 0084）。
中継の後ろで眠っている本体を配送の引き取りのために起こすかは、`aiterm-delivery-wake`が返す（ADR 0082）。
Claude Codeの入力待ちは、起動時の見出しが取得範囲から流れ出た後も、入力欄の形（`❯`行の上下の罫線）で読む。
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
Codex親にはAitermのMCP processが完了を観測し、選択設定に応じて公式Steerまたはqueueへ本文を自動配送する。
Claude Code親は公式の非同期hookで本文を受け取り、待機中も新しいturnへ進める。
それ以外の親には`wait_process`がplatform nativeな別process起動情報を返す。
waiterは純readerで、親のforeground turnを塞がない。
回答はharness所有transcriptから同じturnへ相関して回収し、欠落・曖昧・timeout時にpromptを再送しない。
Grokの記録先はCLIと同じOS絶対パスへcwdを正規化して導出し、完了通知と回答で同じ関数を使う。
配送用のGrok回答は`turn_ended.ts`から同じturnの`turn_started.turn_number`を取得し、
`chat_history.jsonl`の`user.prompt_index`と相関する。次turnが既に始まっていても対象回答だけを回収する。
agent sessionへの送信口は`pty_send`だけとする。子の状態は呼び出し側に選ばせず、Aitermが送る時点の画面で振り分ける。
状態を見てから呼ぶまでの間に子のturnが変わるため、呼び出し側が入口を選ぶ形では外れる。
実行中なら現在のturnへ追加textを差し込み、新しい完了境界と配送は作らない。完了境界は差し込み後も1つに保つ。
Claude Codeはtool処理中に画面の実行中表示が消え、Stop hookの実行中には表示が残る。turnの印を実行中判定の正本とする。Stopが発火しないAPIエラー終了では、次の送信時に印の作成後の会話記録にある`isApiErrorMessage`を確認し、終了したturnの印だけを解除する。過去のエラーで新しい印を解除しない。waiterは印を変更せず、読取専用のままエラーを返す。
それ以外は新しいturnとしてdispatchする。
CodexとClaude Codeは次のtool境界で同じturnへ取り込む。Cursorは「follow-ups」枠へ入った文を「enter steer」で現在turnへ移し、`turn_ended`は最後に1回書く。
待ち行列の表示は5秒待ち、子のturnが続いている間だけ30秒まで延ばす（表示が遅い端末がある。turnが終わっていれば、文は新しいturnとして始まっている）。
Grokは待ち行列へ入れた後に「send now」を押す。旧turnは`cancelled`（`cancellation_context.trigger=send_now`）で閉じ、
新turnが作業を継ぐので、完了判定はこの継ぎ目を完了と数えない。Grokが待ち行列へ入れない時とCursorの入力欄に本文が残る時は`steered`を返さない。
Cursorのsubmitはadapterがextended keyboard protocolのEnterへ変換し、呼び出し側は通常のdispatchだけを使う。
起動直後のClaude sessionへの初回dispatchは、他harnessと同じくTUIの入力受付を確認してから貼付とEnterを送る。

### 親配送の共通モジュール化（設計）

共通化の正本は、正常稼働しているAitermの親配送実装と挙動である。他製品との差分はAitermへ揃える。
親の識別、配送、hook、配送固有state、導入・診断を独立packageへ抽出し、各製品が通常の依存として使う。
各製品の完了観測・本文作成・job台帳は各製品に残し、hook登録と保存場所も製品ごとに維持する。
実装・移行は未実施であり、以下に記す現行契約はそのまま有効である。
公開API、抽出元、移行と受入条件は[ADR 0073](https://github.com/kitepon/aiterm-mcp/blob/main/docs/adr/0073-parent-delivery-module.md)に定める。

### Codex親への自動配送

`src/parent-delivery.ts`が依頼の送信前に宛先と完了境界を保存し、完了観測、加工前の回答保存、配送を所有する。
宛先はCodexのMCP handshakeと各要求の`_meta.threadId`から取得する。modelが指定したIDや環境変数で代用しない。
単品導入の`src/codex-parent-receiver.ts`は同じ`CODEX_HOME`の公式app-serverへstdioで接続し、
`thread/read`と`thread/queue/list`で宛先を確認してから`thread/queue/add`へ本文をJSONで渡す。
Steerを選択した端末（macOS・Windows・Linux。Desktop同梱のCLI、無ければ通常のCodex CLI）でも配送の入口は公式キューとする。
`src/codex-parent-hooks.ts`の同期`PostToolUse`がAitermの回答を同じターンの文脈へ渡し、
`Stop`が最終応答の生成中に届いた回答で同じターンを継続する。
取り込まれていない回答は公式キューに残り、親がidleになった時に通常配送される。終了後の再開には約10秒かかる場合がある。
親を別processでload／resumeせず、modelや権限のoverrideを渡さない。native sub-agentは自動配送の親にしない。

`src/codex-hook-state.ts`は同じCodex home・thread・配送UUID・本文hashへの所有記録を保持する。
キューの全ページを読んでから所有分を取り出し、他の利用者入力には触れない。
同時hookの取得は本人専用ディレクトリ内の排他的hard linkで一つに決め、公式の削除結果がtrueの本文だけを出力する。
削除中はprocess開始識別子を記録する。中断と出力失敗は`unknown`で本文を残し、自動再送しない。
`parent_deliveries`はその状態と`CODEX_HOOK_DELIVERY_UNCONFIRMED`を表示する。
`emitted`はhookへの出力完了でありmodelの読了ではない。公式キューが先に通常配送した入力の所有記録は次のhookで整理する。

`aiterm-setup --codex-steer enable|disable|status`は`src/setup-codex-hooks.ts`が所有する。
`CODEX_HOME/hooks.json`の他の登録を保持し、専用の同期hookを追加する。
再導入ではAitermの既存の登録位置を保ち、内容が同じならhook設定を変更しない。
hookコマンドはCodexが使うshellで評価される。Windowsでは引用したPowerShell 7の実行パスを
呼出し演算子`&`で起動し、標準入出力と終了コードを保持する。回答の取得・配送処理はOS間で共通とする。
公式`hooks/list`から得た2件のkeyとhashだけを公式`config/batchWrite`で承認し、再読して有効・承認済みであることを確認する。
承認省略flagを恒久設定へ書かない。利用者の別hookを承認しない。
選択と配送の所有記録は`~/.config/aiterm-mcp/codex-parent-hooks/`に置く。
Nodeは`src/setup-node.ts`でHomebrewの同じformulaの`opt`へ正規化し、更新で消えるCellar実体を保存しない。

新規の起動差し替えは作らない。旧中継の設定は新しいhookの確認後に従来の解除処理で復元する。
macOSの専用LaunchAgent、Windowsのユーザー環境変数、所有外の値の保持は旧adapterが担う。
旧中継の互換読取りと移行用コードは残し、setupを実行するまでは旧設定の配送を維持する。
移行が中断した場合は保存済みの所有情報を使って次のsetupで継続し、未完了をreadyにしない。
有効化前から動いている公式processのPIDと開始識別子を保存し、それが残っている間はrestart_requiredとする。
`ready`は公式APIによるhook登録・承認の読戻しと、更新前processの終了を確認した状態である。
Codexの通常起動はAitermのNode、module、socketに依存しない。
Windowsでは公式Desktopが展開した実行ファイルを照合して配送用の公式APIへ接続する。Desktop更新後はsetupで再検出する。
WindowsのSteer領域は所有者とDACLだけを.NETのFileSystemAclExtensionsで更新する。監査ACLは変更せず、
再実行にSeSecurityPrivilegeを要求しない。所有者の照合と更新後の読戻しは維持する。
LinuxのSteer選択はunsupportedとし、単品のキュー配送は全対応OSで維持する。

`parent_delivery`は配送IDと状態を返し、自動配送時の`wait_process`／`wait_command`はnullとなる。
`submitted`は公式キューの受付またはhook出力の完了を示す。キューIDはSteer相当の選択時も保持する。
長いStop継続入力はCodex自身のhook処理で抜粋と全文ファイルへの参照になる場合がある。
次の依頼へ進める前に前回の回答を保存し、harness所有記録を後の回答と取り違えない。

Codexの配送記録と本文はAiterm stateの`parent-deliveries`へ保存する。ownerのPIDと開始識別子で生存を判定し、
再接続後は終了したownerの記録だけを原子的に引き継ぐ。`waiting`は同じ境界から観測を再開し、
`ready`は保存した本文を送る。送信中断は`unknown`として本文を残し、自動再送しない。
受信口が明示拒否した場合は`failed`、子の異常終了はそのoutcomeを配送する。
生存の確認は5秒おきにpidの存在だけをOSへ聞き、開始識別子の照合は初めて見たownerと60秒に1回だけ行う。
全processの一覧は取らない。終了直後に同じpidが再利用された時だけ、引き継ぎが最長60秒遅れる（ADR 0078）。
pidが別のprocessへ使い回されたownerと、pidは居ると出るがprocess表に無いownerは、回収側が`owner.json`を`closed`へ書き換え、照合を繰り返さない。
process表にはあるが開始時刻を読めないownerだけ、60秒に1回問い合わせる（ADR 0086）。
記録を引き継ぎ終えた保存場所は、自分で閉じたownerとpidの無いownerのものを消す。保存場所が消えても読める印（`removal_safe`）の無いownerが
同じ置き場で生きている間は消さない（ADR 0084）。
このstateは既存のPTY／harness stateと独立し、旧版は配送を再開しない。

### Claude Code親への自動配送

`aiterm-setup`はClaude Code 2.1.259以上を確認し、ユーザー設定へAiterm専用の`PreToolUse`、
`PostToolUse`、`SessionEnd`を追加する。他製品のhookと設定は保持し、`disableAllHooks`の解除は行わない。
hookはNodeの実行ファイルと引数配列で直接起動し、shellやWindowsのnpm shimを介さない。

`PreToolUse`の`tool_use_id`／`session_id`とMCP要求の`_meta["claudecode/toolUseId"]`を照合する。
起動時のsession環境変数は`/clear`で古くなるため宛先に使わない。hookがない場合と`agent_id`付きの会話は
子への送信前に明示errorにする。親がIDや待機方法を引数で指定する必要はない。

本文の保存と同じ子への連続依頼の制御は`parent-delivery.ts`を共有する。Claude用記録は
`claude-parent-deliveries`へ分け、旧版のCodex readerに未知のparentを読ませない。
子の予約は既存の`parent-deliveries/claims`で共有し、親の種類をまたぐ並行送信を防ぐ。
hookとの受け渡しはAiterm stateの`claude-parent-hooks`へ置く。

`PostToolUse`は`asyncRewake:true`で待機し、保存済み本文をstderrへ出してexit 2を返す。
exit 2はClaudeが規定する再開信号であり、子の成功・失敗は本文の`outcome`で区別する。
親は待機中も別作業や次のturnへ進める。Claudeの画面では`Stop hook feedback`として届く。
`submitted`はhookへの本文出力を確認した状態であり、modelの読了を示さない。
hook出力の切断・中断は`failed`または`unknown`とし、本文を残して自動再送しない。

`SessionEnd`はその会話の未送信の依頼を終了させる。`/clear`後の新しい会話へ古い回答を出さず、
確定本文は保存する。受信hookのtimeoutは24時間であり、timeoutとprocess終了は配送失敗として観測する。
CLIを終了した後に自動再開するdaemon、Channelsの有効化flag、子の返送コマンドは使わない。
hookを持たない旧版へ戻す時は、install前に`aiterm-setup --remove-claude-parent-hooks`で専用hookだけを解除する。

Claude Desktopのチャット、Web、`agent_id`付きの会話（`--agent`で選んだ主会話とnative subagent）は
この受信契約の対象に含めない。
対応対象は公式command hookとMCP metadataを提供するClaude Codeの対話sessionである。

Claudeの起動metadataには指定cwdの実体パスを保存する。Claude Codeが実体パスから作るproject slugと
APIエラー監視の参照先を一致させ、監視中のリンク変更で保存場所を取り違えない。

### Cursor親への自動配送

`aiterm-setup`は`~/.cursor/hooks.json`へAiterm専用の`afterMCPExecution`と`postToolUse`を追加する。
他製品のhookと順序は保持し、`command`に`cursor-parent-hook.js`を含むentryだけを更新する。
親の識別はMCP `initialize`の`clientInfo.name`が`cursor-vscode`（またはその後ろに空白を挟む派生名）であることだけで、
会話IDはMCPの`_meta`に来ない。hook未登録は子への送信前に`CURSOR_PARENT_HOOK_UNAVAILABLE`で止め、waiterへ切り替えない。

`afterMCPExecution`またはdispatch toolの`postToolUse`が、tool返りの`parent_delivery.delivery_id`とhook入力の
`conversation_id`を結ぶ。`delivery_id`は`structuredContent`か、`content`のtextをJSONとして読んだ中から取る。
完了観測と本文保存は`parent-delivery.ts`が所有し、記録は`cursor-parent-deliveries`へ分ける。子の予約`claims`は共有する。

親が次のツールを呼ぶと`postToolUse`が未受領の本文を`additional_context`で会話へ差し込む。
親がターンを終えている場合は、receiptの`wait_process`で起動した`cursor-parent-receive`が本文をstdoutへ出して終了する。
`wait_command`はnull。受け取りは`claim.json`の排他作成で一つに決め、hookと受け口の両方へ本文を出さない。
`submitted`はどちらかがclaimした状態であり、modelの読了ではない。24時間以内にclaimが無ければ`failed`とし、
本文は残して自動再送しない。Cursor Cloud Agent／Background Agentはこの受信契約に含めない。

hookを外す時は`aiterm-setup --remove-cursor-parent-hooks`で専用entryだけを解除する。

`trust_project:true`は対象projectの既知のworkspace、hooks、MCP初期同意を起動準備として進める意図である。
Claude Codeの初回テーマ選択は選択済みの項目を確定し、後続の起動準備へ進める。
ログイン方式の選択はユーザーのアカウント設定として扱い、composerと誤認せず`vendor_onboarding_required`で止める。
promptなしでも入力受付とharness生存を確認して`startup.ready`を返す。指定なしのpromptなし起動は
従来どおり`startup.not_checked`で返す。初手receiptは未要求・未送信・送信済み未確認・開始確認を分ける。
入力受付の待ちは30秒。画面が起動コマンドの表示のまま（agentがまだ何も描いていない）で切れた時だけ、
起動から50秒まで待つ。Codex親の既定のtool timeout（60秒）の内側に収める（ADR 0078）。
開始の証拠は送信後の実行表示、実行中の既知承認、または同じcursor以降の完了だけとし、残存なしでは代用しない。
Codexの設定エラー等でCLIが終了した場合は、残った画面へ送らず未送信で止める。

`agent_approval`はCodexの現在のcommand／MCP承認を検査し、launch IDを含むdigestと単発の選択へ束縛する。
応答はsend lock内で再観測し、変更・未知・取得失敗では入力しない。Claudeの既存`claude_approval`は維持する。

### 別端末の子（`remote`）

`src/remote.ts`が所有する。`remote`付きの呼び出しは、`ssh <host>`で現地の`aiterm-mcp`を起動し、
同じtoolをMCPのままSSHのstdioへ中継する。sshdが起動するshellの系統は、どのshellでも実行できる
`echo aiterm-probe %OS% $PSHOME`の展開結果で最初に見分け、MCP processの間だけ覚える。cmdは`%OS%`を、
PowerShellは`$PSHOME`を展開し、POSIX系はどちらも展開しない。POSIX系では利用者のログインshellから
`env`のPATHだけを受け取り、処理は`/bin/sh`で行う。profileの出力やfish等の文法差をMCPのstdoutへ持ち込まない。
WindowsはユーザーのPATHで`aiterm-mcp`と`aiterm-wait`をそのまま呼ぶ。起動、hook、transcript、multiplexerは現地のAitermが所有し、
呼び出し側は結果を返すだけにする。現地にポートは開けない。

接続先はtool引数で毎回受け取り、Aitermは一覧も既定値も持たない（オーナー裁定 2026-09-26。管理まで持つと重くなるため）。
配送記録には、パスフレーズ本文を除いた接続情報だけを残す。平文のパスフレーズはMCP processのメモリにだけ置き、
`SSH_ASKPASS`でsshへ渡す。受け取っていない時は`BatchMode`で止め、端末での対話入力はしない。
同じ接続先への呼び出しはControlMasterで1本のSSHに相乗りする。

POSIXの共有ソケットは`/tmp/aiterm-ssh-<state rootのSHA-256先頭20桁>/cm-%C`に置く。
TMPDIRやXDG_RUNTIME_DIRが長くても、OpenSSHが作成時に付ける17字のsuffix込みで98 bytesとなり、
macOSの104 bytes制限に収まる。state rootごとの分離とprocess間の共有を維持し、askpassと配送記録の場所は変えない。
共有`/tmp`の既存領域は、自分所有の0700ディレクトリだけを使い、それ以外は`REMOTE_CONTROL_DIR_INVALID`で止める。
ソケットの寿命と削除は従来どおりOpenSSHの`ControlPersist=600`が所有する。判断はADR 0076。

自動配送は`ParentDeliveryManager`を別インスタンスで使い、記録を`remote-`付きの保存場所へ分ける。
旧版のreaderは`boundary.remote`を知らないため、同じ保存場所に置くと旧processの照会が壊れる。
子の予約と照会の単位は`deliveryKey`で、接続先のhashを前置きして、この端末の同名sessionと衝突させない。
完了は現地の`aiterm-wait`で観測し、ssh自身の失敗（exit 255）では同じcursorで観測し直す。
現地の`aiterm-wait`が失敗を返した場合はつなぎ直さずに失敗とする。回答は現地の`pty_read(agent_transcript:true, raw:true)`から取り、
完了と別のturnの本文は配送しない。起動と送信は現地で済んだ後に配送を登録するため、送信前に前回の本文を確保する。

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

## Model catalog

`agent_auth`の共通進行はcore、公式command・status・認証画面の解釈は`src/harnesses/`が所有する。CLIの認証processを通常HOMEのPTYへ一度だけ起動し、`remain-on-exit`と`pane_dead_status`で終了を観測する。credentialを読み取る状態管理や独自OAuthは持たず、Aitermが保存するのは認証sessionのharness・実行file・cwd・phase・引き継いだenvの名前だけである。取消と通常のPTY closeでこの相関記録を削除する。

PTYが消失した場合は、相関記録の有無にかかわらず`status`が`failed`、`cancel`が既に終了・取消済みを示す`blocked`を返し、どちらも`session_id:null`となる。保存したsession IDを解除して`start`で再開始できる。生存中の通常PTYやharness不一致、記録の破損・読取り失敗はエラーを返す。

Claude／Codex／Cursorは公式statusを照合する。Grokは公式status commandが無いため、認証sessionの公式login exit 0を正本にし、session無しの確認を`blocked`とする。Claudeはlogin完了後に同じPTYへ公式の初回TUIを用意し、初回案内の入力待ちを`blocked`／`input_required:true`へ写す。認証とlauncherの起動準備は別の結果であり、`agent_launch`のready gateを省略しない。

公開receiptは`aiterm.agent-auth-result.v1`で、公式HTTPS URLと明示device codeだけを抽出する。生の画面本文・credential・token・OAuth callback codeは含めない。人の入力は既存の`pty_send`／`pty_key`で同じPTYへ送る。`remote`は標準のremote tool中継を使い、callerはCLI commandや環境ごとの入力方言を組み立てない。

`agent_models`は、harnessが今選べるmodelとreasoning effortを、そのharness自身の一覧から返す。
BellTeam等の画面は、保存した固定の一覧ではなく、agentを実際に動かす端末のharnessが返す候補を使う。
取得口、出力形式、model IDとeffortの変換は各harness adapterが持ち、`src/model-catalog.ts`は
harness中立の形、effortの並び、形式検証だけを持つ。stdinを渡す起動のOS差（macOSのAqua外の
launchd経由、Windowsの`.cmd`）は`src/agent-resolver.ts`／`src/tmux-runtime.ts`が持つ。

取得はpromptもturnも送らない。Codexは公式App Serverの`model/list`、Claude Codeはstream-jsonの
制御要求`initialize`（hook・MCP server・session保存を止める）、Grokは`grok agent stdio`の
`initialize`、Cursorは`cursor-agent models`を使う。返すmodel IDとeffortは`agent_launch`／
`agent_configure`へそのまま渡せる形にし、Cursorは`<model>-<effort>`の連結で作れる組だけを返す。
harnessの一覧に無い値をadapterが足す時（Claudeの`ultracode`）は`adapter_efforts`で出所を示す。
取得不能と形式異常は明示errorにし、固定一覧や別harnessへfallbackしない。判断の記録は
ADR 0074（repositoryの`docs/adr/0074-agent-model-catalog.md`）。

## Failure and recovery

入力が64KiBを超える、送信lockが残る、harnessがblocking UIにいる、model catalogが一致しない等の
境界失敗は明示errorにする。retry、別model、別harness、別backendへ自動fallbackしない。
stale send lockは並行processとのABAを避けるため自動削除せず、公開APIでは対象sessionを`pty_close`して
同じIDで再作成する。全session一括停止は公開しない。

Grokのread-only sandbox起動拒否は、`src/harnesses/grok.ts`の
`assertGrokSandboxNotRejected`がCLIのエラー表示から検出する。`src/core.ts`の共通入力受付待機は
Grokの場合だけこの判定を呼び、`GROK_SANDBOX_STARTUP_FAILED`で原因と未送信を返す。
初回prompt付き起動と通常dispatchに適用され、他harnessの入力受付判定には適用しない。
`trust_project`指定なしのpromptなし起動応答はPTYへの起動要求を示し、入力受付の確認は後続の送信時に行う。

hookパスのシンボリックリンク等を拒否する判断はGrok CLIが所有する。AitermはCLIが出した拒否を伝え、
hookのコピー、設定の置換、sandboxの解除は行わない。原因を設定の管理元で修正した後、対象sessionを
閉じて起動し直す。検出の回帰試験は`test/grok-startup.test.mjs`に置く。

Grokのmanaged起動は公式`--trust`を渡し、指定cwdの信頼状態はGrok CLIが管理する。
`grokLaunchBlockingDialog`は信頼確認を入力受付から除外し、scrollbackのshell promptを取り違えない。
`grokTuiBusy`は応答中の表示だけを実行中の根拠にし、完了後も残る`[hooks: 成功/失敗]`を含めない。
これらのCLI固有判定は`src/harnesses/grok.ts`が所有し、共通処理は判定を呼び出す。

Grokの終了済みerrorターンにweekly-limit質問カードが残る場合、通常dispatchだけが
現在のviewportを読み、harness生存と最新turnのエラー完了を確かめて`X`を一回送る。
既存の入力受付待機を通した後に完了cursorを取得し、今回の本文だけを送る。
実施した解除は既存receiptの`pane_input_recovery`に`grok_rate_limit_dialog_dismissed`として載る。
解除条件の不成立は`GROK_RATE_LIMIT_RECOVERY_BLOCKED`、解除後の入力受付失敗は
`GROK_RATE_LIMIT_RECOVERY_FAILED`で未送信を返す。読取・観測・設定・steerはこの解除を行わない。

`grokRateLimitDialog`が見出しと操作footerの組を所有し、過去logや後続UIのあるカードは採用しない。
privacy案内は現在の枠付きcomposerとmodel footerが見える場合だけ入力受付を妨げない。
完了観測は成功eventを優先し、今回のerror eventと現在のカードが揃えばturn情報付きの`rate_limited`を返す。
完了の見回りは100msで、画面を読む確認（利用上限の知らせ、Cursorのhook拒否の表示）は別の間隔で行う。画面を読むたびにtmuxを1回起動するため。
Claude・Grokは2秒、Cursorは1秒に1回で、待ちに入った最初の周回では必ず読む（ADR 0085）。
新turnの完了前に古いlogだけで上限を返さない。購入・再認証・過去prompt再送・定期再試行は行わない。
画面判定と模擬CLIの実PTY試験は`test/grok-rate-limit.test.mjs`に置く。

## Platform contract

- macOS／Linux／WSL2: tmux。
- Windows native: psmux 3.3.8以上、PowerShell 7、harness内部用Git for Windows。
- Windows PowerShell 5.1、PowerShell 6、`cmd.exe`、WSL bridgeへfallbackしない。
- multiplexer serverをまたぐ入力はUTF-8安全な256-byte chunkとdrainで直列化する。

## Diagnostics and local error state

`diagnostics`はread-onlyで、PTY backendとagent dependencyを検査する。runtime error aggregateは
製品所有のlocal stateに固定codeと集約metadataだけを保存し、既定ではnetwork I/Oを持たない。
BugHubへの報告は、利用者が明示して有効にし、合鍵のファイルがある端末だけが、別processで行う。
きっかけは記録・解決・起動・手動の4つで、定期的な見張りは置かない。受け取り済みにするのは応答の署名まで確かめた時だけ（ADR 0079）。工場reporterとの
連携は明示opt-inの任意adapterであり、未設定時もAiterm本体は単独動作する。raw error、prompt、出力、
transcript、path、credentialを保存・公開しない。
親配送hook（Claude Code・Cursor）の登録状態は`src/parent-hook-diagnostic.ts`が利用者設定の読取りだけで要約し、
2つ目のtextとして返す。1つ目のfactory向けJSONは項目も`overall`の意味も変えない（ADR 0077）。

## 変更条件

公開schema、完了境界、state ownership、platform backendを変える時は、原因の最小再現、focused test、
関連ADR、日英README、CHANGELOGを同じ変更で同期する。現行制御から外れた完了・棄却・中断・失効・置換済みの設計planはcurrentへ残さずarchiveへ移す。
旧設計draftは[`archive/01_design-plan.md`](https://github.com/kitepon/aiterm-mcp/blob/main/docs/archive/01_design-plan.md)に保存する。
