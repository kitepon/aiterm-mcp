// Private metadata diagnostics, not native discovery, launch proof or a fence.
// All keys below are existing process/request/delivery identities.
import { z } from "zod";
import type { ExecutionState } from "./execution-store.js";
import type { ExecutionRequest, ExecutionPoint } from "./execution-contract.js";

export const executionActorSchema = z.object({
  pid: z.number().int().positive().safe(),
  started_identity: z.string().min(1).max(256).refine(value => Number.isFinite(Date.parse(value))),
}).strict();
export const executionParticipantRoleSchema = z.enum(["mcp", "parent_producer", "parent_worker"]);
export const executionParticipantSchema = z.object({
  actor: executionActorSchema,
  roles: z.array(executionParticipantRoleSchema).min(1).refine(values => new Set(values).size === values.length),
}).strict();
export type ExecutionActor = z.infer<typeof executionActorSchema>;
export type ExecutionParticipantRole = z.infer<typeof executionParticipantRoleSchema>;
type Reference = { kind: "mcp"; request: ExecutionRequest }
  | { kind: "parent_source"; delivery_id: string; request: ExecutionRequest }
  | { kind: "parent_effect"; delivery_id: string; stage: "dequeue" | "emit" | "wake"; state: "issued" | "accepted" | "unknown" }
  | { kind: "interruption"; run: ExecutionPoint; phase: "preparing" | "issued" | "accepted" | "unknown" };
type Entry = { actor: ExecutionActor; declared_roles: ExecutionParticipantRole[];
  native_identity: "matched" | "unavailable" | "replaced";
  references: Reference[]; missing: ("unregistered_actor" | "role_missing" | "native_unavailable" | "native_replaced")[] };
const key = (actor: ExecutionActor) => JSON.stringify([actor.pid, actor.started_identity]);

/** Snapshot of declarations and still-unresolved existing references. Reading
 * it cannot enroll, repair, retire, fence or issue anything. Actor matches say
 * nothing about a launch, native turn, or unobserved processes/entrypoints.
 */
export function executionParticipantInventory(state: ExecutionState,
  observeActors?: (pids: number[]) => unknown) {
  const entries = new Map<string, Entry>(), required = new Map<string, Set<ExecutionParticipantRole>>();
  const get = (actor: ExecutionActor): Entry => {
    let entry = entries.get(key(actor));
    if (!entry) {
      entry = { actor: { ...actor }, declared_roles: [], native_identity: "unavailable", references: [], missing: [] };
      entries.set(key(actor), entry);
    }
    return entry;
  };
  for (const participant of state.participants) get(participant.actor).declared_roles = [...participant.roles];
  const add = (actor: ExecutionActor, role: ExecutionParticipantRole, reference: Reference) => {
    const entry = get(actor), roles = required.get(key(actor)) ?? new Set<ExecutionParticipantRole>();
    roles.add(role); required.set(key(actor), roles);
    if (!entry.references.some(value => JSON.stringify(value) === JSON.stringify(reference))) entry.references.push(structuredClone(reference));
  };
  const mcp = (request: ExecutionRequest, reference: Reference) => {
    if (request.kind === "mcp") add({ pid: request.process_pid, started_identity: request.process_started_identity }, "mcp", reference);
  };
  for (const record of state.records) if (record.relation.lifecycle !== "retired" && record.relation.phase !== "unsent")
    mcp(record.reservation.request, { kind: "mcp", request: record.reservation.request });
  for (const slot of state.slots) if (slot.request) mcp(slot.request, { kind: "mcp", request: slot.request });
  for (const row of state.interruptions) if (row.caller && ["preparing", "issued", "accepted", "unknown"].includes(row.phase))
    add(row.caller, "mcp", { kind: "interruption", run: row.before.run,
      phase: row.phase as "preparing" | "issued" | "accepted" | "unknown" });
  for (const binding of state.parent_deliveries) {
    const original = state.records.find(record => JSON.stringify(record.reservation.request) === JSON.stringify(binding.request));
    const returning = state.records.find(record => record.reservation.request.kind === "delivery"
      && record.reservation.request.delivery_id === binding.delivery_id
      && record.reservation.request.target_session_id === binding.parent.launch.session_id);
    const unresolved = !original || !returning || original.relation.lifecycle !== "retired" || returning.relation.lifecycle !== "retired"
      || state.parent_effects.some(effect => effect.delivery_id === binding.delivery_id && effect.state !== "accepted");
    if (unresolved) {
      mcp(binding.request, { kind: "parent_source", delivery_id: binding.delivery_id, request: binding.request });
      if (binding.source_evidence) mcp(binding.source_evidence.request,
        { kind: "parent_source", delivery_id: binding.delivery_id, request: binding.source_evidence.request });
    }
    for (const effect of state.parent_effects.filter(effect => effect.delivery_id === binding.delivery_id))
      if (unresolved || effect.state !== "accepted") add(effect.actor, "parent_worker", { kind: "parent_effect",
        delivery_id: effect.delivery_id, stage: effect.stage, state: effect.state });
  }
  // A damaged/orphaned in-flight effect must not disappear just because its
  // companion binding was lost. Its existing actor/reference remains visible.
  for (const effect of state.parent_effects) if (effect.state !== "accepted"
    || !state.parent_deliveries.some(binding => binding.delivery_id === effect.delivery_id)) add(effect.actor, "parent_worker",
    { kind: "parent_effect", delivery_id: effect.delivery_id, stage: effect.stage, state: effect.state });
  const pids = [...new Set([...entries.values()].map(entry => entry.actor.pid))];
  let observed: { pid: number; started_identity: string | null }[] | undefined;
  try {
    const value = observeActors?.([...pids]);
    if (value && (typeof value === "object" || typeof value === "function") && "then" in value) {
      void Promise.resolve(value).catch(() => {}); // an async probe is missing synchronous evidence
      throw new Error("native inventory observation must be synchronous");
    }
    const rows = z.array(z.object({ pid: z.number().int().positive().safe(),
      started_identity: executionActorSchema.shape.started_identity.nullable() }).strict()).parse(value);
    if (new Set(rows.map(row => row.pid)).size === rows.length && rows.every(row => pids.includes(row.pid))) observed = rows;
  } catch { /* unavailable evidence never means empty/finished */ }
  for (const [id, entry] of entries) {
    const row = observed?.find(row => row.pid === entry.actor.pid);
    entry.native_identity = row?.started_identity ? row.started_identity === entry.actor.started_identity ? "matched" : "replaced" : "unavailable";
    if (!entry.declared_roles.length && entry.references.length) entry.missing.push("unregistered_actor");
    else if ([...(required.get(id) ?? [])].some(role => !entry.declared_roles.includes(role))) entry.missing.push("role_missing");
    if (entry.native_identity !== "matched") entry.missing.push(entry.native_identity === "replaced" ? "native_replaced" : "native_unavailable");
  }
  return { schema: "aiterm.execution-inventory.v1" as const, participants: [...entries.values()],
    participant_discovery: "unproven" as const, native_fence: "unknown" as const, relation_coverage: "incomplete" as const };
}
