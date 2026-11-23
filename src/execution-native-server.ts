// Compatibility entry (0.70.109): the old name of native-entry.js, kept until the release that drops it
// (bellteam-boundary.md "汎用の入口"). Same server, hook modes and scope; the old argument list requires --execution-interrupt.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExecutionError } from "./execution-wire.js";
import { createNativeDeliveryServer, parseNativeEntryArguments, runNativeEntry, type NativeProvider } from "./native-entry.js";

export { createNativeDeliveryServer, type NativeProvider };
export function parseNativeExecutionArguments(args: string[]) {
  if (!args.includes("--execution-interrupt")) throw new ExecutionError("EXECUTION_INVALID");
  return parseNativeEntryArguments(args);
}
let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* library import */ }
if (entry) Promise.resolve().then(() => runNativeEntry(parseNativeExecutionArguments(process.argv.slice(2))))
  .catch(error => { console.error("aiterm private execution entry:", error instanceof ExecutionError ? error.code : "startup_failed"); process.exitCode = 1; });
