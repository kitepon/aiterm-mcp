import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const STATE_ROOT_URL = pathToFileURL(path.join(ROOT, "dist", "state-root.js")).href;
const CORE_URL = pathToFileURL(path.join(ROOT, "dist", "core.js")).href;
const hasPsmux = spawnSync("psmux", ["-V"], { encoding: "utf8" }).status === 0;
const windowsOnly = process.platform === "win32" ? undefined : "Windows native専用";

function isolatedEnv(foreignTemp, isolatedTmpdir) {
  return {
    ...process.env,
    TEMP: foreignTemp,
    TMP: foreignTemp,
    TMPDIR: isolatedTmpdir,
    XDG_RUNTIME_DIR: "",
  };
}

test("Windows state rootはpsmux namespaceと同じTMPDIRを優先する", { skip: windowsOnly }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-state-root-"));
  const foreign = path.join(root, "foreign");
  const isolated = path.join(root, "isolated");
  fs.mkdirSync(foreign);
  fs.mkdirSync(isolated);
  try {
    const script = `import { runtimeStateBase } from ${JSON.stringify(STATE_ROOT_URL)}; process.stdout.write(runtimeStateBase());`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...isolatedEnv(foreign, isolated), XDG_RUNTIME_DIR: foreign },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, isolated);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "Windows TMPDIR隔離processのkillAllはforeign TEMPのmanaged metadataを消さない",
  { skip: windowsOnly ?? (hasPsmux ? undefined : "psmux未導入") },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-state-killall-"));
    const foreign = path.join(root, "foreign");
    const isolated = path.join(root, "isolated");
    const foreignAgents = path.join(foreign, "aiterm-mcp-0", "agents");
    const sentinel = path.join(foreignAgents, "live-product.0123456789abcdef0123456789abcdef.agent.json");
    fs.mkdirSync(foreignAgents, { recursive: true });
    fs.mkdirSync(isolated);
    fs.writeFileSync(sentinel, "foreign managed metadata\n");
    try {
      const script = [
        `import * as core from ${JSON.stringify(CORE_URL)};`,
        `import { stateRoot } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "dist", "agent-shared.js")).href)};`,
        `core.openSession("isolated_killall");`,
        `core.killAll();`,
        `process.stdout.write(stateRoot());`,
      ].join("\n");
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        env: isolatedEnv(foreign, isolated),
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, path.join(isolated, "aiterm-mcp-0"));
      assert.equal(fs.readFileSync(sentinel, "utf8"), "foreign managed metadata\n");
      const isolatedAgents = path.join(isolated, "aiterm-mcp-0", "agents");
      assert.deepEqual(fs.existsSync(isolatedAgents) ? fs.readdirSync(isolatedAgents) : [], []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
