// A1 overlap validation. Pure data: no package execution, file or process access.
// The caller binds each declaration to its verified signed archive; this module
// only decides whether a candidate and EVERY live/recovery generation share formats.
export const RUNTIME_OVERLAP_SCHEMA = "aiterm.runtime-overlap.v1" as const;
export const RUNTIME_ADOPTION_ABI = "aiterm.runtime-adoption.v1" as const;
export const LEGACY_RUNTIME_IDENTITY = "legacy-v1" as const;

// Every store with its own on-disk reader. A store missing from either side is unsupported.
export const RUNTIME_OVERLAP_STORES = ["agent-metadata", "execution-metadata", "parent-delivery",
  "provider-hooks", "events", "runtime-errors"] as const;

export interface RuntimeOverlapDeclaration {
  schema: typeof RUNTIME_OVERLAP_SCHEMA;
  manager_abi?: string;
  stores: Record<string, { writes: string; reads: string[] }>;
}

// Releases shipped before the declaration existed all write/read the strict v1
// shapes and steer-v1 provider records. A live peer may name it explicitly.
export const LEGACY_RUNTIME_DECLARATION: RuntimeOverlapDeclaration = Object.freeze({
  schema: RUNTIME_OVERLAP_SCHEMA,
  stores: Object.freeze(Object.fromEntries(RUNTIME_OVERLAP_STORES.map(store =>
    [store, Object.freeze({ writes: store === "provider-hooks" ? "steer-v1" : "v1",
      reads: Object.freeze([store === "provider-hooks" ? "steer-v1" : "v1"]) as unknown as string[] })]))),
}) as RuntimeOverlapDeclaration;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function parseRuntimeOverlapDeclaration(value: unknown): RuntimeOverlapDeclaration {
  if (value === LEGACY_RUNTIME_IDENTITY) return LEGACY_RUNTIME_DECLARATION;
  const fail = (): never => { throw new Error("RUNTIME_OVERLAP_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["schema", "manager_abi", "stores"].includes(key))) fail();
  if (input.schema !== RUNTIME_OVERLAP_SCHEMA) fail();
  if (input.manager_abi !== undefined && (typeof input.manager_abi !== "string" || !TOKEN.test(input.manager_abi))) fail();
  const stores = input.stores;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) fail();
  const parsed: Record<string, { writes: string; reads: string[] }> = {};
  for (const [store, entry] of Object.entries(stores as Record<string, unknown>)) {
    if (!TOKEN.test(store) || !entry || typeof entry !== "object" || Array.isArray(entry)) fail();
    const { writes, reads, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length || typeof writes !== "string" || !TOKEN.test(writes) || !Array.isArray(reads)
      || reads.length === 0 || reads.length > 16 || reads.some(format => typeof format !== "string" || !TOKEN.test(format))
      || !reads.includes(writes)) fail();
    parsed[store] = { writes: writes as string, reads: [...new Set(reads as string[])] };
  }
  return { schema: RUNTIME_OVERLAP_SCHEMA, ...(input.manager_abi ? { manager_abi: input.manager_abi as string } : {}), stores: parsed };
}

export interface RuntimeOverlapDecision {
  supported: boolean;
  common_formats: Record<string, string>;
  conflicts: { peer: number; store: string; reason: "missing" | "candidate_unreadable_by_peer" | "peer_unreadable_by_candidate" }[];
}

/** Candidate writes must be readable by every live peer and every peer write by
 * the candidate. Pairwise-against-latest is never enough: pass ALL live peers. */
export function decideRuntimeOverlap(candidateInput: unknown, liveInput: unknown[]): RuntimeOverlapDecision {
  const candidate = parseRuntimeOverlapDeclaration(candidateInput);
  if (!Array.isArray(liveInput) || liveInput.length === 0 || liveInput.length > 32) throw new Error("RUNTIME_OVERLAP_INVALID");
  const live = liveInput.map(parseRuntimeOverlapDeclaration);
  const conflicts: RuntimeOverlapDecision["conflicts"] = [];
  const common: Record<string, string> = {};
  for (const store of RUNTIME_OVERLAP_STORES) {
    const own = candidate.stores[store];
    live.forEach((peer, index) => {
      const theirs = peer.stores[store];
      if (!own || !theirs) conflicts.push({ peer: index, store, reason: "missing" });
      else {
        if (!theirs.reads.includes(own.writes)) conflicts.push({ peer: index, store, reason: "candidate_unreadable_by_peer" });
        if (!own.reads.includes(theirs.writes)) conflicts.push({ peer: index, store, reason: "peer_unreadable_by_candidate" });
      }
    });
    if (own) common[store] = own.writes;
  }
  if (candidate.manager_abi !== RUNTIME_ADOPTION_ABI) conflicts.push({ peer: -1, store: "manager_abi", reason: "missing" });
  return { supported: conflicts.length === 0, common_formats: conflicts.length ? {} : common, conflicts };
}
