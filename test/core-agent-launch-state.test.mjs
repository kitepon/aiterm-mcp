// core-agentの試験のうち、起動した席の認証・共有の設定・片付け。準備は core-agent-support.mjs。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  hasTmux, savedHome, fakeHome, argvPrinterBin, fakeClaudeBin, fakeGrokBin, core, codexHarness, skip,
  testUid, skipAgentDone, skipGrokFakeBin, agentStateDir, makeFakeCodexHome, makeFakeGrokHome,
  makeGrokHomeWithoutAuth, withFakeCodexHome, withFakeCodexTuiHome, withFakeGrokHome,
  withGrokHomeWithoutAuth, agentStateFiles, readAgentMeta, writeAgentMeta, bindTranscriptTurn,
  writeCodexTranscript, appendCodexTranscript, appendCodexDone, scheduleCodexDone, writeGrokTranscript,
  sessionLogPath, makeFakeCodexTuiBin, makeFakeCodexRateLimitTuiBin, makeFakeThroughlineBin,
  makeBrokenThroughlineBin, FAKE_TUI_STRIP_PASTE_MARKERS, makeFakeGrokTuiBin, makeFakeGrokFooterOnlyTuiBin,
  makeGrokCatalogBin, makeFailingGrokCatalogBin, makeFakeClaudeTuiBin, makeFakeClaudeTrustTuiBin,
  appendAgentDoneWhenLogContains, agentDoneLine, appendAgentDone, scheduleAgentDone, writeClaudeDone,
  invokeClaudeStopHook, claudeDispatchReceiptPath, appendClaudeDoneWhenLogContains, markFakeAgentReady,
  fileSnapshot,
} from "./core-agent-support.mjs";

test("openAgent claude: 未認証はsession作成前に拒否して残骸を残さない", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authJson: '{"loggedIn":false}', authExit: 1 });
  const sessionsBefore = core.listSessions();
  const stateBefore = agentStateFiles();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_rejected", agent_done: true }),
      (error) =>
        error.code === 2 &&
        /認証を利用できません/.test(error.message) &&
        /sessionは作成していません/.test(error.message) &&
        /claude auth login/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "未認証launchがtmux sessionを残さない");
    assert.deepEqual(agentStateFiles(), stateBefore, "未認証launchがagent stateを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: 認証statusが壊れていれば偽成功せずsession作成前に拒否する", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authJson: "not-json" });
  const sessionsBefore = core.listSessions();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_unknown", agent_done: true }),
      (error) => error.code === 2 && /認証状態を起動前に確認できません/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "壊れたstatusでtmux sessionを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: loggedIn=trueでもauth status失敗exitを成功扱いしない", { skip: process.platform === "win32" ? "POSIX fake Claude専用" : undefined }, () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin({ authExit: 1 });
  const sessionsBefore = core.listSessions();
  process.env.CLAUDE_BIN = fakeBin;
  try {
    assert.throws(
      () => core.openAgent("claude", { session_name: "claude_auth_failed_exit", agent_done: true }),
      (error) => error.code === 2 && /認証状態を起動前に確認できません/.test(error.message),
    );
    assert.equal(core.listSessions(), sessionsBefore, "失敗exitでtmux sessionを残さない");
  } finally {
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude: 共有認証で複数sessionを反復起動できる", { skip: skipAgentDone }, () => {
  const created = [];
  try {
    for (let wave = 0; wave < 2; wave += 1) {
      const waveSessions = Array.from({ length: 3 }, (_, index) => {
        const [sid] = core.openAgent("claude", {
          session_name: `claude_parallel_${wave}_${index}_${Date.now().toString(36)}`,
          agent_done: true,
        });
        created.push(sid);
        return sid;
      });
      assert.equal(new Set(waveSessions).size, 3, "同じwaveのClaude sessionは一意");
      const listed = core.listSessions();
      for (const sid of waveSessions) assert.match(listed, new RegExp(`^${sid}\\t.*agent=claude`, "m"));
      for (const sid of waveSessions) {
        core.closeSession(sid);
        created.splice(created.indexOf(sid), 1);
      }
    }
  } finally {
    for (const sid of created) {
      try { core.closeSession(sid); } catch { /* noop */ }
    }
  }
});

test("managed Claude: /login と /logout の解釈はClaude Codeに委ねる", { skip: skipAgentDone }, async () => {
  for (const command of ["/login", "/logout"]) {
    const [sid] = core.openAgent("claude", { agent_done: true });
    try {
      await markFakeAgentReady(sid, "claude");
      const receipt = await core.dispatchAgentTurn(sid, command);
      assert.equal(receipt.vendor, "claude");
      assert.equal(typeof receipt.event_cursor, "number");
    } finally {
      core.closeSession(sid);
    }
  }
});

test("readAgentTranscript: Claude完了event直後のmarker削除raceを待って回収する", { skip: skipAgentDone }, async () => {
  const savedBin = process.env.CLAUDE_BIN;
  const fakeBin = makeFakeClaudeTuiBin();
  process.env.CLAUDE_BIN = fakeBin;
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    await core.dispatchAgentTurn(sid, "marker raceを再現する");
    const meta = readAgentMeta(sid);
    const markerFile = path.join(path.dirname(meta.result_file), `${meta.aiterm_session}.${meta.launch_id}.claude-operation.json`);
    writeClaudeDone(meta, "marker race after completion", { consume_marker: false });
    setTimeout(() => fs.rmSync(markerFile, { force: true }), 250);
    const started = Date.now();
    const transcript = await core.readAgentTranscript(sid);
    assert.match(transcript, /marker race after completion/);
    assert.ok(Date.now() - started >= 100, "event公開直後のactive marker削除を待つ");
  } finally {
    core.closeSession(sid);
    if (savedBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(fakeBin, { force: true });
  }
});

test("openAgent claude agent_done: 通常settingsへStop hookとlineageを追加する", { skip: skipAgentDone }, async () => {
  const [sid, hint] = core.openAgent("claude", {
    model: "claude-sonnet-4-6",
    reasoning_effort: "high",
    agent_done: true,
  });
  try {
    assert.match(hint, /Claude Code/);
    assert.match(hint, /agent_done 待機が有効/);
    const meta = readAgentMeta(sid);
    assert.equal(meta.kind, "claude");
    assert.equal(meta.hook_route, "shared_claude_settings");
    assert.ok(fs.existsSync(meta.event_file));
    assert.ok(fs.existsSync(meta.result_file));
    assert.equal(meta.claude_mcp_config, undefined, "user MCP snapshotを作らない");
    const settings = JSON.parse(fs.readFileSync(meta.claude_settings, "utf8"));
    assert.equal(settings.model, "claude-sonnet-4-6");
    assert.equal(settings.effortLevel, "high");
    assert.match(settings.hooks.Stop[0].hooks[0].command, /claude-stop-hook\.js/);
    const { hookNodeExecutable } = await import("../dist/harnesses/claude.js");
    assert.ok(settings.hooks.Stop[0].hooks[0].command.startsWith(`'${hookNodeExecutable()}' `), "PATHにnodeが無い環境でも動くよう、nodeを絶対pathで呼ぶ");
    assert.doesNotMatch(settings.hooks.Stop[0].hooks[0].command, /\/Cellar\//u, "Homebrewの版付きnode実体を焼き付けない");
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.match(out, /--setting-sources\s+user,project,local\s+--settings/);
    assert.match(out, /--dangerously-skip-permissions/);
    assert.match(out, /--settings/);
    assert.doesNotMatch(out, /--mcp-config/, "user MCP未登録ならflagを渡さない");
    assert.match(out, /--model\s+claude-sonnet-4-6/);
    assert.match(out, /--effort\s+high/);
    assert.doesNotMatch(out, /\s-p(?:\s|$)/, "headless print modeへ落とさない");
  } finally {
    core.closeSession(sid);
  }
});

test("openAgent claude agent_done: user MCPをsnapshotせず通常configへ委ねる", { skip: skipAgentDone }, async () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  fs.writeFileSync(userConfig, JSON.stringify({
    theme: "dark",
    mcpServers: {
      aishell: {
        command: "aishell-mcp",
        env: { AISHELL_CAPABILITY_SET: "expanded-v1", TEST_SECRET: "fixture-only" },
      },
    },
  }) + "\n", { mode: 0o600 });
  const before = fs.readFileSync(userConfig, "utf8");
  const [sid] = core.openAgent("claude", { agent_done: true });
  try {
    const meta = readAgentMeta(sid);
    assert.equal(meta.claude_mcp_config, undefined);
    const settings = JSON.parse(fs.readFileSync(meta.claude_settings, "utf8"));
    assert.deepEqual(Object.keys(settings), ["fastMode", "hooks"], "aiterm所有fileは、通常の速度の明示と追加Stop hookだけを持つ");
    assert.equal(settings.fastMode, false, "席は通常の速度で始める（ADR 0114）");
    const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    assert.doesNotMatch(out, /--mcp-config/);
    assert.doesNotMatch(out, /fixture-only/, "MCP定義や秘密値をargvへ展開しない");
    assert.equal(fs.readFileSync(userConfig, "utf8"), before);
    core.closeSession(sid);
    assert.equal(fs.readFileSync(userConfig, "utf8"), before, "close後も通常configを維持する");
  } finally {
    fs.rmSync(userConfig, { force: true });
    try {
      core.closeSession(sid);
    } catch {
      /* already closed */
    }
  }
});

test("openAgent claude agent_done: 通常user configをlauncher自身はparseも書換えもしない", { skip: skipAgentDone }, () => {
  const userConfig = path.join(fakeHome, ".claude.json");
  fs.writeFileSync(userConfig, "{ broken\n", { mode: 0o600 });
  const sid = `claude_bad_mcp_${Date.now().toString(36)}`;
  let created = null;
  try {
    [created] = core.openAgent("claude", { session_name: sid, agent_done: true });
    assert.equal(created, sid);
    assert.equal(fs.readFileSync(userConfig, "utf8"), "{ broken\n");
  } finally {
    if (created) core.closeSession(created);
    fs.rmSync(userConfig, { force: true });
  }
});

test("openAgent claude: 相関済みlaunch replayは同じsession receiptを返しCLIを再送しない", { skip: skipAgentDone }, async () => {
  const sid = `claude_launch_replay_${Date.now().toString(36)}`;
  const operationId = `sha256:${"a".repeat(64)}`;
  try {
    const first = core.openAgent("claude", {
      session_name: sid,
      agent_done: true,
      launch_operation_id: operationId,
    });
    assert.equal(first[0], sid);
    await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
    const before = fs.readFileSync(sessionLogPath(sid), "utf8");
    const meta = readAgentMeta(sid);
    assert.equal(meta.launch_operation_id, operationId);
    assert.match(meta.launch_request_digest, /^sha256:[0-9a-f]{64}$/);

    const replay = core.openAgent("claude", {
      session_name: sid,
      agent_done: true,
      launch_operation_id: operationId,
    });
    assert.equal(replay[0], sid);
    assert.match(replay[1], /CLIは再送していません/);
    assert.equal(fs.readFileSync(sessionLogPath(sid), "utf8"), before, "replayでPTYへ起動commandを再送しない");

    assert.throws(
      () => core.openAgent("claude", {
        session_name: sid,
        agent_done: true,
        launch_operation_id: `sha256:${"b".repeat(64)}`,
      }),
      /launch identityが一致しません/,
    );
    assert.throws(
      () => core.openAgent("claude", {
        session_name: sid,
        model: "claude-sonnet-4-6",
        agent_done: true,
        launch_operation_id: operationId,
      }),
      /launch identityが一致しません/,
    );
  } finally {
    try {
      core.closeSession(sid);
    } catch {
      /* noop */
    }
  }
});

test("openAgent claude: launch_operation_idのpromptless managed条件を固定する", { skip: skipAgentDone }, async () => {
  const operationId = `sha256:${"c".repeat(64)}`;
  assert.throws(
    () => core.openAgent("claude", { agent_done: true, launch_operation_id: operationId }),
    /明示session_nameが必要/,
  );
  assert.throws(
    () => core.openAgent("claude", { session_name: "launch_requires_managed", launch_operation_id: operationId }),
    /agent_done:trueが必要/,
  );
  await assert.rejects(
    core.openAgentWithInitialPrompt("claude", {
      session_name: "launch_rejects_prompt",
      prompt: "送信しない",
      agent_done: true,
      launch_operation_id: operationId,
    }),
    /launch_operation_idはpromptなしのClaude相関launchだけで指定できます/,
  );
});

test("openAgent grok agent_done: 通常 GROK_HOME を共有し相関・lineage引数だけを加える", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = fakeGrokBin;
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const [sid, hint] = core.openAgent("grok", {
        agent_done: true,
        prompt: "Reply READY.",
      });
      try {
        assert.match(hint, /agent_done 待機が有効/);
        assert.match(hint, /project／user環境を共有/);
        const dir = agentStateDir();
        const metas = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.`) && f.endsWith(".agent.json"));
        assert.equal(metas.length, 1);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, metas[0]), "utf8"));
        assert.equal(meta.kind, "grok");
        assert.equal(meta.hook_route, "shared_grok_home");
        assert.equal(meta.completion_route, "grok_transcript");
        assert.equal(meta.grok_home, fakeHome);
        assert.equal(meta.agent_role, "subagent");
        assert.equal(meta.parent_session_id, "host-root");
        assert.equal(meta.delegation_depth, 1);
        assert.equal(meta.delegation_allowed, true);
        assert.ok(fs.existsSync(meta.event_file), "event file を作る");
        assert.equal(meta.grok_auth_path, path.join(fakeHome, "auth.json"));
        const replacement = path.join(fakeHome, "auth.replacement");
        fs.writeFileSync(replacement, '{"rotated":true}\n', { mode: 0o600 });
        fs.renameSync(replacement, meta.grok_auth_path);
        assert.match(fs.readFileSync(meta.grok_auth_path, "utf8"), /rotated/);
        assert.match(fs.readFileSync(path.join(meta.grok_home, "config.toml"), "utf8"), /auto_update = true/);

        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.match(out, /GROK_AUTH_PATH=/, `grok auth canonical path is passed: ${out}`);
        assert.match(out, /--session-id/, `grok correlation id: ${out}`);
        assert.match(out, new RegExp(meta.vendor_session_id), `grok vendor session: ${out}`);
        assert.match(out, /--rules/, `grok subagent instruction: ${out}`);
        assert.match(out, /^agent_role=subagent\r?$/m, `grok lineage env: ${out}`);
        assert.match(out, /--no-auto-update/, `grok command: ${out}`);
        assert.match(out, /--no-alt-screen/, `grok no-alt-screen: ${out}`);
        assert.match(out, /--verbatim/, `grok verbatim: ${out}`);
        assert.match(out, /<arg>--model<\/arg>\s+<arg>grok-4\.6<\/arg>/, `grok model: ${out}`);
        assert.doesNotMatch(out, /(^| )HOME=/, `grok HOME must be inherited: ${out}`);
        assert.doesNotMatch(out, /(^| )GROK_HOME=/, `grok GROK_HOME must be inherited: ${out}`);
        assert.doesNotMatch(out, /--effort/, `grok effort: ${out}`);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("openAgent grok agent_done: OAuth auth 不在は session 残骸ゼロで拒否する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedApiKey = process.env.XAI_API_KEY;
  process.env.GROK_BIN = "/bin/echo";
  delete process.env.XAI_API_KEY;
  try {
    await withGrokHomeWithoutAuth(async () => {
      const beforeSessions = core.listSessions();
      const beforeFiles = agentStateFiles();
      assert.throws(
        () => core.openAgent("grok", { agent_done: true, prompt: "Reply READY." }),
        (e) => e.code === 2 && /grok login/.test(e.message),
      );
      assert.equal(core.listSessions(), beforeSessions, "失敗した grok agent が tmux session を残した");
      assert.deepEqual(agentStateFiles(), beforeFiles, "失敗した grok agent が agent state を残した");
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
    if (savedApiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedApiKey;
  }
});

test("openAgent grok agent_done: GROK_AUTH_PATH の構造だけを session 前に固定する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedPath = process.env.GROK_AUTH_PATH;
  const savedKey = process.env.XAI_API_KEY;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (home) => {
      const before = agentStateFiles();
      const reject = (name, setup) => {
        setup();
        assert.throws(() => core.openAgent("grok", { agent_done: true }), (e) => e.code === 2, name);
        assert.deepEqual(agentStateFiles(), before, `${name}: stateを残さない`);
      };
      reject("empty", () => { process.env.GROK_AUTH_PATH = ""; });
      reject("relative", () => { process.env.GROK_AUTH_PATH = "relative.json"; });
      reject("missing explicit despite key", () => { process.env.GROK_AUTH_PATH = path.join(home, "missing"); process.env.XAI_API_KEY = "test"; });
    });
    await withGrokHomeWithoutAuth(async () => {
      delete process.env.GROK_AUTH_PATH; process.env.XAI_API_KEY = "test";
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        const meta = readAgentMeta(sid);
        assert.equal(meta.grok_auth_path, null);
        const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
        assert.doesNotMatch(out, /GROK_AUTH_PATH=/);
      } finally { core.closeSession(sid); }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    if (savedKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedKey;
  }
});

test("openAgent grok/composer agent_done: auth のリンクと権限はGrokへ委ねる", { skip: skipGrokFakeBin }, () => {
  const savedBin = process.env.GROK_BIN;
  const savedPath = process.env.GROK_AUTH_PATH;
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR), "grok-auth-ancestor-"));
  const realParent = path.join(root, "real-parent");
  const symlinkParent = path.join(root, "symlink-parent");
  const writableParent = path.join(root, "writable-parent");
  process.env.GROK_BIN = fakeGrokBin;
  try {
    fs.mkdirSync(realParent, { mode: 0o700 });
    fs.writeFileSync(path.join(realParent, "auth.json"), "{}\n", { mode: 0o600 });
    fs.symlinkSync(realParent, symlinkParent);
    fs.mkdirSync(writableParent, { mode: 0o720 });
    fs.chmodSync(writableParent, 0o720);
    fs.writeFileSync(path.join(writableParent, "auth.json"), "{}\n", { mode: 0o600 });
    const openForBoth = (authPath) => {
      process.env.GROK_AUTH_PATH = authPath;
      for (const kind of ["grok"]) {
        const [sid] = core.openAgent(kind, { agent_done: true });
        try {
          assert.equal(readAgentMeta(sid).grok_auth_path, authPath);
        } finally {
          core.closeSession(sid);
        }
      }
    };
    openForBoth(path.join(symlinkParent, "auth.json"));
    openForBoth(path.join(writableParent, "auth.json"));
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    fs.chmodSync(writableParent, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: relative GROK_HOMEでも親cwd基準の絶対auth正本を子へ渡す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  const savedHome = process.env.GROK_HOME;
  const home = makeFakeGrokHome();
  const childCwd = fs.mkdtempSync(path.join(process.env.TMPDIR, "grok-child-cwd-"));
  process.env.GROK_BIN = "/bin/echo";
  process.env.GROK_HOME = path.relative(process.cwd(), home);
  try {
    const [sid] = core.openAgent("grok", { agent_done: true, cwd: childCwd });
    try {
      const meta = readAgentMeta(sid);
      assert.equal(meta.grok_auth_path, path.resolve(home, "auth.json"));
      const out = await core.readOutput(sid, { wait: true, timeout: 5, raw: true });
      assert.match(out.replace(/[\r\n ]/g, ""), /GROK_AUTH_PATH=/, "tmux画面折返しを除いて絶対auth envを確認する");
    } finally { core.closeSession(sid); }
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(childCwd, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: auth の種類はGrokへ委ね、不存在defaultはAPI keyで許可する", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN; const savedHome = process.env.GROK_HOME; const savedPath = process.env.GROK_AUTH_PATH; const savedKey = process.env.XAI_API_KEY;
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR), "grok-auth-fifo-"));
  const fifo = path.join(root, "auth.json"); const auth = path.join(root, "explicit-auth.json");
  process.env.GROK_BIN = "/bin/echo";
  try {
    assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
    process.env.GROK_HOME = root; delete process.env.GROK_AUTH_PATH; delete process.env.XAI_API_KEY;
    let opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
    const missingHome = path.join(root, "missing-home");
    process.env.GROK_HOME = missingHome; process.env.XAI_API_KEY = "test";
    opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
    fs.writeFileSync(auth, "{}\n", { mode: 0o600 });
    delete process.env.XAI_API_KEY; process.env.GROK_AUTH_PATH = auth;
    opened = core.openAgent("grok", { agent_done: true })[0]; core.closeSession(opened);
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = savedBin;
    if (savedHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = savedHome;
    if (savedPath === undefined) delete process.env.GROK_AUTH_PATH; else process.env.GROK_AUTH_PATH = savedPath;
    if (savedKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedKey;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("openAgent grok agent_done: auth hard link はGrokへ渡す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const victim = path.join(fakeHome, "victim-auth-target");
      const auth = path.join(fakeHome, "auth.json");
      fs.writeFileSync(victim, "{}\n", { mode: 0o600 });
      fs.rmSync(auth);
      fs.linkSync(victim, auth);
      const [sid] = core.openAgent("grok", { agent_done: true });
      try {
        assert.equal(readAgentMeta(sid).grok_auth_path, auth);
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("openAgent codex agent_done: cleanup は共有 CODEX_HOME の auth/config を残す", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async (fakeHome) => {
    const authPath = path.join(fakeHome, "auth.json");
    const configPath = path.join(fakeHome, "config.toml");
    const authBefore = fileSnapshot(authPath);
    const configBefore = fileSnapshot(configPath);
    const [sid] = core.openAgent("codex", { agent_done: true });
    const meta = readAgentMeta(sid);
    assert.equal(meta.codex_home, fakeHome);
    assert.equal(fs.lstatSync(path.join(meta.codex_home, "auth.json")).isSymbolicLink(), false);
    core.closeSession(sid);
    assert.deepEqual(fileSnapshot(authPath), authBefore, "cleanup が Codex auth.json の実体を変えた");
    assert.deepEqual(fileSnapshot(configPath), configBefore, "cleanup が Codex config.toml の実体を変えた");
    assert.equal(fs.existsSync(meta.codex_home), true, "共有 CODEX_HOME を cleanup してはいけない");
  });
});

test("openAgent grok agent_done: cleanup は共有 auth/config/GROK_HOME を残す", { skip: skipGrokFakeBin }, async () => {
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = "/bin/echo";
  try {
    await withFakeGrokHome(async (fakeHome) => {
      const authPath = path.join(fakeHome, "auth.json");
      const configPath = path.join(fakeHome, "config.toml");
      const authBefore = fileSnapshot(authPath);
      const configBefore = fileSnapshot(configPath);
      const [sid] = core.openAgent("grok", { agent_done: true });
      const meta = readAgentMeta(sid);
      core.closeSession(sid);
      assert.deepEqual(fileSnapshot(authPath), authBefore, "cleanup が Grok auth.json の実体を変えた");
      assert.deepEqual(fileSnapshot(configPath), configBefore, "cleanup が通常 Grok config.toml の実体を変えた");
      assert.equal(fs.existsSync(meta.grok_home), true, "共有 GROK_HOME を cleanup してはいけない");
    });
  } finally {
    if (savedBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = savedBin;
  }
});

test("killAll: 同じstateを使う別socketのagent登録を残す", { skip: skipAgentDone }, () => {
  const foreignRoot = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "ak-"));
  const foreignSession = "foreign_socket_agent";
  const foreignEnv = { ...process.env, TMPDIR: foreignRoot, XDG_RUNTIME_DIR: foreignRoot,
    AITERM_STATE_BASE: process.env.TMPDIR };
  const coreUrl = new URL("../dist/core.js", import.meta.url).href;
  const runForeign = (body) => spawnSync(process.execPath, ["--input-type=module", "-e",
    `const core = await import(${JSON.stringify(coreUrl)}); ${body}`],
  { env: foreignEnv, encoding: "utf8", timeout: 15000 });
  let localSession;
  try {
    const opened = runForeign(`core.openAgent("claude", { session_name: ${JSON.stringify(foreignSession)}, agent_done: true });`);
    assert.equal(opened.status, 0, opened.stderr);
    const foreignMeta = readAgentMeta(foreignSession);
    const files = fs.readdirSync(agentStateDir()).filter((file) => file.startsWith(`${foreignSession}.`));
    const before = new Map(files.map((file) => [file, fs.readFileSync(path.join(agentStateDir(), file))]));
    [localSession] = core.openAgent("claude", { agent_done: true });
    const localMeta = readAgentMeta(localSession);
    core.killAll();
    assert.equal(fs.existsSync(path.join(agentStateDir(), `${localSession}.${localMeta.launch_id}.agent.json`)), false);
    for (const [file, bytes] of before) {
      assert.deepEqual(fs.readFileSync(path.join(agentStateDir(), file)), bytes, `別socketの${file}を変えた`);
    }
    assert.equal(fs.existsSync(foreignMeta.event_file), true);
    const observed = runForeign(`if (!core.listSessionsResult().sessions.some(session => session.session_id === ${JSON.stringify(foreignSession)}) || !core.isAgentSession(${JSON.stringify(foreignSession)})) process.exit(2);`);
    assert.equal(observed.status, 0, observed.stderr);
    // 別socketの生きた待機者も、このsocketの終了を妨げない。
    const lock = path.join(agentStateDir(), `${foreignSession}.${foreignMeta.launch_id}.wait.lock`);
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: new Date().toISOString() }));
    core.openSession("local_socket_only");
    assert.doesNotThrow(() => core.killAll());
    assert.equal(fs.existsSync(lock), true);
    fs.unlinkSync(lock);
  } finally {
    runForeign(`core.closeSession(${JSON.stringify(foreignSession)});`);
    if (localSession) core.closeSession(localSession);
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  }
});

test("killAll: Claude operation markerとdispatch receiptもcleanupする", { skip: skipAgentDone }, async () => {
  const [sid] = core.openAgent("claude", { agent_done: true });
  const operationId = `sha256:${"0".repeat(64)}`;
  const meta = readAgentMeta(sid);
  await markFakeAgentReady(sid, "claude");
  await core.dispatchAgentTurn(sid, "CLAUDE_KILL_ALL_OPERATION", { operation_id: operationId });
  const dir = path.dirname(meta.result_file);
  const before = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.${meta.launch_id}.`));
  assert.ok(before.some((f) => f.endsWith(".claude-operation.json")));
  assert.ok(before.some((f) => f.endsWith(".claude-dispatch")));
  core.killAll();
  const after = fs.readdirSync(dir).filter((f) => f.startsWith(`${sid}.${meta.launch_id}.`));
  assert.deepEqual(after, []);
});

// 旧名「緩い state root でも…」: mode 矯正（chmod 0o777→0o700）は 2026-08-19 の
// 安全設備撤去で仕様から消えたため、stale metadata 掃除だけを固定する。
test("openAgent agent_done: 既存 state root の stale metadata を掃除してから再作成する", { skip: skipAgentDone }, async () => {
  await withFakeCodexHome(async () => {
    const session = "loose_cleanup";
    const root = path.join(process.env.TMPDIR, `aiterm-mcp-${testUid()}`);
    const agents = path.join(root, "agents");
    fs.mkdirSync(agents, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(agents, `${session}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.agent.json`), "{}\n", { mode: 0o600 });

    const [sid] = core.openAgent("codex", { session_name: session, agent_done: true });
    try {
      assert.equal(sid, session);
      const files = fs.readdirSync(agents).filter((f) => f.startsWith(`${session}.`) && f.endsWith(".agent.json"));
      assert.equal(files.length, 1, `stale metadata が残った: ${files.join(",")}`);
      assert.doesNotMatch(files[0], /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);

      await markFakeAgentReady(session, "codex");
      const receipt = await core.dispatchAgentTurn(session, "echo LOOSE_CLEANUP_BODY");
      assert.equal(receipt.harness, "codex-cli");
      const observation = await core.observeAgentDone(session, { cursor: receipt.event_cursor, timeout: 0 });
      assert.equal(observation.outcome, "running");
      assert.equal(observation.vendor, "codex");
      assert.equal(observation.harness, "codex-cli");
    } finally {
      core.closeSession(sid);
    }
  });
});
