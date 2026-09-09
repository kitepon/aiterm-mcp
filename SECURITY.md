# Security Policy

## Supported versions

aiterm-mcp is published from a single `0.x` line on npm. Security fixes land on the **latest released `0.x` version** only; there are no maintained back-port branches for older releases.

| Version | Supported |
| --- | --- |
| Latest published `0.x` | Yes — fixes released here |
| Any older `0.x` | No — upgrade to the latest |

古い版を使っている場合は、報告前に`npm install -g aiterm-mcp@latest`で更新し、`aiterm-setup --json`を再実行してMCP clientを再起動する。手動npx設定は`npx -y aiterm-mcp@latest`で確認する。

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue or pull request.

Use GitHub's private vulnerability reporting on the repository:

1. Go to <https://github.com/kitepon/aiterm-mcp>.
2. Open the **Security** tab → **Report a vulnerability** (GitHub Security Advisories).

That opens a private advisory thread visible only to you and the maintainer. Please do not email; the maintainer responds through GitHub.

A useful report includes:

- the affected version (the npm version of `aiterm-mcp` you ran),
- your OS and how aiterm is launched (Linux/WSL2, macOS, or native Windows),
- the multiplexer version (`tmux -V` on POSIX or `psmux -V` on native Windows),
- a minimal sequence of tool calls (`pty_open` / `pty_send` / `pty_read` …) that reproduces it,
- the impact you observed.

### Response expectations

aiterm-mcp is a **solo, best-effort open-source project**. There is no SLA. The maintainer aims to acknowledge a valid report and assess it as time allows, then fix and release on the latest `0.x` line. Please allow a reasonable window for a fix before any public disclosure, and coordinate timing through the advisory thread. Credit in the advisory/release notes is offered on request.

## Security model & limitations

Read this before deploying aiterm-mcp anywhere the consequences matter. The design goal is an honest, observable terminal — **not** a sandbox. The guards below are tripwires and input hygiene, not a security boundary.

### The server holds a real local PTY — treat it accordingly

aiterm-mcp grabs **one real local terminal** (a tmux pane running your shell) and lets the connected MCP client drive it with `pty_send`. **Anything you could type into that shell, the AI can run** — with your user, your environment, your filesystem, your network, your SSH keys and agent. Sending `ssh host` or `docker exec -it … bash` simply nests into that one PTY, so the AI's reach extends to wherever that shell can go.

Consequences for operators:

- Run aiterm-mcp under a user account whose privileges you are willing to expose to the connected client. Do not run it as root, and prefer a least-privilege account for sensitive environments.
- Only connect MCP clients / models you trust to drive a shell on that account.
- Sessions are backed by tmux on POSIX and psmux on native Windows, and **persist across MCP-server and client restarts** while that multiplexer server remains running. A session opened earlier is still live and drivable later. Use `pty_list` to see them and `pty_close` (or the platform-specific kill-server command) to remove them.
- Sessions live on a **shared tmux socket or psmux namespace**, so a human can `attach` to the same pane (the `pty_open` return value prints the exact command). This is intended co-driving, but it also means anyone with access to that socket/namespace and host user can observe and drive the session.

### Portable fork context becomes launcher input

When `throughline_source_session` is supplied, aiterm asks the locally installed
Throughline CLI for that session's read-only handoff context and prepends it to
the new mission before launching the selected harness CLI. Aiterm does not copy
or reassign the source database rows and does not add network transport, but the
returned memory becomes input to the launched agent and is therefore subject to
that product's normal processing and retention behavior. Omit the field when
that transfer is not intended.

### Selected launcher environment values are not secret transport

Canonical `agent_launch` and its four compatibility aliases accept `env_vars` as an allowlist of environment-variable
names. At launch, aiterm reads present values from its current MCP process and
shell-quotes them into the one harness launch command. This deliberately bypasses
the potentially stale environment of a tmux server that was started earlier.

The values are not supplied in MCP tool arguments, but they do pass through the
PTY command and aiterm's per-session `.lastcmd` file, and the launched harness can
read them normally. Any process with access to the same OS account may also be
able to inspect that state. Use `env_vars` only for values such as seat identity
or workflow routing that the selected harness and host user are allowed to see.
Do not use it as a credential or secret-delivery mechanism. Missing names are
omitted, invalid shell variable names fail before session creation, and aiterm
does not copy the whole environment or mutate/restart the tmux server.

### The destructive-command gate is a TRIPWIRE, not a sandbox

Before sending, `pty_send` matches the text against a small set of regexes for well-known catastrophic forms (e.g. `rm -rf /` and `~`/`$HOME`/glob-root variants, `mkfs`, `dd … of=/dev/…`, redirects to raw block devices, `DROP TABLE`/`DROP DATABASE`/`DROP SCHEMA`/`TRUNCATE TABLE`, `curl … | sh`, the classic fork bomb, `chmod -R 000 /`, `git reset --hard`). A match is **blocked** and the caller must pass `force: true` to proceed.

This is a speed-bump against obvious accidents, **not** a safety boundary. It is a syntactic pattern match on the literal text you send, so it does **not** catch:

- **Relative-path destruction** — e.g. `rm -rf somedir` from a directory that matters; the patterns target absolute/`~`/`$HOME`/glob roots (and a bare trailing `.`/`*`), not arbitrary relative paths.
- **Danger that only appears after expansion** — anything that becomes destructive once the shell expands a variable, glob, command substitution, or alias (`rm -rf "$DIR"`, `rm -rf $EMPTY/`, etc.). The gate sees the pre-expansion text, not the resolved command.
- **Commands on the far side of a nested session** — once you've `ssh`'d or `docker exec`'d into another host/container, the destructive text runs **there**, and the gate (which inspects the bytes you send, not what the remote shell ultimately executes) does not meaningfully protect the remote.
- **Anything not on the list** — it is a denylist of *blocked* forms, not an exhaustive classifier. Novel or obfuscated destructive commands pass through.

Do not rely on the gate as your only protection. Use OS-level isolation (a dedicated user, container, VM, restricted credentials, backups) for anything you actually care about. `force: true` bypasses the gate entirely, and `raw: true` bypasses input sanitization (see below).

### Input sanitization on `pty_send` (control / paste markers)

By default `pty_send` strips bracketed-paste terminators (`ESC[200~` / `ESC[201~`), ANSI/CSI/OSC escape sequences, and other control characters from the text before it reaches the pane (tab and newline are preserved). This reduces the chance that pasted/streamed content smuggles in terminal escape sequences or breaks out of a bracketed-paste region into unintended execution.

This sanitization is **opt-out**: `raw: true` sends the bytes verbatim, and `force: true` bypasses the destructive gate. Both exist deliberately for legitimate use; understand that using them removes the corresponding protection.

### Output neutralization on `pty_read`

`pty_read` strips/normalizes control characters and ANSI escapes from the text it returns (carriage-return progress overwrites are collapsed to their final state, escape sequences removed). This keeps captured terminal output from injecting control sequences into the consuming client's display, in addition to reducing tokens. `pty_read({ raw: true })` returns the unprocessed text and therefore does **not** neutralize it.

### Session-name validation (path-traversal / injection)

Session names are validated against `^[A-Za-z0-9_-]{1,64}$` at **every entry point** (`pty_open`, `pty_send`, `pty_read`, `pty_key`, `pty_close`). Names flow into filesystem paths (the per-session `.log` / `.offset` / `.lastcmd` files) and into the `pipe-pane` shell string, so the restriction blocks path traversal (`../`) and shell-injection metacharacters (quotes, `$`, `;`, …). The log path written into `pipe-pane`'s `/bin/sh -c` argument is additionally single-quoted with `'\''` escaping, defending the tmux-internal path even against quote-bearing temp directories.

### Multiplexer configuration

The multiplexer is started with an empty config (`-f /dev/null` on POSIX, `-f NUL` on native Windows), so it does **not** read the user's tmux/psmux config. This is for reproducibility across machines, but it also means local multiplexer hardening does **not** apply to aiterm's sessions. All aiterm sessions share one socket or namespace; the platform's `kill-server` command terminates all of them at once.

### Native Windows note

Native Windows uses psmux 3.3.8 or newer and Git for Windows directly; it does not bridge through WSL. The shell, session, psmux namespace, agent credentials, and human `attach` therefore belong to the Windows user and Windows filesystem. WSL2 remains a separate supported POSIX environment with its own tmux server and state; do not treat the two as one credential or session boundary.

### Out of scope

aiterm-mcp does not attempt to sandbox, audit, or rate-limit what the connected client does with the terminal, and it does not authenticate clients — it speaks stdio to whatever MCP client launched it. Isolation and access control are the operator's responsibility (OS user, container/VM, credential scoping). Reports that amount to "the AI ran a command I gave it the ability to run" describe intended behavior, not a vulnerability. Genuine issues — e.g. a way to bypass session-name validation, escape the `pipe-pane` quoting, inject escape sequences past the `pty_send`/`pty_read` sanitizers, or otherwise make aiterm do something its documented model says it should not — are in scope; please report them as above.
