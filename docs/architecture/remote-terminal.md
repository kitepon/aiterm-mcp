# Bound remote terminal adapter (C3 / C7 / C8)

Owner: Elegg. Consumers: BellTeam `terminals.connection` (Crust, sole opener), `execution` (Kiro, seat lifecycle), Throughline ingest (Rivalin, via execution). Contract sources: BellTeam PR 764 `modules/terminals/README.md` C3/C7/C8, PR 765 `modules/execution/remote-seat.md`. First scope: macOS target, Claude Code. Diagram: [remote-terminal.dot](remote-terminal.dot). Remote seats whose launch env contains credential names keep the existing rule: no resume recipe, so a hibernated one is relaunched fresh. It extends the existing [SSH relay](remote.dot); the per-call `remote` tool argument path is unchanged.

The adapter runs only in a UID1000 Aiterm process, because the terminal key is readable only by that user (no copy, no chmod). BellTeam spawns `aiterm-remote-terminal` (stdio MCP server, one process per bound connection) through its seat process runner; its tools are not listed by the normal `aiterm-mcp`. The key never leaves that process; only typed results and events cross the pipe.

## Function map

| Function | Owner / file | Input -> result |
| --- | --- | --- |
| binding store | `remote-terminal.ts`, `~/.config/aiterm/remote-bindings.json` (0600; durable, independent of the caller's state-root env) | `aiterm.remote-binding.v1` {ref, target {host,user,port}, key_file, known_hosts_file, host_key_alias}. Written only by the UID1000 holder through the CLI |
| `aiterm-remote-terminal register` / `trust-confirm` | `remote-terminal-cli.ts` | Register a binding from existing files -> ref + status. `trust-confirm --ref --fingerprint`: scan once, write the host key only when it equals the Owner-confirmed fingerprint. A scan alone never becomes trust |
| `aiterm-remote-terminal status --ref R` / `remote_terminal_status({ref})` | one-shot CLI (exit 0 status, 2 `aiterm.remote-binding-error.v1`) / server tool | -> {ref, target, credential {provider: "aiterm.native-ssh-key.v1", revision: "sha256:<public key digest>", fingerprint, available}, trust {provider: "aiterm.known-hosts.v1", revision: "sha256:<matching entries digest>", fingerprints}}. Public metadata only |
| `remote_terminal_open({ref, target, trustRevision, credentialRevision, privateEnv?})` | server tool | Target must equal the binding and both revisions must be current. Loads the key into a per-connection private ssh-agent with `ssh-add <file>`, opens one long-lived MCP client over SSH to the terminal's `aiterm-mcp --private-env-stdin`. No auto-reconnect |
| `remote_terminal_call({name, args, private?, timeoutMs?})` | server tool -> terminal `index.ts` | Same tools, args and results as the local AitermClient (`agent_launch`, `pty_send`, `pty_observe`, `pty_read`, `pty_key`, `claude_turn`, `agent_stop`, `pty_close`). `private` on `agent_launch` only: `appendSystemPrompt`, `mcpConfig`; values from `privateEnv` are referenced by name through `env_vars` |
| `remote_terminal_transcript_read({sessionName, cursor, maxBytes?})` | server tool -> terminal `aiterm-transcript-read` | Native Claude jsonl lines in [cursor.offset, offset recorded by the latest Stop) -> `{entries, cursor: {claudeSessionId, offset}}`. Whole original lines; offset is an exclusive UTF-8 byte offset |
| `remote_terminal_wait({waitProcess})` | server tool -> terminal `aiterm-wait` | A receipt's `wait_process`; only aiterm-wait's own flag/value pairs pass (`WAIT_INVALID` otherwise). Returns its one-line JSON receipt unchanged. Cancelling the MCP request stops the SSH child (`WAIT_CANCELLED`) |
| `remote_terminal_command({op})` | server tool | Fixed ops `claude_version` / `claude_install` / `claude_update` over the same bound SSH -> `{op, exit_code, version, output_tail}` |
| events | MCP notification `aiterm/remote-terminal-event` | `ready` (version), `lost` (transport ended without close), `closed` |
| `remote_terminal_close()` | server tool | Close MCP client, SSH, private agent and its directory; the server exits. Remote seats keep running |
| `--private-env-stdin` | terminal `index.ts` | First stdin line `{"schema":"aiterm.private-env.v1","env":{...}}` before MCP -> process-private map, never `process.env` |
| launch env file / caller files | terminal `core.ts` | Inherited env values -> 0600 file sourced and deleted by the launch line; caller prompt and MCP config -> 0600 files in the launch state passed as `--append-system-prompt-file` / `--mcp-config` |
| Stop offset | terminal `claude-stop-hook.ts` | `agent_done` records `transcript_path` and `transcript_offset` (end of the last complete line at Stop) |

## Data flow

| ID | From -> to | Payload | Never carried |
| --- | --- | --- | --- |
| R1 | terminals -> `remote_terminal_status` | binding ref | paths, key |
| R2 | terminals -> `remote_terminal_open` (local stdio to UID1000) | ref, target, revisions, private env values | key/env in argv, other processes' env, files, logs |
| R3 | server -> private `ssh-agent` | `ssh-add <key file>` read by UID1000; agent socket in a 0700 per-connection directory | key copy, key in any pipe |
| R4 | adapter -> `ssh` | `-F /dev/null`, explicit `-l/-p`, `StrictHostKeyChecking=yes`, `UserKnownHostsFile=<trust file>`, `GlobalKnownHostsFile=/dev/null`, `IdentityAgent=<socket>`, `IdentitiesOnly=yes` + agent public key, `BatchMode=yes` | user ssh_config aliases/options, other agent keys |
| R5 | adapter -> remote `aiterm-mcp` stdin | one private-env line, then MCP | values in argv or remote `process.env` |
| R6 | execution -> `callTool('agent_launch', args, {private})` | today's args (`cwd` = projectRoot), private options | - |
| R7 | remote Aiterm -> pane | `cd <cwd> && . <launch env file> && rm -f <file> && ... claude --append-system-prompt-file <file> --mcp-config <file>` | env values, instructions or MCP JSON in the PTY |
| R8 | Claude -> BellTeam MCP | headers expanded by Claude from env (`${BELLTEAM_MCP_TOKEN}`, `${AITERM_SESSION_ID}`, `${AITERM_AGENT_LAUNCH_ID}`) | token in the MCP config file |
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
| `HOST_TRUST_STALE` (revision differs from the file) | wrong target / stale binding | terminals re-reads status, rebinds its revision -> reopen |
| `HOST_KEY_MISMATCH`, action "confirm the new host key" | wrong target | Owner confirms -> `trust-confirm` replaces the entry -> new revision -> reopen |
| `AUTH_FAILED` | credential to wrong target | key or authorized_keys corrected -> new revision -> reopen |
| `UNREACHABLE` | none (availability) | network/availability event -> reopen |
| `REMOTE_AITERM_UNAVAILABLE` / `REMOTE_AITERM_TOO_OLD` | none | `command('claude_*')` does not fix this; Aiterm update on the terminal -> reopen |
| `CWD_UNAVAILABLE` (launch result) | wrong folder | member folder revision -> fresh launch. No fallback to home, no later `cd` into another folder |
| `CONNECTION_LOST` (event `lost`, in-flight calls reject) | none | terminals reopens; the remote seat survives, the same `session_name` is observed again. Accepted `pty_send` is never replayed by the adapter |

## Verification scope

Focused tests only: trust revision and mismatch classification from ssh output; ssh argv contains no secret and no user config; private-env line parsing and that values do not reach `process.env`; the launch line and pane log contain no env value, instruction or MCP JSON; missing cwd is refused before any session exists; transcript read returns whole lines and a resumable cursor; fixed command set. Real macOS acceptance on `owner-macbook` after release.
