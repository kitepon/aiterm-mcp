# ADR 0136: Start the requested pane shell independently of the account shell

Date: 2026-10-30

## Problem

The macOS service runner uses `/usr/bin/false` as tmux's `default-shell`. A single `new-session` command string such as `bash` is executed through that shell. The pane exits with status 1 before Aiterm's environment readback, so creation is reported as a failure to isolate the session environment. The same isolated runner fixture with direct command arguments stays alive. This is distinct from the earlier executable-permission error in the host's tmux symlink.

## Decision

On POSIX, pass `/bin/sh`, `-c`, and the existing requested shell command as separate tmux arguments. Use the same `paneCommandArgs` adapter for creation and authentication-pane respawn. tmux executes that argv directly instead of routing it through the account's login shell. Keep the requested shell command, caller environment, legacy environment wrapper and native creation receipt intact. Windows continues through its existing PowerShell/psmux path. Do not change the account shell, server options or host permissions.

The upstream 3.1c, 3.2 and 3.8 manuals document direct execution for multiple arguments. A native regression sets `/usr/bin/false` only in a private test server, then verifies creation and respawn while the server's default stays unchanged. Existing environment tests verify isolation from earlier callers. Independent close fixtures create their unrelated native panes with explicit argv too, so they do not silently disappear under a service account.

## Fixture timing and process identity

The full macOS run after the shell fix had 1,757 passing tests and three failures. The controlled readiness fixture observed only four screen samples but took 14,240 ms, including 10,147 ms between native wrapper events. These wall-clock limits included startup of a Node wrapper for every tmux command under full-suite load. Keep elapsed time as diagnostic evidence; assert exact sample counts at the first busy redraw or known exit instead. A separate injected-clock test verifies the busy redraw returns after 1,000 ms of polling rather than consuming the unchanged 30-second readiness deadline. This is not a native dispatch latency guarantee.

The preface recorder's shell script also ended with its Node child command. A shell may replace itself with that command, removing the declared fake harness path from the process table. An explicit exit after the recorder keeps that declared process alive for the ordinary liveness check; it does not change production liveness admission.

## Exec a plain shell name (2026-11-10)

`/bin/sh -c pwsh` on Linux (dash) forks the shell instead of replacing itself, so `pane_current_command` reads `sh` and a `mark` sentinel was written in POSIX syntax into PowerShell. A command that is one plain word now runs as `/bin/sh -c 'exec <word>'`; the pane process is the requested shell, as macOS `/bin/sh` already did. Compound commands are unchanged. The first hosted macOS run (pwsh installed there, absent from the factory hosts) showed the second POSIX PowerShell defect: text typed before PSReadLine starts is garbled, so `pty_open` of `pwsh` on POSIX waits, bounded to 10 s, until its first prompt moves the cursor off column 0.

## Addendum 2026-11-10: Windows input typed while no prompt is visible

psmux can report a stale `#{pane_current_command}` for a pane, for example `pwsh` for a Git Bash pane. `markShellCommand` corrects it only from a visible prompt. Input sent while a command runs, or before the first prompt, therefore got the PowerShell scriptblock form, and bash read it afterwards (fox run 42807231169, `bash: syntax error near unexpected token [scriptblock]::Create`). `paneShellForSubmission` now remembers per pane the shell whose prompt it last saw. The pane's opening shell is remembered at `pty_open`. When no prompt is visible, the remembered shell is used instead of psmux's name. The remembered shell is per server process. A new process falls back to the previous reading until it sees a prompt.

