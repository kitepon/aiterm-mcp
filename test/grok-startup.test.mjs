import test from "node:test";
import assert from "node:assert/strict";
import { __testWaitAgentTuiReady } from "../dist/core.js";
import { buildGrokAgentCmd } from "../dist/harnesses/grok.js";

const trustScreen = "> </aiterm_subagent_context>'\nDo you trust the contents of this directory?\n/Users/example/project\nYes, proceed    y\nNo, quit        n\nGrok Build 1.0.13 [stable]";

test("Grokのhook実行結果が残っていてもidle入力欄は受付可能", async () => {
  for (const kind of ["grok", "composer"]) {
    const screen = "◆ session_start [hooks: 3/1]\nWorked for 4.4s stop [hooks: 1/1]\n│ ❯ │\nGrok 4.6 (high)";
    assert.equal((await __testWaitAgentTuiReady(kind, [screen], { timeoutMs: 0, stableSamples: 1 })).ready, true);
    assert.equal((await __testWaitAgentTuiReady(kind, [`${screen}\nWaiting for response… [stop]`], { timeoutMs: 0, stableSamples: 1 })).ready, false);
  }
});

test("Grokの信頼画面はscrollbackのshell promptがあっても入力受付とみなさない", async () => {
  for (const kind of ["grok", "composer"]) {
    assert.equal((await __testWaitAgentTuiReady(kind, [trustScreen], { timeoutMs: 0, stableSamples: 1 })).ready, false);
    const ready = `${trustScreen}\n│ ❯ ready │\nGrok 4.6 (high)`;
    assert.equal((await __testWaitAgentTuiReady(kind, [ready], { stableSamples: 1 })).ready, true);
  }
});

test("GrokとComposerのmanaged起動は公式のfolder trust指定とread-only制限を両立する", () => {
  for (const kind of ["grok", "composer"]) {
    const command = buildGrokAgentCmd(kind, "grok", null, null, null, { kind, write_scope: "read-only" });
    assert.match(command, /(?:^|\s)--trust(?:\s|$)/);
    assert.match(command, /--sandbox read-only/);
  }
});

const refusal = "warning: sandbox could not be applied: hook source path contains a symlink component (retargetable): /example/hooks/factory.json\nerror: could not apply the 'read-only' sandbox profile; see the warning above for the cause. Refusing to start with its protections missing.\nbash-3.2$";

test("GrokとComposerのsandbox起動拒否は待機せず原因付きエラーにする", async () => {
  for (const kind of ["grok", "composer"]) {
    for (const screen of [refusal, refusal.replace("\nerror:", "\n" + " ".repeat(57) + "error:")]) {
      await assert.rejects(
        __testWaitAgentTuiReady(kind, [screen], { timeoutMs: 0 }),
        (error) => error.code === 2
          && /GROK_SANDBOX_STARTUP_FAILED/.test(error.message)
          && /symlink component/.test(error.message)
          && /factory\.json/.test(error.message)
          && /送信していません/.test(error.message),
      );
    }
  }
});

test("sandbox文言の引用や警告だけでは起動拒否と判定しない", async () => {
  for (const screen of [
    "Grok Build\n❯ ready",
    "Grok Build\n❯ error: could not apply the 'read-only' sandbox profile",
    "warning: sandbox could not be applied: temporary warning\nGrok Build\n❯ ready",
  ]) {
    assert.equal((await __testWaitAgentTuiReady("grok", [screen], { stableSamples: 1 })).ready, true);
  }
});
