// Metadata/admission service with injected runtime. It never owns a payload or
// retries a launch/send/close. The core/MCP adapter is a separate integration.
import { z } from "zod";
import { assessExecutionSource, planCascadeStop, unfinishedExecutionRelations, cascadeStopRequestSchema, cascadeStopResultSchema,
  executionPointSchema, type ExecutionLaunch, type ExecutionPoint, type ExecutionRequest,
  executionLaunchSchema,
  type ExecutionSourceEvidence } from "./execution-contract.js";
import { executionActionSchema, executionRecordSchema, executionRefMetaSchema, executionRootsRequestSchema, executionRootsResultSchema, ExecutionError,
  type ExecutionAction, type ExecutionRecord, type ExecutionRegister, type ExecutionFinish } from "./execution-wire.js";
import type { ExecutionTransportSource } from "./execution-wire.js";
import type { ExecutionState, ExecutionStore } from "./execution-store.js";
import { withExecutionEffectScope, type ExecutionPreparation } from "./execution-effect.js";
import type { ExecutionNativeServer } from "./execution-close.js";

type Observation = { state: "absent" } | { state: "unknown" } | { state: "present"; launch: ExecutionLaunch | null };
export interface ExecutionRuntime {
  sourceEvidence(input: ExecutionRegister, context?: ExecutionTransportSource): Promise<ExecutionSourceEvidence>;
  observe(sessionId: string): Promise<Observation>;
  // Generation-only synchronous read at the first native effect. Its absence
  // makes deferred native admission unsupported, never an async fallback.
  observeSync?(sessionId: string): Observation;
  nativeSessionSync?(sessionId: string): ({ state: "present"; native_id: string } | { state: "absent" | "unknown" }) & { server?: ExecutionNativeServer };
  completion(point: ExecutionPoint): Promise<{ state: "completed" | "interrupted" | "unknown"; fence: "closed" | "unknown" }>;
  close(expected: ExecutionLaunch): Promise<void>;
  // Only adapters covering the execution's actual admission paths may return
  // complete. Old/untracked/remote paths must not be inferred from graph shape.
  coverage(roots: ExecutionLaunch[], sessionIdHint?: string): Promise<"complete" | "incomplete">;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const key = (value: unknown): string => JSON.stringify(value);
const stopped = (state: ExecutionState, launch: ExecutionLaunch | null | undefined): boolean =>
  !!launch && state.stopping.some(value => same(value, launch));
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
function view(state: ExecutionState, record: ExecutionRecord): ExecutionRecord {
  return executionRecordSchema.parse({ ...record,
    stopping: stopped(state, record.relation.source?.launch) || stopped(state, record.relation.target?.launch) });
}
function sourceAdmission(state: ExecutionState, point: ExecutionPoint | null, seatHint: string | null): void {
  if (stopped(state, point?.launch)) throw new ExecutionError("EXECUTION_STOPPING");
  if (state.slots.some(slot => slot.session_id === (point?.launch.session_id ?? seatHint)))
    throw new ExecutionError("EXECUTION_UNCONFIRMED");
  if (!point && seatHint && state.stopping.some(value => value.session_id === seatHint))
    throw new ExecutionError("EXECUTION_UNCONFIRMED");
}
function retireSettledBranches(state: ExecutionState): void {
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

  /** Internal receipt callbacks for the serving launch frame. No tool args,
   * new identifiers, native effects or name-based generation inference.
   */
  prepareCreation(metaInput: unknown): ExecutionNativeServer {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!this.store.transactionSync || !this.runtime.nativeSessionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return this.store.transactionSync(state => {
      const record = find(state, request);
      if (record.operations.launch !== "preparing" || record.relation.lifecycle === "retired") throw new ExecutionError("EXECUTION_CONFLICT");
      const native = this.runtime.nativeSessionSync!(record.reservation.target.session_id);
      if (native.state !== "absent" || !native.server) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return native.server;
    }, { readOnly: true });
  }
  verifyCreationServer(metaInput: unknown, expected: ExecutionNativeServer): void {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    this.store.transactionSync(state => {
      const record = find(state, request), native = this.runtime.nativeSessionSync?.(record.reservation.target.session_id);
      if (!native?.server || !same(native.server, expected)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    }, { readOnly: true });
  }
  captureCreatedNative(metaInput: unknown, session: string, nativeId: string, expectedServer: ExecutionNativeServer, receiptPid: number): void {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (!/^\$\d+$/.test(nativeId) || !this.store.transactionSync) throw new ExecutionError("EXECUTION_UNSUPPORTED", "possible");
    this.store.transactionSync(state => {
      const record = find(state, request), slot = state.slots.find(value => same(value.request, request) && value.stage === "launch");
      if (!slot || slot.state !== "issued" || record.operations.launch !== "issued" || slot.session_id !== session
        || record.reservation.target.expected_launch_id !== null || record.relation.lifecycle === "retired"
        || expectedServer.pid !== receiptPid
        || (slot.created_native_id && slot.created_native_id !== nativeId)
        || (slot.created_server && !same(slot.created_server, expectedServer))) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
      // Preserve this genuine native receipt even if a stop is already fencing
      // its caller. Binding metadata does not authorize another native action.
      slot.created_native_id = nativeId;
      slot.created_server = expectedServer;
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
      if (stopped(state, record.relation.source?.launch) && !stopped(state, launch)) state.stopping.push(launch);
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
    return this.finish(args);
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
      if (state.slots.some(slot => slot.session_id === target.session_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
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
    body: (issue: () => void, prepare: ExecutionPreparation) => Promise<{ value: T; target: ExecutionPoint | null }>, targetSessionId: string): Promise<{ value: T; record: ExecutionRecord }> {
    return this.invokeInternal(metaInput, stage, body, targetSessionId, true);
  }

  private async invokeInternal<T>(metaInput: unknown, stage: "launch" | "send",
    body: (issue: () => void, prepare: ExecutionPreparation) => Promise<{ value: T; target: ExecutionPoint | null }>, targetSessionId: string | undefined,
    deferred: boolean): Promise<{ value: T; record: ExecutionRecord }> {
    const { request } = executionRefMetaSchema.parse(metaInput);
    if (deferred && (!this.store.transactionSync || !this.runtime.observeSync)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    await this.store.transaction(async state => {
      const record = find(state, request);
      const relation = record.relation;
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
    const checkOrIssue = (commit: boolean, preparation: () => unknown): unknown => {
      if (finished) throw new ExecutionError("EXECUTION_CONFLICT");
      if (issued) {
        if (!deferred) return commit ? undefined : preparation();
        // An RPC can issue several native commands with an async readiness
        // wait between them. Owning its slot is not permission to ignore a
        // stop, uncertain slot or generation replacement after the first one.
        return this.store.transactionSync!(state => {
          const record = find(state, request), relation = record.relation;
          const slot = state.slots.find(value => same(value.request, request) && value.stage === stage);
          if (!slot || slot.state !== "issued" || record.operations[stage] !== "issued"
            || relation.lifecycle === "retired") throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (stopped(state, relation.source?.launch)) throw new ExecutionError("EXECUTION_STOPPING");
          if (!relation.source && record.source_session_id && state.stopping.some(value => value.session_id === record.source_session_id))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (state.slots.some(value => value !== slot && value.session_id === (relation.source?.launch.session_id ?? record.source_session_id)))
            throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (relation.source) {
            const source = this.runtime.observeSync!(relation.source.launch.session_id);
            if (source.state === "unknown" || (source.state === "present" && !source.launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
            if (source.state !== "present" || !same(source.launch, relation.source.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
          }
          const current = this.runtime.observeSync!(slot.session_id);
          if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
          if (slot.created_native_id) {
            const native = this.runtime.nativeSessionSync?.(slot.session_id);
            if (!native || native.state !== "present" || native.native_id !== slot.created_native_id
              || !slot.created_server || !same(native.server, slot.created_server))
              throw new ExecutionError("EXECUTION_UNCONFIRMED");
            if (slot.expected_launch_id === null) {
              if (current.state !== "present" || current.launch !== null) throw new ExecutionError("EXECUTION_UNCONFIRMED");
              return preparation(); // bound physical shell, before core publishes its managed launch
            }
          }
          // A fresh launch's expected ID starts null. Until the core adapter
          // binds the exact created generation, do not infer ownership from a
          // new same-name observation merely because this RPC created a slot.
          if (slot.expected_launch_id === null && current.state === "present") throw new ExecutionError("EXECUTION_UNSUPPORTED");
          this.expectTarget(current, slot.expected_launch_id, slot.session_id);
          return preparation();
        }, { readOnly: true });
      }
      const result = this.store.transactionSync!(state => {
        const record = find(state, request), relation = record.relation;
        if (relation.lifecycle === "retired" || relation.phase === "unsent" || record.operations[stage] !== "preparing")
          throw new ExecutionError("EXECUTION_CONFLICT", "not_started");
        sourceAdmission(state, relation.source, record.source_session_id);
        if (relation.source) {
          const source = this.runtime.observeSync!(relation.source.launch.session_id);
          if (source.state === "unknown" || (source.state === "present" && !source.launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
          if (source.state !== "present" || !same(source.launch, relation.source.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
        }
        const target = record.reservation.target;
        if (state.slots.some(slot => slot.session_id === target.session_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        const expected = relation.target?.launch.launch_id ?? target.expected_launch_id;
        const current = this.runtime.observeSync!(target.session_id);
        this.expectTarget(current, expected, target.session_id);
        if (current.state === "present" && stopped(state, current.launch)) throw new ExecutionError("EXECUTION_STOPPING");
        if ((stage === "launch" && current.state !== "absent") || (stage === "send" && current.state !== "present"))
          throw new ExecutionError("EXECUTION_CONFLICT");
        if (!commit) return preparation();
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
        await unissued();
        // No native effect crossed this operation's gate, even if a preflight
        // read/RPC failed. A duplicate invocation failed before owning preparing.
        throw error instanceof ExecutionError ? new ExecutionError(error.code, "not_started")
          : new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
      }
      const certain = !deferred && error instanceof ExecutionError && error.effect === "not_started";
      await this.store.transaction(state => {
        const record = find(state, request);
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
      });
      throw certain ? error : new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
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
      const closing = request.kind === "mcp" && request.tool === "pty_close";
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
      if (stopped(state, record.relation.source?.launch) && !stopped(state, targetPoint.launch))
        state.stopping.push(targetPoint.launch);
      state.slots = state.slots.filter(value => !same(value.request, request));
      if (closing) this.interruptRelations(state, targetPoint.launch);
      return view(state, record);
    }).catch(async () => {
      // The side effect already returned, but its result could not be safely
      // bound/committed. Absence/replacement is not permission to replay it.
      await this.store.transaction(state => {
        const record = find(state, request);
        record.operations[stage] = "unknown";
        record.relation.phase = "submitted_unknown";
        record.relation.completion = "unknown";
        const slot = state.slots.find(value => same(value.request, request));
        if (slot) slot.state = "unknown";
      });
      throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    });
    return { value: outcome.value, record };
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
          record.relation.target_fence = observed.fence === "closed" && pendingParentReturn(state, args.request) ? "unknown" : observed.fence;
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
    try {
      const value = await body();
      const current = await this.runtime.observe(expected.session_id);
      if (stage === "close" ? current.state !== "absent" : current.state !== "present" || !same(current.launch, expected))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      await this.store.transaction(state => {
        state.slots = state.slots.filter(slot => !(slot.session_id === expected.session_id && slot.stage === stage));
        if (stage === "close") this.interruptRelations(state, expected);
      });
      return value;
    } catch (error) {
      const certain = error instanceof ExecutionError && error.effect === "not_started";
      await this.store.transaction(state => {
        const slot = state.slots.find(value => value.session_id === expected.session_id && value.stage === stage);
        if (certain) state.slots = state.slots.filter(value => value !== slot);
        else if (slot) slot.state = "unknown";
      });
      throw certain ? error : new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
    }
  }

  async stop(input: unknown): Promise<z.infer<typeof cascadeStopResultSchema>> {
    const { roots } = cascadeStopRequestSchema.parse(input);
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
      if (!pending.some(slot => slot.state === "issued") || performance.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const outcomes: z.infer<typeof cascadeStopResultSchema>["targets"] = [];
    for (const launch of reached.values()) outcomes.push(await this.closeExpected(launch));
    return this.store.transaction(async state => {
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
    try {
      await this.runtime.close(launch); // one invocation, never retry on reject
      const observed = await this.runtime.observe(launch.session_id);
      if (observed.state !== "absent") throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      await this.store.transaction(state => {
        state.slots = state.slots.filter(slot => !(slot.session_id === launch.session_id && slot.stage === "close"));
        this.interruptRelations(state, launch);
      });
      return result("closed", "expected_launch_absence_confirmed");
    } catch (error) {
      if (error instanceof ExecutionError && error.effect === "not_started") {
        await this.store.transaction(state => {
          state.slots = state.slots.filter(slot => !(slot.session_id === launch.session_id && slot.stage === "close"));
        });
        return result(error.code === "EXECUTION_UNSUPPORTED" ? "unsupported"
          : error.code === "EXECUTION_STALE_GENERATION" ? "replaced" : "unknown", error.code);
      }
      await this.store.transaction(state => {
        const slot = state.slots.find(value => value.session_id === launch.session_id && value.stage === "close");
        if (slot) slot.state = "unknown";
      });
      return result("unknown", "close_outcome_unconfirmed");
    }
  }

  private interruptRelations(state: ExecutionState, launch: ExecutionLaunch): void {
    for (const record of state.records) if (same(record.relation.target?.launch, launch)) {
      record.relation.completion = "interrupted";
      record.relation.target_fence = "closed";
    }
    retireSettledBranches(state);
  }
}
