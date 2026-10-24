import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ARGV_FIXTURE_DONE, core, readAgentMeta, readArgvFixture, skipAgentDone, withFakeCodexHome,
} from "./core-agent-support.mjs";

const shared = await import("../dist/agent-shared.js");
const runtime = await import("../dist/tmux-runtime.js");

// Aitermが自分で選んだbash paneへ渡すagent起動commandは、sub-agent instructionのLFと日本語を含む。
// 対話shellへ1行ずつ打って継続promptで繋ぐのではなく、1物理行に適合してから打つ（src/core.ts prepareAgentLaunch）。
// ここでは偽CLIが実際に受け取ったargvを、画面echoやConPTYの再描画に頼らず、偽CLI自身が書いたfileのbyteで照合する。
const launchArgvDir = fs.mkdtempSync(path.join(process.env.TMPDIR, "launch-argv-"));
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
  assert.match(submitted, /^eval "\$\(command printf '%b' '/u, submitted);
};

// shell側の解釈を広く踏む初手prompt: 単引用符、backslashとliteralの\n、履歴展開の!、printfの%、展開しない$と``、tab、日本語、LF。
const PROMPT = "A\\nB 'q' !x %s 50% $HOME `id`\t末尾\n2行目";

test("openAgent codex: 起動commandは1物理行で打たれ、argvは偽CLIのfileでbyteのまま届く", { skip: skipAgentDone }, async (t) => {
  const saved = process.env.CODEX_BIN;
  process.env.CODEX_BIN = launchArgvCodexBin;
  try {
    await withFakeCodexHome(async () => {
      const [sid] = core.openAgent("codex", { agent_done: true, prompt: PROMPT });
      try {
        assertOnePhysicalLine(submittedLine(sid));
        await readArgvFixture(sid, t);
        const argv = receivedArgv(sid);
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
