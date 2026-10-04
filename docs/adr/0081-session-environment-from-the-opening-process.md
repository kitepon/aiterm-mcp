# ADR 0081: 新しい端末の環境は、その端末を開いたprocessの環境にする

状態: 採用。ADR 0025の第7項のうち「全環境の暗黙copyは行わない」と、受入の「未指定値は新たにcopyされない」を置き換える。
`env_vars`は残す。

## 原因

tmuxは、serverを起こしたclientの環境を共通環境として持ち、後から作るsessionの全部へ配る。
Aitermはtmuxのclientを、MCP processの環境のまま起こしていた（`src/tmux-runtime.ts`）。
その結果、新しい端末の環境は「最初に端末を開いた呼び出し元の環境」で決まっていた。

BellTeamの本番コンテナ（Aiterm 0.49.0、2026-10-04）で、共通環境に最初に起きた席の`BELLTEAM_PROJECT`・`PATH`・
`npm_config_prefix`・`npm_config_cache`・`PIP_CACHE_DIR`が入っていた。別の席が開く端末は、名指ししていない変数を
そこから受け取る。`npm install -g`の行き先が他の席の置き場になる。

隔離したtmux（3.5a、3.1c）で再現した。呼び出し元Aがserverを起こし、呼び出し元Bが端末を開くと、Bの端末に
Aだけが持つ変数と、同じ名前の変数のAの値が入る。

ADR 0025は、tmux serverの環境を「通常の環境」とみなし、`env_vars`で名指しした値だけを上書きする形にした。
serverの環境が特定の呼び出し元のものであることは、考えに入っていなかった。同じ利用者の中でも、
harnessによってMCP processへ渡す環境は違う（Codex 0.160.0は`HOME`・`PATH`・`SHELL`・`TERM`の4つだけ）。
どのharnessが先に端末を開いたかで、全部の端末の環境が変わっていた。

Windowsのpsmuxにはこの動きが無い。端末ごとに呼び出し元の環境を継ぐ（fox、psmux 3.3.8で実測）。

同じ行に別の誤りが2つあった。空のconfigを指す`-f`を`new-session`の引数として渡していた。`new-session`の`-f`は
clientのflagで、configを指さない。利用者の`~/.tmux.conf`が読まれていた。tmux 3.2未満は`new-session -f`を知らず、
端末を1つも開けなかった。

## 判断

### 端末の環境は、開いたprocessの環境

POSIXのtmuxで、Windowsと同じ結果にする。`new-session`の間だけ`update-environment`を差し替える。

- tmux 3.2以上は`*`。clientの環境が丸ごとsessionへ写る。
- 3.2未満はワイルドカードを持たないので、clientの環境の名前を並べる。
- 共通環境にあってclientに無い名前も並べる。tmuxは、並べた名前がclientに無いと、そのsessionで消す印を付ける。
  tmuxが起動時に自分で足す`PWD`も同じ扱いにする。

差し替え・作成・戻しは1回の呼び出しにまとめる。tmuxのserverは1つの呼び出しの命令を続けて処理するので、
差し替えている間に他の呼び出し元の`new-session`は入らない。作成が失敗すると後続の命令は実行されないため、
その時は別の呼び出しで戻す。常時`*`にしないのは、人が`attach`した時にも写しが起き、sessionの表が
人の端末の値で書き換わるため。

値はtmuxのclientからserverへの接続で渡る。コマンド行にも`.lastcmd`にも出ない。

### 作った後に確かめる

共通環境の名前が、どれもsessionの側で上書きか消去になっていることを確かめる。なっていなければsessionを捨て、
足りなかった名前を足して作り直す（3回まで）。serverが無い時に2つの呼び出し元が同時に開くと、
片方は相手が起こしたserverへ入り、消す名前を知らない。

### 継がせないもの

`AITERM_SESSION_ID`と`AITERM_AGENT_*`は、Aitermが端末ごとに付け直す名札。`TMUX`と`TMUX_PANE`は呼んだ側のpaneを指す。
入れ子の中から開いた通常PTYが、親の名札を持たないようにする。POSIXでは今までも入っていなかった。
Windowsの動きは変えない。

### 共通環境そのものは変えない

空にしない。更新した後も、前の版のMCP processはメモリに残り、同じserverで端末を開く。前の版は、端末の環境を
共通環境から受け取る。空にすると、その端末から`HOME`と`PATH`が消える。

### `env_vars`は残す

名指しした値は今までどおり`new-session -e`で渡し、sessionの表へ登録する。`pty_list`の`env_keys`で読める。
launcherの起動コマンドへ入れる動きも変えない。

`update-environment`で写した値もsessionの表に入る。そのままだと`env_keys`で、どのsessionの環境でも読める。
名指しで登録した名前をsessionのoption `@aiterm_env_keys`に控え、`env_keys`はその名前だけを返す。
控えが無いsession（前の版が開いたもの）は今までどおり表を読む。Windowsの表には名指しした値しか入らない。

### 空のconfigはtmux本体の引数で渡す

`tmux -f /dev/null -S …`。serverを起こす呼び出しだけが読む。

## 捨てた案

- 共通環境を空にする。上の理由で、前の版のprocessが開く端末を壊す。
- 呼び出し元の値を上に重ねるだけで、消さない。最初の呼び出し元だけが持つ変数が残る。
- 全部の値を`-e`で渡す。tmuxは1回の命令を約16KBまでしか受けない。値がコマンド行に出る。
- 値をfileに書いて端末の中で読む。秘密がdiskに出る。

## 利用者から見て変わること

- MCP processへ環境を少ししか渡さないharnessから開いた端末は、その分しか持たない。今までは、先に別のharnessが
  serverを起こしていれば、その環境が入っていた。要る変数は、harness側の設定でMCP processへ渡す
  （Codexは`[mcp_servers.aiterm]`の`env_vars`）。
- `~/.tmux.conf`を読まなくなる。READMEに書いてあった動きになる。
- tmux 3.2未満で端末を開ける。

## 確かめたこと

- `test/session-environment.test.mjs`。呼び出し元ごとに別processを立てる。tmux 3.5aと、`AITERM_TMUX`で指した3.1cの両方で通る。
  同じ筋書きを0.49.0で流すと、2人目の端末に1人目の値が入る。
- 新しい版が開いた端末と、同じserverで前の形（`update-environment`を触らない`new-session`）で開いた端末が並んで動く。
- 入れ子の中（`TMUX_PANE`を持つclient）から開いても、端末の`TMUX_PANE`はtmuxが付けた自分の値になる。
