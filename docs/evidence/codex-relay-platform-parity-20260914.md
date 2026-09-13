# Codex中継のOS間統一: 検証記録

対象: ADR 0066。2026-09-13〜14にWindows nativeで実施。

## 修正前の再現

旧Windows実装で、公式Codexの直接の親を起動元とする条件が2件とも失敗した。
従来試験はWindowsだけ中間processを含む祖先関係を許していた。
稼働中のDesktopでも、公式CodexとDesktopの間にlauncherとNodeが残り、Throughlineの公式CLI検出が失敗した。

## 修正後のfocused test

```text
npm run build
node --test test/codex-relay-stdio.test.mjs test/codex-relay-official.test.mjs test/windows-codex.test.mjs test/setup-codex-relay.test.mjs test/repository-contract.test.mjs
```

24件中20成功、Mac専用4件skip、失敗0。公式CLI試験は`AITERM_TEST_CODEX_BINARY`を指定した。
使用した公式binaryのSHA-256は`081e4de4be8e38fac6ed4d95e3b1a0b9f6d31c090ddc36e1696b349fe406f575`。
認証と外部モデルは使わず、隔離したHOMEとローカルResponses fixtureで確認した。

- 起動元→公式Codex→中継Nodeの直接の親子関係。公式binaryの内容は維持。
- 中間processを挟む旧構成を`status=ready`の証拠に採用しない。
- 同じturnへのSteer、終了後の同じtask再開、本文の一回送信、承認拒否の返送、RPC接続分離。
- 追加接続と実行中turnが残る場合もstdio EOFで終了。公式processの終了確認後にlauncherも終了。
- 日本語・空白・引用符・末尾backslash、EOF前転送、接続前の入力とEOF、不正なバイナリ応答の拒否。
- 有効化前の起動検証、再実行、元の設定の保存と復元、第三者変更の拒否、適用失敗後の再実行。
- npm pack内の文書参照と製品所有契約。

独立したCodexレビューでは新規ファイルと差分を読み、Macと共通のprocess・stdio関係と共通処理への移行を確認した。
追加のGrokレビュー、3環境CI、公開packageと再起動後Desktopの確認は、この記録時点では未完了。
この隔離試験を再起動後の実機成功とは扱わない。
