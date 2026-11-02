> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 障害記録・診断・外部報告

基準ce575ce8。図 [runtime errors](runtime-errors.svg) / [PNG](runtime-errors.png)、[関数対応](source-index.md)。定義・store/OS adapter・worker・reporter・CLIを全文初読した。実store/資格を読まず、記録・通信・有効化は行っていない。

## 入力と所有

MCP/coreの記録口はallowlistのcodeだけを受ける。3定義（PTY dependency/persistence/vendor launcher）の固定template・component・severityからfingerprintを作り、本文/argv/path/生例外を記録payloadへ受け取らない。storeは発生累計・最後の発生版・時刻・open/resolved・sequence・ack cursorを所有する。reporterは送信・受領stateを別に所有し、製品側のエラー返却を通信結果へ依存させない。

collectionはcanonical factory設定か、製品のreporting有効switchから決まる。reportingは既定disabled。config欠測とmalformedを区別し、未知schema/fieldをenabledへ丸めない。store v1読取はv2へ正規化し、旧複数回集計から最後の発生版を復元できなければunknownとする。

## 保存・競合・副作用

storeはowner-onlyの正規file・上限・exact key・sequence/ack単調性・fingerprint一意性を検査する。上限256件で未受領を捨てず、容量確保は受領済みresolvedだけを除く。再発はresolvedをopenへ戻し、sequenceを進める。

書込はChoosing/ticket queueで順序を決める。同先頭ownerが進まない時間を測り、先頭交代で待ち予算を更新する。通常pollはkill(0)、stall時だけ出生を照合し、死んだ/置換ownerのentryだけを除く。1.5秒はgraphの期限や仕事失効ではない。消失/置換の内部typed例外と、不正fileを区別する。finallyは自分のtoken/PID/出生に一致するticketだけを消す。

state保存はtemp独占作成→file fsync→rename→mode/DACL確認。private execution checkpointの祖先directory fsyncとは別責務で、同じ耐久保証とは記さない。WindowsのreadState/diagnosticも既directory/file DACLの適用とreadbackを行う。snapshot/診断を全OSで副作用なしと扱わない。資格fileを読むreporter側はverifyだけで修理しない。

## workerとdeadline

recordRuntimeErrorは記録workerを起動し、戻りtrueはworker起動受付まで。保存成功のreceiptではない。失敗/deadlineは固定stderr診断へ一度だけ集約する。POSIX2秒、WindowsはDACL境界を含む診断12秒/記録30秒の既期限を保持する。期限後はworkerを停止し、WindowsはNode handle停止後taskkill/Tで子を回収する。これを製品本体や稼働Botの停止へ広げない。

MCP診断は別workerのexact小結果を待ち、timeout/未知schema/巨大stdoutをunverifiedへ返す。記録workerは成功後だけ別report workerを起動できる。通常MCP processから直接HTTP通信しない。NODE_TEST_CONTEXTでは自動reportを起動しない。

## 報告・結果不明・受領

有効switchとprivate credentialが揃った場合だけreporterが通信する。宛先/合鍵の実値はreport payloadやCLI表示へ出さない。送るのは定義済み記録fieldと解決情報で、host名/OS/arch/保存sequenceを送らない。最大500件/送信512KiB。応答は取得後64KiBへsliceする既処理で、stream全体のメモリ上限とは主張しない。

送信はreport_idと累計snapshotを固定し、timestamp+body SHAをHMAC署名する。HTTP200だけでackせず、accepted=true・同report_id・応答HMACを照合した時だけsnapshot cursorをackする。途中に新しい発生があれば後のsequenceは未受領として残る。timeout/通信断/署名不明/5xxはdelivery_unknown、429はrate_limited、401/403はcredential更新まで自動halt（skew例外あり）。

manual最短1分/auto1時間、送信mutexの2分stale引取は**reporter専用**。execution/native lock回復へ同じ時間基準を流用しない。受領不明時はackを進めず、次機会に現累計を新report_idで送る。これは本文配送再送とは違い、累計報告の既契約である。

CLIのsnapshot/ack/resolve/reopen/report/reportingは別作用を持つ。operator_resolvedは人の記録状態で、自動修理や再試験成功の証明ではない。未知例外は固定codeへ射影し、資格/保存本文を反射しない。Windows73failとの因果照合は未完、今回runtime試験/報告通信0。

## failed復帰の安全記録候補 D1

`agent-resume-diagnostic.ts`は新しい復帰処理の失敗だけを世代別`.resume-failure.json`へbest-effort保存する。最初に保存できた1件を残し、既failed/resuming継続拒否で上書きしない。phase/許可reason/型付き元codeだけを持ち、本文・path・生例外を保存しない。本文not_sentとnative_outcome unknownを区別する。元例外・attemptの作用順・6field公開返却は維持。正常成功の記録は作らない。既close cleanupが対象fileも片付ける。既runtime集計/collection/reportingには接続しない。公開読取D2はこのcommitでは未提供、同会話修復は証明不足で未提供。
