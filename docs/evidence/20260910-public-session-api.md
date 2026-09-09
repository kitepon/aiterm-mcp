# 公開セッションAPIの実機検証

開発時の実測と公開後の確認を記録する。最終受入は[ADR 0053](../adr/0053-public-session-api-release.md)を参照。

## 個別検証

| 対象 | 結果 |
| --- | --- |
| launcher構造化receipt・公開MCP通常PTY・単発承認 | 5件成功 |
| SIGSTOPしたharness・POSIX process表・自身のnative PID | 3件成功 |
| 公開tool数・配布metadata・repository契約 | 18件成功 |
| 状態観測・harness画面・heredoc・旧tmux環境注入 | 11件成功、Windows専用1件をMacでskip |
| 文書検査 | 7件成功 |
| Linux公開MCP通常PTY・単発承認 | 2件成功 |
| 最終Codex dialog分類と公開単発承認 | 10件成功 |
| CIで失敗した既存fixtureの修正確認 | Mac・Linuxで各4件成功 |

SIGSTOPは実Codexのprocess groupでも再現した。修正前は`unknown/unrecognized_screen`、
修正後は`blocked/harness_stopped`で、paneとharnessの生存はtrueのまま。確認後SIGCONTで復帰した。

## harness実機確認

| OS | harness | 起動・送信 | 完了と観測 |
| --- | --- | --- | --- |
| macOS | Codex | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| macOS | Grok | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| macOS | Claude | 初回prompt `started` | `done`、回答「確認済み。」、idle、生存、paneとharnessの別PID |
| macOS | Cursor | 初回prompt `started` | `done`、回答「確認済み」、idle、生存、paneとharnessの別PID |
| Linux | Grok | promptなし・信頼指定で`startup.ready`、後続dispatch | `done`、回答「確認済み」、idle、生存、別PID |
| Linux | Codex | promptなし・信頼指定で`startup.ready`、後続dispatch | `done`、回答「確認済み」、idle、生存、別PID |
| Linux | Claude | 起動前に認証利用不可のエラー | session未作成。認証はCLI所有者の作業として未実施 |
| Windows | 通常PTY | native PID・環境キー・CPU観測と公開MCP試験成功 | 一時SSH断の復帰後、最新差分でも確認 |
| Windows | Grok | promptなし・信頼指定で入力受付、後続dispatch | `done`、回答「確認済み」、native PID取得 |
| Windows | Claude | promptなし・信頼指定で入力受付、後続dispatch | 回答「確認済み。」、idle、生存、別native PID |
| Windows | Cursor | 公式CLI不在を起動前に検出 | 起動未実施 |

Macの旧Codex CLIは既存configを読めず終了し、古いready画面だけが残る欠陥を再現できた。
Aitermはharness生存を確認してから入力するよう修理した。CLI自体は公式npm更新で既存configを
読める版へ更新してから実機試験した。共有configの書き換えで回避していない。

## 続行条件

開発時点ではmainの製品CI、公開と公開package smokeが残っていた。以下の公開受入で完了した。
元のsetup検証におけるMac SSH未提供・WSL接続不可は元の検証記録に保持する。

## 最終独立監査と親裁定

Grok 4.6 highによる読み取り監査で1件の指摘を回収した。古いcommand承認に現在のMCP／hooks
dialogが続くと、全captureの先頭にある種別へ分類される欠陥を親のfocused testでも確認した。
現在のdialog開始と過去footerの境界からsuffixを切り、分類、承認選択、起動時同意が同じsuffixを読む修理を採用した。
未知dialog、古い承認＋新しいcomposer、長い折返しも含む10件を成功確認した。
監査が挙げた永続許可への誤選択は今回の再現では実行しておらず、確定した被害として記録しない。
native PID誤陽性、死亡のidle化、信頼指定の範囲拡大について追加の確実な指摘はなかった。
別ベンダーの指摘と親の再現・修理確認を合わせ、実装差分を製品CIへ進めると裁定した。

## CIの失敗と切り分け

最初のmain CIでは、Mac・Linuxに共通する4件が失敗した。3件は、終了済み偽CLIの後に
shellでready画面だけを作っていた旧fixtureが新しい生存確認に拒否されたもの。
残る1件は偽tmuxが版番号を返さず、pipe-paneの意図した失敗箇所へ到達しなかったものだった。
稼働する偽TUIと版番号応答へfixtureを更新し、同じ4件をMac・Linuxで個別成功確認した。
製品の生存確認・版判定を緩和して通していない。

## 公開受入（2026-09-10）

実装は`49e92e3f169b43a0459a67dee6205b92af195ef3`、fixture修正は
`c1fd21d060a264c698e9078d1ef044d32536cf74`でmainへ統合した。
[製品CI](https://github.com/kitepon/aiterm-mcp/actions/runs/34379111872)はmacOS・Linux・Windowsすべて成功。
release入口から`0da1505819380e1a96396d5f776a2e909c9318cb`をmainへ着地させ、`v0.33.0`を公開した。

- [npm publish](https://github.com/kitepon/aiterm-mcp/actions/runs/34407477580)成功。
  `npm view aiterm-mcp@0.33.0 version dist.attestations --json --prefer-online`で版とprovenanceを読戻した。
- [GitHub Release](https://github.com/kitepon/aiterm-mcp/releases/tag/v0.33.0)とMCPBを公開済み。
- [Registry workflow](https://github.com/kitepon/aiterm-mcp/actions/runs/34407488200)成功。
  Official MCP Registryの版別APIでも`version=0.33.0`、`status=active`、`isLatest=true`を読戻した。

### 公開npmの導入・設定

3環境で公式`npm install -g aiterm-mcp@0.33.0`後に`aiterm-setup --json`を実行した。
設定は各端末のlocal stateへtar退避し、秘密を含む退避内容はrepositoryへ持ち込んでいない。

| 環境 | setup | 他のAI設定保持 | 再実行 |
| --- | --- | --- | --- |
| macOSローカル | tmux ready、Claude・Codex・Grok・Cursor登録ready | 実効設定一致 | 2回目は4設定ファイルのbyte一致 |
| Linux main-server・SSH | tmux ready、4登録ready | 構造一致 | 2回目byte一致 |
| Windows native・SSH | psmux ready、Claude・Grok・Cursor登録ready、Codex未検出 | 構造一致 | 2回目byte一致 |

MacではCodex公式`mcp add`が別serverの空の`args=[]`を省略した。
最小の隔離configで公式`mcp get`の更新前後を比較し、実効登録が厳密一致することを確認した。
この表現差をAitermの設定破壊として修理せず、比較ではCodexの空argsと省略だけを等価に扱った。

### 公開MCPからの実機確認

SDKの接続先は各端末のglobal install済み`dist/index.js`。開発treeのserverを起動していない。
各AIは通常のHOME・認証・設定を使用した。

| 環境 | harness | 公開版の結果 |
| --- | --- | --- |
| macOS | Codex・Grok・Claude・Cursor | promptなし信頼指定でready、非ブロック送信、wait `done`、回答回収、idleと別native PID、close後missing |
| Linux | Codex・Grok | 同上 |
| Windows | Grok・Claude | 同上。process groupは取得不能を示すnull |

回答は「確認済み」（Claudeは句点付き）。通常PTYの一覧・明示環境キー・自己ID・活動差分・消滅試験は
3環境で成功した。Codex単発承認のdigest不一致拒否と選択試験はMac・Linuxで成功、Windowsでは
POSIX偽TUIのfixtureを使うためskipした。Windowsの実CodexはCLI不在のため未実施。

Mac・Linuxは公開close後、起動時観測に含まれるnative processの残存ゼロを確認した。
Windowsのcursor復号を含むprocess照会scriptはウイルス対策ソフトに拒否された。
保護設定と拒否されたscriptを変更せず、取得済みの38個のnative PIDを標準`Get-Process -Id`で
個別照会し、残存ゼロを確認した。公開sessionもclose後にmissingとなった。

LinuxのClaude認証利用不可、Linux／WindowsのCursor CLI不在、WindowsのCodex CLI不在は
実機試験の未実施理由として保持する。AI設定への登録成功とharness実行成功を混同しない。
元のsetup検証のMac SSH未提供・WSL接続待ちは[既存計画](../plan_setup-real-host-verification.md)へ保持し、
今回のMacローカル導入でSSH受入済みとは扱わない。
