# Claude machine seat: the stream as data (a471, ruling 13)

> 契約（0.70.84、実装済み）。オーナー 2026-11-20 20:0x JST の裁き: machine席の出力は**データ**で渡し、画面に描いて読み戻さない。`claude -p` のstream-json行は、そのまま公開toolで呼び手へ届き、入力もデータで入る。busy／idle／blockedはstreamの事象から決める。native session（tmux／psmux）は全OSで、processとそのpipeを持つだけ。実装前に BellTeam execution（キロ氏）・conversation（N102）と合意する。

## 機能図（誰が何をするか）

| 部品 | 責務 | 読む／書くもの |
| --- | --- | --- |
| claude（無改造） | `claude -p --input-format stream-json --output-format stream-json --verbose --include-hook-events --permission-prompt-tool stdio` | stdinのJSON行を読み、stdoutのJSON行を書く |
| host（`claude-machine-host`、席のpaneの中） | claudeをpipeで持つ。**解釈も描画もしない**。stdoutの1行を、そのままstream fileへ追記する。inbox fileの新しい行を、そのままclaudeのstdinへ書く。事象から状態を導き、state fileへ書く（下） | stream file（書）、inbox file（読）、state file（書） |
| native session | hostとclaudeのprocessの入れ物（Linux・Macはtmux、Windowsはpsmux）。module交換・launcher終了を越える。入出力の道ではない | — |
| Aiterm MCP（公開tool） | stream file・state fileを読み、inbox fileへ追記する。検証は型の許可表だけ。既存の席のtool（pty_send・pty_observe・claude_approval・agent_stop・agent_configure）はmachine席でも同じ形で答え、内側でこのdata路を使う | 3つのfile |
| BellTeam execution（キロ氏） | stream_readで行を取り、stream_sendで答えを返す。中身は解釈せず、conversationへ運ぶ | 公開tool |
| BellTeam conversation（N102） | 行を保存・配信し、種類ごとの見せ方（言葉、道具の実行、質問のカード）を決め、利用者の答えを受ける | execution経由 |

## データの置き場（席の起動ごと、state root の `agents/`）

| file | 書く人 | 中身 |
| --- | --- | --- |
| `<session>.<launch>.claude-stream.jsonl` | host | claudeのstdoutの**1行＝1 JSON**を、改変せず追記（0600）。改行まで書けた行だけが読める |
| `<session>.<launch>.claude-input.jsonl` | Aiterm（stream_sendと既存の送信路） | claudeへ渡すJSON行。hostが先頭から順に1度だけ読み、そのままstdinへ書く |
| `<session>.<launch>.claude-machine-state.json` | host（原子的に置換） | `{schema:"aiterm.claude-machine-state.v1", state, reason, pending:[{request_id, subtype, tool_name}], stream_bytes, input_bytes_consumed, exited}` |

新しい起動（resume・wake）は新しい `<launch>` のfileを作る。cursorは起動をまたがない。

## 公開tool（追加。terminal席の既存toolは変えない）

### `stream_read`

入力: `session_id`、`cursor`（省略＝この起動のstreamの先頭）、`max_lines`（既定200、上限1000）、`wait_ms`（既定0、上限30000。新しい行か状態の変化まで待つ）。

出力 `aiterm.stream-read.v1`:

```
{ session_id, launch_id,
  lines: string[],          // claudeのstdoutの行そのまま（JSON文字列。Aitermは解釈・再整形しない）
  current_launch_id: string, // 今の起動（`launch_id` はこの行の起動。前の起動のcursorなら違う）
  cursor: string,           // 次に渡す値（`<launch_id>:<byte offset>`、不透明）
  at_end: boolean,
  state: { state: "starting"|"idle"|"busy"|"blocked"|"exited", reason: string|null,
           pending: [{ request_id, subtype, tool_name|null }] } }
```

別の起動のcursorは `STREAM_CURSOR_STALE`（現在の `launch_id` を添える。呼び手は先頭から読み直す）。machine席でない席は `STREAM_UNSUPPORTED`。

### `stream_send`

入力: `session_id`、`lines`: 1〜20個のJSON object。許す形は表の3つだけで、中身は書き換えない（無い `uuid` / `request_id` だけ補う）。

| `type` | 許す中身 | 用途 |
| --- | --- | --- |
| `user` | `message`（role user、content）、`parent_tool_use_id`（null）、`uuid`・`priority`（任意） | 発話・steer（実行中なら同じturnへ入る）。`/goal …` もここ |
| `control_request` | `request.subtype` が `interrupt`・`set_model`・`apply_flag_settings`・`set_permission_mode`・`set_max_thinking_tokens` | 中断、model／effort／fastの変更 |
| `control_response` | `response: {subtype:"success"|"error", request_id, response}`。`request_id` が `state.pending` にある時だけ | can_use_tool（Bash許可、AskUserQuestionの選択＝`updatedInput.answers`、ExitPlanMode）への答え |

出力: `{ accepted, items:[{ type, uuid|request_id, input_cursor }] }`。hostがstdinへ書き終えるまでの受付は、state fileの `input_bytes_consumed` で分かる（`stream_read` の `state` には出さない。`wait_ms` つきの読みで足りる）。待っていない `request_id` の答えは `STREAM_REQUEST_NOT_PENDING`。

### 既存toolの対応（machine席）

- `pty_send`・steer: user messageをinboxへ（paste＋Enterはしない）。receiptの形は同じ。
- `pty_observe`: `state` はstate fileから。`blocked` の `reason` は、tool許可＝`tool_approval`、AskUserQuestion＝`unknown_dialog`（今の名前を保つ）。
- `claude_approval`: 待っているtool許可（Bash等）を `pending` から出し、`approve_once`／`deny` を `control_response` で返す。AskUserQuestionはここでは答えない（`stream_send` の `control_response`）。
- `agent_stop`・`pty_key C-c`: `interrupt` のcontrol_request。`agent_configure`: `set_model`／`apply_flag_settings` のcontrol_request。
- `pty_read(screen)`: 画面は契約でない。`stream_read` を案内する短い文だけを返す。
- 0.70.83の、paneから読み戻す質問（`question_pending`・`answer`・pty_keyの数字）とpaneの状態行は、0.70.84で外した（置き換え）。`pty_key` は machine席では C-c／Escape（interrupt）だけで、他は `STREAM_KEY_UNSUPPORTED`。

## 状態遷移（hostが事象から決める）

| 状態 | 入る事象 | 出る事象 |
| --- | --- | --- |
| starting | host起動 | `control_response`（initialize）→ idle。失敗 → exited |
| idle | initialize済み。`result` を受け、始まったStop hookが全部 `hook_response` を返した | 入力の `user`、または入力なしの `assistant`／`stream_event`（asyncRewake等）→ busy |
| busy | 同上 | `control_request`（`can_use_tool`）→ blocked。`result`＋Stop hook応答 → idle |
| blocked | `can_use_tool` を受けた（`pending` に載る） | 答えの `control_response` → busy。`control_cancel_request`・`result` → idle |
| exited | claudeのprocess終了 | wakeは新しい起動（今と同じ） |

自力で出る道: Stop hookはClaude Codeの既存のtimeoutで終わる。interruptはclaudeが `result` を返す。hostに時計は無い（inboxの見張りは、fileの変化と低頻度の読みで、何も断らない）。

## 失敗の扱い

- hostが落ちた: state が `exited`。席は今のTUI席と同じに `harness_exited`。
- file書込失敗: その行は受け付けず `STREAM_SEND_FAILED`（再送の判断は呼び手）。
- 3OS: fileの追記・読みと、native sessionの持ち手だけ。socket・named pipeは使わない。

## 合意した点（キロ氏・N102、2026-11-20）

- 行の運び: long pollで足りる（push無し）。利用者の発話は `--replay-user-messages` で、streamに入れる（steerもすべての入力も、順に、uuidつきで並ぶ）。token単位の途中経過（`--include-partial-messages`）は無し。`ack_cursor` は無し（conversationがcursorを保存する）。
- 前の起動のstream: wake・restartの後も、席をcloseするまで前の起動のfileは残り、前の起動のcursorで読める（返りの `launch_id` はその行の起動、`current_launch_id` が今の起動）。無ければ `STREAM_CURSOR_STALE`。
- `state.pending` の各要求に、streamの中の行の位置（`stream_offset`＝行の先頭、`stream_end`＝行の次。cursorは `<launch_id>:<stream_end>`）。答え済みの要求を、行を読み直さず外せる。
- 0.70.84未満の別端末は `REMOTE_AITERM_TOO_OLD`（`stream_read` / `stream_send`。harness `claude-machine` は0.70.85）。
- thinking: 既定は空文（Opus・Sonnet・Fableで測定）。hostがinitializeの直後に `set_max_thinking_tokens`（`max_thinking_tokens: null`、`thinking_display: "summarized"`）を送るので、streamのthinking blockに要約の文が入る。`stream_send` でも同じ要求を送れる。
- forkの席は答える人がいないので、hostがAskUserQuestionを即denyする（forkは止まらない）。
- AskUserQuestionの答え: `updatedInput` は元のinput（`questions`）に `answers` を足した物。単一選択は選んだlabel、複数選択はlabelを `, ` で繋ぐ、Otherは自由文そのもの（3つとも実測）。

## 促しへの返事の印（a471-reminder-marker、2026-11-21）

Claude Codeは静かな間が続くと `silent_turn_reminder`（「しばらく利用者に何も話していない。今やっていることを一言で」）を差し込み、席の次の言葉はオーナー宛ての一言になる。`-p` のstreamにはこの促しが無く、会話記録（`<config root>/projects/<cwd slug>/<session_id>.jsonl`）に `attachment.type: "silent_turn_reminder"` の行として残るだけ。hostはその記録の**新しい行だけ**を読み、促しを見つけたら、その答えの行より**前**に1行 `{"type":"system","subtype":"silent_turn_reminder"}` をstream fileへ足す（claudeの行を書き換える唯一の例外ではなく、行の追加。claudeの行はそのまま）。BellTeam conversation（N102）は、この印の次の言葉を吹き出しにする（PR #2080）。

- 読む時点: claudeの `assistant` 行、または `stream_event` の `message_start` をstreamへ書く直前。促しの記録は答えのAPI要求より先に書かれるので、この時点で読めば印は必ず言葉の前に並ぶ。
- 記録の場所: 最初に `session_id` を持つ行を受けた時に決める（cwdはその行の `cwd`、無ければhostの cwd。root は `CLAUDE_CONFIG_DIR` か `~/.claude`）。読み始めはその時点のfileの終わり: 以前の促しは印にしない（resume）。fileが無ければ先頭から。
- 1つの答えに印は1行（読んだ間に促しが何件あっても）。記録が読めない・無い時は印を足さないだけで、streamとstateは変わらない。

## （参考）合意前の論点

1. 行の運び: `stream_read` の`wait_ms`つきlong pollでよいか（pushは別途）。
2. 利用者の発話をstreamに入れるか（`--replay-user-messages`）。入れれば、steerや別の席の入力も同じ順で並ぶ。
3. token単位の途中経過（`--include-partial-messages`）。既定は無し。
4. streamの保持: 起動の間fileを持つ。BellTeamが保存し終えた位置を知らせて前を捨てる `ack_cursor` が要るか。
5. 複数質問・multiSelect・Otherの自由文は、行の中身（`can_use_tool` の `input.questions`）と答え（`updatedInput.answers`）で完結し、Aitermは形を決めない。
