// Native effect gate. No live state or process I/O at import. The product mount
// supplies a request-scoped issue() backed by the shared metadata transaction.
import { AsyncLocalStorage } from "node:async_hooks";
import { executionLaunchSchema } from "./execution-contract.js";
import { ExecutionError } from "./execution-wire.js";

type EffectScope = { session: string; issue: () => void; nativeTargets: Set<string>; didIssue: boolean; failure?: ExecutionError };
const scopes = new AsyncLocalStorage<EffectScope>();
let required = false; // unmounted legacy product remains unchanged

export function requireExecutionEffectScope(value: boolean): void { required = value; }
export function withExecutionEffectScope<T>(session: string, issue: () => void, body: () => T): T {
  const target = executionLaunchSchema.shape.session_id.parse(session);
  const scope: EffectScope = { session: target, issue, nativeTargets: new Set(), didIssue: false };
  return scopes.run(scope, () => {
    let result: T;
    try { result = body(); } catch (error) { throw scope.failure ?? error; }
    if (result && typeof (result as { then?: unknown }).then === "function")
      return Promise.resolve(result).then(value => { if (scope.failure) throw scope.failure; return value; },
        error => { throw scope.failure ?? error; }) as T;
    if (scope.failure) throw scope.failure;
    return result;
  });
}
function refuse(scope: EffectScope, code: "EXECUTION_CONFLICT" | "EXECUTION_UNSUPPORTED"): never {
  scope.failure ??= new ExecutionError(code, scope.didIssue ? "possible" : "not_started");
  throw scope.failure;
}
function issueEffect(scope: EffectScope): void {
  if (scope.failure) throw scope.failure;
  try { scope.issue(); scope.didIssue = true; }
  catch (error) {
    scope.failure = error instanceof ExecutionError ? new ExecutionError(error.code, scope.didIssue ? "possible" : error.effect)
      : new ExecutionError("EXECUTION_UNCONFIRMED", scope.didIssue ? "possible" : "not_started");
    throw scope.failure;
  }
}
/** Called only by the expected-generation primitive after it captured and
 * rechecked this native identity. It never authorizes a human-name replacement.
 */
export function bindExecutionNativeTarget(session: string, nativeId: string): void {
  const scope = scopes.getStore();
  if (!scope) { if (required) throw new ExecutionError("EXECUTION_UNSUPPORTED"); return; }
  if (scope.failure) throw scope.failure;
  if (scope.session !== session || !/^\$\d+$/.test(nativeId)) refuse(scope, "EXECUTION_CONFLICT");
  scope.nativeTargets.add(nativeId);
}
export function beforeExecutionEffect(session: string, verify?: () => void): void {
  const scope = scopes.getStore();
  if (!scope) { if (required) throw new ExecutionError("EXECUTION_UNSUPPORTED"); return; }
  if (scope.session !== session) refuse(scope, "EXECUTION_CONFLICT");
  if (scope.failure) throw scope.failure;
  try { verify?.(); }
  catch (error) {
    scope.failure = error instanceof ExecutionError ? new ExecutionError(error.code, scope.didIssue ? "possible" : error.effect)
      : new ExecutionError("EXECUTION_UNCONFIRMED", scope.didIssue ? "possible" : "not_started");
    throw scope.failure;
  }
  issueEffect(scope);
}

const metadataOrRead = new Set(["list-sessions", "list-commands", "list-panes", "list-windows", "has-session", "display-message",
  "capture-pane", "show-environment", "show-options"]);
const targetCommands = new Set(["send-keys", "paste-buffer", "respawn-pane", "kill-session", "set-environment", "pipe-pane"]);
/** Inspect a native command queue before dispatch, without reading its payload.
 * Exact session selectors prevent natural disappearance from turning a name
 * into tmux's prefix-match for a different seat. Native IDs need a prior bind.
 */
export function guardTmuxExecution(input: string[]): string[] {
  const scope = scopes.getStore();
  if (!scope && !required) return input;
  const args = [...input];
  let effects = false;
  for (let start = 0; start < args.length;) {
    let end = args.indexOf(";", start);
    if (end < 0) end = args.length;
    const command = args[start];
    const targetedOption = command === "set-option" && args.slice(start + 1, end).includes("-t");
    if (command === "new-session" || targetCommands.has(command) || targetedOption) {
      if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      const flag = command === "new-session" ? "-s" : "-t";
      const at = args.findIndex((value, i) => i > start && i < end && value === flag);
      if (at < 0 || at + 1 >= end) refuse(scope, "EXECUTION_UNSUPPORTED");
      const raw = args[at + 1];
      if (/^\$\d+$/.test(raw)) {
        if (command === "new-session" || !scope.nativeTargets.has(raw)) refuse(scope, "EXECUTION_CONFLICT");
      } else {
        const parsed = /^=?([A-Za-z0-9_-]{1,64})(:(?:\d+(?:\.\d+)?)?)?$/.exec(raw);
        if (!parsed || parsed[1] !== scope.session) refuse(scope, "EXECUTION_CONFLICT");
        if (command !== "new-session") args[at + 1] = `=${scope.session}${parsed[2] ?? ":"}`;
      }
      effects = true;
    } else if (command === "load-buffer" || command === "delete-buffer" || command === "save-buffer" || command === "set-option") {
      if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      // Global options are only the existing new-session environment setup and
      // its cleanup. No global lifecycle option can slip through as metadata.
      if (command === "set-option" && !args.slice(start + 1, end).includes("update-environment")) refuse(scope, "EXECUTION_UNSUPPORTED");
      effects = true;
    } else if (command && !metadataOrRead.has(command)) {
      // No kill-server / run-shell / unknown command fallback through the gate.
      if (scope) refuse(scope, "EXECUTION_UNSUPPORTED");
      throw new ExecutionError("EXECUTION_UNSUPPORTED");
    }
    start = end + 1;
  }
  if (effects) issueEffect(scope!);
  return args;
}
