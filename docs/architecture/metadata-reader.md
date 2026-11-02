# 起動記録の読取

[全体図](current-overview.svg) → [読取詳細](metadata-reader.svg)。編集正本は同名DOT。A1のコードと同じ差分に置く。

`core.ts`の起動・復帰・送信・観測・設定・closeは、従来と同じ同期の`loadAgentMetadata` / `tryLoadAgentMetadata`を呼ぶ。専用moduleは記録選択と検証・旧形式の正規化・5vendorの返却を所有する。coreへの逆importはない。読取でnative作用、保存、retryを開始しない。

| 実ファイル・関数 | 所有する内容 |
| --- | --- |
| `src/agent-metadata-reader.ts`: `loadAgentMetadata` | secure rootの対象選択、現在世代、共通field検証、Claude/Codex/Grok/Cursor/Antigravityの投影 |
| 同: `loadAgentLineageFields`, `normalizeInitialPromptState` | 既存lineage拒否とboolean/欠測の旧形式。検証順と返却fieldのspread順を維持 |
| 同: `tryLoadAgentMetadata` | 例外をnullへ変換。呼出元の既存の拒否・欠測判断へ返す |
| `src/agent-shared.ts`: `AGENT_LINEAGE_RE` | 起動入力と保存記録で使う既存規則。世代選択・保存・pathも従来の同所有者に残る |
| `src/core.ts`: `agentReadMetadataSuffix` | 表示の欠測cacheとTTL・invalidation。reader全体のcacheへ広げない |

停止・取消・途中失敗・cleanupの進行はcore側の既存callerが所有する。欠測・壊れたJSON・世代不一致・認証正本不一致を成功へ変えず、loadは元の例外/codeを返しtryはnullを返す。受付・native完了・画面反映の判定をreaderへ移していない。Grok/Antigravityの既存resumed_from投影差も修理せず保持する。

関連検証は5vendorの旧形式・省略field・共通拒否・JSON不正・世代選択を直接読むfixture、および既存generation/resume-template。全OS/native/実vendorの動作確認には代用しない。
