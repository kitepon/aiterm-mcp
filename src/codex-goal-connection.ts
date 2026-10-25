// Official native control rendezvous. Resolve its protected socket alias;
// never create a directory, socket, worker, or daemon when one is missing.
import fs from "node:fs";
import path from "node:path";
import { verifyRelaySocket } from "./codex-relay-config.js";
import { AgentGoalConnectionError } from "./agent-goal.js";

export function nativeCodexGoalSocket(home: string): string {
  if (process.platform === "win32") throw new AgentGoalConnectionError("unsupported", "windows_native_goal_transport_not_implemented");
  if (!path.isAbsolute(home)) throw new Error("Codex home must be absolute");
  const directory = path.join(home, "app-server-control");
  const parent = fs.lstatSync(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o022) !== 0)
    throw new Error("Unverified native control directory");
  const advertised = path.join(directory, "app-server-control.sock");
  const entry = fs.lstatSync(advertised);
  if (entry.uid !== process.getuid?.() || (!entry.isSymbolicLink() && !entry.isSocket()))
    throw new Error("Unverified native control socket");
  const socket = fs.realpathSync(advertised);
  verifyRelaySocket(socket);
  return socket;
}
