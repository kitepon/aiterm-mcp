# 公式App Serverのstdio中継試作

製品へは未導入。macOSの隔離試験を行うためのコードであり、Windows対応や
Desktopのアプリ内ツール互換性を保証するものではない。

`codex-relay-launch.py` は親PID・環境を保持したまま公式CLIへexecする。
公式App Serverの `--listen unix://` へ、Nodeの子processがDesktop相当のJSONLを中継する。
追加クライアントの受付・要求ID・会話・承認は公式実装が扱う。
公式CLI本体、認証情報、署名検査、保護されたアプリ内ツールのpipeは変更しない。
Desktopが渡す `codex -c <設定> app-server … -c <設定>` の順序でも、
設定引数とその値を保持したまま中継を起動する。この並びを隔離試験に含める。

## 隔離試験

Node.js、Python 3、公式Codex CLIを用意してrepository直下から実行する。

```sh
npm ci --prefix scripts/experiments
node --test scripts/experiments/codex-stdio-relay.test.mjs
```

既定の公式CLIはmacOS Desktop同梱版。別の公式配布物を検証する場合は
`AITERM_TEST_CODEX_BINARY`、Pythonのパスには `AITERM_TEST_PYTHON` を指定する。
一時HOME・CODEX_HOMEとローカル模擬モデルを使い、利用者の認証情報は使わない。
`AITERM_RELAY_TEST_RECEIPT` を指定すると、配送試験の非秘密receiptを指定pathへ保存する。

確認内容:

- exec前後のPID・親PIDと公式実行ファイル、バイナリのハッシュ一致。
- 2接続で同じ要求IDを使っても応答を混同しないこと。
- Steerを同じturnで、終了後の回答を同じtaskの次turnで各1回保存すること。
- その本文が次のモデル要求に含まれること。
- 親が承認を拒否すると、試験用の書込みコマンドが実行されないこと。
- 追加接続だけを閉じても親が継続すること。
- 完了後のstdio EOFと、モデル応答待ち・追加接続ありのstdio EOFの両方でサーバーが終了すること。

公式Unix transportは最初のSIGTERMでturnの完了を待つ。stdio EOFを受けた中継は
100ms後に直接の親が同じPIDで生存していれば2回目を送り、公式の終了処理を使う。
これは実際に再現した「Desktop接続終了後もactive turnを待って残る」条件への対応である。
受付開始前だけENOENT/ECONNREFUSEDを15秒以内で待つ。送信したRPCの再試行はしない。

Desktopへの切替・復元と受入状況は
[計画正本](../../docs/plan_codex-shared-app-server.md)を参照する。
