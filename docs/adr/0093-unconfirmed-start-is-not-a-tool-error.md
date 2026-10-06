# ADR 0093: 起動時promptの開始を確認できなかった返りは、誤りにしない

状態: 採用。

## 原因

`agent_launch`は、起動時promptを送った後の3秒で子のturnの開始を見られないと、`initial_prompt.status`を
`submitted_unconfirmed`にして、返りに`isError: true`を付けていた（`src/index.ts`の`launchAgent`）。
この時、sessionは立っていて、promptは入力欄を離れており、親への配送も登録済みである。

連携元（BellTeam）の本番で、Claude Code（2.1.291）の席がClaude Codeの子を起こし、子の回答が親へ届かなかった
（2026-10-06、Aiterm 0.54.0。0.53.2も同じ作り）。置き場には親の記録（`request.json`）、配送との結び付け
（`delivery.json`）、子の回答（`answer.json`）が残り、受け口のhookが走った印（`hook.json`）が無かった。
配送の記録は`sending`のまま変わらなかった。

重なっていた原因は2つ。

1. **誤りの返りでは、Claude Code親の受け口が出来ない。** Claude Codeは、道具の返りが誤りの時に`PostToolUse`のhookを
   走らせず、`PostToolUseFailure`のhookだけを走らせる（2.1.291の実物で確認。小さなMCPサーバーの成功の道具と誤りの
   道具で、`PostToolUse`は1回と0回、`PostToolUseFailure`は0回と1回）。Aitermの受け口は`PostToolUse`の
   `asyncRewake` hookなので、誤りで返すと受け口が出来ない。返りの本文は「回答本文は自動配送する。回収は不要」と
   案内しているので、親は来ない配送を待つ。
2. **動いているClaudeを、入力待ちと読んでいた。** Claude Code（Linuxの2.1.291、Macの2.1.289、Windowsの2.1.290で
   確認）は、複数行のprompt（貼り付けの形で入る）を送った後の約8秒、足元の行を`paste again to expand`へ置き換える。Aitermが動作中の印にしていた
   `esc to interrupt`がその間は画面に無く、動いているturnを`idle`／`composer_ready`と読んだ。3秒の確認は必ず
   外れ、複数行のpromptを付けたClaudeの子の起動は、毎回`submitted_unconfirmed`になった。同じ間、`pty_observe`も
   `idle`を返した。1行のpromptでは起きない（本番で、同じ形でもう1回起こした短いpromptの子には回答が届いた）。

Codex・Grok・Cursorの子は、同じ長さのpromptで開始を確認できた（実物）。

## 判断

### 開始未確認の返りを誤りにしない

`submitted_unconfirmed`で普通に返る起動は、`isError`を付けない。状態は`initial_prompt`（`status`・`reason`）と
本文で伝える。本文には次の案内を足す。

> 注意: turnの開始は未確認（reason=…）。promptは入力欄を離れているので、再送もagentの起動し直しもしない。
> 開始していれば結果は上の方法で届く。確かめる時は pty_observe(session) で状態を見る。

- 理由の1つ目は、上の配送。配送を登録したままの返りを誤りにすると、Claude Code親はその回答を受け取れない。
- 理由の2つ目は、誤りの印が親を誤らせる事。promptは送ってあり、たいていturnは動いている。誤りで返すと、
  親のAIは同じ依頼でもう1つ子を起こしやすい。READMEは前から「未確認のpromptを再送せず、返ったcursorで観測する」と
  書いている。返りの形をそれに合わせる。
- `reason`が`start_unconfirmed`以外（確認の間に子が誤りや上限で終わった、応答が要る画面が出た）でも同じにする。
  子が誤りで終わった時は、その結果が配送で親へ届く。受け口が要るのは同じ。

送信の途中で失敗した起動（例外で返る道。promptが入力欄に残った、利用者のhookが拒否した、など）は、今までどおり
誤りで返す。この道は配送を失敗として閉じてから返すので、届かない配送を親に待たせない。

別端末（`remote`）の起動は、現地が旧版（0.54.0以前）で誤りを返しても、手元では誤りにしない。送信の途中で失敗した
起動も同じ`status`を持つので、起動そのものが普通に返った形（`startup`が`ready`／`composer_ready`）と組で見分ける
（`launchStartUnconfirmed`）。現地の本文に案内が無ければ、手元で足す。

### Claude Codeの動作中を、入力欄の上の進行行でも読む

Claude Codeは動いている間、入力欄の上へ進行行を出し続ける。足元の行が別の知らせに置き換わっても、この行は残る。

```
✻ Swirling… (running UserPromptSubmit hook · 0s)
* Swirling…
✶ Slithering… (3s · ↓ 225 tokens · thought for 2s)
✢ コマンド実行中… (12s · ↓ 1.0k tokens · thinking)      作業の一覧を使う時は、進行中の項目の文になる
  ⎿  ◼ 下の命令を1回だけ動かす                         一覧は進行行と入力欄の間へ字下げで並ぶ
✻ Simmering… (running Stop hooks… 2/3 · 23s · ↓ 1.4k tokens · thinking)
```

終わると、同じ位置が`✻ Cogitated for 11s · done 4:45 AM`へ変わる。

`claudePaneObservation`は、今までの`esc to interrupt`に加えて、次の時も`busy`／`turn_running`を返す
（`claudeTuiBusy`）。

- 入力欄（最後の`❯`行で、すぐ上が罫線）を見つける。
- その罫線から上へ、空行と字下げの行を飛ばし、行頭から始まる最初の行を見る。
- その行が「行頭の回る記号（`·✢✳✶✻✽*∗`）＋空白＋文＋`…`」で、後ろが行末か括弧だけなら、進行行。
  文には`·`を含めない（完了の行は`·`で区切り、`…`が無い）。

会話欄の行は進行行にならない。回答は`●`で始まり、依頼文は`❯`で始まり、続きの行と道具の出力は字下げされる。

## 退けた案

- **`PostToolUseFailure`にも受け口を登録する**（誤りの返りでも受け口が出来るようにする）: 実物で、このhookが
  `tool_use_id`と`session_id`を受け取り、`asyncRewake`で親を起こせる事は確かめた。採らなかった理由は3つ。
  誤りの印が親に子を起こし直させる害は残る。hookの登録（共通パッケージ`aiterm-steer-delivery`と、導入済みの全ての
  端末・席の設定）を変える必要がある。`PostToolUseFailure`を知らないClaude Codeの版で、設定がどう読まれるかを
  確かめていない。
- **確認の時間（3秒）を延ばす**: 画面の読み違えが元なので、延ばしても外れる（貼り付けの知らせは約8秒出る）。
  起動の返りが遅くなるだけになる。
- **Claudeの子へ、promptを受けた時のhook（`UserPromptSubmit`）を足して開始を記録する**: 画面に頼らず開始を
  確かめられるが、子の全てのturnにhookの起動が1つ増える。画面の読み方を直せば足りる間は入れない。
- **`esc to interrupt`を見る範囲を足元の行へ絞る**: 会話欄にこの語があると動作中と読む弱さは前からある。
  今回の不具合とは別なので、この変更には混ぜない。

## 影響

- `agent_launch`の返りで、`initial_prompt.status`が`submitted_unconfirmed`の時に`isError`が付かなくなる。
  誤りの印でこの状態を見分けていた呼び出し側は、`initial_prompt.status`を見る。BellTeamはpromptなしで席を
  起こすので、この返りを受けない。
- Claude Codeの`pty_observe`は、足元の行が置き換わっている間も`busy`を返す。
- Claudeの差し込みか新しいturnかの振り分けは、前から画面でなく自前のturnの印で決めている。変わらない。

## 確かめ

- 試験: 動作中の表示を出さない偽のCodexで、`agent_launch`が誤りにならず、本文と`initial_prompt`で未確認を伝える事。
  見分けの関数が、送信の途中で失敗した起動を未確認と数えない事。Claude Code 2.1.291の実画面（貼り付けの知らせの
  間の進行行、経過時間の無い進行行、作業の一覧、終わりのhook）を`busy`、完了の行・作業の一覧のまとめ・`…`で終わる
  回答・字下げされた進行行の引用・通常shellを`busy`にしない事。
- 実画面の通し: 実物のClaude Code 2.1.291を3つの形のprompt（1行・複数行・作業の一覧）で動かし、起動から完了までの
  画面を約0.15秒おきに採った（251場面）。0.54.0の判定と直した版の判定へ通した。貼り付けの知らせの間の81場面が
  `idle`から`busy`へ変わり、`busy`から変わった場面は0。進行行が一瞬消えた1場面は、どちらの版も`idle`。
- 実物の親子（Claude Code 2.1.291の親、Claude Codeの子、複数行のprompt、専用の置き場）:
  - 0.54.0: 起動の返りは誤り。子は回答を終えたが、親には届かなかった。配送は`sending`、`hook.json`なし（本番と同じ形）。
  - 誤りにしない直しだけの版: 起動の返りは誤りでなく（`submitted_unconfirmed`のまま）、回答が親へ届いた。配送は`submitted`。
  - 両方の直しを入れた版: 起動の返りは`started`／`turn_running`で、回答が親へ届いた。
- 実物の子（専用の置き場、`pty_observe`を1秒おき）: 直した版は、複数行のpromptでも送ってから完了まで`busy`、
  完了の後は`idle`。0.54.0は、送ってから約8秒`idle`。
- 3つのOS（手元は直した版、現地は0.54.0。`remote`付きで現地のClaudeの子を複数行のpromptで起こした）:
  rabbit（Linux、Claude Code 2.1.291）・macbook（Mac、2.1.289）・fox（Windows、2.1.290）の3台とも、現地は
  `submitted_unconfirmed`を返し、手元の返りは誤りにならず、未確認の案内が付いた。動いている間の現地の画面
  （3台で26場面）を手元の判定へ通すと、貼り付けの知らせの間も`busy`、完了の行で`idle`になった。現地の0.54.0の
  `pty_observe`は、その間`idle`を返した。Windowsでは`✶ Choreographing… (running UserPromptSubmit hooks… 2/3 · 3s)`の
  形も出た（括弧の中に`…`がある）。
- Codex・Grok・Cursorの子は、0.54.0で複数行のpromptの開始を確認できている（実物、各1回）。この3つの読み方は変えていない。

## 見ていない事

- 貼り付けの知らせが、Claude Codeのどの版から出るか。進行行の形は、2026-09-28の本番の画面
  （`✶ Wrangling… (5s · ↓ 402 tokens)`）でも同じだった。
- MacとWindowsで、直した版そのものを現地で動かす事（現地の画面を手元の判定へ通した所まで）。公開の後、3台を
  更新してから現地で確かめる。
- 開始未確認のまま、子が本当に始まらなかった時の実物。この時は配送が来ない。本文の案内どおり`pty_observe`で確かめる。
