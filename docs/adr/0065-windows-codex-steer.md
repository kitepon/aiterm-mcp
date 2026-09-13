# ADR 0065: WindowsのCodex親へのSteerをAiterm内で提供する

日付: 2026-09-13。状態: 採択。

## 判断

Windowsの公式Codex Desktopが提供する認証付きloopback WebSocketを使用する。
launcher・中継・設定保存・解除・接続照合はAitermのnpm packageへ含め、製品単独で提供する。
公式Desktopが展開した実行ファイルを配布元と照合し、公式バイナリを変更・コピーしない。
通常のHOME・MCP・認証・設定は公式CLIへ引き継ぐ。追加接続から承認要求へ応答しない。

`CODEX_CLI_PATH`はユーザー単位で一つのため、既存の互換launcherがある時は稼働中の接続を
公式processとDesktopの祖先関係、本人専用ACL、RPCで検証し、Aitermの選択だけを記録する。
共有は任意であり、他製品がない環境ではAiterm自身のlauncherと状態領域を作る。
検証できない既存設定は変更せず、Steerの失敗をqueueへの退避や再送で隠さない。

## 根拠

gpt-connectorのWindows実装（commit `55a690f788712c1c5e8a1e6ed6a1d78b193f104e`）をMIT条件で移植した。
CopyrightをLICENSEへ残す。OSのprocess情報はAiterm既存のprocess-runtimeへ統合し、外部製品をimportしない。

Windows nativeで、単独launcherの引数保持・EOF前転送・setup再実行と解除、公式CLIのinitializeと
認証付き追加接続、接続記録のACL拒否を確認した。公式CLIのローカルResponses fixtureで、実行中の同じturnへの
Steer・終了後の同じtask再開・本文の各一回保存とモデル入力・承認拒否・RPC分離・EOF後の終了を確認した。
実利用者の認証と外部モデルは使っていない。

独立反証で、gpt-connectorの開始時刻の小数7桁とAitermの3桁を文字列比較すると互換接続を拒否する問題が見つかった。
同じ時刻値へ正規化して比較し、桁数差は受け入れ、異なる開始時刻は拒否する試験へ反映した。
実行中の外部command子孫の終了は別の観測であり、モデル応答待ちのEOF試験と同一視しない。

公開・導入後の実機配送は計画に沿って確認する。ここでは実装と隔離試験の判断を固定する。
