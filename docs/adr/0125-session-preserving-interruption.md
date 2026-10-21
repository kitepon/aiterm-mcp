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

pty_keyの返りはsent key ...という文字列で、期待launch/現在run/会話維持のstructured receiptではない。
send-keysの非0終了でもsentと返す不良を隔離修理し、非0なら成否未確認のエラーにする。
0終了でもCLI中断確認へ昇格しない。Ctrl-C連打や別キー・closeへのfallbackは行わない。

## 正規control入口

同じserverのguarded dispatcherと正規登録した同じExecutionServiceを明示的に結ぶ。
対象はagent_execution/agent_execution_roots/agent_stopの3名だけ。登録前・別service・任意tool名は拒否する。
host source resolverは同じinitialized client名で固定し、BellTeamのmeta欠測をstdio envやclaimで補完しない。
通常stdio mainは18 tools、controls未mountを維持する。

実席/公式CLI試験・他席操作・本番・公開配布なし。旧closeのfake成功を中断成功へ付け替えない。
