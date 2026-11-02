> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# Native端末・process・入力・表示の境界

基準Aiterm ce575ce8。Aiterm130/130実装moduleの初読を完了した現在図。[native runtime図](native-runtime.svg) / [PNG](native-runtime.png)、[関数対応](source-index.md)。全caller/test/fixtureの独立照合は残る。実OS probeや稼働席操作で検証したものではない。

## 所有とデータの流れ

| 実装 | 所有するもの | callerへ返すもの / 副作用 |
| --- | --- | --- |
| [tmux-runtime](../../src/tmux-runtime.ts) | POSIX socket、Windows namespace、binary/locale、native ID/pane routing、環境継承、shell方言 | command code/stdout/stderr、native作成receipt。process作成、buffer入力、設定・一時file・Mac GUI job等の作用 |
| [process-runtime](../../src/process-runtime.ts) | process一覧・PID出生・CPU・親系統・probe識別・signalのOS差 | 内部のcommandと公開用digestを分離。欠測/拒否/存在と開始時刻nullを分ける |
| [psmux worker](../../src/psmux-send-worker.ts) | loopback認証peerへpayloadを分割送信する一回処理 | 認証応答とcommand応答を別に確認。途中失敗を再送へ変えない |
| [PowerShell解決](../../src/windows-powershell.ts) | where.exe→既定絶対path、実pwshのCore/major>=7照合 | 検証した実体を返す。PowerShell5.1/cmd fallbackなし。別の旧psmux access workaroundは専用5.1呼出を持つため、この方針を全runtimeに広げない |
| [RTK](../../src/rtk.ts) | 既観測出力の分類と縮約 | 読取表示だけ。コマンド実行/成功/agent完了を決めない |

## native本人性と作用先

private execution gate→native session/pane routing→server側の出生条件付きcommandの順で変換する。native routing自身は作用の権限を作らない。復帰/新規のframeが別native receiptへ入れ替わる場合は拒否し、同名sessionのprefix一致へ戻さない。sender側の検証に加え、受信server側のconditionでserver/session/paneの再利用も照合する。

POSIXはtmuxを明示AITERM_TMUX→PATH→Homebrew既定pathで解決し、明示指定の失敗を別binaryへ隠さない。Windowsはpsmuxを-L namespaceで分離する。64MiB出力超過をcode1+空stdoutへ変換せず例外にし、POSIX binary消失はcache破棄と依存エラーへ返す。

通常runtimeはpsmux3.3.8のsession0起動時にserverへの限定query権限を付ける既workaroundを持つ。失敗はstderr固定prefixの診断とfailed返却で、全session成功を保証しない。この製品実装の読取と、担当外のホスト権限運用は別であり、今回その作用は実行していない。

## 環境・GUI・起動とcleanup

tmux clientのUTF-8 localeが未指定/C/POSIXの時だけLC_CTYPEを補い、明示charset設定は維持する。AITERMの自席名札/TMUX値は新sessionへ継がせず、そのcallerの環境をsessionへ写す。既serverのglobal環境自体を入れ替えない。一時的なupdate-environmentをnew-session command queue内で戻し、途中失敗時も解除する。

環境に未被覆のglobal名が残った場合、作成sessionを破棄する。legacy経路だけは未被覆名を足して最大2回の再作成を許し、guarded/pinned新規作成は再作成しない。この既存の作用後再作成と、入力/dispatchの再送禁止を混同しない。

MacでAqua外かつGUI domainが利用できる場合、新server起動・認証preflightを一時LaunchAgentで実行する。jobはinput/output/status fileを持ち、bootstrap不能なら直接実行へ戻る。bootstrap後timeoutはETIMEDOUTの結果となり、bootoutと一時directory削除を行う。AbandonProcessGroupでserverのdaemonをjob cleanupから分離する。keychainの資格をAitermが読んで出力する設計ではない。これもsource精読のみ。

## Windows本文送信と通常shell

psmux direct workerは対象session base・任意native receipt・port/keyを検証し、同認証peerを固定してUTF-8 payloadを256byteずつ送る。AUTHのOKだけを入力command成功へ流用しない。native条件拒否や部分応答は失敗となり、自動再送しない。末尾の専用command応答と既定drain待ちはtransport側の受付確認で、vendorが本文を処理し始めた証拠ではない。別serverへのchunk毎のregistry再探索はしない。

shell方言はOSだけでなく現foreground/promptから判定する。PowerShellはUTF-8 scriptblockのASCII包み、既知POSIX shellの複数行はprintf復元+evalで同scopeへ渡す。raw/literalは既存条件でこの変換を避ける。完了sentinelは実shellで作り、echoに完成済みrcを含めない。通常shellのsentinelとagent turn終端は別契約。Windows log sinkの遅延は有界settleで読むが、これも本文完了の証明ではない。

## process観測・停止と欠測

POSIXはLC_ALL=Cのpsで出生/CPU/commandを解釈し、Macのsession IDはkernel pointerの値を使わず、statのleaderと親系統から復元する。Windows全表はCIM、限定PID出生は.NETを使い、権限不足だけCIMで補う。開始時刻が読めない存在行はnullで保持する。全表・identity・elapsedの拒否には安全なOS code/status/signal/bytesだけを追加し、argv/stderr本文を公開例外へ載せない。

空identity結果だけで不在を証明せず、private actor回復はnative kill(0)のESRCHも必要とする。親が子より新しいPID再利用は親系統から除く。background集計の既定60秒、probe/console/caffeinate等の分類条件は維持する。POSIX signalは既存group/PID、Windowsはprocess handleと出生を確認したCloseMainWindow/Killを使う。担当外ホストへのsignalを今回実行したわけではない。

## 表示縮約

`src/rtk.ts`の読取縮約はcontrol除去とshell frame除去後の観測済みtextを受ける。pytest・grep/rg・git status/log・既定filterを分類し、未知出力はnullでcaller側へ戻す。失敗/収集errorを成功へ畳まず、上限で省いた行やcommit件数を表示する。入力やstateを保存し直さず、推定token数が増える縮約は採用しない。raw出力・parent返送本文の保持とは別の表示面である。

Windows73fail原因は未確定。OS設定/権限/実席・追加full・timeout緩和は0。

coreの`send({rtk:true})`は別の任意入力変換である。単一行だけ外部`rtk rewrite`へ渡し、5秒/1MiBの既存上限、成功0または3かつ非空の時だけ書換え、起動不能/timeout等は元の命令をそのまま使う。読取縮約とこの送信前変換を一つの「読取専用RTK」として扱わない。[通常PTY入出力](ordinary-pty.md)参照。
