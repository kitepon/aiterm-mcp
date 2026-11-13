import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { test } from "node:test";

// ADR 0141: own work = the subtree of the harness's own exec shell. Command lines are verbatim captures from real CLIs
// (ps args = argv joined by spaces); only the model's command inside them was chosen by the census.
const core = await import("../dist/core.js");

const at = second => new Date(Date.UTC(2026, 10, 13, 5, 0, second)).toISOString();
const row = (pid, parent_pid, second, command) => ({ pid, parent_pid, started_identity: at(second), command, cpu_seconds: 0 });
const LAUNCH = "0123456789abcdef0123456789abcdef";
const count = (kind, agent, rows) => core.ownExecProcesses({ kind, launch_id: LAUNCH }, agent, [agent, ...rows]).map(r => r.pid).sort((a, b) => a - b);

const MCP = [
  "/usr/local/bin/mcp-lazy /usr/local/bin/node /home/bell/.approval-box/runtime/0.1.32/cli.mjs mcp",
  "/usr/local/bin/node --disable-warning=ExperimentalWarning /srv/bellteam/shared/tools/caveat/0.21.18/node_modules/caveat-cli/dist/caveat.js mcp-server",
];
// Servers and hooks the harness starts itself, each with a long-lived child: never own work, however long they run.
const machinery = (agentPid, hooks) => [...MCP, ...hooks].flatMap((command, at) => [
  row(100 + at, agentPid, 2, command), row(200 + at, 100 + at, 3, "/usr/local/bin/node /home/bell/.approval-box/runtime/0.1.32/approval-box-claude-hook.mjs"),
]);

test("Claude (Linux): Bash and run_in_background shells write claude-<hex>-cwd; hooks are plain sh -c", () => {
  const claude = row(10, 5, 1, "/usr/local/bin/claude --dangerously-skip-permissions --setting-sources user,project,local --session-id e5c98b7f-253a-4f38-85ce-f01a8055e455");
  const bash = "/bin/bash -c source /home/bell/.claude/shell-snapshots/snapshot-bash-1794547229846-vz3rlk.sh 2>/dev/null || true && \\builtin shopt -u extglob 2>/dev/null || true && { \\builtin unalias -- 'which'; \\builtin unset -f -- 'which'; } >/dev/null 2>&1 || true && eval 'sleep 45; echo bg-marker-a47' < /dev/null && pwd -P >| /tmp/claude-5ac6-cwd";
  const rows = [...machinery(10, ["/bin/sh -c /usr/local/bin/node /home/bell/.approval-box/runtime/0.1.32/approval-box-claude-hook.mjs"]),
    row(30, 10, 9, bash), row(31, 30, 9, "sleep 45")];
  assert.deepEqual(count("claude", claude, rows), [30, 31]);
  assert.deepEqual(count("claude", claude, rows.slice(0, -2)), [], "an idle seat with a waiting hook reads 0");
  // macOS keep-awake helper: a direct child, not a shell.
  assert.deepEqual(count("claude", claude, [row(40, 10, 4, "caffeinate -i -t 300")]), []);
});

test("Codex (Linux): [shell, -c, command] under the native binary or its code-mode host; hooks and servers are direct argv", () => {
  const shim = row(10, 5, 1, `/usr/local/bin/node /usr/local/bin/codex -c aiterm_launch_id="${LAUNCH}"`);
  const native = row(11, 10, 1, `/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex -c aiterm_launch_id="${LAUNCH}"`);
  const hooks = ["/usr/local/bin/node /usr/local/lib/node_modules/throughline/bin/throughline.mjs codex-hook stop",
    "node /srv/bellteam/shared/tools/testgate/current/bin/testgate.mjs hook codex"];
  const rows = [native, ...machinery(11, hooks), row(30, 11, 9, "/bin/bash -c sleep 25 ; echo marker-a47"), row(31, 30, 9, "sleep 25")];
  assert.deepEqual(count("codex", shim, rows), [30, 31]);
  // A hook naming codex is not walked into: a shell below it is the hook's, not the harness's.
  assert.deepEqual(count("codex", shim, [native, row(50, 11, 4, hooks[1]), row(51, 50, 4, "/bin/sh -c git status")]), []);
  const host = row(60, 11, 3, "/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host");
  assert.deepEqual(count("codex", shim, [native, host]), [], "the tool host alone is not work");
  assert.deepEqual(count("codex", shim, [native, host, row(61, 60, 9, "/usr/bin/python3 job.py")]), [61]);
  // The Linux sandbox sits between the binary and the shell.
  assert.deepEqual(count("codex", shim, [native, row(70, 11, 9, "/usr/local/bin/codex-linux-sandbox --sandbox-policy-cwd /w -- /bin/bash -lc make"),
    row(71, 70, 9, "/bin/bash -lc make"), row(72, 71, 9, "make")]), [71, 72]);
});

test("Codex: a lone command its -c shell replaced itself with is a session leader under Codex; servers and hooks are not (a56)", () => {
  // macOS 0.168.0 standalone, 2026-11-13: `sleep 300` stat Ss, no tty, parent the native binary; MCP servers stat S on the seat's tty.
  const codex = row(10, 5, 1, `/Users/kite/.local/bin/codex -c aiterm_launch_id="${LAUNCH}"`);
  const host = row(20, 10, 2, "/Users/kite/.codex/packages/standalone/releases/0.168.0-aarch64-apple-darwin/bin/codex-code-mode-host");
  const rows = [...machinery(10, []), host, { ...row(30, 10, 9, "sleep 300"), session_leader: true }];
  assert.deepEqual(count("codex", codex, rows), [30]);
  assert.deepEqual(count("codex", codex, rows.slice(0, -1)), [], "servers, hooks and the code-mode host alone read 0");
  assert.deepEqual(count("claude", row(10, 5, 1, "/usr/local/bin/claude"), rows), [], "only Codex starts its execs this way");
});

test("Grok (Linux): the __grok_user_cmd wrapper is exec; hooks are sh -c", () => {
  const grok = row(10, 5, 1, "grok --always-approve");
  const exec = "/bin/bash -O extglob -c IFS= builtin read -r -d '' __grok_user_cmd <&5; exec 5<&-; builtin set -- \"$__grok_user_cmd\" \"$@\"; builtin unset __grok_user_cmd; snap=$(command cat <&3); builtin shopt -s extglob 2>/dev/null; builtin shopt -s expand_aliases 2>/dev/null";
  const rows = [...machinery(10, ["sh -c /usr/local/bin/node /usr/local/lib/node_modules/throughline/bin/throughline.mjs process-turn",
    "sh -c node /srv/bellteam/shared/tools/testgate/current/bin/testgate.mjs hook grok"]), row(30, 10, 9, exec), row(31, 30, 9, "sleep 15")];
  assert.deepEqual(count("grok", grok, rows), [30, 31]);
});

test("Cursor (Linux): the __cursor_command wrapper with stdin from /dev/null is exec; the same wrapper for hooks is not", () => {
  const cursor = row(10, 5, 1, "/home/bell/.local/bin/cursor-agent --use-system-ca /home/bell/.local/share/cursor-agent/versions/2026.11.11-b912975/index.js --force");
  const wrapper = stdin => "/bin/bash -O extglob -c IFS= builtin read -r -d '' __cursor_command <&5 2>/dev/null || { builtin printf '%s\\n' 'The command did not run: a shell startup file ($BASH_ENV or .zshenv) closed or replaced file descriptor 5, which carries the command. Run it again; this shell now passes commands as arguments.' >&2; builtin exit 126; }; exec 5<&-; builtin set -- \"$__cursor_command\"; builtin unset __cursor_command; snap=$(command cat <&3) && builtin shopt -s extglob && builtin eval -- \"$snap\"; { builtin set +u 2>/dev/null || true; builtin eval \"${__CURSOR_SANDBOX_ENV_RESTORE:-}\" 2>/dev/null; builtin eval \"${__CURSOR_SANDBOX_TEMP_RESTORE:-}\" 2>/dev/null; builtin export NODE_DISABLE_COMPILE_CACHE=1; builtin unset NODE_COMPILE_CACHE; builtin export PWD=\"$(builtin pwd)\"; builtin shopt -s expand_aliases 2>/dev/null; builtin eval \"$1\" 3<&- 4>&-" + stdin + "; }; COMMAND_EXIT_CODE=$?; dump_bash_state >&4; builtin exit $COMMAND_EXIT_CODE --";
  const rows = [...machinery(10, []), row(40, 10, 5, wrapper("")), row(41, 40, 5, "/usr/local/bin/node /home/bell/.approval-box/runtime/0.1.32/approval-box-cursor-hook.mjs"),
    row(30, 10, 9, wrapper(" < /dev/null")), row(31, 30, 9, "sleep 15")];
  assert.deepEqual(count("cursor", cursor, rows), [30, 31]);
});

test("a shell elsewhere in the seat is not exec: below an MCP server, or a hook shell", () => {
  const claude = row(10, 5, 1, "/usr/local/bin/claude");
  const cwdShell = "/bin/bash -c eval 'make' < /dev/null && pwd -P >| /tmp/claude-1a2b-cwd";
  assert.deepEqual(count("claude", claude, [row(20, 10, 2, MCP[0]), row(21, 20, 3, cwdShell)]), [], "only shells the harness started");
  assert.deepEqual(count("claude", claude, [row(22, 10, 2, "/bin/sh -c sleep 600")]), [], "a hook shell has no cwd file");
  assert.deepEqual(count("antigravity", row(10, 5, 1, "agy"), [row(23, 10, 2, "sh -c '/usr/local/bin/node' '/usr/local/lib/node_modules/aiterm-mcp/dist/antigravity-hook.js' 'Stop'")]), []);
  // A recycled parent pid (a "parent" that started after its child) is not a parent.
  assert.deepEqual(count("claude", claude, [{ ...row(24, 10, 0, cwdShell), started_identity: at(0) }, ]), []);
});

// macOS captures (census 2026-11-13 14:5x JST, macbook): same markers as Linux, zsh instead of bash.
test("macOS: Claude zsh with the cwd file, Codex [zsh, -c, cmd], Grok zsh fd-5 wrapper; hooks and servers are direct children", () => {
  const claude = row(10, 5, 1, "/Users/kite/.local/bin/claude -p --dangerously-skip-permissions");
  const hooks = ["node /opt/homebrew/bin/throughline process-turn", "/opt/homebrew/opt/node/bin/node /Users/kite/.approval-box/runtime/0.1.32/approval-box-claude-hook.mjs"];
  assert.deepEqual(count("claude", claude, [...machinery(10, hooks),
    row(30, 10, 9, "/bin/zsh -c source /Users/kite/.claude/shell-snapshots/snapshot-zsh-1794548037338-v3p4v9.sh 2>/dev/null || true && \\builtin setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL NO_BRACE_CCL NO_MAGIC_EQUAL_SUBST 2>/dev/null || true && eval 'sleep 30 ; echo bg-CENSUSM2' < /dev/null && pwd -P >| /tmp/claude-913f-cwd"),
    row(31, 30, 9, "sleep 30")]), [30, 31]);
  const shim = row(10, 5, 1, `node /opt/homebrew/bin/codex -c aiterm_launch_id="${LAUNCH}"`);
  const native = row(11, 10, 1, `/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex -c aiterm_launch_id="${LAUNCH}"`);
  assert.deepEqual(count("codex", shim, [native, ...machinery(11, ["/Users/kite/.config/claude-spotter/bin/spotter.mjs codex-hook session-start"]),
    row(30, 11, 9, "/bin/zsh -c sleep 15 ; echo marker-CENSUSM3"), row(31, 30, 9, "sleep 15")]), [30, 31]);
  const grok = row(10, 5, 1, "/Users/kite/.local/bin/grok --always-approve");
  assert.deepEqual(count("grok", grok, [...machinery(10, ["/opt/homebrew/bin/node /Users/kite/.config/claude-spotter/bin/spotter.mjs grok-hook session_start"]),
    row(30, 10, 9, "/bin/zsh -c IFS= builtin read -r -d '' __grok_user_cmd <&5; exec 5<&-; builtin set -- \"$__grok_user_cmd\" \"$@\"; builtin unset __grok_user_cmd; snap=$(command cat <&3); builtin setopt nonomatch 2>/dev/null; __grok_user_cmd=\"$1\"; builtin typeset +x __grok_user_cmd 2>/dev/null; builtin set --; builtin eval \"$__grok_user_cmd\" 2>&1 --"),
    row(31, 30, 9, "sleep 15")]), [30, 31]);
  // Cursor's zsh wrapper (from its bundle, 2026.11.11): `builtin eval "$1"` + optional fd closes + ` < /dev/null` unless stdin is piped.
  const cursor = row(10, 5, 1, "/Users/kite/.local/bin/cursor-agent --use-system-ca /Users/kite/.local/share/cursor-agent/versions/2026.11.11-b912975/index.js");
  assert.deepEqual(count("cursor", cursor, [row(30, 10, 9, "/bin/zsh -c snap=$(command cat <&3); builtin eval \"$1\" < /dev/null; COMMAND_EXIT_CODE=$? --"),
    row(40, 10, 9, "/bin/zsh -c snap=$(command cat <&3); builtin eval \"$1\"; COMMAND_EXIT_CODE=$? --")]), [30]);
});

// Windows captures (census 2026-11-13 14:5x JST, fox): table command lines as Win32_Process gives them.
test("Windows: Codex pwsh with its UTF-8 console line, Grok pwsh without the hook tail, Cursor -NonInteractive ps-script", () => {
  const PWSH = '"c:\\program files\\powershell\\7\\pwsh.exe"';
  const shim = row(10, 5, 1, `"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\kite_\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js -c aiterm_launch_id="${LAUNCH}"`);
  const native = row(11, 10, 1, `C:\\Users\\kite_\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe -c aiterm_launch_id="${LAUNCH}"`);
  const codexHook = `${PWSH} -NoProfile -Command "& \\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\Users\\kite_\\.config\\claude-spotter\\bin\\spotter.mjs\\" codex-hook session-start"`;
  const codexExec = `${PWSH} -Command "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\nsleep 15 ; echo marker-CENSUSF2 ."`;
  assert.deepEqual(count("codex", shim, [native, row(20, 11, 3, codexHook), row(30, 11, 9, codexExec), row(31, 30, 9, "\\??\\C:\\WINDOWS\\system32\\conhost.exe 0x4")]), [30, 31]);
  // Sandboxed (workspace-write): the command runner exists only to run the model's commands.
  const runner = row(40, 11, 9, "C:\\Users\\kite_\\.codex\\.sandbox-bin\\codex-command-runner-0.167.2.exe --pipe-in=\\\\.\\pipe\\codex-runner-ab12-in --pipe-out=\\\\.\\pipe\\codex-runner-ab12-out");
  assert.deepEqual(count("codex", shim, [native, runner, row(41, 40, 9, `${PWSH} -NoProfile -Command "sleep 15"`)]), [41]);
  assert.deepEqual(count("codex", shim, [native, row(42, 11, 9, "C:\\Users\\kite_\\.codex\\.sandbox-bin\\codex-windows-sandbox-setup.exe --launch-payload-env")]), []);

  const grok = row(10, 5, 1, "C:\\Users\\kite_\\.local\\bin\\grok.exe --always-approve");
  const grokHook = '"pwsh" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& \\"C:\\\\Program Files\\\\nodejs\\\\node.exe\\" \\"C:\\\\Users\\\\kite_\\\\.config\\\\claude-spotter\\\\bin\\\\spotter.mjs\\" grok-hook session_start\n#>\nif (-not $?) { $__grokExitCode = 1 }"';
  assert.deepEqual(count("grok", grok, [row(20, 10, 3, grokHook), row(21, 20, 3, '"C:\\Program Files\\nodejs\\node.exe" spotter.mjs grok-hook session_start'),
    row(30, 10, 9, '"pwsh" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "sleep 15 ; echo marker-CENSUSF5"'), row(31, 30, 9, "sleep 15")]), [30, 31]);

  // Cursor writes each command to a ps-script; only a model's command runs -NonInteractive (hooks get stdin).
  const cursor = row(10, 5, 1, '"C:\\Users\\kite_\\AppData\\Local\\cursor-agent\\versions\\2026.11.11-b912975\\node.exe" C:\\Users\\kite_\\AppData\\Local\\cursor-agent\\versions\\2026.11.11-b912975\\index.js --force');
  const script = (flags, id) => `${PWSH} -ExecutionPolicy Bypass ${flags}-File C:\\Users\\kite_\\AppData\\Local\\Temp\\ps-script-${id}.ps1`;
  assert.deepEqual(count("cursor", cursor, [row(20, 10, 3, script("", "6f1c2d9e-0b7a-4c55-9d1e-2a3b4c5d6e7f")),
    row(21, 20, 3, '"C:\\Users\\kite_\\AppData\\Local\\cursor-agent\\versions\\2026.11.11-b912975\\node.exe" C:\\Users\\kite_\\.config\\aiterm-mcp\\cursor-parent-hook.js'),
    row(30, 10, 9, script("-NonInteractive ", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"))]), [30]);

  // Claude hooks on Windows run in Git Bash or pwsh without the cwd file.
  const claude = row(10, 5, 1, "C:\\Users\\kite_\\.local\\bin\\claude.exe");
  assert.deepEqual(count("claude", claude, [row(20, 10, 3, '"C:\\Program Files\\Git\\bin\\bash.exe" -c "throughline session-start"'),
    row(21, 10, 3, `${PWSH} -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\kite_\\.approval-box\\runtime\\0.1.32\\approval-box-claude-hook.mjs'; exit (Get-Variable LASTEXITCODE -ValueOnly)"`)]), []);
});
