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

Approval Box answers (Trony ruling A, 2026-11-13): a Claude seat whose Approval Box waiter is waiting reads idle and may
hibernate. Approval Box (a49, Nayuta) sends the requesting Bot one BellTeam message when an answer finds no live receiver;
that message resumes the seat and the seat calls `resume_decision`. Aiterm keeps no waiter exception.

Exec shapes (command lines as the process table shows them; fixtures in `test/own-exec-processes.test.mjs`, captured from real CLIs on 2026-11-13 unless marked):

| Harness | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Claude | `/bin/bash -c "source …/shell-snapshots/snapshot-bash-….sh … eval '<cmd>' < /dev/null && pwd -P >\| /tmp/claude-<hex>-cwd"`, direct child (Bash and `run_in_background` alike). Hooks: `/bin/sh -c <hook>` | the same with `/bin/zsh` and `snapshot-zsh-…` (2.1.323). Hooks and MCP: direct children | not captured (login expired on the census host). Hooks: Git Bash `bash.exe -c "<hook>"` or `pwsh -NoProfile … -Command "& …"`, no cwd file. Matched by the same cwd-file rule |
| Codex | `[/bin/bash, -c, <cmd>]` under the native binary (0.167.2); sandbox `codex-linux-sandbox` between. Hooks and MCP: own argv, no shell | `[/bin/zsh, -c, <cmd>]` (0.166.0 Homebrew, 0.168.0 standalone); no `sandbox-exec` seen even with `-s workspace-write` | `pwsh.exe -Command "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n<cmd>"` under `codex.exe`. Hooks: `pwsh -NoProfile -Command "& …"`. Sandboxed: `codex-command-runner-<ver>.exe` (a tool host; its children count) |
| Grok | `/bin/bash -O extglob -c "IFS= builtin read -r -d '' __grok_user_cmd <&5; …"` (1.0.77). Hooks: `sh -c <hook>` | `/bin/zsh -c "IFS= builtin read -r -d '' __grok_user_cmd <&5; …"` | `"pwsh" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "<cmd>"`; hooks have the same head plus a `$__grokExitCode` tail |
| Cursor | `/bin/bash -O extglob -c "… builtin eval \"$1\" 3<&- 4>&- < /dev/null; …"` (2026.11.11). Hooks: the same wrapper without `< /dev/null` (stdin piped) | not captured (keychain locked over ssh); the bundle's zsh wrapper is `builtin eval "$1"[ 3<&- 4>&-] < /dev/null` unless stdin is piped | `pwsh -ExecutionPolicy Bypass -NonInteractive -File …\ps-script-<uuid>.ps1`; hooks run the same without `-NonInteractive` (the bundle adds it only when stdin is not piped) |
| Antigravity | not captured (quota 429 on all hosts until 11-14 ~10:55 JST): not counted yet. Hooks: `sh -c` (Linux), direct node (macOS), `cmd /c "pwsh … -EncodedCommand"` (Windows) | | |

## Direction of a miss

A command the harness runs some other way is not counted: "a rare job not counted", so an idle seat may hibernate while it
runs and hibernation ends it with the seat. The old rule's miss was "an idle seat working forever". The Owner's exclusion list
cannot add work back; the fix for a missed shape is adding the shape here.
A harness that changes its exec wrapper drops to 0 for that harness until the shape is added here; the fixture tests name
each shape so a CLI update that changes it is visible.

`processes` is null only when the harness process is unresolved or ambiguous, or the process table could not be read; seats
launched before this version (no startup snapshot) are now counted too.
