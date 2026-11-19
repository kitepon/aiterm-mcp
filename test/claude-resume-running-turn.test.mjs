import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { core, readAgentMeta, skipAgentDone } from "./core-agent-support.mjs";
import { agentFixtureShellCommand } from "./agent-fixture-shell.mjs";

const { resolveClaudeConfigurationRoot } = await import("../dist/claude-config-root.js");
const { readAgentResumeAttempt } = await import("../dist/agent-lifecycle.js");
const { writeAgentMetadata } = await import("../dist/agent-shared.js");
const { loadAgentMetadata } = await import("../dist/agent-metadata-reader.js");

// a469e: a resumed Claude whose SessionStart hook already started a turn never shows an idle composer. The resume that worked
// must not be reported failed (BugHub d23c7c27), and the turn must not be interrupted or fed the body.
const skip = skipAgentDone ?? (process.platform === "win32" ? "POSIX fake CLI" : false);
// a469f: a recipe with fast takes the same path; /fast is never typed into the running turn, the result says fast was not restored.
const initialize = JSON.stringify({ type: "control_response", response: { request_id: "RID", subtype: "success", response: {
  models: [{ value: "fixture", resolvedModel: "fixture", displayName: "Fixture", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsFastMode: true }],
  fast_mode_state: "off" } } });

for (const fast of [false, true]) test(`resume-only launch accepts a Claude that is already working after the resume (fast recipe: ${fast})`, { skip, timeout: 60000 }, async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { SOCK, resolveTmux } = await import("../dist/tmux-runtime.js");
  const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR, "claude-resume-running-")));
  const keys = path.join(base, "typed");
  const bin = path.join(base, "resume-claude.sh");
  fs.writeFileSync(bin, ["#!/bin/sh",
    "if [ \"$1\" = auth ]; then printf '{\"loggedIn\":true}\\n'; exit 0; fi",
    // The fast support check asks the model list over stream-json.
    `case "$*" in *stream-json*) read line; id=\$(printf '%s' "\$line" | sed 's/.*"request_id":"\\([^"]*\\)".*/\\1/'); printf '%s\\n' '${initialize}' | sed "s/RID/\$id/"; exit 0;; esac`,
    // The resumed process draws a running turn at once; a fresh one draws the idle composer.
    "case \"$*\" in *--resume*) printf 'Claude Code\\n\\n✻ Working… (esc to interrupt)\\n';; *) printf 'Claude Code\\n\\n────────────\\n❯ \\n────────────\\n';; esac",
    // Keeps the declared fake harness alive, as the other Claude fixtures do.
    agentFixtureShellCommand, ":", ""].join("\n"), { mode: 0o700 });
  const saved = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  t.after(() => { if (saved === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = saved; fs.rmSync(base, { recursive: true, force: true }); });
  const name = `claude_resume_running_${fast}`;
  core.openAgent("claude", { session_name: name, agent_done: true, cwd: base, model: "fixture", reasoning_effort: "high",
    claude_root: resolveClaudeConfigurationRoot(path.join(process.env.HOME, ".claude")) });
  try {
    const first = readAgentMeta(name);
    for (const until = Date.now() + 10000; Date.now() < until && core.observeSession(name).state !== "idle";) await new Promise(r => setTimeout(r, 50));
    assert.equal(core.observeSession(name).state, "idle");
    if (fast) writeAgentMetadata({ ...loadAgentMetadata(name), fast: true });
    assert.equal(spawnSync(resolveTmux(), ["-S", SOCK, "kill-session", "-t", name]).status, 0);
    const result = await core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, ready_timeout: 5000 });
    const next = loadAgentMetadata(name);
    assert.notEqual(next.launch_id, first.launch_id);
    assert.equal(next.vendor_session_id, first.vendor_session_id);
    assert.equal(readAgentResumeAttempt(first)?.state, "ready", "the resume that worked is not recorded failed");
    assert.deepEqual(result.at(-2), { status: "ready", reason: "turn_running" });
    assert.equal(result[2], null, "no body was sent");
    assert.equal(result.at(-1).fast, false);
    assert.equal(result.at(-1).fast_error?.code ?? null, fast ? "FAST_MODE_UNCONFIRMED" : null);
    assert.equal(fs.existsSync(keys), false);
  } finally { core.closeSession(name); }
});
