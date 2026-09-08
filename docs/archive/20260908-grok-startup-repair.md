# Grok起動と初回送信の修理記録（完了）

目的は、BellTeamの調査をGrokへ委譲できる状態へ戻すこと。2026-09-08の依頼に基づき、read-only sandbox、通常HOME、既存hookを維持し、初回promptの回答回収まで確認する。

## 原因と所有者

- dotagentsが配布する`factory.json`のsymlinkをGrokのsandboxが拒否する。dotagentsの既存実ファイル生成を全OSへ適用し、工場hookだけの再反映を可能にする。修正と関連試験は済み、Macへ適用して起動拒否の解消を確認した。
- AitermがGrokのフォルダ信頼画面を入力受付と誤認する。画面内の`Grok Build`と、scrollbackのshellの`>`が成立条件を満たすため、初回promptのEnterが確認画面に消費される。Grokの公式`--trust`と、確認画面を入力受付から除外する判定をGrok adapterへ置く。
- 完了済みhookの結果`[hooks: 成功/失敗]`を実行中と誤認する。同じ画面へ手動入力すると4.4秒で応答したため、Grok adapterのbusy判定から結果表示を除いた。

## 作業と受入

1. dotagents: hookの実ファイル化、正本の再反映、config保持、install検査をfocused testで確認し、全体CI後にcommit・pushする。
2. Aiterm: 信頼画面の最小再現を回帰テストにし、公式CLIでの起動、初回prompt、完了通知、回答回収を確認する。初期化中の送信にも再現問題があれば同じ起動処理で原因を確定する。
3. 契約変更を別ベンダーのread-only反証へ渡し、親がdiffと実測で裁定する。
4. Aitermのrelease手順で公開し、公式npm package導入後に同じGrok smokeを行う。公開待ちが残れば確認コマンドと現在地を残す。

実装は親が直列に行う。起動拒否の修理後に初回送信を調べる依存があるため、writerを並列化しない。Fは責務判断・実環境適用・公開・受入、Aは局所実装、Hは外部公開の完了待ち。Lattice工程管理は使わない。

設定内容のコピーやsandbox解除をAitermへ追加しない。CLIごとの操作判断をdotagentsへ移さない。無関係なMCP接続失敗は対象に含めない。

## 現在地

dotagentsの関連テスト、文書検査、全体CI、Mac適用が完了。Aitermは回帰テスト5件、Grok／Composer関連試験、文書検査7件が成功。別ベンダーの反証は完了し、重大な機能欠陥はなし。

dotagentsは`f82f914`、Aitermの実装修理は`2447606`、公開commitは`651e8b7`としてmainへpushした。Aiterm 0.31.2のnpm公開とOfficial MCP Registry登録は成功した（GitHub Actions: `34211068878`、`34211079557`）。通常のmain CIは記録時点でrunner待ちであり、成功扱いにはしない。必須の手元検査と公開後smokeに基づき起動修理を受け入れた。

公式npmの0.31.2をMacへglobal installし、公開packageの`dist/index.js`をMCP clientから起動した。新規の未信頼cwdでread-onlyの`agent_launch`を実行し、09:40:25 UTCに`outcome=done`と「起動確認できました」を回収した。同じsessionへの`pty_send`も09:40:33 UTCに`outcome=done`となり、「追加送信も確認できました」を回収した。`pty_close`は`closed`を返し、続く`pty_list`に対象sessionが無いことを確認した。通常HOME・既存hook・sandboxは維持した。

反証の裁定: 信頼登録が保存されhook・MCP・LSPにも作用する説明をREADMEへ追加した。日本語段落はオーナーの日本語指定に従って保持する。`--hooks-only`は今回の修理で既存configを変えず工場hookを更新するため実際に使用した入口であり、保持する。実測のない追加懸念は修正根拠にしない。

一次資料は`rag/sources/agent-launchers/grok-hooks-folder-trust-1-0-13-20260908.md`と`grok-sandbox-hook-protection-1-0-13-20260908.md`に保存し、`rag/INDEX.md`から辿れる。未対応のWindows実機smokeを実施済みとは扱わない。

## 保守記録

- 通常PTYのmultiline `mark:true`でheredoc終端へのsentinel連結、braceを含むPythonコードの展開を観測した。所有者はAiterm。起動修理とは切り分けて扱う。
- AIShellの編集が`CHANGE_SET_STORE_CORRUPT`で副作用前に失敗した。git差分が無いことを確認して同じ差分をpatchで適用した。所有者はAIShell。
