# Windows Codex親へのSteer対応

状態: 完了。検証・公開・実機配送の結果は[公開確認記録](../evidence/windows-codex-steer-20260913.md)を参照する。

2026-09-13。依頼: gpt-connectorのWindows実装を参考に、Aiterm単独で動くSteerを提供する。

## 成功条件

- Aitermの公開packageだけでWindows用launcher、公式CLIの認証付き接続、親の識別、設定・解除を提供する。
- 実行中の同じturnへのSteer、終了後の同じtaskの再開、本文一回配送、承認応答、終了時cleanupを公式CLIの隔離試験で確認する。
- 公開・導入後、実際の親への配送まで確認する。新しいlauncherを登録した場合はDesktop完全再起動を要する。

## 工程と責務

1. F: 参照実装と現行契約の確認、Windows接続・設定の実装、focused test。
2. F: 契約変更の独立反証、関連gate、mainへの統合、release、公開packageの導入。
3. H: `restart_required`の場合、利用者によるCodex Desktopの完全再起動。
4. F: readyと公開版の実機配送を確認し、証拠を残して計画をarchiveする。

実装は親が直接行う。transport・setup・親識別が同じ契約を共有するため、writerを並列化しない。
独立反証は読取専用で行う。Lattice工程管理は使用しない。

## 範囲と既知の罠

変更はAitermだけに置く。gpt-connector、dotagents、Codex本体の改造・設定代行を依存にしない。
WindowsのNode named pipeとCodex AF_UNIXは相互接続できないため、公式CLIの認証付きloopback WebSocketを使う。
Desktopが展開した公式実行ファイルを配布元と照合する。通常CLIの代替配布は作らない。
既存の他製品launcherは上書きせず競合を明示する。Steer設定後の通信失敗はqueueへ退避しない。

## 完了時点

mainをorigin/mainの0.36.0までfast-forwardして着手した。開始時の未commit差分・stashなし。
Windows単独実装と任意の既存接続共有、公開文書、ADRを作成済み。
関連37試験は28成功・9件OS条件skip・失敗0。公式CLIのSteer・終了後再開・承認・終了処理も成功。
独立反証で開始時刻の小数桁差を再現して修正し、異なる時刻の拒否も検証した。
全体496試験は433成功・63件条件skip・失敗0、3環境CIも成功。0.37.0を公開・導入し、setupはready。
この端末は既存の互換接続を検証して共有したため、launcherの再起動待ちはない。
Aiterm自身のlauncher生成・設定・解除も、公開packageと一時設定領域で確認した。
実機配送試験の起動時にCodexのhook画面認識とnpm shimのprocess相関の欠陥を再現して修理した。
関連11試験と実機の入力待ち到達は成功。0.37.1の公開・導入・初手と追加の配送・session終了まで確認した。
起動修理の3環境CI、公開commitの配布CI、npm provenance、GitHub ReleaseとMCPB、Official Registryはすべて成功。
新しく起動した公開MCPから、この実際のCodex親taskへ両方の本文がSteerで届いた。
この会話が元から持つ旧MCP接続の切替だけはDesktop完全再起動で反映する。接続の切替完了とは報告していない。

WindowsではControl Record v1がPLATFORM_UNVERIFIEDの対象であるため、writer委譲を行わず、
計画・ADR・試験結果をAiterm内に記録する。製品の実行・受入へdotagentsの追加導入を要求しない。
