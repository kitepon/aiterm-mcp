import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { core, readAgentMeta, skipAgentDone } from "./core-agent-support.mjs";

const { resolveClaudeConfigurationRoot } = await import("../dist/claude-config-root.js");
const { claudeAuthStatus, claudeFailureCategory } = await import("../dist/harnesses/claude.js");
const { readAgentResumeTemplate } = await import("../dist/agent-lifecycle.js");

// Per-seat Claude roots (BellTeam 1st/2nd accounts): only the default root or a direct child of a listed parent.
const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR, "claude-roots-")));
const home = path.join(base, "home"), parent = path.join(base, "accounts"), second = path.join(parent, "2nd");
fs.mkdirSync(path.join(home, ".claude"), { recursive: true }); fs.mkdirSync(second, { recursive: true });
const env = { HOME: home, AITERM_CLAUDE_CONFIG_ROOTS: parent };

test("configuration_root accepts the default root (unset selector) or a listed parent's direct child, nothing else", () => {
  assert.deepEqual(resolveClaudeConfigurationRoot(path.join(home, ".claude"), env), { root: path.join(home, ".claude"), selector: null });
  assert.deepEqual(resolveClaudeConfigurationRoot(second + path.sep, env), { root: second, selector: second });
  const outside = path.join(base, "elsewhere"); fs.mkdirSync(outside, { recursive: true });
  const nested = path.join(second, "deeper"); fs.mkdirSync(nested, { recursive: true });
  for (const requested of [outside, nested, parent, "relative/2nd", path.join(parent, "missing"), path.join(parent, "2nd", "..", "..", "elsewhere")])
    assert.throws(() => resolveClaudeConfigurationRoot(requested, env), /^Error: AGENT_CONFIGURATION_ROOT_REJECTED: /, requested);
  assert.throws(() => resolveClaudeConfigurationRoot(second, { HOME: home }), /AGENT_CONFIGURATION_ROOT_REJECTED/, "no listed parent");
  if (process.platform !== "win32") {
    // A link inside the listed parent that points elsewhere is judged by where it points.
    const link = path.join(parent, "link"); fs.symlinkSync(outside, link);
    assert.throws(() => resolveClaudeConfigurationRoot(link, env), /AGENT_CONFIGURATION_ROOT_REJECTED/);
  }
});

test("claude auth status returns the account e-mail as a display label only when logged in", { skip: process.platform === "win32" ? "POSIX fake CLI" : false }, () => {
  const bin = path.join(base, "status-claude.sh");
  fs.writeFileSync(bin, "#!/bin/sh\nif [ -n \"$CLAUDE_CONFIG_DIR\" ]; then printf '{\"loggedIn\":true,\"email\":\"two@example.com\"}\\n'; else printf '{\"loggedIn\":false}\\n'; exit 1; fi\n", { mode: 0o700 });
  assert.deepEqual(claudeAuthStatus(bin, base, { ...process.env, CLAUDE_CONFIG_DIR: second }),
    { status: "authenticated", verify_onboarding: true, message: null, account_label: "two@example.com" });
  const unset = { ...process.env }; delete unset.CLAUDE_CONFIG_DIR;
  assert.equal(claudeAuthStatus(bin, base, unset).status, "unauthenticated");
});

test("any 'You've hit your … limit' line is a rate limit even without HTTP 429", () => {
  const error = text => ({ text, status: null, at: null, session_id: null, uuid: null, parent_uuid: null, kind: null });
  assert.equal(claudeFailureCategory(error("You've hit your weekly limit · resets Oct 16, 8am (UTC)")), "rate_limited");
  assert.equal(claudeFailureCategory(error("You've hit your session limit · resets 3pm")), "rate_limited");
  assert.equal(claudeFailureCategory(error("You've reached your Fable limit. Run /usage-credits to continue")), "rate_limited");
  assert.equal(claudeFailureCategory(error("API Error: socket hang up")), "other");
  // The Fable limit record: no apiErrorStatus, the CLI's own error field, any text.
  assert.equal(claudeFailureCategory({ ...error("You're out of usage credits. Run /usage-credits to keep using Fable 5.1 or /model to switch models."), kind: "rate_limit" }), "rate_limited");
});

test("openAgent claude runs the seat under the selected root and keeps it in the resume template", { skip: skipAgentDone ?? (process.platform === "win32" ? "POSIX fake CLI" : false) }, async (t) => {
  const seen = path.join(base, "seen");
  const bin = path.join(base, "root-claude.sh");
  fs.writeFileSync(bin, ["#!/bin/sh",
    "if [ \"$1\" = auth ]; then printf '{\"loggedIn\":true}\\n'; exit 0; fi",
    `printf '%s\\n' "\${CLAUDE_CONFIG_DIR-UNSET}" > '${seen}'"/$AITERM_AGENT_LAUNCH_ID"`,
    "exec sleep 30", ""].join("\n"), { mode: 0o700 });
  fs.mkdirSync(seen, { recursive: true });
  const saved = { bin: process.env.CLAUDE_BIN, home: process.env.HOME, roots: process.env.AITERM_CLAUDE_CONFIG_ROOTS };
  process.env.CLAUDE_BIN = bin; process.env.AITERM_CLAUDE_CONFIG_ROOTS = parent;
  t.after(() => { for (const [key, value] of [["CLAUDE_BIN", saved.bin], ["AITERM_CLAUDE_CONFIG_ROOTS", saved.roots]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const observed = async sid => {
    const file = path.join(seen, readAgentMeta(sid).launch_id);
    for (const until = Date.now() + 5000; Date.now() < until && !fs.existsSync(file);) await new Promise(r => setTimeout(r, 50));
    return fs.readFileSync(file, "utf8").trim();
  };
  // seat-env sets CLAUDE_CONFIG_DIR for the test process, so the default root must unset it in the seat.
  const defaultRoot = path.join(process.env.HOME, ".claude");
  for (const [requested, expected, selector] of [[second, second, second], [defaultRoot, "UNSET", null]]) {
    const [sid] = core.openAgent("claude", { agent_done: true, cwd: base, model: "fixture", reasoning_effort: "high",
      claude_root: resolveClaudeConfigurationRoot(requested) });
    try {
      assert.equal(await observed(sid), expected);
      const meta = readAgentMeta(sid);
      assert.equal(meta.claude_home, selector ?? defaultRoot);
      const template = readAgentResumeTemplate(meta);
      assert.equal(template.configuration_root, selector ?? defaultRoot);
      assert.equal(template.environment.CLAUDE_CONFIG_DIR, selector);
    } finally { core.closeSession(sid); }
  }
  assert.throws(() => core.openAgent("claude", { agent_done: true, cwd: base, env_vars: ["CLAUDE_CONFIG_DIR"], claude_root: resolveClaudeConfigurationRoot(second) }),
    /AGENT_CONFIGURATION_ROOT_REJECTED/);
});

test("agent_auth status reads the selected root and refuses other harnesses", { skip: process.platform === "win32" ? "POSIX fake CLI" : false }, async (t) => {
  const bin = path.join(base, "auth-claude.sh");
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$CLAUDE_CONFIG_DIR" = '${second}' ]; then printf '{"loggedIn":true,"email":"two@example.com"}\\n'; else printf '{"loggedIn":false}\\n'; exit 1; fi\n`, { mode: 0o700 });
  const saved = { bin: process.env.CLAUDE_BIN, roots: process.env.AITERM_CLAUDE_CONFIG_ROOTS };
  process.env.CLAUDE_BIN = bin; process.env.AITERM_CLAUDE_CONFIG_ROOTS = parent;
  t.after(() => { for (const [key, value] of [["CLAUDE_BIN", saved.bin], ["AITERM_CLAUDE_CONFIG_ROOTS", saved.roots]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const two = await core.authenticateAgent("claude", { action: "status", cwd: base, configuration_root: second });
  assert.equal(two.status, "authenticated"); assert.equal(two.account_label, "two@example.com");
  const one = await core.authenticateAgent("claude", { action: "status", cwd: base, configuration_root: path.join(process.env.HOME, ".claude") });
  assert.equal(one.status, "blocked"); assert.equal("account_label" in one, false);
  await assert.rejects(core.authenticateAgent("codex", { action: "status", cwd: base, configuration_root: second }), /AGENT_CONFIGURATION_ROOT_REJECTED/);
});

test("resume-only launch moves the same Claude conversation to another root only when that root holds its transcript", { skip: skipAgentDone ?? (process.platform === "win32" ? "POSIX fake CLI" : false), timeout: 60000 }, async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { SOCK, resolveTmux } = await import("../dist/tmux-runtime.js");
  const { claudeProjectSlug } = await import("../dist/harnesses/claude.js");
  const seen = path.join(base, "seen-resume"); fs.mkdirSync(seen, { recursive: true });
  const bin = path.join(base, "resume-claude.sh");
  fs.writeFileSync(bin, ["#!/bin/sh",
    "if [ \"$1\" = auth ]; then printf '{\"loggedIn\":true}\\n'; exit 0; fi",
    `printf '%s %s\\n' "\${CLAUDE_CONFIG_DIR-UNSET}" "$*" > '${seen}'"/$AITERM_AGENT_LAUNCH_ID"`,
    "printf 'Claude Code\\n\\n────────────\\n❯ \\n────────────\\n'",
    "exec sleep 60", ""].join("\n"), { mode: 0o700 });
  const saved = { bin: process.env.CLAUDE_BIN, roots: process.env.AITERM_CLAUDE_CONFIG_ROOTS };
  process.env.CLAUDE_BIN = bin; process.env.AITERM_CLAUDE_CONFIG_ROOTS = parent;
  t.after(() => { for (const [key, value] of [["CLAUDE_BIN", saved.bin], ["AITERM_CLAUDE_CONFIG_ROOTS", saved.roots]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const observed = async launchId => {
    const file = path.join(seen, launchId);
    for (const until = Date.now() + 10000; Date.now() < until && !fs.existsSync(file);) await new Promise(r => setTimeout(r, 50));
    return fs.readFileSync(file, "utf8").trim();
  };
  const name = "claude_root_switch";
  core.openAgent("claude", { session_name: name, agent_done: true, cwd: base, model: "fixture", reasoning_effort: "high",
    claude_root: resolveClaudeConfigurationRoot(path.join(process.env.HOME, ".claude")) });
  try {
    const first = readAgentMeta(name);
    assert.match(await observed(first.launch_id), /^UNSET /);
    // The seat dies; its saved conversation is resumed under the 2nd root.
    assert.equal(spawnSync(resolveTmux(), ["-S", SOCK, "kill-session", "-t", name]).status, 0);
    await assert.rejects(core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, configuration_root: second }),
      /^Error: AGENT_RESUME_UNAVAILABLE: /);
    assert.equal(readAgentMeta(name).launch_id, first.launch_id, "no new launch without the transcript");
    const transcript = path.join(second, "projects", claudeProjectSlug(first.cwd), `${first.vendor_session_id}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true }); fs.writeFileSync(transcript, "");
    // shortcut: the fake CLI never satisfies Claude readiness, so this stops at the readiness phase after the native start;
    // the root switch is proven by the started native's own environment and argv. Upgrade with a Claude TUI fixture.
    await assert.rejects(core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, configuration_root: second, ready_timeout: 3 }),
      /^Error: AGENT_RESUME_FAILED: /);
    const { loadAgentMetadata } = await import("../dist/agent-metadata-reader.js");
    const next = loadAgentMetadata(name);
    assert.notEqual(next.launch_id, first.launch_id);
    assert.equal(next.vendor_session_id, first.vendor_session_id);
    assert.equal(next.claude_home, second);
    const line = await observed(next.launch_id);
    assert.ok(line.startsWith(`${second} `) && line.includes(`--resume ${first.vendor_session_id}`), line);
  } finally { core.closeSession(name); }
});

test("a Claude resume takes CLAUDE_CODE_OAUTH_TOKEN as the login: named or not it is no conflict, the new value reaches the seat but not the pane", { skip: skipAgentDone ?? (process.platform === "win32" ? "POSIX fake CLI" : false), timeout: 60000 }, async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { SOCK, resolveTmux } = await import("../dist/tmux-runtime.js");
  const { readAgentResumeRecipe } = await import("../dist/agent-lifecycle.js");
  const { loadAgentMetadata } = await import("../dist/agent-metadata-reader.js");
  const seen = path.join(base, "seen-login"); fs.mkdirSync(seen, { recursive: true });
  const bin = path.join(base, "login-claude.sh");
  fs.writeFileSync(bin, ["#!/bin/sh",
    `printf '%s %s %s\\n' "\${CLAUDE_CODE_OAUTH_TOKEN-UNSET}" "\${LOGIN_FIXTURE_OTHER-UNSET}" "\${FIXTURE_API_KEY-UNSET}" > '${seen}'"/$AITERM_AGENT_LAUNCH_ID"`,
    "printf 'Claude Code\\n\\n────────────\\n❯ \\n────────────\\n'",
    "exec sleep 60", ""].join("\n"), { mode: 0o700 });
  const saved = { bin: process.env.CLAUDE_BIN, token: process.env.CLAUDE_CODE_OAUTH_TOKEN, other: process.env.LOGIN_FIXTURE_OTHER, key: process.env.FIXTURE_API_KEY };
  process.env.CLAUDE_BIN = bin; process.env.LOGIN_FIXTURE_OTHER = "kept"; process.env.FIXTURE_API_KEY = "key-one"; delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  t.after(() => { for (const [key, value] of [["CLAUDE_BIN", saved.bin], ["CLAUDE_CODE_OAUTH_TOKEN", saved.token], ["LOGIN_FIXTURE_OTHER", saved.other], ["FIXTURE_API_KEY", saved.key]])
    if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const observed = async launchId => {
    const file = path.join(seen, launchId);
    for (const until = Date.now() + 10000; Date.now() < until && !fs.existsSync(file);) await new Promise(r => setTimeout(r, 50));
    return fs.readFileSync(file, "utf8").trim();
  };
  const name = "claude_login_resume";
  // The old seat's recipe lacks the login name (every hibernated 1st seat today).
  core.openAgent("claude", { session_name: name, agent_done: true, cwd: base, model: "fixture", reasoning_effort: "high", env_vars: ["LOGIN_FIXTURE_OTHER", "FIXTURE_API_KEY"] });
  try {
    const first = readAgentMeta(name);
    assert.equal(await observed(first.launch_id), "UNSET kept key-one");
    // E8: a secret-named env no longer prevents the resume template; only its name is kept.
    const { readAgentResumeTemplate } = await import("../dist/agent-lifecycle.js");
    assert.deepEqual(readAgentResumeTemplate(first).secret_environment, ["FIXTURE_API_KEY"]);
    assert.equal(readAgentResumeTemplate(first).environment.FIXTURE_API_KEY, undefined);
    const resume = async (envVars, token) => {
      assert.equal(spawnSync(resolveTmux(), ["-S", SOCK, "kill-session", "-t", name]).status, 0);
      if (token === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
      const before = loadAgentMetadata(name).launch_id;
      // shortcut: the fake CLI never satisfies Claude readiness, so the resume stops after the native start (as above).
      await assert.rejects(core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, env_vars: envVars, ready_timeout: 3 }),
        /^Error: AGENT_RESUME_FAILED: /);
      const next = loadAgentMetadata(name);
      assert.notEqual(next.launch_id, before);
      const screen = spawnSync(resolveTmux(), ["-S", SOCK, "capture-pane", "-p", "-S", "-", "-t", name], { encoding: "utf8" }).stdout;
      if (token) assert.ok(!screen.includes(token), "the login value is never typed into the pane");
      const file = (await import("../dist/agent-shared.js")).agentMetadataPath(name, next.launch_id).replace(/\.agent\.json$/, ".resume.json");
      for (const value of [token, process.env.FIXTURE_API_KEY]) if (value) assert.ok(!fs.readFileSync(file, "utf8").includes(value), "no secret value on disk");
      return { line: await observed(next.launch_id), recipe: readAgentResumeRecipe(next) };
    };
    // A secret the resuming launch does not bring: refused before any effect, the seat is not started.
    assert.equal(spawnSync(resolveTmux(), ["-S", SOCK, "kill-session", "-t", name]).status, 0);
    delete process.env.FIXTURE_API_KEY;
    await assert.rejects(core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, env_vars: ["LOGIN_FIXTURE_OTHER", "FIXTURE_API_KEY"], ready_timeout: 3 }),
      /^Error: AGENT_RESUME_SECRET_MISSING: .*FIXTURE_API_KEY/);
    assert.equal(loadAgentMetadata(name).launch_id, first.launch_id);
    process.env.FIXTURE_API_KEY = "key-two";
    spawnSync(resolveTmux(), ["-S", SOCK, "new-session", "-d", "-s", name, "sleep 60"]); // resume() kills it again
    const named = await resume(["LOGIN_FIXTURE_OTHER", "FIXTURE_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], "fixture-token-one");
    assert.equal(named.line, "fixture-token-one kept key-two", "secret values come from the resuming launch");
    assert.deepEqual(named.recipe.secret_environment, ["CLAUDE_CODE_OAUTH_TOKEN", "FIXTURE_API_KEY"]);
    assert.equal(named.recipe.environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    const renewed = await resume(["LOGIN_FIXTURE_OTHER", "FIXTURE_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], "fixture-token-two");
    assert.equal(renewed.line, "fixture-token-two kept key-two", "a re-login reaches the resumed seat");
    const dropped = await resume(["LOGIN_FIXTURE_OTHER", "FIXTURE_API_KEY"], "fixture-token-three");
    assert.equal(dropped.line, "UNSET kept key-two", "not named: the seat resumes on the root's own login");
    assert.deepEqual(dropped.recipe.secret_environment, ["FIXTURE_API_KEY"]);
    assert.equal(spawnSync(resolveTmux(), ["-S", SOCK, "kill-session", "-t", name]).status, 0);
    // Any other env difference still conflicts.
    await assert.rejects(core.openAgentWithInitialPrompt("claude", { session_name: name, require_existing_resume: true, env_vars: ["CLAUDE_CODE_OAUTH_TOKEN"], ready_timeout: 3 }),
      /^Error: AGENT_RESUME_UNAVAILABLE: /);
  } finally { core.closeSession(name); }
});

test("the listed parents stay with the serving process and never reach a seat's environment", async () => {
  const { sessionCallerEnvironment } = await import("../dist/tmux-runtime.js");
  assert.deepEqual(sessionCallerEnvironment({ AITERM_CLAUDE_CONFIG_ROOTS: parent, KEEP: "1" }), { KEEP: "1" });
});

test("claude_login reads the slot's oauth-token like the seat launcher, and a slot that is a Claude root is also the root", async () => {
  const { withClaudeSlotLogin } = await import("../dist/claude-config-root.js");
  const token = "sk-ant-oat01-" + "a".repeat(40), other = "sk-ant-oat01-" + "b".repeat(40), first = path.join(parent, "1st");
  fs.mkdirSync(first, { recursive: true });
  fs.writeFileSync(path.join(first, "oauth-token"), token + "\n");
  fs.writeFileSync(path.join(second, "oauth-token"), other);
  const one = withClaudeSlotLogin({ ...env, CLAUDE_CONFIG_DIR: "/kept" }, "1st");
  assert.equal(one.CLAUDE_CODE_OAUTH_TOKEN, token); assert.equal(one.CLAUDE_CONFIG_DIR, "/kept");
  fs.writeFileSync(path.join(second, ".claude.json"), "{}");
  const two = withClaudeSlotLogin(env, "2nd");
  assert.equal(two.CLAUDE_CONFIG_DIR, second); assert.equal(two.CLAUDE_CODE_OAUTH_TOKEN, other);
  assert.equal(withClaudeSlotLogin(env, "2nd", true).CLAUDE_CONFIG_DIR, undefined, "an explicit configuration_root wins");
  fs.writeFileSync(path.join(first, "oauth-token"), "not-a-token");
  for (const slot of ["1st", "3rd", "../2nd", ""]) assert.throws(() => withClaudeSlotLogin(env, slot), /^Error: CLAUDE_LOGIN_UNAVAILABLE: /, slot);
  assert.throws(() => withClaudeSlotLogin({ HOME: home }, "2nd"), /CLAUDE_LOGIN_UNAVAILABLE/, "no listed parent");
  await assert.rejects(core.listAgentModels("codex", { claude_login: "2nd" }), /AGENT_CONFIGURATION_ROOT_REJECTED/);
});

test("a token login's catalog root is its own per root and login, seeded with only the root's oauthAccount", async () => {
  const { claudeCatalogRoot } = await import("../dist/claude-catalog-root.js");
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "u1" }, userID: "x", projects: {} }));
  const a = claudeCatalogRoot({ ...env, CLAUDE_CODE_OAUTH_TOKEN: "t1" });
  const seeded = JSON.parse(fs.readFileSync(path.join(a.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8"));
  assert.deepEqual(seeded, { oauthAccount: { accountUuid: "u1" } });
  assert.equal(a.env.CLAUDE_CODE_OAUTH_TOKEN, "t1");
  assert.equal(fs.existsSync(path.join(a.env.CLAUDE_CONFIG_DIR, ".credentials.json")), false);
  assert.notEqual(claudeCatalogRoot({ ...env, CLAUDE_CODE_OAUTH_TOKEN: "t2" }).env.CLAUDE_CONFIG_DIR, a.env.CLAUDE_CONFIG_DIR);
  // Claude Code's own cache in the catalog root survives; only oauthAccount follows the root.
  fs.writeFileSync(path.join(a.env.CLAUDE_CONFIG_DIR, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "u1" }, cachedGrowthBookFeatures: { f: true } }));
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "u2" } }));
  const again = claudeCatalogRoot({ ...env, CLAUDE_CODE_OAUTH_TOKEN: "t1" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(again.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8")), { oauthAccount: { accountUuid: "u2" }, cachedGrowthBookFeatures: { f: true } });
  // A non-default root's global config is <root>/.claude.json.
  fs.writeFileSync(path.join(second, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "u3" } }));
  const rooted = claudeCatalogRoot({ ...env, CLAUDE_CONFIG_DIR: second, CLAUDE_CODE_OAUTH_TOKEN: "t1" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(rooted.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8")).oauthAccount.accountUuid, "u3");
  assert.equal(claudeCatalogRoot({ ...env, ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t1" }), null);
});

test("a live process's named environment is read on Linux and macOS, and is unknown elsewhere", async () => {
  const { readProcessEnvironment } = await import("../dist/process-runtime.js");
  const ps = "/usr/local/bin/claude --model opus HOME=/Users/k CLAUDE_CONFIG_DIR=/Users/k/r CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc\n";
  assert.deepEqual(readProcessEnvironment(1, ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "MISSING"], "darwin", ps),
    { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-abc", CLAUDE_CONFIG_DIR: "/Users/k/r", MISSING: null });
  assert.equal(readProcessEnvironment(process.pid, ["PATH"], "win32"), null);
  if (process.platform === "linux") {
    const { spawn } = await import("node:child_process");
    const child = spawn("sleep", ["5"], { env: { PATH: process.env.PATH, AITERM_PROBE: "on" } });
    try { assert.deepEqual(readProcessEnvironment(child.pid, ["AITERM_PROBE", "AITERM_NO_SUCH"]), { AITERM_PROBE: "on", AITERM_NO_SUCH: null }); }
    finally { child.kill(); }
  }
});
