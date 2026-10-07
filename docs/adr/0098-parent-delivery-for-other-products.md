# ADR 0098: ほかの製品が、Aitermの親配送へ回答を頼む入口を持つ

状態: 採用。

## 原因

決裁箱（Approval Box）は、Codexの親へ回答を届けるために、製品専用のhook（PostToolUse／Stop）を`~/.codex/hooks.json`へ登録していた。
hookの登録より前から動いている親には届けられないので、申請を受け付ける前に「専用hookが整っているか」を確かめ、整っていなければ
申請そのものを断っていた。

- 利用者の言葉（2026-10-07）:「任意のタイミングでMCPで質問を送れて、Aiterm steerで返事を回収できる。それだけ。独自hookは不要。」
- 同じ端末のAitermは、同じ仕組みのhookを登録済みで、親への配送が成り立っていた（macOSのCodex Desktopの親で、Aitermの子の回答が
  動いている番へ届く事を、依頼元が確かめた）。止めていたのは、決裁箱の専用profileの関門だけだった。
- 製品ごとにhookを登録すると、Codexの道具の呼び出し1回ごとに、製品の数だけhookのprocessが起きる。登録の位置がずれるたびに、
  ほかの製品のhookの承認を写し直す事にもなる。

配送の仕組み（`aiterm-steer-delivery`の`submitCodexParentAnswer`）は、製品のprofileごとに所有記録の置き場とhookを分けている。
Aitermのprofileで渡せば、Aitermの登録済みhookが同じ番へ入れる。足りなかったのは、それをほかの製品が頼める入口だった。

## 決めた事

Aitermが、ほかの製品から回答を受け取って親へ届ける入口を持つ。製品はCodex用のhookを登録せず、Aitermの置き場のfileも書かない。

1. **命令`aiterm-parent-delivery`**（`src/parent-delivery-cli.ts`）。結果はstdoutへ1行のJSON。
   - `provider` → `{ok, schema, version, node, cli}`。
   - `codex verify --thread <uuid> [--codex-home <dir>]` → `{ok, schema, verified, thread, steer}`。
   - `codex submit --thread <uuid> --delivery <uuid> --text-file <file|-> [--codex-home <dir>]` → `{ok, schema, queued_submission_id}`。
   - `codex state --thread <uuid> --delivery <uuid> [--codex-home <dir>]` → `{ok, schema, state, hook, turn_id, queued}`。
   - 失敗は`{ok:false, schema, code, message, outcome_unknown}`とexit 1。`schema`は`aiterm.parent-delivery.v1`。
   - 中身は、Aiterm自身の親配送と同じ関数（`checkCodexParent`・`submitCodexParentAnswer`）。旧中継の選択が残る端末では、その道を通る。
2. **設定・受付・実際に届いた事を分けて返す。**
   - `verify`の`steer`は設定。`enabled`は、hookが登録・承認済みで、親がhookの導入後に起きている事まで確かめた時だけ返す
     （外れた時は`CODEX_HOOK_UNTRUSTED`・`CODEX_STEER_RESTART_REQUIRED`で断る）。`disabled`は公式キューだけで、番が終わってから届く。
   - `submit`の`queued_submission_id`は、公式キューの受付。
   - `state`は届き方の事実。`hook:"emitted"`と`turn_id`は、Aitermのhookがその番へ本文を入れた事。`queued`は、今も公式キューに残っているか
     （確かめられなければnullと`queue_error`）。`state`（`sending`・`unknown`・null）は今までの形。
   - 設定が整っている事を、届いた事として返さない。
3. **同じ配送idの2回目は、送らずに断る**（`PARENT_DELIVERY_DUPLICATE`）。所有記録（送る途中・hookが取り出した後）がAitermのhookの置き場に
   ある時。hookを入れていない環境には記録が無いので、配送idを本文ごとに新しくするのは製品の務め。
4. **命令の場所の記録**（`src/delivery-provider.ts`）。`aiterm-setup`が`~/.config/aiterm-mcp/delivery-provider.json`
   （`aiterm.delivery-provider.v1`: `version`・`node`・`cli`）を残す。製品のprocessは、PATHにnpmの置き場が無い環境（macOSのアプリ配下など）で
   起きる事がある。MCPの本体の起動時には書かない（試験用に別の場所から起こした本体が、導入済みの記録を書き換えるため）。
5. **製品側の入口は`aiterm-steer-delivery` 0.3.0**（`verifyCodexParentViaAiterm`・`submitCodexParentAnswerViaAiterm`・
   `codexDeliveryStateViaAiterm`・`codexDeliveryDetailViaAiterm`）。命令を、明示・記録・PATHの順に探して呼ぶ。見つからない・古い・返りを
   読めない時は`AITERM_PROVIDER_UNAVAILABLE`で断り、ほかの届け方へ切り替えない。
6. **`aiterm-setup`を通らない導入のための登録の入口**（`ensureCodexParentSteer(home, options)`、`dist/setup-integrations.js`からも出す）。
   homeを引数で受け、その下だけを書く。動いているCodexは要らない（Codexの実行ファイルを一時的に起こし、登録の読戻しと承認を公式の口で行う）。
   登録済みで承認済みなら何も書かない。失敗は投げずに`{status:"failed", reason_code}`で返す。

## 変えていない事

- Aiterm自身の親配送（子の回答を親へ届ける道）、hookの登録の形、公式キューの使い方。
- `aiterm-setup --codex-steer enable|disable|status`。
- 対象はCodexの親だけ。Claude Code・Cursor・Grokの親へほかの製品が届ける道は、今回は足していない。
- hookなしで動いている番へ入れる道（公式protocolの`turn/steer`、動いているapp-serverのcontrol socket）は使っていない。

## 取らなかった形

- **製品が、Aitermのprofileを自分で組んで`submitCodexParentAnswer`を呼ぶ。** 製品のprocessがAitermの置き場へ直接書く事になり、
  置き場の形を変えるたびに、入っている全製品の版を揃える必要が出る。
- **MCPの本体が起動時に命令の場所を記録する。** 試験用の本体が導入済みの記録を書き換える。
- **命令が無い時に、製品のhookへ戻る。** 別の道へ逃がすと、どの道で届いたかが分からなくなる。

## 確かめ

- `test/parent-delivery-cli.test.mjs`: 命令を別processとして起こす。返りの形、使い方の誤り、空の本文、公式キューを読めない時。
  公式のCodex（一時HOME、ローカルのモデル応答）で、動いている番（hookが最初の番へ入れ、`hook:"emitted"`と`turn_id`が残る）、
  止まっている会話（公式キューが会話を起こす）、hookを入れていない環境（`steer:"disabled"`、番の後に届く）。同じ配送idの2回目は断る。
  製品側の入口（`aiterm-steer-delivery`）からの通しも同じ形で見る。
- `test/ensure-codex-parent-steer.test.mjs`: 公式のCodexで登録し、2回目は`hooks.json`・`config.toml`・設定のどれも書かず、
  外された登録は入れ直す。ほかの製品のhookは位置も中身もそのまま。
  登録より前から動いているCodexがある時は`restart_required`で返す。
- `test/setup.test.mjs`: setupが命令の場所を残す事、残せなければ成功にしない事、変わりが無ければ書き直さない事。
- 公式のCodexの試験は、実行ファイルの指定（`AITERM_TEST_CODEX_BINARY`）が無いCIでは飛ばす。枝のdistと試験を各端末へ置いて流した:
  Linux（このコンテナ、Codex CLI 0.160.1）、macOS（Codex Desktopの同梱実行ファイル）、Windows（同）とも、命令の9件が通った。
