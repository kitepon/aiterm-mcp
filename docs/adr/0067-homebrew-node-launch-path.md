# ADR 0067: Homebrew更新後も有効なNode起動先を保存する

## 状態

採用。

## 原因と判断

Codex Desktop用launcherが導入時の`process.execPath`を保存しており、Homebrewが古いNodeの
Cellar実体を削除すると終了コード127になった。MCP登録にも同じ保存処理があった。
`process.execPath`はsymlinkを解決するため、永続する設定にはそのまま保存できない。

`src/setup-node.ts`でHomebrewのCellarパスを同じformulaの`opt`パスへ変換する。
通常の`node`と`node@22`等の選択を維持し、絶対パスによってGUIのPATHから独立させる。
起動先を実行できない場合は`node_runtime_unavailable`を返す。他のNodeへ切り替えない。
それ以外の導入方法の起動先は変更しない。

MCP登録とmacOSの中継生成がこの処理を共有する。既存登録は公開packageの
`aiterm-setup --json`で再生成し、インストール時のlifecycleでは設定を変更しない。

## 検証

`test/setup-codex-relay.test.mjs`で旧Cellarを削除してoptを新版へ差し替える。
修正前は終了コード127、修正後は保存済みlauncherを再生成せず、最小PATHで起動できる。
通常formulaと版指定formula、起動先が欠けている場合の設定保持を確認する。

## 根拠

- [Node.js: process.execPath](https://nodejs.org/api/process.html#processexecpath)
- [Homebrew: opt prefix](https://docs.brew.sh/Manpage#terminology)
