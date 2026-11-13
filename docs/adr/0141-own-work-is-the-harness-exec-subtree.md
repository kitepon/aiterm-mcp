# ADR 0141: own work is only what runs under the harness's own command-execution shell

Status: adopted (0.70.44, a47). Replaces the counting rule of ADR 0080 (processes absent from the startup snapshot), and with it
ADR 0082's relay-children exception, ADR 0083 (restarted startup processes) and ADR 0084's process-table probes, which existed
only to patch that rule. ADR 0080's two fields and their null-vs-0 meaning stay.

## Cause

`activity.post_startup_process_count` and `own_work.processes` counted every process that was not in the seat when
`agent_launch` finished startup. Harnesses start much of their own machinery after that moment: MCP servers on first use or
reconnect (Codex restarted all of Epinel's MCP servers at 04:23Z, new pids), hooks that wait (the Approval Box channel waiter
under Claude waits up to ~24 h for the Owner's answer), helpers (`caffeinate`, `codex-code-mode-host`, Aiterm's own `ps`).
Each exception (0082-0084) closed one shape; the next shape again made an idle seat read as working, so it never hibernated
and BellTeam never closed it. The Owner's words for own work are "what the Bot itself started".

## Decision (Trony ruling B', 2026-11-13)

Own work = the processes in the subtree of a harness's own command-execution shell (the shell the CLI starts to run a model's
command: Claude Bash incl. `run_in_background`, Codex exec / unified exec, the Grok, Cursor and Antigravity tool shells), plus
pending child results (unchanged, parent-delivery.md). MCP servers, hooks and helpers are out by construction: they are not
started through that shell. No startup snapshot is used. The Owner's exclusion list still applies on top (`own_work.excluded`).

`core.ownExecProcesses(meta, agent, rows)`: walk down from the harness process through processes that are the harness itself
(executable name matching `AGENT_COMMAND_PATTERNS[kind]`, e.g. the npm shim's native binary, or a non-shell child carrying the
launch id in its arguments) and through the harness's sandbox wrappers; a shell child that matches the harness's exec shape
(`AGENT_EXEC_SHELLS[kind]`) is an exec root, and the root with its whole subtree is counted. Codex's tool hosts
(`codex-code-mode-host`, Windows `codex-command-runner-<ver>`) exist only to run tools: their children are exec roots.

Codex single commands (0.70.46, a56): bash and zsh `-c` replace themselves with a lone simple command (`sleep 300`), so the
exec shell's shape is gone from the table and the command runs as a direct child of Codex. Codex starts every exec in a new
session (`setsid`); MCP servers, hooks and `codex-code-mode-host` stay in the seat's session. So on POSIX a non-shell child of
Codex (or of its sandbox wrapper) that is a session leader (`ps` stat `s`) is an exec root too. Seen on macOS 0.168.0
standalone: `sleep 300` stat `Ss`, no tty, parent the native binary; MCP servers stat `S` on the seat's tty. Windows pwsh
does not replace itself, so the shell shape already covers it.

Antigravity (a41-agy, 1.5.8 captured 2026-11-13): on POSIX agy starts each command on its own pty, so the command (or the
`zsh -c` / `bash -c` around it) is a session leader under `agy`, while MCP servers and hooks stay on the seat's tty: the Codex
session-leader rule covers it, shell or not. On Windows the command runs in `pwsh -Command "try { $OutputEncoding = …"`.
agy also keeps the turn open while a background task runs: the composer is ready, the footer counts `N task(s)`, and Stop
comes only after the task ends and the model reports it. `parentPaneEvidence` reads that footer as busy, so the seat's turn
reads running (it read neither running nor idle, and BellTeam showed the seat as unknown).

Approval Box answers (Trony ruling A, 2026-11-13): a Claude seat whose Approval Box waiter is waiting reads idle and may
hibernate. Approval Box (a49, Nayuta) sends the requesting Bot one BellTeam message when an answer finds no live receiver;
that message resumes the seat and the seat calls `resume_decision`. Aiterm keeps no waiter exception.

Exec shapes (command lines as the process table shows them; fixtures in `test/own-exec-processes.test.mjs`, captured from real CLIs on 2026-11-13 unless marked):

| Harness | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Claude | `/bin/bash -c "source …/shell-snapshots/snapshot-bash-….sh … eval '<cmd>' < /dev/null && pwd -P >\| /tmp/claude-<hex>-cwd"`, direct child (Bash and `run_in_background` alike). Hooks: `/bin/sh -c <hook>` | the same with `/bin/zsh` and `snapshot-zsh-…` (2.1.323). Hooks and MCP: direct children | PowerShell tool (2.1.32x, fox 2026-11-14, Lumani): `cmd.exe /d /s /c ""chcp.com" 65001 >nul & "pwsh.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$__claudeCodeScript = $env:CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT; …""` under `claude.exe` (the command, e.g. `pwsh -File tools/build_release.ps1`, below it). Hooks: Git Bash `bash.exe -c "<hook>"` or `pwsh -NoProfile … -Command "& …"`, no launcher-script line. Git Bash commands: matched by the cwd-file rule |
| Codex | `[/bin/bash, -c, <cmd>]` under the native binary (0.167.2); sandbox `codex-linux-sandbox` between. Hooks and MCP: own argv, no shell | `[/bin/zsh, -c, <cmd>]` (0.166.0 Homebrew, 0.168.0 standalone); no `sandbox-exec` seen even with `-s workspace-write` | `pwsh.exe -Command "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n<cmd>"` under `codex.exe`. Hooks: `pwsh -NoProfile -Command "& …"`. Sandboxed: `codex-command-runner-<ver>.exe` (a tool host; its children count) |
| Grok | `/bin/bash -O extglob -c "IFS= builtin read -r -d '' __grok_user_cmd <&5; …"` (1.0.77). Hooks: `sh -c <hook>` | `/bin/zsh -c "IFS= builtin read -r -d '' __grok_user_cmd <&5; …"` | `"pwsh" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "<cmd>"`; hooks have the same head plus a `$__grokExitCode` tail |
| Cursor | `/bin/bash -O extglob -c "… builtin eval \"$1\" 3<&- 4>&- < /dev/null; …"` (2026.11.11). Hooks: the same wrapper without `< /dev/null` (stdin piped) | not captured (keychain locked over ssh); the bundle's zsh wrapper is `builtin eval "$1"[ 3<&- 4>&-] < /dev/null` unless stdin is piped | `pwsh -ExecutionPolicy Bypass -NonInteractive -File …\ps-script-<uuid>.ps1`; hooks run the same without `-NonInteractive` (the bundle adds it only when stdin is not piped) |
| Antigravity | not captured (quota); counted by the session-leader rule, which Kiro saw hold by hand (commands in their own session). Hooks: `sh -c` | 1.5.8: each command on its own pty as a session leader under `agy`: a lone `sleep 240` (stat `Ss+`, new tty) or `zsh -c "sleep 230; echo …"` with the command below. MCP servers and hooks: direct children on the seat's tty, not leaders | `"c:\program files\powershell\7\pwsh.exe" -Command "try { $OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = $OutputEncoding } catch {}; <cmd>"` under `agy.exe` (1.5.8). Hooks: `cmd /c "pwsh … -EncodedCommand"`; MCP servers: plain children |

## Direction of a miss

A command the harness runs some other way is not counted: "a rare job not counted", so an idle seat may hibernate while it
runs and hibernation ends it with the seat. The old rule's miss was "an idle seat working forever". The Owner's exclusion list
cannot add work back; the fix for a missed shape is adding the shape here.
A harness that changes its exec wrapper drops to 0 for that harness until the shape is added here; the fixture tests name
each shape so a CLI update that changes it is visible.

`processes` is null only when the harness process is unresolved or ambiguous, or the process table could not be read; seats
launched before this version (no startup snapshot) are now counted too.
