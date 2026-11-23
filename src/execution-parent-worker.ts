// The one thing of the old private worker that is still read: the scope (state root and multiplexer) of this machine's Aiterm,
// which BellTeam's aiterm-hooks.mjs puts into the execution seat's registration (bellteam-boundary.md). The worker itself is gone (0.70.104).
import { localScope } from "./native-entry.js";

export interface ExecutionWorkerScope {
  state_root: string; multiplexer: { kind: "socket" | "namespace"; key: string };
}
export const localParentWorkerRuntime: { scope(): ExecutionWorkerScope } = {
  scope: localScope,
};
