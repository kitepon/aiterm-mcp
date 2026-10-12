# ADR 0113: 自分のNodeを起こす時と渡す時は、今ある場所を使う（起きた時の版つきの場所を使わない）

状態: 採用。

## 原因

長く動くprocess（MCP process）が、補助のprocessを起こす時と、呼び手へ「起こす先」を渡す時に、`process.execPath`を使っていた。
`process.execPath`は、起きた時のNodeの実体の場所。Homebrewは版ごとの場所（`…/Cellar/node/<版>/bin/node`）へ入れ、
更新で前の版を消す。更新の前から動いているprocessは、無くなった場所を指したままになる。

2026-10-12 03:01、MacでNodeが26.10.0_1から26.11.1へ上がった。その時に動いていたAitermのMCP processは19個で、全部が
`/opt/homebrew/Cellar/node/26.10.0_1/bin/node`から起きていた。この19個は、次の3つを黙って失敗していた（起こす所は誤りを握って続けるので、
MCP processは落ちない）。

- 不具合の記録と送信の係（`runtime-error-store`・`runtime-error-report`）。`diagnostics`の`runtime_error_store`は`unverified`になる。
- 呼び手へ渡す待ち受けの起動先（`wait_process.executable`）。Cursorの親へ渡す分も同じ。呼び手が起こすと、無いfileで失敗する。
- 共通部品の中の、止まったCodexの会話を起こす見張り（`startCodexWakeWatch`）。

設定へ書き込む起動先（MCPの登録、hook）は、前から更新でも残る場所（`…/opt/node/bin/node`）へ直してある（`setupNodeExecutable`・
`hookNodeExecutable`）。動いている最中に使う場所だけが残っていた。同じ日に、通話の道具が控えていた版つきの場所でも同じ事が起き、
席を立てられなくなった（Aitermの外の持ち物）。

## 決めた事

`liveNodeExecutable()`（`src/live-node.ts`。共通部品0.4.6にも同じ名前・同じ決まりの関数を足す）を、使う時に呼ぶ。

1. Homebrewの版つきの場所なら、同じformulaの`opt`（更新でも残る）を返す。実体がまだある時も同じ（渡した先が、更新の後に使う事がある）。
2. それ以外は、`process.execPath`がある時はそのまま返す。
3. 実体が消えていて代わりも無い時（版ごとの場所へ入れるほかの道具で、前の版を消した時）は、`node`を返してPATHから探させる。

使う所: 待ち受けの起動先（`agentWaitProcess`・Cursorの受け口）、不具合の記録と送信の係、`aiterm-parent-delivery`が返す自分の場所と、
起こすCodexへ渡すPATH。

## 確かめ

- 本物のNodeの写しでHomebrewの並び（`Cellar/node/<版>`と`opt/node`）を作り、動いているprocessの足元で版を上げて前の版を消す試験
  （`test/live-node.test.mjs`。LinuxとmacOS）。直す前は、待ち受けの起動先が`ENOENT`、記録の係の確かめが`unverified`。
- Macの実物（Node 26.11.1。`opt`から起こすと`process.execPath`は`Cellar/node/26.11.1`）で、関数が`/opt/homebrew/opt/node/bin/node`を返す事を見た。

## 変えなかった事

- 引数と返りの形。Homebrewの端末では、`wait_process.executable`と`aiterm-parent-delivery provider`の`node`の値が、
  `…/Cellar/node/<版>/bin/node`から`…/opt/node/bin/node`になる。ほかの端末では同じ値。
- 設定へ書き込む起動先（`setupNodeExecutable`・`hookNodeExecutable`）。
- Windowsだけで使う所（psmuxの係）と、すぐ終わる命令（`aiterm-update`）。Windowsの入れ方は同じ場所へ上書きする。

## 直らない物

- この版より前から動いているprocess。開き直した会話から効く。
