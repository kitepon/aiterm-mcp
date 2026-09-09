import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "aiterm-observe-"));
process.env.TMPDIR = directory;
process.env.AITERM_TEST_OWNER = "観測担当";
const core = await import("../dist/core.js");
after(() => { core.killAll(); rmSync(directory, { recursive: true, force: true }); });

test("通常PTYの自己識別と明示キーだけの環境照会", async () => {
  const name = "ordinary";
  core.openSession(name, process.platform === "win32" ? "pwsh" : "bash", ["AITERM_TEST_OWNER"]);
  const list = core.listSessionsResult(["AITERM_SESSION_ID", "AITERM_TEST_OWNER", "AITERM_UNSET_TEST"]);
  assert.deepEqual(list.sessions[0].environment, {
    AITERM_SESSION_ID: name, AITERM_TEST_OWNER: "観測担当", AITERM_UNSET_TEST: null,
  });
  const before = core.observeSession(name);
  assert.equal(before.exists, true);
  assert.equal(before.pane_alive, true);
  assert.ok(before.process_identity.pid > 0);
  assert.equal(before.activity.output_changed, null);
  const command = process.platform === "win32" ? "Write-Output ('自己識別=' + $env:AITERM_SESSION_ID)" : "printf '自己識別=%s\\n' \"$AITERM_SESSION_ID\"";
  core.send(name, command, { mark: true });
  const output = await core.readOutput(name, { wait: true, timeout: 5 });
  assert.ok(output.includes("自己識別=ordinary"), output);
  const observed = core.observeSession(name, before.activity.cursor);
  assert.equal(observed.activity.output_changed, true);
  assert.ok(observed.activity.cpu_delta_seconds >= 0);
  assert.equal("command" in observed.process_identity, false);
  core.closeSession(name);
  assert.equal(core.observeSession(name).state, "missing");
  assert.deepEqual(core.listSessionsResult().sessions, []);
});
