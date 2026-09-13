# 改造版App ServerのKeychain・署名調査

確認日: 2026-09-13。確度: 実機の署名・ログ・基準ソースは確認済み。解決案は未実装・未受入。
前提と復旧結果は[復旧記録](codex-patched-stdio-20260913-keychain-recovery.md)を参照する。

## 結論

キーチェーン対策の候補は、更新間で継続する製品署名、初回の明示的な認証、無人処理での対話抑止である。
ただし追加調査で、現行macOS Desktopのアプリ内ツールが接続元とその親・祖父processについて
OpenAIのTeam IDとの一致を検査することを静的に確認した。
独自署名を付けた改造版を通常のApp Serverとして差し替えるだけでは、この条件を満たせない。
したがって、キーチェーンだけを修理して改造版を再投入する案は普段使いの全機能維持を満たさない。
この制約は今回調べたDesktop配布物についての判断であり、将来版や他OSの断定ではない。
既存の署名検査を無効化・迂回したり、OpenAIの署名者を偽装したりする案は採用しない。

## 実測

`codesign -d -r-` と `codesign --verify` による読み取りだけの検証を行った。
改造版はad-hoc署名自体の検証には成功する。署名の破損ではない。
その指定要件は特定の `cdhash` だけであり、改造版の同一性がそのビルドに結び付いている。
公式配布物の指定要件は識別子 `codex` とOpenAIのDeveloper ID署名者を含む。

| 対象 | 公式standalone版の指定要件を満たすか |
| --- | --- |
| 公式standalone版 | 成功 |
| Desktop同梱の別バイナリ | 成功 |
| 改造版 | 失敗。自身のad-hoc署名の検証は成功 |

private receipt: `.git/aiterm-experiments/codex-shared-20260913/signature-identity-readonly-receipt.json`。
公式バイナリの実行や秘密値の読出しは行っていない。

障害時のDesktopログは、起動process 86122の2026-09-13記録に範囲を限定し、
既知のメソッド名・拒否理由・時刻だけを抽出した。本文を成果物へ複製していない。

- `mcpServerStatus/list` の一致行は6件。これはログの一致件数であり、ダイアログ数ではない。
- `dynamic-app-tools-native-pipe` の `missing-code-signing-identity` は9件。
  時刻は07:05:52Z〜07:07:42Z。キーチェーンのOSエラーとは別の拒否である。
- 項目名 `Codex MCP Credentials` と `Codex Auth` はこのログから特定できなかった。
  オーナーは前者だった可能性を述べたが、確信はないと回答した。
- オーナーは障害時、要求が多かったため「拒否」と「許可」を繰り返し押したと回答した。
  各操作の回数・時刻は不明。Keychainの認証失敗にはこの手動操作の影響が混ざり得るため、
  失敗件数を署名による自動拒否の件数と扱ったり、それだけで大量要求の原因を断定したりしない。
- user configには認証保存方式3キーの明示指定がなかった。
  他の設定層によるoverrideがないと仮定した基準ソースの既定値は、CLI認証がfile、MCP認証がauto、
  macOSのKeyring実装がdirect。実効値の確定と混同しない。

上記9件はアプリ内ツールの接続元署名検査の記録であり、Keychain画面での「拒否」の回数ではない。
手動操作と各ログの一対一の対応は採取していない。後述の署名条件はコードの比較処理から確認した
別の根拠であり、Keychain要求が連発した原因の確定とは分けて扱う。

## 大量要求につながるコード経路

基準commitは `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`。

1. `codex-rs/app-server/src/request_processors/mcp_processor.rs` の一覧取得が
   `collect_mcp_server_status_snapshot_with_detail` を呼ぶ。
2. `codex-rs/codex-mcp/src/mcp/mod.rs` が接続先一覧の `compute_auth_statuses` を呼ぶ。
3. `codex-rs/codex-mcp/src/mcp/auth.rs` が対象HTTP MCPごとに保存済み認証を確認する。
4. `codex-rs/rmcp-client/src/auth_status.rs` から `oauth_token_status`、
   `oauth/resolved_store.rs` の保存先解決、`oauth.rs` のKeyring読取りへ進む。
5. `codex-rs/keyring-store/src/lib.rs` の `Entry::get_password()` は、
   keyring 3.6.3のmacOS実装で `SecKeychainFindGenericPassword` へ到達する。

一覧を取得するだけでも保存内容を読み、autoの新しい処理ではKeyringを優先する。
初回許可が成立していなければ、接続先の数と一覧・接続処理の再実行が要求を増やし得る。
この経路はソースで確認した。今回の全ダイアログの発生回数・呼出し元まで再現したとは言わない。

## 解決候補と限界

### 継続する製品署名

改造版をAitermの製品として、継続した署名者と固有の製品IDで配布する。
配布版ではDeveloper IDを候補とし、更新後のバイナリが前版の指定要件を満たすことを検証する。
Keychainでは安定した独自署名を使う余地があるが、OpenAIに対する既存の許可は自動継承されない。
初回のOS許可または正規ログインによる認証登録は別工程である。
「常に許可」を無説明で大量に押させる運用にはしない。

### 無人処理と明示的認証の分離

通常起動・状態一覧・自動配送は、許可が必要な読取りをエラーとして返し、
認証の明示操作にだけ対話を限定する方式を候補にする。
これは対話を抑止しても認証そのものは成立しないため、署名と初回認証の代わりにはならない。
OSから返る許可不足を、autoの別保存先や空の認証情報で隠さない。

Appleの旧 `SecKeychainSetUserInteractionAllowed` と、依存crateの
`SecKeychain::disable_user_interaction()` が存在することは確認した。
ただし後者のガードはDropで無条件に対話を再有効化する。複数の並行読取りに
そのまま付ければよいとは判断できない。旧APIの適用範囲と、要求単位で対話を抑止する方式を、
使い捨ての試験項目で先に検証する必要がある。利用者の本物の認証情報で試さない。

### ファイル保存を選ぶ方式

公式設定にはfile保存がある。ただし既存Keychainからの無断コピーは行わず、
選択する場合は保存方式とアクセス範囲の変更を明示し、正規ログインで登録する。
これは別の導入選択であり、今回の既定には採択していない。アプリ内ツールの署名検査も解決しない。

## アプリ内ツールの独立した条件

Desktop同梱コードの読み取りでは、アプリ内ツールのpipeがnativeのpeer署名検証を使っていた。
native moduleには `kOpenAITeamId`、署名者・製品ID・親processの識別処理があり、
署名不在と信頼されない署名を別の理由として区別する。
追加で `AuthorizeSocketPeer` の命令列を読み、3件の識別情報を巡回し、
Team IDの長さと内容をOpenAIの `2DC432GLL2` と比較していることを確認した。
一致しない場合は `untrusted-code-signing-identity` の拒否応答へ進む。
独自署名の証明書が有効でも、OpenAIのTeam IDとの一致条件を満たすことにはならない。
保護されたpipeへ再接続した試験、検証の無効化、署名の偽装は行っていない。

調べたDesktopは26.908.40834（build 8881）。native moduleのSHA-256は
`6a540c0d1be9081e065755f901ad2c595ea7d610f264470013f68131c910e4a0`。
再現用の版情報はprivate receipt `desktop-peer-signature-inspection.json` に保存した。

公式署名版の共有経路も確認した。アプリにはlocal daemonを選ぶ条件分岐があるが、
config overrideが非空ならこの経路を選ばずstdioになる。共有URLを指定する既存経路もある。
これは共有daemonにアプリの環境と必要なprocessの帰属が引き継がれることを保証しない。
前回共有daemonで未達だったアプリ内ツールについて、単に接続先や環境変数を変更すれば
成立すると扱わない。今回、起動設定の変更やその実機試験は行っていない。

## 元の目的を満たすための判断

今回のstdioへの追加ソケットを公式に採用してOpenAI署名版として配布してもらう案、
または公式の共有接続がアプリ内ツールまで維持できる構成として提供される案が、
署名検査を維持して元の目的を満たす候補である。採用や提供時期は未定である。
上流への提案・送信は今回実行していない。
「自分たちでパッチを当ててビルド・インストールするだけ」で全条件を満たせるとは、
現行macOS Desktopについては言えない。元の受入条件を無断で削らず、この制約をオーナーへ報告する。

## 根拠と変更範囲

- [Appleの署名要件](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- [AppleのKeychainアクセス制御](https://developer.apple.com/documentation/security/access-control-lists)
- [AppleのKeychain対話制御](https://developer.apple.com/documentation/security/seckeychainsetuserinteractionallowed(_:))
- [OpenAIの認証保存](https://developers.openai.com/codex/auth/)

一次資料は `rag/ingest.py` で保存し、manifestとINDEXへ追加した。
今回の変更は調査記録だけ。公式版の起動設定、認証情報、署名、製品コードは変更していない。
Windows nativeとLinuxの認証・Desktop連携は実測しておらず、macOSの結果を一般化しない。
