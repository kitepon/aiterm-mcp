# 候補の確認済み範囲と限界

A1 metadata reader11、A2 PTY表示12、A3設定UI/既定復元20、A4a remote schema1、A4b配送記録20の関連試験が成功。各段階のbuildも成功した。検証は定義した機能入出力と直接境界に限定し、無関係の成功群や追加fullは流していない。

- [A1/A2原本](evidence/implementation-a1-a2.json)
- [A3/A4a原本](evidence/implementation-a3-a4a.json)
- [A4b/S1原本](evidence/implementation-a4b-s1.json)
- [package境界](evidence/package-boundary.json): npm dry-run全追加module、MCPB staging7module同bytes。MCPB署名/pack/公開は未実施。
- [公開型比較](evidence/public-type-comparison.json): core133/remote22/parent5の型を基準と比較。型の同じ名前空間表記のみ正規化。型一致は全runtime動作の同等性証明ではない。

既知の基準制限: main Windows CI41397057670は846pass/73fail/569skip/gatefailure、原因未確定。新refactorで修理成功・全CI greenへ補わない。private経路は通常mainへmountしていない。資格/本番席/3host操作と新しい実3OS/vendor受入は行っていない。

今回保持した契約: 公開tool/入力/返却/例外、保存形式と世代/本人性、既定復元・作用前/後unknown・cleanup、未送信と不明、受付/完了/画面反映の区別。新tool/API/flag/依存/版は追加しない。

全図とコードのAstra最終整合は未確認。本番反映/一般配布は既存の承認手順による。

文書仕上げで全28図を再描画。候補163sourceのSHA/size・全3523関数位置・静的解決先、製品間参照を確認した。追加8moduleを通る[静的runtime import/reexport](evidence/candidate-runtime-edges.json)に循環は無い。動的解決や実行時の全経路を証明するものではない。

[描画・目視の来歴](evidence/candidate-diagram-provenance.json): 20図のDOTは初読時、8図は実装時の目視済み原本と同一。移管で新しい配置は作らず、再描画結果を保存した。
