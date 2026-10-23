// Metadata/admission service with injected runtime. It never owns a payload or
// retries a launch/send/close. The core/MCP adapter is a separate integration.
import { z } from "zod";
import { assessExecutionSource, planCascadeStop, unfinishedExecutionRelations, cascadeStopRequestSchema, cascadeStopResultSchema,
  cascadeInterruptRequestSchema, cascadeInterruptResultSchema,
  executionPointSchema, type ExecutionLaunch, type ExecutionPoint, type ExecutionRequest,
  executionLaunchSchema,
  type ExecutionSourceEvidence } from "./execution-contract.js";
import { executionActionSchema, executionRecordSchema, executionRefMetaSchema, executionRootsRequestSchema, executionRootsResultSchema, ExecutionError,
  type ExecutionAction, type ExecutionRecord, type ExecutionRegister, type ExecutionFinish, type ExecutionReconcileLaunch } from "./execution-wire.js";
import type { ExecutionTransportSource } from "./execution-wire.js";
import type { ExecutionState, ExecutionStore } from "./execution-store.js";
import { withExecutionEffectScope, withExecutionInterruptEffectScope, type ExecutionPreparation } from "./execution-effect.js";
import type { ExecutionNativeServer } from "./execution-close.js";
import { nativeInterruptionObservationSchema, interruptionIdentity, interruptionBlocksLaunch, interruptionBlocksRequest,
  interruptionSlots, assertInterruptionSource, sameInterruptionRowRun } from "./execution-interruption.js";
import { interruptionKeyReference } from "./execution-interruption.js";
import { isDeepStrictEqual } from "node:util";
import { executionActorSchema, type ExecutionActor } from "./execution-inventory.js";
import { createdLaunchObservationSchema, exitedCreatedLaunchObservationSchema } from "./execution-launch-recovery.js";
import { executionCheckpoint } from "./execution-checkpoint.js";

type Observation = { state: "absent" } | { state: "unknown" } | { state: "present"; launch: ExecutionLaunch | null };
export interface ExecutionRuntime {
  sourceEvidence(input: ExecutionRegister, context?: ExecutionTransportSource): Promise<ExecutionSourceEvidence>;
  observe(sessionId: string): Promise<Observation>;
  // Generation-only synchronous read at the first native effect. Its absence
  // makes deferred native admission unsupported, never an async fallback.
  observeSync?(sessionId: string): Observation;
  nativeSessionSync?(sessionId: string): ({ state: "present"; native_id: string } | { state: "absent" | "unknown" }) & { server?: ExecutionNativeServer | null };
  observeCreatedLaunchSync?(target: ExecutionLaunch): unknown;
  observeExitedCreatedLaunchSync?(target: ExecutionLaunch): unknown;
  completion(point: ExecutionPoint): Promise<{ state: "completed" | "interrupted" | "unknown"; fence: "closed" | "unknown" }>;
  close(expected: ExecutionLaunch): Promise<void>;
  // Only adapters covering the execution's actual admission paths may return
  // complete. Old/untracked/remote paths must not be inferred from graph shape.
  coverage(roots: ExecutionLaunch[], sessionIdHint?: string): Promise<"complete" | "incomplete">;
  // Private native adapter only. No tool args/claim echo, asynchronous fallback
  // or generic completion/closed observation can provide this evidence.
  interruptionSync?(point: ExecutionPoint): unknown;
  // Private current-run selection and key transport. These are deliberately
  // absent from the default runtime and the public stop control.
  selectInterruptionSync?(launch: ExecutionLaunch, candidates?: readonly ExecutionPoint[]): unknown;
  interruptKeySync?(point: ExecutionPoint): unknown;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const key = (value: unknown): string => JSON.stringify(value);
const stopped = (state: ExecutionState, launch: ExecutionLaunch | null | undefined): boolean =>
  !!launch && (state.stopping.some(value => same(value, launch)) || interruptionBlocksLaunch(state, launch));
const openParentEffect = (state: ExecutionState, request: ExecutionRequest): boolean => request.kind === "delivery"
  && state.parent_effects.some(effect => effect.delivery_id === request.delivery_id && effect.state !== "accepted"
    && state.parent_deliveries.some(binding => binding.delivery_id === effect.delivery_id
      && binding.parent.launch.session_id === request.target_session_id));
// Local child done cannot close the whole invocation's admission fence while
// the existing before_send companion can still issue its parent return. Read
// only existing refs/phases; queue acceptance and an elapsed time are not done.
const pendingParentReturn = (state: ExecutionState, request: ExecutionRequest): boolean =>
  state.parent_deliveries.some(binding => {
    if (!same(binding.request, request)) return false;
    if (state.parent_effects.some(effect => effect.delivery_id === binding.delivery_id && effect.state !== "accepted")) return true;
    const returning = state.records.find(record => record.reservation.request.kind === "delivery"
      && record.reservation.request.delivery_id === binding.delivery_id
      && record.reservation.request.target_session_id === binding.parent.launch.session_id);
    if (!returning || !same(returning.relation.source?.launch, binding.child.launch)) return true;
    if (returning.relation.phase === "unsent" && returning.operations.send === "not_sent") return false;
    return !same(returning.relation.target?.launch, binding.parent.launch)
      || returning.relation.target_fence !== "closed"
      || !["completed", "interrupted"].includes(returning.relation.completion);
  });
function find(state: ExecutionState, request: ExecutionRequest): ExecutionRecord {
  const record = state.records.find(value => same(value.reservation.request, request));
  if (!record) throw new ExecutionError("EXECUTION_NOT_FOUND");
  return record;
}
const managementClose = (request: ExecutionRequest): boolean => request.kind === "mcp" && request.tool === "pty_close";
/** A returned unknown send, or an empty exited created launch with additional
 * native proof, may be displaced by explicit close of that exact generation.
 * Issued work and other generations remain blockers; failed records are kept.
 */
function recoverableCloseSlots(state: ExecutionState, request: ExecutionRequest, session: string, expected: string | null) {
  if (!managementClose(request) || expected === null) return [];
  return state.slots.filter(slot => {
    if (slot.session_id !== session || slot.expected_launch_id !== expected || !["send", "launch"].includes(slot.stage)
      || slot.state !== "unknown" || !slot.request || same(slot.request, request)) return false;
    const original = state.records.find(record => same(record.reservation.request, slot.request));
    if (slot.stage === "launch") return !!original && !!slot.created_native_id && !!slot.created_server
      && (slot.request.kind !== "mcp" || slot.request.tool === "agent_launch")
      && original.operations.launch === "unknown" && original.operations.send === "not_issued"
      && original.relation.phase === "submitted_unknown" && original.relation.completion === "unknown"
      && original.relation.lifecycle === "tracking" && !openParentEffect(state, slot.request)
      && original.relation.target?.boundary === null
      && same(original.relation.target.launch, { session_id: session, launch_id: expected });
    if (slot.request.kind === "mcp" && !["pty_send", "claude_turn.issue"].includes(slot.request.tool)) return false;
    return original?.operations.send === "unknown" && !["issued", "unknown"].includes(original.operations.launch)
      && original.relation.phase === "submitted_unknown" && original.relation.completion === "unknown"
      && same(original.relation.target?.launch, { session_id: session, launch_id: expected });
  });
}
function targetBlocked(state: ExecutionState, request: ExecutionRequest, session: string, expected: string | null): boolean {
  const recoverable = recoverableCloseSlots(state, request, session, expected);
  return state.slots.some(slot => slot.session_id === session && !recoverable.includes(slot));
}
function view(state: ExecutionState, record: ExecutionRecord): ExecutionRecord {
  return executionRecordSchema.parse({ ...record,
    stopping: record.stopping || stopped(state, record.relation.source?.launch) || stopped(state, record.relation.target?.launch)
      || interruptionBlocksRequest(state, record.reservation.request) });
}
/** An admitted ordinary input to the caller does not replace its generation
 * or revoke its outstanding outgoing RPC. Blocking that input's issued slot
 * would make reciprocal sends poison each other between paste and Enter.
 * Unknown operations and management/creation slots are never exempted.
 */
function blocksSource(state: ExecutionState, source: ExecutionLaunch | null, seatHint: string | null,
  own?: ExecutionState["slots"][number]): boolean {
  return state.slots.some(slot => {
    if (slot === own || slot.session_id !== (source?.session_id ?? seatHint)) return false;
    if (!source || slot.stage !== "send" || slot.state !== "issued" || slot.expected_launch_id !== source.launch_id || !slot.request
      || slot.request.kind === "mcp" && !["pty_send", "claude_turn.issue"].includes(slot.request.tool)) return true;
    const incoming = state.records.find(value => same(value.reservation.request, slot.request));
    return incoming?.operations.send !== "issued" || ["issued", "unknown"].includes(incoming.operations.launch)
      || incoming.relation.phase !== "submitted_unknown" || incoming.relation.completion !== "open"
      || incoming.relation.lifecycle !== "tracking" || !same(incoming.relation.target?.launch, source);
  });
}
function sourceAdmission(state: ExecutionState, point: ExecutionPoint | null, seatHint: string | null): void {
  assertInterruptionSource(state, point, seatHint);
  if (stopped(state, point?.launch)) throw new ExecutionError("EXECUTION_STOPPING");
  if (blocksSource(state, point?.launch ?? null, seatHint))
    throw new ExecutionError("EXECUTION_UNCONFIRMED");
  if (!point && seatHint && state.stopping.some(value => value.session_id === seatHint))
    throw new ExecutionError("EXECUTION_UNCONFIRMED");
}
// Request-only cancellation can be proved without guessing a current native
// run. Match recorded generations, never just a source hint or reusable name.
function interruptionRelatedRecords(state: ExecutionState, launches: readonly ExecutionLaunch[]): ExecutionRecord[] {
  const active = new Set(unfinishedExecutionRelations(state.records.map(record => record.relation)).map(relation => key(relation.request)));
  return state.records.filter(record => record.relation.lifecycle !== "retired" && record.relation.phase !== "unsent"
    && (active.has(key(record.reservation.request)) || record.relation.phase === "reserved"
      || [record.operations.launch, record.operations.send].some(stage => ["preparing", "issued", "unknown"].includes(stage)))
    && launches.some(launch => isDeepStrictEqual(record.relation.source?.launch, launch)
      || isDeepStrictEqual(record.relation.target?.launch, launch)
      || (record.reservation.target.session_id === launch.session_id
        && record.reservation.target.expected_launch_id === launch.launch_id)));
}
function cancelUnissuedInterruptionActions(records: ExecutionRecord[]): void {
  for (const record of records) {
    // Existing per-record flag is a sticky old-request tombstone, never a
    // launch barrier or evidence that native processing stopped. Preserve it
    // even if native selection is unavailable or a genuine receipt is late.
    record.stopping = true;
    // This says only that these existing stages cannot start. Native-issued,
    // accepted and unknown stages/receipts keep their original meaning.
    for (const stage of ["launch", "send"] as const)
      if (["not_issued", "preparing"].includes(record.operations[stage])) record.operations[stage] = "not_sent";
    if (record.operations.launch === "not_sent" && record.operations.send === "not_sent") record.relation.phase = "unsent";
  }
}
function retireSettledBranches(state: ExecutionState): void {
  // A reobserved completion ends this recorded call, without waiting for all
  // native actors to terminate. Known pending return/issued work still holds it.
  for (const record of state.records) if (record.relation.completion === "completed"
    && ![record.operations.launch, record.operations.send].some(stage => stage === "issued" || stage === "unknown")
    && !state.slots.some(slot => slot.request && same(slot.request, record.reservation.request))
    && !openParentEffect(state, record.reservation.request)
    && !pendingParentReturn(state, record.reservation.request)) record.relation.target_fence = "closed";
  const roots = [...new Map(state.records.flatMap(record => record.relation.source ? [record.relation.source.launch] : [])
    .map(launch => [key(launch), launch])).values()];
  const retained = new Set(roots.length ? planCascadeStop(roots, state.records.map(record => record.relation)).retained.map(key) : []);
  for (const record of state.records) {
    const relation = record.relation;
    if (record.operations.launch === "issued" || record.operations.send === "issued"
      || record.operations.launch === "unknown" || record.operations.send === "unknown") continue;
    if (state.slots.some(slot => slot.request && same(slot.request, record.reservation.request))) continue;
    if (openParentEffect(state, record.reservation.request)) continue;
    if (relation.phase === "unsent" || (relation.source && relation.target_fence === "closed"
      && (relation.completion === "completed" || relation.completion === "interrupted") && !retained.has(key(relation.request))))
      relation.lifecycle = "retired";
  }
}

export class ExecutionService {
  constructor(private readonly store: ExecutionStore, private readonly runtime: ExecutionRuntime,
    private readonly drainTimeoutMs = 2000) {}

  private interruptObservation(point: ExecutionPoint) {
    if (!this.runtime.interruptionSync || !this.runtime.observeSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const result = this.runtime.interruptionSync(executionPointSchema.parse(point));
    if (result && typeof (result as { then?: unknown }).then === "function") {
      void Promise.resolve(result).catch(() => undefined);
      throw new ExecutionError("EXECUTION_UNSUPPORTED");
    }
    const observation = nativeInterruptionObservationSchema.safeParse(result);
    if (!observation.success || !isDeepStrictEqual(observation.data.run, point)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const current = this.runtime.observeSync(point.launch.session_id);
    if (current.state !== "present" || !isDeepStrictEqual(current.launch, point.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
    return observation.data;
  }

  private assertManagedInterruptionPoint(state: ExecutionState, run: ExecutionPoint): void {
    const targets = state.records.filter(record => record.relation.lifecycle !== "retired" && record.relation.phase !== "unsent"
      && ["open", "unknown"].includes(record.relation.completion) && isDeepStrictEqual(record.relation.target?.launch, run.launch))
      .map(record => record.relation.target!);
    if (!targets.some(point => isDeepStrictEqual(point, run))) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  }

  /** Private per-run interruption admission. The public stop remains read-only
   * until the real native fence/endpoint adapter and cascade controller exist.
   * Snapshot old refs under the same shared lock before allowing any key.
   */
  async beginInterruption(input: ExecutionPoint) {
    const run = executionPointSchema.parse(input);
    if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return this.store.transaction(state => {
      const previous = state.interruptions.find(row => sameInterruptionRowRun(row.before, run));
      if (previous) return previous; // lookup never reissues a native key
      if (state.interruptions.some(row => isDeepStrictEqual(row.before.run.launch, run.launch)
        && !["settled", "not_sent"].includes(row.phase))) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      const before = this.interruptObservation(run);
      if (!interruptionKeyReference(before)) throw new ExecutionError("EXECUTION_CONFLICT");
      if (before.harness === "claude-code") this.assertManagedInterruptionPoint(state, run);
      const related = interruptionRelatedRecords(state, [run.launch]);
      const requests = related.map(record => record.reservation.request);
      const parent_deliveries = state.parent_deliveries.filter(binding => isDeepStrictEqual(binding.parent.launch, run.launch)
        || isDeepStrictEqual(binding.child.launch, run.launch) || requests.some(request => isDeepStrictEqual(request, binding.request))).map(binding => binding.delivery_id);
      const row: ExecutionState["interruptions"][number] = { before, phase: "draining", requests, parent_deliveries };
      state.interruptions.push(row);
      cancelUnissuedInterruptionActions(related);
      return row;
    });
  }

  /** Synchronous actual key callback, outside the metadata lock. Durable
   * issuance precedes its first native effect. No implicit retry or close.
   */
  async interruptRun<T>(input: ExecutionPoint, body: () => T): Promise<T> {
    const run = executionPointSchema.parse(input);
    if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const actorReader = this.store.interruptionActor?.bind(this.store);
    const checkpointReader = this.store.interruptionCheckpoint?.bind(this.store);
    const checkCheckpoint = () => {
      if (!actorReader) return;
      const result = checkpointReader?.();
      if (result && typeof (result as unknown as { then?: unknown }).then === "function")
        void Promise.resolve(result).catch(() => undefined);
      if (result !== executionCheckpoint) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    };
    const readCaller = () => {
      if (!actorReader) return null; // legacy private fixture: never infer a native caller
      const value = actorReader();
      if (value && typeof (value as { then?: unknown }).then === "function") {
        void Promise.resolve(value).catch(() => undefined); throw new ExecutionError("EXECUTION_UNSUPPORTED");
      }
      const parsed = executionActorSchema.safeParse(value);
      if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return parsed.data;
    };
    const { before, caller } = await this.store.transaction(state => {
      const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
      if (!row || row.phase !== "draining") throw new ExecutionError("EXECUTION_CONFLICT");
      if (interruptionSlots(state, run).length) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      const caller = readCaller();
      checkCheckpoint();
      if (caller) { row.caller = caller; row.checkpoint = executionCheckpoint; }
      row.phase = "preparing"; // one process claims this existing run; never an invocation ID
      return { before: row.before, caller };
    });
    let issued = false;
    try {
      const value = withExecutionInterruptEffectScope(run.launch.session_id, before.native.native_id, () => {
        this.store.transactionSync!(state => {
          const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
          if (!row || row.preparing_resolution || row.phase !== (issued ? "issued" : "preparing") || interruptionSlots(state, run).length)
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (!isDeepStrictEqual(row.caller ?? null, caller) || !isDeepStrictEqual(readCaller(), caller))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          checkCheckpoint();
          if (caller && row.checkpoint !== executionCheckpoint) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          const now = this.interruptObservation(run);
          if (!interruptionKeyReference(now) || !isDeepStrictEqual(interruptionIdentity(now), interruptionIdentity(before)))
            throw new ExecutionError("EXECUTION_CONFLICT");
          if (now.harness === "claude-code") this.assertManagedInterruptionPoint(state, run);
          if (!issued) {
            row.phase = "issued";
            state.slots.push({ session_id: run.launch.session_id, expected_launch_id: run.launch.launch_id,
              stage: "interrupt", state: "issued", request: null, run });
          } else if (!state.slots.some(slot => slot.stage === "interrupt" && slot.state === "issued" && isDeepStrictEqual(slot.run, run)))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
        }, issued ? { readOnly: true } : undefined);
        issued = true;
      }, body);
      if (!issued || !z.object({ schema: z.literal("aiterm.pty-key-result.v1"), session_id: z.literal(run.launch.session_id),
        key: z.literal("Escape"), outcome: z.literal("accepted"), interruption: z.literal("unconfirmed"),
        session_preserved: z.literal("unconfirmed") }).safeParse(value).success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      await this.store.transaction(state => {
        const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
        const slot = state.slots.find(slot => slot.stage === "interrupt" && isDeepStrictEqual(slot.run, run));
        if (!row || row.phase !== "issued" || !slot || slot.state !== "issued"
          || !isDeepStrictEqual(row.caller ?? null, caller) || !isDeepStrictEqual(readCaller(), caller)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        row.phase = "accepted"; slot.state = "unknown"; // key known; interruption/fence still unknown
      });
      return value;
    } catch (error) {
      try { await this.store.transaction(state => {
        const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
        if (row && !row.preparing_resolution && isDeepStrictEqual(row.caller ?? null, caller)) {
          if (issued || row.phase === "preparing") row.phase = issued ? "unknown" : "not_sent";
          if (issued) for (const slot of state.slots) if (slot.stage === "interrupt" && isDeepStrictEqual(slot.run, run)) slot.state = "unknown";
        }
      }); } catch { /* retain issued journal/slot; reconstruction never replays */ }
      throw issued ? new ExecutionError("EXECUTION_UNCONFIRMED", "possible") : error;
    }
  }

  /** Private, explicit reconciliation of a key attempt, not of its run/job.
   * A preparing checkpoint from this writer protocol plus native PID absence
   * proves no key could follow a completed issued checkpoint in that process.
   * Keep the barrier and all request/parent-return tombstones: native execution
   * may still be running. Issued/accepted/unknown attempts are never recovered
   * by process disappearance or replayed from this method.
   */
  reconcilePreparingInterruption(input: ExecutionPoint, expectedInput: ExecutionActor, observeCaller: (pid: number) => unknown) {
    const run = executionPointSchema.parse(input), expected = executionActorSchema.parse(expectedInput);
    const transact = this.store.transactionSync?.bind(this.store), actor = this.store.interruptionActor?.bind(this.store);
    const checkpoint = this.store.interruptionCheckpoint?.bind(this.store);
    if (!transact || !actor || !checkpoint || typeof observeCaller !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return transact(state => {
      const current = executionActorSchema.parse(actor());
      if (isDeepStrictEqual(current, expected) || checkpoint() !== executionCheckpoint) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
      const snapshot = row && structuredClone(row);
      const check = () => {
        if (!row || row.phase !== "preparing" || row.checkpoint !== executionCheckpoint || !isDeepStrictEqual(row.caller, expected)
          || !isDeepStrictEqual(row, snapshot)
          || state.slots.some(slot => slot.stage === "interrupt" && slot.session_id === run.launch.session_id))
          throw new ExecutionError("EXECUTION_UNCONFIRMED");
      };
      check();
      for (let count = 0; count < 2; count++) {
        const observed = observeCaller(expected.pid);
        if (observed && typeof (observed as { then?: unknown }).then === "function") {
          void Promise.resolve(observed).catch(() => undefined); throw new ExecutionError("EXECUTION_UNCONFIRMED");
        }
        if (!z.object({ state: z.literal("absent"), pid: z.literal(expected.pid) }).strict().safeParse(observed).success)
          throw new ExecutionError("EXECUTION_UNCONFIRMED");
        check();
        if (!isDeepStrictEqual(executionActorSchema.parse(actor()), current) || checkpoint() !== executionCheckpoint)
          throw new ExecutionError("EXECUTION_UNCONFIRMED");
      }
      row!.preparing_resolution = "key_not_sent";
      return { schema: "aiterm.preparing-interruption-reconciliation.v1" as const, run, caller: expected,
        key: "not_sent" as const, admission: "retained" as const, interruption: "unconfirmed" as const,
        session_preserved: "unconfirmed" as const, native_fence: "unknown" as const };
    });
  }

  /** Only a private native observation/fence can release the temporary barrier.
   * Old request/delivery tombstones remain; new target work may use this same
   * launch. Unknown/issued key receipts require separate recovery, never retry.
   */
  async settleInterruption(input: ExecutionPoint) {
    const run = executionPointSchema.parse(input);
    return this.store.transaction(state => this.settleInterruptionState(state, run));
  }
  private settleInterruptionState(state: ExecutionState, run: ExecutionPoint) {
    const row = state.interruptions.find(row => isDeepStrictEqual(row.before.run, run));
    if (!row || row.phase !== "accepted" || interruptionSlots(state, run).length) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (this.store.interruptionActor && !row.caller) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    this.assertInterruptionProof(run, row.before);
    if (!state.slots.some(slot => slot.stage === "interrupt" && isDeepStrictEqual(slot.run, run))) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    row.phase = "settled";
    state.slots = state.slots.filter(slot => !(slot.stage === "interrupt" && isDeepStrictEqual(slot.run, run)));
    for (const record of state.records) if (record.relation.lifecycle !== "retired" && isDeepStrictEqual(record.relation.target, run)) {
      record.relation.completion = "interrupted"; record.relation.target_fence = "closed";
    }
    retireSettledBranches(state);
    return row;
  }
  private assertInterruptionProof(run: ExecutionPoint, before: z.infer<typeof nativeInterruptionObservationSchema>) {
    const observation = this.interruptObservation(run);
    if (observation.recorded_state !== "interrupted" || observation.invocation_fence !== "closed"
      || observation.session_preserved !== "confirmed" || !isDeepStrictEqual(interruptionIdentity(observation), interruptionIdentity(before)))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const last = this.interruptObservation(run);
    if (!isDeepStrictEqual(last, observation)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  }

  /** Private serving-RPC cancellation. Only the exact existing request is
   * tombstoned; no launch/descendant stop or native interruption is inferred.
   * A missing record is not recreated. Issued/accepted/unknown slots survive.
   */
  async cancelRequestActions(input: ExecutionRequest): Promise<void> {
    const request = executionRefMetaSchema.parse({ schema: "aiterm.execution-ref.v1", request: input }).request;
    const exists = await this.store.transaction(state => state.records.some(value => same(value.reservation.request, request)), { readOnly: true });
    if (!exists) return;
    await this.store.transaction(state => {
      const record = state.records.find(value => same(value.reservation.request, request));
      if (record) cancelUnissuedInterruptionActions([record]);
    });
  }

  /** Internal receipt callbacks for the serving launch frame. No tool args,
   * new identifiers, native effects or name-based generation inference.
   */
  prepareCreation(metaInput: unknown): ExecutionNativeServer | null {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!this.store.transactionSync || !this.runtime.nativeSessionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return this.store.transactionSync(state => {
      const record = find(state, request);
      if (record.operations.launch !== "preparing" || record.relation.lifecycle === "retired") throw new ExecutionError("EXECUTION_CONFLICT");
      const native = this.runtime.nativeSessionSync!(record.reservation.target.session_id);
      if (native.state !== "absent" || native.server === undefined) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return native.server;
    }, { readOnly: true });
  }
  /** Private wrapper preparation for an explicit management close. No native
   * effect or slot removal occurs here. The invoke gate independently rechecks
   * this same identity immediately before every native command.
   */
  managementCloseNative(metaInput: unknown): string | undefined {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!managementClose(request)) return undefined;
    if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return this.store.transactionSync(state => {
      const record = find(state, request), target = record.reservation.target;
      if (!recoverableCloseSlots(state, request, target.session_id, target.expected_launch_id).length) return undefined;
      if (record.operations.send !== "preparing" || targetBlocked(state, request, target.session_id, target.expected_launch_id))
        throw new ExecutionError("EXECUTION_UNCONFIRMED");
      const native = this.runtime.nativeSessionSync?.(target.session_id);
      if (native?.state !== "present" || !native.server) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      this.proveExitedLaunchClose(state, request, target.session_id, target.expected_launch_id, native);
      return native.native_id;
    }, { readOnly: true });
  }
  private proveExitedLaunchClose(state: ExecutionState, request: ExecutionRequest, session: string, expected: string | null,
    native: { native_id: string; server?: ExecutionNativeServer | null }): void {
    const launches = recoverableCloseSlots(state, request, session, expected).filter(slot => slot.stage === "launch");
    if (!launches.length) return;
    if (!expected || !this.runtime.observeExitedCreatedLaunchSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const target = { session_id: session, launch_id: expected };
    const proof = exitedCreatedLaunchObservationSchema.safeParse(this.runtime.observeExitedCreatedLaunchSync(target));
    if (!proof.success || !same(proof.data.target, target) || proof.data.native.native_id !== native.native_id
      || !same(proof.data.native.server, native.server) || launches.some(slot => slot.created_native_id !== native.native_id
        || !same(slot.created_server, native.server))) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  }
  verifyCreationServer(metaInput: unknown, expected: ExecutionNativeServer | null): void {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    this.store.transactionSync(state => {
      const record = find(state, request), native = this.runtime.nativeSessionSync?.(record.reservation.target.session_id);
      if (native?.state !== "absent" || !same(native.server, expected)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    }, { readOnly: true });
  }
  captureCreatedNative(metaInput: unknown, session: string, nativeId: string,
    expectedServer: ExecutionNativeServer | null, receiptPid: number): ExecutionNativeServer {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!/^\$\d+$/.test(nativeId) || !this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED", "possible");
    return this.store.transactionSync(state => {
      const record = find(state, request), slot = state.slots.find(value => same(value.request, request) && value.stage === "launch");
      // A cold first new-session creates the server itself. Prove its owner
      // from the exact receipt and a stable native listing before stamping it.
      const observed = expectedServer ? null : this.runtime.nativeSessionSync?.(session);
      const server = expectedServer ?? (observed?.state === "present" && observed.native_id === nativeId ? observed.server : undefined);
      if (!slot || slot.state !== "issued" || record.operations.launch !== "issued" || slot.session_id !== session
        || record.reservation.target.expected_launch_id !== null || record.relation.lifecycle === "retired"
        || !server || server.pid !== receiptPid
        || (slot.created_native_id && slot.created_native_id !== nativeId)
        || (slot.created_server && !same(slot.created_server, server))) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
      // Preserve this genuine native receipt even if a stop is already fencing
      // its caller. Binding metadata does not authorize another native action.
      slot.created_native_id = nativeId;
      slot.created_server = server;
      return server;
    });
  }

  bindCreatedLaunch(metaInput: unknown, input: ExecutionLaunch): void {
    const { request } = executionRefMetaSchema.parse(metaInput), launch = executionLaunchSchema.parse(input);
    if (!this.store.transactionSync || !this.runtime.observeSync || !this.runtime.nativeSessionSync)
      throw new ExecutionError("EXECUTION_UNSUPPORTED", "possible");
    this.store.transactionSync(state => {
      const record = find(state, request), slot = state.slots.find(value => same(value.request, request) && value.stage === "launch");
      if (!slot || slot.state !== "issued" || record.operations.launch !== "issued" || slot.session_id !== launch.session_id
        || !slot.created_native_id || record.relation.lifecycle === "retired"
        || (record.relation.target && !same(record.relation.target.launch, launch))
        || (slot.expected_launch_id !== null && slot.expected_launch_id !== launch.launch_id))
        throw new ExecutionError("EXECUTION_CONFLICT", "possible");
      const native = this.runtime.nativeSessionSync!(launch.session_id), current = this.runtime.observeSync!(launch.session_id);
      if (native.state !== "present" || native.native_id !== slot.created_native_id || !same(native.server, slot.created_server)
        || current.state !== "present" || !same(current.launch, launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      slot.expected_launch_id = launch.launch_id;
      record.relation.target = { launch, boundary: null };
      if (state.stopping.some(value => same(value, record.relation.source?.launch)) && !state.stopping.some(value => same(value, launch))) state.stopping.push(launch);
    });
  }

  /** Wrap only the actual synchronous expected-close primitive supplied to
   * runtime.close. It may act only while stop owns this exact issued close slot.
   */
  withExpectedCloseEffect<T>(input: ExecutionLaunch, body: () => T): T {
    const expected = executionLaunchSchema.parse(input);
    let finished = false, issued = false;
    try {
      return withExecutionEffectScope(expected.session_id, () => {
        if (finished || issued) throw new ExecutionError("EXECUTION_CONFLICT", issued ? "possible" : "not_started");
        if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
        this.store.transactionSync(state => {
          if (!stopped(state, expected) || !state.slots.some(slot => slot.session_id === expected.session_id
            && slot.expected_launch_id === expected.launch_id && slot.stage === "close" && slot.state === "issued" && slot.request === null))
            throw new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
          if (!this.runtime.observeSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
          const current = this.runtime.observeSync(expected.session_id);
          if (current.state === "unknown" || (current.state === "present" && !current.launch))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (current.state !== "present" || !same(current.launch, expected))
            throw new ExecutionError("EXECUTION_STALE_GENERATION");
        }, { readOnly: true });
        issued = true;
      }, body);
    } finally { finished = true; }
  }

  async execute(input: unknown, context?: ExecutionTransportSource): Promise<ExecutionRecord> {
    const args = executionActionSchema.parse(input);
    if (args.action === "register") return this.register(args, context);
    if (args.action === "status") return this.store.transaction(state => view(state, find(state, args.request)), { readOnly: true });
    if (args.action === "reconcile_launch") return this.reconcileLaunch(args);
    return this.finish(args);
  }
  async admitNative<T>(body: () => T): Promise<T> {
    if (!this.store.admitNative) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return this.store.admitNative(body);
  }

  /** Read-only root selection, not a stop or a reservation. Generations come
   * only from current observation or persisted unfinished relations/slots. A
   * completed/retired contact never becomes a root just because its name matches.
   */
  async roots(input: unknown): Promise<z.infer<typeof executionRootsResultSchema>> {
    const { session_id } = executionRootsRequestSchema.parse(input);
    return this.store.transaction(async state => {
      const current = await this.runtime.observe(session_id).catch((): Observation => ({ state: "unknown" }));
      const roots = new Map<string, ExecutionLaunch>();
      const unresolved: z.infer<typeof executionRootsResultSchema>["unresolved"] = [];
      const relations = state.records.map(record => record.relation);
      const active = unfinishedExecutionRelations(relations);
      for (const relation of active) {
        if (relation.source?.launch.session_id === session_id) roots.set(key(relation.source.launch), relation.source.launch);
        else if (!relation.source && relation.source_session_id === session_id)
          unresolved.push({ request: relation.request, reason: "source_generation_missing" });
        if (relation.target?.launch.session_id === session_id) roots.set(key(relation.target.launch), relation.target.launch);
        const record = find(state, relation.request);
        if (relation.phase === "reserved" && record.reservation.target.session_id === session_id
          && record.reservation.target.expected_launch_id) {
          const expected = { session_id, launch_id: record.reservation.target.expected_launch_id };
          roots.set(key(expected), expected);
        }
        if (!relation.target && relation.phase !== "reserved" && record.reservation.target.session_id === session_id)
          unresolved.push({ request: relation.request, reason: "target_generation_missing" });
      }
      if (current.state === "present" && current.launch) roots.set(key(current.launch), current.launch);
      else if (current.state === "unknown" || current.state === "present")
        unresolved.push({ request: null, reason: "current_generation_unconfirmed" });
      for (const row of state.interruptions) if (row.before.run.launch.session_id === session_id
        && !["settled", "not_sent"].includes(row.phase)) {
        roots.set(key(row.before.run.launch), row.before.run.launch);
        unresolved.push({ request: null, reason: "interruption_unconfirmed" });
      }
      for (const slot of state.slots) if (slot.session_id === session_id || (slot.request &&
        find(state, slot.request).source_session_id === session_id) || slot.source?.session_id === session_id
        || slot.sources?.some(source => source.session_id === session_id)) {
        if (slot.source?.session_id === session_id) roots.set(key(slot.source), slot.source);
        for (const source of slot.sources ?? []) if (source.session_id === session_id) roots.set(key(source), source);
        if (slot.session_id === session_id && slot.expected_launch_id) {
          const expected = { session_id, launch_id: slot.expected_launch_id };
          roots.set(key(expected), expected);
        }
        unresolved.push({ request: slot.request, reason: "issued_operation_unconfirmed" });
      }
      const selected = [...roots.values()];
      if (selected.length) for (const gap of planCascadeStop(selected, relations).gaps)
        if (!unresolved.some(value => same(value.request, gap.request) && value.reason === gap.reason))
          unresolved.push({ request: gap.request, reason: gap.reason });
      const coverage = await this.runtime.coverage(selected, session_id);
      if (coverage !== "complete") unresolved.push({ request: null, reason: "relation_coverage_incomplete" });
      return executionRootsResultSchema.parse({ schema: "aiterm.execution-roots.v1", session_id,
        observation: current.state, current: current.state === "present" ? current.launch : null,
        roots: selected, relation_coverage: !unresolved.length && coverage === "complete" ? "complete" : "incomplete", unresolved });
    }, { readOnly: true });
  }

  private async register(args: ExecutionRegister, context?: ExecutionTransportSource): Promise<ExecutionRecord> {
    return this.store.transaction(async state => {
      const previous = state.records.find(record => same(record.reservation.request, args.reservation.request));
      if (previous) {
        if (!same(previous.reservation, args.reservation) || previous.source_session_id !== args.source_session_id)
          throw new ExecutionError("EXECUTION_CONFLICT", "possible");
        return view(state, previous); // idempotent lookup, never a second invocation
      }
      if (interruptionBlocksRequest(state, args.reservation.request)) throw new ExecutionError("EXECUTION_STOPPING");
      const source = assessExecutionSource(args.reservation.source, await this.runtime.sourceEvidence(args, context));
      if (source.status === "stale") throw new ExecutionError("EXECUTION_STALE_GENERATION");
      if (args.reservation.source.launch && source.status !== "verified") {
        const currentSource = await this.runtime.observe(args.reservation.source.launch.session_id);
        if (currentSource.state === "absent" || (currentSource.state === "present" && currentSource.launch
          && !same(currentSource.launch, args.reservation.source.launch)))
          throw new ExecutionError("EXECUTION_STALE_GENERATION");
      }
      sourceAdmission(state, source.point, args.source_session_id);
      const target = args.reservation.target;
      if (targetBlocked(state, args.reservation.request, target.session_id, target.expected_launch_id))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const current = await this.runtime.observe(target.session_id);
      this.expectTarget(current, target.expected_launch_id, target.session_id);
      if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
      const record: ExecutionRecord = {
        schema: "aiterm.execution-record.v1", reservation: args.reservation, source_session_id: args.source_session_id, source,
        relation: { request: args.reservation.request, source_session_id: args.source_session_id,
          source: source.point, target: null, phase: "reserved", completion: "open", target_fence: "open", lifecycle: "tracking" },
        operations: { launch: "not_issued", send: "not_issued" }, stopping: false,
      };
      state.records.push(record);
      return view(state, record);
    });
  }

  private expectTarget(current: Observation, expected: string | null, session: string): void {
    if (current.state === "unknown" || (current.state === "present" && !current.launch))
      throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    if (current.state === "absent") {
      if (expected !== null) throw new ExecutionError("EXECUTION_STALE_GENERATION");
    } else if (current.launch?.session_id !== session || current.launch?.launch_id !== expected)
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
  }

  /** Each existing RequestRef has at most one launch and one send. The callback
   * runs only after its issuance is durably recorded, outside the state lock.
   * A second caller/status recovery never automatically invokes it again.
   */
  async invoke<T>(metaInput: unknown, stage: "launch" | "send",
    body: () => Promise<{ value: T; target: ExecutionPoint }>, targetSessionId?: string): Promise<{ value: T; record: ExecutionRecord }> {
    return this.invokeInternal(metaInput, stage, () => body(), targetSessionId, false);
  }

  /** Preflight/idle waits are unissued. The serving native adapter must call
   * issue() immediately before its first actual effect, on the same stack.
   * Synchronous metadata admission persists issuance before any native action.
   */
  async invokeDeferred<T>(metaInput: unknown, stage: "launch" | "send",
    body: (issue: () => void, prepare: ExecutionPreparation) => Promise<{ value: T; target: ExecutionPoint | null }>, targetSessionId: string,
    admission?: () => void): Promise<{ value: T; record: ExecutionRecord }> {
    return this.invokeInternal(metaInput, stage, body, targetSessionId, true, admission);
  }

  private async invokeInternal<T>(metaInput: unknown, stage: "launch" | "send",
    body: (issue: () => void, prepare: ExecutionPreparation) => Promise<{ value: T; target: ExecutionPoint | null }>, targetSessionId: string | undefined,
    deferred: boolean, admission?: () => void): Promise<{ value: T; record: ExecutionRecord }> {
    const { request } = executionRefMetaSchema.parse(metaInput);
    let expectedCloseNative: { native_id: string; server: ExecutionNativeServer } | undefined;
    if (deferred && (!this.store.transactionSync || !this.runtime.observeSync)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    await this.store.transaction(async state => {
      admission?.();
      const record = find(state, request);
      const relation = record.relation;
      if (interruptionBlocksRequest(state, request)) throw new ExecutionError("EXECUTION_STOPPING");
      // The concrete MCP adapter must supply its actual immutable argument.
      // Validating only the eventual receipt is too late to prevent a tool
      // accidentally invoking another seat before binding discovers the error.
      if (targetSessionId !== undefined && targetSessionId !== record.reservation.target.session_id)
        throw new ExecutionError("EXECUTION_CONFLICT", "not_started");
      if (relation.lifecycle === "retired" || relation.phase === "unsent" || record.operations[stage] !== "not_issued")
        throw new ExecutionError("EXECUTION_CONFLICT", record.operations[stage] === "not_sent" ? "not_started" : "possible");
      sourceAdmission(state, relation.source, record.source_session_id);
      if (record.reservation.source.launch && !relation.source)
        throw new ExecutionError("EXECUTION_UNCONFIRMED");
      if (deferred) {
        const target = record.reservation.target;
        if (recoverableCloseSlots(state, request, target.session_id, target.expected_launch_id).length) {
          if (targetBlocked(state, request, target.session_id, target.expected_launch_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          this.expectTarget(await this.runtime.observe(target.session_id), target.expected_launch_id, target.session_id);
          const native = this.runtime.nativeSessionSync?.(target.session_id);
          if (native?.state !== "present" || !native.server) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          this.proveExitedLaunchClose(state, request, target.session_id, target.expected_launch_id, native);
          expectedCloseNative = { native_id: native.native_id, server: structuredClone(native.server) };
        }
        record.operations[stage] = "preparing";
        return; // no native effect or target slot yet; stop can cancel this
      }
      // A previously verified runtime can have ended since reservation. Null
      // source boundaries remain valid generation edges, not semantic failures.
      if (relation.source) {
        const source = await this.runtime.observe(relation.source.launch.session_id);
        if (source.state === "unknown" || (source.state === "present" && !source.launch))
          throw new ExecutionError("EXECUTION_UNCONFIRMED");
        if (source.state !== "present" || !same(source.launch, relation.source.launch))
          throw new ExecutionError("EXECUTION_STALE_GENERATION");
      }
      const target = record.reservation.target;
      if (state.slots.some(slot => slot.session_id === target.session_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const expected = relation.target?.launch.launch_id ?? target.expected_launch_id;
      const current = await this.runtime.observe(target.session_id);
      this.expectTarget(current, expected, target.session_id);
      if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
      if ((stage === "launch" && current.state !== "absent") || (stage === "send" && current.state !== "present"))
        throw new ExecutionError("EXECUTION_CONFLICT");
      record.operations[stage] = "issued";
      relation.phase = "submitted_unknown";
      if (current.state === "present" && current.launch && !relation.target) relation.target = { launch: current.launch, boundary: null };
      state.slots.push({ session_id: target.session_id, expected_launch_id: expected, stage, state: "issued", request });
    });
    let issued = !deferred, finished = false;
    const checkCloseNative = (session: string) => {
      if (!expectedCloseNative) return;
      const native = this.runtime.nativeSessionSync?.(session);
      if (native?.state !== "present" || native.native_id !== expectedCloseNative.native_id
        || !same(native.server, expectedCloseNative.server)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    };
    const checkOrIssue = (commit: boolean, preparation: () => unknown): unknown => {
      admission?.();
      const prepared = () => { admission?.(); return preparation(); };
      if (finished) throw new ExecutionError("EXECUTION_CONFLICT");
      if (issued) {
        if (!deferred) return commit ? undefined : prepared();
        // An RPC can issue several native commands with an async readiness
        // wait between them. Owning its slot is not permission to ignore a
        // stop, uncertain slot or generation replacement after the first one.
        return this.store.transactionSync!(state => {
          const record = find(state, request), relation = record.relation;
          if (interruptionBlocksRequest(state, request)) throw new ExecutionError("EXECUTION_STOPPING");
          assertInterruptionSource(state, relation.source, record.source_session_id);
          const slot = state.slots.find(value => same(value.request, request) && value.stage === stage);
          if (!slot || slot.state !== "issued" || record.operations[stage] !== "issued"
            || relation.lifecycle === "retired") throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (stopped(state, relation.source?.launch)) throw new ExecutionError("EXECUTION_STOPPING");
          if (!relation.source && record.source_session_id && state.stopping.some(value => value.session_id === record.source_session_id))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (blocksSource(state, relation.source?.launch ?? null, record.source_session_id, slot))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (relation.source) {
            const source = this.runtime.observeSync!(relation.source.launch.session_id);
            if (source.state === "unknown" || (source.state === "present" && !source.launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
            if (source.state !== "present" || !same(source.launch, relation.source.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
          }
          const current = this.runtime.observeSync!(slot.session_id);
          checkCloseNative(slot.session_id);
          if (expectedCloseNative) this.proveExitedLaunchClose(state, request, slot.session_id, slot.expected_launch_id, expectedCloseNative);
          if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
          if (slot.created_native_id) {
            const native = this.runtime.nativeSessionSync?.(slot.session_id);
            if (!native || native.state !== "present" || native.native_id !== slot.created_native_id
              || !slot.created_server || !same(native.server, slot.created_server))
              throw new ExecutionError("EXECUTION_UNCONFIRMED");
            if (slot.expected_launch_id === null) {
              if (current.state !== "present" || current.launch !== null) throw new ExecutionError("EXECUTION_UNCONFIRMED");
              return prepared(); // bound physical shell, before core publishes its managed launch
            }
          }
          // A fresh launch's expected ID starts null. Until the core adapter
          // binds the exact created generation, do not infer ownership from a
          // new same-name observation merely because this RPC created a slot.
          if (slot.expected_launch_id === null && current.state === "present") throw new ExecutionError("EXECUTION_UNSUPPORTED");
          this.expectTarget(current, slot.expected_launch_id, slot.session_id);
          return prepared();
        }, { readOnly: true });
      }
      const result = this.store.transactionSync!(state => {
        const record = find(state, request), relation = record.relation;
        if (interruptionBlocksRequest(state, request)) throw new ExecutionError("EXECUTION_STOPPING");
        if (relation.lifecycle === "retired" || relation.phase === "unsent" || record.operations[stage] !== "preparing")
          throw new ExecutionError("EXECUTION_CONFLICT", "not_started");
        sourceAdmission(state, relation.source, record.source_session_id);
        if (relation.source) {
          const source = this.runtime.observeSync!(relation.source.launch.session_id);
          if (source.state === "unknown" || (source.state === "present" && !source.launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (source.state !== "present" || !same(source.launch, relation.source.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
        }
        const target = record.reservation.target;
        if (targetBlocked(state, request, target.session_id, target.expected_launch_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        const expected = relation.target?.launch.launch_id ?? target.expected_launch_id;
        const current = this.runtime.observeSync!(target.session_id);
        this.expectTarget(current, expected, target.session_id);
        checkCloseNative(target.session_id);
        if (expectedCloseNative) this.proveExitedLaunchClose(state, request, target.session_id, expected, expectedCloseNative);
        if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
        if ((stage === "launch" && current.state !== "absent") || (stage === "send" && current.state !== "present"))
          throw new ExecutionError("EXECUTION_CONFLICT");
        if (!commit) return prepared();
        admission?.();
        record.operations[stage] = "issued";
        relation.phase = "submitted_unknown";
        if (current.state === "present" && current.launch && !relation.target) relation.target = { launch: current.launch, boundary: null };
        state.slots.push({ session_id: target.session_id, expected_launch_id: expected, stage, state: "issued", request });
      }, commit ? undefined : { readOnly: true });
      if (commit) issued = true;
      return result;
    };
    const issue = (): void => { checkOrIssue(true, () => undefined); };
    const prepare: ExecutionPreparation = body => checkOrIssue(false, body) as ReturnType<typeof body>;
    const unissued = async (): Promise<ExecutionRecord> => this.store.transaction(state => {
      const record = find(state, request);
      if (!["preparing", "not_sent"].includes(record.operations[stage])) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
      record.operations[stage] = "not_sent";
      record.relation.phase = record.operations.launch === "accepted" ? "invoked" : "unsent";
      retireSettledBranches(state);
      return view(state, record);
    });
    let outcome: { value: T; target: ExecutionPoint | null };
    try {
      outcome = await body(issue, prepare);
      finished = true;
      if (!issued) return { value: outcome.value, record: await unissued() };
      outcome.target = executionPointSchema.parse(outcome.target);
    } catch (error) {
      finished = true;
      if (!issued) {
        try { await unissued(); } catch { /* keep preparing if metadata admission itself became unavailable */ }
        // No native effect crossed this operation's gate, even if a preflight
        // read/RPC failed. A duplicate invocation failed before owning preparing.
        throw error instanceof ExecutionError ? new ExecutionError(error.code, "not_started")
          : new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
      }
      const certain = !deferred && error instanceof ExecutionError && error.effect === "not_started";
      let committed = false;
      try { await this.store.transaction(state => {
        const record = find(state, request);
        const owned = state.slots.find(slot => same(slot.request, request));
        if (!owned || owned.stage !== stage || record.operations[stage] !== "issued") return;
        record.operations[stage] = certain ? "not_sent" : "unknown";
        if (certain) {
          state.slots = state.slots.filter(slot => !same(slot.request, request));
          record.relation.phase = record.operations.launch === "accepted" ? "invoked" : "unsent";
          retireSettledBranches(state);
        } else {
          record.relation.phase = "submitted_unknown";
          record.relation.completion = "unknown";
          const slot = state.slots.find(value => same(value.request, request));
          if (slot) slot.state = "unknown";
        }
      }); committed = true; } catch { /* durable issued state remains; do not leak a pre-effect cleanup refusal */ }
      throw certain && committed ? error : new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    }
    // Parsed above after issuance; null is supported only for an unissued noop.
    const targetPoint = outcome.target!;
    const record = await this.store.transaction(async state => {
      const record = find(state, request);
      const slot = state.slots.find(value => same(value.request, request));
      if (!slot || slot.stage !== stage || record.operations[stage] !== "issued")
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const expected = slot.expected_launch_id;
      if (targetPoint.launch.session_id !== slot.session_id
        || (expected !== null && targetPoint.launch.launch_id !== expected))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const current = await this.runtime.observe(slot.session_id);
      const closing = request.kind === "mcp" && ["pty_close", "agent_auth.cancel"].includes(request.tool);
      if (closing ? current.state !== "absent" : current.state !== "present" || !same(current.launch, targetPoint.launch))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      record.operations[stage] = "accepted";
      // A launch with an initial prompt already performed this reference's
      // send. Only an empty launch may be followed by a separate pty_send.
      if (stage === "launch" && targetPoint.boundary) record.operations.send = "accepted";
      record.relation.target = targetPoint;
      record.relation.phase = "invoked";
      record.relation.completion = closing ? "interrupted" : "open";
      if (closing) record.relation.target_fence = "closed";
      if (state.stopping.some(value => same(value, record.relation.source?.launch)) && !state.stopping.some(value => same(value, targetPoint.launch)))
        state.stopping.push(targetPoint.launch);
      state.slots = state.slots.filter(value => !same(value.request, request));
      if (closing) {
        // Actual management close plus confirmed absence releases only these
        // failed send admissions. Old callbacks still fail their missing-slot
        // guard, and their records remain unknown and cannot be invoked again.
        const recovered = recoverableCloseSlots(state, request, slot.session_id, expected);
        state.slots = state.slots.filter(value => !recovered.includes(value));
        this.interruptRelations(state, targetPoint.launch);
      }
      return view(state, record);
    }).catch(async () => {
      // The side effect already returned, but its result could not be safely
      // bound/committed. Absence/replacement is not permission to replay it.
      try { await this.store.transaction(state => {
        const record = find(state, request);
        const owned = state.slots.find(slot => same(slot.request, request));
        if (!owned || owned.stage !== stage || record.operations[stage] !== "issued") return;
        record.operations[stage] = "unknown";
        record.relation.phase = "submitted_unknown";
        record.relation.completion = "unknown";
        const slot = state.slots.find(value => same(value.request, request));
        if (slot) slot.state = "unknown";
      }); } catch { /* the original issued slot still blocks replay after reconstruction */ }
      throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    });
    return { value: outcome.value, record };
  }

  /** Explicit present-generation reconciliation. It never replays the original
   * launch or input, and does not claim to recover the lost RPC receipt. */
  private async reconcileLaunch(args: ExecutionReconcileLaunch): Promise<ExecutionRecord> {
    return this.store.transaction(state => {
      const record = find(state, args.request), relation = record.relation;
      if (record.operations.launch === "accepted" && same(relation.target?.launch, args.target)) {
        // A saved accepted receipt is historical. Before a caller can use an
        // empty launch to resume input, prove that this generation is still
        // present and no later operation owns the same session slot.
        if (record.operations.send === "not_issued") {
          if (record.stopping || stopped(state, args.target) || stopped(state, relation.source?.launch)
            || interruptionBlocksRequest(state, args.request)) throw new ExecutionError("EXECUTION_STOPPING");
          if (state.slots.some(slot => slot.session_id === args.target.session_id) || openParentEffect(state, args.request))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (!this.runtime.observeCreatedLaunchSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
          const parsed = createdLaunchObservationSchema.safeParse(this.runtime.observeCreatedLaunchSync(args.target));
          if (!parsed.success || !same(parsed.data.target, args.target)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        }
        return view(state, record);
      }
      if (record.operations.launch === "issued") throw new ExecutionError("EXECUTION_BUSY");
      if (record.stopping || stopped(state, args.target) || stopped(state, relation.source?.launch)
        || interruptionBlocksRequest(state, args.request)) throw new ExecutionError("EXECUTION_STOPPING");
      const slots = state.slots.filter(slot => slot.session_id === args.target.session_id);
      const slot = slots[0];
      if (record.operations.launch !== "unknown" || record.operations.send !== "not_issued"
        || relation.phase !== "submitted_unknown" || relation.completion !== "unknown" || relation.lifecycle !== "tracking"
        || record.reservation.target.session_id !== args.target.session_id
        || relation.target?.boundary != null || (relation.target && !same(relation.target.launch, args.target))
        || (record.reservation.target.expected_launch_id !== null && record.reservation.target.expected_launch_id !== args.target.launch_id)
        || slots.length !== 1 || !slot || !same(slot.request, args.request) || slot.stage !== "launch" || slot.state !== "unknown"
        || !slot.created_native_id || !slot.created_server
        || (slot.expected_launch_id !== null && slot.expected_launch_id !== args.target.launch_id)
        || openParentEffect(state, args.request)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      if (!this.runtime.observeCreatedLaunchSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      const parsed = createdLaunchObservationSchema.safeParse(this.runtime.observeCreatedLaunchSync(args.target));
      if (!parsed.success || !same(parsed.data.target, args.target)
        || parsed.data.native.native_id !== slot.created_native_id
        || !isDeepStrictEqual(parsed.data.native.server, slot.created_server)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      record.operations.launch = "accepted";
      relation.target = { launch: args.target, boundary: null };
      relation.phase = "invoked"; relation.completion = "open";
      state.slots = state.slots.filter(value => value !== slot);
      return view(state, record);
    });
  }

  private async finish(args: ExecutionFinish): Promise<ExecutionRecord> {
    return this.store.transaction(async state => {
      const record = find(state, args.request);
      if (record.operations.launch === "issued" || record.operations.send === "issued"
        || record.operations.launch === "unknown" || record.operations.send === "unknown")
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      if (state.slots.some(slot => slot.request && same(slot.request, args.request)))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      if (openParentEffect(state, args.request)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      if (args.evidence.kind === "not_sent") {
        if (record.operations.send === "accepted") throw new ExecutionError("EXECUTION_CONFLICT", "possible");
        record.operations.send = "not_sent";
        if (record.operations.launch !== "accepted") record.relation.phase = "unsent";
        // A real launch remains an edge even if its later prompt was unsent.
      } else {
        const target = record.relation.target;
        if (!target) throw new ExecutionError("EXECUTION_CONFLICT");
        if (args.evidence.kind === "completion") {
          if (!target.boundary || !same(target, args.evidence.target)) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
          if (record.relation.completion === "completed" && record.relation.target_fence === "closed") return view(state, record);
          const observed = await this.runtime.completion(target);
          if (observed.state === "unknown") throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
          record.relation.completion = observed.state;
          record.relation.target_fence = pendingParentReturn(state, args.request) ? "unknown"
            : observed.state === "completed" ? "closed" : observed.fence;
        } else {
          if (!same(target.launch, args.evidence.target)) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
          if (record.relation.completion === "interrupted" && record.relation.target_fence === "closed") return view(state, record);
          const observed = await this.runtime.observe(target.launch.session_id);
          if (observed.state !== "absent" || state.slots.some(slot => slot.session_id === target.launch.session_id))
            throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
          record.relation.completion = "interrupted";
          record.relation.target_fence = "closed";
        }
      }
      retireSettledBranches(state);
      return view(state, record);
    });
  }

  /** Adapter for existing restart/configuration/close paths. It shares the
   * same per-seat issuance slots as dispatch and stop, without creating a job ID.
   * Callers must not wrap a multi-step restart in one unobserved callback:
   * close, then a fresh launch reservation are separate admissions.
   */
  async changeSession<T>(expected: ExecutionLaunch, stage: "close" | "configure", body: () => Promise<T>,
    sourceInput?: ExecutionLaunch | null): Promise<T> {
    const source = sourceInput ? executionLaunchSchema.parse(sourceInput) : null;
    await this.store.transaction(async state => {
      sourceAdmission(state, source ? { launch: source, boundary: null } : null, source?.session_id ?? null);
      if (source) {
        const currentSource = await this.runtime.observe(source.session_id);
        if (currentSource.state === "unknown" || (currentSource.state === "present" && !currentSource.launch))
          throw new ExecutionError("EXECUTION_UNCONFIRMED");
        if (currentSource.state !== "present" || !same(currentSource.launch, source))
          throw new ExecutionError("EXECUTION_STALE_GENERATION");
      }
      if (stopped(state, expected)) throw new ExecutionError("EXECUTION_STOPPING");
      if (state.slots.some(slot => slot.session_id === expected.session_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      this.expectTarget(await this.runtime.observe(expected.session_id), expected.launch_id, expected.session_id);
      state.slots.push({ session_id: expected.session_id, expected_launch_id: expected.launch_id,
        stage, state: "issued", request: null, ...(source ? { source } : {}) });
    });
    let observed = false;
    try {
      const value = await body();
      observed = true;
      const current = await this.runtime.observe(expected.session_id);
      if (stage === "close" ? current.state !== "absent" : current.state !== "present" || !same(current.launch, expected))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      await this.store.transaction(state => {
        state.slots = state.slots.filter(slot => !(slot.session_id === expected.session_id && slot.stage === stage));
        if (stage === "close") this.interruptRelations(state, expected);
      });
      return value;
    } catch (error) {
      const certain = !observed && error instanceof ExecutionError && error.effect === "not_started";
      let committed = false;
      try { await this.store.transaction(state => {
        const slot = state.slots.find(value => value.session_id === expected.session_id && value.stage === stage);
        if (certain) state.slots = state.slots.filter(value => value !== slot);
        else if (slot) slot.state = "unknown";
      }); committed = true; } catch { /* retain the durable issued slot if cleanup cannot be admitted */ }
      throw certain && committed ? error : new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    }
  }

  /** Private cascade controller over the existing shared graph/admission.
   * Public agent_stop remains read-only until native aliases/fence/coverage
   * and the serving constructor acceptance are complete. No new wire or IDs.
   */
  async interruptCascade(input: unknown): Promise<z.infer<typeof cascadeInterruptResultSchema>> {
    const { roots } = cascadeInterruptRequestSchema.parse(input);
    if (!this.runtime.selectInterruptionSync || !this.runtime.interruptKeySync || !this.store.transactionSync)
      return this.stop(input);
    try {
      const reached = new Map(roots.map(launch => [key(launch), launch]));
      const runs = new Map<string, ExecutionPoint>();
      const outcomes = new Map<string, z.infer<typeof cascadeInterruptResultSchema>["targets"][number]>();
      const selectionInputs = new Map<string, ExecutionPoint[]>();
      const unresolved: z.infer<typeof cascadeInterruptResultSchema>["unresolved"] = [];
      const gap = (reason: string, request: ExecutionRequest | null = null) => {
        if (!unresolved.some(value => value.reason === reason && isDeepStrictEqual(value.request, request))) unresolved.push({ request, reason });
      };
      const pendingNative = (state: ExecutionState, targets: ExecutionLaunch[]) => state.slots.filter(slot => slot.stage !== "interrupt" && targets.some(launch =>
        slot.session_id === launch.session_id || isDeepStrictEqual(slot.source, launch)
        || slot.sources?.some(source => isDeepStrictEqual(source, launch))
        || (slot.request && isDeepStrictEqual(find(state, slot.request).relation.source?.launch, launch))));
      const describe = (state: ExecutionState) => {
        const plan = planCascadeStop([...reached.values()], state.records.map(record => record.relation));
        const needsCancellation = interruptionRelatedRecords(state, plan.targets).some(record => !record.stopping ||
          [record.operations.launch, record.operations.send].some(stage => stage === "not_issued" || stage === "preparing"));
        return { plan, pending: pendingNative(state, plan.targets), relations: state.records.map(record => record.relation), needsCancellation };
      };
      const snapshot = async () => {
        const current = await this.store.transaction(describe, { readOnly: true });
        if (!current.needsCancellation) return current;
        // Recompute under the writer lock: a stage may have issued after the
        // read-only snapshot. Never relabel it as not_sent or discard its slot.
        return this.store.transaction(state => {
          const plan = planCascadeStop([...reached.values()], state.records.map(record => record.relation));
          cancelUnissuedInterruptionActions(interruptionRelatedRecords(state, plan.targets));
          return describe(state);
        });
      };
      const deadline = performance.now() + this.drainTimeoutMs; // RPC drain bound, never graph expiry
      let drainUnconfirmed = false;
      for (;;) {
        const current = await snapshot();
        let added = false;
        for (const launch of current.plan.targets) {
          const id = key(launch); reached.set(id, launch);
          if (runs.has(id)) continue;
          const candidates = current.relations.filter(relation => relation.lifecycle !== "retired"
            && relation.phase !== "unsent" && ["open", "unknown"].includes(relation.completion)
            && isDeepStrictEqual(relation.target?.launch, launch)).map(relation => relation.target!);
          if (outcomes.has(id) && isDeepStrictEqual(selectionInputs.get(id), candidates)) continue;
          // Retry a read-only selection only when actual recorded references
          // changed during drain. This never replays a native key or input.
          selectionInputs.set(id, candidates.map(point => executionPointSchema.parse(point)));
          outcomes.delete(id); added = true;
          try {
            const existing = await this.store.transaction(state => state.interruptions.find(row =>
              isDeepStrictEqual(row.before.run.launch, launch) && !["settled", "not_sent"].includes(row.phase)) ?? null, { readOnly: true });
            let run: ExecutionPoint;
            if (existing) run = existing.before.run;
            else {
              const candidate = candidates[0];
              const selected = this.runtime.selectInterruptionSync(executionLaunchSchema.parse(launch), candidates.map(value => executionPointSchema.parse(value)));
              if (selected && typeof (selected as { then?: unknown }).then === "function") {
                void Promise.resolve(selected).catch(() => undefined); throw new ExecutionError("EXECUTION_UNSUPPORTED");
              }
              const observation = nativeInterruptionObservationSchema.parse(selected);
              if (!isDeepStrictEqual(observation.run.launch, launch) || !interruptionKeyReference(observation))
                throw new ExecutionError("EXECUTION_UNSUPPORTED");
              if (observation.harness === "claude-code"
                && !candidates.some(value => isDeepStrictEqual(observation.run, value))) throw new ExecutionError("EXECUTION_UNSUPPORTED");
              run = observation.run;
              // A native turn already present in an accepted canonical receipt
              // can be re-observed at that ORIGINAL Point. Never fill a null
              // turn, match a different turn or pick among multiple cursors.
              // Existing operation/steer references need their own native
              // acceptance proof; this Codex observation does not provide it.
              if (observation.harness === "codex-cli" && candidate && candidates.every(value => isDeepStrictEqual(value, candidate))
                && candidate.boundary?.turn_id === run.boundary?.turn_id
                && candidate.boundary?.operation_id === null && candidate.boundary?.steer_id === null) {
                const proof = this.interruptObservation(candidate);
                if (proof.recorded_state !== "running"
                  || !isDeepStrictEqual(interruptionIdentity({ ...proof, run }), interruptionIdentity(observation)))
                  throw new ExecutionError("EXECUTION_UNCONFIRMED");
                run = candidate;
              }
            }
            await this.beginInterruption(run); runs.set(id, run);
          } catch {
            outcomes.set(id, { launch, run: null, key: null, key_receipt: "not_sent", interruption: "unsupported",
              session_preserved: "unconfirmed", reason: "native_current_run_unavailable" });
          }
        }
        // Admit the whole currently reachable set before the first key. A late
        // genuine receipt may add another target while existing RPCs drain.
        if (added) continue;
        if (current.pending.some(slot => slot.state === "issued") && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10)); continue;
        }
        for (const slot of current.pending) { gap("native_issuance_unconfirmed", slot.request); drainUnconfirmed = true; }
        break;
      }
      for (const [id, run] of runs) {
        let row = await this.store.transaction(state => state.interruptions.find(value => isDeepStrictEqual(value.before.run, run)) ?? null, { readOnly: true });
        if (row?.phase === "draining" && !drainUnconfirmed) {
          try { await this.interruptRun(run, () => this.runtime.interruptKeySync!(executionPointSchema.parse(run))); }
          catch { /* actual journal distinguishes not_sent from issued/unknown; never retry */ }
          row = await this.store.transaction(state => state.interruptions.find(value => isDeepStrictEqual(value.before.run, run)) ?? null, { readOnly: true });
        }
        const keyNotSent = row?.preparing_resolution === "key_not_sent";
        outcomes.set(id, { launch: run.launch, run, key: !keyNotSent && row && row.phase !== "not_sent" && row.phase !== "draining" ? "Escape" : null,
          key_receipt: keyNotSent ? "not_sent" : row?.phase === "accepted" ? "accepted" : row && ["issued", "unknown", "preparing"].includes(row.phase) ? "unknown" : "not_sent",
          interruption: "unconfirmed", session_preserved: "unconfirmed",
          reason: keyNotSent ? "key_not_sent_native_run_unconfirmed"
            : row?.before.schema === "aiterm.claude-anonymous-interruption-observation.v1"
              ? "anonymous_before_send_native_acceptance_unconfirmed" : row?.before.harness === "claude-code"
              ? "managed_operation_native_acceptance_unconfirmed" : "native_interruption_or_fence_unconfirmed" });
      }
      const coverage = await this.runtime.coverage(roots);
      const final = await this.store.transaction(state => {
        const last = { plan: planCascadeStop([...reached.values()], state.records.map(record => record.relation)),
          relations: structuredClone(state.records.map(record => record.relation)) };
        for (const slot of pendingNative(state, last.plan.targets)) { drainUnconfirmed = true; gap("native_issuance_unconfirmed", slot.request); }
        const aliasMissing = new Set<string>();
        for (const launch of last.plan.targets) if (!reached.has(key(launch))) {
          reached.set(key(launch), launch); gap("late_target_unconfirmed");
          outcomes.set(key(launch), { launch, run: null, key: null, key_receipt: "not_sent", interruption: "unconfirmed",
            session_preserved: "unconfirmed", reason: "late_target_unconfirmed" });
        }
        for (const relation of last.relations) if (relation.lifecycle !== "retired" && relation.phase !== "unsent"
          && ["open", "unknown"].includes(relation.completion) && relation.target && reached.has(key(relation.target.launch))) {
          const run = runs.get(key(relation.target.launch));
          if (run && !isDeepStrictEqual(relation.target, run)) { aliasMissing.add(key(relation.target.launch)); gap("native_canonical_alias_missing", relation.request); }
        }
        // Missing downstream admission must not be hidden by releasing a parent.
        // Independent roots retain per-target results. A reached ancestor
        // without admission may still call its descendants: keep those barriers
        // until an actual ancestor/fence adapter can exclude that old source.
        // Use this single pre-release graph snapshot for every decision: settling
        // an earlier target must not change which later target may be released.
        const unadmittedBranches = [...reached.values()].filter(launch => !runs.has(key(launch)))
          .map(launch => planCascadeStop([launch], last.relations));
        for (const [id, run] of runs) {
          const branch = planCascadeStop([run.launch], last.relations);
          const journal = state.interruptions.find(value => isDeepStrictEqual(value.before.run, run));
          if (journal?.before.schema === "aiterm.claude-anonymous-interruption-observation.v1") {
            gap("anonymous_before_send_native_acceptance_unconfirmed"); gap("claude_hook_version_unconfirmed");
          } else if (journal?.before.harness === "claude-code") gap("managed_operation_native_acceptance_unconfirmed");
          if (unadmittedBranches.some(value => value.targets.some(launch => isDeepStrictEqual(launch, run.launch)))) {
            const outcome = outcomes.get(id);
            if (outcome) outcome.reason = "ancestor_admission_unconfirmed";
            gap("ancestor_admission_unconfirmed"); continue;
          }
          if (branch.targets.some(launch => !runs.has(key(launch)) || aliasMissing.has(key(launch)))
            || pendingNative(state, branch.targets).length
            || branch.gaps.some(value => ["source_generation_missing", "target_generation_missing",
              "descendant_binding_missing", "invocation_outcome_unknown"].includes(value.reason))) continue;
          try {
            this.settleInterruptionState(state, run);
            outcomes.set(id, { launch: run.launch, run, key: "Escape", key_receipt: "accepted", interruption: "interrupted",
              session_preserved: "confirmed", reason: "native_run_interrupted_session_preserved" });
          } catch { gap("native_interruption_or_fence_unconfirmed"); }
        }
        // All releases and the final scope snapshot commit together. Native reads
        // for another target must not hide replacement of an earlier one.
        for (const [id, run] of runs) if (outcomes.get(id)?.interruption === "interrupted") {
          const row = state.interruptions.find(value => isDeepStrictEqual(value.before.run, run));
          if (!row) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          this.assertInterruptionProof(run, row.before);
        }
        return planCascadeStop([...reached.values()], state.records.map(record => record.relation));
      });
      for (const item of final.gaps) gap(item.reason, item.request);
      if (coverage !== "complete") gap("relation_coverage_incomplete");
      for (const target of outcomes.values()) if (target.interruption !== "interrupted") gap(target.reason);
      const targets = [...outcomes.values()], any = targets.some(target => target.interruption === "interrupted");
      return cascadeInterruptResultSchema.parse({ schema: "aiterm.cascade-stop-result.v2", mode: "interrupt", roots,
        status: any && !unresolved.length && targets.length === reached.size ? "confirmed" : any ? "partial" : "unconfirmed",
        relation_coverage: !unresolved.length && coverage === "complete" ? "complete" : "incomplete", unresolved, targets });
    } catch {
      // Admission or keys may already be committed. An unrelated late callback
      // rejection cannot turn this control into a safe-to-retry not_started.
      throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    }
  }

  async stop(input: unknown): Promise<z.infer<typeof cascadeInterruptResultSchema>> {
    const { roots } = cascadeInterruptRequestSchema.parse(input);
    // Owner correction 2026-10-21: stop interrupts the current computation
    // while retaining session/launch/conversation. No close/kill escalation.
    // Until the exact harness interruption and preservation proof are wired,
    // report unsupported before even fencing metadata; never run close/kill.
    return this.store.transaction(state => {
      const plan = planCascadeStop(roots, state.records.map(record => record.relation));
      return cascadeInterruptResultSchema.parse({ schema: "aiterm.cascade-stop-result.v2", mode: "interrupt", roots,
        status: "unconfirmed", relation_coverage: "incomplete",
        unresolved: [...plan.gaps.map(gap => ({ request: gap.request, reason: gap.reason })),
          { request: null, reason: "session_preserving_interrupt_adapter_missing" }],
        targets: plan.targets.map(launch => ({ launch, run: null, key: null, key_receipt: "not_sent",
          interruption: "unsupported", session_preserved: "unconfirmed", reason: "session_preserving_interrupt_adapter_missing" })),
      });
    }, { readOnly: true });
  }

  /** Explicit destructive maintenance primitive, NOT the stop button/control.
   * Historical close tests exercise this path, not interruption acceptance.
   */
  async closeCascade(input: unknown): Promise<z.infer<typeof cascadeStopResultSchema>> {
    const { roots } = cascadeStopRequestSchema.parse(input);
    let admitted = false;
    try {
      const reached = new Map(roots.map(launch => [key(launch), launch]));
      const deadline = performance.now() + this.drainTimeoutMs;
      // Fence first, then drain accepted operations without waiting for idle.
      for (;;) {
        const pending = await this.store.transaction(state => {
          const plan = planCascadeStop([...reached.values()], state.records.map(record => record.relation));
          for (const target of plan.targets) reached.set(key(target), target);
          for (const launch of reached.values()) if (!stopped(state, launch)) state.stopping.push(launch);
          for (const record of state.records) if (record.relation.phase === "reserved"
            && (stopped(state, record.relation.source?.launch)
              || (record.reservation.target.expected_launch_id && [...reached.values()].some(value =>
                value.session_id === record.reservation.target.session_id && value.launch_id === record.reservation.target.expected_launch_id)))) {
            record.relation.phase = "unsent";
            record.operations.send = "not_sent";
          }
          retireSettledBranches(state);
          return state.slots.filter(slot => [...reached.values()].some(value => value.session_id === slot.session_id)
            || stopped(state, slot.source)
            || slot.sources?.some(source => stopped(state, source))
            || (slot.request && stopped(state, find(state, slot.request).relation.source?.launch)));
        });
        admitted = true;
        if (!pending.some(slot => slot.state === "issued") || performance.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const outcomes: z.infer<typeof cascadeStopResultSchema>["targets"] = [];
      for (const launch of reached.values()) outcomes.push(await this.closeExpected(launch));
      return await this.store.transaction(async state => {
        const plan = planCascadeStop([...reached.values()], state.records.map(record => record.relation));
        const unresolved: z.infer<typeof cascadeStopResultSchema>["unresolved"] = plan.gaps.map(gap => ({ request: gap.request, reason: gap.reason }));
        for (const slot of state.slots) if ([...reached.values()].some(value => value.session_id === slot.session_id)
          || stopped(state, slot.source)
          || (slot.request && stopped(state, find(state, slot.request).relation.source?.launch)))
          unresolved.push({ request: slot.request, reason: "issued_operation_unconfirmed" });
        for (const target of plan.targets) if (!reached.has(key(target)))
          unresolved.push({ request: null, reason: "late_target_unconfirmed" });
        const coverage = await this.runtime.coverage(roots);
        if (coverage !== "complete") unresolved.push({ request: null, reason: "relation_coverage_incomplete" });
        const allClosed = outcomes.every(value => value.outcome === "closed" || value.outcome === "already_closed");
        const anyClosed = outcomes.some(value => value.outcome === "closed" || value.outcome === "already_closed");
        return cascadeStopResultSchema.parse({ schema: "aiterm.cascade-stop-result.v1", roots,
          status: allClosed && !unresolved.length ? "stopped" : anyClosed ? "partial" : "unconfirmed",
          relation_coverage: coverage === "complete" && !unresolved.length ? "complete" : "incomplete", unresolved, targets: outcomes });
      });
    } catch (error) {
      // Once stop admission was committed it may already have drained/closed
      // targets. A later metadata refusal cannot turn that into not_started.
      if (admitted) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      throw error;
    }
  }

  private async closeExpected(launch: ExecutionLaunch): Promise<z.infer<typeof cascadeStopResultSchema>["targets"][number]> {
    const result = (outcome: z.infer<typeof cascadeStopResultSchema>["targets"][number]["outcome"], reason: string) => ({ launch, outcome, reason });
    const permission = await this.store.transaction(async state => {
      if (state.slots.some(slot => slot.session_id === launch.session_id)) return "unknown" as const;
      const current = await this.runtime.observe(launch.session_id).catch((): Observation => ({ state: "unknown" }));
      if (current.state === "unknown" || (current.state === "present" && !current.launch)) return "unknown" as const;
      if (current.state === "absent") { this.interruptRelations(state, launch); return "absent" as const; }
      if (!same(current.launch, launch)) return "replaced" as const;
      state.slots.push({ session_id: launch.session_id, expected_launch_id: launch.launch_id, stage: "close", state: "issued", request: null });
      return "close" as const;
    });
    if (permission !== "close") return result(permission === "absent" ? "already_closed" : permission, `expected_launch_${permission}`);
    let observed = false;
    try {
      await this.runtime.close(launch); // one invocation, never retry on reject
      observed = true;
      const current = await this.runtime.observe(launch.session_id);
      if (current.state !== "absent") throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      await this.store.transaction(state => {
        state.slots = state.slots.filter(slot => !(slot.session_id === launch.session_id && slot.stage === "close"));
        this.interruptRelations(state, launch);
      });
      return result("closed", "expected_launch_absence_confirmed");
    } catch (error) {
      if (!observed && error instanceof ExecutionError && error.effect === "not_started") {
        try { await this.store.transaction(state => {
          state.slots = state.slots.filter(slot => !(slot.session_id === launch.session_id && slot.stage === "close"));
        }); } catch { return result("unknown", "close_metadata_unconfirmed"); }
        return result(error.code === "EXECUTION_UNSUPPORTED" ? "unsupported"
          : error.code === "EXECUTION_STALE_GENERATION" ? "replaced" : "unknown", error.code);
      }
      try { await this.store.transaction(state => {
        const slot = state.slots.find(value => value.session_id === launch.session_id && value.stage === "close");
        if (slot) slot.state = "unknown";
      }); } catch { /* issued close slot still blocks repetition */ }
      return result("unknown", "close_outcome_unconfirmed");
    }
  }

  private interruptRelations(state: ExecutionState, launch: ExecutionLaunch): void {
    for (const record of state.records) if (same(record.relation.target?.launch, launch)) {
      if (record.operations.launch === "unknown" || record.operations.send === "unknown") continue;
      record.relation.completion = "interrupted";
      record.relation.target_fence = "closed";
    }
    retireSettledBranches(state);
  }
}
