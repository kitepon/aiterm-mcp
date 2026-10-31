#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { executionLaunchSchema } from "./execution-contract.js";
import { AitermError } from "./errors.js";
import { AGENT_IDLE_ENABLED } from "./agent-idle-clock.js";
import { serviceAgentIdleClock } from "./core.js";

export function parseIdleArgs(args: string[]): { session_id: string; launch_id: string; token?: string } {
  const fields: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--session", "--launch", "--clock"].includes(key) || value === undefined || fields[key] !== undefined)
      throw new Error("usage: aiterm idle-check --session <name> --launch <32hex> [--clock <32hex>]");
    fields[key] = value;
  }
  const launch = executionLaunchSchema.parse({ session_id: fields["--session"], launch_id: fields["--launch"] });
  if (fields["--clock"] !== undefined && !/^[a-f0-9]{32}$/.test(fields["--clock"])) throw new Error("invalid idle clock token");
  return { ...launch, ...(fields["--clock"] !== undefined ? { token: fields["--clock"] } : {}) };
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { token, ...launch } = parseIdleArgs(args);
    const result = AGENT_IDLE_ENABLED ? await serviceAgentIdleClock(launch, token)
      : { outcome: "skipped", reason: "lifecycle_not_enabled" };
    process.stdout.write(JSON.stringify(result) + "\n");
    return result.outcome === "unconfirmed" ? 2 : 0;
  } catch (error) {
    if (error instanceof AitermError && error.message.startsWith("AGENT_SEND_BUSY:")) return 75;
    process.stderr.write("aiterm: idle_check_unconfirmed\n"); return 2;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
