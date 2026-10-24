// agent-screen-observation.ts の振り分けの回帰テスト（tmux 非依存）。
// harness別の画面の読みはこのmoduleの振り分けだけが持ち、動作中の判定は入力欄の観測と同じ読みを使う。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPaneObservation, isAgentTuiBusy, isAgentTuiIdleReady, waitAgentTuiReadyImpl } from "../dist/agent-screen-observation.js";
import { claudePaneObservation, claudeTuiBusy } from "../dist/harnesses/claude.js";
import { codexPaneObservation, codexTuiBusy } from "../dist/harnesses/codex.js";
import { grokPaneObservation, grokTuiBusy } from "../dist/harnesses/grok.js";
import { cursorPaneObservation, cursorTuiBusy } from "../dist/harnesses/cursor.js";

const RULE = "────────────────";
const SCREENS = {
  claude: {
    idle: ["Claude Code v2.1.296", "● 直前の回答", RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n"),
    busy: ["Claude Code v2.1.296", "✻ Musing… (esc to interrupt)", RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n"),
  },
  codex: {
    idle: "OpenAI Codex\n› ",
    busy: "OpenAI Codex\n• Working (2m 18s • esc to interrupt)\n› ",
  },
  grok: {
    idle: ["≡ main / MCP (6/11) │ 3.8K / 500K", "╭────────────────────────╮", "│ >                      │",
      "╰──────── Grok 4.6 (medium) · always-approve ─╯"].join("\n"),
    busy: ["Waiting for response… 12s [stop]", "│ >                      │", "╰──────── Grok 4.6 (medium) · always-approve ─╯"].join("\n"),
  },
  cursor: {
    idle: "Cursor Agent\n→ Add a follow-up\n",
    busy: "Cursor Agent\n⠋ Working\n→ \nctrl+c to stop\n",
  },
};
const HARNESS = { claude: claudePaneObservation, codex: codexPaneObservation, grok: grokPaneObservation, cursor: cursorPaneObservation };
const BUSY = { claude: claudeTuiBusy, codex: codexTuiBusy, grok: grokTuiBusy, cursor: cursorTuiBusy };

test("only a pending-send caller can select steer from readiness; ordinary launch/configuration waits retain their deadline", async () => {
  for (const [kind, screens] of Object.entries(SCREENS)) {
    let clock = 0;
    const sleep = async ms => { clock += ms; };
    const selected = await waitAgentTuiReadyImpl(kind, () => screens.busy, sleep, {
      timeoutMs: 1000, now: () => clock,
      selectSteer: screen => agentPaneObservation(kind, screen).state === "busy",
    });
    assert.equal(selected.steer, true, kind);
    assert.equal(selected.ready, false, kind);
    assert.equal(selected.samples, 1, kind);
    assert.equal(clock, 0, kind);
    const unchanged = await waitAgentTuiReadyImpl(kind, () => screens.busy, sleep, { timeoutMs: 1000, now: () => clock });
    assert.equal(unchanged.steer, undefined, kind);
    assert.equal(unchanged.ready, false, kind);
    assert.equal(clock, 1000, kind);
  }
});

test("agentPaneObservation: 4つのharnessの読みをkindで振り分け、各harnessの観測と同じ結果を返す", () => {
  for (const [kind, screens] of Object.entries(SCREENS)) {
    for (const [label, screen] of Object.entries(screens)) {
      assert.deepEqual(agentPaneObservation(kind, screen), HARNESS[kind](screen), `${kind} ${label}`);
    }
    assert.equal(agentPaneObservation(kind, screens.idle).state, "idle", `${kind} idle`);
    assert.equal(agentPaneObservation(kind, screens.busy).state, "busy", `${kind} busy`);
    assert.equal(isAgentTuiIdleReady(kind, screens.idle), true, `${kind} idle ready`);
    assert.equal(isAgentTuiIdleReady(kind, screens.busy), false, `${kind} busy not ready`);
  }
});

test("isAgentTuiBusy: 動作中の判定は各harnessの読みを使い、入力欄の観測がbusyを返す画面と一致する", () => {
  for (const [kind, screens] of Object.entries(SCREENS)) {
    for (const [label, screen] of Object.entries(screens)) {
      assert.equal(isAgentTuiBusy(kind, screen), BUSY[kind](screen), `${kind} ${label} harness`);
      assert.equal(isAgentTuiBusy(kind, screen), agentPaneObservation(kind, screen).state === "busy", `${kind} ${label} observation`);
    }
  }
});

// 実被弾: Aitermの中身を話していた席は、止まった後も会話欄に「esc to interrupt」が残り、設定替え（agent_configure）が
// 動作中と読み続けて入力待ちを待ち切れなかった。入力欄の観測（claudeTuiBusy）は既に会話欄の語を除いていたが、
// coreが別に持っていた動作中判定は画面全体の正規表現のままだった。同じ画面を2つの読みで判断しない。
test("isAgentTuiBusy: Claudeの会話欄に残った「esc to interrupt」を動作中と読まない", () => {
  const stopped = ["Claude Code v2.1.296", "● 動作中の印は足元の「esc to interrupt」である", "", RULE, "❯ ", RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");
  assert.equal(claudeTuiBusy(stopped), false);
  assert.equal(isAgentTuiBusy("claude", stopped), false);
  assert.deepEqual(agentPaneObservation("claude", stopped), { state: "idle", reason: "composer_ready" });
  // 足元の印と、貼り付けの知らせで足元の印が消えている間の進行行は、今までどおり動作中。
  const footer = ["Claude Code v2.1.296", "● 回答", RULE, "❯ ", RULE, "  esc to interrupt"].join("\n");
  assert.equal(isAgentTuiBusy("claude", footer), true);
  const progress = ["Claude Code v2.1.296", "✶ Slithering… (3s · ↓ 225 tokens · thought for 2s)", RULE, "❯ ", RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");
  assert.equal(isAgentTuiBusy("claude", progress), true);
  assert.equal(agentPaneObservation("claude", progress).state, "busy");
});

test("cursorTuiBusy: 足元の「ctrl+c to stop」を入力欄の観測・coreの動作中判定・残存判定が同じ読みで使う", () => {
  assert.equal(cursorTuiBusy(SCREENS.cursor.busy), true);
  assert.equal(cursorTuiBusy(SCREENS.cursor.idle), false);
  assert.deepEqual(cursorPaneObservation(SCREENS.cursor.busy), { state: "busy", reason: "turn_running" });
  assert.equal(isAgentTuiBusy("cursor", SCREENS.cursor.busy), true);
  assert.equal(isAgentTuiBusy("cursor", SCREENS.cursor.idle), false);
});
