# Contributing to aiterm-mcp

Thanks for your interest. aiterm-mcp is a small, focused project: a stdio MCP server that gives an AI **one** persistent local terminal, backed by tmux on POSIX and psmux on native Windows. Keeping it small is a feature — please read this before opening a PR.

## Prerequisites

- **Node.js >= 18** (`engines.node` in `package.json`).
- **tmux or psmux** — a runtime prerequisite, not bundled. The test suite needs the platform's multiplexer too.
  - **macOS**: stock macOS ships no tmux. Install it with `brew install tmux`. If you run aiterm from a **GUI-launched** MCP client, Homebrew's bin (`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel) may be off `PATH`; `resolveTmux()` in `src/tmux-runtime.ts` auto-searches those, or set **`AITERM_TMUX=/path/to/tmux`** to point at it explicitly.
  - **Linux / WSL2**: `sudo apt install tmux`.
  - **Native Windows**: install [psmux](https://github.com/psmux/psmux) **3.3.8 or newer** (`winget install marlocarlo.psmux`) and [Git for Windows](https://gitforwindows.org/). Verify with `psmux -V`. Aiterm runs psmux and Git Bash natively; WSL is not used. Override discovery with `AITERM_PSMUX` / `AITERM_BASH` when needed. The factory CI exercises the full suite independently on native Windows and WSL2.
- **Throughline >= 0.9.0** is optional and needed only when testing a launcher with `throughline_source_session`. Ordinary clean launches and all PTY tools do not depend on Throughline.

## Local development

```bash
git clone https://github.com/kitepon/aiterm-mcp.git
cd aiterm-mcp
npm install
npm run build      # tsc → dist/
npm test           # builds, then runs the node:test suite (requires tmux or psmux)
npm link           # put the `aiterm-mcp` command on PATH locally, pointing at your build
```

`npm test` runs `npm run build` first, then the release-commit gate and `test/*.test.mjs`, so you don't need a separate build step before testing. After `npm link`, you can register your local build with any MCP client over stdio, e.g.:

```bash
claude mcp add --scope user --transport stdio aiterm -- aiterm-mcp
```

## Where the code lives

| File | Responsibility |
| --- | --- |
| `src/index.ts` | stdioの18 tools: PTY 7、`agent_launch`、旧launcher 4、`agent_configure`、`agent_steer`、`agent_approval`、`claude_turn`、`claude_approval`、`diagnostics`。 |
| `src/setup.ts` / `src/setup-cli.ts` | 一括導入の順序、公開JSON、終了コード。 |
| `src/setup-platform.ts` / `src/setup-integrations.ts` | OS別の公式依存導入とAI別のMCP登録・確認。 |
| `src/core.ts` | Harness-neutral orchestration: PTY operations, output reduction, completion dispatch, the destructive-command tripwire, correlation and approval relay, selected `env_vars`, optional Throughline context acquisition, and session-name validation. |
| `src/harnesses/{claude,codex,grok,cursor}.ts` | Harness-owned launch arguments, readiness, completion/transcript attribution, model configuration, and auth/catalog preflight. Composer is a Grok CLI model preset, not a separate harness. |
| `src/tmux-runtime.ts` / `src/agent-resolver.ts` | All tmux/psmux and OS-specific executable-resolution behavior. Harness adapters must not grow their own platform branches. |
| `src/agent-shared.ts` | Harness-neutral state, metadata, completion-event, and lineage types/primitives. |
| `src/runtime-error-store.ts` | Product-owned offline aggregate store and its bounded bakery queue. Queue deadlines measure one head owner's lack of progress; do not reintroduce total-wait timeouts or per-poll external process-identity commands. |
| `src/rtk.ts` | Per-command output reducers (`git status`/`git log`/`grep`/`pytest` and more) — a self-contained reimplementation, no `rtk` binary required. |
| `prototype/python/` | The original Python MVP. It is the **porting source / verification baseline** — reference only, the shipped artifact is the Node version. |

**The pytest reducer is held byte-exact against upstream rtk 0.42.0.** `src/rtk.ts`'s pytest path is pinned to rtk 0.42.0's output by golden-fixture regression tests (`test/fixtures/pytest/*`, asserted in `test/rtk.test.mjs`). One deliberate divergence is locked in: the `FAILED` summary lines (emitted under `-ra`/`-rf`) **preserve the full failure reason**, whereas rtk 0.42.0 truncates at the first `" - "` — a readability choice, covered by the `proj_ra` fixture. If you touch the pytest reducer, expect to update those goldens, and don't "fix" the intentional `FAILED`-line divergence without discussion.

The current design source of truth is `docs/DESIGN.md` — read it before changing reduction, completion detection, or safety behavior. The old draft lives under `docs/archive/` and is history only.

## Tests

Tests live in `test/` and use the built-in `node:test` runner (`node --test test/*.test.mjs`). Run the whole suite with `npm test`. Development and diagnosis happen against focused tests locally; run the full suite once only after the relevant targets are green. Factory CI then starts the same `npm test` concurrently on self-hosted macOS native, Linux native, Windows native, and WSL2 runners. No OS receives a reduced substitute suite.

The integration tests that touch the real multiplexer **isolate themselves** so they never pollute your live tmux socket or psmux namespace:

- They point `TMPDIR` at a fresh `fs.mkdtempSync(...)` directory **before** importing `dist/core.js`, so the socket and `.log`/`.offset`/`.lastcmd` files land under that temp dir.
- They drive their own dedicated socket and clean up with `core.killAll()` in an `after()` hook.

Follow the same pattern when adding multiplexer-touching tests — set `TMPDIR` first, import core after, and tear down. Tests that don't need a multiplexer (e.g. `core-pure.test.mjs`, `core-readoutput.test.mjs`, `rtk.test.mjs`, `smoke.test.mjs`) should remain independent of it. Reducer changes belong in `test/rtk.test.mjs` against fixtures, not against live command output.

Tests skip gracefully when the platform multiplexer is absent (`tmux -V` on POSIX, `psmux -V` on native Windows), but a PR is only meaningfully tested with the required multiplexer installed.

## Coding conventions

- **TypeScript, ESM** (`"type": "module"`). Use Node built-ins (`node:child_process`, `node:fs`, etc.) and the existing two runtime deps (`@modelcontextprotocol/sdk`, `zod`). Don't add dependencies without a strong reason — leanness is the point.
- **Never pollute stdout.** stdout is the JSON-RPC channel and nothing else. All diagnostics, notes, and warnings go to **stderr** (e.g. the `resolveTmux()` discovery note). A regression test (`smoke.test.mjs`) asserts every stdout line is JSON-RPC — a stray `console.log` will break it.
- **No silent fallbacks.** When something can't be done, surface a clear error (the macOS work replaced an empty-stderr failure with an explicit "install tmux with brew" diagnostic). Don't paper over failures.
- **Comments stay bilingual.** The codebase uses Japanese explanatory comments alongside the code (see `src/core.ts`). Match that style — explain the *why* and the non-obvious tradeoffs, in the same voice as the surrounding comments.
- **PTYの公開面を小さく保つ。** 現行は18 tools。SSH、container、REPLは`pty_send`から入れ子で操作し、専用toolを増やさない。
- **Keep harness and model separate.** Harness-specific behavior belongs in `src/harnesses/`; OS differences belong in `src/tmux-runtime.ts` or `src/agent-resolver.ts`. A Cursor-selected GPT, Claude, or Grok model still uses Cursor completion and transcript semantics.
- **Keep portable context behind Throughline's CLI boundary.** Do not read `~/.throughline/throughline.db` from aiterm. Canonical `agent_launch` and its compatibility aliases share the same optional `throughline_source_session` path, and an external command failure must occur before PTY creation without falling back to a context-free launch.
- **Keep `env_vars` narrow.** It accepts variable names only and reads present values from the current MCP process at launch. Do not turn it into an arbitrary name/value map, a whole-environment snapshot, or a tmux-server mutation. Values enter the PTY launch command and `.lastcmd`, so tests and docs must not describe it as secret transport.

## Pull requests

1. Branch from `main`.
2. Make sure `npm test` passes locally **with tmux installed**.
3. Open a PR against `main`. CI (`.github/workflows/ci.yml`) must pass the same full `npm test` on all four self-hosted factory environments: **macOS native, Linux native, Windows native, and WSL2**.
4. Keep the change scoped. If you're changing design behavior (completion detection, reduction, safety), update `docs/DESIGN.md` to match.

For Codex readiness changes, test both startup screens (with the `OpenAI Codex` header) and
long-lived screens where only the model/effort footer remains, including Codex v0.147's optional
`fast` token after the effort. A prompt alone or a footer alone
must not identify a ready Codex TUI, and a busy indicator must still make the session non-idle.

For runtime error store queue changes, preserve dead-owner/PID-reuse cleanup and the deterministic
progressing-queue regression. A healthy predecessor advancing the queue must renew the stall budget;
the timeout must not become a fixed cap on total backlog wait.

Publishing to npm (`npm publish --provenance --access public`) is automated on `v*` tags only after all four factory environments pass and the tagged commit is verified as an ancestor of `origin/main`. The npm OIDC Trusted Publisher is `kitepon/aiterm-mcp` + `.github/workflows/ci.yml`; contributors don't publish.

## Reporting bugs / requesting features

Open an issue: <https://github.com/kitepon/aiterm-mcp/issues>.

For bugs, please include your OS, `node -v`, `tmux -V` on POSIX or `psmux -V` on native Windows, how you launched aiterm (client, GUI vs terminal), and the exact tool call and reduced output. For the "known constraints" listed in the README (e.g. quiescence not firing while nested, `is_complete=False` on long commands, the safety gate being a tripwire not a sandbox), those are **by design** — check that section before filing.

## License

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
