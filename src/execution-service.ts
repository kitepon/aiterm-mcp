// Metadata/admission service with injected runtime. It never owns a payload or
// retries a launch/send/close. The core/MCP adapter is a separate integration.
import { z } from "zod";
import { assessExecutionSource, planCascadeStop, cascadeStopRequestSchema, cascadeStopResultSchema,
  executionPointSchema, type ExecutionLaunch, type ExecutionPoint, type ExecutionRequest,
  type ExecutionSourceEvidence } from "./execution-contract.js";
import { executionActionSchema, executionRecordSchema, executionRefMetaSchema, ExecutionError,
  type ExecutionAction, type ExecutionRecord, type ExecutionRegister, type ExecutionFinish } from "./execution-wire.js";
import type { ExecutionState, ExecutionStore } from "./execution-store.js";

type Observation = { state: "absent" } | { state: "unknown" } | { state: "present"; launch: ExecutionLaunch | null };
export interface ExecutionRuntime {
  sourceEvidence(input: ExecutionRegister): Promise<ExecutionSourceEvidence>;
  observe(sessionId: string): Promise<Observation>;
  completion(point: ExecutionPoint): Promise<{ state: "completed" | "interrupted" | "unknown"; fence: "closed" | "unknown" }>;
  close(expected: ExecutionLaunch): Promise<void>;
  // Only adapters covering the execution's actual admission paths may return
  // complete. Old/untracked/remote paths must not be inferred from graph shape.
  coverage(roots: ExecutionLaunch[]): Promise<"complete" | "incomplete">;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const key = (value: unknown): string => JSON.stringify(value);
const stopped = (state: ExecutionState, launch: ExecutionLaunch | null | undefined): boolean =>
  !!launch && state.stopping.some(value => same(value, launch));
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
    if (relation.phase === "unsent" || (relation.source && relation.target_fence === "closed"
      && (relation.completion === "completed" || relation.completion === "interrupted") && !retained.has(key(relation.request))))
      relation.lifecycle = "retired";
  }
}

export class ExecutionService {
  constructor(private readonly store: ExecutionStore, private readonly runtime: ExecutionRuntime,
    private readonly drainTimeoutMs = 2000) {}

  async execute(input: unknown): Promise<ExecutionRecord> {
    const args = executionActionSchema.parse(input);
    if (args.action === "register") return this.register(args);
    if (args.action === "status") return this.store.transaction(state => view(state, find(state, args.request)));
    return this.finish(args);
  }

  private async register(args: ExecutionRegister): Promise<ExecutionRecord> {
    return this.store.transaction(async state => {
      const previous = state.records.find(record => same(record.reservation.request, args.reservation.request));
      if (previous) {
        if (!same(previous.reservation, args.reservation) || previous.source_session_id !== args.source_session_id)
          throw new ExecutionError("EXECUTION_CONFLICT", "possible");
        return view(state, previous); // idempotent lookup, never a second invocation
      }
      const source = assessExecutionSource(args.reservation.source, await this.runtime.sourceEvidence(args));
      if (source.status === "stale") throw new ExecutionError("EXECUTION_STALE_GENERATION");
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
    body: () => Promise<{ value: T; target: ExecutionPoint }>): Promise<{ value: T; record: ExecutionRecord }> {
    const { request } = executionRefMetaSchema.parse(metaInput);
    await this.store.transaction(async state => {
      const record = find(state, request);
      const relation = record.relation;
      if (relation.lifecycle === "retired" || relation.phase === "unsent" || record.operations[stage] !== "not_issued")
        throw new ExecutionError("EXECUTION_CONFLICT", record.operations[stage] === "not_sent" ? "not_started" : "possible");
      sourceAdmission(state, relation.source, record.source_session_id);
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
    let outcome: { value: T; target: ExecutionPoint };
    try {
      outcome = await body();
      outcome.target = executionPointSchema.parse(outcome.target);
    } catch (error) {
      const certain = error instanceof ExecutionError && error.effect === "not_started";
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
    const record = await this.store.transaction(async state => {
      const record = find(state, request);
      const slot = state.slots.find(value => same(value.request, request));
      if (!slot || slot.stage !== stage || record.operations[stage] !== "issued")
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const expected = slot.expected_launch_id;
      if (outcome.target.launch.session_id !== slot.session_id
        || (expected !== null && outcome.target.launch.launch_id !== expected))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      const current = await this.runtime.observe(slot.session_id);
      if (current.state !== "present" || !same(current.launch, outcome.target.launch))
        throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      record.operations[stage] = "accepted";
      // A launch with an initial prompt already performed this reference's
      // send. Only an empty launch may be followed by a separate pty_send.
      if (stage === "launch" && outcome.target.boundary) record.operations.send = "accepted";
      record.relation.target = outcome.target;
      record.relation.phase = "invoked";
      record.relation.completion = "open";
      if (stopped(state, record.relation.source?.launch) && !stopped(state, outcome.target.launch))
        state.stopping.push(outcome.target.launch);
      state.slots = state.slots.filter(value => !same(value.request, request));
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
          record.relation.target_fence = observed.fence;
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
  async changeSession<T>(expected: ExecutionLaunch, stage: "close" | "configure", body: () => Promise<T>): Promise<T> {
    await this.store.transaction(async state => {
      if (stopped(state, expected)) throw new ExecutionError("EXECUTION_STOPPING");
      if (state.slots.some(slot => slot.session_id === expected.session_id)) throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
      this.expectTarget(await this.runtime.observe(expected.session_id), expected.launch_id, expected.session_id);
      state.slots.push({ session_id: expected.session_id, expected_launch_id: expected.launch_id,
        stage, state: "issued", request: null });
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
    } catch {
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
