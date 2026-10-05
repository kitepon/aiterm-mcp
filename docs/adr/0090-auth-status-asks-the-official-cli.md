# ADR 0090: 認証の状態は、公式CLIが「使える」と答えた時だけ認証済みとする

状態: 採用。

## 原因

`agent_auth`の`status`と`start`は、各harnessの公式の状態commandの答えをそのまま認証済みと読んでいた。
Codexの`codex login status`は`auth.json`があるかだけを見る。ログインから30日でrefresh tokenが切れた後も
「Logged in using ChatGPT」と終了0で答える。

実物（2026-10-05 23:02 JST、BellTeamのコンテナ、Codex 0.160.0、Aiterm 0.52.2）: Codexのログインが期限で切れた。
`agent_auth(harness:"codex-cli", action:"start")`は`authenticated`を返し、入り直しを始めなかった。
`auth.json`の名前を手で変えてから`start`を流すまで、URLとcodeは出なかった。切れている間に起きたCodexの席は
サインイン画面で止まった。配布した先には、fileの名前を変えて戻す担当が居ない。

## 確かめた事

資格情報の中身は読んでいない。Codexは本物の期限切れの`auth.json`の写しを別の`CODEX_HOME`へ置いた。
他の3つは、fileの鍵の名前と型だけを借り、値を全部ダミー（期限は過去）にした偽のfileを別の置き場へ作った。

| harness | 公式の口 | 期限切れの答え |
|---|---|---|
| Codex 0.160.0 | `codex login status` | `Logged in using ChatGPT`、終了0 |
| 〃 | App Serverの`account/read` | `account: null`（生きているログインは`{type, email, planType}`） |
| Claude Code 2.1.289 | `claude auth status --json` | `loggedIn: true`、終了0。`claude -p`は`OAuth session expired and could not be refreshed` |
| Grok 1.0.46 | `grok models` | 先頭に`You are not authenticated.`、終了0。Grokは使えない`auth.json`を自分で消す |
| Cursor | `cursor-agent status` | `Logged in (unable to fetch user details)`、終了0 |

Codexの`account/read`が`null`になる条件は、公開ソース（openai/codex）で確かめた。`account_state`は、
cacheされたauthが無い時と、tokenの取り直しの恒久的な失敗が記録されている時に`None`を返す。記録はprocessの中だけにある。
`AuthManager::auth()`は、access tokenの期限が近いか最後の取り直しから8日を越えた時だけ、自分から取り直す。
`getAuthStatus`（`refreshToken:false`）は`auth()`を呼ぶ。通信できないだけの失敗は、恒久の失敗として記録されない。

## 判断

1. **Codex。** `codex login status`が「Logged in」の時は、公式App Serverへ`getAuthStatus`（`includeToken:false`、`refreshToken:false`）、
   続けて`account/read`（`refreshToken:false`）を、1本の接続で順に聞く。`account`が`null`なら未認証とする。
   `refreshToken:true`は使わない（生きているログインへ、聞くたびにtokenの取り直しをかけない）。tokenは求めない。
   App Serverは、認証sessionへ引き継いだ環境で起こす。App Serverが問い合わせを拒んだ時（旧版）は、今までどおり
   `codex login status`に従う。App Serverと話せない時は、認証済みとせず`failed`とする。
2. **Grok。** 状態のcommandが無いので、`grok models`の`You are not authenticated.`で未認証を見る。
   今までは「auth fileの存在を成功とみなさない」ために`unsupported`としていた。file は今も見ていない。
3. **Cursor。** `unable to fetch user details`は、認証済みとせず`failed`とする。期限切れか通信できないかを区別できないため、
   「未認証」とも言わない。
4. **Claude Code。** 公式の状態の口では見抜けない。資格情報のfileには期限の時刻があるが、Aitermは資格情報を読まない
   （macOSではKeychainにあり、読めもしない）。限界として文書に書く。
5. **入り直しの口。** `start`に`relogin`を足す。trueの時は今の状態を聞かず、公式ログインを始める。
   状態から見抜けない時（Claude、通信できないCursor、旧版のCodex）と、別のアカウントへ入り直す時のため。
   別のactionにはしない（公式ログインのsessionを始める事と、`status`・`cancel`との続き方は同じ）。
   Aitermは資格情報を消さない。置き換えるのは公式CLIである。
   公式CLIの中には、ログインを始めた時点で元のログインを消す物がある。Codex 0.160.0の`codex login --device-auth`は、
   始めた時点で`auth.json`を消し、途中でやめると「Not logged in」になる（期限切れのログインの写しで確認。
   生きているログインでは試していない）。Claude CodeとCursorは、途中で取り消した後も資格情報のfileが残った（無効な資格情報で確認）。
   連携元は、認証済みのCodexで`relogin`を始める前に、利用者へこの点を知らせる。
6. **起動の止まり。** ログインが無い時にGrokが自分で始めるサインイン画面を`startup_dialog`として見分ける。
   `agent_launch`が失敗の時に返す`aiterm.agent-launch-result.v1`の`session_id`と`startup.reason`は、
   連携元が失敗した席を閉じるために使っている。形は変えない。

## 退けた案

- 資格情報のfileから期限を読む: 「資格情報を読まない」という決まりを破る。Codexの`auth.json`の期限は、取り直しで直る
  古いtokenと、取り直せないtokenを区別できない。
- 状態を聞くたびに1turn流す: 生きているログインで費用と時間がかかる。
- `account/read`へ`refreshToken:true`: 聞くたびに共有のログインのtokenを回す。
- `relogin`の時に先にlogoutする: 途中でやめると、使えていたログインまで失う。

## 影響

- Grokが認証済みの時、`relogin`なしの`start`は何も起こさず`authenticated`を返す（今までは毎回ログインを始めていた）。
- `status`がCodexのApp Serverを起こす分、認証済みのCodexの確認に1〜2秒かかる。
- Grokの`status`は`grok models`を流す。無効な資格情報がある時、Grokはそれを自分で消す（Grokを起動した時と同じ）。

## 確かめ

直した版（手元のdist、state・socketを分離）を、期限切れの置き場のまま本物のCLIへ当てた（2026-10-05）。

| harness | `status` | `start`＋`relogin:true` | 取り消した後の資格情報のfile |
|---|---|---|---|
| Codex（本物の期限切れの写し） | `blocked`「Codexのログインの期限が切れています」 | `waiting`（URLとcode） | 消えた（Codexがログインの開始時に消す） |
| Claude Code（偽） | `authenticated`（見抜けない） | `blocked`／`input_required:true`（公式の画面で入力） | 残った |
| Grok（偽） | `blocked` | `waiting`（URLとcode） | `status`の時点でGrokが消した |
| Cursor（偽） | `failed`「Cursorのログインを確認できません」 | `waiting`（URL） | 残った |

生きているCodexのログイン（このコンテナの本物、読むだけ）は、`account/read`が`account`を返し、`auth.json`の時刻は前後で同じだった。

