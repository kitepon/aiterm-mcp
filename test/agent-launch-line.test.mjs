import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  ARGV_FIXTURE_DONE, core, readAgentMeta, readArgvFixture, skipAgentDone, withFakeCodexHome, withFakeGrokHome,
} from "./core-agent-support.mjs";

const shared = await import("../dist/agent-shared.js");
const runtime = await import("../dist/tmux-runtime.js");

// The owned shell gets one physical launch line: POSIX bash or Windows native
// PowerShell. Windows passes an argv array rather than typing into MSYS bash.
// ここでは偽CLIが実際に受け取ったargvを、画面echoやConPTYの再描画に頼らず、偽CLI自身が書いたfileのbyteで照合する。
const launchArgvDir = fs.mkdtempSync(path.join(process.env.TMPDIR, "launch argv '-"));
const quotedDir = "'" + launchArgvDir.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
const argvFileFor = (launchId) => path.join(launchArgvDir, `${launchId}.bin`);
const writeArgvLines = [
  `for arg do printf '%s\\0' "$arg"; done > ${quotedDir}/"$AITERM_AGENT_LAUNCH_ID".bin`,
  `printf '%s\\n' '${ARGV_FIXTURE_DONE}'`,
];
const launchArgvCodexBin = path.join(process.env.TMPDIR, "launch-argv-codex.sh");
fs.writeFileSync(launchArgvCodexBin, ["#!/bin/sh", ...writeArgvLines, ""].join("\n"), { mode: 0o700 });
fs.chmodSync(launchArgvCodexBin, 0o700);
const launchArgvClaudeBin = path.join(process.env.TMPDIR, "launch-argv-claude.sh");
fs.writeFileSync(
  launchArgvClaudeBin,
  [
    "#!/bin/sh",
    "if [ \"$1\" = auth ] && [ \"$2\" = status ] && [ \"$3\" = --json ]; then",
    "  printf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'",
    "  exit 0",
    "fi",
    ...writeArgvLines,
    "",
  ].join("\n"),
  { mode: 0o700 },
);
fs.chmodSync(launchArgvClaudeBin, 0o700);

const receivedArgv = (sid) => {
  const argv = fs.readFileSync(argvFileFor(readAgentMeta(sid).launch_id)).toString("utf8").split("\0");
  assert.equal(argv.pop(), "", "NUL区切りの末尾");
  return argv;
};
const submittedLine = (sid) => fs.readFileSync(path.join(runtime.SOCKDIR, `${sid}.lastcmd`), "utf8");
const assertOnePhysicalLine = (submitted) => {
  assert.doesNotMatch(submitted, /[\r\n]/u, `起動行はLFを含まない1物理行: ${submitted}`);
  assert.match(submitted, process.platform === 'win32' ? /^\. \(/u : /^eval "\$\(command printf '%b' '/u, submitted);
  if (process.platform === 'win32') assert.doesNotMatch(submitted, /[^\x00-\x7f]/u, 'owned PowerShell launch is ASCII over the console');
};

// shell側の解釈を広く踏む初手prompt: 単引用符、backslashとliteralの\n、履歴展開の!、printfの%、展開しない$と``、tab、日本語、LF。
const PROMPT = "A\\nB 'q' \"dq\" !x %s 50% $HOME `id`\t末尾\n2行目\\";

test("openAgent codex: 起動commandは1物理行で打たれ、argvは偽CLIのfileでbyteのまま届く", { skip: skipAgentDone }, async (t) => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = launchArgvCodexBin;
  try {
    await withFakeCodexHome(async () => {
      const [sid] = core.openAgent("codex", { agent_done: true, prompt: PROMPT, write_scope: "read-only" });
      try {
        assertOnePhysicalLine(submittedLine(sid));
        await readArgvFixture(sid, t);
        const argv = receivedArgv(sid);
        const sandbox = argv.indexOf("--sandbox");
        assert.ok(sandbox >= 0);
        assert.equal(argv[sandbox + 1], "read-only", "sandbox is a received argv pair, independent of shell echo");
        const instruction = shared.subagentInstruction(readAgentMeta(sid));
        assert.ok(argv.includes(`developer_instructions=${instruction}`), JSON.stringify(argv));
        assert.ok(argv.includes(PROMPT), JSON.stringify(argv));
        assert.equal(argv.at(-1), PROMPT, "初手promptは最後の引数");
      } finally {
        core.closeSession(sid);
      }
    });
  } finally {
    process.env.CODEX_BIN = saved;
  }
});

test("openAgent claude: --append-system-promptの複数行instructionも1物理行の起動からbyteのまま届く", { skip: skipAgentDone }, async (t) => {
  const saved = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = launchArgvClaudeBin;
  try {
    const [sid] = core.openAgent("claude", { agent_done: true });
    try {
      assertOnePhysicalLine(submittedLine(sid));
      await readArgvFixture(sid, t);
      const argv = receivedArgv(sid);
      const at = argv.indexOf("--append-system-prompt");
      assert.ok(at >= 0, JSON.stringify(argv));
      const instruction = argv[at + 1];
      assert.ok(instruction.startsWith(shared.subagentInstruction(readAgentMeta(sid)).split("\n").slice(0, -1).join("\n") + "\n"), instruction);
      assert.ok(instruction.includes(`「${core.AGENT_DEFAULT_PREFACE}」`), instruction);
      assert.ok(instruction.endsWith("\n</aiterm_subagent_context>"), instruction);
    } finally {
      core.closeSession(sid);
    }
  } finally {
    process.env.CLAUDE_BIN = saved;
  }
});

test("Windows Grok: native executable receives literal argv and its original auth/update environment", { skip: process.platform !== "win32" }, async (t) => {
  const source = path.join(launchArgvDir, "native-grok.cs");
  const bin = path.join(launchArgvDir, "native-grok.exe");
  const output = path.join(launchArgvDir, "native-grok.bin");
  fs.writeFileSync(source, `using System; using System.IO; using System.Text;
class Fixture {
  static void Main(string[] args) {
    if (args.Length > 0 && args[0] == "models") {
      Console.WriteLine("You are logged in with grok.com.\\n\\nDefault model: grok-4.5\\n\\nAvailable models:\\n  * grok-4.5 (default)");
      return;
    }
    string file = Environment.GetEnvironmentVariable("AITERM_TEST_GROK_ARGV_FILE");
    using (var stream = new FileStream(file, FileMode.Create)) {
      foreach (string arg in args) { byte[] bytes = Encoding.UTF8.GetBytes(arg); stream.Write(bytes, 0, bytes.Length); stream.WriteByte(0); }
    }
    File.WriteAllText(file + ".env", Environment.GetEnvironmentVariable("GROK_AUTH_PATH") + "\\n" + Environment.GetEnvironmentVariable("GROK_DISABLE_AUTOUPDATER") + "\\n" + Environment.GetEnvironmentVariable("GROK_PRIVACY_NOTICE_ROLLOUT") + "\\n", new UTF8Encoding(false));
    Console.WriteLine(${JSON.stringify(ARGV_FIXTURE_DONE)});
  }
}`);
  const compiler = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const built = spawnSync(compiler, ["/nologo", "/target:exe", `/out:${bin}`, source], { encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(built.status, 0, built.stdout + built.stderr + (built.error?.message || ""));
  const savedBin = process.env.GROK_BIN;
  process.env.GROK_BIN = bin;
  process.env.AITERM_TEST_GROK_ARGV_FILE = output;
  try {
    await withFakeGrokHome(async () => {
      const [sid] = core.openAgent("grok", { agent_done: true, prompt: PROMPT, reasoning_effort: "high", env_vars: ["AITERM_TEST_GROK_ARGV_FILE"] });
      try {
        assertOnePhysicalLine(submittedLine(sid));
        await readArgvFixture(sid, t);
        const argv = fs.readFileSync(output, "utf8").split("\0");
        assert.equal(argv.pop(), "");
        assert.equal(argv.at(-1), PROMPT);
        assert.equal(argv[argv.indexOf("--rules") + 1], shared.subagentInstruction(readAgentMeta(sid)));
        assert.equal(argv[argv.indexOf("--reasoning-effort") + 1], "high");
        assert.deepEqual(fs.readFileSync(output + ".env", "utf8").trimEnd().split("\n"), [readAgentMeta(sid).grok_auth_path, "1", "0"]);
      } finally { core.closeSession(sid); }
    });
  } finally {
    process.env.GROK_BIN = savedBin;
    delete process.env.AITERM_TEST_GROK_ARGV_FILE;
  }
});
