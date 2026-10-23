---
title: "psmux #622 has-session preserves live registry on timeout"
source_url: "https://github.com/psmux/psmux/commit/9f141d1dbeff38116dd3bb164167fcc97e495f59.patch"
source_type: official_source
fetched: 2026-10-23
topic: backends
tags: ["psmux", "windows", "registry", "timeout"]
summary: "Upstream has-session deleted .port after any connect failure; fix limits cleanup to refusal or dead PID."
relevance: "Candidate explanation for disappearance between payload and Enter under hosted load; not proof that it caused the observed Aiterm failure."
chars: 16412
---

From 9f141d1dbeff38116dd3bb164167fcc97e495f59 Mon Sep 17 00:00:00 2001
From: psmux <52248669+psmux@users.noreply.github.com>
Date: Tue, 1 Sep 2026 21:59:02 +0530
Subject: [PATCH] fix(#622): has-session reaps the port file only on refusal or
 a dead pid anchor, never on a timeout

The `has-session` arm read the session's `.port`, connected with a 500ms
budget and, on ANY connect failure, ran `std::fs::remove_file(&path)` under
the comment "Stale port file - clean it up". It never separated
ConnectionRefused (nobody listening, truly dead) from TimedOut (the server
is alive, it just did not reach accept() inside 500ms), and it never asked
the PID anchor. A read only predicate was therefore mutating the registry:
one slow accept and the live server's registration was gone, so `psmux ls`
stopped listing a session whose server was still running, until the server
rewrote its files on the next 5s registry tick.

The four sibling reap sites (ls/list-sessions, list-panes, list-windows and
kill-session) already carry the guard this one was missing: "Only prune a
session that ACTIVELY refused (truly dead); a timeout means busy-but-alive
and must not be deleted." tmux is the parity reference here and never
unlinks registry state from has-session at all.

has-session now reaps only when the connect was actively refused, or when
registry_pid_anchor_alive says the anchored process is gone (a dead loopback
port can time out rather than refuse on Windows, which is why #546 added the
same anchor check to the stale port sweep). The reap goes through
remove_session_registry so the `.key` and `.sid` leave with the `.port`
instead of being stranded (#530). A plain timeout now exits 1 and touches
nothing.

Reproduced and verified with tests/test_issue622_hassession_timeout_reap.ps1
(15 assertions): a timing out probe against a live server keeps its whole
registry and does not disturb any other session, a live session still exits
0, and a server killed by its own pid is still reaped at exit 1.

Claude-Session: https://claude.ai/code/session_01M3Z9jhFVpPtpyntiCQ1fJh
---
 src/main.rs                                   |  23 +-
 .../test_issue622_hassession_timeout_reap.ps1 | 224 ++++++++++++++++++
 2 files changed, 242 insertions(+), 5 deletions(-)
 create mode 100644 tests/test_issue622_hassession_timeout_reap.ps1

diff --git a/src/main.rs b/src/main.rs
index 8979cd9e..491d3c94 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -2819,10 +2819,14 @@ fn run_main() -> io::Result<()> {
                         let addr = format!("127.0.0.1:{}", port);
                         // Actually authenticate and query the server to ensure it's healthy
                         let session_key = read_session_key(&target).unwrap_or_default();
-                        if let Ok(mut s) = std::net::TcpStream::connect_timeout(
+                        let conn = std::net::TcpStream::connect_timeout(
                             &addr.parse().unwrap(),
                             Duration::from_millis(500)
-                        ) {
+                        );
+                        // Only prune a session that ACTIVELY refused (truly dead);
+                        // a timeout means busy-but-alive and must not be deleted.
+                        let refused = matches!(&conn, Err(e) if e.kind() == io::ErrorKind::ConnectionRefused);
+                        if let Ok(mut s) = conn {
                             let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
                             let _ = write!(s, "AUTH {}\n", session_key);
                             let _ = write!(s, "session-info\n");
@@ -2838,10 +2842,19 @@ fn run_main() -> io::Result<()> {
                             }
                             // Fallback: connection succeeded so session likely exists
                             std::process::exit(0);
-                        } else {
-                            // Stale port file - clean it up
-                            let _ = std::fs::remove_file(&path);
+                        } else if refused
+                            || crate::session::registry_pid_anchor_alive(&target) == Some(false)
+                        {
+                            // Truly dead: it either refused outright, or its PID
+                            // anchor names a process that is gone (a dead loopback
+                            // port can time out rather than refuse on Windows).
+                            // Reap the WHOLE set: dropping the `.port` alone would
+                            // strand its siblings where no sweep can reach them (#530).
+                            crate::session::remove_session_registry(&target);
                         }
+                        // Anything else (a plain timeout against a live server that
+                        // was merely slow to accept) exits 1 without touching the
+                        // registry: has-session is a predicate, not a reaper (#622).
                     }
                 }
                 std::process::exit(1);
diff --git a/tests/test_issue622_hassession_timeout_reap.ps1 b/tests/test_issue622_hassession_timeout_reap.ps1
new file mode 100644
index 00000000..15b6e593
--- /dev/null
+++ b/tests/test_issue622_hassession_timeout_reap.ps1
@@ -0,0 +1,224 @@
+# Issue #622: has-session deleted a LIVE server's .port file on a connect
+# timeout, un-listing the session until the server's next registry tick.
+#
+# The `has-session` arm read the session's `.port`, connected with a 500ms
+# budget and, on ANY connect failure, did:
+#
+#     } else {
+#         // Stale port file - clean it up
+#         let _ = std::fs::remove_file(&path);
+#     }
+#
+# No distinction between ConnectionRefused (nobody is listening, truly dead)
+# and TimedOut (the server is alive but did not get round to accept() inside
+# 500ms), and no consultation of the PID anchor. A read-only predicate was
+# therefore mutating the registry: one slow accept and `psmux ls` stopped
+# listing a session whose server was still running, until the server rewrote
+# its registry files on the 5s tick.
+#
+# The four sibling reap sites (ls/list-sessions, list-panes, list-windows and
+# kill-session) already gate on:
+#
+#     // Only prune a session that ACTIVELY refused (truly dead);
+#     // a timeout means busy-but-alive and must not be deleted.
+#
+# tmux parity: tmux never unlinks registry state from has-session. It answers
+# the predicate and leaves the socket alone.
+#
+# What this suite pins:
+#   * a has-session whose connect TIMES OUT exits 1 and deletes NOTHING
+#     (.port, .key and .sid all survive, and the server process is untouched)
+#   * the failed probe does not cascade onto any other live session
+#   * once the registry names the real port again, ls lists the session and
+#     has-session exits 0
+#   * a genuinely dead server IS still reaped, and has-session still exits 1
+#
+# The timeout is produced by repointing `.port` at a loopback port nothing has
+# ever bound: Windows drops the SYN and retransmits rather than answering with
+# an RST, so the connect burns the whole 500ms budget (the same behaviour that
+# #605 measured at about 2s to a refusal). The `.pid` anchor still names the
+# live server, which is exactly the busy-but-alive shape.
+#
+# Set PSMUX_TEST_BIN to test a non-installed binary.
+
+$ErrorActionPreference = "Continue"
+$PSMUX = if ($env:PSMUX_TEST_BIN) { $env:PSMUX_TEST_BIN } else { (Get-Command psmux -EA Stop).Source }
+$script:Pass = 0; $script:Fail = 0
+function Write-Pass($m) { Write-Host "  [PASS] $m" -ForegroundColor Green; $script:Pass++ }
+function Write-Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:Fail++ }
+function Write-Info($m) { Write-Host "  [INFO] $m" -ForegroundColor DarkCyan }
+
+Write-Host "binary: $PSMUX" -ForegroundColor Cyan
+
+# Inherited session routing would aim these calls at somebody else's server.
+$env:PSMUX_SESSION_NAME = $null
+$env:PSMUX_SESSION      = $null
+$env:PSMUX_PANE         = $null
+$env:TMUX               = $null
+$env:TMUX_PANE          = $null
+
+$rig  = Join-Path $env:TEMP ("psmux622-" + [guid]::NewGuid().ToString('N').Substring(0,8))
+$root = Join-Path $rig 'data'
+New-Item -ItemType Directory -Force -Path $rig, $root | Out-Null
+$env:PSMUX_DATA_DIR = $root
+
+$busy = 'i622busy-' + [guid]::NewGuid().ToString('N').Substring(0,6)
+$peer = 'i622peer-' + [guid]::NewGuid().ToString('N').Substring(0,6)
+
+function Run($argv) {
+    $out = & $PSMUX @argv 2>&1
+    $rc = $LASTEXITCODE
+    return @{ rc = $rc; out = ((($out | Out-String) -replace '\s+', ' ').Trim()) }
+}
+
+# A loopback port nothing is bound to: the connect will not be answered.
+function Get-FreePort {
+    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
+    $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); return $p
+}
+
+function Registry-Path($name, $ext) { Join-Path $root "$name.$ext" }
+
+function Read-Trimmed($p) {
+    try { return (Get-Content -LiteralPath $p -Raw -EA Stop).Trim() } catch { return $null }
+}
+
+function Get-ServerPid($name) {
+    $raw = Read-Trimmed (Registry-Path $name 'pid')
+    if (-not $raw) { return $null }
+    $n = ($raw -split ':')[0]
+    if ($n -match '^\d+$') { return [int]$n }
+    return $null
+}
+
+function Is-Alive($processId) {
+    if ($null -eq $processId) { return $false }
+    return $null -ne (Get-Process -Id $processId -EA SilentlyContinue)
+}
+
+function Kill-RigServers {
+    Get-ChildItem (Join-Path $root '*.pid') -EA SilentlyContinue | ForEach-Object {
+        $raw = (Get-Content -LiteralPath $_.FullName -Raw -EA SilentlyContinue)
+        if ($raw) {
+            $n = ($raw.Trim() -split ':')[0]
+            if ($n -match '^\d+$') { try { Stop-Process -Id ([int]$n) -Force -EA Stop } catch {} }
+        }
+    }
+    Start-Sleep -Milliseconds 400
+}
+
+try {
+    # === 0. Two live sessions ===
+    Write-Host "`n--- two live sessions in an isolated registry ---" -ForegroundColor Yellow
+    $r = Run @('new-session','-d','-s',$busy)
+    if ($r.rc -ne 0) { Write-Fail "could not create '$busy' (rc=$($r.rc)) '$($r.out)'"; throw "setup" }
+    $r = Run @('new-session','-d','-s',$peer)
+    if ($r.rc -ne 0) { Write-Fail "could not create '$peer' (rc=$($r.rc)) '$($r.out)'"; throw "setup" }
+    Start-Sleep -Seconds 2
+
+    $portFile = Registry-Path $busy 'port'
+    $keyFile  = Registry-Path $busy 'key'
+    $sidFile  = Registry-Path $busy 'sid'
+    $realPort = Read-Trimmed $portFile
+    $serverPid = Get-ServerPid $busy
+    if (-not $realPort -or $null -eq $serverPid) {
+        Write-Fail "registry for '$busy' is incomplete (port='$realPort' pid='$serverPid')"; throw "setup"
+    }
+    Write-Info "'$busy' registered on port $realPort, server pid $serverPid"
+
+    $r = Run @('ls')
+    if ($r.rc -eq 0 -and $r.out -match [regex]::Escape($busy)) {
+        Write-Pass "ls lists '$busy' before the probe: '$($r.out)'"
+    } else { Write-Fail "ls did not list '$busy' (rc=$($r.rc)) '$($r.out)'" }
+
+    # === 1. THE #622 SHAPE: the connect times out against a LIVE server ===
+    Write-Host "`n--- has-session whose connect times out ---" -ForegroundColor Yellow
+    Set-Content -NoNewline -LiteralPath $portFile -Value "$(Get-FreePort)"
+    $sw = [System.Diagnostics.Stopwatch]::StartNew()
+    $r = Run @('has-session','-t',$busy)
+    $sw.Stop()
+    $ms = [int]$sw.Elapsed.TotalMilliseconds
+    Write-Info "has-session rc=$($r.rc) ms=$ms out='$($r.out)'"
+
+    if ($ms -ge 450) {
+        Write-Pass "the connect timed out rather than being refused (${ms}ms >= the 500ms budget)"
+    } else {
+        Write-Fail "the connect finished in ${ms}ms, so this run tested a refusal, not the #622 timeout"
+    }
+    if ($r.rc -eq 1) { Write-Pass "has-session exits 1 on an unreachable port (tmux parity)" }
+    else { Write-Fail "expected exit 1, got $($r.rc)" }
+
+    if (Is-Alive $serverPid) { Write-Pass "the server (pid $serverPid) is still running" }
+    else { Write-Fail "the server died on its own; this run proves nothing" }
+
+    if (Test-Path -LiteralPath $portFile) {
+        Write-Pass "the live server's .port SURVIVED the timeout (#622)"
+    } else { Write-Fail "has-session deleted a live server's .port on a timeout (#622)" }
+    if (Test-Path -LiteralPath $keyFile) { Write-Pass "the .key survived" }
+    else { Write-Fail "has-session deleted a live server's .key on a timeout" }
+    if (Test-Path -LiteralPath $sidFile) { Write-Pass "the .sid survived" }
+    else { Write-Fail "has-session deleted a live server's .sid on a timeout" }
+
+    # === 2. No cascade onto the other live session ===
+    Write-Host "`n--- the failed probe must not touch anybody else ---" -ForegroundColor Yellow
+    $r = Run @('ls')
+    if ($r.rc -eq 0 -and $r.out -match [regex]::Escape($peer)) {
+        Write-Pass "ls still lists the untouched session '$peer': '$($r.out)'"
+    } else { Write-Fail "ls lost '$peer' after probing '$busy' (rc=$($r.rc)) '$($r.out)'" }
+    if (Test-Path -LiteralPath (Registry-Path $peer 'port')) {
+        Write-Pass "'$peer' kept its own .port"
+    } else { Write-Fail "'$peer' lost its .port" }
+
+    # === 3. Once the registry names the real port again, nothing was lost ===
+    # This is what the server's own 5s registry tick does. Because the entry was
+    # never unlinked, the session comes straight back into ls.
+    Write-Host "`n--- the registry entry is intact, so the session relists ---" -ForegroundColor Yellow
+    Set-Content -NoNewline -LiteralPath $portFile -Value $realPort
+    $r = Run @('has-session','-t',$busy)
+    if ($r.rc -eq 0) { Write-Pass "has-session on the live session exits 0" }
+    else { Write-Fail "expected exit 0 on a reachable live session, got $($r.rc) '$($r.out)'" }
+    $r = Run @('ls')
+    if ($r.rc -eq 0 -and $r.out -match [regex]::Escape($busy)) {
+        Write-Pass "ls lists '$busy' again: '$($r.out)'"
+    } else { Write-Fail "ls did not relist '$busy' (rc=$($r.rc)) '$($r.out)'" }
+
+    # === 4. A genuinely dead server IS still reaped ===
+    # The fix must not turn has-session into a hoarder: kill the server by its
+    # own pid and the entry has to go.
+    Write-Host "`n--- a genuinely dead server is still reaped ---" -ForegroundColor Yellow
+    try { Stop-Process -Id $serverPid -Force -EA Stop } catch { Write-Info "stop failed: $_" }
+    for ($i = 0; $i -lt 40; $i++) { if (-not (Is-Alive $serverPid)) { break }; Start-Sleep -Milliseconds 100 }
+    if (Is-Alive $serverPid) {
+        Write-Fail "could not stop the server pid $serverPid; skipping the reap arm"
+    } else {
+        Write-Info "server pid $serverPid is gone; .port present = $(Test-Path -LiteralPath $portFile)"
+        $r = Run @('has-session','-t',$busy)
+        if ($r.rc -eq 1) { Write-Pass "has-session on a dead server exits 1" }
+        else { Write-Fail "expected exit 1 for a dead server, got $($r.rc) '$($r.out)'" }
+        if (-not (Test-Path -LiteralPath $portFile)) {
+            Write-Pass "the dead registration was reaped"
+        } else { Write-Fail "the dead .port survived; the next caller will re-litigate it" }
+        if (-not (Test-Path -LiteralPath $keyFile) -and -not (Test-Path -LiteralPath $sidFile)) {
+            Write-Pass "the whole set went with it (.key and .sid, per #530)"
+        } else { Write-Fail "the reap stranded siblings: .key/.sid outlived the .port" }
+    }
+
+    # === 5. A name that was never registered ===
+    Write-Host "`n--- a name that was never registered ---" -ForegroundColor Yellow
+    $r = Run @('has-session','-t',('i622ghost-' + [guid]::NewGuid().ToString('N').Substring(0,6)))
+    if ($r.rc -eq 1) { Write-Pass "has-session on an unknown name exits 1" }
+    else { Write-Fail "expected exit 1 for an unknown name, got $($r.rc) '$($r.out)'" }
+}
+catch { Write-Info "aborted: $_" }
+finally {
+    Run @('kill-session','-t',$busy) | Out-Null
+    Run @('kill-session','-t',$peer) | Out-Null
+    Kill-RigServers
+    $env:PSMUX_DATA_DIR = $null
+    Remove-Item -LiteralPath $rig -Recurse -Force -EA SilentlyContinue
+}
+
+Write-Host "`n=== Results ===" -ForegroundColor Cyan
+Write-Host "  Passed: $($script:Pass)" -ForegroundColor Green
+Write-Host "  Failed: $($script:Fail)" -ForegroundColor $(if ($script:Fail -gt 0) { "Red" } else { "Green" })
+exit $script:Fail
