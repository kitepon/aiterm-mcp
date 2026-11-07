# ADR 0137: Codex goal中の設定替え

状態: 採用（公開前）。

## 原因

継続goalは前の番が終わると直ちに次を始める。agent_configureの従来の30秒の画面待ちでは、入力待ちの隙を確保できない。2026-10-31、BellTeamのupdate_selfによるTerra→Sol highの2要求がnot_applied/not_startedで断られた。実席は操作せず専用fixtureで再現した。

## 決定

Codex v1のactive goalを既存のgoal adapterで一度pauseし、同じlaunchのroot rolloutにtask_completeまたは確認済みinterrupted境界が出るのを最長30分待つ。画面がidleに見えるだけでは進めない。設定替えとgoal mutationは従来の送信行列を共有し、番を待つ間は行列を開ける（ADR 0120）。新しいgoal、queue、継続loopは持たない。

設定替え成功・失敗の両方で、自分がpauseした同じgoalの復元を一度試みる。thread/launch、作成時刻、objective、budget、paused状態を読み直し、変更されたgoalは再開しない。pause/resume発行直前のnative readでも比較元を確かめ、競合はgoal_changed_before_mutationで断る。途中のgeneration置換は旧要求のまま新席へ適用しない。

設定替えに伴う一時pause/resumeは製品内部の処理で、Ownerが2026-10-31に指示した修理の範囲。公開agent_goalのOwner provenance制限は維持し、モデルから任意のgoal mutationを許可しない。pause非対応のgoalをエミュレートしない。他harnessの連続実行はgoalを停止または完了にしてから設定を替えるよう案内する。

成功・失敗schemaは変更しない。失敗は従来のconfigurationFailureに加え、本文に設定の成否とgoalの復元状態を示す。pause効果不明では設定替えも推測したresumeも行わない。再開失敗や途中のCLI終了を成功として返さず、操作を再送しない。

## 確認

configure-goal.test.mjsは既存のgoal managerを通し、active/null/各inactive状態、番終了待ち、設定失敗、待機失敗、pause効果不明、resume失敗、goal変更、generation置換、mutation直前の競合、v2非対応を確認する。configure-goal-core.test.mjsは本物の隔離tmux、模したCodexとnative goal socketを使い、画面が入力待ちでもtask_completeを置くまで設定替えが終わらず、その後一度だけresumeすることを確かめる。

実Botのgoal、資格、AGY作業、既存7席には作用していない。本物の各OSのCLIと公開版での確認は別途実施する。

## 2026-11-07 の確認: 待ちを残す理由と置き場所

D-steer（指揮官氏の文が動いているCodexの席へ差し込まれなかった件）で見直した。この決定の「番の終了を最長30分待つ」は、goalが
直ちに始める次の番より前に設定を替えるための唯一の手段で、次の番が古い設定で走る事（状態の上書き）から守る。自分で抜ける道は、
番の終わりかunknownでの30分の期限。よって残す。

ただし、この待ちを文の配送の前に置くと、配送が番の終わりまで止まる。呼び手（BellTeam）は、動いている席には配送の前に`agent_configure`を
頼まず、保留した設定を別の仕事として番の終わりに頼む。Claude Codeのgoal（pause非対応）、Grok、Cursorには、この順序を保つ契約は無く、
`GOAL_CONFIGURE_UNSUPPORTED`で断る（goalを止めるか完了にしてから）。Codexが自分の待ち行列から始める次の番（差し込みがnext_turnになった時）
にも順序の契約は無く、設定替えは「入力待ちではありません」で断る。
