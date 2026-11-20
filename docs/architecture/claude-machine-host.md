# Claude machine launch mode（a471、0.70.82）

> 現在図。`agent_launch` の `interface: "machine"` で起こしたClaude席の構造・データの流れ・状態遷移。実装は `src/claude-machine.ts`、`src/claude-machine-host.ts`、`src/harnesses/claude.ts`、`src/core.ts`。採用理由は [ADR 0142](../adr/0142-claude-machine-launch-mode.md)。実測の事実表は `docs/a471-spike-facts-20261120.md`（エレグの席の docs/）。

## 機能図（誰が何をするか）

| 部品 | 実コード | 責務 | 変えないもの |
| --- | --- | --- | --- |
| 呼び手の入口 | `index.ts` `launchAgent` / `launchRemoteAgent` | `interface`（`terminal`｜`machine`、claude-codeだけ）を受ける。別端末が0.70.82未満なら `REMOTE_AITERM_TOO_OLD`（`MACHINE_INTERFACE_MINIMUM_VERSION`）。起動の返りに、machineで立った席だけ `interface: "machine"` を足す | 他の公開tool・receipt・エラーの形 |
| 起動の判断 | `core.ts` `refuseCallerInput` / `prepareAgentLaunch` / `resumeAgentInLock` | 新規はmetadata `claude_interface: "machine"` を立てる。休止席のwakeは、名指しがあればそれ、無ければ保存したrecipeの `interface`（`recipeWithInterface`）。同じ会話IDで両方向に再開できる | 席の本人性・世代・native作成の順 |
| 起動行の組立 | `harnesses/claude.ts` `claudeAgentArgv` → `claudeMachineArgv` | pane内で `node claude-machine-host.js --end-file F [--first-prompt-file P] -- <claudeのargv>` を打つ。claudeのargvはTUIの時と同じ（`--settings`、`--session-id`/`--resume`、system prompt、MCP、model、effort） | hook（Stop・PermissionRequest・PreToolUse）、caller files、lineage |
| 常駐の持ち主 | tmux（Linux・macOS）/ psmux（Windows）の席 | **全OSで同じ**: 今の席と同じnative sessionが、hostとその子の `claude -p` を持つ。host module交換・launcher終了を越えて生きる。画面を読む読み手ではなく、processの入れ物 | native session作成・rollback・本人性 |
| host | `claude-machine-host.ts` `ClaudeMachineHost` | 子の `claude -p --input-format stream-json --output-format stream-json --verbose --include-hook-events --permission-prompt-tool stdio` を1本持つ。paneのキーを読み、JSON行に直す。流れを平文で画面へ出す | claude本体（無改造） |
| 観測 | `claude.ts` `claudePaneObservation` / `claudeTuiReady` / `claudeTuiBusy` が `claude-machine.ts` `claudeMachineMarker` を先に読む | hostが画面に出す状態の行 `[aiterm-machine] state=starting｜idle｜busy｜blocked [reason=tool_approval｜unknown_dialog]` の最新を、TUIの `idle/composer_ready`・`busy/turn_running`・`blocked/…` に写す。列0で始まる行だけ（TUIは出さない形） | `pty_observe`・待ち・休止判定が読む `agentPaneObservation` の返り |
| 入力 | 既存の `submitAgentComposerText`（貼付＋Enter） | host がbracketed pasteを要求し、貼付＋Enter＝1通のuser message。実行中に届けばClaude側のqueueで同じturnへ入る（steer）。Escape・C-c＝interrupt要求 | pty_send・steer・preface・admissionの順序 |
| 承認・質問 | 既存の `runClaudeApproval` | `can_use_tool` をhostが「Do you want to proceed? / 1. Yes / 2. No」として描き、`parseClaudeApprovalScreen` がそのまま読む。答えは数字＋Enter。ExitPlanModeは既存のPermissionRequest hookと同じ方針で許可。`inspect` は待ちが無ければ `status: "none"`。AskUserQuestion（0.70.83）: hostが質問文と「❯ 1. A / 2. B」を描いて `blocked reason=unknown_dialog`。`inspect` は `status: "question_pending"`、`question: {prompt, options:[{index,label}]}`、`choices` は `decision: "answer"`、`prompt_digest` は起動世代＋質問＋選択肢のdigest。`respond` は `approval_choice: "answer"` ＋ `answer_index` ＋ `observed_prompt_digest`（質問が変わっていれば断る）で、番号＋Enterをhostへ送る。待ちの間は `pty_key` の 1〜9・Enter・Up・Down も通る（`machineDialogKey`） | Yes/Noの契約（`approve_once`・`deny`） |
| Goal（0.70.83） | `core.ts` `agentGoal` のClaude枝 | 読み（inspect）はtranscriptの `goal_status` 行で、席の種類に依らない。作る・直す・消す（利用者起源だけ）は、machine席では `/goal …` / `/goal clear` をhostへ貼って送る（`submitClaudeMachineGoal`）。idleでなければ `goal_input_not_empty_or_ready` で未発行。未達のGoalはClaude Codeが次のturnを続ける（3 turnで検証） | `agent_goal` の返り・利用者起源の条件 |
| 設定 | `core.ts` `configureClaudeMachineSeat` | model・effort・fastを `/aiterm-config {json}` の1行でhostへ。hostが `set_model` / `apply_flag_settings` を送り、`[aiterm-machine] config=ok｜error` を返す。実行中のturnにも効く。`opusplan` は席の中では選べず `CLAUDE_MODEL_NOT_SELECTABLE` | `agent_configure` の返り |
| 完了 | 既存のStop hook（`claude-stop-hook`）＋transcript | `-p` でもStop hookは動く。hostは `result` の後、始まったStop hookが全部答えるまで `busy` に留まり、その後 `idle` にする（Throughlineが記録を終えた後）。完了のevent・result file・operation印は今のまま | wait・親配送・`claude_turn` |
| 中断の記録 | `claude-machine.ts`（host）→ `<session>.<launch>.claude-machine-end.json`、`claudeInterruptedAfter` | `-p` のinterruptは次の入力までtranscriptに行が出ない。hostが `result` ごとに終わりを書き、`terminal_reason` が `aborted*` ならTUIの中断記録と同じに読む | operation印の「中断で保留を外す」規則 |
| 起動失敗 | `core.ts` `assertClaudeMachineCameUp` | 新規launchで、hostが状態の行を出す前に `! claude exited` 等が出る／既存の `AGENT_TUI_READY_TIMEOUT_MS` が過ぎたら、席を閉じて `AGENT_MACHINE_UNAVAILABLE`。席は残らず、呼び手は1回だけTUIで起こせる | 既存のstartup blocked・launch not started |

## データの流れ

```
caller ─ agent_launch(interface) ─> index.ts ─> core.prepareAgentLaunch
   metadata.claude_interface ─> recipe.interface (.resume.json / .resume-template.json)
core ─ typed launch line ─> native shell ─> node claude-machine-host.js ─ spawn ─> claude -p (stdin/stdout pipes)
pane keys (paste+Enter, Esc, C-c, digits) ─> host ─ JSON lines ─> claude stdin
claude stdout JSON lines ─> host ─ plain text + state line ─> pane ─> capture-pane ─> claudePaneObservation
claude ─ Stop hook (settings) ─> claude-stop-hook ─> result/event files ─> wait / parent delivery (unchanged)
host ─ result ─> claude-machine-end.json ─> claudeInterruptedAfter
```

## 状態遷移（host）

| 状態 | 入る条件 | 出る先 |
| --- | --- | --- |
| starting | host起動 | initializeの返事 → idle。子が出ない／initialize失敗 → 画面に失敗の行（launchは `AGENT_MACHINE_UNAVAILABLE`） |
| idle | initialize済み、または result と全Stop hookの応答がそろった | 貼付＋Enter／hook由来のassistant出力（asyncRewake）→ busy |
| busy | user messageを送った／入力なしでturnが始まった | can_use_tool → blocked。result＋Stop hook応答 → idle |
| blocked | `can_use_tool` を受けた | 数字＋Enter（または `control_cancel_request`）→ busy。result → idle |

自力で出る道: hookはClaude Codeの既存のtimeoutで終わる。Escape/C-cはinterrupt要求で、子が `result` を返す。host自体のtimerは無い。

## 失敗の扱い

- 子が終了: hostは `! claude exited` を出して終わる。席は今のTUI席が死んだ時と同じに `harness_exited` と読まれ、次のdeliveryで同じ会話IDからwakeされる。
- SIGTERM: hostが子へSIGTERMを渡す。`CLAUDE_CODE_RESUME_INTERRUPTED_TURN` は設定しない（既存のR-resume配送が唯一の続け方）。
- 古い `terminal` 席のTUI画面や、画面に `[aiterm-machine]` を引用した席: 列0の行だけを読み、TUIは字下げ・印付きで出すので取り違えない（試験）。
- Code Mode: `-p` に無い。`settings_env` の指定は受けて効果だけ無視する（recipeに残り、後のTUI wakeで効く）。

## 範囲外・未測定

本物の利用上限とfast、席の実環境でMCPが繋がる様子、Goalが未達のまま続く動き、macOSのKeychainだけのlogin。いずれも最初の実発生で確かめる（トロニー氏の裁き 9・10）。
