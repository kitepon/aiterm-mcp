# ADR 0114: ファスト（高速の応答）は席ごとに切り替え、席は必ず通常の速度で起こす

状態: 採用。

## 経緯

各harnessには、費用や利用量を多く払って応答を速くする切り替えがある（ここでは「ファスト」と呼ぶ）。
複数の仕事を受け持つ席が、忙しい間だけファストへ切り替え、落ち着いたら戻せるようにする。既定では使わない。

2026-10-12に、4つのharnessの切り替えを実物で読んだ（Claude Code 2.1.296、Codex 0.162.1、Grok 1.0.50、Cursor 2026.10.01）。

| harness | 動いている席の切り替え | 利用者の既定への書き込み | 画面で分かる事 |
|---|---|---|---|
| Claude Code | `/fast on`・`/fast off` | `~/.claude/settings.json`へ`fastMode: true`を書く／消す。もう off でもfileを書き直す | 結果の行「Fast mode ON …」「Fast mode OFF」「Fast mode unavailable: …」 |
| Codex | `/fast`（入り切りの交互。引数は無い） | `~/.codex/config.toml`へ`service_tier = "fast"`か`"default"`を保存する | 「Service tier set to priority」「Service tier set to default」。足元にも`/status`にも今の段は出ない |
| Grok | `/model <fast版のID>`（fastは別のmodel） | `~/.grok/config.toml`の`[models]`の`default`と`default_reasoning_effort`を書き換える。**起動の`--model`でも書く** | 「✓ Default model: Grok 4.7 Fast」、足元の「Grok 4.7 Fast (high)」 |
| Cursor | `/model`→Tab→「Fast」の行でEnter→Esc→Enter | 無い | パラメータの画面の`◯ Fast`／`◉ Fast`、見出しの「Codex 5.3 Low Fast」 |

harnessは、切り替えを利用者の好み（次の会話にも残る既定）として扱う。そのまま使うと、1つの席の切り替えが、同じ端末のほかの席と、
利用者自身の次の会話へ漏れる。全席が1つのHOMEを使う端末では、漏れた先の全部がファストで流れる。

起動時の指定にも落とし穴があった。

- Codexは、何も指定しないと、利用者のconfigの`service_tier`と、modelの既定の段で流れる。既定の段がFastのmodelがある
  （Codexに組み込みの表の`gpt-6-sol`・`gpt-6-luna`）。
- Codexを`-c service_tier=fast`で起こすと、後で`/fast`で戻しても、番ごとの補助の問い合わせ（題名づけの類）はFastのまま残る。
  偽のmodelで問い合わせごとの`service_tier`を控えて確かめた。`/new`の後も残る。
- Claude Codeは、`--settings`で渡した設定に`fastMode: true`があると、後で`/fast off`にしても、機種を替えた時にその値を見てファストへ戻す
  （実行fileの中の作りで読んだ。対話の画面の`/fast`は会話の状態だけを替え、設定からの決め直しは機種の替えの時に走る）。
- Claude Codeは、ファストに対応していないmodelで`/fast on`を受けると、機種をOpusへ替える。

## 決めた事

1. **席は必ず通常の速度で起こす。** `fast`を渡さない起動と`fast: false`の起動は同じ。
   - Claude Code: 席ごとの設定（`--settings`で渡しているfile）へ`fastMode: false`を入れる。`--settings`は利用者の設定より強いので、
     利用者の設定に`fastMode`が残っていても、席は通常で始まる。
   - Codex: `-c service_tier=default`を付ける（`default`は「通常の速度を選んだ」印で、modelの既定の段も効かなくなる）。
   - Grok・Cursor: 渡すmodel IDがfast版でない事。Grokは起動時に必ず`--model`を渡す。
2. **`fast: true`の起動は、通常で起こしてから、その席で切り替える**（Claude Code・Codex）。起動の引数や席ごとの設定でファストにしない
   （上の落とし穴）。CursorとGrokは、起動時のmodel IDをfast版にする（その会話だけの指定）。
3. **harnessが利用者の既定へ書いた分は、切り替えの直前の値へ戻す。**
   - Codex: 公式の口（App Serverの`config/batchWrite`）で`service_tier`を戻す。戻しても、切り替えた席の段は保たれる。
     公式の口で戻せない時は、config.tomlのその1行だけを直す。
   - Claude Code: `settings.json`の`fastMode`を戻す。ほかの項目の値が前と同じなら、前の中身をそのまま書き戻す
     （Claude Codeは書く時に項目の並びを変える）。ほかの項目も変わっていたら、`fastMode`だけを直す。
   - Grok: `config.toml`の`[models]`の`default`と`default_reasoning_effort`を戻す。**起動の前後でも戻す**（起動が既定を書くため）。
     `agent_configure`でmodelやeffortを替える時も同じ（今までは、替えた値が利用者の既定に残っていた）。
   - Cursor: 書き込みが無いので、戻しも無い。
4. **読む→切り替える→戻すは、設定fileごとの鍵で1つずつにする**（`withUserConfigLock`）。2つの席が同じ頃に切り替えると、
   後の席が読む「直前の値」が先の席の書いたファストになり、それへ戻すとファストが利用者の既定に残る。鍵は設定fileの隣
   （`<設定file>.aiterm-lock`）に作る。Aitermの置き場はprocessごとに変えられるが、設定fileの場所は全員が同じに見る。
   落ちたprocessの鍵は、2分で次の人が引き取る。
5. **席の今の状態は、席の控え（`fast`）に持つ。** 起こした時と、切り替えを画面で確かめた時にだけ書く。
   - Codexの画面には今の段が出ないので、控えが、Aitermの知る今の状態。控えと同じ向きを頼まれたら何も打たない。
     控えと実際が違っていた時（席で人が切り替えた）は、1回目の`/fast`が逆へ動くので、結果の行を読んでもう1回打つ。
   - Claude Codeは、もう通常の速度の席へ`fast: false`を頼まれたら何も打たない（`/fast off`は、もう off でも利用者の設定を書き直す）。
   - Cursorは見出しのmodelの表示、Grokは足元のmodelの表示で、実際の状態を読む。
6. **対応の有無は、harnessが返す値で決める。** Aitermの表は持たない。
   - Claude Code: `initialize`の応答のmodelごとの`supportsFastMode`。一覧の値（`opus`等）に加えて、実体のID（`resolvedModel`）でも引ける。
     席ごとの設定へ`fastMode: true`を付けて聞くと、応答の`fast_mode_disabled_reason`が「このアカウントで使えない訳」になる。
   - Codex: `model/list`のmodelごとの速度の段に、名前がFastの段がある（CodexのTUIの`/fast`と同じ見方）。
   - Grok: 一覧で表示名が「<元の表示名> Fast」のmodelを、その元のmodelのfast版と読む。
   - Cursor: 一覧の`<元>[-<effort>]-fast`。動いている席は、パラメータの画面のFastの行の有無。

## 公開の形

- `agent_launch`・`agent_configure`の引数`fast`（真偽、省略可）。
  - `agent_launch`: 省略とfalseは通常の速度。trueは通常で起こしてから切り替える。
    modelへfast版のIDを直に書いて省略した時だけ、そのIDのまま起こす（今までの呼び手を壊さない）。
  - `agent_configure`: 省略は、その席の今の状態を変えない。`fast`だけの指定も受ける。
    Grokでmodelを替える時、省略なら席の今のファストを引き継ぐ（替えた先にfast版が無ければ通常になる）。
- 返りの`fast`（切り替えた後の実際の状態）。`agent_configure`は、Aitermが確かめた事の無い席（前の版が起こした席）でnull。
- `agent_launch`の返りの`fast_error`（`{ code, message }`かnull）。
- `agent_models`: modelごとの`fast`（真偽）。fastが別のmodel IDのharness（Cursor・Grok）は、fast版を別のmodelとして並べず、
  元のmodelの`fast: true`にする。最上位の`fast_unavailable`（`{ code: "FAST_MODE_UNAVAILABLE", message }`かnull）は、
  アカウントの都合でどのmodelでも使えない時の訳（harnessが先に答えられる時だけ。今はClaude Code）。
- 断りの符号（4つのharnessで共通。文の先頭に付く）。どれも、何を変えていないかを文に書く。
  - `FAST_MODE_NOT_SUPPORTED`: そのharness・そのmodelはファストへ切り替えられない（trueの時だけ。falseは対応していないmodelでも受ける）。
  - `FAST_MODE_UNAVAILABLE`: アカウントや契約で使えない。harnessの出した文を添える。
  - `FAST_MODE_MODEL_CONFLICT`: modelへfast版のIDを書いて、falseを渡した。
  - `FAST_MODE_UNCONFIRMED`: 切り替えた後の状態を画面で確かめられない。
- **起動でファストへ出来なかった時**: `FAST_MODE_NOT_SUPPORTED`と`FAST_MODE_MODEL_CONFLICT`は設定の誤りなので、席を作る前に断る。
  `FAST_MODE_UNAVAILABLE`と`FAST_MODE_UNCONFIRMED`は、起動を断らずに通常の速度で起こし、返りを`fast: false`、`fast_error`に訳を入れる
  （credits切れ等で起動まで断ると、呼び手の席が起きず、届いた文が落ちる）。`agent_configure`は4つとも断る。

## 一緒に直した事（今のCursorで、設定替えの後に席が入力待ちと読めなくなる）

Cursor 2026.10.01は、`/model`の選ぶ画面を閉じても入力欄の行を描かない（選ぶ画面の「Filter:」の行が残り、鍵が1つ入るまでそのまま）。
まだ番を流していない席では、見出しの「Cursor Agent」も画面の外へ流れる。0.58.4の`agent_configure`は、effortを替えた後に
「変更完了を確認できません」で返り、その席への次の送信は「入力待ちではありません」で断られていた（替え自体は効いている）。

- 選ぶ画面を閉じた後、空白を1つ打って消し、入力欄を描き直させる（入力欄は空のまま）。
- 入力欄の案内（Plan, search, build anything）があれば、見出しが画面に無くても入力待ちと読む。
- `/model`の画面の今の姿（選ぶ画面・パラメータの画面・閉じた）は、画面の最後の行（操作の案内）で読む。
  Cursorは閉じた画面の行を消さないので、文字の有無では、前に開いた画面を今の物と読み違える（同じ席で2回目の設定替えが外れる）。

## 確かめ

- Codex 0.162.1: 一時のCODEX_HOMEと偽のmodel（問い合わせごとの`service_tier`を控える）で、起動時のfast・動いている席の入り切り・
  番ごとの段・利用者のconfigが切り替えの後も元のままである事を見た（`tools/aiterm-probe/codex-fast-probe.mjs`）。
- Grok 1.0.50: 一時のGROK_HOMEの本物の席で、fast版での起動・入り切り・modelとeffortの替えのたびに、`[models]`の2つの既定が元へ戻る事を見た。
- Cursor 2026.10.01: 本物の席で、fastの起動・入り切り・effortの替え・対応していないmodelの断りを見た。`cli-config.json`は前後で同じ。
- Claude Code 2.1.296: 本物の席で、アカウントで使えない時（usage creditsが無い）の起動（通常で起きて`fast_error`が入る）と
  `agent_configure`の断り、対応していないmodelの断りを見た。利用者の`settings.json`は前後で同じ。
  **ファストへ入る所は、usage creditsが要るので本物では見ていない。** 実行fileの中の作りを写した模したClaude Code
  （`/fast on`で利用者の設定へ`fastMode`を書き、項目の並びを変え、結果の行を出す）で通した（`test/fast-mode.test.mjs`）。

## 変えなかった事

- harnessの切り替えの命令そのもの（`/fast`、`/model`）。Aitermは、harnessの標準の操作を打つ。
- Claude Codeの`fastModePerSessionOptIn`には頼らない（利用者の設定へ置く物で、Aitermは置かない）。
- Codexの`/model`の選択が利用者の既定のmodelとeffortを保存する件は、この決定の範囲の外（同じ仕組みで戻せる）。
