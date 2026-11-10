> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 導入・登録・hook移行・更新

基準ce575ce8。図 [setup/update](setup-update.svg) / [PNG](setup-update.png)、[関数対応](source-index.md)。以下はsourceから確認した既存手順で、今回実行していない。稼働席/3host/公開0632は不変。

## Setupの作用順序と所有

`runSetup`はbackend依存準備→同global package登録の解決→MCP経由PTY実probe→5client登録/hook→delivery provider保存→Codex Steerの順で進む。stageごとの失敗はreason_codeへ射影する。backendだけ成功して後段が失敗する途中状態を保持し、全工程をrollbackする仕組みではない。ready/unsupported/failed/restart_requiredを別に返す。

setup-platformは既dependency probeと公式package managerによる導入、その後の同probeを所有する。WindowsはPS7/Git shell/psmux、Mac/Linuxはtmuxを対象とし、明示binary上書きの不良は別binary導入で隠さない。ホスト担当の権限運用は今回の任務外で、sourceを読んだことを導入許可にしない。

globalRegistrationはnpm global rootまたは動作Nodeの既定global rootの実体一致だけを認め、source checkout/一時npm cacheを登録しない。Homebrew Nodeは更新で残るopt実行先を確認して保存する。実probeは登録先のMCPを起こし、一時PTY open→sentinel送信→read→close→client closeを行う。認証済みvendor会話を使うprobeではない。

clientごとの設定形式はsetup-integrationsが所有する。JSON MCPは対象realpathを解決し、既登録の未知field/他serverを保持、temp+backup+rename+readbackで変更する。同binaryを包むmcp-lazy登録は直結へ戻さない。Codex/Grokはnative mcp list/add/getのreadbackを使い、同登録なら書き直さない。異なる登録へ置換する時は既envを渡すが、native addが他設定を保持する保証は拡張しない。Claude/Cursor/AGY hookは各adapter/Steerに委譲する。

hook-only入口はMCP設定・backend準備・実PTY probe・Codex Steerに触れない。Claude/Cursorの検出と専用hookの登録/解除だけを返す。設定診断のreadyは登録形と必要scriptの確認で、hookが現在vendorへロード済み、本文受理済みという意味ではない。

provider descriptorは同global登録のnode/parent-delivery-cli絶対pathと版をsetup時だけ保存し、通常MCP startupでは別source版で上書きしない。外部製品はこのdescriptorを読む境界を持つ。

## Codex Steerと旧relay

通常Steer導入はsetup-codex-hooks→Steerのplan/apply/登録readback/承認であり、旧CODEX_CLI_PATH relayとは別。公式hook登録・承認が成立してから旧relayをdisableする。設定完了と既存Codexへの反映は異なり、必要ならrestart_requiredを返す。今のリファクタ指示でrestartはしない。

ensureCodexParentSteerは指定home配下に絞った登録口で、既設定と公式statusが一致すればchanged=false、必要時にenableを呼ぶ。失敗はstatus=failed/reasonで返し、changed=falseだけから一切書込がなかったとは推定しない。native verifyや承認は作用を持つため、単なる読取としない。

旧relayの保存・復元とOS adapterは [relay詳細](codex-relay-runtime.md) へ続く。native execution hook移行は [停止/管理](private-stop.md) のuntracked経路と区別する。

## Updateの版と結果

CLIはtarget specを一回だけ具体版へ解決し、localを先行、各remoteを並行更新する。local失敗でもremoteを継続する。接続先は呼出ごとで、製品の永続host一覧へ保存しない。version/host入力の検証を維持する。

updateLocalはpackage実体とbinからglobal prefixを決め、その**同prefix**へnpm installする。checkは版解決と既導入/稼働MCP数の観測だけで戻る。入替後のpackage versionを確認し、新版setup-cliを別processで実行する。`updated/already_current`はpackage側、`setup_status/setup_reason_code`はsetup側の別field。setupが失敗しても既入替を元へrollbackしない。CLI exitは両方を見て成功/再起動要求/失敗を決める。

旧MCP processのコードは自動で入れ替わらず、running_serversは観測できなければnull。tmux/psmux席の保持と、新MCP登録の反映は別である。更新成功を稼働全consumerの新版利用へ直結させない。

remoteは既SSH shell判定を使い、現地の通常aiterm-updateまたは同packageのupdate-cliへ委譲する。旧版で命令がなければ具体版を導入してから同入口を使う。check時は導入しない。最後のJSON resultを現地結果として抽出し、SSH exitだけを受入へ代用しない。未知JSON/無結果はfailed、接続/結果不明後に入替や送信を自動再走しない。

## 端末の同梱runtime（provision）

BellTeamの端末（macOS arm64/x86_64、Linux x64/arm64）には、利用者のHomebrew・npm・Nodeを使わない製品所有のruntime（macOSもLinuxもtmuxを同梱し、端末のtmuxは要らない）を`aiterm-remote-terminal provision --ref R`で入れる（[remote terminal](remote-terminal.md) R16/R17）。`aiterm-setup`と`aiterm-update`の経路は変えない。runtimeは公開release assetを端末自身がcurlで取り、sha256を照合し、`~/.aiterm/runtime/.stage-<pid>`で展開・smokeしてから`current`へ入れ替える。直前の`current`は`previous`として次のprovisionまで残す。tmux serverと稼働中の席は止めない。POSIXの遠隔コマンドは`current/bin`をPATHの先頭に置く。assetはrelease公開後に`runtime.yml`がGitHub-hostedのmacOSとLinuxのrunnerで作り、公開用jobが4つのtarballと1つのSHA256SUMSを付ける。

## 配送CLI・先行起床の境界

parent-delivery CLIはCodex verify/submit/state/providerを返す。UUID・絶対home・非空本文とpending/claimの同delivery重複を検査し、queue受付、hook状態、turn、wake、queued=null/errorを分ける。これは全storage原子重複排除の新保証ではない。generic例外はpath/本文を反射しない固定messageへ射影する。

mcp-lazy向けdelivery-wakeはnative子processなしでowner記録を読み、closed/PID不在/取得可能な出生差からorphanを探し、wake claimをmkdirで取得する。30秒TTLは**起床担当claim**の更新で、配送完了・native停止・execution lockの時間切れ回復ではない。既claim整理/mtime更新という書込も持つ。先行起床のexit0を配送完了のreceiptにしない。

A4aの契約import以外のsetup/update動作は不変。全setup fixture/公開release実行の再受入は未実施。導入・更新・hook/資格/Host操作・公開は今回0。
