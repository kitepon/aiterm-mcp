# ADR 0089: Claude親の配送hookを、shellを通す1行で登録する

状態: 採用。

## 原因

Claude Code親の配送hookは、`~/.claude/settings.json`へ`command=<node>, args=[claude-parent-hook.js]`の形で登録していた。
Claude Codeは`args`があるとshellを通さずに直接起動する。

Grok（1.0.46）は、Claude Code互換としてこの設定のhookも動かすが、`args`を読まず`command`だけを動かす。
nodeだけが起き、hookの入力（JSON）をscriptとして読んで`[stdin]:1`で終わる。Grokは失敗を通す（fail-open）ので
動作は止まらないが、会話の終わりのたびに失敗の記録が残る。matcherの付いたPreToolUse・PostToolUseは、
Grokの道具名（`aiterm__…`）に当たらないので走らない。走るのは、matcherの無いSessionEnd（channelを使う製品ではStopも）。

実物で確かめた事（2026-10-05）:

- Linux（このコンテナ）: 共有の設定のまま`grok -p`を流すと、`global/settings:session_end`が`exit code 1: [stdin]:1`。
- Windows（fox）: Grokはhookを`pwsh -NoProfile -NonInteractive -Command "<command>"`で動かす。`shell`は読まない。
  `args`形式は、nodeの絶対pathの空白で切れて失敗する。`& '<node>' '<hook>'`は動く。
  `$LASTEXITCODE`を書くと、Grokが環境変数として読み、「未設定」としてhookを動かさずに失敗と記録する。
- Claude Code 2.1.289（Linux）: shell形式は`/bin/sh -c <command>`で動く。shはnodeへ置き換わらず、hookの親として残る。
  `exec`を書けば、Claude Codeが直接の親になる。
- Claude Code 2.1.289（Windows、`shell: "powershell"`）: `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`で動く。
  hookの親はpwshで、その親が`claude.exe`。`& '<node>' '<hook>'`だけだと、hookの終了2がClaude Codeへは1で届く。

## 判断

登録は、`args`を使わずshellを通す1行にする。実装は配送ライブラリ（aiterm-steer-delivery 0.2.0）が持つ。

- POSIX: `exec '<node>' '<hook>'`。
- Windows: `& '<node>' '<hook>'; exit (Get-Variable LASTEXITCODE -ValueOnly)`と`shell: "powershell"`。
  asyncRewakeは終了2で親を起こすので、PowerShellに丸めさせない。`$`は書かない。
- hookの入口は、Grokから起こされた時（入力に`hookEventName`がある）は何もせず0で終わる。
  2を返すと、GrokはStopを「止めずに続ける」、PreToolUseを「拒否」と読む。
- PreToolUseのhookは、`process.ppid`ではなく、先祖をたどってshellでない最初のprocessを依頼元として記録する。
  間のshellはhookと一緒に終わるので、記録すると受信の時に「依頼元のClaude processは終了しました」になる。
- 再登録は0.52.2までの登録を新しい形へ置き換え、解除は両方の形を除く。登録の確認（`diagnostics`）も両方の形を読む。
  確認はライブラリの`claudeParentHooksRegistered`・`claudeParentHookScripts`に任せ、Aitermは`args`を直接読まない。

## 退けた案

- `args`形式のまま、Grokの側の失敗を受け入れる: 失敗の記録が全てのGrokの会話に残り続ける。
- Windowsで`shell: "bash"`と`exec`: GrokはWindowsで`shell`を読まずPowerShellで動かすので、Grokで失敗する。
- 間のshellを、command行にhookのfile名があるかで見分ける: Claude Codeがcommandを別の渡し方（符号化した引数など）に
  変えると見分けられない。shellの名前で見分ける方が、渡し方の変更に強い。

## 影響

- `aiterm-setup`を流すまでは、0.52.2までの登録がそのまま残り、Claude Codeの配送は今までどおり動く（Grokでの失敗の記録も残る）。
- 0.52.2以前へ戻す時は、旧版のinstall前に`aiterm-setup --remove-claude-parent-hooks`を実行する。
  旧版は新しい形を自分の物と数えず、もう1組を足す。
- Windowsでは、待っているhook1つにつきPowerShellのprocessが1つ残る。
- 連携元（BellTeam）は`dist/setup-integrations.js`の`mergeClaudeParentHooks`を呼ぶだけで、登録の中身は読んでいない。
  関数の名前と場所は変えていない。

## 確かめ

- 配送ライブラリの試験（3環境）: 本物のshellで終了2とstderrが届く事、shellを飛ばした親の記録、Grokの入力で終了0、
  旧形式から新形式への置き換え、両形式の解除、他製品の保持。
- 本物のClaude Code 2.1.289（Linux・macOS・Windows）: ライブラリが書いた登録のまま、作業中の親へ本文が差し込まれた。
- 本物のGrok 1.0.46（Linux）: Stopと会話の終わりのhookが失敗の記録を残さない。Windowsは、同じ1行でhookの入口が終了0で終わる事まで。
- Aiterm（手元のdist、state・socket・利用者設定を分離）: Claude Code親が子を起動し、子の回答が作業中の親へ差し込まれた。
