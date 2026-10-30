# ADR 0136: Start the requested pane shell independently of the account shell

Date: 2026-10-30

## Problem

The macOS service runner uses `/usr/bin/false` as tmux's `default-shell`. A single `new-session` command string such as `bash` is executed through that shell. The pane exits with status 1 before Aiterm's environment readback, so creation is reported as a failure to isolate the session environment. The same isolated runner fixture with direct command arguments stays alive. This is distinct from the earlier executable-permission error in the host's tmux symlink.

## Decision

On POSIX, pass `/bin/sh`, `-c`, and the existing requested shell command as separate tmux arguments. tmux executes that argv directly instead of routing it through the account's login shell. Keep the requested shell command, caller environment, legacy environment wrapper and native creation receipt intact. Windows continues through its existing PowerShell/psmux path. Do not change the account shell, server options or host permissions.

The upstream 3.1c, 3.2 and 3.8 manuals document direct execution for multiple arguments. A native regression sets `/usr/bin/false` only in a private test server, then verifies that the requested shell accepts input and retains its session identity. Existing environment tests verify isolation from earlier callers.
