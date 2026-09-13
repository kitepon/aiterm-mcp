# Release

Aitermのreleaseはこのrepositoryが所有する。`.github/workflows/product-full-ci.yml`が変更影響選択、runnerと
製品gateの正本であり、dotagentsの工場CIは横断受入のconsumerであってreleaseを制御しない。

## CIの範囲

- push／pull request: 共通実装・CI自身・未分類の変更は`macos-native`、`linux-workstation`、`windows-native`を選ぶ。
  Windows固有ファイル（`src/windows-powershell.ts`、`src/psmux-send-worker.ts`、`test/windows-*.test.mjs`）だけの変更は
  LinuxとWindowsを選ぶ。共通変更が混ざっても対象OSを落とさない。試験は依存graphから選び、依存を確定できない変更だけ全テストへ広げる。
- 版番号だけの変更はJSONの実差分で識別し、Linuxでbuildと配布metadata・pack・文書確認を行う。依存や実行設定の変更は省略しない。
  文書だけなら文書検査、実装と文書の混在なら関連試験と文書検査を行う。
- 週1回の定期実行（月曜 03:00 JST）と手動実行は、指定された環境で全テストを回す。定期実行の対象は3環境である。
- tag push: 所有確認と、tagged commitが`origin/main`の祖先であることの確認だけを行い、npmへprovenance付きで
  publishする。同じcommitのmain CIの結果は待たない。

## Release手順

1. 変更に直結するfocused testを手元で通す。full regressionは手元で回さず、CIに任せる。
2. `CHANGELOG.md`の`## [Unreleased]`へ内容を書き、mainへcommitしてpushする。
3. 一回で公開する。

   ```bash
   npm run release -- <version>
   ```

   scriptはversion同期（`package.json`、`package-lock.json`、`server.json`、`mcpb/manifest.json`、`README.md`と`README.ja.md`の現行公開版）、
   CHANGELOG見出しと比較link、metadata検査、release commit、main push、`v<version>` tag push、
   MCPB build、GitHub Release作成までを行う。tag pushがnpm publish、Release作成がOfficial MCP Registry登録を起動する。
   scriptはその完了を待たない。

4. 後で確認する: `npm view aiterm-mcp@<version> version`、Official Registryの`io.github.kitepon/aiterm-mcp`。

同じversionのtagやnpm packageを移動・上書きしない。失敗版はそのまま残し、修正版を次のversionで出す。

## 公開後smoke

Codex Steerを変更した場合は、公式バイナリを指定した`test/codex-relay-official.test.mjs`で
実行中Steer・終了後再開・承認応答・stdio終了を先に確認する。公開packageの
`aiterm-setup --json --codex-steer enable`で選択導入し、`restart_required`なら人がDesktopを完全再起動する。
再起動後の`aiterm-setup --codex-steer status`が`ready`であることと、通常の親からの子の回答配送を確認する。
socketがあるだけで成功とせず、公式binaryとDesktopの直接の子であることまで確認する。
Linux/Windowsの単品導入と、未対応のSteer選択が理由付きで停止することもCIで確認する。

setupを変更した場合は、公開packageのglobal install後に`aiterm-setup --json`を実行し、
端末実行と検出した各AIの登録結果を確認する。初回と再実行は一時設定領域でも試験し、所有外の設定保持を確かめる。
WindowsのGrokパス変更ではスラッシュ区切りcwdで起動し、同じturnの完了通知と回答回収を確認する。

親への自動配送を変更した場合は、通常HOMEの親から子を起動し、親がwaiter・回収を呼ばずに
初手と同じ子への追加依頼の回答を受け取ることを確認する。Claudeではhook待機中に別のturnへ進めること、
`/clear`後に未送信の旧回答が届かず、Aitermに本文が保存されることも確認する。

公式npm packageを隔離またはglobal installし、変更に触れたharnessの起動、non-blocking dispatch、wait outcome、
transcript回収、`pty_close`後の残骸ゼロを確認する。

Grok／Composerのsandbox起動拒否を変更した場合は、対象環境のCLIが拒否する設定で初回prompt付き起動と
通常dispatchの未送信エラーを確認する。`GROK_SANDBOX_STARTUP_FAILED`がCLIの原因を保持し、入力受付の
timeoutや再送案内へ変わらないことを確認する。拒否を検証した結果は起動成功の証拠にはしない。
設定の管理元による修理は別途確認し、smokeのためにsandbox解除やhookのコピーを行わない。

## 利用者の更新と巻き戻し

更新はnpmの公開packageから行う。

```bash
npm install -g aiterm-mcp@latest
aiterm-setup --json
```

巻き戻しは既知の正常版を指定する。

Steerを持たない旧版へ戻す時は、install前に`aiterm-setup --codex-steer disable`を実行する。
専用LaunchAgentの解除と元のGUI起動設定の復元を確認し、MCP clientを再起動する。
回答record schemaは従来と共通であり、Steer送信済みrecordの`queued_submission_id`はnullとなる。

Claude親配送hookのない旧版へ戻す場合は、旧版のinstall前に`aiterm-setup --remove-claude-parent-hooks`を
実行する。Aiterm専用の3 hookだけを解除し、他製品のhookと設定を保持する。

```bash
npm install -g "aiterm-mcp@<known-good-version>"
```

setupを持つ版では`aiterm-setup --json`を再実行する。どちらもMCP clientを再起動する。

`npx`をMCP設定から使う場合は、package引数を`aiterm-mcp@latest`へ変えると更新でき、
`aiterm-mcp@<known-good-version>`へ変えると固定・巻き戻しできる。変更後はMCP clientを再起動する。
dotagentsの導入・更新は不要である。

## 公開物の巻き戻し

利用環境は直前の正常npm versionを明示installして戻す。公開済みtagは動かさず、npm packageは上書きしない。
state schemaやmigrationを変更するreleaseでは、旧versionへ戻せる条件をCHANGELOGへ明記してから公開する。
