# ADR 0103: Codexのturnがサービスの誤りや通信の失敗で終わった時、完了ではなく`error`で返す

状態: 採用。

## 原因

Codexは、サービスの誤りや通信の失敗でturnを打ち切る時も、記録（rollout）へ`task_complete`を書く。回答は無く、`error`が付く。

- 実物（2026-10-07、Codex CLI 0.160.1、手元の偽のmodel）で見た`error`:
  - HTTP 500: `message`は「We’re currently experiencing high demand, which may cause temporary errors.」、`codex_error_info`は`internal_server_error`。
  - HTTP 401: `message`は「unexpected status 401 Unauthorized: （応答の文）, url: http://…/v1/responses」、`codex_error_info`は`http_connection_failed`。
  - 途中で切れた応答: `message`は「stream disconnected before completion: Transport error: network error: error decoding response body」、`codex_error_info`は`other`。
- Aitermの完了待ちは、`task_complete`を完了の境界として読み、利用上限（`usage_limit_exceeded`）だけを`rate_limited`に分けていた。
  ほかの`error`つきは`done`で返り、`aiterm-wait`はexit 0、親への配送は`outcome=done`と「回答の本文は空でした」だった。
- 呼んだ側には、失敗が、空の回答の完了に見える。BellTeamでは配送が`delivered`になり、画面には何も出ない。

オーナーの指示（2026-10-07、ADR 0102の原因と同じ）で言う、通信が失敗した時に操作の結果を取り違えて返す形に当たる。

## 決めた事

1. `task_complete`に`error`が付いていて、利用上限でない時、完了待ちは`outcome: "error"`を返す。`aiterm-wait`はexit 7。
   Claude CodeのAPIエラー、Grokの`turn_ended`（`outcome=error`）と同じ、typedな終了として扱う。
2. `error`は、呼んだ側の画面にそのまま出る1行の文にする。Codexの文は、応答の本文とURLを含む事がある。
   - 「unexpected status」で始まる文は、HTTPの状態まで（例「unexpected status 401 Unauthorized」）で切る。後ろは応答の本文とURL。
   - ほかの文は、URLを「…」に置き換える。改行は空白に畳み、200字で切る。
3. 種類は、文から切り出さずに済むよう、別の項目`error_kind`で返す（Codexの`codex_error_info`。値を持つ種類は名前だけ）。
   `aiterm.agent-wait-result.v1`へ足す項目で、Claude Code・Grok・Cursorと、`error`でない返りでは`null`。
4. 合間の言葉（`kind: "error"`）も、利用上限のほかは、2と同じ1行にする。利用上限は、Codexの利用者向けの文をそのまま出す（今までどおり）。
5. 変えない物: 引数、`done`と`rate_limited`の返り、断りの文面、Claude Code・Grok・Cursorの席、途中で止めたturn（`turn_aborted`）の扱い。
   誤りで終わった後の席は、次の文を今までどおり新しいturnとして受ける。

親への配送は、`error`の返りを前から扱っている（`outcome=error`と、`error`の文を本文として届ける）。そこは変えない。

## 取らなかった形

- **Codexの文をそのまま`error`へ入れる。** 応答の本文とURLが、呼んだ側の画面と記録へ出る。
- **種類ごとの固定の文に置き換える。** 「途中で切れた」「混んでいる」といった、Codexが書いた読める理由が消える。種類`other`は理由が残らない。
- **種類を見て、通信の失敗とサービスの誤りを、Aitermが別の`outcome`へ分ける。** Codexの種類の一覧はCodexの持ち物で、版で変わる。
  Aitermは「誤りで終わった」事と、Codexが書いた種類を、そのまま渡す。分けて見せるかは呼んだ側が決める。
- **実行時エラーとして記録する。** サービスの誤りと通信の失敗は、Aitermの欠陥ではない（ADR 0102）。

## 及ばない所

- `error`つきの`task_complete`に、途中までの回答が残っている場合も、`error`で返す。途中までの文は親へ届けない。
  読みたい時は`pty_read(agent_transcript:true)`で読める。
- 文の整え方は、見た形（上の3つ）に合わせてある。応答の本文を別の形で含む文が出た時は、URLだけが伏せられる。
- 本物のサービスでの401（ログインが切れた時）の文は見ていない。偽のmodelの401で見た形。
- 起動時の最初の文（`agent_launch`の`prompt`）が3秒以内に誤りで終わると、返りの`initial_prompt`は、今までの「開始を確認」ではなく
  「送信済み・未確認（`reason: "error"`）」になる。Claude Codeの席と同じ扱い。

## 確認

- 試験: 記録に上の3つの形を書いた偽の席で、完了待ちが`error`・1行の文・種類を返し、次の文は`done`で返る。利用上限は`rate_limited`のまま。
  文の整え方（401の本文とURL、HTMLの本文、URL入りの文、長い文）。合間の言葉の文。
- 実物は、公開の前に、公式のCodexと偽のmodelで確かめる（HTTP 500・401・途中で切れる応答・利用上限）。
