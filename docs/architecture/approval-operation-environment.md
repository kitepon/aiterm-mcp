> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 承認・耐久operation・環境・portable fork

基準ce575ce8。[承認/operation現在図](approval-operation.svg) / [PNG](approval-operation.png)、[core関数対応](source-index.md)。[起動/本人性](launch-identity-input.md)、[harness](harness-contracts.md)、[観測/回収](observation-results.md)へ接続する。

## 承認は「選択を送った」と「処理が終わった」を分ける

| 窓口 | 状態の所有と照合 | 作用と返却 |
| --- | --- | --- |
| `runAgentApproval` → `runAgentApprovalInNative` | 現metadataのlaunchとCodex live画面。digestはlaunch ID＋canonical dialogのSHA256 | inspectはnone/approval_required/blocked。respondはsend lock内でdigestと選択可能性を再検査し、Up/Down/Enterを送ってsubmitted。未対応harnessはblocked |
| `runClaudeApproval` → `runClaudeApprovalInNative` | active operation一致と現在画面。`Do you want to proceed?`以下の一意な単発Yes/Noだけを抽出 | respondは同じsend lock内でoperationとdigestを再検査し番号/Enter。prompt本文を保存せず相関ID・digest・選択のreceiptを保存 |

native contextとsession名、inspect/respond引数条件は入口で維持する。Claudeの「常に許可」等は公開しない。Codexの利用上限model-switch modalはこのAPIへ出さず、通常入力ready gate側の既存一時keep処理が所有する。submittedはUI操作の受付であり、vendor側処理完了や画面反映の保証ではない。Claude receipt書込が作用後に失敗する可能性を、未送信として扱わない。

## Claude operationの耐久状態

`reserveClaudeOperation`はoperation IDを検証し、launch別の空dispatch receiptをO_EXCLで作る。active markerが同operationでも別operationでも再dispatchしない。marker作成失敗時だけ自分のreceiptをrollbackし、rollback失敗で元エラーを隠さない。匿名turnもactive markerで重複を断る。既Owner裁定で撤去済みのowner/link/mode検査を、今回のリファクタで復活させない。

markerはv1 operation相関とprivate frameのv2 anonymous boundaryを分ける。v2はlaunchと境界内容が完全一致するframeからだけ受け、file sizeからcursorを推測しない。readは1024byte上限とparse失敗を保持する。API errorによる解除も同dev/inoを再確認し、新しいmarkerを消さない。

`runClaudeOperation(issue)`は非空textをdispatchし、dispatchのsubmit_residueを保持してaccepted/pending/completedを返す。`recover`はtextを受け取らず既存結果だけを読む。active markerはpending、dispatch receiptなしはunknown/operation_not_found、receiptあり完了eventなしはunknown/result_unknown。完了eventとharness sessionの相関を保ち、vendor ID補完とtranscript回収を行う。unknownを再送可能へ変えない。Stop/取消/markerとの順序は[既存harness図](harness-contracts.md)を参照する。

## 環境と系譜

`agentEnvEntries`がcallerの明示env継承と、kind/session/launch/vendor-session/role/parent/depth/lineage/delegation/state-baseの一覧を所有する。POSIX `agentEnvPrefix`とWindows `windowsAgentLaunchLine`は同一覧を別shellへ引用する。席のsession作成はenv_varsを受け取らず、値をmultiplexerのargvへ置かない（0.70.19）。Grok専用auth/update環境はharness側の既存tokenを使う。通常HOMEとvendor設定/資格の所有はvendorのまま。環境値や本文を機能図の証拠へ出さない。

継承lineageの一項目でも存在すればnestedとして全項目を検証する。subagent/true、session名、数値depth、lineage形式と4096文字、depth上限を保持し、欠けた環境を新rootへ補完しない。初回のhost-root seed、子depth+1とlineage追記を区別する。

## Throughlineのportable fork

`portableForkPrompt`はCLI解決→`handoff-context`取得→JSON schema `throughline.handoff_context.v1`、status=ready、source session一致、非空contextを検証する。取得失敗/不正応答はsession作成前に拒否する。context＋既定separator＋missionの順で一つのpromptへ組み、supplement pathを内容と混同しない。会話を移植した新席の文脈であり、元vendor会話本人性を引き継ぐ証拠にはしない。

関連入口：`core-agent-dispatch`、`core-agent-initial-prompt`、`agent-resolver-throughline`、`agent-vendor-session-env`、`agent-send-serial`、`agent-preface`。全field/例外/fixtureの独立確認は設計後の変更窓口単位で行う。
