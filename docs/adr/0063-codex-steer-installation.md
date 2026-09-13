# Codex Desktop Steerの選択導入と公式受付の利用

日付: 2026-09-13。状態: 決定済み。実装の契約を固定し、公開後の実機受入は別の観測として残す。

## 決定

Aitermのnpm packageにPOSIX launcher・Node中継・公式受付への接続を含める。
macOSの`aiterm-setup`でSteerを明示選択した利用者に、設定・ログイン時の再適用・実効確認・解除を提供する。
既存Codex Desktopの公式バイナリを同じPIDと親PIDでexecし、App Serverの改造・再ビルドは行わない。
署名・認証・アプリ内ツールの検査は変更しない。公式更新が同じApp pathへ行われれば、更新後の公式バイナリを使う。

送信は公式`turn/start`へ一度だけ行う。公式Coreの`start_or_steer_turn`が実行中ならSteer、
終了済みなら同じtaskの新turn開始を選ぶ。事前の状態判定と送信の間のraceや、結果不明の自動再送は作らない。
宛先はMCP metadataのtask IDと親processの祖先socketから識別し、同じ公式受付でload済みか確認する。
model・権限のoverride、別processでのresume、queueへの自動退避は行わない。

Windowsは公式AF_UNIXとNodeのnamed pipeが一致しないため、この中継のSteerを未対応とする。
Linuxは共通POSIX処理の対象だが、Desktopの選択導入は未検証であり未対応とする。
両OSのAiterm単品と従来queue配送は維持する。

## 根拠と修正

- 公式source基準`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`の
  `codex-rs/app-server/src/request_processors/turn_processor.rs`は`turn/start`から`start_or_steer_turn`へ入力を渡す。
  `codex-rs/app-server/tests/suite/v2/turn_start.rs`には実行中の同じturnへ反映する試験がある。
- `test/codex-relay-official.test.mjs`は製品コードと公式同梱CLIを使用し、実行中Steer・終了後再開、
  本文の各1回保存とモデル要求への反映、承認拒否、接続分離、通常/実行中のstdio終了を確認した。
- 独立反証はログイン後の起動設定消失と、単独App ServerをDesktopと誤認する2件を指摘した。
  最小試験で両方の失敗を再現し、専用LaunchAgentと公式binary/直接親の照合を加えて同じ試験が成功した。
  反証者は修正箇所を再確認し、2件について残る具体的P1なしと報告した。
- 実際のlogout/rebootと、公開packageの再起動後配送は、この決定の時点では未実施である。

現在の進行と未完了項目は[計画](../plan_codex-shared-app-server.md)、
先行するDesktop実機の証拠は[公式中継試験](../evidence/codex-official-relay-20260913.md)を参照する。
