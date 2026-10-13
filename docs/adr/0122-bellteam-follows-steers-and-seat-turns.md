# ADR 0122: BellTeamが、差し込んだ文を取った番と、自分で始めていない番を追える口を置く

日付: 2026-10-13

## 起きた事

BellTeamの席（Codex）が、Aitermの子の結果（親配送）で始まった番を動かしていた。その番へ利用者の文が3通差し込まれ、席は答えたのに、
会話画面には答えも「処理中」も出なかった（2026-10-13）。BellTeamが追えるのは、自分の`pty_send`が`agent_dispatch`で返った番だけだった。

- 差し込み（`agent_steer`）の返りは`event_cursor`も`wait_process`もnullで、その文を取った番の終わりを待つ道が無かった。
- 自分で始めていない番（子の結果が始めた番）は、始まった事を知る道が無かった。
- 合間の言葉（ADR 0071）は、最後のdispatchの境界から読む。差し込んだ番がdispatchで始まっていないと、別の番の言葉になる。

答えの本文は運ばない。自分で始めていない番の答えは、BellTeamがThroughlineから拾う（2026-10-01の裁定）。ここが返すのは位置だけ。

## 判断

どれも、要求の`params._meta`に`"aiterm/caller": "BellTeam"`がある時だけ足す。印の無い呼び手への返りは変えない。
ツールの説明、引数、`structuredContent`の形（schema）は変えない（ADR 0071と同じ理由）。

1. **`pty_send`の差し込みの返り。** `mode: "agent_steer"`の時、`event_cursor`（打つ直前の完了の位置）と`wait_process`
   （`aiterm-wait --session <席> --cursor <N> --steer <steer_id>`）を入れ、結果の`_meta["aiterm/steer"]`に
   `{ schema: "aiterm.steer-ref.v1", steer_id, interim_from }`を返す。控えを取れなかった時は、今までどおり両方null。
2. **差し込みを追う待ち（`aiterm-wait --steer`）。** その文を取った番の終わりで返る。結果（`aiterm.agent-wait-result.v1`）に
   `steer: { placement, taken_at }`を足す。`turn_id`と`at`は、その番の物。
   - `same_turn`: 動いていた番が取り込んだ。
   - `next_turn`: 番の後で、その文が新しい番を始めた。前の番の終わりでは返らない。
   - `unknown`: 記録の中で文を見分けられなかった。打った後の最初の番の終わりで返る（今までの待ちと同じ）。
   - `outcome: "not_taken"`（終了コード8）: 文が会話の記録に入っていない。
3. **合間の言葉の読み始め。** `pty_observe`の要求の`_meta["aiterm/interim_from"]`に、1か4が返した値を渡すと、その位置より後の言葉を返す。
   `seq`は1から、結果の`event_cursor`はその値を返した時の位置。値を読めない時は、言葉の代わりに`error`（`INTERIM_FROM_INVALID`）を返す。
4. **席の今の番。** `pty_list`の結果の`_meta["aiterm/seat_turns"]`に
   `{ schema: "aiterm.seat-turns.v1", seats: [{ session_id, launch_id, harness, turn }] }`を返す。`turn`は
   `{ state: "running", turn_id, started_at, event_cursor, wait_process, interim_from }`・`{ state: "idle" }`・`null`（分からない）。
   動いている番の`event_cursor`と`interim_from`は、番の頭。そこから待てばその番の終わりで返り、番の頭からの合間の言葉を読める。
   **Codexだけ。** ほかのharnessは`null`。画面は読まない。

`interim_from`は呼び手が中身を読まない文字列にする。Claude Codeは、完了の位置（event file）と言葉の位置（会話の記録）が別のfileで、
同じ番の中の差し込みは完了の位置が全部同じになる。1つの数では両方を表せない。

## 文の見つけ方

打つ直前に、位置と、文の頭（空白を除いた先頭160字。4字より短い文は使わない）を、席ごとの控え
（`<session>.<launch>.steers.jsonl`）へ足す。控えは頼まれた時だけ取り、席を閉じる時に消す。待ちは控えを読み、harnessの記録と突き合わせる。

- **Codex**（0.162.1の実記録）: 取り込まれた文は、その番の`turn_id`を付けたuserの行になる（打って約1秒）。その`turn_id`の`task_complete`が、
  文を取った番の終わり。番の開始の印が打った位置より後に在れば`next_turn`。前提の文（AGENTS.md・環境）もuserの行で書かれるので、
  行の種類（`content_item_kinds`）が在る版では`user.`で始まる物だけを数える。
- **Claude Code**（2.1.296の実記録）: 番の最中の文は待ち行列の行（`queue-operation`）になる。`enqueue`（`content`に全文）の後、
  道具の合間に取り込まれると`remove`（`reason: "absorbed_mid_turn"`）、取り込まれずに番が終わると`dequeue`の後にuserの行。
  入力待ちの席へ入った文は、待ち行列を通らずにuserの行になる。
  番の終わりは、文が取られた行より後に書かれた答えを持つ完了。Stopのhookの知らせの`result_digest`は、最後の文
  （`stop_reason: "end_turn"`の行のtext）のsha256と同じ（3席の実記録で一致。知らせの時刻は、その行の50〜70ミリ秒後）。
  時刻の近さでは選ばない。前の番のStopと次の番の開始は0.1秒しか離れない。
- **Grok・Cursor**: 「今すぐ送る」で必ず動いている番へ入る（入らなければ差し込みが誤りで返る）。打った後の最初の完了を返し、`same_turn`。
  Cursorの位置はuser発話の数で、差し込みが新しいuser発話として書かれなくても今の番の終わりで返るよう、今の番の手前を指す。

`not_taken`と言うのは、次のどちらかの時だけ。分からない時は`unknown`にして、今までの待ちの意味で返す。

- 打って30秒たっても、利用者の入力の行も番の終わりも無く、動いている番も無い（Codexは記録の最後の境界、Claude Codeは待ち行列の行で見る）。
- 番が終わって8秒たっても、文が次の番を始めず、ほかの利用者の入力も無い。

## 席の今の番の読み方

Codexの記録で、最後の境界（`task_started`・`task_complete`・`turn_aborted`）が`task_started`なら動いている。
席ごとに、どこまで読んだかと最後の境界を覚え、次に聞かれた時は増えた分だけを読む。初めて見る席は、末尾からさかのぼって探す
（長い番の開始の印は末尾から遠い。ADR 0101）。記録が増えていない席では、60秒おきに今の会話の記録を探し直す（ADR 0105の会話の切り替え）。

会話を結び付ける前の席も読む。起こしたばかりのCodexの席は、最初の送信の時に会話の記録がまだ無く、会話のID（`vendor_session_id`）は
2つめの送信の時に席の登録へ入る。本物の席で見ると、最初の番の間も、終わった後も、IDは入っていなかった（2026-10-13、Codex 0.162.1）。
子の結果が2つめの番を始める席は、この形のまま動いている。結び付く前の席は、会話の置き場から、この起動の印（起動時に渡した
`AITERM_AGENT_LAUNCH_ID`）を持つ記録を探して読む。席の登録は書き換えない（書くのは送信の道だけ）。探すのは置き場の一覧と、
起動より後に書かれた記録の頭の読みなので、「この起動の物でない」と決まった記録は覚えて読み直さず、見つからない間は5秒空ける。

## 長い番を頭から待てるようにする

Codexの完了待ちは、読み始めの位置から16MiBを超えて書いた番で「turn増分が大きすぎます」と誤りで止まっていた
（`CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES`。2026-10-13の夜の番は、開始の印の後ろが約8.4MBまで行った）。
席の今の番から待つ呼び手は、長く続いた番を頭から読むので、ここに当たる。記録を4MiBずつ読み、番の大きさには上限を置かない。
改行が来ないまま16MiBを超えた1行だけ、持たずに読み飛ばす。dispatchから待つ時も同じ直しが効く。Grokの待ちの上限は変えていない。

## 及ばない所

- 席の今の番は、Codexだけ。Claude Code・Grok・Cursorの、自分で始めていない番は見つけられない。
- 起こしたばかりの席は、最初の番が始まってから「動いている」と読めるまで、最長5秒遅れる（結び付く前の席の探し直しの間）。
- harnessが落ちた席は、番の終わりが書かれないので、動いていると読んだままになる。呼び手は、待ちの`closed`で席が閉じた事を知る。
- 同じ頭の文を続けて差し込むと、後の差し込みの待ちが、先の文の行を自分の物と読む事がある（見分けは文の頭だけ）。
- 別端末の席（remote）への送信は、まだこの手がかりを返さない。

## 確かめ

- `test/steer-follow.test.mjs`: 手で書いた記録で、CodexとClaude Codeの`same_turn`・`next_turn`・`unknown`・`not_taken`、誤りと利用上限の終わり方、
  席が閉じた時、記録が短くなった時。前の番と次の番の答えが同じ文でも、前の番のStopを取らない事。席の今の番（開始の印が1MiBより前、
  末尾を書いている途中、番の終わり、止めた時、会話を結び付ける前の席、ほかの起動の記録を読まない事、探し直しの間）。
- `test/core-agent.test.mjs`: 偽の席への差し込みで、頼んだ時だけ控えを取って返し、席を閉じる時に控えを消す事。
- `test/interim-words.test.mjs`: MCPの入口で、印のある時だけ`aiterm/interim_from`と`aiterm/seat_turns`が効く事。ツールの一覧に出ない事。
- 本物のCodexの席（0.162.1、Linux、2026-10-13）: 起こしたばかりの席へ文を送り、コマンドが動いている間に、印を付けて2つめを差し込んだ。
  `pty_list`の`aiterm/seat_turns`に動いている番が出て（会話を結び付ける前。直す前は`null`のままだった）、差し込みの返りに`event_cursor`・
  `wait_process`・`aiterm/steer`が入り、`aiterm-wait --steer`は`same_turn`で、dispatchの待ち・席の今の番からの待ちと同じ番の終わりで返った。
  印の無い`pty_list`と`pty_observe`の結果には`_meta`が無い。席を閉じると控えは消えた。

## 根拠

- BellTeam側の経緯と使い方: トロニー（bot-7b140b27）の`docs/owner-turns-lost-20261013.md`
- [ADR 0071](0071-bellteam-interim-words.md)（合間の言葉）、[ADR 0101](0101-codex-turn-running-by-record.md)、[ADR 0105](0105-codex-follow-conversation-switch.md)
