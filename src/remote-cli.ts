// `aiterm-remote` (a532b4): the neutral commands for a pinned `remote.ssh` target. Same implementations as the terminal commands of
// `aiterm-remote-terminal`; the machine is given as `--remote '<json>'` (host, user, port, ssh, id: no secret) or `--id`, the password on stdin.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main } from "./remote-terminal-cli.js";

const NAMES: Record<string, string> = { "install-key": "authorize-key", "install-aiterm": "provision", "forward-keeper": "forward-keeper", export: "export" };

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* imported */ }
if (entry) {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !NAMES[command]) { process.stderr.write("usage: aiterm-remote install-key|install-aiterm|forward-keeper|export --remote '<json>' | --id <id>\n"); process.exit(64); }
  main([NAMES[command]!, ...rest]);
}
