# ADR 0091: setupは、中継で包んだ同じ登録を書き直さない

状態: 採用。

## 原因

`aiterm-setup`（引数なし）は、4つのclientへ直結の登録（nodeの絶対path＋`dist/index.js`）を書く。

- Claude Code・Cursor: 設定のJSONの`mcpServers.aiterm`へ、`command`と`args`を上書きする（`env`は残す）。
- Codex・Grok: 公式CLIの一覧の`command`と`args`が違えば、`mcp add`で作り直す。`env`は引き継ぐが、
  Codexの`startup_timeout_sec`・`tool_timeout_sec`・`env_vars`は消える。

連携元（BellTeam）は、全席の登録を中継（`mcp-lazy`）つきにする。中継は、道具が呼ばれるまでMCPの本体を起こさない
（待機中の本体1本あたり約45MBが約4MBになる）。登録は`command=mcp-lazy`、`args=[node, dist/index.js]`、設定は`env`で渡す。

この形は直結の登録と`command`も`args`も違う。1席が引数なしの`aiterm-setup`を流すだけで、4つの設定が直結へ戻る。
設定は席で共有なので、全席の節約が、連携元が次に書き直すまで黙って消える。Codexは待ち時間と`env_vars`も一緒に消える。

## 判断

「同じ登録」の判定へ、中継で包んだ同じ登録を足す（`src/setup-integrations.ts`の`sameRegistration`）。

- 中継の見分けは、`post_startup_process_count`と同じ決まりを使う（ADR 0082）: 実行ファイルの名前が`mcp-lazy`で始まる。
  決まりは`src/lazy-relay.ts`に1つだけ置く。
- 包んでいる中身は、argsが「直結のcommand＋args」と一致する事で確かめる。中継のflagを`--`の前に置いた形
  （`mcp-lazy --cache-dir … -- node index.js`）も同じと数える。
- 一致した時は、4つのclientとも登録に触れない（`env`・待ち時間・`env_vars`を含めて、そのまま残る）。
- 包んでいる本体のpathが違う時（Aitermの置き場が変わった時など）は、今までどおり直結の登録へ書き直す。
  中継つきの登録を作るのは連携元で、setupは中継つきの登録を新しく作らない。

## 退けた案

- setupが中継つきの登録を書けるようにする: 中継の置き場・控えの置き場・判定の間隔は連携元が決める物で、Aitermは持たない。
- commandの名前だけで同じと数える: 包んでいる本体が古いAitermを指したままでも残してしまう。

## 影響

- 中継でない包み（`env`など別のcommand）は、今までどおり直結へ書き直す。
- 連携元が頼っている「CodexとGrokは同じ登録なら作り直さない」は、直結の登録については変わらない。

## 確かめ

- 試験: 判定の単体（名前・`--`の形・本体が違う時・中継でない包み）と、4つのclientの登録が中継つきのまま残る事、
  CodexとGrokで`mcp add`を呼ばない事、本体のpathが違う時に直結へ書き直す事。
