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
Grokの追加レビューは約20分で結論を得られず終了したため、成功したレビューには数えない。
再起動後Desktopの確認は、この記録時点では未完了。公開packageの結果は後段に記録する。
この隔離試験を再起動後の実機成功とは扱わない。

## CIで見つかった接続直後の応答取りこぼし

最初の3環境CIではMacとWindowsが成功し、Linuxの不正応答試験がtimeoutした。
接続完了のawait後に受信handlerを登録していたため、upgradeと最初のframeが同じ受信単位に入ると、
handler登録前に応答が到着する順序があった。接続通知と同時に応答を発生させるfixtureでWindowsでも再現した。
共通中継の受信handlerを接続開始時に登録し、focused testの3件が成功した。待機時間の延長や再試行は加えていない。
公式CLI試験の2件も再実行して成功した。受信順の差分に対する独立したCodexレビューでも、
接続前の再試行、接続後の終了、EOFに新たな欠陥は見つからず、RPC再送が加わっていないことを確認した。
修正後の[3環境CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34764959849)はすべて成功した。

## 公開とWindows導入

`npm run release -- 0.37.2`でmainの`11a1db6537625660386af9a8d1efc7eadce5a131`から公開した。
配布metadataと文書の試験は14件成功し、tagがorigin/mainの祖先であることを確認した。

- [npm provenance付き公開](https://github.com/kitepon/aiterm-mcp/actions/runs/34765560818): 成功。
- [GitHub ReleaseとMCPB](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.37.2): 公開済み。
- [Official MCP Registry登録](https://github.com/kitepon/aiterm-mcp/actions/runs/34765576008): 成功。公開APIで0.37.2を読戻した。
- [release commitの配布CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34765559381): 成功。

npmは公開受理後に配布準備中と返し、最初の導入は未掲載で失敗した。公開確認後に同じnpm入口で再実行した。
隔離したディレクトリへ公開packageだけをnpm installし、公式CLI試験fixtureを配置して実行した。
製品コードは公開packageだけを使い、2件成功、skipと失敗は0だった。
直接親の保持、実行中Steer、終了後再開、承認拒否の返送、接続分離、EOFでの終了と片付けを確認した。

Windowsでは重要なAI設定を非公開tarへ退避した後、`npm install -g aiterm-mcp@0.37.2`と
`aiterm-setup --json --codex-steer enable`を実施した。psmuxと全4種AIの登録はready、
Steerは`restart_required`（exit 3）となった。GUIの起動設定がAitermのlauncherを指すことと、
以前の起動設定が復元用に保存されていることを読戻して確認した。
Desktop本体は停止していない。通常MCPの配送とThroughlineは完全再起動後の確認を残す。
