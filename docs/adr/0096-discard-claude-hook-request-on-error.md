# ADR 0096: 誤りで返す呼び出しの置き場は、Aitermが返す前に消す

状態: 採用。

## 原因

Claude Code親への配送は、道具の呼び出し1回につき置き場を1つ作る（Aiterm stateの
`claude-parent-hooks/<tool_use_id>/`）。`PreToolUse`のhookが親の記録（`request.json`）を置く。配送を結ばなかった
呼び出しの置き場は、`PostToolUse`のhookが消す（ADR 0094）。

道具の返りが誤り（`isError`）の時、Claude Codeは`PostToolUse`を走らせない（ADR 0093）。この呼び出しは
`request.json`だけの置き場を残す。ADR 0094は、この残りを「1日残してから、次の依頼のhookが消す」と決めた。

- 連携元（BellTeam）の本番で、この残りを見た（2026-10-06、0.55.2、Claude Code 2.1.291）。Claude Codeの親が
  `agent_launch`を`harness: "claude-code"`と`write_scope`で呼び、Aitermが「claude-code harnessはwrite_scopeに
  対応していません」で断った回の置き場である。3秒後に同じ頼みを`write_scope`なしで呼んだ回の置き場は、回答が
  届いた時に消えていた。
- 残りは208バイトで、害は無い。1日たてば見回りが消し、LinuxとMacでは再起動でも消える。
- ただし、この呼び出しを誤りで返したのはAiterm自身である。返す時点で、受け口のhookが走らない事も、配送を
  結んでいない事も分かっている。1日待つ理由が無い。誤りで返る呼び出しは普段から出る（引数の誤り、無い席への
  送信、順番待ちの断り）。

## 判断

Aitermは、道具の返りを誤りにする時、配送を結んでいない依頼の置き場を、返す前に消す。

- 消す処理は共通パッケージ（`aiterm-steer-delivery` 0.2.3）の`discardClaudeHookRequest`に置く。置き場の形を
  知っているのは共通パッケージである。Aitermは依存を`^0.2.3`へ上げる。
- 消すのは、配送を結んでいない置き場（`delivery.json`が無い）だけ。配送を結んだ後に誤りで返した呼び出しの
  置き場は残す。送り手が待っているか、届かなかった時に原因を調べる材料になる（ADR 0094のまま、見回りが後で消す）。
- 呼び出し元がClaude Codeでない時、MCP要求に`claudecode/toolUseId`が無い時、その番号の置き場が無い時、
  この製品の依頼の記録でないfileが入っている時は、何もしない。
- 片付けの失敗で道具の返りを変えない。消せなかった置き場は、今までどおり見回りが消す。

### 見る場所は、toolごとのhandlerではなく`tools/call`の返り

MCPの土台（`McpServer`）は、入力の検査の失敗、handlerの例外、出力の検査の失敗も、誤りの返りへ変える。この変換は
toolごとのhandlerの外で起きる。Aitermは`tools/call`のhandlerを1か所で包み、返りが誤りなら片付ける
（`src/index.ts`）。`McpServer`がそのhandlerを置くのは最初のtoolを登録する時なので、その前に包む。

## 退けた案

- **toolごとのhandler（`fail`の中、または`registerTool`）で消す**: `McpServer`が作る誤りの返りを通らない。
  「Aitermが誤りで返した呼び出しは置き場を残さない」と言い切れなくなる。
- **`PostToolUseFailure`のhookで消す**: hookの登録（全席が共有する`~/.claude/settings.json`）に新しい種類を足す
  変更になる。連携元が頼っている`mergeClaudeParentHooks`を変える。知らない種類のhookを古いClaude Codeがどう読むかも
  見ていない。この道は、Claude側で断られた呼び出しと打ち切られた呼び出しにも効くので、別の件として残す。
- **配送を結んだ置き場も消す**: 原因を調べる材料が無くなる（ADR 0094）。
- **受け口のhookを、置き場が無い時に黙って終わる形へ変える**: 誤りの返りで受け口のhookは走らないので、要らない。
  hookの動きは変えない。

## 影響

- Aitermが誤りで返した呼び出しは、配送を結んでいなければ、置き場を残さない。
- 置き場が1日残るのは、次の3つになる。Claude Codeが自分で断った呼び出し（引数が道具の定義に合わず、Aitermへ
  届かない）。Claude側で打ち切られた呼び出し（時間切れ、利用者の中断）。配送を結んだ後に誤りで返した呼び出し。
- この片付けは、Claude Codeが誤りの返りで`PostToolUse`を走らせない事に頼る。走らせる版では、受け口のhookが
  置き場を見つけられず、「親のhook記録がありません」と出して親を起こす。確かめた版は下に書く。
- 道具の返り、配送の記録の形、hookの登録は変わらない。setupの流し直しは要らない。Claude Code以外の親では
  何も変わらない。

## 確かめ

- 共通パッケージの試験（3つのOS、GitHubの`ubuntu-latest`・`macos-latest`・`windows-latest`、各64件で失敗0）:
  配送を結んでいない置き場が消える事（会話終了の印が先に付いていても）。配送を結んだ置き場、この製品の記録で
  ないfileがある置き場、Claude Codeでない呼び出し元、番号の無い要求、番号として読めない値、置き場の無い番号に
  触れない事。
- Aitermの試験（`test/claude-parent-receiver.test.mjs`。実物の`dist/index.js`へMCPでつなぎ、`PreToolUse`の記録を
  置いてから呼ぶ）: toolが引数を断る返り（連携元で見た形）、別のtoolが断る返り、入力の検査で`McpServer`が作る
  返りの3つで、置き場が消える事。配送を結んだ置き場と、誤りでない返りの置き場が残る事。Claude Codeでない親の
  誤りの返りでは置き場に触れない事。直しを外すと、この試験は落ちる。
- 実物の親（このコンテナ、Claude Code 2.1.291、専用の置き場。親が`agent_launch`を2回呼ぶ。1回目は断られる形、
  2回目は同じ頼みを`write_scope`なしで）: 0.55.2は、1回目の置き場が`request.json`と`closed.json`で残った。
  直した版は置き場が空で終わり、2回目の子の回答は親へ届いた（配送は`submitted`）。
- 3つのOSの実物（公開前。親のAitermだけを直した版へ向け、hookは端末に入っている0.55.2のまま。結果は親の
  会話記録から読んだ）: rabbit（Linux、Claude Code 2.1.291）・macbook（Mac、2.1.289）・fox（Windows、2.1.291）の
  3台とも、0.55.2では1回目の置き場が残り、直した版では残らなかった。どちらの版でも、1回目の返りは誤りで、
  2回目の子の回答は届き、誤りの返りの後に受け口のhookの声は親へ届かなかった。

## 見ていない事

- 2.1.289より古いClaude Codeが、誤りの返りで`PostToolUse`を走らせないか。
- 順番待ちの断り（`AGENT_SEND_BUSY`）など、配送を用意した後で断る返りを、実物の親から出す事（試験では、
  配送を結んだ置き場を残す事と、結んでいない置き場を消す事を別々に見ている）。
