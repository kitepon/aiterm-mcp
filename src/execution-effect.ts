// Native effect gate. No live state or process I/O at import. The product mount
// supplies a request-scoped issue() backed by the shared metadata transaction.
import { AsyncLocalStorage } from "node:async_hooks";
import { executionLaunchSchema, executionPointSchema, type ExecutionLaunch, type ExecutionPoint } from "./execution-contract.js";
import { isDeepStrictEqual } from "node:util";
import { ExecutionError } from "./execution-wire.js";
import type { ExecutionNativeServer, ExecutionNativeBinding } from "./execution-close.js";

export interface ExecutionCreationBindings {
  prepare(): ExecutionNativeServer;
  verifyServer(): void;
  native(session: string, nativeId: string, serverPid: number): void;
  launch(launch: ExecutionLaunch): void;
}
export type ExecutionPreparation = <T>(body: () => T) => T;
type EffectScope = { session: string; issue: () => void; nativeTargets: Set<string>; didIssue: boolean; failure?: ExecutionError;
  managementCloseTarget?: string;
  prepare?: ExecutionPreparation; preparing?: boolean;
  sendBoundary?: ExecutionPoint;
  interrupt?: { native_id: string; key: "Escape" | "C-c"; sent: boolean; finished: boolean };
  creation?: ExecutionCreationBindings; creationPrepared?: boolean; creationServer?: ExecutionNativeServer; createdNative?: string };
const scopes = new AsyncLocalStorage<EffectScope>();
let required = false; // unmounted legacy product remains unchanged

export function requireExecutionEffectScope(value: boolean): void { required = value; }
/** Check context without marking preparation as issued. Actual native effects
 * still go through their synchronous source/target/slot gate.
 */
export function assertExecutionContext(session: string | null | undefined): void {
  const scope = scopes.getStore();
  if (!scope && !required) return;
  if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (scope.failure) throw scope.failure;
  if (scope.interrupt?.finished) refuse(scope, "EXECUTION_CONFLICT");
  if (typeof session !== "string") refuse(scope, "EXECUTION_UNSUPPORTED");
  if (scope.session !== session) refuse(scope, "EXECUTION_CONFLICT");
  if (scope.prepare && !scope.preparing) prepareInScope(scope, () => undefined);
}
/** A synchronous metadata action under the same short admission transaction.
 * It neither acquires a native issuance slot nor permits native effects.
 */
export function withExecutionPreparation<T>(session: string, body: () => T): T {
  const scope = scopes.getStore();
  if (!scope && !required) return body();
  if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (scope.failure) throw scope.failure;
  if (scope.session !== session) refuse(scope, "EXECUTION_CONFLICT");
  return prepareInScope(scope, body);
}
/** Product core's existing before_send boundary in this request only. This is
 * a pre-send reference, never native input acceptance, source attribution or a
 * new invocation. Unmounted legacy core remains inert. A model/tool argument
 * or structured result cannot populate this private request-local slot.
 */
export function captureExecutionSendBoundary(input: ExecutionPoint): void {
  const scope = scopes.getStore();
  if (!scope && !required) return;
  if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const point = executionPointSchema.parse(input);
  if (scope.interrupt || !point.boundary) refuse(scope, "EXECUTION_UNSUPPORTED");
  withExecutionPreparation(point.launch.session_id, () => {
    if (scope.sendBoundary && !isDeepStrictEqual(scope.sendBoundary, point)) refuse(scope, "EXECUTION_CONFLICT");
    scope.sendBoundary = point;
  });
}
export function readExecutionSendBoundary(session: string): ExecutionPoint | null {
  const scope = scopes.getStore();
  if (!scope?.sendBoundary) return null;
  // Immutable history after the native body returned, not fresh admission.
  // A source that ended meanwhile must not poison a genuine action receipt.
  // Target/current-state checks still occur in the dispatch/service binding.
  if (scope.session !== session) throw new ExecutionError("EXECUTION_CONFLICT");
  return executionPointSchema.parse(scope.sendBoundary);
}
function prepareInScope<T>(scope: EffectScope, body: () => T): T {
  const synchronous = (): T => {
    const result = body();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      // This API cannot hold its synchronous transaction over an await. Keep
      // the rejected caller frame poisoned and observe a malformed thenable's
      // rejection without making an unhandled process error.
      void Promise.resolve(result).catch(() => undefined);
      refuse(scope, "EXECUTION_UNSUPPORTED");
    }
    return result;
  };
  try {
    if (scope.preparing) return synchronous(); // already inside this exact transaction
    if (!scope.prepare) refuse(scope, "EXECUTION_UNSUPPORTED");
    return scope.prepare(() => {
      scope.preparing = true;
      try { return synchronous(); } finally { scope.preparing = false; }
    });
  } catch (error) {
    scope.failure ??= error instanceof ExecutionError ? new ExecutionError(error.code, scope.didIssue ? "possible" : error.effect)
      : new ExecutionError("EXECUTION_UNCONFIRMED", scope.didIssue ? "possible" : "not_started");
    throw scope.failure;
  }
}
export function withExecutionEffectScope<T>(session: string, issue: () => void, body: () => T,
  creation?: ExecutionCreationBindings, prepare?: ExecutionPreparation): T {
  const enclosing = scopes.getStore();
  if (enclosing?.interrupt) refuse(enclosing, "EXECUTION_UNSUPPORTED");
  const target = executionLaunchSchema.shape.session_id.parse(session);
  const scope: EffectScope = { session: target, issue, prepare, nativeTargets: new Set(), didIssue: false,
    ...(creation ? { creation: { ...creation } } : {}) };
  return runEffectScope(scope, body);
}
/** Private stop-owned synchronous frame over the existing native gate. It
 * creates no invocation/edge/request. The ordinary stop path supplies only
 * its target check, without a durable journal or completion/fence prerequisite.
 */
export function withExecutionInterruptEffectScope<T>(session: string, nativeId: string, issue: () => void, body: () => T, key: "Escape" | "C-c" = "Escape"): T {
  const enclosing = scopes.getStore();
  if (enclosing) refuse(enclosing, "EXECUTION_UNSUPPORTED");
  const target = executionLaunchSchema.shape.session_id.parse(session);
  if (!/^\$\d+$/.test(nativeId)) throw new ExecutionError("EXECUTION_INVALID");
  const interrupt = { native_id: nativeId, key, sent: false, finished: false };
  const scope: EffectScope = { session: target, issue: () => {
    const result: unknown = issue();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      void Promise.resolve(result).catch(() => undefined);
      refuse(scope, "EXECUTION_UNSUPPORTED");
    }
  }, nativeTargets: new Set([nativeId]), didIssue: false, interrupt };
  try {
    return runEffectScope(scope, () => {
      const result = body();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        void Promise.resolve(result).catch(() => undefined);
        refuse(scope, "EXECUTION_UNSUPPORTED");
      }
      return result;
    });
  } finally { interrupt.finished = true; }
}
function runEffectScope<T>(scope: EffectScope, body: () => T): T {
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
  if (scope.preparing) refuse(scope, "EXECUTION_UNSUPPORTED");
  try { if (scope.creationPrepared && !scope.createdNative) scope.creation!.verifyServer(); scope.issue(); scope.didIssue = true; }
  catch (error) {
    scope.failure = error instanceof ExecutionError ? new ExecutionError(error.code, scope.didIssue ? "possible" : error.effect)
      : new ExecutionError("EXECUTION_UNCONFIRMED", scope.didIssue ? "possible" : "not_started");
    throw scope.failure;
  }
}
export function hasExecutionCreationScope(): boolean { return !!scopes.getStore()?.creation; }
export function prepareExecutionCreation(): void {
  const scope = scopes.getStore();
  if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (scope.failure) throw scope.failure;
  if (!scope.creation || scope.creationPrepared || scope.didIssue) refuse(scope, "EXECUTION_UNSUPPORTED");
  try {
    const server = scope.creation.prepare();
    if (!Number.isSafeInteger(server?.pid) || server.pid < 1 || typeof server.started_identity !== "string" || !server.started_identity)
      throw new ExecutionError("EXECUTION_UNSUPPORTED");
    scope.creationServer = { ...server }; scope.creationPrepared = true;
  }
  catch (error) {
    scope.failure = new ExecutionError(error instanceof ExecutionError ? error.code : "EXECUTION_UNCONFIRMED", "not_started");
    throw scope.failure;
  }
}
/** Private core metadata stamp, derived only from this frame's actual create
 * receipt and pre-existing native server proof. Not a tool input or lookup.
 */
export function executionCreatedNativeBinding(session: string): ExecutionNativeBinding {
  const scope = scopes.getStore();
  if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (scope.failure) throw scope.failure;
  if (scope.session !== session || !scope.createdNative || !scope.creationServer) refuse(scope, "EXECUTION_UNSUPPORTED");
  return { schema: "aiterm.execution-native.v1", native_id: scope.createdNative, server: { ...scope.creationServer } };
}
// This receipt comes directly from new-session -P -F, never from a later
// same-name list/display lookup. It contains no argv, environment or payload.
export function captureExecutionCreatedNative(receipt: string): void {
  const scope = scopes.getStore();
  if (!scope) { if (required) throw new ExecutionError("EXECUTION_UNSUPPORTED"); return; }
  if (scope.failure) throw scope.failure;
  if (!scope.creation || !scope.creationPrepared || !scope.didIssue) refuse(scope, "EXECUTION_UNSUPPORTED");
  const parsed = /^(\$\d+)\t([A-Za-z0-9_-]{1,64})\t([1-9][0-9]*)\r?\n?$/.exec(receipt);
  if (!parsed || parsed[2] !== scope.session || (scope.createdNative && scope.createdNative !== parsed[1]))
    refuse(scope, "EXECUTION_CONFLICT");
  try { scope.creation.native(scope.session, parsed[1], Number(parsed[3])); }
  catch (error) {
    scope.failure = new ExecutionError(error instanceof ExecutionError ? error.code : "EXECUTION_UNCONFIRMED", "possible");
    throw scope.failure;
  }
  scope.createdNative = parsed[1]; scope.nativeTargets.add(parsed[1]);
}
export function bindExecutionCreatedLaunch(input: ExecutionLaunch): void {
  const scope = scopes.getStore();
  if (!scope) { if (required) throw new ExecutionError("EXECUTION_UNSUPPORTED"); return; }
  if (scope.failure) throw scope.failure;
  if (!scope.creation || !scope.createdNative) refuse(scope, "EXECUTION_UNSUPPORTED");
  const launch = executionLaunchSchema.parse(input);
  if (launch.session_id !== scope.session) refuse(scope, "EXECUTION_CONFLICT");
  try { scope.creation.launch(launch); }
  catch (error) {
    scope.failure = new ExecutionError(error instanceof ExecutionError ? error.code : "EXECUTION_UNCONFIRMED", "possible");
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
  if (scope.interrupt && (scope.interrupt.finished || scope.interrupt.native_id !== nativeId)) refuse(scope, "EXECUTION_CONFLICT");
  scope.nativeTargets.add(nativeId);
}
/** Bound only by the management-close wrapper, never tool arguments. The
 * ordinary core close/cleanup keeps using its session name; native commands
 * are pinned to the independently captured native ID through the same gate.
 */
export function bindExecutionManagementCloseTarget(session: string, nativeId: string): void {
  const scope = scopes.getStore();
  if (!scope || scope.session !== session || scope.didIssue || scope.creation || scope.interrupt || !/^\$\d+$/.test(nativeId))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  scope.managementCloseTarget = nativeId; scope.nativeTargets.add(nativeId);
}
export function executionManagementCloseTarget(session: string): string | undefined {
  const scope = scopes.getStore();
  return scope?.session === session ? scope.managementCloseTarget : undefined;
}
export function beforeExecutionEffect(session: string, verify?: () => void): void {
  const scope = scopes.getStore();
  if (!scope) { if (required) throw new ExecutionError("EXECUTION_UNSUPPORTED"); return; }
  if (scope.session !== session) refuse(scope, "EXECUTION_CONFLICT");
  if (scope.interrupt?.finished) refuse(scope, "EXECUTION_CONFLICT");
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
  if (scope?.interrupt) {
    const frame = scope.interrupt;
    if (scope.failure) throw scope.failure;
    if (frame.finished) refuse(scope, "EXECUTION_CONFLICT");
    if (args[0] === "send-keys") {
      if (args.length !== 4 || args[1] !== "-t" || args[2] !== frame.native_id || args[3] !== frame.key)
        refuse(scope, "EXECUTION_UNSUPPORTED");
      if (frame.sent) refuse(scope, "EXECUTION_CONFLICT");
      frame.sent = true; // a failed admission cannot be retried in this frame
      issueEffect(scope);
    } else {
      // Observation commands may precede the key; command queues cannot hide
      // a second native effect, payload input or management fallback.
      for (let start = 0; start < args.length;) {
        if (!metadataOrRead.has(args[start])) refuse(scope, "EXECUTION_UNSUPPORTED");
        const end = args.indexOf(";", start);
        start = end < 0 ? args.length : end + 1;
      }
    }
    return args;
  }
  let effects = false;
  for (let start = 0; start < args.length;) {
    let end = args.indexOf(";", start);
    if (end < 0) end = args.length;
    const command = args[start];
    const targetedOption = command === "set-option" && args.slice(start + 1, end).includes("-t");
    if (command === "new-session" || targetCommands.has(command) || targetedOption) {
      if (!scope) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (command === "new-session" && scope.creation && !scope.creationPrepared) refuse(scope, "EXECUTION_UNSUPPORTED");
      const flag = command === "new-session" ? "-s" : "-t";
      const at = args.findIndex((value, i) => i > start && i < end && value === flag);
      if (at < 0 || at + 1 >= end) refuse(scope, "EXECUTION_UNSUPPORTED");
      const raw = args[at + 1];
      if (command === "new-session" && scope.createdNative) refuse(scope, "EXECUTION_CONFLICT");
      const native = /^(\$\d+)(:(?:\d+(?:\.\d+)?)?)?$/.exec(raw);
      if (native) {
        if (command === "new-session" || !scope.nativeTargets.has(native[1])) refuse(scope, "EXECUTION_CONFLICT");
      } else {
        const parsed = /^=?([A-Za-z0-9_-]{1,64})(:(?:\d+(?:\.\d+)?)?)?$/.exec(raw);
        if (!parsed || parsed[1] !== scope.session) refuse(scope, "EXECUTION_CONFLICT");
        if (command !== "new-session") args[at + 1] = `${scope.managementCloseTarget ?? scope.createdNative ?? "=" + scope.session}${parsed[2] ?? ":"}`;
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
    } else if (scope?.createdNative) {
      const at = args.findIndex((value, i) => i > start && i < end && value === "-t");
      if (at >= 0 && at + 1 < end) {
        const target = /^=?([A-Za-z0-9_-]{1,64})(:(?:\d+(?:\.\d+)?)?)?$/.exec(args[at + 1]);
        if (target?.[1] === scope.session) args[at + 1] = `${scope.createdNative}${target[2] ?? ":"}`;
      }
    }
    start = end + 1;
  }
  if (effects) issueEffect(scope!);
  return args;
}
