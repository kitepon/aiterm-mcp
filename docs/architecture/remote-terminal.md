# Bound remote terminal adapter (C3 / C7 / C8)

Owner: Elegg. Consumers: BellTeam `terminals.connection` (Crust, sole opener), `execution` (Kiro, seat lifecycle), Throughline ingest (Rivalin, via execution). Contract sources: BellTeam PR 764 `modules/terminals/README.md` C3/C7/C8, PR 765 `modules/execution/remote-seat.md`. First scope: macOS target, Claude Code. Diagram: [remote-terminal.dot](remote-terminal.dot). It extends the existing [SSH relay](remote.dot); the per-call `remote` tool argument path is unchanged.

The adapter is a library export (`aiterm-mcp/dist/remote-terminal.js`), not an MCP tool, so no credential crosses an MCP tool DTO, a model-visible schema or a log. Terminals calls it inside its private effect process; only the returned typed results and events leave that process.

## Function map

| Function | Owner / file | Input -> result |
| --- | --- | --- |
| `knownHostsTrust({file, target})` | `remote-terminal.ts` | Fixed enrolled known_hosts + structured target -> `{ref: {provider: "aiterm.known-hosts.v1", revision: "sha256:<hex>"}, fingerprints: ["SHA256:..."]}` or `HOST_TRUST_MISSING`. Reads only; revision = digest of the matching entries, so a changed or replaced entry changes the revision |
| `enrollHostKey({file, target, fingerprint})` | `remote-terminal.ts` | Owner-confirmed fingerprint -> scan the host once, append the key only when its fingerprint equals the confirmed one -> new trust result. A scan alone never becomes trust (`HOST_KEY_FINGERPRINT_MISMATCH`) |
| `openRemoteTerminal({target, trust, credential, privateEnv?})` | `remote-terminal.ts` | Structured target, trust `{file, ref}`, resolved private key, optional private env values -> `RemoteTerminalConnection` or a classified `RemoteTerminalError`. One long-lived MCP client over SSH to the terminal's `aiterm-mcp --private-env-stdin`; no auto-reconnect |
| `connection.callTool(name, args, {private?, timeoutMs?})` | `remote-terminal.ts` -> remote `index.ts` | Same tools, args and results as the local AitermClient (`agent_launch`, `pty_send`, `pty_observe`, `pty_read`, `pty_key`, `claude_turn`, `agent_stop`, `pty_close`). `private` on `agent_launch` only: `appendSystemPrompt`, `mcpConfig`, `env` (names from `privateEnv`) |
| `connection.transcript.read({sessionName, cursor, maxBytes?})` | `remote-terminal.ts` -> remote `aiterm-transcript-read` | Native Claude jsonl from cursor -> `{entries: string[], cursor: {claudeSessionId, offset}}`. Whole lines only; cursor null = from start |
| `connection.command(op)` | `remote-terminal.ts` | Fixed ops `claude_version` / `claude_install` / `claude_update` over the same bound SSH -> `{op, exit_code, version, output_tail}`. No arbitrary command |
| `connection.onEvent(listener)` | `remote-terminal.ts` | `ready` (remote Aiterm initialized, version), `lost` (SSH/MCP transport ended without close), `closed` |
| `connection.close()` | `remote-terminal.ts` | Close MCP client, SSH child, private agent and its directory -> `{closed: true}`. Remote seats keep running |
| `--private-env-stdin` | remote `index.ts` | First stdin line `{"schema":"aiterm.private-env.v1","env":{...}}` before MCP -> process-private map, never `process.env` |
| private launch file | remote `core.ts` | Launch env values + private options -> 0600 files in the launch's state directory; the typed launch line references the file path, not values |

## Data flow

| ID | From -> to | Payload | Never carried |
| --- | --- | --- | --- |
| R1 | terminals -> `knownHostsTrust` | target, fixed file path | - |
| R2 | terminals -> `openRemoteTerminal` | target, trust ref, resolved key (inside Mika's `withResolved`), private env values | key/env in argv, env of other processes, files, logs |
| R3 | adapter -> private `ssh-agent` | key on `ssh-add -` stdin; agent socket in a 0700 per-connection directory | key file on disk |
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
| `HOST_TRUST_MISSING` | wrong target | `enrollHostKey` with the Owner-confirmed fingerprint -> new revision -> reopen |
| `HOST_TRUST_STALE` (ref revision differs from the file) | wrong target / stale binding | terminals re-reads `knownHostsTrust`, rebinds its revision -> reopen |
| `HOST_KEY_MISMATCH`, action "confirm the new host key" | wrong target | Owner confirms -> `enrollHostKey` replaces the entry -> new revision -> reopen |
| `CREDENTIAL_UNUSABLE` / `AUTH_FAILED` | credential to wrong target | new credential revision from Mika -> reopen |
| `UNREACHABLE` | none (availability) | network/availability event -> reopen |
| `REMOTE_AITERM_UNAVAILABLE` / `REMOTE_AITERM_TOO_OLD` | none | `command('claude_*')` does not fix this; Aiterm update on the terminal -> reopen |
| `CWD_UNAVAILABLE` (launch result) | wrong folder | member folder revision -> fresh launch. No fallback to home, no later `cd` into another folder |
| `CONNECTION_LOST` (event `lost`, in-flight calls reject) | none | terminals reopens; the remote seat survives, the same `session_name` is observed again. Accepted `pty_send` is never replayed by the adapter |

## Verification scope

Focused tests only: trust revision and mismatch classification from ssh output; ssh argv contains no secret and no user config; private-env line parsing and that values do not reach `process.env`; the launch line and pane log contain no env value, instruction or MCP JSON; missing cwd is refused before any session exists; transcript read returns whole lines and a resumable cursor; fixed command set. Real macOS acceptance on `owner-macbook` after release.
