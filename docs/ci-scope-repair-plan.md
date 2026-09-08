# CIの変更分類とOS選択の修理

2026-09-08のオーナー指示「解決しろ」に基づき、dotagentsの共通規定と両repoのCI選択を修理する。

## 受入条件

- 版番号だけの変更はJSONの実差分で識別し、Aitermの配布情報・pack確認をLinuxで行う。依存・script・配布内容の変更を版番号変更として省略しない。
- 共通コード、CI自身、未分類の実装変更はMac・Linux・Windowsを選ぶ。OS固有変更はLinuxと該当OSを選び、混在変更でOSを落とさない。
- 文書だけなら文書確認。実装と文書の混在は関連試験の選択を維持し、文書確認も含める。
- focused testで分類を実測し、独立反証後に両repoへcommit・pushする。実際のCIで3環境の選択と完了を確認する。

## 責務と進め方

dotagentsは共通方針と自身のCIを所有する。Aitermは自身の分類・試験実行を所有する。既存の所有境界を維持し、他製品のCIは変更しない。CIだけの変更なのでnpm版の更新・再公開は不要。

複数repoの書込みを調整するため統括レーン。Fは検査範囲と受入判断、Aは局所実装、HはCI実行完了待ち。両repoの規定を一つの判断で揃える小変更のため親が直列に実装し、独立反証だけを別担当へ渡す。Latticeとwriter委譲は使わない。

既知の罠: パス名だけでは版番号変更と依存変更を区別できない。共通変更の早期returnでWindowsが消える。文書が混ざるだけで全試験へ戻る。spawnSyncのtimeoutは追加しない。AIShellはtransport closedのため通常の編集と永続端末を使う。

## 現在地

両repoはfetch後にmain同期・cleanを確認済み。変更前のCI分類テストは両repoとも10件成功。回帰試験を先行して失敗を確認し、修正後はAiterm 13件・dotagents 10件が成功した。実履歴の版番号コミットもmetadata・Linuxへ分類され、buildと配布確認14件が成功した。

最終確認はAiterm `npm test`が395成功・9件のOS固有skip、dotagents `make -j8 ci`が成功。独立反証は分類・OS・runner・workflow接続を確認した。READMEの旧契約記述と、配布JSONの追加・削除を版番号更新と判定しない修正を採用し、focused testで確認してからpushする。CI-only変更なのでnpm公開は不要。GitHub上の3OS実行が残る。
