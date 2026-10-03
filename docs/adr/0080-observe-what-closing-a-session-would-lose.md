# ADR 0080: 席を閉じると失うものを、pty_observeで数えられるようにする

状態: 採用。

## 原因

BellTeamは、長く動いていない席（agent session）を閉じてメモリを空けたい（オーナーの承認 K-HSQQEX、2026-10-03）。
閉じてよいのは、閉じても何も失わない席だけ。今の公開の項目では、次の3つを外から見分けられなかった。

1. 入力待ちかどうか。会話が長いClaude Codeの席は、入力待ちでも`unknown / unrecognized_screen`と出ていた。
   2026-10-03 11:40 UTCのBellTeamコンテナで、Claudeの13席のうち8席。
2. 裏で動かしている作業（ビルド、待ち）があるか。`background_cpu_seconds`はCPUの合計で、眠って待つprocessは0に見える。
3. その席が親として、子の結果を待っているか。`parent_deliveries`は、呼び出した側が親の時に、観測した子の配送を返す項目で、向きが逆。

## 判断

### 入力待ちは、見出しが無ければ入力欄の形で読む

`claudeTuiReady`は、取得した画面に起動時の見出し「Claude Code」があることを条件にしていた。通常shellの`❯`と区別するため。
会話が長くなると、見出しは取得範囲（`pty_observe`は直近200行）から流れ出る。8席は全部これだった。
見出しが無い時は、最後の`❯`行のすぐ上が罫線で、下にも罫線があることを条件にする。起動時の確認画面の`❯`（選択肢）と、
通常shellの`❯`は、この形にならない。実行中・承認待ちの判定は入力待ちより先に行うので、変わらない。

### 裏の作業は、起動完了の後に増えたprocessの数で見る

`activity.post_startup_process_count`。起動準備が完了した時点（`agent_launch`が入力受付を確かめた直後、初手を送る前）の
processの一覧をagent metadataへ控え、観測の時点で居るprocessのうち控えに無いものを数える。

既存の`background_cpu_*`と同じ集合（pane開始から60秒以降に生成されたprocess）の件数にはしなかった。
起動から60秒以内に始めた作業を数えない。実物（Claude Code、2026-10-03）で、起動14秒後に始めた裏の`sleep 240`は、
60秒の集合では最後まで0件だった。席を閉じて起こし直す運用では、起こした直後の1分に作業が始まる。
`background_cpu_*`の集合は変えない（既存の利用者がいる）。集合が違うので、名前に`background_`を付けない。

- 控えが無いsession（通常PTY、この版より前のAitermが起動したagent）と、harnessのprocessを特定できない時はnull。0ではない。
- 起動完了の後に立ったものは、作業でなくても数える（遅れて立ったMCP、hook、別端末の子を待つssh）。
  数えすぎは「閉じない」側へ倒れる。processの中身で作業かどうかを推測しない。
- 例外は1つ。Codexの`codex-code-mode-host`は数えない。Codexが道具を初めて使う時に立て、sessionの終わりまで残す
  harnessの一部で、数えるとCodexの席は一度道具を使うと二度と0にならない。その下で動くprocessは数える。
- 生argvとprocessの一覧は、今までどおりreceiptへ出さない。出すのは数だけ。

### 子の結果待ちは、配送の記録の持ち主から数える

`pending_child_deliveries`。そのsessionが親として待っていて、まだ親へ届け終えていない配送の数。

配送の記録は、登録したMCP processごとの保存場所（`active/<pid>-<開始時刻のhash>-<uuid>/`）にあり、届け終えると`results`へ移る。
親のMCP processは、親のharnessの下で動く。観測したsessionのprocessの中に持ち主が居る保存場所の、記録の数を数える。
親の種類（Codex・Claude Code・Cursor）と、子の場所（この端末・別端末）を問わない。記録の中身は読まない。

`post_startup_process_count`では足りない。待っている間に新しいprocessが立つのは一部だけ
（Claude Codeの親はhook、別端末の子はssh）。この端末の子を待つCodexの親は、MCP processの中で待つ。

- 呼び出した側が誰でも付く。`parent_deliveries`と違い、呼び出した側が親である必要はない。
- 通常PTYと、harnessのprocessを特定できない時はnull。
- 持ち主のMCP processが終わり、別のMCP processが記録を引き取った時は、引き取った側の席に数える。

### 別端末の旧版

`remote`付きの`pty_observe`は、現地のAitermの結果をそのまま返す。旧版は2項目を返さないので、MCPの出力schemaでは2項目とも省略可。
利用側は、項目が無い時とnullを、どちらも「分からない」として扱う。

## 影響

- `aiterm.pty-observe-result.v1`に2項目を足す。既存の項目の意味は変えない。
- agent metadataに`startup_processes`（`pid:開始時刻`の配列）を足す。無い旧metadataもそのまま読める。
- `pty_observe`は、agent sessionの観測のたびに配送の保存場所（6か所）の一覧を読む。持ち主が一致した時だけ中を数える。
