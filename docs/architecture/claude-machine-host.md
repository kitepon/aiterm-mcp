# Claude machine launch mode（a471、0.70.84）

> 現在図。`agent_launch` の `interface: "machine"` で起こしたClaude席の構造。0.70.82・0.70.83は、hostがstreamを画面へ描き、Aitermがpaneから読み戻す形だったが、オーナーの裁き（2026-11-20 20:0x JST、ruling 13）で**データの素通し**へ替えた（[ADR 0143](../adr/0143-machine-seat-stream-is-data.md)）。データの契約は [claude-machine-stream](claude-machine-stream.md)。採用理由の元は [ADR 0142](../adr/0142-claude-machine-launch-mode.md)。実装は `src/claude-machine.ts`、`src/claude-machine-host.ts`、`src/claude-machine-stream.ts`、`src/harnesses/claude.ts`、`src/core.ts`、`src/index.ts`。

## 機能図（誰が何をするか）

| 部品 | 実コード | 責務 | 変えないもの |
| --- | --- | --- | --- |
| 呼び手の入口 | `index.ts` `launchAgent` / `launchRemoteAgent` | `interface`（`terminal`｜`machine`、claude-codeだけ）を受ける。別端末が0.70.84未満なら `REMOTE_AITERM_TOO_OLD`。machineで立った席だけ起動結果に `interface: "machine"` | 他の公開tool・receipt・エラーの形 |
| 起動の判断 | `core.ts` `refuseCallerInput` / `prepareAgentLaunch` / `resumeAgentInLock` | 新規はmetadata `claude_interface: "machine"`。wakeは名指しの `interface` か保存したrecipeの `interface`（同じ会話IDで両方向に再開） | 席の本人性・世代・native作成の順 |
| 起動行 | `harnesses/claude.ts` `claudeMachineArgv` | paneで `node claude-machine-host.js --stream-file … --input-file … --state-file … --replay-user-messages [--deny-questions] -- <claudeのargv>`。claudeのargvはTUIの時と同じ。forkは `--deny-questions` | hook・caller files・lineage |
| 持ち手 | tmux（Linux・Mac）/ psmux（Windows）の席 | **全OSで同じ**: hostとclaudeのprocessだけを持つ。入出力の道ではない（pane入力も画面読みも無い） | native session作成・rollback・本人性 |
| host | `claude-machine-host.ts` | claudeをpipeで持つ。stdoutの行を**そのまま**stream fileへ追記、input fileの行を**そのまま**stdinへ、事象から状態をstate fileへ。initializeの後、thinkingの要約を有効にする（`set_max_thinking_tokens`）。ExitPlanModeは許可、forkのAskUserQuestionは即deny | claude本体（無改造） |
| データ路 | `claude-machine-stream.ts`、公開tool `stream_read`・`stream_send` | 行を読む（cursor）、型の許可表を通った行だけ送る | terminal席の既存tool |
| 内側の観測 | `core.ts` `captureScreen` / `observeNativeSession`（machine席だけ） | Aitermの内部の観測（`pty_observe`・送信の門・休止判定）は全harness共通で画面文を読むため、machine席にはstate fileの状態を1行の形（`[aiterm-machine] state=…`）で渡す。**どこにも描かれず、paneは読まない** | 観測・休止判定の分岐 |
| 既存toolの内側 | `submitAgentComposerText`、interrupt、`agent_configure`、`agent_goal`、`claude_approval` | machine席では、user messageをinput fileへ、interruptをcontrol_requestへ、model/effort/fastをcontrol_requestへ（答えはstreamから読む）、`/goal …` をuser messageへ、tool許可を `pending` のcontrol_responseへ。receiptの形は同じ | pty_send・steer・wait・親配送の契約 |

## データの流れ

```
caller ─ agent_launch(interface) ─> core.prepareAgentLaunch ─> metadata.claude_interface, recipe.interface
core ─ typed launch line ─> native shell ─> node claude-machine-host.js ─ spawn ─> claude -p (stdin/stdout pipes)
claude stdout ─ line, unchanged ─> host ─> <launch>.claude-stream.jsonl ─> stream_read (cursor) ─> caller
caller ─ stream_send / pty_send / agent_stop … ─> <launch>.claude-input.jsonl ─ line, unchanged ─> host ─> claude stdin
host ─ state derived from events ─> <launch>.claude-machine-state.json ─> stream_read.state, pty_observe, send gates
claude ─ Stop hook (settings) ─> claude-stop-hook ─> result/event files ─> wait / parent delivery (unchanged)
```

## 状態遷移・失敗の扱い

[claude-machine-stream](claude-machine-stream.md) の「状態遷移」「失敗の扱い」。要点: idleは `result` と、始まったStop hookの応答がそろってから。blockedは `can_use_tool` の待ち（`pending`）。host／claudeが落ちたら `exited`、次のdeliveryで同じ会話IDからwake。起動に失敗した新規launchは席を閉じて `AGENT_MACHINE_UNAVAILABLE`。

## 範囲外・未測定

本物の利用上限とfast、席の実環境でMCPが繋がる様子、Mac のKeychainだけのlogin。Code Modeは `-p` に無い（`settings_env` は受けて効果だけ無視）。
