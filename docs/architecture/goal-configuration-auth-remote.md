> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# goal・設定・認証・remoteの現在構造

基準Aiterm ce575ce8。図は [goalと設定](goal-configuration.svg) / [認証](authentication.svg) / [remote](remote.svg)、同名PNGもdiagramsに置く。実機・認証情報・他Bot席へ触れず、実装の読取で得た関係である。設定拒否の別件依頼を再開したものではない。

## goalの所有と入力

goalの本文/予算/使用量/状態はvendor CLIだけが持つ。Aitermはgoal store/loopを作らず、session/launch/vendor conversation/home/executable/native PID出生identityを束縛して読む。入力schemaはcreateのobjective必須、editはobjective/予算のどちらか必須、他actionへのfield流用を拒否。goal absentを示すnullと、欠測でfieldが無い場合を分ける。

MCP `agent_goal` は`remote`引数を持たない。端末へ結んだsession（terminal session map、remote-terminal.md T2）だけは、同じ引数のまま端末のAitermへtrusted SSHで中継し、端末の`aiterm.agent-goal-result`（v1/v2）を変えずに返す。こちらで決めたoriginがuserの時だけ、private env行（R5、端末の結びを持つAitermだけが送れる）の`AITERM_GOAL_ORIGIN=user`で渡し、端末側は`aiterm-remote` clientのその値だけをuserとして受ける（process envは見ない）。それを知らない古い端末は変更をautomaticとして`user_authorization_required`で断る（黙って別の結果にならない）。変更originはmodel引数から選べず、trusted ingress callbackまたはbellteam clientの厳密なhost metadataからuserを決める。これは独立した認証ではなく、BellTeam側のOwner認証/seat ingress拒否を前提とする接点契約。inspect以外は通常のexecution contextも必要。outcome rejected/unknown/unavailable/unsupportedはMCP isError付きで返す。

core.resolveはnative pane・process表と単一harness候補、同launchを再確認する。束縛の確認（入口・読んだ後・変更の前後のsame）はevent loopを止めない：paneとprocess表は、同時に来た確認でそれぞれ1回の非同期読取を分け合う（paneは`sessionPaneAsync`の`list-panes -a`、process表は`readRuntimeProcessesShared`。どちらも`freshShared`で、分け合うのはその確認が呼ばれた後に始まった読取だけなので、古い表で世代を確かめない。native target枠の中とWindowsのpaneは席ごとの非同期`display-message`）。N席の並列inspectは1席分の時間に近づき、読取中も配送は止まらない。goalUiの入力直前の確認（paste/keys/clickの`check`）は従来どおり同期で読む。coreのgoalUiは毎作用のgeneration/vendor/PID/TTY/foreground/端末modeを確認し、Claude/Grokのnative登録もprocess registrationへ束縛する（GrokはLinux、ClaudeはLinux・macOS・WindowsのOS別の生まれの形。WindowsのClaudeはTTYが無く、resolveが示すpaneの単一harness processを入力の持ち主とする）。所有を確認できない場合はunavailableであり、別会話・新processからresumeして補わない。 Claudeのinspectはこの入力ownerの確認を通らない（composerへ書かないため）。goalUiを使うのはClaudeの変更・Grok・CodexのTUI操作だけである。

| harness | 現在の経路と能力 | 確認・失敗・後始末 |
| --- | --- | --- |
| Codex v1 | protected native App Server socket→loaded thread検証→既接続のgoal API。接続前のtopology失敗だけ通常App Serverの読取へ選び直す（Codex自身の`~/.codex/app-server-control/app-server-control.sock`が無い・行き先の無いlinkの時は毎回`codex app-server`を起こす。Aitermはdaemonを作らない）。要求の時間切れ（15秒）は、時計の後に一度だけ待ってから決め、止まっていた間に届いた返事を先に読む（0.70.39、Steer 0.5.3）。接続後のactionを別transportへ再実行しない | ordinary経路ではbudget-onlyがAPI、objective/controlは当人CLIのTUI。createはobjectiveだけ、editのobjectiveとbudget同時変更はunsupported。各回canonical readback。Windows native socketはunsupportedで通常fallbackへ落とさない |
| Claude v2 | **inspect reads the native session transcript only** (`observeClaudeGoalRows`): the last main-chain `goal_status` attachment row of the bound session decides the state (`met:false` = active, `met:true` = achieved, `met:true`+`sentinel` = cleared, `failed:true` = ended without history, no row = no goal). This is the record Claude Code itself restores the goal from on resume and re-carries across compaction (2.1.322 `lBn`/`sVo`/`uit`). inspect types nothing, opens no dialog, takes no send lock, and does not depend on the composer, the turn state, the TTY owner, `sessions/<pid>.json` or the Claude Code version; a transcript that does not exist yet reads as no goal. create/edit/clear (user origin only) still type `/goal …` into the seat's composer under the send lock; for those the accepted versions are the 2.1 line from 2.1.310 (measured 2.1.310, 2.1.322; judged by `sessions/<pid>.json`), any other version is refused before input with `availability:"unsupported"`, reason `claude_code_version_unverified:<version>`. token budget, pause and resume are unsupported | Only a mutation writes to the composer. A literal objective is validated against viewport/control characters/blank lines/reserved words before input. If the pasted command is not confirmed in the composer, nothing is submitted; when the composer then holds exactly the pasted command, the paste is removed with one Backspace per code point and the mutation ends `not_issued`, so the seat leaves that state by itself (text mixed with someone else's input is left untouched). Readback after a mutation polls the transcript for up to 2 s; clear confirms the cleared history of the original condition. An unknown `goal_status` row shape makes the read `unavailable` until the next known row. Known limits: a goal restored in memory by a fork before the fork's first transcript write reads as no goal; a resume refused by Claude's hooks/trust gate leaves the transcript saying active |
| Grok v2 | **inspect reads the saved `<session dir>/goal/state.json` only** (`readSavedGrokGoal`): no file = no goal; otherwise `goal = {kind:"grok-cli", native}`, no `current_status`. No typing, no send lock, no TTY owner check. `native.status` is an open string (measured on 1.0.77: `active`, `user_paused`, `budget_limited`; others passed through unchanged); keys Grok adds later (`plan_file`, `plan_baseline_file`, ...) are dropped from `native`. Saved values: status is written within ~1 s of each change; `elapsed_ms` / `tokens_used_high_water` only every ~30 s while a goal runs; `phase` may be stale. `capabilities.clear` on inspect = `native.status === "user_paused"` (a candidate) | clear (user origin) still types under the send lock: fresh `/goal status` (or the recognized Goal detail) must say UserPaused/Idle with the same goal before `/goal clear`; the clear result carries `current_status` from that fresh read. detailを閉じたことも確認。create/edit/pause/resumeは未対応 |
| Cursor/Antigravity | native goal adapter未実装 | unsupportedを返し、Aiterm独自goalへ代用しない |

Composer writers and exclusion: `withAgentSendLock` orders composer writes inside one Aiterm process only. Each SSH-forwarded call runs its own `aiterm-mcp` process on the terminal, so writes forwarded from two Aiterm processes to one seat are not excluded by Aiterm; serializing them is the caller's responsibility. Writes forwarded from one Aiterm process (`pty_send`, `agent_configure`, goal mutations) leave it one at a time per seat (`inRemoteSeatOrder`, remote-terminal.md) (Owner decision, 0.63.12, native-runtime.md). A read must therefore never write to the composer: no harness's inspect does (Claude: transcript rows; Codex: App Server `thread/goal/get`; Grok: saved state.json; Cursor/Antigravity: unsupported before any connection).

managerは変更前に古いgoal snapshotを返却対象から外す。native ackだけでappliedにせず、同じgenerationでreadbackし、値の不一致/返却喪失/世代変更はoutcome_unknown。trusted入力ownerが `AgentGoalNotIssuedError` で未submissionを証明した場合だけnot_issuedへ戻し、古いsnapshotを復元せず再取得する。UI準備のpasteやmenu操作があったかと、goal本体のsubmissionがあったかは別である。

## 設定変更とgoalの一時停止

`agent_configure` → configureAgentは入力値検証と元launch固定後、送信と同じprocess-local FIFOで世代を再確認する。agent-sendのfilesystem lockは使わない。番が動いていればFIFOを解放してすぐ「入力待ちではありません」で断る（2026-11-07まであった30秒の並び直しは、守る物が無く呼び手の差し込みを止めていたので外した）。休止/復帰中は通常inputによる再開を要求し、configure自身ではnativeを起こさない。変更直前にresume templateをunconfirmedとしてからnative設定へ進み、成功時に新しいconfirmed recipeを保存する。

Codexでactive v1 goalがある場合だけ、inspect→比較付きpause→現在turn終了待ち（記録のtask_complete/interruptedに加え、画面の作業中の行が消えるまで。即時の断りが描き直しの遅れで当たらないように）→configure→同じgoalがpausedのままならresume。元々paused/noneならこの依頼はresumeしない。途中で別goal/値へ変わった場合、v2 goal、pause/restoreが不明なら専用errorで返す。configure失敗時も自分がpauseしたgoalの復元を試みるが、結果不明をactiveと補わない。goal inspectがunavailableの場合は既存仕様どおりconfigureの通常gateへ進む。

| harness | 席だけの切替 | 維持する境界 |
| --- | --- | --- |
| Claude | `/model` pickerのsession-only `s`、表示済み行/effortと選択直前の画面、必要ならYes選択を確認 | session-only選択がない時は閉じて拒否。選択発行前/後を区別。fastはcatalog事前確認と新しい結果行、既定fastModeだけを復元 |
| Codex | model/effort picker、advanced reasoning、変更前後の新しいnotice。fastは候補表示を確認してtoggle、結果を見て必要時もう一回だけ | modelだけなら現在effortを読む。menuを閉じるcleanupと、設定が変わった可能性を保つ。既定model/effort/service_tierを公式config API→必要なら該当file行で復元 |
| Cursor | live catalog、base model→parameter editorの一歩ずつの移動と選択印→composer再描画 | modelとeffortの組合せ、Fast row不存在を区別。既定model項目は直前値へ戻す。復元前fileが無い場合の既存例外も保持 |
| Grok | model/effort commandと新しいnotice/足元model表示、fastはcatalog内の対ID | 元設定のmodels既定だけ復元。fast候補が見えない時の既存一回再照会を保持する |
| Antigravity | live catalog、現在modelと目標IDの画面確認、共有settingsのmodel復元 | fast=trueは未対応、falseは受入。effort suffixのcatalog整合を確認 |

user-config lockは設定file横のdirectoryと経過時間による既存排他であり、agent-sendの出生identity/token排他とは別物。directory欠測/取得不可ではactionを通す既動作、古いlockの削除、期限とfinally解放をそのまま記録する。JSON復元は対象keyだけを戻し他keyの並行変更を保つ。coreの一部復元失敗はbest-effortで設定の返却を覆さないため、「成功なら全共有fileが必ず元bytes」とは主張しない。

configure成功receiptのmodel/effortは要求値（未指定null）であり、現在実動値の包括的な読取APIではない。変更作用の前にbeforeChangeが立つと、以後の失敗は `configurationFailure: outcome_unknown/effect:possible`、それ以前はnot_applied/not_started。pickerを開く準備のキーが一切なかったことまで意味を拡張しない。harness選択/fast/goalを一つの再送可能transactionへ変えない。

## 認証

資格情報はvendor CLIだけが保存する。coreはauth metadata、native pane、表示可能なURL/code/choicesとbinding/digestを持つ。startは公式status確認→未認証なら専用PTYを作りremain-on-exit・ログ無効化・metadata保存→公式login起動。reloginはstatusに頼らずloginするが、Antigravityは共有cache破壊を避け未対応。既存Codex loginの資格置換はCLIの作用で、取消が旧認証へrollbackする意味ではない。

Claudeは`configuration_root`（受入は起動と同じ`resolveClaudeConfigurationRoot`）で認証するrootを選ぶ。startで認証metadataの`claude_root`へ保存し、login起動行は`env CLAUDE_CONFIG_DIR=<root>`（既定rootは`env -u CLAUDE_CONFIG_DIR`）、全statusも同じ環境で読む。session付きのstatus/respond/cancelで違うrootを渡すと`AGENT_CONFIGURATION_ROOT_REJECTED`。authenticatedの返りは`account_label`（公式statusの`email`、表示用。無ければnull）を持つ。

status(sessionなし)は公式control command。session付きstatusはpane死亡/status/signalと元世代を確認し、exit0でも公式statusがauthenticatedであることを確認する。Claude等のonboardingが必要なら同じ認証席のphase更新とrespawnを行う既存経路があるので、全statusをnative作用ゼロとは説明しない。

respondは送信lock→元metadata inode/時刻とnative/server/pane出生identity→fresh prompt digest/許可choice→ログ無効化→作用直前再検証。認証codeをtmux bufferで一度paste/Enterしfinallyでbuffer削除。choiceは毎画面を再検証し限定移動。作用後の失敗はunknown、作用前はnot_issued。返却待ちではstatusだけを再観測し再入力しない。Windowsはforeground本人性の受入未完として入力拒否。cancelは認証席だけをcloseし、既にない時はauth metadataを除去する。別の通常席を取消対象にしない。

## remote

remote-contract.tsが接続入力契約を、remote.tsがSSH/stdio中継と完了観測の再接続を所有し、現地Aitermがnative席/metadata/vendor transcriptを所有する。接続先host/user/portをkeyにmemory cache、平文passphraseはMCP memoryだけ。passphrase_env/鍵path等の非秘密設定は親配送boundaryへ保存され得るので、説明の「接続情報を保存しない」を全metadata非保持へ広げない。ControlMaster/socketとaskpass scriptは現地席とは別のruntime stateで、secret本文をfileへ保存しない。

callRemoteToolは一回のMCP requestを転送する。個別指定のremoteと私的値つき（agent_launch）は自分のclient接続を作りfinallyでcloseする。信頼済み端末のそれ以外の呼び出しは、端末ごとに温めた接続（ssh＋現地aiterm-mcp、initialize済み）を共有する（0.70.41、a37：呼ぶたびのshellとnodeの起動とinitializeを省く）。接続は端末ごとに2本で、`pty_list`（席の一覧の読み、seat-turnsの中継）だけの1本と、それ以外の1本に分ける（`remote.warmLane`、0.70.53、a68）。現地は1本の接続を1つのprocessで答えるので、その中で止まった呼び出し（11/14 01:33 JSTにfoxで約2分止まった休止席のclose）が同じ端末の読みを全部止めていた。接続は送る前に死んでいれば作り直し、送った後に切れた要求は再送しない。2分使われないか10分経った接続は、走っている要求が終わってから閉じる（現地のaiterm-updateは遅くとも10分で効く）。使っていない間は子processがこのprocessを生かさない。lost sendを自動で再送しない。観測だけは同じcursorでSSH255再接続、有限deadline/abortを維持し、abortは自分のSSH childを止める。現地回答はstructured textと、双方にturn IDがある場合の一致を確認する現実装であり、localの厳密なcompletion/session/launch検証と同じ完全性とはしない。

indexのremote send/launchは現地dispatch後に親配送登録を行うため、現地input済み/登録失敗を未送信へ丸めない。remote image/preface、private executionのremote、claude_turn issueは既存unsupported。agent_goalにremote引数はない。wait_processはsecretを渡さずssh-agent/既存ControlMasterを使う。client/observer接続終了は現地席のcloseではない。

## 未確認

harness通常moduleのmodel/auth/status parser全文、steer-follow/interim、private executionとOS native実装、配布入口は後続初読を完了した。全caller/fixtureの独立照合と候補受入は未確認。[採用設計](refactor-rationale.md)に従いA3で設定UI、A4aでremote入力契約を分離し、変更した窓口は関連試験と型/schema照合を完了した。認証・goal・設定・SSHの実操作は0。Windows73件は原因不明の基準で、今回の読取から修理済みとはしない。

## A3/A4aの候補対応

設定UIの所有者と関数対応は[製品内設定対応](model-configuration.md)。coreはagentModelUiで元の45行screen/Enterまでの命令/menuキーと元のready/text待機を供給し、goal/lock/作用前不明化/metadata/返却を保持する。既定復元3回400msはuser-configへ移動、Codex固有復元と起動時native観測はcoreに残る。remote入力schema/type/説明はremote-contractへ移し、remote.tsは同名再export、SSHとmemoryはremoteに残る。index/update CLI/parent recordは契約正本を直接参照する。goal設定図とremote図は製品docs/architecture正本、旧diagramsはsymbolic link。


Host-controller identity generalization: [function map and data flow](host-controller.md). This additive initialize capability replaces scattered client-name gates; the exact legacy BellTeam route/marker remains compatible, all native/source guards are retained.
