// Ownership/recovery for the existing short metadata mutex only. Not an
// invocation fence, lease, work ID, queue, retry or automatic stale-lock reap.
import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { executionActorSchema, type ExecutionActor } from "./execution-inventory.js";
import { ExecutionError } from "./execution-wire.js";

const ownerSchema = z.object({ schema: z.literal("aiterm.execution-lock-owner.v1"), actor: executionActorSchema }).strict();
const observationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("present"), actor: executionActorSchema }).strict(),
  z.object({ state: z.literal("absent"), pid: executionActorSchema.shape.pid }).strict(),
  z.object({ state: z.literal("unknown"), pid: executionActorSchema.shape.pid }).strict(),
]);
export type ExecutionActorObservation = z.infer<typeof observationSchema>;
type Identity = Pick<fs.BigIntStats, "dev" | "ino">;
type OwnerFile = { bytes: string; stat: fs.BigIntStats; actor: ExecutionActor };
export type ExecutionLock = { file: string; stat: Identity; owner: OwnerFile | null };
const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const sameActor = (a: ExecutionActor, b: ExecutionActor) => a.pid === b.pid && a.started_identity === b.started_identity;
const fail = () => new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "not_started");

function readLock(file: string): ExecutionLock {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isDirectory()) throw fail();
  const names = fs.readdirSync(file);
  if (names.length === 0) return { file, stat: before, owner: null };
  if (names.length !== 1 || names[0] !== "owner.json") throw fail();
  const ownerPath = path.join(file, "owner.json"), first = fs.lstatSync(ownerPath, { bigint: true });
  if (!first.isFile()) throw fail();
  const bytes = fs.readFileSync(ownerPath, "utf8"), parsed = ownerSchema.parse(JSON.parse(bytes));
  const last = fs.lstatSync(ownerPath, { bigint: true }), after = fs.lstatSync(file, { bigint: true });
  if (!sameIdentity(first, last) || first.size !== last.size || first.mtimeNs !== last.mtimeNs
    || first.ctimeNs !== last.ctimeNs || !sameIdentity(before, after) || !after.isDirectory()) throw fail();
  return { file, stat: before, owner: { bytes, stat: last, actor: parsed.actor } };
}
function sameLock(expected: ExecutionLock): boolean {
  try {
    const current = readLock(expected.file);
    return sameIdentity(current.stat, expected.stat) && (expected.owner === null ? current.owner === null
      : current.owner !== null && current.owner.bytes === expected.owner.bytes
        && sameIdentity(current.owner.stat, expected.owner.stat)
        && current.owner.stat.mtimeNs === expected.owner.stat.mtimeNs && current.owner.stat.ctimeNs === expected.owner.stat.ctimeNs);
  } catch { return false; }
}
function createLock(file: string, actor: ExecutionActor | null): ExecutionLock {
  fs.mkdirSync(file, { mode: 0o700 });
  if (actor) fs.writeFileSync(path.join(file, "owner.json"), JSON.stringify({ schema: "aiterm.execution-lock-owner.v1", actor }) + "\n",
    { mode: 0o600, flag: "wx" });
  // An interrupted/partial owner write remains unavailable rather than being
  // interpreted as an unowned empty lock that may safely be stolen.
  return readLock(file);
}
export function acquireExecutionLock(directory: string, actor: ExecutionActor | null): ExecutionLock {
  return createLock(path.join(directory, "transaction.lock"), actor);
}
/** Never unlink a replacement lock, an unknown owner, or extra files. A failed
 * unlock preserves availability uncertainty; it does not roll back a native
 * receipt or grant another process ownership of this transaction.
 */
export function releaseExecutionLock(lock: ExecutionLock): boolean {
  if (!sameLock(lock)) return false;
  try {
    if (lock.owner) fs.unlinkSync(path.join(lock.file, "owner.json"));
    fs.rmdirSync(lock.file); return true;
  } catch { return false; }
}

/** Explicit private repair. Atomically quarantine the dead owner's mutex at
 * its existing filesystem identity. Keep this nonempty directory permanently:
 * a competing repair of the same inode cannot rename a newly acquired mutex
 * over it. No second recovery mutex, automatic reap or clock expiry is needed.
 * Journal/slots/graph are never read/reset or treated as completed, not_sent,
 * interruption proof or actor-fence evidence.
 */
export function recoverExecutionLock(directory: string, caller: ExecutionActor, expectedInput: ExecutionActor,
  observeOwner: (pid: number) => unknown) {
  const expected = executionActorSchema.parse(expectedInput);
  if (typeof observeOwner !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (sameActor(executionActorSchema.parse(caller), expected)) throw fail();
  let released = false;
  try {
    const lock = readLock(path.join(directory, "transaction.lock"));
    if (!lock.owner || !sameActor(lock.owner.actor, expected)) throw fail();
    const absent = () => {
      const value = observeOwner(expected.pid);
      if (value && typeof (value as { then?: unknown }).then === "function") {
        void Promise.resolve(value).catch(() => undefined); throw fail();
      }
      const observed = observationSchema.parse(value);
      // A different formatted start identity alone does not prove the old
      // owner died (for example a changed process-display timezone). Require
      // explicit native PID absence; live/reused/unreadable PIDs stay blocked.
      if (observed.state !== "absent" || observed.pid !== expected.pid) throw fail();
    };
    absent();
    if (!sameLock(lock)) throw fail();
    absent();
    if (!sameLock(lock)) throw fail();
    const quarantine = path.join(directory, `abandoned-transaction-lock-${lock.stat.dev}-${lock.stat.ino}`);
    try { fs.lstatSync(quarantine); throw fail(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // All successful competitors retain the same nonempty destination. POSIX
    // and Windows directory rename cannot replace it with a later live lock.
    fs.renameSync(lock.file, quarantine);
    released = true;
    if (!sameLock({ ...lock, file: quarantine })) throw fail();
    return { schema: "aiterm.execution-lock-recovery.v1" as const, owner: expected,
      outcome: "released" as const, operation_state: "unreconciled" as const,
      quarantine: "retained" as const,
      native_fence: "unknown" as const, relation_coverage: "incomplete" as const };
  } catch {
    throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", released ? "possible" : "not_started");
  }
}
