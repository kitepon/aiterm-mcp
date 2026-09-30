# ADR 0074: harnessのmodel一覧を公開toolで返す

状態: 実装（2026-09-30、0.44.0）。

## 背景

BellTeamは、Botに選ばせるmodelとreasoning effortを`config/models.json`に保存し、`/api/models`で
Mac・iPhone・Webへ配っている。一覧は手で保つか、手元で`scripts/update-models.mjs`を実行して作り直すので、
Botを動かす本番のharnessの候補とずれる。例えばGrokは一覧にeffortを出さないため全modelへ同じeffortを
当てており、2026-09-30の実測では`grok-4.5`だけxhighが無かった。

オーナーが合意した構成は、各harness → Aitermの共通の一覧 → BellTeamの`/api/models` → 各画面である。
Aitermはharnessの起動と相関を持ち、`agent_launch`のmodelとeffortをharnessごとの表現へ変換しているので、
一覧の取得と変換もAitermのharness adapterへ集める。

## 決定

公開tool `agent_models({ harness, cwd?, include_hidden?, remote? })`を加える。結果は
`aiterm.agent-models.v1`で、`models[{ id, display_name, efforts, default_effort, hidden }]`、
全modelのeffortの和`efforts`、既定model、取得元、adapterが足したeffort（`adapter_efforts`）を返す。
BellTeamの既存形式（`{ efforts, models: [{ id, efforts }] }`）はこの部分集合である。

取得はpromptもturnも送らない。各harnessの取得口は2026-09-30にBellTeam本番コンテナで実測した。

| harness | 取得口 | 選ばなかった口 |
| --- | --- | --- |
| Codex 0.158.0 | 公式App Serverの`model/list`（文書あり）。親配送と同じ`withCodexReceiver`で接続する | `codex debug models`は同じ内容だがdebug用の命令 |
| Claude Code 2.1.285 | stream-jsonの制御要求`initialize`の`models`。Agent SDKの公開型`SDKControlRequest`／`SDKControlInitializeResponse`の形で送り、`supportedModels()`と同じ12件を得た | Agent SDKの依存は、本体の実行ファイル約230MBを任意依存で引く。利用者のClaude Codeと別の実行ファイルになる |
| Grok 1.0.41 | `grok agent --no-leader stdio`の`initialize`応答`_meta.modelState` | `grok models`はeffortを出さない。`session/new`は同じ候補を返すがsessionを保存する |
| Cursor 2026.09.28 | `cursor-agent models` | 公式のeffort付き一覧は無い |

Claude Codeは、利用者の`SessionStart` hookを動かさないよう`--settings`で`disableAllHooks`を渡し、
`--strict-mcp-config`でMCP serverを起動せず、`--no-session-persistence`でsessionを保存しない。
ClaudeとGrokは要求を書き、応答がstdoutに現れるまでstdinを開けておき、現れてから閉じる。
0.44.0は要求を書いてすぐstdinを閉じていたが、grok 1.0.41はinitializeの処理中にstdinが閉じると
応答せずにexit 0で終わることがあり、本番の公開smokeで`MODEL_CATALOG_INVALID`になった（0.44.1で修正）。
Codexのapp-serverはstdinを閉じると応答せずに終わるので、既存の非同期接続を使う。

### Claudeのultracode

Claude Codeは`--effort ultracode`を受け付ける（未知の値は「Unknown --effort value」と警告して無視するが、
ultracodeは警告しない）。Agent SDKの型ではultracodeはsessionの設定で、対応modelが要るとあるが、
`ModelInfo`は対応の有無を返さない。既存のBellTeamはeffort対応の全Claude modelにultracodeを出している。
対応を無断で削らないため、adapterはeffort対応model（`supportedEffortLevels`が空でないもの）へ
ultracodeを足し、`adapter_efforts.ultracode`に理由を書く。

### Cursorのeffort

Cursorの一覧は「素のmodel ID + effort（+ `-fast`）」の完成形で並ぶ。Aitermは起動時に`<model>-<effort>`へ
連結し、稼働中はparameter画面でeffortを選び直す。BellTeamの裁定（2026-09-03）と同じく、候補は素のIDと
連結で作れるeffortにする。`-fast`版だけにあるeffortは連結で作れないので数えない（実測の一覧では、
これで減る候補は無かった）。`minimal`はparameter画面にラベルが無く選び直せないので出さない。

### 失敗

取得不能は`MODEL_CATALOG_UNAVAILABLE`、応答の欠落や形の違い（空の一覧、重複ID、候補に無い既定値）は
`MODEL_CATALOG_INVALID`とし、固定の一覧や別の取得口へfallbackしない。
応答が無い時は、原因調査のために終了状態、stdoutの長さ、stderrの末尾だけを添える。

### OSへの適合

要求と応答をやりとりする起動は`runAgentProtocolCommand`が持つ。macOSのAqua外（launchd経由）は
launchdの仕事にstdinが無いので、入力をファイルに書いて同じ仕事の中でつなぎ、出力ファイルに応答が
現れるまで入力を開けておく。Windowsの`.cmd`はshell経由で起動するため、
空白を含むpathを引用し、引用符やshell記号を含む引数は拒否する。Claudeの設定はJSONを引数に書かず、
一時ファイルで渡す。

## 影響

- 公開toolは17になる。既存toolの入出力は変えない。
- 既存Botのmodel設定は変えない。BellTeamが`/api/models`をこのtoolへつなぐのは別の変更とする。
- Codexの`include_hidden`は、Codexが一覧で隠すmodelも返す。他のharnessには隠すmodelが無い。
- `harness_version`は応答に版が含まれる時だけ埋める。今の取得口で版を返すのはGrok（`agentVersion`）だけで、ほかはnullになる。
