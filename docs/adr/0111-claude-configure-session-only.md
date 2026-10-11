# ADR 0111: Claude Codeの席のmodel／effortは、その会話だけで替える（端末の既定を書き換えない）

状態: 採用。

## 原因

`agent_configure`は、Claude Codeの席へ`/model <名前>`と`/effort <値>`を打っていた。Claude Code（2.1.296のmacOSで見た。2.1.293のLinuxも
同じ画面）は、この2つで選んだ値を、端末の`~/.claude/settings.json`へ「新しい会話の既定」として保存する。

- `/model claude-opus-5-5` → `"model": "claude-opus-5-5"`。画面の返りは「Set model to Opus 5.5 and saved as your default for new sessions」。
- `/effort high` → 末尾に`"modelSettings": { "claude-opus-5-5": { "effortLevel": "high" } }`。最上位の`effortLevel`は変わらない。
  画面の返りは「Set effort level to high (saved as your default for new sessions)」。

1つの席の機種を替える操作が、その端末でこの後に引数なしで立つ全部のClaude Codeの既定を変えていた。利用者が自分で決めた既定も上書きする。
2026-10-12、Macの試しの席へ`agent_configure`を流して、利用者の`settings.json`の`model`が`sonnet`から`claude-opus-5-5`へ変わったのを見た
（その場で戻した）。全席が同じ置き場を使うコンテナの`settings.json`にも、`modelSettings`が入っていた。

## 決めた事

Claude Codeの席では、`/model`を引数なしで開いた選ぶ画面を1歩ずつ読んで、保存しない選び方を打つ。

```
  Select model
  Switch between Claude models. Your pick becomes the default for new
  sessions. For other/previous model names, specify with --model.
  ↑ 2.  Opus 5.5               For complex work and everyday tasks
  ❯ 4.  Sonnet 5.5 ✔           Most efficient for simpler tasks
     … +9 models
  ◐ Medium effort (default) ←/→ to adjust
  Enter to set as default · s to use this session only · Esc to cancel
```

1. **行を選ぶ。** `model`は、catalogのID（`claude-opus-5-5`→「Opus 5.5」）、別名（`opus`→その系統で番号が一番若い行）、表示名のどれでも受ける。
   見えていない行は、下へ送りながら集める（13行で一周する。端で止まる版でも動く）。`model`を省いた時は、今のmodelの行（開いた時の行）のまま。
2. **effortを合わせる。** ←/→で1段ずつ動かし、画面の表示（Low／Medium／High／xHigh／Max）が頼まれた値になるまで読む。
   `reasoning_effort`を省いた時は触らない。
3. **`s`（use this session only）を押す。** Enter（set as default）は押さない。打つ直前に、行・effort・`s`の案内をもう1度読む。
4. **会話がcacheされている席の確かめを進める。** 「Switch model?」が出て、1番（Yes, switch to …）が選ばれている時だけEnterを押す。
5. **閉じた後の知らせを読む。** 「… for this session only …」を見て成功とする。「saved as your default」と返った時は、誤りで返す
   （`CLAUDE_MODEL_SAVED_AS_DEFAULT`）。

選べない時は、選ぶ画面をEscで閉じて、何も変えずに断る。断りの文は「modelとreasoning_effortは変えていません。」で終わる。

| 符号 | 場面 |
|---|---|
| `CLAUDE_MODEL_SESSION_ONLY_UNAVAILABLE` | 選ぶ画面に`s to use this session only`が無い（古い版、管理された設定）。既定を書き換える選び方へは落ちない |
| `CLAUDE_MODEL_NOT_IN_PICKER` | 選ぶ画面に無いmodel。文に選べる機種の名前を並べる |
| `CLAUDE_EFFORT_NOT_SELECTABLE` | effortに対応しないmodel（Haiku 4.5）、そのmodelに無い段（Opus 4.6のxhigh） |
| `CLAUDE_MODEL_PICKER_NOT_SHOWN`・`CLAUDE_MODEL_PICKER_UNREADABLE`・`CLAUDE_MODEL_SWITCH_UNCONFIRMED` | 画面が想定と違う |
| `CLAUDE_MODEL_SWITCH_REFUSED` | Claude Codeが切り替えなかった（hookが止めた、など） |

- Escは、選ぶ画面か確かめの画面が出ている間だけ打つ。入力欄へ戻った後に打つと、ほかの操作を取り消してしまう。
- キーが1つ落ちた時のために、画面が変わらなければ1度だけ押し直す。
- `reasoning_effort`が5段と`ultracode`のどれでもない時は、画面を開く前に断る。`ultracode`は選ぶ画面に出ないsession設定で、
  Claude Code自身が「this session only」と返すので、今までどおり`/effort ultracode`で送る。

## 確かめ

- Linuxの2.1.293とmacOSの2.1.296の実物で、`s`で選んだ後の次の回答が選んだ機種で返り（記録の`model`）、道具から見えるeffort
  （`CLAUDE_EFFORT`）が選んだ値になり、前の回答を覚えていて、`settings.json`が1バイトも変わらない事を見た。
- 実際に2400行を超える会話の席（macOS）で、確かめの画面を1番で進めて切り替わった。
- Aitermが席ごとに渡す設定file（`--settings`の先）へ`model`・`effortLevel`を書いても、動いている席は読み直さなかった。この道は使えない。

## 出来なくなった事

- 選ぶ画面に無いmodel（`opus[1m]`のような文脈の大きさ付きの名前、古い機種のID）は、動いている席では替えられない。
  Claude Codeの画面にも「For other/previous model names, specify with --model」とある。今までは`/model <名前>`で通っていた
  （その代わり、端末の既定へ保存されていた）。そういうmodelにする時は、席を閉じて、`agent_launch`の`model`で渡して立て直す。
- 行は表示名で探す。IDは`claude-<系統>-<版>`の形を「<系統> <版>」へ読み替える。この決まりから外れるIDは、選ぶ画面にあっても
  `CLAUDE_MODEL_NOT_IN_PICKER`で断る（今のcatalogの13個は全部対応する）。断りの文に選べる表示名が並ぶので、表示名で渡せば選べる。

## 変えなかった事

- 引数（`session_id`・`model`・`reasoning_effort`）と返りの形（`aiterm.agent-configure-result.v1`）。
- Codex・Grok・Cursorの席の動き。
- 席を立てる時の`model`・`reasoning_effort`（`claude --model`・`--effort`）。これは引数で渡るので、設定を書き換えない。
- 「この会話だけ」の替えなので、席を閉じて立て直すと端末の既定へ戻る。立て直す時は、呼び手が`agent_launch`へ同じ値を渡す。
