# 0125. 停止は現在処理を中断し、会話を残す

状態: 指揮官確定指示（2026-10-21、Trony経由）。実adapter/稼働受入は未了。

「処理だけ中断して、会話セッションは残す」「Escで止めるようなやり方」が現条件。
0124のclose/CLI終了を停止ボタン・連鎖・全体停止へ用いる前提は失効した。
AIへの停止依頼や意味判断を使わず、効かなくてもclose/killへ自動昇格しない。
通常の明示的な管理用closeは残すが、中断の受入には数えない。

## 最小wire

tool名はagent_stop。旧close成功と誤認しないよう、このcontrolだけv2とmodeを必須にする。
register/status/finish/rootsのwireは維持。新ID、queue、再送frameworkを作らない。

```ts
{ schema: "aiterm.cascade-stop-request.v2", mode: "interrupt", roots: LaunchRef[] }
{ schema: "aiterm.cascade-stop-result.v2", mode: "interrupt", roots: LaunchRef[],
  status: "confirmed" | "partial" | "unconfirmed", relation_coverage: "complete" | "incomplete",
  unresolved: { request: ExistingRequestRef | null; reason: string }[],
  targets: { launch: LaunchRef; run: ExistingPoint | null;
    key: "Escape" | "C-c" | null; key_receipt: "not_sent" | "accepted" | "unknown";
    interruption: "interrupted" | "already_idle" | "unconfirmed" | "unsupported" | "replaced";
    session_preserved: "confirmed" | "unconfirmed"; reason: string }[] }
```

acceptedはnativeキー入力の受付だけ。現在runの中断・下流終了・会話維持を証明しない。
runは既存launch/operation/turn/cursor境界で、Bot名や最新jobから推測しない。
interruptedにはそのrunの中断証拠、session_preserved=confirmedには前後の同じlaunch・native harness identity・
会話endpointの維持証拠を必要とする。消失/closed/already_closedを成功へ変換しない。
already_idleはキーを送らない局所状態であり、下流や未確認の呼出を終了扱いにしない。
キー受付だけ、run欠測、世代交代、native中断/会話維持の欠測は未確認のまま返す。

現隔離実装はread-only planと全対象unsupported/not_sentだけ。キー・停止印・slot・close/killを発行せず、
旧guardedCloseを呼ばない。Bridgeが接続できても中断が実装/受入済みにはならない。

旧finishのkind=interruptedは期待launchの閉鎖を確認する管理用の意味であり、新中断へ流用しない。
中断結果を関係へ反映する責任はAitermに置き、Bridgeから旧finishを代用しない。
旧launch単位の永続stopping印もそのまま使わない。旧要求/親returnの抑止と、確認後の同一launchへの新依頼を、
既存run/request参照で分ける工程が残る。受付/全体ON抑止はBridgeの責任を維持する。

## 既存public口とCLI差（ローカル実装/保存済み証拠）

| CLI | 既存経路 | 不足 |
| --- | --- | --- |
| Codex | pty_key Escape。保存済み記録にturn_aborted(reason=interrupted)がある（ADR0101） | public seat-turnsはrunning/idleで中断理由を返さない。wait doneだけでも区別できず、現在run/期待世代への厳格な結合と会話維持の再観測が必要 |
| Claude | 相関付きsessionのpublic pty_keyはC-cだけ。足元にesc to interruptの既存観測がある | Bridgeからguardを迂回しない。Aiterm所有の相関維持するharness中断口へEscを限定接続し、元operationのStop/中断を確認する工程が必要 |
| Cursor | TUI観測にctrl+c to stop、transcriptにUser aborted requestの扱い | idle境界のC-cがCLI/会話を維持することと元run対応が未受入。Escの等価性も未確認。自動adapterはunsupported |
| Grok | 保存済み画面にCtrl+c:cancel。turn_ended:cancelledを処理できる | send_nowのcancelledは後続turnへの継ぎ目で終了ではない。キーと維持条件の厳格な対応が不足し、自動adapterはunsupported |

稼働版pty_keyの返りはsent key ...という文字列だけ。隔離枝は同じ文字列を保ち、入力受付だけを示す加算の
structuredContentを添える。新tool名やlaunch/turnの推測を作らない。

```ts
{ schema: "aiterm.pty-key-result.v1", session_id: string, key: string,
  outcome: "accepted", interruption: "unconfirmed", session_preserved: "unconfirmed" }
```

acceptedはmultiplexerのsend-keys commandが0終了したことを指し、CLIの処理中断/会話維持の確認ではない。
send-keys非0でもsentと返す不良を修理し、非0なら成否未確認のエラーにする。再発行しない。
相関付きClaudeのpublic C-c限定はこのreceipt追加で緩めない。Ctrl-C連打や別キー・closeへのfallbackも行わない。

### 隔離した最小Esc primitive

core.interruptExpectedAgentRunは、既存のnative admission frameと既存Pointを使うprivate部品。
Codexは現在のnative turn_id、Claudeは現在の相関operation_idが一致するときだけEscを1回送る。
managed metadataのnative ID/server owner、期待launch、唯一のnative harness PID/開始identityを前後に読み、
harness読取の間の世代/native ID/actor/server交代やrun終了も作用前に拒否する。推測の同名補完はしない。
送信先は検証したnative session IDで、CLIへ文章を送らず、Claude operation markerも消さない。
public Claude pty_keyのguardを緩める引数はBridgeへ出さない。

返りは上のキー受付receiptだけで、interruption/session_preservedはunconfirmedのまま。
Cursor/Grok、run境界欠測、旧metadataのnative stamp欠測はunsupported。native送信失敗はpossibleで再発行しない。
この部品はagent_stop/通常mainへ未接続。serviceのnative slot内でのfake受付も、処理の中断完了、native終了fence、
会話endpoint維持、古いparent return抑止や同じlaunchの次依頼再開の受入を示さない。

## 正規control入口

### 元runに対応するnative記録のread-only adapter

private `core.observeExpectedAgentRunInterruption(Point)` は、保存済みの元Pointをそのまま返し、
Codex native rolloutの最後の境界を`running/interrupted/completed/other_run/unconfirmed`へ区別する。
`turn_aborted(reason=interrupted)`かつ元turn ID一致だけを記録上のinterruptedと読み、通常完了/idleで代用しない。
native stamp/server owner、期待launch、唯一のharness PID/開始identity、root会話IDと記録file identityを
同じ読取りの前後で再照合する。fileのstatは読取競合の検出にだけ使い、graph寿命や時刻TTLに使わない。

会話IDはnative headerとfile名、完全なdeveloper launch行から読み、cached vendor_session_idや
mtimeで選ばない。fork、部分/破損した境界、曖昧な複数root、旧shared-home以外はunsupported。
複数候補はcached IDで選ばず、native endpointの厳格な別adapterができるまで可用性を限定する。
通常の一覧が読めないdirectoryを飛ばす動作も使わず、全探索の読取失敗やsymlinkは候補欠測として拒否する。
キー作用前のCodex照合にも同じ読取りを使い、同じturn IDでも会話fileが交代すれば拒否する。
Claude/Cursor/GrokにはこのCodex記録判定を流用しない。

これは**native記録/identityの観測部品**であり、公開wire・finish・stopへ未接続。
局所のabortを観測しても、旧要求/parent-returnのfenceと同時切替を排除する受付が未実装なので
`invocation_fence=unknown/session_preserved=unconfirmed`を保つ。stop成功や関係退役へ昇格しない。
元Pointのturn/operation aliasを検証する責任もruntimeに残し、モデルclaimから作らない。

### 中断専用native frame（共有admissionへの結合は未了）

既存execution-effect gateのprivate `withExecutionInterruptEffectScope` は、呼出record/edge/新IDを作らず、
捕捉したnative IDに対する単独Escコマンドだけを1回許す。通常coreの期待run/世代照合は省略しない。
close/respawn/new-session、文章入力、C-c等の別キー、人間名/別native ID、複合command queue、
別native targetへの再結合、普通のwork frameへの入れ替えを拒否する。
native直前の同期issue callbackを使い、Promise admission/bodyとframe終了後の遅着作用を拒否する。
作用後に二度目のEscやfallbackを試みたframeはpossibleのまま失敗し、catchで成功へ変えられない。

このframeは**in-processのnative作用制限部品**。共有storeにstop専用slot/元runの一時受付を持つ工程、
既発行RPCのdrain、旧parent returnの抑止、欠測復旧、同launchの新依頼再開へ未接続。
callerのnative ID/issue callbackはprivate runtimeが供給する条件で、登録宣言やモデル引数では満たせない。
現agent_stopは引き続きread-only unsupported/not_sent。frameが存在するだけでキーを送らない。

同じserverのguarded dispatcherと正規登録した同じExecutionServiceを明示的に結ぶ。
対象はagent_execution/agent_execution_roots/agent_stopの3名だけ。登録前・別service・任意tool名は拒否する。
host source resolverは同じinitialized client名で固定し、BellTeamのmeta欠測をstdio envやclaimで補完しない。
通常stdio mainは18 tools、controls未mountを維持する。

実席/公式CLI試験・他席操作・本番・公開配布なし。旧closeのfake成功を中断成功へ付け替えない。
