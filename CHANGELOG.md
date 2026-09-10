# Changelog

All notable changes to **aiterm-mcp** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.34.0] - 2026-09-10

### Added

- Codex親への子の回答自動配送を追加した。起動・通常dispatch・Claude durable turnの完了をAitermが観測し、回答本文を公式受信キューへ送る。親の待機コマンドと回答回収、子への送信指示は不要になった。
- 配送IDと状態をreceipt／`pty_observe`へ追加した。再接続後は未送信の記録を再開し、送信結果が不明な場合は本文を保持して自動再送しない。
- `aiterm-setup`はCodexの公式queue入口を確認する。各dispatchでMCP要求の親threadを確認し、未対応の受信口へ子を送らない。

### Compatibility

- Codex親は公式の`_meta.threadId`と`thread/queue` APIを提供する環境が必要。Codex CLI 0.154.0で確認した。native sub-agentを親とする外部queue入力はCodexの制約により未対応。
- Claude等の親の既存waiter契約は維持する。旧版へ戻すと新しい配送記録は処理されないが、既存PTY／harness stateの形式は変わらない。

## [0.33.1] - 2026-09-09

### Fixed

- macOS・Linux上のAitermからSSH先のPowerShellへ`pty_send(mark:true)`するとPOSIXの`printf`を送っていた不具合を修理した。現在のPowerShell promptで方言を判定し、成功・失敗の完了マーカーを生成する。古いpromptや入力途中の行は使わない。

## [0.33.0] - 2026-09-09

### Added

- `pty_list`の構造化結果と明示した非秘密環境変数の照会、`pty_observe`によるpane／harnessの生存、native process identity、状態、token hint、画面・CPU活動の観測を追加した。
- 通常PTYにも`AITERM_SESSION_ID`を注入し、`pty_open`の`env_vars`で帰属情報を継承できる。古いtmuxの環境注入も製品内で扱う。
- `agent_approval`でCodexのcommand／MCP承認をinspectし、digestへ束縛した単発許可・拒否を送れる。
- `agent_launch`へ`trust_project`、起動準備の`startup`、初手の`initial_prompt` receiptを追加した。promptなしでも明示したproject信頼に基づく既知の起動準備を完了する。

### Fixed

- Grokの通信失敗＋Waiting表示、Codexの過去の承認画面を稼働状態と誤認しない。初手は実行表示または相関した完了で開始を確認する。
- Codexの設定読込失敗でCLIが終了した後、残った起動画面へpromptを送る問題を修理した。送信前にharnessの生存を確認し、未送信の構造化エラーで返す。
- `mark:true`でheredoc終端へsentinelを連結して構文を壊す問題を修理した。

## [0.32.0] - 2026-09-09

### Added

- `aiterm-setup`を追加した。公式package managerによる依存準備、MCP経由の端末実行、検出したClaude Code・Codex・Grok・Cursorへの登録と確認を製品が所有する。対応外・未検出・失敗は公開JSONで区別する。

### Fixed

- Windowsでスラッシュ区切りのcwdを指定したGrok／Composerの完了通知と回答を取得できない問題を修正した。Grok CLIと同じ絶対パスへ正規化して両方の記録を読む。
- Grok／Composerの次turn開始後に、途中の回答を前turnの完了ID付きで返す問題を修正した。
- psmuxの最低版を実際のpsmux版数で検証し、winget導入直後の既存PATHからも公式配置を解決する。
- Windowsでrelease中のnpm起動がENOENTになる問題を修正し、起動元npmのJS入口をNodeで呼ぶ。

## [0.31.2] - 2026-09-08

### Fixed

- Grok／Composerの無人起動で公式`--trust`を使い、フォルダ信頼の確認画面に初回promptのEnterが消費される問題を修正した。確認画面はshellの`>`がscrollbackにあっても入力受付と判定しない。
- Grokの完了済みhook結果`[hooks: 成功/失敗]`を実行中表示と誤認し、入力待ちのまま初回送信や追加送信が停止する問題を修正した。判定はGrok専用アダプターが所有する。

### Changed

- Grok／Composerのsandbox起動拒否について、日英README、DESIGN、AGENTS、文書地図、公開後smokeの説明を同期した。検出はGrok専用アダプターが所有し、共通処理はその呼出しだけを担うこと、promptなしの起動応答は入力受付完了を示さないことを明記した。

## [0.31.1] - 2026-09-06

### Fixed

- Grok／Composerがread-only sandboxの適用に失敗して終了した時、入力受付を待ち続けて再送を案内していた。初回promptと通常dispatchの入力受付確認で`GROK_SANDBOX_STARTUP_FAILED`を即時に返し、CLIの原因と未送信を明示する。設定とsandboxは変更しない。

## [0.31.0] - 2026-09-04

### Fixed

- Claude Codeのturnが529 Overloaded等のAPIエラーで打ち切られるとStop hookが走らず、`aiterm-wait`が永久に未完了を返し続けていた（実被弾 2026-09-03: BellTeamのClaude席で70分の待機）。会話記録（`<config dir>/projects/<cwd slug>/<session-id>.jsonl`）に観測開始後に増えた`isApiErrorMessage:true`の行を読み、新しいoutcome `error`（exit 7、`error`にエラー本文）で返す。
- Grokの`turn_ended outcome=error`を完了境界として扱わず待ち続けていた。同じくoutcome `error`で返す。Cursorは`turn_ended`のstatusを問わず既に終了を返していたため変更なし。Codexはエラー終了の記録形が実測できておらず未対応。

## [0.30.0] - 2026-09-04

### Added

- `pty_send`（agent dispatch）、`agent_steer`、`agent_launch`に`image`（画像ファイルの絶対パスの配列）を追加した。aitermが本文末尾へ添付行を付け、Claude Code／Codex／Grok／Cursorはいずれも自分のfile読取toolでそのpathを画像として開く（実測 2026-09-04）。呼出し側が入力欄へパスを先打鍵する等のharness別手順を持つ必要を無くす。相対パス・未対応拡張子・不在fileは送信前にtyped errorで拒否し、通常PTY送信とforce送信では指定できない。

## [0.29.31] - 2026-09-04

### Fixed

- agent session への打鍵前に、pane tty 上の agent が前面プロセスグループでなければ `fg` で前面へ戻し、tty が cooked（icanon/echo）なら `raw -echo` へ戻してから送る（`pty_send` dispatch・起動時 prompt・`agent_steer`）。Codex 0.153 はツール実行後に前面を bash へ返したまま動き続ける／termios を cooked のまま残すことがあり、貼付本文が bash に落ちて `^[[200~` が生で残っていた（実測 2026-09-04）。dispatch receipt に `pane_input_recovery` を追加。判定は `ps -t` の STAT と `stty -a` だけを使う。

### Changed

- push時のCIをLinux 1環境へ絞り、WindowsはWindows固有ファイルの変更時だけ、3環境の全テストは週1回の定期実行だけにした。tag起点のnpm公開はmain CIの成功を待たず、既定ブランチの祖先確認だけで進める。
- `npm run release -- <version>`でversion同期・CHANGELOG見出し・commit・tag・MCPB・GitHub Releaseを一回で行う。

## [0.29.30] - 2026-09-02

### Fixed

- 起動直後のClaude Codeへの初回dispatchが入力受付gateを素通りし、composer描画前に届いた貼付本文だけが残ってEnterが失われる競合を直した。完了eventも進行中turnもないClaude sessionは他harnessと同じready gateを通してから送信する。


### Fixed

- Cursor Agentのsubmitをextended keyboard protocolのEnterへ変換し、通常のtmux Enterがcomposerに残る配送失敗を解消した。

## [0.29.28] - 2026-09-02

### Fixed

- Cursorの長いpromptが矢印の次行へ折り返され、末尾が画面外にある場合もcomposerへの反映を確認してsubmitする。

## [0.29.27] - 2026-09-02

### Fixed

- Cursorが貼り付け反映後の最初のEnterを取り落とし、promptをcomposerへ残した場合だけEnterを一度再送してturnを開始する。

## [0.29.26] - 2026-09-02

### Fixed

- Cursorの冷間起動時は、貼り付けたpromptがcomposerへ反映されたことを確認してからEnterを送り、入力準備前の早送信による未配達を防ぐ。

## [0.29.25] - 2026-09-02

### Fixed

- 無人Claude起動時に最初だけ表示されるBypass Permissions確認を進め、続くworkspace trust確認と初回promptまで一度の起動で完了する。

## [0.29.24] - 2026-09-02

### Fixed

- 無人Claude起動時のworkspace trust確認を起動処理内で完了し、初回promptを入力欄へ届ける。
- Cursorの長文pasteで末尾が画面外にある場合も、本文入りcomposerを未submitとして検出し、偽の成功receiptを返さない。

## [0.29.23] - 2026-09-02

### Changed

- Disable Codex startup update checks for centrally managed agents and launch managed Claude agents without interactive permission or workspace-trust prompts.

## [0.29.22] - 2026-09-02

### Fixed

- Treat Codex's passive update notice as ordinary startup output, while still stopping for the interactive update menu that requires a selection.

## [0.29.21] - 2026-09-02

### Fixed

- Detect Cursor prompts left in the composer when the arrow and first prompt line share one row, and fail dispatch instead of returning a successful receipt for text that was not submitted.

## [0.29.20] - 2026-09-01

### Changed

- 変更した実装の依存関係から必要なテストと工場環境を選び、依存を確定できない変更だけ全件へ広げ、選択jobのskip・cancel・failureを最終gateで拒否する製品所有CIへ更新した。
- release tagでは同じcommitのmain CI成功を再利用し、同一の3環境フル試験を二重実行しないようにした。

## [0.29.19] - 2026-09-01

### Fixed

- Recognize Codex's current `default` effort footer as an idle composer so queued turns are sent instead of rejected after session restore.

## [0.29.18] - 2026-09-01

### Fixed

- Launch managed Cursor agents with Cursor's official unattended flags so workspace, MCP server, and tool-call approval screens do not stop queued work.

## [0.29.17] - 2026-09-01

### Fixed

- Detect Cursor's current `→` composer when a long initial prompt remains unsubmitted, and retry Enter once only on that first-turn residue.

## [0.29.16] - 2026-09-01

### Fixed

- Recognize Cursor's current `Add a follow-up` composer after a long answer scrolls the `Cursor Agent` header out of the viewport.

## [0.29.15] - 2026-09-01

### Fixed

- Preserve Aiterm's launch marker when Cursor receives its initial prompt through the post-launch TUI path, allowing the completed Cursor transcript to bind to the managed launch.

## [0.29.14] - 2026-09-01

### Fixed

- Recognize Cursor Agent v2026.08.31's initial `Plan, search, build anything` composer as an idle input-ready screen, so BellTeam and other callers can dispatch the first turn after launch.

## [0.29.13] - 2026-09-01

### Added

- Add optional `throughline_supplement_file` to `agent_launch` and the four legacy launcher aliases. Aiterm passes the path unchanged to `throughline handoff-context`; Throughline alone reads, validates, scopes, and budgets the long-term-memory/RAG supplement.

## [0.29.12] - 2026-09-01

### Changed

- Run the product-owned full CI on the current factory environments: `macos-native`, `linux-workstation`, and `windows-native`. Keep `linux-server` for operational workflows instead of duplicating the full product test there.

## [0.29.11] - 2026-09-01

### Added

- Add `agent_steer` to inject an additional message into a running Codex or Grok turn. Idle sessions return `delivery=idle` without sending text so callers can queue a new turn explicitly.

## [0.29.10] - 2026-08-31

### Fixed

- Return `pty_read(agent_transcript:true)` answer text separately as `aiterm.pty-read-result.v1` structured content while preserving the existing human-readable diagnostic suffix.
- For Grok and Composer, return only the last non-empty assistant message after the last real user row instead of joining tool-use preambles with the final answer.

## [0.29.9] - 2026-08-31

### Fixed

- Accept both `server` and `linux` factory profiles on native Linux for opt-in
  runtime-error collection while keeping WSL restricted to its legacy `wsl` profile.
- Replace the nonexistent public `pty_kill_all` recovery guidance in the MCP error and both READMEs with the supported `pty_list` → `pty_close` → recreate flow.
- Keep the Grok credential-path contract in the authentication section instead of leaving it after the License heading.

### Changed

- Deliver terminal text without classifying or blocking destructive-looking command content; command policy belongs to the shell, remote endpoint, or launched harness.
- Pass existing absolute Grok credential paths to Grok without inspecting their contents, permissions, ownership, links, ancestors, or file type. Keep only the explicit-path shape/existence preflight and the default-missing `XAI_API_KEY` branch.
- Let Claude Code interpret `/login` and `/logout` inside its own TUI while retaining the official CLI authentication preflight before session creation.
- Replace the retired `wsl2` and ambiguous `linux-native` factory CI labels with
  separate `linux-server` and `linux-workstation` self-hosted runner contracts.
- Move completed, rejected, interrupted, expired, and superseded plans, audits, promotion notes, and obsolete design drafts under `docs/archive/`; retain only small compatibility stubs where Lattice, ADRs, or research evidence have immutable path references.
- Replace the release-by-release AGENTS log with a compact current product contract, and add product-owned DESIGN and RELEASE sources so Aiterm remains operable without dotagents.
- Ship the README-linked CHANGELOG and current product docs in the npm package, and document standalone npm update and version-pinned rollback for global and `npx` installations.
- Move the authoritative four-environment CI runner contract into this repository and have the release caller use the local reusable workflow instead of an external dotagents workflow.

## [0.29.8] - 2026-08-30

### Fixed

- Correct the `pty_open` MCP description and install-facing documentation to state the real platform contract: tmux on POSIX and psmux 3.3.8+ on native Windows.
- Add a tools/list regression that prevents the obsolete Windows-requires-tmux wording from returning.
- Do not mistake Claude Code 2.1.251's workspace-trust selection cursor for the composer; leave the initial prompt unsent and return an explicit blocking-UI error instead of selecting `No, exit` and issuing a false success receipt.
- Preserve the current composer when an old trust screen remains only in scrollback by classifying the last Claude `❯` marker rather than reversing the ready/action-required precedence.
- Use `TMPDIR` for the Windows managed-state root whenever it isolates the psmux namespace, preventing an isolated test process's `killAll()` from deleting live production agent metadata in the shared `%TEMP%` tree.
- Keep the existing `%TEMP%\aiterm-mcp-0` location for normal Windows servers where `TMPDIR` is unset.

## [0.29.7] - 2026-08-29

### Fixed

- Add a structured `wait_process` executable/argument boundary plus a PowerShell `Start-Process`-ready argument string to agent launch and dispatch receipts so Windows callers do not have to interpret npm's PowerShell bin shim or re-quote paths containing spaces.
- Launch the bundled waiter through the current Node executable while preserving the psmux backend, PowerShell 7 interactive shell, compatibility `wait_command`, and waiter outcome contract.

## [0.29.6] - 2026-08-29

### Fixed

- Give Windows runtime-error diagnostics and asynchronous recording enough time for their required PowerShell 7 private-DACL operations instead of killing healthy workers at the POSIX two-second deadline.
- Keep the explicit per-operation timeout override and the POSIX two-second default unchanged.

## [0.29.5] - 2026-08-29

### Fixed

- Select the PowerShell mark sentinel from the currently rendered PowerShell prompt when psmux briefly reports the launcher shell immediately after `pty_open`.
- Keep the failed, unpublished `v0.29.4` tag immutable and publish this corrected patch as 0.29.5.

## [0.29.4] - 2026-08-29

### Fixed

- Bypass psmux 3.3.8's unreliable CLI paste-buffer/send-keys path on Windows by sending paced 256-byte `SendBytes` commands over the authenticated per-session server protocol and retaining the send lock through the final ConPTY drain.
- Keep agent prompts atomic on Windows with explicit bracketed-paste wrappers after the TUI ready gate, while preserving tmux `paste-buffer -p` negotiation on POSIX.
- Cover 6,000-character delivery, same-session cross-process serialization, eight-session concurrent delivery, and platform-specific bracketed paste in native PTY regression tests.

## [0.29.3] - 2026-08-29

### Fixed

- Dispatch startup prompts for every harness through the live TUI ready gate instead of treating Grok/Composer/Cursor argv prompts as already running.
- Recognize Grok's current response markers as busy while allowing a stable visible composer without requiring a transcript initialization event.

## [0.29.2] - 2026-08-29

### Fixed

- Prefer the current idle composer over stale startup-dialog text left in scrollback, while still returning immediately for an actually active blocking UI.

## [0.29.1] - 2026-08-29

### Fixed

- Return the existing `initial_prompt=not_sent` error immediately when a known Codex/Claude startup approval UI blocks the TUI, leaving the session alive for the caller instead of waiting for the ready timeout.

## [0.29.0] - 2026-08-25

### Changed

- **起動時promptのready gate失敗を成功形receiptから明示エラーへ変更**（実被弾 2026-08-25:
  Codexのupdate確認ダイアログでTUIが入力受付にならず、promptが未送信のまま
  `wait_command: null`の成功形receiptが返り、呼び出し側が40分気づけなかった）。
  `sendInitialAgentPrompt`はready失敗時にAitermError（code 2）を投げ、sessionは
  調査/復旧用に残す。エラーメッセージにsession_id・復旧手順（pty_read→pty_key→pty_send）を含む。

### Added

- `codexLaunchBlockingDialog(screen)`: Codexの起動前modal（update確認・directory trust確認・
  その他「Press enter to continue」型）を実機capture逐語で検知し、ready gate失敗エラーに
  塞いでいるダイアログ種別を明示する。ダイアログ表示中のCodexはheader/footerを描かないため
  `codexTuiReady`では識別できない（実測フィクスチャをtestに収録）。

## [0.28.4] - 2026-08-25

### Fixed

- Native Windowsの`pty_open`既定shellをPowerShell 7（`pwsh.exe`）へ統一し、明示
  `powershell`／`powershell.exe`も検証済みPowerShell 7実体へ正規化した。検出実体自身の
  `PSEdition=Core`／major 7以上を確認し、Windows PowerShell 5.1・PowerShell 6・`cmd.exe`へ
  fallbackしない。未導入時はMicrosoft公式WinGet入口を案内する。
- runtime error DACL、process identity、Throughline shimも同じ絶対PowerShell 7を使う。
  DACLはPowerShell 7対応の`FileSystemAclExtensions` static APIへ移し、current SID only・
  FullControl・継承遮断・owner readbackを維持した。

## [0.28.3] - 2026-08-24

### Changed

- campaign 32のmaintenance queueに積んだ重複を解消: stop hook 2本とagent-sharedに
  三重実装されていた`uid()`／`runtimeStateBase()`を、node builtinだけに依存する新設の
  最下層`src/state-root.ts`へ一本化した。stop hookの「内部moduleへ依存しない」設計は
  state-rootがbuiltin依存だけであることで維持される。挙動・15-tool API・schemaは不変。

## [0.28.2] - 2026-08-24

### Changed

- 内部用語をharnessへ統一した（オーナー裁定: AIの実行基盤分類を「vendor」でなく「harness」と呼ぶ）。
  `src/vendors/`を`src/harnesses/`へ改名し、内部識別子（`harnessLauncherDiagnostic`等）とコメント・
  現役文書の分類語をharnessへ置換した。挙動・15-tool API・schemaは不変。
- 互換のため公開wire契約は据え置く: receipt／event fileの`vendor`・`vendor_session_id`field、
  diagnosticsの`vendor_dependencies`、runtime error code `AITERM.VENDOR_LAUNCHER_FAILED`は
  従来どおり（正本fieldは0.28.0以降`harness`）。

## [0.28.1] - 2026-08-24

### Changed

- 現行正典をv0.28の実装へ全面同期した。Windows nativeはWSL bridgeでなくpsmux 3.3.8以上＋
  Git for Windowsを直接使うこと、公開面は15 toolsで標準`agent_launch`と旧4 aliasを持つこと、
  harness固有／OS固有コードの所有境界をCONTRIBUTING、SECURITY、README、AGENTS、design planへ反映した。
- Cursorの通常agent transcriptによる回答回収と`turn_ended(status:"success")`完了相関、同一sessionの
  model／effort変更、複数harness運用を英日READMEと設計正本へ補完した。archive、過去版ADR、RAG rawは
  当時の証跡なので書き換えていない。
- ランタイムコードと15-tool APIは0.28.0から不変。npmへ含まれるREADMEを同期して届けるため、
  再公開不能な0.28.0を動かさず、文書同期版を0.28.1として公開する。

## [0.28.0] - 2026-08-24

### Added

- 正規の単一起動入口`agent_launch({ harness, model?, ... })`を追加した。`harness`は
  `claude-code`／`codex-cli`／`grok-cli`／`cursor-cli`で、agent loop・認証・hook・session・
  transcriptを所有する実行基盤を表す。`model`は別軸で、Cursor harness上のGPT／Claude／Grokも
  Cursor方式の完了相関を維持する。ComposerはGrok CLIのmodel presetとして指定する。
- Cursor Agent CLI adapterを追加した。通常`~/.cursor`を共有し、初回user recordのlaunch IDで通常
  agent transcriptを一意にbindする。末尾`turn_ended(status:"success")`を完了、同じturnのassistant textを
  回答正本として、既存`aiterm-wait`／`pty_read(agent_transcript:true)`契約へ接続する。
- Cursorの`write_scope:"read-only"`を公式`--mode ask`で実効化し、model＋effortは
  現行`model-effort` IDへ変換してlive catalogへ照合する。起動中変更は標準`/model`とmodel pickerの
  parameter editorを使う。CLI未導入・未認証・不正指定はPTY作成前に明示失敗する。

### Changed

- `claude_agent`／`codex_agent`／`grok_agent`／`composer_agent`はdeprecated thin aliasとなり、
  正規入口と同じ共通実装へ流れる。旧receiptの`provider`は互換fieldとして残し、`harness`を追加した。
- `pty_send`のagent dispatch、`aiterm-wait`、`agent_configure`、`pty_list`にも正規の`harness`を追加し、
  起動後の操作でも同じ実行基盤語彙を使えるようにした。旧`vendor`／`provider`／`agent`は互換用に残す。
- `event_cursor`はvendor別の完了正本境界を表すopaqueな0以上の整数とした。Cursorではfollow-up時に
  直前末尾の`turn_ended`が書き換わる実挙動へ合わせ、単調に残るuser turn数を使う。
- Cursor実行ファイルは`CURSOR_AGENT_BIN`、`~/.local/bin/cursor-agent`、PATH上の`cursor-agent`だけを
  解決し、Grok等と衝突し得る曖昧な`agent`名を使わない。導入・更新はCursor公式installer／
  `agent update`を正本とし、独自tarball経路を追加しない。

### Fixed

- MCPB stagingが`dist`直下のJavaScriptだけをcopyし、v0.27.7以降の`dist/vendors/*.js`を欠いた
  起動不能archiveをvalidatorが通していた欠陥を修理した。runtime JavaScriptを再帰copyし、staged serverの
  initialize／15-tool list／stderr 0まで公開前smokeで固定する。

## [0.27.9] - 2026-08-23

### Fixed

- Windows native の PowerShell pane で `pty_send(mark:true)` が POSIX 用 `printf` を
  連結して失敗し、コマンド本体が成功しても完了 sentinel を生成できず timeout していた。
  前面が `powershell` / `pwsh` のときは PowerShell 構文で sentinel を実行時生成し、
  成功を `rc=0`、失敗を `rc=1` として返す。command echo は `rc={0}` のままなので
  数字アンカーによる早期完了防止を維持する。POSIX shell の既存形式は変更しない。
- 日本語 README の Windows 要件が廃止済み WSL bridge の説明を残していたため、現行の
  native psmux 3.3.8+ と Git for Windows を使う契約へ訂正した。

## [0.27.8] - 2026-08-23

### Fixed

- 0.27.7 の npm package に `dist/vendors/` が同梱されず、公開版が起動時
  `ERR_MODULE_NOT_FOUND` になっていた（package.json `files` の `dist/*.js` glob が
  サブディレクトリを含まなかった）。`dist/vendors/*.js` を files へ追加し、
  `npm pack --dry-run` で build 済み runtime dist の全 .js が tarball に含まれることを
  固定する回帰テストを追加した（repo 内 dist で回る CI では検出できない欠陥クラスの封じ）。

## [0.27.7] - 2026-08-23（npm同梱漏れにより公開版は起動不能・0.27.8が修正版）

### Changed

- vendor固有コードとOS固有コードを専用モジュールへ分離した（外部挙動不変のリファクタ・
  campaign正本は `docs/archive/32-vendor-os-adapter-refactor-plan.md`）。`src/vendors/{claude,codex,grok}.ts` が各ベンダーの起動引数・
  ready/画面判定・完了検出・transcript回収・metadata生成・auth/catalog検証を所有し、
  `src/agent-shared.ts` がvendor中立の共有プリミティブ（state path・metadata型・完了event型・
  lineage）を所有する。psmuxのOS差（load-buffer一時ファイル・paste-buffer -r非対応・
  pipe-pane sink settle・NUL device・mode bit検証可否・Git Bash cwd変換）は
  `src/tmux-runtime.ts` へ集約した。依存方向は core → vendors → agent-shared →
  (tmux-runtime, errors) の一方向。公開tool面・schema・receipt・エラーメッセージ・
  タイミング定数は不変。core.ts は 4,912→3,647行。

## [0.27.3] - 2026-08-22

### Fixed

- agent metadata の codex_home / grok_home 照合が「現在の process env の home と等しいこと」を
  要求し、席専用 CODEX_HOME / GROK_HOME で起動した正当な session が別の aiterm instance から
  拒否された（2026-08-22 実測: 承認ダイアログで停止した席を親が救えず円卓が止まった）。
  per-launch の記録値を正とし、検証は絶対パスの形だけにする。
- Windows CI の listSessions テストが、psmux の pane_current_command が起動直後に
  git→bash と遷移するレースで落ちた（v0.27.1/0.27.2 の publish を連続で止めた）。
  行が安定するまで待ってから基準を取る。

## [0.27.2] - 2026-08-22（CI 失敗により未 publish）

### Changed

- OS依存コードを独立モジュールへ分離した（挙動不変のリファクタ）。errors（AitermErrorと
  telemetry所有の失敗経路）、tmux-runtime（tmux/psmuxの解決・socket/namespace・locale注入・
  起動）、agent-resolver（claude/codex/grok/throughline/pane shellの実行ファイル解決と
  起動経路）、runtime-error-os（パス規約・Windows DACL・host profile・process観測・
  force kill）。OS分岐の規約は各モジュールだけが所有し、core.tsとruntime-error-store.tsは
  OS非依存ロジックに保つ。

### Fixed

- process start identity の `ps -o lstart=` 観測が observer の locale に依存していた
  （lstart の日付書式は LC_TIME で変わる。Lattice 0.63.4 で実被弾した同族の罠）。
  観測 env を `LC_ALL=C` へ固定した。
- smoke の公開version検査が 0.27.0 固定のまま 0.27.1 が release され、`npm test` が
  素で赤になっていた。versionへ追随した。

## [0.27.1] - 2026-08-20

### Fixed

- `claude_agent` が `--model` / `--effort` を渡しても、launch 固有 `--settings` に
  model が無く Claude Code 既定（Fable 5 / high）へ落ちていた。要求した model と
  effort をその settings JSON へ焼き、席が Fable 固定にならないようにした。

## [0.27.0] - 2026-08-19

### Changed

- **Windows基盤をWSL橋からnative psmuxへ置換**（`e3f5fc8`＋本版で完成）。全tmux呼び出しは
  tmux CLI互換のnative psmux（`-L` namespace隔離・`AITERM_PSMUX`上書き可）を直接叩き、
  pane shellはGit for Windowsの`bash.exe`（`AITERM_BASH`上書き可）。WSL2・interop anchor・
  `/mnt/c`変換・`WSLENV`搬送は全廃。前提のpsmux忠実度修正3件（pipe-pane直接ファイルsink・
  paste逐語hex wire・前面`#{pane_current_command}`）はupstream貢献 psmux/psmux#577 として
  mergeされ **psmux v3.3.8** に収録＝Windows nativeの動作前提はpsmux ≥ 3.3.8。
- **共有/tmpの敵対的同居主体を前提とした安全設備を全プラットフォームで撤去**
  （オーナー裁定 2026-08-19）: agent state系のsymlink・hard link・owner uid比較・
  mode bit検査・`O_NOFOLLOW`。対応OSの既定配置（`XDG_RUNTIME_DIR`／per-user tmp）では
  前提が成立しないため。短書き込み検出、`dev`/`ino`同一性（operation相関）、size上限、
  作成時0o600/0o700は維持。Grok auth検証とsend/wait lockは対象外（撤去していない）。

### Fixed

- **Windowsで`grok_agent`／`composer_agent`の完了eventが一度も書かれなかった**:
  `grok-stop-hook`が`process.getuid`不在で即failしていた（claude側だけ修理され
  grok側が取り残されていた）。`aiterm-wait`が常に600秒timeoutする実害の根治。
- **受入契約が通したscript binをcontrol commandが実行できなかった**: Windowsで
  shebang script（受入が正式に許す形）をGit Bash経由、`.cmd`/`.bat`をshell経由で
  実行する。従来は`claude auth status --json` preflightが必ず失敗し起動不能だった。

### Tests

- テスト側の`process.getuid`ハードコード述語を製品側`currentUid()`と同規則へ揃え、
  Windows覆域を回復（skip 155→45・full 344件でfail 0）。fake vendor bin・Throughline
  fixtureをWindows実行形へ移植。撤去済み安全設備を検証していたテストは削除し、
  「envの任意pathへ書かない」等の撤去と無関係な不変条件は残して固定。

## [0.26.0] - 2026-08-15

### Changed

- Windows hostの`grok_agent`／`composer_agent`はWindows nativeの`grok.exe`だけを起動する
  （オーナー裁定 2026-08-15: WindowsネイティブはWindowsネイティブで完結させ、WSL2へ持ち込まない）。
  WSL側grokを起動するとvendor実体がWSL processになり、session記録（events/chat_history）が
  WSL home側へ分裂して`pty_read(agent_transcript:true)`と`aiterm-wait`の完了帰属が回収不能だった
  （実被弾: olc-plan-review-grok2）。非nativeな解決先はsession作成前に明示エラーにし、
  Windowsの既定候補へ`~/.grok/bin/grok.exe`を追加した。native実体はWindows側`~/.grok`へ
  記録するため、transcript／completion読取・auth検証（0.25.3）と同じ面で完結する。
  v0.25.3の`GROK_AUTH_PATH`の`/mnt/c`変換（WSL grok前提）は撤回し、Windowsドライブ形のまま渡す。
- `grok_agent`のツール既定modelをdotagents規範（xAI旗艦）どおり`grok-4.6`へ更新した
  （実catalogで現行defaultであることを確認済み）。

### Fixed

- Windowsのtmux bridgeでは各`wsl.exe`呼び出しが短命なため、paneが継承する`WSL_INTEROP`が
  死んだsocketを指し、pane内からのWindows `.exe`起動（binfmt interop）が
  `UtilAcceptVsock accept4=110`で失敗していた。aitermが長寿命のinterop anchor（sleepする
  `wsl.exe` process）を1本所有し、native `.exe`起動のenvへ生きたsocketを供給する。
  あわせてWSL側envはinterop先のWindows processへ既定では渡らないため（実測）、注入envを
  `WSLENV`（`/w`）で明示的に運ぶ。Windows native grok.exe 1.0.4の入力欄marker `>` を
  ready判定・submit残存観測へ追加した（`❯`は従来どおり）。
- Windows（`process.getuid`不在）で`existingAgentsDir()`が常に`null`を返し、close／killAll／
  同名再起動時のagent state掃除がno-opになっていた。閉じたsessionのmetadataが残り、同名の
  再起動が「agent metadata が複数あります」で失敗する実害を確認し、`currentUid()`の既知制約
  受容（uid 0）へ揃えて根治した。
- `grok_agent`／`composer_agent`の`write_scope:"read-only"`起動へ`--always-approve`を付与し、
  無人subagentがMCPツール初回使用の許可ダイアログで停止しないようにした。sandboxが実効
  書込み禁止を作るread-only起動だけが対象で、read-only以外のlaunchコマンドラインには
  従来どおり`--always-approve`を入れない（権限拡大なし）。

## [0.25.3] - 2026-08-15

<!-- 公開受入: docs/adr/0032-release-0.25.3-acceptance.md -->

### Fixed

- Windows hostで`grok_agent`／`composer_agent`が「Grok 認証正本の安全検証に失敗しました」で
  構造的に起動不能だった。WindowsのNode `fs.Stats`はPOSIX permission bitを持たない（fileは常に
  666、directoryは777相当）ため、`resolveAndValidateGrokAuth`のmode bit検証をWindowsでは
  除外する（`currentUid`と同じ既知制約の明示的受容。owner・nlink・size・O_NOFOLLOW・realpath・
  祖先symlink検証は全platform共通のまま維持）。
- Windowsで検証を通過しても、WSL内bashで走る起動コマンドへ`GROK_AUTH_PATH`をWindowsドライブ
  形式のまま渡していたため、WSL側grokが認証正本を開けず接続段階で無応答のまま停止していた。
  bin／cwdと同じ`toWslPath`変換を適用する。

## [0.25.2] - 2026-08-14

### Fixed

- Grok Build 1.0.3で`/model`成功通知が次の再描画までに消えた場合、実際にはmodel／effortが
  変更済みでも`agent_configure`が失敗と返していた。変更前には無かった要求model／effortが
  常駐footerへ現れた場合もvendorの最終状態として確認し、同一sessionの連続変更を正しく返す。

## [0.25.1] - 2026-08-13

### Changed

- GitHub移転後の正規repositoryを`kitepon/aiterm-mcp`へ統一した。README、contributor／security案内、
  npm metadata、MCPB manifest、Official MCP Registry manifest、公開runbookを同じ正本へ揃えた。
- 工場管理製品の最終CIをself-hostedのmacOS native・Linux native・Windows native・WSL2へ移し、
  4環境すべてで同じ`npm test`を同時実行する。OS別の縮小suiteやGitHub-hosted runnerで代用しない。
- npm publishは4環境full greenとrelease commitの`origin/main`祖先確認を必須条件とし、
  GitHub Actions OIDC Trusted Publisherは移転後の`kitepon/aiterm-mcp`へ対応させる。

### Fixed

- 移転前のTrusted Publisherが発行するOIDC claimと現在のrepository ownerが食い違い、provenance署名後の
  npm publishがE404になる公開障害を修理する。失敗済み`v0.25.0`は動かさず、修正版を`v0.25.1`として出す。
- Linux native／WSL2でも長いPTY入力を一括pasteするとtmuxが成功を返したまま中間を欠落させるため、
  全OSでUTF-8境界を守る256byte chunkと10msのdrain間隔を使う。
- `until`／`mark`を指定したreadが、shell builtin処理中の一瞬の出力静止をquiescent完了と誤認して
  指定証拠より先に返る欠陥を修理し、指定したmarker／sentinelを優先する。
- Windows nativeのself-hosted runnerをWSL所有者のinteractive taskで起動し、`NETWORK SERVICE`から
  見えないWSL／tmuxのためWindows fullが一括失敗する工場設定を修理する。

### Verification

- tag CI／Trusted Publishing `31747150072`はself-hostedのmacOS native・Linux native・
  Windows native・WSL2で同じ`npm test`を各347/347通過し、npm 0.25.1をSLSA provenance付きで公開した。
- GitHub ReleaseへMCPBを添付。Official Registry初回runのdescription 100文字超過422を根治後、
  run `31748407046`で`io.github.kitepon/aiterm-mcp` 0.25.1を`active`／latestへ公開した。
- npm由来global／隔離install、3 bin、14 tools、4 launcher schema、stderr 0、配布`dist`一致、
  Grok live smoke、Composer model不在時のsession作成前fail-loudと残骸ゼロを確認した。

## [0.25.0] - 2026-08-13

### Added

- `grok_agent`／`composer_agent`が起動時`reasoning_effort`をGrok Build TUIの
  `--reasoning-effort`へ渡すようにした。
- `agent_configure`をGrok／Composerへ拡張し、同一PTY・同一会話contextのまま
  `/model <model> [effort]`または`/effort <effort>`で変更できるようにした。
- Grok／Composerの`write_scope:"read-only"`を`--sandbox read-only`へ接続し、
  Codexと同じ実効書込み壁にした。パス説明は引き続き宣言記録だけである。

### Changed

- 明示したGrok／Composer modelとComposer既定`grok-composer-2.5-fast`を、PTY作成前に
  現在の`grok models` catalogへ照合する。取得失敗、形式不正、model不在は別modelへ
  fallbackせず明示失敗する。現行catalogにComposer modelが無い場合、Composer既定起動も
  利用可能と偽らずsession作成前に失敗する。

### Verification

- 起動時effort、read-only sandbox、Grok／Composerの同一session model／effort変更、
  catalog不在時の残骸ゼロ拒否をfocused regressionで固定した。
- 既存agent関連回帰117/117とMCP schema smokeがgreen。
- 最初のfull regressionは新catalog境界を持たない既存MCP fixtureだけが失敗して344/345。fixtureを
  focusedに修正後、最終full regression 345/345を確認した。
- npm pack dry-runは13 files、MCPB validate／packは0.25.0・2261 files、staged MCPは
  version 0.25.0／14 tools／4 provider schema／stderr 0でgreen。

## [0.24.3] - 2026-08-13

### Fixed

- Agent launcherの`env_vars`で、現在のMCP processにある指定名の値だけを起動agentへ継承できるようにした。MCP processより先にtmux serverが存在していても、呼出元が所有する席identityやworkflow変数を失わない。
- Codex v0.147がreasoning effortの後ろへ`fast`を表示するfooterもCodex frontendとして認識する。
  `medium fast ·`のidle実席を`agent_configure`が誤拒否していた欠陥を、vendor表示文法の判定で修理した。

### Security

- `env_vars`は名前だけをtool引数に受け取り、値は現在のMCP processから起動時に読む。全環境の暗黙継承や
  name/value mapは追加しない。指定値はshell quoteして起動コマンドへ入るため、起動先agent、PTY、`.lastcmd`へ
  到達する。この機能を秘密転送路として扱わず、同じOS userとvendorへ開示してよい変数だけを指定する。

### Verification

- 既存tmux serverを現在のMCP processより先に起動した条件で、指定した現在値だけがagentへ届くこと、
  不正な変数名がsession作成前に失敗することをfocused regressionで固定した。
- Peertableの実席9席で、各launcherへ渡したactor値が起動agentから読めることを確認した。
- `fast`入りfooterのready／idle readyをpure regressionで固定し、実席soraを同じsessionのまま
  LunaからTerraへ変更できることを確認した。
- final full regression 342/342、npm pack dry-run（13 files）、MCPB validate／pack、staged MCPの
  version 0.24.3／14 tools／4 launcher schema／stderr 0がgreen。
- release commit `6ccb1a3add62e183d321e1ad97cd008da31026a2`のmain CI `31664655592`、
  tag CI／Trusted Publishing `31664795704`、Official MCP Registry workflow `31664974149`がsuccess。
  npm latest 0.24.3、SLSA provenance、GitHub Release＋MCPB、Registry active/latest、registry由来
  global install、3 bins、14 tools、schema、stderr 0、installed dist一致、2件の根治smokeを確認した。
- v0.24.3の完全な公開receiptは[archive plan](https://github.com/kitepon/aiterm-mcp/blob/main/docs/archive/28-agent-env-vars-release-plan.md)へ記録する。

## [0.24.2] - 2026-08-13

### Fixed

- 長寿命Codex sessionで`OpenAI Codex`ヘッダが直近のcapture範囲外へ流れた後も、常駐する
  model／effort footerと入力欄をCodex TUIのready表現として認識する。idleの実席を
  `agent_configure`が「入力待ちではありません」と誤拒否していた欠陥を修理した。
- Runtime error storeのbakery queueが固定1.5秒をqueue全体の総待ち時間として扱い、macOSでは
  各waiterが各pollで外部`ps`を起動して自ら進行を遅らせていた欠陥を修理した。期限を同じ先頭ownerの
  無進捗時間として測り、正常なticket進行ごとに更新する。通常pollは`kill(pid, 0)`だけを使い、
  PID再利用を防ぐprocess-start identity照合はstall時だけ行う。

### Verification

- headerが画面外へ流れた長寿命Codexのready／idle readyと、footerだけ・入力欄だけ・busy表示の
  負経路をpure regressionで固定した。
- Peertableの実席で、同じAiterm sessionと会話contextを維持したままLuna medium→Terra highの
  `agent_configure`が成功することを確認した。
- v0.24.1 tag CI `31610402851`のmacOS Node 20で20並行queueの5 processが総待ち期限を超えた
  failureを再現根拠にした。前任ticketが各900msで進み総待ち1.8秒になるregressionをred→greenで固定し、
  20並行時の`ps`起動を258回から20回へ削減した。
- focused 67/67、full regression 339/339、npm pack dry-run（13 files）、MCPB validate／packと
  staged MCPのversion 0.24.2／14 tools／`agent_configure` schema／stderr 0がgreen。
- release commit `9febb994370a270acd0d38a80be508318d481060`のmain CI `31611936274`、
  tag CI／Trusted Publishing `31612206338`、Official MCP Registry workflow `31612570435`がsuccess。
  npm latest 0.24.2、GitHub Release＋MCPB、Registry active/latest、registry由来global install、
  3 bins、14 tools、schema、stderr 0、installed dist一致、長寿命Codex ready根治を確認した。

## [0.24.1] - 2026-08-12

### Release status

- Git tagのCI `31610402851`はmacOS Node 20のruntime error store高競合試験で失敗し、publish jobは
  実行前にskipされた。npm、GitHub Release、Official MCP Registryへは公開せず、tagを動かさず
  長寿命Codex ready修正とqueue根治を0.24.2へ継承する。

## [0.24.0] - 2026-08-12

### Added

- `agent_configure`を追加。起動済みのCodex／Claude agent sessionへ各CLI標準のmodel／effort変更操作を送り、
  PTYと会話contextを維持したまま設定を変更する。

### Verification

- Codex 0.147.0の実TUIでLuna low→Terra highを同一session内で確認。
- Claude Code 2.1.228をAitermの実PTYでSonnet low→Opus high→Sonnet lowへ変更し、同一sessionの
  画面表示と標準`/model`・`/effort`成功応答を確認。対話fixtureでも同一sessionへの2コマンド送信を固定した。
- local full regression 337/337、MCPB validate／pack、npm pack dry-runがgreen。release commit
  `764e83857c8c63416ca9da5311b73cac9364e490`のmain CI `31587209848`、tag CI／Trusted Publishing
  `31587248091`はsuccess。npm latest 0.24.0、global install、公開MCPの14 tools／stderr 0、
  installed distとrelease commitのバイト一致を確認した。

### Documentation

- Codex／Claudeの入口、日英README、設計索引、運用文書、旧plan／ADRをv0.22.0の共有agent環境契約へ同期。
  旧managed home／設定snapshotの本文は歴史的証拠として保持しつつ、現行契約ではない文書をADR 0025による
  superseded／historicalとして明示した。runtime、package version、公開成果物に変更はない。
- v0.23.0 portable forkの公開後全域監査を行い、`AGENTS.md`、contributor guide、security policy、
  docs索引、Lattice計画を`throughline_source_session`とread-only DB所有境界へ同期した。README、
  CLAUDE、ADR 0027、PROMOTIONは既に一致していたため内容を維持し、履歴ADR／archive／evidence／RAGは
  当時の証拠として改稿していない。

## [0.23.0] - 2026-08-04

### Added

- `claude_agent`／`codex_agent`／`grok_agent`／`composer_agent`へ任意の
  `throughline_source_session`を追加。指定時はローカルの`throughline >= 0.9.0`から対象sessionの
  読み取り専用handoff contextをPTY作成前に取得し、context＋固定区切り＋必須の新ミッションを
  そのまま初回promptにする。Throughline側のDB row所属、`merged_into`、batonは変更しない。
- portable forkは`launch_operation_id`と併用不可。Throughline不在、非zero、不正schema、空contextは
  clean launchへfallbackせず、session残骸ゼロで明示失敗する。引数を省略した通常clean launchは不変。

### Verification

- Codex型TUI後送経路とGrok型argv経路で、contextがmissionより前へ一度だけ入ることをfocused testで固定。
  外部Throughlineのmissing／nonzero／invalid schema／empty contextと、clean launch非依存も回帰した。
  最終full regressionは335/335 green。
- main CI `30919026450`、tag CI `30919295270`とnpm provenance publish、GitHub Release＋MCPB、
  Registry workflow `30919622861`がsuccess。Official Registry 0.23.0はactive/latestで、global install済み。
- Codex source memoryをClaudeへportable forkする代表live smokeで、source marker `creates: true`と
  mission marker `MISSION_OK`を同じ回答から回収。前後のDB ownershipは完全一致し、session残骸0。

## [0.22.0] - 2026-08-04

### Changed

- `claude_agent`／`codex_agent`／`grok_agent`／`composer_agent`を、直接CLI起動と同じ通常`HOME`、
  vendor home、project/user/local設定、MCP、plugin、skill、permission、trust、memory、historyを使う
  単一契約へ移行。旧fake home、private vendor home、設定snapshotはfallbackを残さず撤去した。
- aitermがlaunchごとに所有する範囲を、相関ID、完了event/cursor、bounded result、cleanup metadataへ限定。
  既存`managed_completion:true`は後方互換fieldとして残すが、環境隔離ではなく完了相関を表す。
- 起動子へ`role=subagent`、親session、delegation depth、lineage、`delegation_allowed=true`を注入。
  孫以降への再委譲は禁止せず、固定depth capも設けない。

### Fixed

- Grok/Composerは通常環境のMCP初期化中にも入力欄を描画するため、画面readyだけでpromptを早送信して
  消失し得た。通常sessionの`mcp_init_completed` eventと現行model footer／入力欄の両方が揃うまで
  dispatchしない。

### Verification

- Claude／Codex／Grok／Composerのdepth 1 live smokeで、sub-agent自己認識、親session、depth、lineage、
  再委譲可を回収。Claude親がaitermの`claude_agent`を1回使うnested smokeで、孫のdepth 2と伸びた
  lineageを実回収し、親子session残骸ゼロを確認。
- focused ready-gate回帰と関連testを追加。最終full regressionは329/329 green。公開package、CI／Registry
  receiptはADR 0026へ固定。main CI `30880757338`、tag CI `30880912526`、npm provenance、GitHub Release、
  Registry workflow `30880912702`がsuccess。npm registry由来の隔離installは0.22.0、3 bins、13 tools、
  stderr 0で、4 launcherすべての共有契約文言を確認。この端末のglobal installをregistry版へ更新し、
  global installed coreから実Claudeのsub-agent/depth 1/lineageを回収してdone。

## [0.21.4] - 2026-08-04

### Fixed

- managed Claudeの`--setting-sources ""`が通常hookだけでなくuser scope MCPまで不可視にし、fresh
  sessionからAIShell等が使えなかった。`~/.claude.json`のtop-level `mcpServers`だけをlaunch単位の
  0600 configへsnapshotして`--mcp-config`で渡す。通常hook／plugin／permissionとproject／local MCPの
  隔離は維持し、破損／型不正configはsession作成前に残骸ゼロでfail loudする。

### Verification

- snapshot内容、0600 mode、argv、config欠落、破損、metadata path再束縛、close cleanupをfocused testで固定。
  関連test 130/130、full regression 324/324がgreen。

## [0.21.3] - 2026-08-03

### Added

- `codex_agent`のtool descriptionへ、委譲時に`prompt`・`model`・`reasoning_effort`・
  `cwd`・`write_scope`を揃えた完全な呼び出し例を追加。

### Fixed

- Codex完了検出の正本をmanaged Stop hookからCodex自身のrollout transcript
  `task_complete.turn_id`へ変更。dispatch直前のtranscript byte境界を既存`event_cursor`で返し、
  `aiterm-wait`と`agent_transcript`が同じ構造化記録からturnを帰属する。Codex managed homeには
  Stop hookを生成せず、未使用になったCodex hook実装も配布物から撤去して、hook失敗・hook trust・
  Node実行パスをCodex完了の依存から除去した。build前に既存`dist/*.js`を消すことで、旧hookが
  dirty workspaceのtarballやMCPBへ残留する経路も閉じた。
- follow-up dispatchも毎回TUI idleを確認してから完了境界を切り、同じcursorへ複数turnが
  帰属する経路を閉じた。後発sub-agent rolloutはroot TUIの完了へ誤帰属しない。
- Claude/Grokのmanaged Stop hookは、長寿命server起動時の`process.execPath`（Homebrew Cellarの
  版付き実体）を設定へ焼き付けず、hook実行時に継承`PATH`から`node`を解決する。Node更新で
  旧Cellar実体が消えた後の`exit 127`を防ぐ。
- `write_scope`指定時だけMCP structured launch receiptから`write_scope`と
  `write_scope_enforcement`が欠落していた逆条件を修正。Codex/Grok/Composerの指定時と省略時を
  実MCP境界で回帰化し、宣言値・実効性の表示と既存receipt shapeを両立する。
- Grok/Composerの`write_scope`回帰が開発端末の実Grok CLIを暗黙利用し、clean CI runnerでは
  CLI不在で失敗する非hermetic fixtureを偽binへ固定した。
- Windowsのruntime-error-storeがlock ownerのPID再利用を防ぐprocess start identity取得だけ
  PowerShellを1秒で打ち切り、clean runnerのcold startで失敗する不整合を修正。DACL適用と同じ
  設定済みWindows command timeout（既定5秒）へ統一した。

### Verification

- full regression 322/322。main CI `30813089848`、tag CI／npm provenance publish
  `30813318513`、Official MCP Registry workflow `30813724499`がsuccess。
- npm由来の隔離installとglobal installでversion 0.21.3、3 bins、13 tools、stderr 0、
  Codex launcherの5引数完全例、廃止Codex hook非同梱を確認。公開receiptは
  [ADR 0023](https://github.com/kitepon/aiterm-mcp/blob/main/docs/adr/0023-release-0.21.3-acceptance.md)に固定した。

## [0.21.2] - 2026-08-03

### Release status

- Git tagのCIでWindows 20のprocess start identity取得が1秒上限を超え、publish jobは実行前にskipされた。
  npm、GitHub Release、Official MCP Registryへは公開せず、tagを動かさず0.21.3で置き換える。

## [0.21.1] - 2026-08-03

### Release status

- Git tagのCIが上記非hermetic fixtureで失敗し、publish jobは実行前にskipされた。npm、GitHub Release、
  Official MCP Registryへは公開せず、tagを動かさずfixtureを0.21.2で修正した。0.21.2もpublish前に
  Windows gateで止まったため、公開成果は0.21.3へ継承する。

## [0.21.0] - 2026-08-02

### Added

- `codex_agent`、`grok_agent`、`composer_agent`へ任意の`write_scope`能力宣言を追加。
  指定値はlaunch receipt、per-launch metadata、`pty_list`へ保存する。Codexの
  `write_scope:"read-only"`はCLIの`--sandbox read-only`で実効禁止する。Grok/Composerと
  Codexのパス説明は対応するsandbox/allowlist CLI機構がないため、
  `write_scope_enforcement:"declaration_only_unsupported"`で宣言記録だけであることを明示する。

### Unchanged

- `write_scope`省略時のagent launcher argv、launch receipt、metadata表示は従来どおり。

## [0.20.3] - 2026-08-01

### Fixed

- managed Claude／Fableの新規起動は、tmux sessionを作る前に同じCLIの
  `auth status --json`を検証し、正常な共有認証だけを複数sessionから再利用する。
  未認証・壊れた応答・失敗exit・timeoutは残骸を作らず明示失敗し、各sessionが
  `/login`へ流れて共有credentialを奪い合う状態を作らない。
- managed Claude内のexact `/login`・`/logout`は通常dispatchとforce送信の双方で
  副作用前に拒否する。認証の変更は通常端末で一度だけ行い、aitermはvendor所有の
  credentialを複製・symlink・lock・自動更新しない。
- Stop hookのdone event公開直後にactive marker削除だけが遅れるraceでは、同じmarkerより
  新しいresultと相関eventが揃った場合だけ回収側が短時間settleし、完了済みのexact resultを
  誤ってactive扱いしない。

### Verification

- 関連test 99/99、release full regression 317/317、実Claude Code v2.1.220／Fable 5 low effortを独立process
  3本×2波（計6 process）で同時・反復起動し、追加loginなしで全件done、exact result回収、close。

## [0.20.2] - 2026-07-26

### Fixed

- npmがauthor名の丸括弧をURL記法として再解釈し、指定したXプロフィールを
  `kitepon.dev`へ置き換えたため、author名を`Quo / クオ at kitepon.dev`へ訂正した。
  これにより作者名・所属ブランド・Xへのリンクを同時に保持する。

### Unchanged

- 0.20.1のREADME、検索語、短い説明、14ファイルのnpm tarball、およびruntime挙動は不変。

## [0.20.1] - 2026-07-26

### Changed

- npmの短い説明を、Claude CodeからCodex CLIの対話TUI（スラッシュコマンドや
  `$imagegen`を含む）を操作できる差別化点が先頭で伝わる文へ更新した。
- npm authorを`Quo / クオ (kitepon.dev)`とXプロフィールへ結び、検索語へ
  `codex-cli`、`terminal-mcp`、`persistent-terminal`、`interactive-cli`を追加した。
- 現行README（npm版・週間ダウンロード数バッジ、`npx` quickstart、
  Claude Code / Claude Desktop / Cursor設定、作者帰属）をnpmへ反映するため再公開した。
- Official MCP RegistryとMCPBの説明・版・作者帰属を同じ公開面へ同期した。
- npmの`files`を実行に必要な`dist/*.js`へ限定し、Smithery向けの旧版bundleや
  展開済み依存をnpm利用者へ重複配布しないようにした。

### Unchanged

- MCPの13ツール、3つのbin、stdio transport、PTY／agent runtimeの挙動は
  0.20.0から変更しない。公開面だけのpatch release。

## [0.20.0] - 2026-07-26

### Added

- `aiterm-wait` の outcome に `running`（まだ終わっていない）を追加。exit code は 5。
  `--timeout 0` は以前から「待たずに一度だけ観測する照会」として動いていたが、未完了を
  `timeout`（既定600秒待って終わらなかった）と同じ語で返していたため、軽い照会の答えが
  失敗・異常として親へ届いていた。これで「投げる → 自分の作業をする → 一度だけ様子を見る →
  まだなら作業へ戻る」が語彙として表現できる（ADR 0018）。

### Changed

- outcome → exit code の対応表を型で網羅強制。語を足して表を直し忘れると `undefined` から
  exit 0 になり、未完了が完了として親へ届く。その取りこぼしを compile error で止める。

### Unchanged

- 1秒以上を指定した待機の未完了は従来どおり `timeout` / exit 3。待ち方の意味は変えない。
- `done`=0 / `timeout`=3 / `closed`=4 / エラー=1、MCP の公開 tool と schema も変更なし。
- 照会は receipt・tool description で宣伝しない。押し込み機構を持たない親向けの逃げ道として
  README にだけ置き、ADR 0017 で排した「親が子のお守りをする」誘惑を戻さない。

## [0.19.3] - 2026-07-26

### Changed

- dispatch／起動時 prompt 送信後の案内を「投げっぱなし」正典へ反転した。第一文で
  「投げっぱなしでよい＝ここで待たない」を宣言し、待ち方は後段へ置き、foreground 実行の
  禁止を案内本文へ含める。従来は「即返る」の直後に完了待ち手順が続き、dispatch→wait が
  一続きの手順に見えて親がブロックする使い方へ流れていた（ADR 0017）。
- 完了待ちの起動形を親ホスト別に名指しするようにした。MCP initialize の `clientInfo.name`
  が `claude-code` の時は receipt に `Bash(command: ..., run_in_background: true)` を出す。
  取れない／未知のホストは汎用の非ブロック指示へ落ちる。抽象名詞の
  「ホストのバックグラウンドタスクとして実行」だけでは親が foreground 実行へ落ちるため。
- 未完了 session へ触れた時の復旧案内も同じ文型へ揃えた。取りこぼしゼロの `--cursor 0` は維持する。

### Unchanged

- `aiterm-wait` の既定 timeout・exit 契約・outcome 語彙・公開 schema・完了判定は変更なし。
  待つ主体は waiter プロセスであって親ではない、が本変更の分界。

## [0.19.2] - 2026-07-20

### Fixed
- Native Windows factory diagnostics now report `session_count: null` when
  the WSL-backed tmux server is not running and `pty_list.status` is
  `not_applicable`. This restores the published status/count invariant and
  lets strict factory adapters distinguish an absent session set from a
  verified empty list.

## [0.19.1] - 2026-07-19

### Fixed
- Ordinary PTY sends no longer let a pager or REPL started by an earlier line
  consume the beginning of later lines from the same multiline payload. When
  the foreground process is a POSIX shell, sanitized multiline text is encoded
  as one newline-free `eval` input, so the shell owns the complete script before
  execution begins. Single-line input, raw byte sends, and non-shell frontends
  keep their existing direct-paste behavior.

## [0.19.0] - 2026-07-19

### Added
- New `claude_approval` tool for managed Claude permission prompts. `inspect`
  binds the currently visible `Do you want to proceed?` UI to the active
  operation and a SHA-256 screen digest; `respond` relays only
  `approve_once` or `deny` while that same operation and digest remain
  current. Anonymous `pty_send` turns are supported with a null operation ID.
- Approval decisions are recorded as an owner-only, prompt-free structured
  receipt and cleaned up with the managed session.

### Fixed
- Managed Claude turns no longer deadlock when Claude Code requests a normal
  permission confirmation. Previously active-operation protection rejected
  raw `pty_send(force:true)` and every `pty_key` except `C-c`, leaving no
  supported way to answer the UI and therefore no Stop event.
- The documented `force:true` manual-intervention escape now states its real
  boundary: it does not bypass an active managed-Claude operation. Arbitrary
  text, persistent-allow choices, unknown prompt layouts, operation mismatch,
  and screens changed after inspection fail explicitly.

### Changed
- The public MCP surface is now 13 tools. Package, lockfile, server manifest,
  English/Japanese README, contributor guide, design docs, and release
  metadata are synchronized at `0.19.0`.

## [0.18.2] - 2026-07-18

### Fixed
- Managed Codex homes now snapshot-copy `agents/*.toml` custom-role
  definitions from the source `CODEX_HOME`. Symlinked definitions are resolved
  into private regular-file copies, so `codex_agent` sessions can discover the
  same custom roles without sharing mutable sessions, caches, or other home
  state. A missing or empty source `agents/` directory remains valid.
- Hook trust state is deliberately not copied as a separate credential/state
  artifact: aiterm's launch-owned Stop hook already uses
  `--dangerously-bypass-hook-trust` for that process. Project directory trust
  remains a separate safety gate and continues to come from the private
  `config.toml` snapshot; an untrusted cwd is not auto-approved.

## [0.18.1] - 2026-07-18

### Fixed
- The `aiterm-wait` / agent-metadata "not a managed session" error still
  suggested launching with `codex_agent(agent_done:true)` — an argument
  removed in v0.16 (launchers are always managed). It now points to the
  launchers themselves.

## [0.18.0] - 2026-07-18

### Added
- **Submit-strand observation** (`submit_residue`, additive nullable). Field
  report: a managed Codex child hung during MCP initialize; the initial prompt
  stayed **unsubmitted in the composer** for 2h18m while the TUI kept showing
  "Working", and nothing surfaced it. After every agent dispatch (initial
  prompt and follow-up), aiterm now runs a bounded screen poll for the sent
  text's tail lingering in the composer region (below the last input-marker
  line). `aiterm.pty-send-result.v1`, `aiterm.agent-launch-result.v1`,
  `aiterm.claude-operation-result.v1` (issue) and the
  dispatch hint carry the observation: `true` = residue confirmed (submit
  likely did not take effect; the hint explains recovery via
  `pty_key Enter` / `Escape`), `false` = no residue observed (not a proof of
  submission), `null` = not applicable / undecidable. Positive evidence only —
  no auto-retry, no silent fallback.
- Agent prompt injection now pastes with tmux `paste-buffer -p` (bracketed
  paste). tmux negotiates: panes that requested bracketed-paste mode (the
  vendor TUIs) receive the text wrapped in `ESC[200~/201~` — per paste chunk
  (macOS splits long prompts into 256-byte chunks, so a long prompt arrives as
  several consecutive bracketed pastes) — which hardens pastes against
  mid-word key-interpretation corruption and
  dropped submits; panes that did not request it receive the text unchanged.
  Regular shell `pty_send` behaviour is untouched. Byte-level regression fixed
  in `test/core-tmux.test.mjs`.

### Changed
- The pre-initial-prompt TUI ready gate no longer counts a Codex/Claude screen
  as ready while it shows a busy indicator ("esc to interrupt"), closing the
  window where the initial prompt was pasted into a TUI whose startup work
  (e.g. MCP initialize) was still running behind a visible composer.
  Grok/Composer keep the previous gate (no captured busy-string evidence yet).

### Fixed
- Removed stale v0.15-era guidance from six error/hint messages that still
  told the caller to retry `pty_send(wait:"agent_done")` — an argument that no
  longer exists since v0.16. They now point to the actual v0.17 procedure
  (`aiterm-wait --cursor 0` for initial-prompt completion — cursor 0 is safe
  because the event file is per-launch, and omitting `--cursor` would start at
  the waiter's EOF and could skip an already-written done event — plain
  `pty_send` dispatch, `pty_open` for manual operation).

## [0.17.0] - 2026-07-18

### Changed (BREAKING)
- `aiterm-wait` exit codes now mirror the receipt's `outcome` so exit status
  alone can never be misread as completion: `0` = `done`, `3` = `timeout`
  (turn **not** finished; default `--timeout` is 600 s), `4` = `closed`,
  `1` = error. Previously every observed outcome exited `0`. The receipt's
  `outcome` remains authoritative.

### Added
- `aiterm.agent-launch-result.v1` gains two additive nullable fields:
  `event_cursor` and `wait_command` (a copy-pasteable
  `aiterm-wait --session <id> --cursor <n>`), non-null exactly when the launch
  carried an initial `prompt` (a turn is in flight from launch). Durable
  callers no longer need to discover the completion procedure from other
  tools' descriptions.

### Fixed
- Tool descriptions, launch/dispatch hints, and not-yet-complete errors no
  longer imply that an `aiterm-wait` exit means completion. All four launcher
  descriptions now state the completion procedure; `pty_read(agent_transcript)`
  "not complete yet" errors point to the `aiterm-wait` background run instead
  of leaving the caller to poll.

## [0.16.0] - 2026-07-18

### Changed (BREAKING)
- **The blocking wait surface is gone.** A parent agent never blocks on aiterm:
  - `pty_send` no longer accepts `wait` / `timeout` / `screen` / `lines` /
    `operation_id`. Sending to an agent session is now automatically a
    **dispatch**: the TUI ready gate and submit separation still run, the call
    returns immediately, and the result envelope
    (`aiterm.pty-send-result.v1`, `mode: "sent" | "agent_dispatch"`) carries an
    `event_cursor` — the event-file boundary taken just before the send.
    Completion is observed by running
    `aiterm-wait --session <id> --cursor <event_cursor>` as a host background
    task (its exit is the push notification); results are collected with
    `pty_read(agent_transcript: true)` or `claude_turn recover` as before.
    `force: true` bypasses dispatch for manual intervention on non-Claude
    agent sessions. An active managed-Claude turn remains protected; v0.19.0
    adds the dedicated approval relay for its permission UI.
  - `claude_turn issue` no longer takes `timeout`; it is dispatch-only and
    returns `accepted` immediately. Recovery semantics are unchanged.
  - Launchers (`claude_agent` / `codex_agent` / `grok_agent` /
    `composer_agent`) no longer accept `agent_done` / `wait` / `timeout` /
    `screen` / `lines`. **Every launch is managed** (Stop-hook completion
    detection installed); an initial `prompt` is submitted through the ready
    gate and the launcher returns without waiting. For raw manual TUI driving,
    open a plain `pty_open` session and start the vendor CLI yourself.
- `aiterm-wait` gained `--cursor <n>` so the waiter can start after the
  dispatch without missing a completion (start-order independent for every
  vendor, not just Claude's `--operation`).

### Fixed
- tmux is now always spawned with a UTF-8 `LC_CTYPE` when the effective locale
  is unset or plain `C`/`POSIX` (common for GUI-launched MCP clients). A tmux
  server started under a C locale corrupts multibyte input — dropped and
  reordered bytes in `send-keys`/paste (Japanese prompts garbled) — and a C
  locale client sanitizes tabs in `list-sessions -F` output to `_`, which
  silently broke the `pty_list` agent column. Explicit non-C locales (including
  `C.UTF-8`) are respected; a stale `LC_ALL=C` is dropped so the injection can
  take effect. Note: an already-running tmux server keeps its startup locale
  until restarted.

## [0.15.0] - 2026-07-18

### Added
- Interactive Claude Code sessions now use the same persistent, user-visible
  PTY model as the other agent launchers. Managed turns correlate a durable
  caller operation ID through dispatch, Stop result, timeout recovery, and
  transcript read without re-sending the prompt.
- `pty_close` now returns an `aiterm.pty-close-result.v1` structured receipt
  with `closed` or `already_closed`. Retrying the same session ID after an MCP
  response loss therefore recovers the terminal close outcome exactly.
- New `aiterm-wait` binary for fire-and-forget ("B-style") orchestration: it
  observes the vendor Stop-hook completion event as a pure reader and exits with
  a one-line `aiterm.agent-wait-result.v1` receipt (`done` / `timeout` /
  `closed`). Run it as a parent harness background task so a completion becomes a
  process exit — a harness that re-invokes its agent on background-task exit
  (Claude Code) is woken with zero polling, and the parent tool call never
  blocks. The waiter takes no locks and never writes session or dispatch state,
  so any number run beside the MCP server and beside each other; `--operation`
  makes Claude recovery start-order-independent. Backed by the exported
  `observeAgentDone()` core primitive. A Codex parent has no equivalent
  wake-on-completion hook yet (upstream openai/codex#17543 / #18056), so it keeps
  using the blocking wait or manual recovery.

## [0.12.3] - 2026-07-14

### Fixed
- Grok/Composer `agent_done` launches now pass the validated canonical OAuth
  file through vendor-owned `GROK_AUTH_PATH`. The per-launch isolated homes no
  longer symlink auth/lock files that Grok's atomic replacement can detach from
  the real credential store; refresh and browser approval now persist to the
  normal credential without weakening hook/config isolation.
- PTY text delivery now loads uniquely named tmux buffers through stdin. macOS
  uses UTF-8-safe 256-byte paste chunks to avoid the observed long-input PTY
  truncation, while Linux and WSL keep a single bounded paste. Per-session
  cross-process locks prevent concurrent sends from interleaving, inputs above
  64 KiB fail before any bytes are sent, and partial failures never press Enter
  automatically. A stale send lock fails closed until the session is stopped,
  avoiding unsafe automatic-recovery ABA races. Runtime capability discovery preserves exact control bytes
  and line feeds across older tmux (without `paste-buffer -S`) and newer tmux
  (where `-S` disables the new `vis(3)` conversion).
- Runtime error-store contention no longer misclassifies ordinary hostile
  error text as a replaced lock entry; only typed disappearance/replacement
  races are skipped, while malformed ownership/mode/link state still fails
  loudly.

## [0.12.2] - 2026-07-13

### Added
- `diagnostics`: a read-only, machine-readable factory diagnostic that reports
  package version, MCP call readiness, a privacy-safe PTY-list summary, and
  optional Codex/Grok launcher availability. It never launches a PTY or agent,
  and excludes paths, environment values, credentials, command text, terminal
  output, and raw logs. Optional unset dependencies report `not_applicable`;
  indeterminate probes report `unverified`.
- Product-owned local runtime error aggregation and the `aiterm-runtime-errors`
  snapshot/ack/resolve/reopen CLI. Collection is explicit opt-in through the
  canonical dotagents `collection.enabled` JSON boolean; the store is offline,
  accepts only fixed error codes/templates, preserves unacknowledged records,
  and exposes only bounded privacy-safe status through `diagnostics`.
  MCP-side collection/diagnostics run in timeout-bounded child processes;
  persisted input is exact-validated with fingerprint recomputation; locks bind
  PID/start identity/token; permissions are revalidated; and typed ownership
  prevents lower PTY failures from being counted again as launcher failures.
- Collection is disabled by default and the local store performs no network I/O.
  Public commit `239e7e4`, provenance CI `29245251184`, npm `latest`, tag /
  GitHub Release, MCP Registry workflow `29245462227`, and a registry-derived
  isolated install were verified.

### Fixed
- `aiterm-runtime-errors` now recognizes npm's POSIX bin symlink as its direct
  entrypoint, preventing a successful empty response from packed/global installs.

## [0.12.1] - 2026-07-11

Hardening sweep that clears the audit's remaining low-priority notes
(`docs/11` section C — now fully consumed). Regression suite 203 → 205.

### Fixed
- Stop hooks now check the `writeSync` return value when appending an event
  line; a short write (e.g. ENOSPC) is truncated back to the pre-write size
  and reported, so a fragment can never corrupt the next event line.
- `latestAgentDoneEvent` no longer goes silently blind when the events file
  exceeds 1 MB: it now reads a bounded 64 KB tail (dropping the first partial
  line), so `agent_event_seen` / `last_turn_id` metadata stays live on
  long-lived agent sessions — and mid-size files are read more cheaply than
  before (the old path read the whole file up to 1 MB on every read).
- Non-agent sessions no longer pay the agent-metadata directory probe on
  every `pty_read`: a 2-second in-process negative cache (absence-only,
  read-suffix path only, invalidated on `openAgent`/`closeSession`/`killAll`)
  skips the redundant filesystem work.

## [0.12.0] - 2026-07-11

Full-repo adversarial audit (multi-agent find → adversarial refutation → live
smoke) plus the fixes and one feature that survived it. Design record and
rejection ledger: `docs/archive/11_audit-2026-07-11.md`; transcript-read design:
`docs/archive/12_agent-transcript-read-plan.md`. Regression suite 183 → 203.

### Added
- `pty_read({ agent_transcript: true })` recovers an agent session's most
  recently completed turn's final assistant message, in plain text, from the
  vendor's structured session transcript (JSONL under the managed home). This
  fixes the case where a long agent answer is truncated by the `wait:
  "agent_done"` screen tail (pane height ≈ 24 lines). Codex joins on the Stop
  hook `turn_id`; Grok/Composer take the assistant rows after the last
  non-synthetic user row. The extracted text is bounded through the normal
  reduction pipeline. Mutually exclusive with `screen`/`full`/`rtk`/
  `line_range`/`wait` (`lines` is allowed). Missing transcript / non-agent
  session / no extractable message are explicit errors, never a silent empty.
- `pty_list` now appends agent metadata (`agent=<kind> agent_done=true`, plus
  `vendor_session_id` once bound) to agent session rows, so a resumable
  Codex/Grok/Composer session is distinguishable after an MCP server restart.
  Plain shell rows are unchanged.
- `codex_agent` launch responses now surface the inherited managed-config
  reality: `managed config: mcp_servers <N> 個継承 / approval_policy=… /
  sandbox_mode=… / hook trust bypass 有効`. The inheritance itself is the
  intended design (the child matches the terminal's Codex behavior); this only
  makes its consequences visible so a "review-only" child isn't silently
  full-access.

### Fixed
- Agent `wait` file locks now reclaim stale locks. A lock left behind by a
  crashed/killed waiter (the pid recorded in the lock is dead, or the lock is
  old and unreadable) no longer rejects `wait:"agent_done"` on that session
  forever; the live-pid check (`process.kill(pid, 0)`) reclaims dead locks and
  fails safe (rejects) when liveness is indeterminate. `closeSession`/`killAll`
  now also honor a live cross-process wait lock (previously only the in-process
  set), with the holder pid in the message. Agent metadata writes are now
  atomic (temp + rename).
- `reduceOutput` now bounds over-long single lines (head + tail with a restore
  hint), so a few huge lines — e.g. a full-screen TUI's absolute-cursor repaint
  stream — no longer slip past the line-count fold and blow the response token
  budget. Line count and order are preserved (the `line_range` domain is
  unchanged); `raw: true` is untouched.
- Reading from a mid-multibyte offset (full/range 8 MB truncation and the
  incremental path) no longer emits a leading U+FFFD; the skipped bytes are
  accounted into the next offset.
- The pytest reducer returns `null` (falls back to generic) when the output has
  no pytest evidence, instead of replacing an unrelated command's output with a
  fabricated "Pytest: No tests collected". `classify` is unchanged, so genuine
  pytest wrappers still reduce; the six golden fixtures stay byte-exact. Empty
  input now yields `null` too.
- The destructive-command tripwire now absorbs a `--` option terminator
  (`rm -rf -- /` was previously waved through), and `pty_send({ rtk: true })`
  re-checks the tripwire against the post-`rtk`-rewrite text before sending.
- `pty_read` with an inverted `line_range` (`"5:3"`) is now an explicit error
  instead of a silent empty result.
- Quiescence detection no longer mis-attributes a completion when output
  arrives during the foreground-shell probe: the size samples are from the
  past while the `pane_current_command` check is now, and output landing in
  that gap used to be returned as `via quiescent` even though a `mark`
  sentinel (or `until` match) was already in the log. The stability window is
  now re-validated (re-stat) after the probe; if the log grew, the loop
  re-runs and the sentinel/`until` claims the completion. Found by CI on slow
  macOS runners (the B1 regression test), where the `sleep 0.6` margin over
  the 0.5 s quiescence window was routinely blown.
- The `force` / `mark` argument descriptions now state their full effect
  (`force` also lifts the initial-prompt mixing guard; `mark` needs `enter` to
  actually run the sentinel). Codex managed-config pin overrides now also match
  quoted TOML keys.

### Tests
- Added `tools/call` dispatch coverage to the smoke test (unknown tool, bad
  args, inverted `line_range` — all `isError`), plus regressions for wait-lock
  reclamation, transcript recovery (both vendor shapes), the line/byte guards,
  and the tripwire gaps.

## [0.11.0] - 2026-07-11

### Added
- Agent launchers accept a `model` argument. `codex_agent` passes it as `-m`
  and, when `agent_done: true` creates a managed `CODEX_HOME`, explicitly
  passed `model` / `reasoning_effort` values also rewrite the corresponding
  top-level pins in the managed `config.toml` copy, so terminal pins (for
  example an `ultra` effort pin, which enables proactive multi-agent
  delegation) no longer silently leak into interactive children.
  `grok_agent` / `composer_agent` use it to override `--model`.
- Codex launch responses now state the effective model and effort with their
  origin — argument, terminal-config inheritance, or CLI default — and warn
  explicitly when the effective effort is `ultra`.

### Changed
- `grok_agent` default model moved from the stale `grok-build` slug to
  `grok-4.5` (`grok-build` no longer exists in the live model catalog).
- `grok_agent` / `composer_agent` now reject `reasoning_effort` with a clear
  error before creating a session, instead of forwarding `--effort` to the
  interactive TUI where the grok CLI warns and ignores it (the flag is
  headless-only, and Composer does not support reasoning effort at all). The
  former `low/medium/high/xhigh/max` enum on these tools is gone; `codex_agent`
  keeps an unconstrained string (CLI-version dependent, up to `ultra`).

## [0.10.0] - 2026-07-09

### Added
- Codex launcher initial-prompt waits: `codex_agent` now exposes `wait`,
  `timeout`, `screen`, and `lines` for the launch-time `prompt`.
  `prompt + wait: "agent_done"` starts the persistent TUI first, waits for the
  TUI input area, submits the initial prompt, and waits for that first turn's
  Stop hook. `wait: "agent_done"` requires both `prompt` and
  `agent_done: true`; it does not implicitly enable hooks. Grok/Composer
  initial-prompt waits are intentionally not exposed until the post-OAuth smoke
  passes; their existing follow-up `pty_send(wait:"agent_done")` route remains
  unchanged.
- Agent-session reads now include auxiliary metadata such as
  `initial_prompt`, `agent_event_seen`, `completion_attribution=none`,
  `last_turn_id`, and a best-effort `frontend` hint. Stale hook events are not
  promoted to `is_complete=True`.

### Fixed / Hardened
- Codex initial launcher prompts are no longer placed on the shell command line
  in the MCP launcher path, avoiding shell continuation display for long or
  multiline prompts. If the TUI is blocked before input, for example on a
  vendor login screen, the prompt is not sent and the launcher returns the
  session with `initial_prompt=not_sent`.
- Ordinary `pty_send` now refuses to type into a session while a launch-time
  initial prompt is still `pending` or `sent`, preventing follow-up input from
  mixing into the same live TUI turn. Manual takeover is still possible with
  `pty_key` or intentional `pty_send(..., force:true)`.
- Post-launch initial-prompt failures preserve the created `session_id` in the
  error text, so the caller can inspect or recover the remaining session instead
  of losing the handle.

### Changed
- Synced release-facing documentation, RAG notes, and distribution playbooks to
  the `v0.10.0` state after adversarial documentation verification.
- Added release metadata version-sync coverage so `package.json`,
  `package-lock.json`, and `server.json` stay aligned after release hardening.

### Docs / Verification
- Rechecked the public docs against npm/global install/Official MCP Registry
  state, current CI shape, and the **177-test** regression suite.
- Verified real Codex launcher `prompt + agent_done:true + wait:"agent_done"`
  smoke for single-line, long Japanese, and multiline Japanese prompts.
- Attempted the internal Grok/Composer initial-prompt route before exposing it;
  the current environment stopped at OAuth browser approval and correctly
  returned `initial_prompt=not_sent` without sending the prompt. Public schema
  therefore remains Codex-only for launch-time initial-prompt waits.
- Archived completed planning/checklist documents so `docs/` keeps only live
  docs and current operational notes at top level.

## [0.9.1] - 2026-07-07

### Fixed / Hardened
- Codex `agent_done` managed `CODEX_HOME` now allowlists only the required
  normal-home files: `auth.json` is linked for authentication and `config.toml`
  is copied privately. Other normal `~/.codex` entries are no longer symlinked
  into the managed home, reducing write-through side effects while still keeping
  aiterm-owned Stop hooks isolated from the user's normal `hooks.json`.

## [0.9.0] - 2026-07-07

### Added
- **Hook-backed agent turn completion**: `codex_agent` / `grok_agent` /
  `composer_agent` can opt into `agent_done: true`, and `pty_send` now accepts
  `wait: "agent_done"` to wait for the launched agent CLI's turn boundary before
  returning the final terminal observation. This adds no new tools; it keeps the
  existing persistent-PTY model and uses vendor Stop hooks only as the completion
  boundary.
- `pty_send` schema fields for agent waits: `wait`, `timeout`, `screen`, and
  `lines`. `wait: "none"` remains the default and preserves the existing send
  behavior.
- Managed Codex/Grok/Composer hook route: launch-local vendor homes install
  aiterm-owned Stop hooks without editing the user's normal hook files. Grok and
  Composer isolate `GROK_HOME` / `HOME` to suppress compat hook and plugin
  contamination while sharing the normal Grok home's `auth.json` and
  `auth.json.lock` as a pair.

### Fixed / Hardened
- Prevent stale or unrelated hook events from completing the wrong turn:
  `launch_id`, `vendor_session_id`, initial prompt completion, pre-send EOF, and
  post-bind missing/null vendor ids are all guarded.
- Wait for the launched agent TUI to reach its input prompt before the first
  unbound `pty_send(wait:"agent_done")`; if the TUI is not ready, aiterm now
  fails before sending text instead of dropping input and later timing out.
- Reject concurrent `wait:"agent_done"` calls for the same session across both
  in-process and cross-process MCP server instances with an agent wait lock file.
- Harden hook event files and Grok auth lock handling against symlink/hard-link
  attacks, loose state directories, malformed or oversized JSONL, and cleanup
  that could otherwise follow symlink targets.
- Treat a configured but missing `XDG_RUNTIME_DIR` as unusable and fall back to
  the normal temp dir for agent state, matching CI and non-login Linux shells.
- Improve screen settling after hook completion so an old stable screen is not
  returned before the agent's rendered output catches up.

### Docs / Tests
- Documented `agent_done` usage, limits, and platform support in README,
  design docs, ADR, and RAG. `agent_done` is supported on Linux, WSL2, and
  macOS; native Windows keeps the core PTY tools and agent launchers but not
  `agent_done` yet.
- Expanded regression coverage to **167 tests**, including hook wrappers,
  managed homes, event parsing, race/security cases, MCP schema, and screen
  settle / TUI-ready behavior.
- Verified real MCP `tools/call` smoke for Codex, Grok, and Composer
  `agent_done` plus a normal Python REPL PTY smoke.

## [0.8.0] - 2026-07-05

### Fixed (全域監査スイープ 2026-07-05 — 詳細は docs/archive/03_audit-sweep-2026-07.md)
- **pytest 収集エラーの誤変換**: `read rtk:true` で pytest の収集エラー（import 失敗等）が
  `Pytest: No tests collected` や `Pytest: 1 passed` に潰れ、赤を無害/緑と誤読していた問題を修正（C1）。
- **mark 完了検出のエコー誤爆**: `pty_send(mark:true)` の sentinel がコマンドエコーに部分一致し、
  長時間コマンドで早期に「完了」と偽っていた問題を修正。数字アンカー sentinel で自動検出（B1）。
- **エージェント起動の破壊ゲート誤爆**: `codex_agent`/`grok_agent`/`composer_agent` の初手 prompt に
  `rm -rf /`・`git reset --hard` 等の語を含めると起動が拒否されていた誤検知を解消（A4）。
- **破壊ゲートのすり抜け**: `rm -rf ./*`・`rm -rf "/"`・`rm -rf ..`・`rm -rf ./` を遮断対象に追加（B2）。
- **セッションログの復活**: 外部 kill 後に残った同名ログを新規出力として返す問題を truncate で修正（B5）。
- **UTF-8 境界分断 / DCS・APC 残存**: 増分読みの文字境界丸めと制御シーケンス除去を強化（B3/B10）。
- エージェント起動の Windows 対応（bin/cwd の WSL パス変換）・env bin 実在検証・cwd の空/`~` 検証（A1/A3/A6）。
- reducer の分類/除去精度（stripShellFrame の過剰除去、`python3 -m pytest`・`uv/poetry run` 等の分類）（C2-C6）。

### Changed
- **`pty_read` の `until` を既定でリテラル部分一致に**（従来は正規表現直解釈）。`$ ` や `[..]` 等が
  メタ化して永遠に待つ事故を防ぐ。正規表現が必要なときは `until_regex: true` でオプトイン（B4）。
- `pty_send(mark:true)` は `pty_read(wait:true)` が until 無しでも完了を自動検出するように（B1）。
- `pty_read` の `screen+wait`（完了後に画面取得）・`full+lines`（末尾 N 行）を機能化（従来は黙殺）（B11）。
- 読み取り・完了検出のメモリ/tmux spawn を削減（fd 範囲読み・伸長中の生存確認省略）（B6/B7）。

### CI / Infra
- ネイティブ Windows CI（windows-latest, Node 20/22, 非ブロッキング）を追加。純粋層を検証（C9）。
- registry publish が npm publish の完了を待つ／再 publish は idempotent にスキップ（C10/C11）。
- テストのタイミング依存（固定 sleep・smoke の timeout 挙動）を解消しフレイキーを除去（C8）。

### Added
- `.github/workflows/registry.yml`: publishes `server.json` to the Official MCP
  Registry via GitHub OIDC (on release, or manual dispatch). aiterm-mcp is now
  listed in the Official MCP Registry (which auto-propagates to PulseMCP and the
  GitHub MCP Registry) and on mcp.so.
- `.github/avatar.svg` + `.github/avatar.png`: square avatar mark (terminal
  `>_` prompt) for directory listings and social cards.

### Changed (metadata)
- CI: bump `actions/checkout` and `actions/setup-node` to v5 (the Node 20 action
  runtime is being removed from GitHub Actions).

## [0.7.1]

Codex 独立レビュー（gpt-5.5 high・実 CLI 検証つき）の指摘5件＋追加発見2件の修正。

### Fixed
- **`openAgent` が失敗時に session を残さない**: 前提検証（effort → CLI bin → cwd）を session
  作成前に完了させ、起動コマンド投入（send）が失敗した場合は作成済み session を片付けてから
  エラーを伝える。特に cwd 不存在は従来 `cd` がシェル内で静かに失敗し「起動した」と偽の成功を
  返していた——事前検証で明示エラーに。
- **`reasoning_effort` の検証**: grok/composer は有限集合（low/medium/high/xhigh/max）を
  スキーマ（z.enum）と core の両方で拒否（session 作成前）。codex は CLI 側の値集合が版で
  変わるため縛らない。
- **`pipe-pane` の失敗を検知**: 従来は戻り値を無視して成功を装い、以後の `pty_read` が永遠に
  空を返した。失敗時は作成した session を破棄して明示エラー。
- **自動採番の高並行スケール**: 線形 t{i} リトライは全員が同じ「最小の空き番号」に殺到して
  上限20回でも枯渇し得た。衝突時は乱数 nonce 名（`t-xxxxxx`・1600万空間）へ切替え。
  実測: 20プロセス同時 open で 20/20 成功・全一意。
- **smoke テストの期待値置き去り**: v0.7.0 で agent ツール3個を追加した際にツール一覧の期待値を
  更新し忘れテストが赤のままだった（6→9 ツールに更新）。

### Changed
- `codex_agent` の説明を実態に合わせた: 「gpt-5.5」固定の断定を外し「モデルは Codex CLI の既定」
  に（実装は `-m` を渡していないため。モデル固定が要るなら将来 model 引数を追加する）。

### Added
- `test/core-agent.test.mjs`: openAgent の前提検証・残骸ゼロ保証の characterization テスト4本
  （CODEX_BIN 偽装で CLI 未導入環境でも走る・隔離ソケット）。

## [0.7.0]

### Added
- **対話型エージェント起動ツール**（モデルごとに1つ＝ツール名/説明でどのモデルか一目瞭然）:
  - `codex_agent` — Codex (OpenAI・モデルは Codex CLI の既定) の対話 TUI を永続端末に起動
  - `grok_agent` — Grok Build の Grok モデル (grok-build) の対話 TUI を起動
  - `composer_agent` — Grok Build の Composer モデル (grok-composer-2.5-fast) の対話 TUI を起動
  いずれも session_id を返し、以後は `pty_read`/`pty_send` で対話操作する（＝aiterm の対話パラダイム）。
  `reasoning_effort`（思考レベル）・`cwd`・`prompt`（初手）・`session_name` を引数で受ける。

### Changed
- `openSession` の自動採番を並行安全化: 複数エージェントが同時に名前なし open した際の TOCTOU
  競合を、衝突時に静かに次名でリトライして解消（明示名は従来どおり既存でエラー＝意図的共有と区別）。

### Removed
- `delegate` tool（v0.5.0-0.6.0）を撤去。非対話ワンショットは aiterm（対話型端末）の責務でなく、
  非対話 codex 委譲は codex-sidecar（codex_work/review/generate 等）が担う。aiterm は対話に専念。

## [0.6.0]

### Added
- `delegate` tool に `backend`（codex|grok）パラメータ: MODELS.md の第一選択（Codex＝OpenAI枠／Grok
  Build＝xAI枠）に構造を合わせた。**codex は稼働**、**grok は要 `grok login`＋非対話呼び出しの実測が
  未完のため明示的に「未確定」を返す**（動くフリを避ける。login＋実測後に有効化）。

### Changed
- `delegate` の出力を整形: codex の生 stdout（思考過程・セッションメタ込みで巨大）でなく、
  `codex exec --output-last-message` でエージェントの**最終メッセージだけ**を回収して返す
  （review 出力が 60k字→数十字に。空/失敗時のみ生出力へ明示フォールバック）。

## [0.5.0]

### Added
- `delegate` tool: 実装の物量や独立レビューを Claude レート非依存の外部AI(Codex)へ委譲する。
  `mode=exec`（codex に実装させる・workspace-write）／`mode=review`（read-only レビューさせ指摘を返す）。
  統括(Claude)のレート窓を温存する。`prompt`/`mode`/`cwd`/`timeout_sec` を取り、codex 未導入環境では
  明示 no-op を返す（公開レジストリの他利用者を壊さない）。ロジックは `core.delegate`。

## [0.4.1] - 2026-06-08

### Changed
- Discoverability metadata & docs (no code or behavior change from 0.4.0):
  added `mcpName` and an Official MCP Registry `server.json` manifest (npm /
  stdio), a Glama `glama.json` claim file, and expanded npm keywords
  (`mcp-server`, `claude-code`, `cursor`, `devtools`).
- README (EN + JA) reworked for first-time visitors: leads with the
  SSH-persistence pitch, replaces the placeholder demo mock with **real captured
  `pty_read` output** (token-reduction and completion detection shown on genuine
  bytes), names comparison competitors, de-duplicates the install steps, and
  moves the constraints list below the fold.

## [0.4.0] - 2026-06-02

### Added
- Nested completion early-return: while nested (ssh/docker/REPL foreground) with no `until`, `pty_read({ wait: true })` now returns `is_complete=False via nested` as soon as output settles, instead of waiting the full `timeout` for a signal that cannot fire there. The read advises passing `until` (a prompt regex) or `mark: true` for a confirmed completion. Certainty is unchanged (still none in that case) — only the wasted wait is removed.

### Changed
- `is_complete` is reported `True` only for confirmed completion layers (`until` / `dead` / `quiescent`); `timeout` and the new `nested` are reported `False`.

## [0.3.1] - 2026-06-02

### Changed
- Documentation-only release so the npm package page reflects the refreshed README (Quickstart, Demo, and a clearer call to action). No code or behavior changes from 0.3.0.

## [0.3.0] - 2026-06-02

Native macOS support. macOS previously rode the generic POSIX path (`isWin=false`)
but was never verified on real hardware; this release closes the macOS-specific
operational gaps in the tmux resolution layer. Verified on Apple Silicon
(Homebrew tmux 3.6b): 92/92 tests plus a live E2E run (open / send / quiescence /
mark+until / screen / list / close). The POSIX and Windows paths are unchanged.

### Added
- `resolveTmux()` in `src/core.ts`: resolves the tmux binary in the order
  `AITERM_TMUX` (explicit override) → `PATH` → Homebrew defaults
  (`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel), then caches
  the result. This finds tmux even under GUI launch, where the default `PATH`
  lacks the Homebrew bin directory. When tmux is found off `PATH`, the chosen
  path is announced on stderr (no silent fallback).
- CI `test-macos` job on `macos-latest` (Node 18/20/22, `brew install tmux`); the
  `publish` job now gates on `needs: [test, test-macos]`.
- `test/core-resolve.test.mjs` covering the POSIX tmux-resolution negative path
  (a bad `AITERM_TMUX` yields a clear code-2 error instead of an empty-stderr
  failure; skipped on native Windows, which uses the WSL bridge).

### Fixed
- Missing tmux now produces a clear `brew install tmux` diagnostic instead of a
  cryptic empty-stderr failure; the `tmux()` `ENOENT` case is distinguished from
  a generic non-zero exit.
- The bash 3.2 "switch to zsh" deprecation banner is suppressed via
  `new-session -e BASH_SILENCE_DEPRECATION_WARNING=1`. The `-e` flag is
  darwin-gated (and applied only when the shell is `bash`) because it requires
  tmux ≥ 3.2 and would break older Linux tmux.

## [0.2.0] - 2026-06-02

Native Windows support via a WSL tmux bridge. Windows has no tmux, so every tmux
call is bridged through `wsl.exe -e tmux`. The POSIX (Linux / WSL2 / macOS) path
is behaviorally unchanged.

### Added
- Native Windows backend: all tmux invocations routed through `wsl.exe -e tmux`,
  with the control socket on the WSL-native filesystem and pipe-pane logs read
  back via `/mnt` (with a Windows-only settle step before declaring completion).
  Requires WSL with tmux installed inside it.
- `toWslPath()` drive-path translation, plus `test/core-space-path.test.mjs`
  (pipe-pane capture under a space-containing temp path). The existing
  `core-pure`, `core-readoutput`, and `core-tmux` suites were extended with
  regression coverage for the bridge, session-name validation, path traversal,
  and offset clamping.

### Changed
- Session-name validation hardened and enforced at every entry point to block
  path traversal and shell injection (names must match `/^[A-Za-z0-9_-]{1,64}$/`).

## [0.1.0] - 2026-06-02

Initial npm publish (with provenance): a Node/TypeScript rewrite of the Python MVP
prototype (preserved under `prototype/python/` as the porting source and reference).

### Added
- stdio MCP server exposing exactly 6 tools: `pty_open`, `pty_send`, `pty_read`,
  `pty_key`, `pty_close`, `pty_list`. SSH, containers, and REPLs are not separate
  tools — you nest into the one PTY by `pty_send`-ing `ssh host`, `docker exec …`,
  etc.
- tmux backend: one persistent local PTY per session, surviving MCP server/client
  restarts via the tmux daemon. tmux is started with `-f /dev/null` (ignores
  `~/.tmux.conf` for reproducibility); all sessions live on one socket, so
  `tmux kill-server` removes them all. A human can co-drive any session via
  `tmux -S … attach -t <id>` (the attach command is printed by `pty_open`).
- Token-reducing reads: strip control characters, collapse repeats, head+tail
  elision with a restore hint and a meta line. `pty_read({rtk:true})` applies
  per-command reducers (git status/log, grep, pytest, df, make, …) as a
  self-contained reimplementation — no `rtk` binary required.
  `pty_send({rtk:true})` delegates to the external `rtk` binary if present and
  passes through otherwise (`src/rtk.ts`).
- Four-layer completion detection: process exit (dead) / until-regex /
  quiescence (output settled AND shell is back) / timeout. While nested
  (ssh/docker), quiescence cannot fire by design — use `until` or `mark`.
- Safety gate: `pty_send` blocks destructive commands (`rm -rf /`, `mkfs`,
  `dd of=/dev/`, `DROP TABLE`, fork bomb, `git reset --hard`, `curl … | sh`, …),
  overridable with `force:true`. It is a tripwire, not a sandbox: it does not
  catch relative-path `rm`, post-`$VAR`-expansion danger, or commands on the far
  side of an ssh hop. `pty_read` neutralizes control characters in returned text.
- Node regression suite (`node:test`, `npm test`, tmux required) and CI on
  `ubuntu-latest` for Node 18/20/22, publishing to npm on `v*` tags with
  provenance.

[Unreleased]: https://github.com/kitepon/aiterm-mcp/compare/v0.34.0...HEAD
[0.34.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.33.1...v0.34.0
[0.33.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.33.0...v0.33.1
[0.33.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.31.2...v0.32.0
[0.31.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.31.1...v0.31.2
[0.31.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.31.0...v0.31.1
[0.31.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.31...v0.30.0
[0.29.31]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.30...v0.29.31
[0.29.30]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.29...v0.29.30
[0.29.29]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.28...v0.29.29
[0.29.28]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.27...v0.29.28
[0.29.27]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.26...v0.29.27
[0.29.26]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.25...v0.29.26
[0.29.25]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.24...v0.29.25
[0.29.24]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.23...v0.29.24
[0.29.23]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.22...v0.29.23
[0.29.22]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.21...v0.29.22
[0.29.21]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.20...v0.29.21
[0.29.20]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.19...v0.29.20
[0.29.19]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.18...v0.29.19
[0.29.18]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.17...v0.29.18
[0.29.17]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.16...v0.29.17
[0.29.16]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.15...v0.29.16
[0.29.15]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.14...v0.29.15
[0.29.14]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.13...v0.29.14
[0.29.13]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.12...v0.29.13
[0.29.12]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.11...v0.29.12
[0.29.11]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.10...v0.29.11
[0.29.10]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.9...v0.29.10
[0.29.9]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.8...v0.29.9
[0.29.8]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.7...v0.29.8
[0.29.7]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.6...v0.29.7
[0.29.6]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.5...v0.29.6
[0.29.5]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.4...v0.29.5
[0.29.4]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.3...v0.29.4
[0.29.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.2...v0.29.3
[0.29.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.1...v0.29.2
[0.29.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.29.0...v0.29.1
[0.29.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.28.4...v0.29.0
[0.28.4]: https://github.com/kitepon/aiterm-mcp/compare/v0.28.3...v0.28.4
[0.28.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.28.2...v0.28.3
[0.28.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.28.1...v0.28.2
[0.28.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.28.0...v0.28.1
[0.28.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.9...v0.28.0
[0.27.9]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.8...v0.27.9
[0.27.8]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.7...v0.27.8
[0.27.7]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.3...v0.27.7
[0.27.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.2...v0.27.3
[0.27.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.1...v0.27.2
[0.27.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.25.3...v0.26.0
[0.25.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.25.2...v0.25.3
[0.25.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.25.1...v0.25.2
[0.25.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.24.3...v0.25.0
[0.24.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.24.2...v0.24.3
[0.24.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.24.1...v0.24.2
[0.24.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.21.4...v0.22.0
[0.21.4]: https://github.com/kitepon/aiterm-mcp/compare/v0.21.3...v0.21.4
[0.21.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.21.2...v0.21.3
[0.21.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/kitepon/aiterm-mcp/compare/b8c4dbc...v0.21.1
[0.21.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.20.3...b8c4dbc
[0.20.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.19.3...v0.20.0
[0.19.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.19.2...v0.19.3
[0.19.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.18.2...v0.19.0
[0.18.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.18.1...v0.18.2
[0.18.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.12.3...v0.15.0
[0.12.3]: https://github.com/kitepon/aiterm-mcp/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/kitepon/aiterm-mcp/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kitepon/aiterm-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kitepon/aiterm-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kitepon/aiterm-mcp/releases/tag/v0.1.0
