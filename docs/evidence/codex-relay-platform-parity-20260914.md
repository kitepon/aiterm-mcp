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

## 再起動時の障害と復旧後の確認

オーナーが完全再起動するとDesktopは起動しなかった。提供された当時の写真は、Node.js 24.19.0が
`windows-codex-relay.js`を`MODULE_NOT_FOUND`として終了したことを示す。
Desktopのアンインストール・再インストールは、この障害が起きた後の復旧操作だった。
それを最初の起動失敗の原因とした推測は撤回した。

別タスクが通常のnpm global領域へ0.37.2を再導入し、同じ`CODEX_CLI_PATH`でDesktopを復旧した。
復旧後は正規setupのSteer statusとMCP diagnosticsがreadyとなった。
通常MCPから起動した同じCodex子について、初手と追加依頼の回答本文が親へ自動配送された。
親はwaiter・回答回収を使わず、確認後にその子sessionを閉じた。
Throughlineの既存Desktop検出は`desktop-process`で公式CLIを識別し、公開handoff previewは
`fresh_thread_handoff_start_ready`を返した。handoffの実行は行っていない。

## MSIXでの最小再現とパス適合修理

WindowsのNTFS記録で、以前のAitermがMSIXの`LocalCache/Roaming/npm`へ仮想化されていたことを確認した。
その領域の削除は後続のアンインストールと対応し、初回障害の証拠とは分けた。
生のファイル履歴と個人パスは非公開の試験領域だけに保存した。

公式`Invoke-CommandInDesktopPackage`で一意の仮想AppData試験領域を作り、公開0.37.2の中継を起動した。
`--version`は成功するが、`app-server`のnative子が同じ論理パスを開けず、写真と同じ
`windows-codex-relay.js`の`MODULE_NOT_FOUND`、exit 1、signal nullを再現した。
ファイルは実在し、アプリの削除や稼働中Desktopの停止は必要なかった。

修正版は`--prepare`で読み込んだ自身の実体パスを`realpathSync.native`で取得して起動計画へ返し、
`--serve`のNodeへ渡す。準備processへの論理パス、直接親、stdio、終了、設定管理は維持する。
設定時の実体パス固定や一般的な仮想領域禁止は加えていない。

追加した`test/windows-codex-msix.test.mjs`は、準備processに論理パスを渡したまま検証する。
同じ試験が公開0.37.2のコピーでは失敗し、修正版ではinitialize・EOFとも成功した。
試験fixtureの初回は`package.json`のコピー漏れで失敗したため補正し、それを製品の失敗・成功には数えない。
関連する公式CLI・Windows・設定試験は15件中11成功、Mac専用4件skip、失敗0だった。
MSIX回帰試験の1件は別に成功し、公式CLIは0.154.0-alpha.6.2を使用した。

独立したCodexレビューは実装・fixture・旧版失敗と修正版成功のログを読み、準備processへの論理パスを
残したまま修理が成立することを確認した。公開を妨げる指摘はなく、設定・親子関係・stdio・終了の変更もなかった。

## 0.37.3の公開・導入と残る実機確認

- 修理commit `f4723f1`の[3環境CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34767966859)はすべて成功。
- mainの`dc9a1f5062e576cdf20e0f915ddd6bdd2b9d19c2`から`npm run release -- 0.37.3`で公開。tagのmain祖先を確認。
- 配布metadata・文書の14試験は成功し、[release commit CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34768404227)も成功。
- [npm provenance付き公開](https://github.com/kitepon/aiterm-mcp/actions/runs/34768405338)、
  [GitHub ReleaseとMCPB](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.37.3)、
  [Official MCP Registry登録](https://github.com/kitepon/aiterm-mcp/actions/runs/34768419685)を確認。

npmの取得先へ反映された後、公開0.37.3だけを独立prefixへ導入した。
公式CLI試験2件とMSIX回帰試験1件がすべて成功し、skip・失敗は0だった。
実行中Steer、終了後再開、承認応答、接続分離、直接親、EOF・接続削除とMSIX起動を確認した。

設定を非公開tarへ退避してから通常の`npm install -g aiterm-mcp@0.37.3`と
`aiterm-setup --json --codex-steer enable`を実行した。端末実行とCodex・Grok・Cursorの登録はready、
Claudeはnot_detected。Steerは起動設定を保存し、読戻しが一致して`restart_required`、exit 3だった。
実体は通常のnpm global領域にあり、仮想AppDataへ移っていない。
保存した実際のlauncherもMSIX contextからinitialize・EOFが成功した。

稼働中Desktopは停止しておらず、新しいlauncherを使う完全再起動後の通常MCP配送とThroughlineの
実機確認を残す。復旧後0.37.2での通常配送成功と、0.37.3での隔離試験成功は区別する。
