# Bound remote terminal adapter (C3 / C7 / C8)

Owner: Elegg. Consumers: BellTeam `terminals.connection` (Crust: binding, reachability, C8 setup), `execution` (Kiro, seat lifecycle), Throughline ingest (Rivalin, via execution). Contract sources: BellTeam PR 764 `modules/terminals/README.md` C3/C7/C8, PR 765 `modules/execution/remote-seat.md`. First scope: macOS target, Claude Code. Diagram: [remote-terminal.dot](remote-terminal.dot). Remote seats whose launch env contains credential names keep the existing rule: no resume recipe, so a hibernated one is relaunched fresh. It extends the existing [SSH relay](remote.dot); the per-call `remote` tool argument path is unchanged.

The key is readable only by UID1000 (no copy, no chmod), so every terminal SSH runs in a UID1000 Aiterm process: BellTeam's `execution-native-server` and the commands it runs from receipts.

## One launch path (Owner ruling 2026-11-09)

A terminal seat is launched by the same agent tool as a local seat. There is no second public entry for seats.

| Step | Public surface | What Aiterm does |
| --- | --- | --- |
| launch | `agent_launch`, `claude_agent`, `codex_agent`, `grok_agent` + `terminal: {ref, target: {host, user, port}, trustRevision, credentialRevision}` + `cwd` | `terminal` is the value BellTeam terminals hands to execution (binding ref + its revisions), passed unchanged. Omitted = local, as before. Strict schema; a malformed value is `TERMINAL_INVALID`, never guessed, never a local fallback. `cwd` is required (absolute, on that terminal). Not combinable with `remote`. First scope harness `claude-code`; others `TERMINAL_HARNESS_UNSUPPORTED` |
| launch (inside) | `remote-terminal.ts` `terminalTarget` -> `remote.ts` | Binding and both revisions must match (T1). The launch call runs on its own SSH whose stdin first carries the private env line (R5): the values of `env_vars` (read from this process as for a local seat) and the header values of `mcp_config`, which are replaced in the config by `${AITERM_MCP_HEADER_n}`. Seat URLs under `/api/seat-mcp` get origin `http://127.0.0.1:<P>` (R12). harness `claude-code` calls the terminal's `claude_agent` (its `agent_launch` drops `mcp_config` before this release). On success the session is bound (T2) |
| later calls | `pty_send`, `pty_observe`, `pty_read`, `pty_key`, `claude_turn`, `pty_close`, execution `agent_stop`, … with `session_id` only | `registerRemoteAwareTool` finds the session in the terminal session map and forwards the same tool over a trusted SSH (`remote.ts` per-call path, R4). `pty_close` success unbinds. `agent_stop`: terminal `pty_observe`, then one `C-c` by `pty_key` only while `busy` (the plain terminal server has no `agent_stop`; the seat's own children on the terminal are not walked) |
| wait | receipt `wait_process` | `ssh` argv with the trusted options running the terminal's `aiterm-wait`; run as returned by a UID1000 process |
| transcript | `aiterm-transcript-read --session S [--cursor-session ID --offset N] [--max-bytes N]` | Local seat: reads locally. Bound session: runs the same reader on the terminal over trusted SSH. One JSON line `aiterm.transcript-read.v1` |
| seat MCP | reverse forward keeper (R12) | One Aiterm process per terminal holds `ssh -N -R 127.0.0.1:P:127.0.0.1:<seat ingress>` while bound sessions exist (lock in the state root); P is recorded in the binding and reused on reconnect |

`aiterm-remote-terminal` stays for terminals' binding/status/trust-confirm, the reachability check (`serve` open/close) and C8 `remote_terminal_command`. Its `remote_terminal_call` is no longer a seat launch path.

| ID | State | Content |
| --- | --- | --- |
| T1 | launch check | `terminal.ref` -> binding; `terminal.target` equals binding target; `trustRevision` equals current status. Key source: with `credential: {handle (UUID), revision (positive integer)}` (Mika's handle; `credentialRevision` must be absent; keyless bindings only) the key must already be loaded by `credential-load` for this ref with the same handle and revision (`CREDENTIAL_NOT_LOADED` / `CREDENTIAL_REVISION_STALE` otherwise); without it `credentialRevision` must equal the native key revision. A binding without a native key requires `credential` (`CREDENTIAL_REQUIRED`). `sudoCredential: {handle, revision}` (the terminal's sudo password) is only accepted and kept as a handle; nothing resolves or uses it until an explicit sudo operation exists. Later calls use the binding's current trust file with strict host checking, without revisions |
| T2 | terminal session map | `<state root>/terminal-seats.json` (0600) `{session_id: ref}`; written after a successful terminal launch, removed after `pty_close`. Survives an Aiterm restart; the seat itself lives on the terminal |
| T3 | forward lock | `<state root>/terminal-forward-<ref>.lock` `{pid}`; taken when absent or its pid is gone. Every UID1000 Aiterm process with bound sessions checks it every 60 s, so a dead owner is replaced automatically |

## Function map

| Function | Owner / file | Input -> result |
| --- | --- | --- |
| binding store | `remote-terminal.ts`, `~/.config/aiterm/remote-bindings.json` (0600; durable, independent of the caller's state-root env) | `aiterm.remote-binding.v1` {ref, target {host,user,port}, key_file (null when the key comes from a credential handle), known_hosts_file, host_key_alias}. Written only by the UID1000 holder through the CLI |
| `aiterm-remote-terminal register` / `trust-confirm` | `remote-terminal-cli.ts` | Register a binding from existing files -> ref + status. Without `--key-file` the binding has no native key; status reports `credential: {provider: "aiterm.credential-handle.v1", available: false, reason: "KEY_FROM_CREDENTIAL"}` and every open/launch must carry `credential`. `trust-confirm --ref --fingerprint`: scan once, write the host key only when it equals the Owner-confirmed fingerprint. A scan alone never becomes trust |
| `aiterm-remote-terminal credential-load` | `remote-terminal-cli.ts` / `remote-terminal.ts` `loadCredential` | R13. Only `--purpose ssh-key`; only keyless bindings; key bytes only on stdin (max 64 KiB) |
| `aiterm-remote-terminal status --ref R` / `remote_terminal_status({ref})` | one-shot CLI (exit 0 status, 2 `aiterm.remote-binding-error.v1`) / server tool | -> {ref, target, credential {provider: "aiterm.native-ssh-key.v1", revision: "sha256:<public key digest>", fingerprint, available}, trust {provider: "aiterm.known-hosts.v1", revision: "sha256:<matching entries digest>", fingerprints}}. Public metadata only |
| `remote_terminal_open({ref, target, trustRevision, credentialRevision, privateEnv?})` | server tool | Target must equal the binding and both revisions must be current. Loads the key into a per-connection private ssh-agent with `ssh-add <file>`, opens one long-lived MCP client over SSH to the terminal's `aiterm-mcp --private-env-stdin`. Reachability check for terminals; carries no forward. No auto-reconnect |
| `remote_terminal_call({name, args, private?, timeoutMs?})` | server tool -> terminal `index.ts` | Same tools, args and results as the local AitermClient (`agent_launch`, `pty_send`, `pty_observe`, `pty_read`, `pty_key`, `claude_turn`, `agent_stop`, `pty_close`). `private` on `agent_launch` only: `appendSystemPrompt`, `mcpConfig`; values from `privateEnv` are referenced by name through `env_vars`. Kept for existing callers; not a seat launch path (seats use the launch tools' `terminal`) |
| `remote_terminal_transcript_read({sessionName, cursor, maxBytes?})` | server tool -> terminal `aiterm-transcript-read` | Native Claude jsonl lines in [cursor.offset, offset recorded by the latest Stop) -> `{entries, cursor: {claudeSessionId, offset}}`. Whole original lines; offset is an exclusive UTF-8 byte offset |
| `remote_terminal_wait({waitProcess})` | server tool -> terminal `aiterm-wait` | A receipt's `wait_process`; only aiterm-wait's own flag/value pairs pass (`WAIT_INVALID` otherwise). Returns its one-line JSON receipt unchanged. Cancelling the MCP request stops the SSH child (`WAIT_CANCELLED`) |
| `remote_terminal_command({op})` | server tool | Fixed ops `claude_version` / `claude_install` / `claude_update` over the same bound SSH -> `{op, exit_code, version, output_tail}` |
| events | MCP notification `aiterm/remote-terminal-event` | `ready` (version), `lost` (transport ended without close), `closed` |
| `remote_terminal_close()` | server tool | Close MCP client, SSH, private agent and its directory; the server exits. Remote seats keep running |
| trusted target | `remote.ts` `sshInvocation` | A target built from a binding: `-F /dev/null`, strict known_hosts of the binding, `HostKeyAlias`, `IdentityFile=<key file>`, `IdentitiesOnly=yes`, `BatchMode=yes`, ControlMaster keyed by ref. Callers cannot build it from tool input |
| seat URL / header rewrite | `remote-terminal.ts` `rewriteSeatMcpConfig` / `extractMcpHeaders` | Seat URLs under `/api/seat-mcp` -> `http://127.0.0.1:P` (path, query kept; other servers unchanged); every header value -> `${AITERM_MCP_HEADER_n}` with the value moved to the private env line |
| forward keeper | `remote-terminal.ts` `ensureSeatForward` | T3 lock, R12 ssh, P in the binding, restart while bound sessions exist |
| `--private-env-stdin` | terminal `index.ts` | First stdin line `{"schema":"aiterm.private-env.v1","env":{...}}` before MCP -> process-private map, never `process.env` |
| launch env file / caller files | terminal `core.ts` | Inherited env values -> 0600 file sourced and deleted by the launch line; caller prompt and MCP config -> 0600 files in the launch state passed as `--append-system-prompt-file` / `--mcp-config` |
| Stop offset | terminal `claude-stop-hook.ts` | `agent_done` records `transcript_path` and `transcript_offset` (end of the last complete line at Stop) |

## Data flow

| ID | From -> to | Payload | Never carried |
| --- | --- | --- | --- |
| R1 | terminals -> `remote_terminal_status` | binding ref | paths, key |
| R2 | terminals -> `remote_terminal_open` (local stdio to UID1000) | ref, target, revisions, private env values | key/env in argv, other processes' env, files, logs |
| R3 | server -> private `ssh-agent` | `ssh-add <key file>` read by UID1000, or for a keyless binding the per-ref credential agent loaded by `credential-load` (R13); `serve` uses that agent's public key as its identity | key copy, key in any pipe |
| R4 | adapter -> `ssh` | `-F /dev/null`, explicit `-l/-p`, `-R` only on the forward keeper (R12), `StrictHostKeyChecking=yes`, `UserKnownHostsFile=<trust file>`, `GlobalKnownHostsFile=/dev/null`, `IdentityAgent=<socket>`, `IdentitiesOnly=yes` + agent public key, `BatchMode=yes` | user ssh_config aliases/options, other agent keys |
| R5 | adapter -> remote `aiterm-mcp` stdin | one private-env line, then MCP | values in argv or remote `process.env` |
| R6 | execution -> launch tool | today's launch args + `terminal` (terminals' value, unchanged) + `cwd` = projectRoot; later calls `session_id` only | secrets in any argument or prompt (values only by `env_vars` name) |
| R7 | remote Aiterm -> pane | `cd <cwd> && . <launch env file> && rm -f <file> && ... claude --append-system-prompt-file <file> --mcp-config <file>` | env values, instructions or MCP JSON in the PTY |
| R8 | Claude -> BellTeam MCP | `http://127.0.0.1:<P>/api/seat-mcp[/call-bridge]` on the terminal, through R12 to the container's loopback seat ingress (Molly, 127.0.0.1:4182). Headers as the caller wrote them (literal or `${VAR}` expanded by Claude from env) | LAN listener, Owner/internal API |
| R12 | terminal sshd -> container | forward keeper `ssh -N -R 127.0.0.1:P:127.0.0.1:<BELLTEAM_REMOTE_SEAT_PORT, default 4182>` with `ExitOnForwardFailure=yes`. First time P=0: `Allocated port P` from ssh stderr is recorded in the binding (`seat_forward_port`). Reconnects ask for the same P; refused 4 times in a row (the terminal still holds the old listener or another process took P) -> P=0 again and the new P is recorded (seats launched with the old P lose BellTeam MCP until relaunched). Each tunneled TCP connection dials the ingress fresh. The keeper restarts 15 s after its ssh exits while bound sessions exist | token, LAN listener |
| R13 | execution (resolves Mika's handle in memory) -> `aiterm-remote-terminal credential-load --ref R --terminal-id ID --handle UUID --revision N --purpose ssh-key` via the seat process runner (UID1000) | raw OpenSSH private key bytes on stdin until EOF -> `ssh-add -` into the per-ref agent (`ssh-agent -D`, socket `/tmp/aiterm-ka-<uid>/<ref8>.sock` in a 0700 own dir, detached from the one-shot). Metadata `~/.config/aiterm/credentials/<ref>.json` (0600: handle, revision, terminal id, fingerprint, agent pid). One JSON receipt line `aiterm.credential-load.v1` {accepted, ref, terminal_id, handle, revision, fingerprint} or `aiterm.remote-binding-error.v1`. A new load replaces the agent's identities. Trusted SSH for that ref uses `IdentityAgent=<socket>`, `IdentityFile=none`. The agent and metadata are removed when no terminal seat or keeper of that ref remains and no launch is pending (2 min after the load), checked every 60 s by the Aiterm processes that hold terminal seats; after a host restart the agent is gone and calls answer `CREDENTIAL_NOT_LOADED` until execution loads again | key on disk, argv, env, PTY, logs, MCP arguments |
| R9 | `transcript.read` -> remote jsonl | session -> launch metadata -> `<claude home>/projects/<encoded cwd>/<id>.jsonl` from offset | - |
| R10 | `command(op)` -> remote shell | fixed script; output tail | arbitrary command, secret |
| R11 | adapter -> terminals | events + typed results | raw ssh stderr beyond the classified line |

Instructions and the MCP config are not secrets. They live in Aiterm's own 0700 launch state on the terminal (needed for exact resume) and are removed with the launch; nothing is written to the user's home config or the project. Secret values reach the remote only through R5, are held in the remote MCP process memory, enter the seat through the existing tmux session environment and the 0600 launch env file (deleted after sourcing), and stay in the existing 0600 resume recipe for exact resume, as local seats do today.

## Errors and exits (guards)

Each code is returned to terminals, which owns the retry. Every guard has an automatic exit through an authoritative revision.

| Code | Protects | Exit |
| --- | --- | --- |
| `HOST_TRUST_MISSING` | wrong target | `trust-confirm` with the Owner-confirmed fingerprint -> new revision -> reopen |
| `BINDING_UNKNOWN` / `TARGET_MISMATCH` | wrong target | terminals uses the registered binding for this terminal; a new `register` gives a new ref |
| `CREDENTIAL_REVISION_STALE` / `CREDENTIAL_UNAVAILABLE` | credential to wrong target | re-read status (key file restored or replaced) -> reopen |
| `CREDENTIAL_REQUIRED` (binding without native key, no `credential`) / `TERMINAL_INVALID` (both `credential` and `credentialRevision`) | credential to wrong target | the registry passes the terminal's credential handle |
| `CREDENTIAL_NOT_LOADED` (no live agent/metadata for the ref, or another handle) / `CREDENTIAL_REVISION_STALE` (loaded revision differs) | credential to wrong target | execution resolves the handle and runs `credential-load`, then launches again |
| `HOST_TRUST_STALE` (revision differs from the file) | wrong target / stale binding | terminals re-reads status, rebinds its revision -> reopen |
| `HOST_KEY_MISMATCH`, action "confirm the new host key" | wrong target | Owner confirms -> `trust-confirm` replaces the entry -> new revision -> reopen |
| `AUTH_FAILED` | credential to wrong target | key or authorized_keys corrected -> new revision -> reopen |
| `UNREACHABLE` | none (availability) | network/availability event -> reopen |
| `REMOTE_AITERM_UNAVAILABLE` / `REMOTE_AITERM_TOO_OLD` | none | `command('claude_*')` does not fix this; Aiterm update on the terminal -> reopen |
| `CWD_UNAVAILABLE` (launch result) | wrong folder | member folder revision -> fresh launch. No fallback to home, no later `cd` into another folder |
| `TERMINAL_INVALID` (malformed `terminal`, missing/relative `cwd`, `terminal` with `remote`) | wrong target | caller passes terminals' value unchanged with the project folder |
| `TERMINAL_HARNESS_UNSUPPORTED` | none | use `claude-code`; other harnesses are added with the same arguments |
| `SEAT_FORWARD_UNAVAILABLE` (terminal launch with seat MCP URLs: no forward port within 30 s) | wrong target (a seat MCP URL that reaches nothing) | the keeper keeps retrying; launch again. Launches without seat URLs are not affected |
| `CONNECTION_LOST` (event `lost`, in-flight calls reject) | none | terminals reopens; the remote seat survives, the same `session_name` is observed again. Accepted `pty_send` is never replayed by the adapter |

## Verification scope

Focused tests only: trust revision and mismatch classification from ssh output; ssh argv contains no secret and no user config; private-env line parsing and that values do not reach `process.env`; the launch line and pane log contain no env value, instruction or MCP JSON; missing cwd is refused before any session exists; transcript read returns whole lines and a resumable cursor; fixed command set; terminal argument validation and harness/cwd/remote rejections; session binding and routing; header extraction; only the keeper carries `-R`; P parsing (allocated / refused) and recording; seat MCP URL origin rewrite. Real macOS acceptance on `owner-macbook` after release.
