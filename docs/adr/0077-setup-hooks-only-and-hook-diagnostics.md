# ADR 0077: hookだけの登録と、親配送hookの診断を分けて足す

状態: 採用。

## 原因

BellTeamのコンテナは起動時にAitermのMCPを全利用者へ登録するが、`aiterm-setup`は実行していなかった。
Claude Codeの親配送hookが無いため、`agent_launch`と`pty_send`が`CLAUDE_PARENT_HOOK_UNAVAILABLE`で拒否され続けた。
調べると3つの穴があった。

1. `diagnostics`はhookを見ず、hookが無くても`overall: "ready"`を返した。
2. npmのprefixを利用者ごとの場所へ向けた環境では、`npm root -g`が共通の導入先を指さず、
   `aiterm-setup`が`global_package_failed`で失敗した。
3. `aiterm-setup`にhookだけを登録する入口が無かった。全体を実行すると`codex mcp add`と`grok mcp add`が登録を作り直し、
   管理側が足した`startup_timeout_sec`と`tool_timeout_sec`が消えた。同じ登録の再実行でも毎回作り直していた。

## 判断

### 診断は2つ目のtextへ分ける

`aiterm-mcp.factory-diagnostics.v1`は、dotagentsの工場が最上位と各項目の鍵を完全一致で検査している。
項目を足すと既存の読み手が壊れるため、1つ目のtextは項目も`overall`の意味も変えない。
親配送hookの状態は`aiterm-mcp.parent-delivery-diagnostics.v1`として2つ目のtextで返す。

- Claude CodeとCursorそれぞれに`status`（`ready`／`setup_required`／`not_applicable`／`unverified`）と`reason_code`を返す。
- Claude Codeは、`aiterm-setup`が登録するeventのすべてに当製品のhook入口があり、その入口が実在する時だけ`ready`とする。
  Cursorは配送時と同じ判定（`cursorParentHooksRegistered`）を使う。
- `caller_status`は呼出元のclientの状態を示す。呼出元がそのclient自身なら、CLIを解決できなくても設定を読む。
  それ以外の未検出clientは`not_applicable`とする。
- 読むのは利用者設定だけで、project設定と管理設定は見ない。`aiterm-setup`が登録する場所と同じである。
- 設定の本文、path、環境値は返さない。修復は行わず、`aiterm-setup`の実行を案内する。

### global packageの定義を広げる

登録するのはglobal導入した当packageだけ、という条件は変えない。導入先として、npmの現在のglobal rootに加え、
実行中のNodeの既定のglobal root（POSIXは`<nodeの親の親>/lib/node_modules`、Windowsは`<nodeの親>/node_modules`）を認める。
どちらにも属さない時の失敗は従来の形のまま返す。npm一時cacheとsource checkoutは登録しない。

### hookだけの入口と、同じ登録の保持

- `aiterm-setup --hooks-only`はClaude Code・Cursorの親配送hookだけを登録する。clientの検出条件、Claude Codeの版の確認、
  hookの中身は通常のsetupと同じで、依存準備、端末の実動作確認、MCP登録、Codex Steerには触れない。
  結果は`aiterm.parent-hooks-result.v1`で返す。部分失敗と全client未検出を成功にしない。
- CodexとGrokは、既存の登録のcommandとargsが同じなら公式CLIの追加を実行しない。公式CLIの一覧がそのまま読戻しになる。
- commandが異なる登録（素の`aiterm-mcp`など）は従来どおり作り直す。PATHに依存しないNodeと入口の絶対パスへ揃えるのが
  setupの役目であり、その時に追加項目が落ちるのは公式CLIの挙動である。管理側が登録を所有する環境は`--hooks-only`を使う。

## 検証

`test/parent-hook-diagnostic.test.mjs`が、未登録、他製品のhookだけ、eventの欠け、無効化、入口の消失、読めない設定、
呼出元ごとの`caller_status`を試験する。`test/setup.test.mjs`がglobal rootの判定と`--hooks-only`の結果を、
`test/setup-integrations.test.mjs`が同じ登録を作り直さないことと、hookだけの登録がMCP登録を作らないことを試験する。
`test/smoke.test.mjs`が、1つ目のtextの項目が変わらないことと2つ目のtextの形を確かめる。
