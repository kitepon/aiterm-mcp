# 公開セッション観測と起動確認

## Decision

Peertableが補完していたPTY、harness状態、活動、起動時同意、承認の方言をAitermが所有する。
受入がAiterm公開からconsumer移行へ連鎖し、責務境界の裁定証跡を必要とするため、統括レーンで受け入れる。
実装と公開判断は親が担当し、別ベンダーによる読み取り監査を裁定材料とする。

- `pty_list`は指定した非秘密環境キーだけを返す。通常PTYにも`AITERM_SESSION_ID`を渡す。
- `pty_observe`は存在、生存、状態と理由、paneとharnessのnative process識別、活動差分を返す。
  取得できない値はnull、未知の画面はunknown、停止・承認・通信失敗はblockedとして区別する。
- PIDは開始識別子・argv digestと組にする。Windowsのprocess group取得不能はnullとする。
- `trust_project:true`の起動は既知のproject同意から入力受付・生存確認まで進める。
  初回promptの送信とturn開始は別に記録し、表示からpromptが消えただけでは開始済みにしない。
- Codexの公開承認は単発許可と拒否だけ。確認したdialogのdigestを必須とし、変更済み・未知なら送信しない。
  Claudeの承認は既存の`claude_approval`を維持する。
- CPU差分は消えたprocessの未観測分を補完せず、不完全フラグを返す。background集計は既存の60秒境界を維持する。

## 責務境界の反証

Grokによる独立反証を実施。paneとharnessの分離、取得不能のnull、初回送信と実行開始の区別、
単発承認、起動と観測の画面判定共通化、旧tmuxの環境注入互換を採用した。
明示環境照会の全面禁止は、所有帰属の非秘密キーを取得する依頼と診断公開の責務が異なるため棄却した。
実行開始を一切判定しない案は、busy表示・同一cursorの完了を実測できるため棄却した。

## 検証

個別試験、公開MCP試験と実機確認は計画の進捗および最終受入証拠へ記録する。
本Decisionは公開可否の完了宣言を兼ねない。
