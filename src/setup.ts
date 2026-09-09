import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { prepareBackend, runSetupCommand, SetupError, type SetupRun } from "./setup-platform.js";
import { configureIntegrations, type Registration, type IntegrationResult } from "./setup-integrations.js";

export function globalRegistration(run: SetupRun = runSetupCommand): Registration {
  const root = run(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"]).trim();
  if (!isAbsolute(root) || /[\r\n]/u.test(root)) throw new SetupError("global_package_required", "npm global rootを確認できません");
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const installedRoot = join(root, "aiterm-mcp");
  if (realpathSync(installedRoot) !== realpathSync(packageRoot)) {
    throw new SetupError("global_package_required", "npm install -g aiterm-mcp後にaiterm-setupを実行してください。一時npm cacheやsource checkoutは登録しません");
  }
  return { command: process.execPath, args: [join(installedRoot, "dist", "index.js")] };
}

export async function verifySetupRuntime(registration: Registration): Promise<void> {
  const client = new Client({ name: "aiterm-setup", version: "1.0.0" });
  const transport = new StdioClientTransport({ ...registration, stderr: "pipe" });
  transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  const name = `setup-${randomUUID().slice(0, 12)}`;
  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await client.request({ method: "tools/call", params: { name: tool, arguments: args } }, CallToolResultSchema, { timeout: 25_000 });
    if (result.isError) throw new SetupError("runtime_probe_failed", `${tool}が失敗しました`);
    return result;
  };
  await client.connect(transport);
  try {
    await call("pty_open", { name, shell: process.platform === "win32" ? "pwsh" : "bash" });
    try {
      const text = process.platform === "win32" ? "Write-Output ('aiterm-' + 'ready')" : "printf 'aiterm-%s\\n' ready";
      await call("pty_send", { session_id: name, text, mark: true });
      const result = await call("pty_read", { session_id: name, wait: true, until: "aiterm-ready", timeout: 15, raw: true });
      const output = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
      if (!output.includes("aiterm-ready")) throw new SetupError("runtime_probe_failed", "端末の実行結果を確認できません");
    } finally { await call("pty_close", { session_id: name }); }
  } finally { await client.close(); }
}

type SetupStatus = "ready" | "unsupported" | "failed";
export type SetupResult = {
  schema: "aiterm.setup-result.v1";
  status: SetupStatus;
  backend: { kind: "psmux" | "tmux"; status: SetupStatus; reason_code?: string };
  integrations: Record<string, IntegrationResult>;
  reason_code?: string;
};

export async function runSetup(options: {
  registration?: () => Registration;
  prepare?: () => void;
  verify?: (registration: Registration) => Promise<void>;
  configure?: (home: string, registration: Registration) => Record<string, IntegrationResult>;
  progress?: (message: string) => void;
} = {}): Promise<SetupResult> {
  const result: SetupResult = { schema: "aiterm.setup-result.v1", status: "failed", backend: { kind: process.platform === "win32" ? "psmux" : "tmux", status: "failed" }, integrations: {} };
  const progress = options.progress ?? ((message: string) => process.stderr.write(`aiterm-setup: ${message}\n`));
  let stage = "backend";
  try {
    progress("端末の依存製品を確認します");
    (options.prepare ?? prepareBackend)();
    // Windowsのnpm.cmd実行に必要なPowerShell 7も、global root照会より先に導入する。
    stage = "global_package";
    const registration = (options.registration ?? globalRegistration)();
    stage = "backend";
    progress("MCP経由で端末を開き、実行結果と終了を確認します");
    await (options.verify ?? verifySetupRuntime)(registration);
    result.backend.status = "ready";
    stage = "integrations";
    progress("検出したAI clientのaiterm登録を更新して確認します");
    result.integrations = (options.configure ?? configureIntegrations)(process.env.HOME ?? homedir(), registration);
    if (Object.values(result.integrations).some((item) => item.status === "failed")) {
      result.reason_code = "integration_failed";
    } else if (!Object.values(result.integrations).some((item) => item.status === "ready")) {
      result.status = "unsupported";
      result.reason_code = "clients_not_detected";
    } else result.status = "ready";
  } catch (error) {
    const code = error instanceof SetupError ? error.code : `${stage}_failed`;
    result.status = code === "platform_unsupported" ? "unsupported" : "failed";
    result.reason_code = code;
    if (stage === "backend") result.backend = { ...result.backend, status: result.status, reason_code: code };
    progress(error instanceof Error ? error.message : String(error));
  }
  return result;
}
