---
title: "psmux 3.3.8 exact parsed CLI flags"
source_url: "https://raw.githubusercontent.com/psmux/psmux/v3.3.8/docs/tmux_args_reference.md"
source_type: official_flag_reference
fetched: 2026-10-21
topic: backends
tags: ["psmux", "new-session", "native-identity", "cascade-stop"]
summary: "Pinned psmux command/flag reference distinguishes accepted new-session -P/-F from unsupported or ignored flags."
relevance: "Flag availability alone does not prove a stable per-session creator/server identity. Guarded Windows creation remains unsupported until that independent adapter exists."
chars: 28003
---

# psmux Command and Flag Reference

This is the reference for the commands **psmux itself** accepts and the flags **psmux itself** parses. Every entry was read out of the psmux Rust sources, not out of the upstream tmux manual, so a flag listed here is a flag psmux actually looks at. Where tmux has a flag and psmux does not parse it, the flag is either absent from this page or listed under "Accepted but ignored".

`psmux list-commands` is the live authority. If this page and `list-commands` disagree, `list-commands` wins and this page is stale.

## How to read this page

**Layers.** psmux matches command names in four separate places, and they do not all accept the same set. A command is usable only on the layers listed for it.

| Layer | What reaches it |
|---|---|
| `CLI` | `psmux <command>` typed in a shell |
| `SRV` | key bindings, and anything the CLI forwards over the socket |
| `CFG` | config file lines, hooks, `run-shell`, `if-shell`, `bind-key` actions |
| `CTL` | control mode clients (`psmux -C` / `psmux -CC`) |

**The flags column** uses getopt style notation. A bare letter is a boolean, a letter followed by `:` takes a value. `-t:` therefore means `-t <target>`.

**`-t` is global at the CLI.** psmux scans the whole command line for `-t <target>` before the command name is even dispatched, so `psmux -t work:1 kill-pane` and `psmux kill-pane -t work:1` both work even for commands whose own parser ignores `-t`.

**Combined short flags** are expanded for `new-session` (`-As main` is `-A -s main`), for `set-option` and `show-options` (`-ga`, `-gu`, `-gq`), for `set-hook` (`-ga`, `-ug`) and for the config file forms of `if-shell` (`-bF`, `-Fb`). Elsewhere flags must be given separately.

## Complete command table

| Command | Aliases | Flags psmux parses | Layers |
|---|---|---|---|
| `attach-session` | `attach`, `a`, `at` | `t:` | CLI, SRV, CFG |
| `bind-key` | `bind` | `nrT:` | CLI, SRV, CFG, CTL |
| `break-pane` | `breakp` | `dt:` | CLI, SRV, CFG, CTL |
| `capture-pane` | `capturep` | `eJpb:E:S:t:` | CLI, SRV, CFG, CTL |
| `choose-buffer` | `chooseb` | none | CLI, SRV, CFG |
| `choose-client` | *(none)* | none | CLI, SRV, CFG |
| `choose-session` | *(none)* | none | CLI, SRV, CFG |
| `choose-tree` | *(none)* | none | CLI, SRV, CFG |
| `choose-window` | *(none)* | none | CLI, SRV, CFG |
| `clear-history` | `clearhist` | `Ht:` | CLI, SRV, CFG |
| `clear-prompt-history` | `clearphist` | none | SRV |
| `clock-mode` | *(none)* | none | CLI, SRV, CFG |
| `command-prompt` | *(none)* | `NWI:p:T:t:` | CLI, SRV, CFG |
| `confirm-before` | `confirm` | `p:` | CLI, SRV, CFG |
| `copy-mode` | *(none)* | `deHqut:` | CLI, SRV, CFG, CTL |
| `customize-mode` | *(none)* | none | CLI, SRV, CFG |
| `delete-buffer` | `deleteb` | `b:` | CLI, SRV, CFG |
| `detach-client` | `detach` | `aPE:s:t:` | CLI, SRV, CFG, CTL |
| `display-menu` | `menu` | `T:x:y:` | CLI, SRV, CFG |
| `display-message` | `display` | `pFd:I:t:` | CLI, SRV, CFG, CTL |
| `display-panes` | `displayp` | none | CLI, SRV, CFG |
| `display-popup` | `popup` | `EKc:d:h:w:` | CLI, SRV, CFG |
| `dump-layout` | *(none)* | none | SRV |
| `dump-state` | `dump` | none | CLI, SRV, CTL |
| `find-window` | `findw` | none that take effect | CLI, SRV, CFG |
| `has-session` | `has` | `t:` | CLI, SRV, CFG, CTL |
| `if-shell` | `if` | `bFt:` | CLI, SRV, CFG |
| `join-pane` | `joinp` | `dhvs:t:` | CLI, SRV, CFG |
| `kill-pane` | `killp` | `t:` | CLI, SRV, CFG, CTL |
| `kill-server` | *(none)* | none | CLI, SRV, CFG, CTL |
| `kill-session` | `kill-ses` | `t:` | CLI, SRV, CFG |
| `kill-window` | `killw` | `at:` | CLI, SRV, CFG, CTL |
| `last-pane` | `lastp` | none | CLI, SRV, CFG, CTL |
| `last-window` | `last` | none | CLI, SRV, CFG, CTL |
| `link-window` | `linkw` | `s:t:` | CLI, SRV, CFG |
| `list-buffers` | `lsb` | `F:t:` | CLI, SRV, CFG, CTL |
| `list-clients` | `lsc` | `F:` (SRV and CTL only) | CLI, SRV, CFG, CTL |
| `list-commands` | `lscm` | none | CLI, SRV, CFG, CTL |
| `list-keys` | `lsk` | `T:t:` | CLI, SRV, CFG, CTL |
| `list-panes` | `lsp` | `asF:t:` | CLI, SRV, CFG, CTL |
| `list-sessions` | `ls` | `F:f:` | CLI, SRV, CFG, CTL |
| `list-tree` | *(none)* | none | SRV |
| `list-windows` | `lsw` | `aJF:t:` | CLI, SRV, CFG, CTL |
| `load-buffer` | `loadb` | `wb:` | CLI, SRV, CFG |
| `lock-client` | `lockc` | none | CLI, SRV, CFG |
| `lock-server` | `lock` | none | CLI, SRV, CFG |
| `lock-session` | `locks` | none | CLI, SRV, CFG |
| `move-pane` | `movep` | `dhvs:t:` | CLI, SRV, CFG |
| `move-window` | `movew` | `abrdks:t:` | CLI, SRV, CFG |
| `new-pane` | `newp` | `dPEB:T:c:x:y:X:Y:` | CLI, SRV, CTL |
| `new-session` | `new` | `AdPc:e:F:f:n:s:t:x:y:` | CLI, SRV, CFG |
| `new-window` | `neww` | `dPEc:e:F:n:T:t:` | CLI, SRV, CFG, CTL |
| `next-layout` | `nextl` (not at the CLI) | none | CLI, SRV, CFG, CTL |
| `next-window` | `next` | none | CLI, SRV, CFG, CTL |
| `paste-buffer` | `pasteb` | `dpb:t:` | CLI, SRV, CFG |
| `pipe-pane` | `pipep` | `IOot:` | CLI, SRV, CFG |
| `previous-layout` | `prevl` (not at the CLI) | none | CLI, SRV, CFG |
| `previous-window` | `prev` | none | CLI, SRV, CFG, CTL |
| `refresh-client` | `refresh` | `SlC:t:` at the CLI, plus `A:B:f:` in control mode | CLI, SRV, CFG, CTL |
| `rename-session` | `rename` | none, takes the new name as a positional argument | CLI, SRV, CFG, CTL |
| `rename-window` | `renamew` | none, takes the new name as a positional argument | CLI, SRV, CFG, CTL |
| `resize-pane` | `resizep` | `UDLRZx:y:t:` | CLI, SRV, CFG, CTL |
| `resize-window` | `resizew` | `aADLRUx:y:t:` | CLI, SRV, CFG, CTL |
| `respawn-pane` | `respawnp`, `resp` | `kc:t:` plus `-- <command>` | CLI, SRV, CFG, CTL |
| `respawn-window` | `respawnw` | none | CLI, SRV, CFG |
| `rotate-window` | `rotatew` | `UDt:` | CLI, SRV, CFG, CTL |
| `run-command` | `runcmd` | none, takes the command line as positional arguments | SRV, CTL |
| `run-shell` | `run` | `b` | CLI, SRV, CFG |
| `save-buffer` | `saveb` | `ab:` | CLI, SRV, CFG |
| `select-layout` | `selectl` | `npoEt:` plus a positional layout name | CLI, SRV, CFG, CTL |
| `select-pane` | `selectp` | `UDLRlZmMedP:T:t:` | CLI, SRV, CFG, CTL |
| `select-window` | `selectw` | `lnpt:` | CLI, SRV, CFG, CTL |
| `send-keys` | `send`, `send-key` | `lRXN:t:` | CLI, SRV, CFG, CTL |
| `send-paste` | *(none)* | `t:` plus a positional payload | CLI, SRV |
| `send-prefix` | *(none)* | none | CLI, SRV, CFG |
| `send-text` | *(none)* | none, takes the text as positional arguments | SRV |
| `server-info` | `info` | none | CLI, SRV, CFG, CTL |
| `set-buffer` | `setb` | `wb:` | CLI, SRV, CFG |
| `set-environment` | `setenv` | `grhut:` | CLI, SRV, CFG, CTL |
| `set-hook` | *(none)* | `gua` | CLI, SRV, CFG, CTL |
| `set-option` | `set` | `guaqowt:p:` | CLI, SRV, CFG, CTL |
| `set-pane-title` | *(none)* | none, takes the title as positional arguments | SRV |
| `set-window-option` | `setw` | `guaqowt:p:` | CLI, SRV, CFG, CTL |
| `show-buffer` | `showb` | `b:` | CLI, SRV, CFG, CTL |
| `show-environment` | `showenv` | `gsht:` | CLI, SRV, CFG, CTL |
| `show-hooks` | *(none)* | `g` | CLI, SRV, CFG, CTL |
| `show-messages` | `showmsgs` | none | CLI, SRV, CFG |
| `show-options` | `show` | `Aswvqt:` | CLI, SRV, CFG, CTL |
| `show-prompt-history` | `showphist` | none | SRV |
| `show-window-options` | `showw` | `Aswvqt:` | CLI, SRV, CFG, CTL |
| `source-file` | `source` | `qnv` | CLI, SRV, CFG, CTL |
| `split-window` | `splitw`, `split-pane`, `splitp` | `hvdPc:e:F:l:p:T:t:` | CLI, SRV, CFG, CTL |
| `start-server` | `start`, `warmup` | none | CLI, SRV, CFG |
| `suspend-client` | `suspendc` | none | CLI, SRV, CFG |
| `swap-pane` | `swapp` | `UDds:t:` | CLI, SRV, CFG, CTL |
| `swap-window` | `swapw` | `ds:t:` | CLI, SRV, CFG |
| `switch-client` | `switchc` | `lnprc:t:` plus `T:` on SRV | CLI, SRV, CFG |
| `toggle-sync` | *(none)* | none | SRV, CFG |
| `unbind-key` | `unbind` | `anT:t:` | CLI, SRV, CFG, CTL |
| `unlink-window` | `unlinkw` | none, acts on the active window | CLI, SRV, CFG, CTL |
| `wait-for` | `wait` | `LSU` | CLI, SRV, CFG |
| `zoom-pane` | *(none)* | none | CLI, SRV, CFG, CTL |

102 command names. `warmup`, `resp`, `a` and `at` are CLI only aliases. `nextl` and `prevl` are recognised on the server, config and control layers but not by the CLI front end, so use the full name when typing in a shell.

### Commands deliberately not listed

The server also matches a set of internal wire commands that the client sends on your behalf and that are not meant to be typed: the overlay and chooser wire (`popup-input`, `menu-select`, `customize-navigate`, `confirm-respond` and friends), the cross session pane transfer wire (`pane-forward-extract`, `pane-forward-inject` and friends), the layout drag wire (`split-sizes`, `split-resize-done`), `claim-session`, `session-info`, `client-attach`, `client-detach`, `server-access`, `window-layout`, `window-dump`, and the copy mode key wire (`copy-enter`, `copy-move`, `copy-anchor`, `copy-yank`, `rectangle-toggle`, `copy-mode-page-up`, `delete-buffer-at`, `paste-buffer-at`).

Five mouse wire commands are an exception and are genuinely usable for scripting: `mouse-down`, `mouse-drag`, `mouse-up`, `mouse-down-right` and `mouse-up-right` are accepted at the CLI as well as on the socket.

`select-window-index` appears in the default prefix bindings but is a client side pseudo command. `psmux select-window-index` fails with "unknown command" and it cannot be used from a config line, a hook or `run-shell`.

## Flag details by command

### Session commands

**new-session** (`new`)
- Boolean: `-A` (attach if the session already exists), `-d` (detached), `-P` (print the new session info)
- Value: `-s` (session name), `-n` (first window name), `-c` (start directory), `-x` (initial width), `-y` (initial height), `-e` (environment `KEY=VALUE`, repeatable), `-F` (format), `-f` (value consumed and discarded), `-t` (session group target)
- `--` ends option parsing. Everything after it is the raw command to run instead of a shell.
- Accepted but ignored, for tmux script compatibility: `-D`, `-E`, `-X`
- Not accepted: `-g`. Session groups are set with `set -g session-group <name>`, not with a `new-session` flag.
- Combined short flags are expanded, so `-As main` means `-A -s main` and `-dP` means `-d -P`.

**attach-session** (`attach`, `a`, `at`)
- Value: `-t` (target session)
- A bare positional argument is also accepted as the session name, so `psmux attach work` works.
- Not accepted: `-d`, `-D`, `-E`, `-r`, `-c`, `-f`, `-x`, `-y`

**has-session** (`has`)
- Value: `-t` (target session). A leading `=` is stripped, matching tmux exact match semantics.

**kill-session** (`kill-ses`)
- Value: `-t` (target session)
- Not accepted: `-a`, `-C`

**rename-session** (`rename`)
- No flags. The first positional argument is the new name.

**list-sessions** (`ls`)
- Value: `-F` (format, also accepted glued as `-F<format>`), `-f` (filter)
- Any other `-x` token is rejected with a usage error and a non-zero exit, so scripts see the failure.

**switch-client** (`switchc`)
- Boolean: `-l` (last), `-n` (next), `-p` (previous), `-r` (toggle read only)
- Value: `-c` (client), `-t` (target, a full `session:window.pane` target is honored)
- Server layer only: `-T` (switch the active key table)
- Not accepted: `-E`, `-F`, `-O`, `-Z`

**detach-client** (`detach`)
- Boolean: `-a` (detach all other clients), `-P` (kill the parent process)
- Value: `-t` (target client), `-s` (target session), `-E` (command that replaces the shell on detach)

**suspend-client** (`suspendc`)
- No flags. This is a no-op on Windows, which has no SIGTSTP.

**lock-server** (`lock`), **lock-session** (`locks`), **lock-client** (`lockc`)
- No flags. All three are no-ops on Windows, which has no terminal locking concept.

**kill-server**
- No flags.
- Note: bare `kill-server` stops every socket and session (the default plus all `-L` namespaces), unlike tmux which only kills the current socket. Use `-L <name> kill-server` to scope it to one namespace. See [compatibility.md](compatibility.md#kill-server-with-multiple-sockets).

**start-server** (`start`, `warmup`)
- No flags. Pre-spawns a warm server so the next `new-session` is instant.

**server-info** (`info`)
- No flags.

**list-clients** (`lsc`)
- Value: `-F` (format), honored on the server and control mode layers. The CLI front end forwards a bare `list-clients`, so `psmux list-clients -F ...` silently drops the format.

**choose-client**
- No flags. psmux has a single client model, so this returns the current client info.

**refresh-client** (`refresh`)
- Boolean: `-S` (status line only), `-l` (request the clipboard)
- Value: `-C` (client size), `-t` (target client)
- Control mode adds: `-A '%<pane>:continue'` (resume a paused pane), `-B 'name:target:format'` (add a subscription, `-B 'name:'` removes it), `-f pause-after=N` and `-f no-pause` (flow control)
- The control mode `-C` argument is comma separated (`-C 120,30`), which is the form iTerm2 sends.
- Not accepted: `-c`, `-D`, `-L`, `-R`, `-U`, `-r`, `-F`

### Window commands

**new-window** (`neww`)
- Boolean: `-d` (do not switch to the new window), `-P` (print the new window info), `-E` (empty pane, no shell)
- Value: `-n` (window name), `-c` (start directory), `-T` (pane title), `-e` (environment `KEY=VALUE`), `-F` (format, also accepted glued as `-F<format>`), `-t` (target, value consumed)
- Accepted but ignored: `-a`, `-D`, `-k`, `-S`
- Not accepted: `-b`

**kill-window** (`killw`)
- Boolean: `-a` (kill all windows but the current one)
- Value: `-t` (target window)

**unlink-window** (`unlinkw`)
- No flags. Acts on the active window.
- Not accepted: `-k`

**rename-window** (`renamew`)
- No flags. The first positional argument is the new name.

**select-window** (`selectw`)
- Boolean: `-l` (last), `-n` (next), `-p` (previous)
- Value: `-t` (target window, `session:@id` form is honored)
- Not accepted: `-T`

**next-window** (`next`), **previous-window** (`prev`), **last-window** (`last`)
- No flags.

**move-window** (`movew`)
- Boolean: `-a` (after), `-b` (before), `-r` (renumber), `-d` (do not switch), `-k` (kill the target if it exists)
- Value: `-s` (source window), `-t` (destination window). A bare numeric `-t` is treated as a window index, not a session.

**link-window** (`linkw`)
- Value: `-s` (source window index), `-t` (destination window index)
- Not accepted: `-a`, `-b`, `-d`, `-k`

**swap-window** (`swapw`)
- Boolean: `-d` (do not switch)
- Value: `-s` (source window), `-t` (destination window). A bare numeric `-t` is treated as a window index.

**rotate-window** (`rotatew`)
- Boolean: `-U` (rotate up), `-D` (rotate down)
- Value: `-t` (target window)
- Not accepted: `-Z`

**resize-window** (`resizew`)
- Boolean: `-A` (largest client), `-a` (smallest client), `-L`, `-R`, `-U`, `-D`
- Value: `-x` (width), `-y` (height), `-t` (target window)
- Positional: optional positive adjustment for `-L`, `-R`, `-U`, or `-D` (default `1`)
- The target window enters manual sizing; later client viewport changes do not overwrite it.

**find-window** (`findw`)
- The first positional argument is the search pattern. That is the only thing that has an effect.
- Accepted but ignored: `-C`, `-N`, `-T`, `-i`, `-r`, `-Z`, `-t`

**respawn-window** (`respawnw`)
- No flags. Respawns the active pane of the window.

**list-windows** (`lsw`)
- Boolean: `-a` (all sessions), `-J` (JSON output, a psmux extension)
- Value: `-F` (format), `-t` (target session)

### Pane commands

**split-window** (`splitw`, `split-pane`, `splitp`)
- Boolean: `-h` (horizontal), `-v` (vertical), `-d` (do not switch), `-P` (print the new pane info)
- Value: `-p` (percentage size), `-l` (size in cells or a percentage), `-c` (start directory), `-T` (pane title), `-F` (format), `-e` (environment `KEY=VALUE`), `-t` (target, value consumed)
- Accepted but ignored: `-b`, `-f`, `-I`, `-Z`

**new-pane** (`newp`)
A psmux extension that creates a pane floating above the tiled layout.
- Boolean: `-d` (detached), `-P` (print the new pane id), `-E` (empty, no shell)
- Value: `-B` (border style), `-T` (title), `-c` (start directory), `-x` (width), `-y` (height), `-X` (column position), `-Y` (row position)

**select-pane** (`selectp`)
- Boolean: `-U`, `-D`, `-L`, `-R` (directional), `-l` (last pane), `-Z` (keep the zoom while navigating), `-m` (mark), `-M` (unmark), `-e` (enable input), `-d` (disable input)
- Value: `-T` (set and lock the pane title), `-P` (pane style), `-t` (target pane)
- `-t` also accepts positional targets: `{top}`, `{bottom}`, `{left}`, `{right}`, `{top-left}`, `{top-right}`, `{bottom-left}`, `{bottom-right}`
- Not accepted: `-g`

**last-pane** (`lastp`)
- No flags.

**kill-pane** (`killp`)
- Value: `-t` (target pane, via the global `-t` handler)
- Not accepted: `-a`

**resize-pane** (`resizep`)
- Boolean: `-U`, `-D`, `-L`, `-R` (directional), `-Z` (toggle zoom)
- Value: `-x` (absolute width in cells), `-y` (absolute height in cells), `-t` (target pane)
- Not accepted: `-M`, `-T`

**zoom-pane**
- No flags. A psmux extension with no tmux equivalent. `resize-pane -Z` does the same thing.

**swap-pane** (`swapp`)
- Boolean: `-U` (swap up), `-D` (swap down), `-d` (do not move the active pane)
- Value: `-s` (source pane), `-t` (destination pane)
- Not accepted: `-Z`

**join-pane** (`joinp`) and **move-pane** (`movep`)
- Boolean: `-h` (horizontal), `-v` (vertical, the default), `-d` (do not switch)
- Value: `-s` (source pane), `-t` (destination pane)
- A `-s <other-session>:...` source moves a live pane between independent servers.
- Not accepted: `-b`, `-f`, `-p`, `-l`

**break-pane** (`breakp`)
- Boolean: `-d` (do not switch to the new window)
- Value: `-t` (target)
- Not accepted: `-a`, `-b`, `-P`, `-F`, `-n`, `-s`

**respawn-pane** (`respawnp`, `resp`)
- Boolean: `-k` (kill the existing process first)
- Value: `-c` (start directory), `-t` (target pane)
- `-- <command>` is honored and replaces the pane command.
- Not accepted: `-e`

**capture-pane** (`capturep`)
- Boolean: `-p` (print to stdout), `-e` (include escape sequences), `-J` (join wrapped lines)
- Value: `-S` (start line), `-E` (end line), `-b` (buffer name), `-t` (target pane)
- Not accepted: `-a`, `-C`, `-M`, `-N`, `-P`, `-q`, `-T`

**clear-history** (`clearhist`)
- Boolean: `-H` (also clear the alternate screen)
- Value: `-t` (target pane)

**list-panes** (`lsp`)
- Boolean: `-a` (all sessions), `-s` (session scope)
- Value: `-F` (format), `-t` (target)

**display-panes** (`displayp`)
- No flags. Shows the pane number overlay, then a digit key selects a pane.

**pipe-pane** (`pipep`)
- Boolean: `-I` (pipe input), `-O` (pipe output), `-o` (toggle)
- Value: `-t` (target pane)

**set-pane-title**
- No flags. A psmux extension. The positional arguments are joined into the title.

**toggle-sync**
- No flags. A psmux extension that toggles `synchronize-panes` for the active window.

### Layout commands

**select-layout** (`selectl`)
- Boolean: `-n` (next layout), `-p` (previous layout)
- Value: `-t` (target, value consumed)
- Accepted but ignored: `-o`, `-E`
- The first positional argument is a layout name: `even-horizontal` (alias `even-h`), `even-vertical`, `main-horizontal` (alias `main-h`), `main-vertical` (alias `main-v`), `tiled`.

**next-layout**, **previous-layout**
- No flags. `nextl` and `prevl` work on the server, config and control layers but not at the CLI.

### Copy and paste commands

**copy-mode**
- Boolean: `-u` (scroll up one page on entry), `-d` (scroll down), `-e` (exit at the bottom), `-H` (hide the position indicator), `-q` (quit copy mode)
- Value: `-t` (target pane)
- Not accepted: `-M`, `-S`, `-s`
- In control mode `copy-mode` is a success returning no-op, because iTerm2 implements copy mode locally on captured content.

**paste-buffer** (`pasteb`)
- Boolean: `-d` (delete the buffer after pasting), `-p` (use bracketed paste)
- Value: `-b` (buffer name), `-t` (target pane)
- Not accepted: `-r`, `-s`
- When the buffer stack is empty, psmux falls back to the Windows clipboard.

**set-buffer** (`setb`)
- Boolean: `-w` (also write to the Windows clipboard)
- Value: `-b` (buffer name)
- Not accepted: `-a`, `-n`, `-t`

**delete-buffer** (`deleteb`) and **show-buffer** (`showb`)
- Value: `-b` (buffer name)

**save-buffer** (`saveb`)
- Boolean: `-a` (append)
- Value: `-b` (buffer name). The first positional argument is the path.

**load-buffer** (`loadb`)
- Boolean: `-w` (propagate to the clipboard)
- Value: `-b` (buffer name). The first positional argument is the path.

**list-buffers** (`lsb`)
- Value: `-F` (format), `-t` (value consumed and discarded)

**choose-buffer** (`chooseb`)
- No flags. Opens the interactive buffer chooser.

### Key binding commands

**bind-key** (`bind`)
- Boolean: `-n` (shorthand for `-T root`), `-r` (repeatable)
- Value: `-T` (key table)
- Not accepted: `-N` (note)

**unbind-key** (`unbind`)
- Boolean: `-a` (unbind everything, also matched inside a combined token), `-n` (root table)
- Value: `-T` (key table), `-t` (target, value consumed)
- Not accepted: `-q`

**list-keys** (`lsk`)
- Value: `-T` (key table), `-t` (value consumed and discarded)
- Not accepted: `-1`, `-a`, `-N`, `-P`

**send-keys** (`send`, `send-key`)
- Boolean: `-l` (literal), `-R` (reset the terminal state), `-X` (run a copy mode command)
- Value: `-N` (repeat count, value consumed), `-t` (target pane)
- Not accepted: `-c`, `-F`, `-H`, `-K`, `-M`
- Named key tokens accepted as arguments: `ENTER`, `TAB`, `BTAB` / `BACKTAB`, `ESCAPE` / `ESC`, `SPACE`, `BSPACE` / `BACKSPACE`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `HOME`, `END`, `PAGEUP` / `PPAGE`, `PAGEDOWN` / `NPAGE`, `DELETE` / `DC`, `INSERT` / `IC`

**send-prefix**
- No flags.
- Not accepted: `-2`, `-t`

**send-text**, **send-paste**
- psmux extensions. `send-text` takes the raw text as positional arguments and does no key name parsing. `send-paste` wraps the payload in a bracketed paste sequence and also accepts `-t` at the CLI.

### Configuration commands

**set-option** (`set`) and **set-window-option** (`setw`)
- Boolean: `-g` (global, accepted, psmux has one scope so this is effectively a selector no-op), `-u` (unset), `-U` (unset alias of `-u`, tmux parity, #553), `-a` (append to the current value), `-q` (quiet), `-o` (only set if currently unset), `-w` (window scope, does **not** consume the next argument)
- Value: `-t` (target, value consumed), `-p` (pane, value consumed)
- Flags are also matched inside combined tokens such as `-ga`, `-gu` and `-gq`.
- A `@name` argument is never treated as a flag.
- Not accepted: `-F`, `-s` — and since #553 any flag outside the accepted set is rejected with `unknown flag -X` at exit 1 instead of being silently dropped while the write lands.

**show-options** (`show`) and **show-window-options** (`showw`)
- Boolean: `-A` (include inherited), `-s` (server scope), `-w` (window scope), `-v` (value only), `-q` (quiet)
- Value: `-t` (window selector)
- Combined tokens are handled the same way as for `set-option`.
- Not accepted: `-g` as a distinct behavior (it is absorbed but tolerated), `-H`, `-p` — since #553 flags outside `-A -g -q -s -v -w` (plus `-t <target>`) are rejected with `unknown flag -X` at exit 1.

**set-hook** and **show-hooks**
- Boolean: `-u` (unset, also as `-gu` or `-ug`), `-a` (append, also as `-ga` or `-ag`), `-g` (global, accepted and absorbed)
- Not accepted: `-p`, `-R`, `-w`, `-t`
- `set-hook` accepts **any** hook name with no validation, so a typo silently never fires.

**set-environment** (`setenv`)
- Boolean: `-g` (global), `-r` (remove from the environment), `-u` (unset), `-h` (hidden)
- Value: `-t` (target session)
- Not accepted: `-F`

**show-environment** (`showenv`)
- Boolean: `-g` (global), `-s` (shell format), `-h` (hidden)
- Value: `-t` (target session)

**source-file** (`source`)
- Boolean: `-q` (quiet), `-n` (parse only, do not execute), `-v` (verbose)
- Not accepted: `-F`, `-t`

**list-commands** (`lscm`)
- No flags.
- Not accepted: `-F`

### Display and overlay commands

**display-message** (`display`)
- Boolean: `-p` (print to stdout), `-F` (format mode)
- Value: `-d` (display duration in ms), `-I` (value consumed), `-t` (target)
- `--` ends option parsing.
- Not accepted: `-a`, `-C`, `-c`, `-l`, `-N`, `-v`

**display-menu** (`menu`)
- Value: `-x` (column), `-y` (row), `-T` (title)
- Menu items follow as `<label> <key> <command>` triples.

**display-popup** (`popup`)
- Boolean: `-E` (close when the command exits, which is already the default), `-K` (keep the popup open after the command exits)
- Value: `-w` (width, cells or a percentage), `-h` (height), `-d` or `-c` (start directory)

**confirm-before** (`confirm`)
- Value: `-p` (prompt text)
- Everything that is not the prompt and does not begin with `-` becomes the command to confirm.
- Not accepted: `-b`, `-c`, `-y`, `-t`

**command-prompt**
- Boolean: `-N` (numeric input only), `-W` (word input only)
- Value: `-I` (initial value), `-p` (prompt list), `-T` (prompt type), `-t` (target)
- Not accepted: `-1`, `-b`, `-e`, `-F`, `-i`, `-k`, `-l`

**choose-tree**, **choose-window**, **choose-session**, **choose-client**, **choose-buffer**, **customize-mode**, **clock-mode**
- No flags. These open client side overlays. While an overlay is open its keys are handled before any key table, so a bound key does not reach the tables until the overlay closes.

**show-messages** (`showmsgs`)
- No flags.

**clear-prompt-history** (`clearphist`) and **show-prompt-history** (`showphist`)
- No flags. Server layer only, so reach them from a key binding or a raw socket connection rather than from `psmux <command>`.

### Shell and flow control commands

**run-shell** (`run`)
- Boolean: `-b` (background)
- Everything else, including tokens that look like flags, is treated as part of the shell command. `-C`, `-d`, `-s`, `-c` and `-t` are **not** parsed, so passing them sends them straight to the shell.

**if-shell** (`if`)
- Boolean: `-b` (background), `-F` (evaluate the condition as a format string instead of running a shell)
- Value: `-t` (value consumed and discarded)
- Positional arguments: the condition, the command to run when it succeeds, and optionally the command to run when it fails.
- The config file parser also accepts the glued combined forms `-bF` and `-Fb`.

**wait-for** (`wait`)
- Boolean: `-L` (lock), `-S` (signal), `-U` (unlock)
- The first positional argument is the channel name.

**run-command** (`runcmd`)
- No flags. Runs the given command line through the config file command layer and returns its output, with a 15 second timeout. Available on the server and control mode layers.

**dump-state** (`dump`), **dump-layout**, **list-tree**
- No flags. `dump-state` returns the whole live server state as JSON and is available at the CLI and in control mode. `dump-layout` and `list-tree` are server layer only.

## Global flags, before the command name

These are parsed before psmux looks at the command name.

| Flag | Meaning |
|---|---|
| `-L <name>` | Socket namespace. Sessions in a namespace are stored as `<name>__<session>`. |
| `-f <file>` | Config file to load, exported as `PSMUX_CONFIG_FILE`. |
| `-C` | Control mode with command echo. |
| `-CC` | Control mode without command echo. |
| `-t <target>` | Target `session`, `session:window` or `session:window.pane` for the command that follows. |
| `-S <path>` | Socket path, accepted and its value consumed. |
| `-h`, `--help` | Usage. |
| `-V`, `-v`, `--version` | Version. |

Glued short flags of the form `-x=VALUE` are normalized to `-x VALUE` before parsing.

## User defined command aliases

`set -g command-alias '<alias>=<expansion>'` defines your own command names. There is one asymmetry worth knowing: aliases resolve from key bindings and config lines, and are consulted by the config file unknown command warning, but the **CLI front end does not resolve them**. `psmux <alias>` fails with "unknown command" while the same alias in a key binding or a config line works.
