# 0025. agent launcherは通常環境を共有し、委譲lineageだけを加算する

## Status

Accepted — 2026-08-04

第7項の「全環境の暗黙copyは行わない」と、受入の「未指定値は新たにcopyされない」は、ADR 0081で置き換えた。

## Context

4つのagent launcherは同じ`cwd`を使う一方、完了検出を安定させるためvendor別のmanaged home／settingsを
段階的に導入した。その結果、通常CLIが読むproject／user MCP、plugin、skill、agent、rules、permission、
trust、memoryがlauncherごとに欠落またはsnapshotへ置換され、共同作業員としての実行環境が揃わなくなった。

aitermが本当に所有する必要があるのは、turn完了の相関、bounded result、cleanup可能なlaunch固有stateであり、
project／user環境そのものではない。また、aitermから起動されたagentが自分をroot agentと誤認すると、渡された
任務全体を再びaitermへ委譲して同型agentを再帰起動する危険がある。一方、大きな任務ではsub-agent自身による
追加委譲が必要であり、再委譲の一律禁止や固定depth capは製品能力を不当に縮小する。

## Decision

本Decisionは、以下と矛盾する既存ADR・設計文書・実装の記述に優先する。特にmanaged home／settingsを
通常環境から隔離する既存裁定は、本Decisionの実装完了時点で置換される。

1. `claude_agent`／`codex_agent`／`grok_agent`／`composer_agent`は、同じshellからvendor CLIを直接起動した時と
   同じ通常`HOME`、vendor home、project／user／local設定を既定として使う。
2. aitermは通常configをsnapshot、置換、書換えず、fake `HOME`も使わない。vendorのtrust、permission、MCP承認、
   plugin／skill／agent discoveryはvendor自身の通常契約へ委ねる。
3. aitermがlaunch単位で所有するのは、相関ID、完了event／cursor、bounded result、cleanup metadataだけとする。
   完了正本はvendor-native structured eventまたは通常設定へ加算できるlaunch固有hookに限定し、画面静止へ
   fallbackしない。
4. launcherは子へ、`role=subagent`、親session、delegation depth、lineageをvendor-nativeな非user instructionと
   環境metadataで一致して伝える。初段はdepth 1、子が継承したaiterm MCPから孫を起動した時はdepthを1増やす。
5. 自己位置の認識は強制するが、sub-agentからの`*_agent`呼出、必要な再委譲、孫以降の委譲は禁止しない。
   固定depth capや暗黙拒否は設けない。instructionは再委譲が許可されていることを明記する。
6. 新しい`managed|shared`選択肢は追加せず、通常環境共有へ単一化する。rollbackはvendor別変更commitのrevertと
   前進releaseで行い、旧managed経路を隠れfallbackとして残さない。
7. 永続tmux serverより新しいMCP process-local値をlauncherへ渡す場合は、任意`env_vars`へ変数名だけを
   allowlistする。aitermは起動時に現在のMCP processから存在する値だけを読み、shell quoteした起動単位の
   overlayとしてvendor commandへ加える。全環境の暗黙copy、name/value map、tmux server環境の更新・再起動、
   missing時のfallbackは行わない。不正なshell変数名はsession作成前に拒否する。
8. `env_vars`の値はMCP tool引数には含めないが、PTYへ送る起動コマンドと`.lastcmd`へ入る。したがって
   secret transportとは扱わず、起動先vendorと同じOS userへ開示可能な席identity／workflow値だけに使う。

## Acceptance

- 直接起動とlauncherでproject方針、MCP、plugin、skill、agent、permission／trust discoveryが一致する。
- 4vendorの子がsub-agent、親session、depth 1を説明でき、nested smokeの孫が同じlineageとdepth 2を説明できる。
- 孫の再委譲能力は残り、同一任務の反射的な自己複製ループを起こさない。
- 同一cwd／同一vendor homeの並列sessionで完了event、turn ID、全文回収を取り違えない。
- close／killAllはaiterm所有stateだけを削除し、通常auth、settings、MCP、plugin、historyを変えない。
- MCP processより先にtmux serverを起動した条件でも、`env_vars`で指定した現在値だけが4 launcherの子へ届き、
  未指定値は新たにcopyされない。不正名はsession残骸ゼロで失敗する。
- full regression、4vendor live smoke、公開packageからのglobal install smokeをそれぞれ記録する。

## Orchestration admission

本変更は公開agent契約、完了相関、認証・permission境界、複数Phaseの受入を連鎖させるため、
`chained_acceptance=true`かつ`decision_evidence_required=true`の統括レーンとする。単一repo変更なので
`multi_repo_write_coordination=false`、計画された外部承認停止はrelease H gateだけでありcampaign内部の
`planned_interruption=false`とする。

## Consequences

通常環境にある既存hookやMCPの失敗はlauncherからも見える。aitermはそれを隔離で隠さずfail loudし、
相関event不在を成功へ丸めない。利用者は直接CLIと同じproject能力を得る一方、既存設定の品質とvendorの
trust／permission判断もそのまま引き受ける。
