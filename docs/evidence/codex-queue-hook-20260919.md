# 起動差し替えを使わないCodex親配送の試験

## 判定

公式Codexの通常stdio起動で、公式キューとhookを組み合わせた同一ターン配送が成立した。
製品への採用前の隔離試験であり、Desktop画面、実認証、既存利用者の移行は未検証である。
現在公開している中継の設定・製品実装は変更していない。

## 構成

- 回答は公開APIの`thread/queue/add`へ投入する。
- `PostToolUse`はAiterm自身の投入分だけを`thread/queue/list`で見つけ、
  `thread/queue/delete`が`deleted:true`を返した本文を`additionalContext`として渡す。
- `Stop`でも同じ受取りを行い、本文があれば`decision:block`の継続入力へ渡す。
- hookが受け取っていない投入分は公式キューに残り、Codexがidleになった時に配送する。
- 元のstdin/stdout、公式バイナリ、起動引数、Desktopの起動設定は差し替えない。

非同期hook単独ではidleの会話を再開できないため、回答の入口は公式キューに一本化する。
試験用hookは`clientUserMessageId`の試験用接頭辞で投入分を区別する。
製品化する場合は、Aiterm所有の配送記録と宛先を照合し、利用者の投入分に触れない設計が必要になる。

## 試験条件

- macOS、Desktop同梱の公式`codex-cli 0.154.0-alpha.6.2`。
- `HOME`と`CODEX_HOME`は一時ディレクトリ。外部モデルは呼ばず、ローカルHTTPで応答を生成する。
- 親と配送者は別の公式App Server process。hook自身も公開APIを使う独立process。
- 隔離fixtureが作るhookだけを`thread/start`の`bypass_hook_trust`で許可した。
  製品導入でこの設定を使う案ではない。実際のhook承認と読戻しは未実装。

```sh
AITERM_TEST_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex \
  node --test scripts/experiments/codex-queue-hook.test.mjs
```

## 結果

6件成功。各試験で追加本文がモデル要求へ一度だけ含まれることと、残キューがないことを確認した。

| 試験 | 観測 |
| --- | --- |
| ツール実行中に回答到着 | PostToolUse経由で同じturn IDへ到達 |
| 最終応答の生成中に回答到着 | Stop経由で同じturn IDを継続 |
| ターン終了後に回答到着 | 同じthreadで次ターンを自動開始。実測約10秒 |
| hookの起動ファイルが消失 | 公式Codexのinitialize・応答は成功。本文は公式キューで到達 |
| Stopが空キューを確認した直後に回答到着 | 終了後の次ターンへ一度だけ到達 |
| 利用者自身の入力も同時にキュー投入 | Aitermの本文だけを同一ターンへ取り込み、利用者の入力は通常キューで次ターンへ到達 |

試験準備では空HOMEを二つのApp Serverが同時に初期化すると公式SQLite初期化が失敗した。
親の初期化を完了してから配送者を起動するfixtureへ修正した。製品コードへ再試行は追加していない。

## 採用前に必要な検証

- hookの正規登録・承認・読戻し、既存hookとの併用。
- キューから取り出した後にhook出力が失敗する場合の記録と復旧。試験成功をexactly-once保証へ一般化しない。
- 同時hook、キャンセル、別thread、複数の回答に対する所有確認。
- 旧中継からの移行と、Desktopでのアプリ内ツール・同一ターン配送・起動の実測。
- Windowsを含む製品対応環境。今回の試験はmacOSだけ。

## 根拠

- [OpenAI公式hook仕様](https://learn.chatgpt.com/docs/hooks)
- [取得した一次資料](../../rag/sources/completion-detection/codex-hooks-20260919.md)
- [試験コード](../../scripts/experiments/codex-queue-hook.test.mjs)

既存中継を導入した時の判断はADR 0062・0063に残す。この記録は採用決定やrelease受入を意味しない。
