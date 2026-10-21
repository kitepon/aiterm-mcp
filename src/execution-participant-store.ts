// Scoped metadata store for an explicitly composed private participant. A
// registration can only be written by construction, never inferred on use.
import { FileExecutionStore, type ExecutionState } from "./execution-store.js";
import { executionActorSchema, executionParticipantRoleSchema, executionParticipantInventory,
  type ExecutionActor, type ExecutionParticipantRole } from "./execution-inventory.js";
import { ExecutionError } from "./execution-wire.js";

export class ParticipantExecutionStore extends FileExecutionStore {
  private readonly actor: ExecutionActor;
  private roles: ExecutionParticipantRole[] = [];
  constructor(directory: string, actor: ExecutionActor, private readonly assertScope: () => void) {
    super(directory, 2000, actor); this.actor = executionActorSchema.parse(actor);
  }
  enroll(roles: readonly ExecutionParticipantRole[]): void {
    const requested = [...new Set([...this.roles, ...roles.map(role => executionParticipantRoleSchema.parse(role))])];
    if (!requested.length) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    this.assertScope();
    super.transactionSync(state => {
      this.assertScope();
      const row = state.participants.find(row => row.actor.pid === this.actor.pid && row.actor.started_identity === this.actor.started_identity);
      if (row) row.roles = [...new Set([...row.roles, ...requested])];
      else state.participants.push({ actor: { ...this.actor }, roles: requested });
    });
    this.roles = requested;
  }
  private check(state: ExecutionState): void {
    const row = state.participants.find(row => row.actor.pid === this.actor.pid && row.actor.started_identity === this.actor.started_identity);
    if (!this.roles.length || !row || this.roles.some(role => !row.roles.includes(role))) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  }
  override transactionSync<T>(body: (state: ExecutionState) => T, options: { readOnly?: boolean } = {}): T {
    return super.transactionSync(state => {
      if (!options.readOnly) this.assertScope();
      this.check(state); const value = body(state);
      if (value && typeof (value as { then?: unknown }).then === "function") {
        void Promise.resolve(value).catch(() => undefined); throw new ExecutionError("EXECUTION_INVALID");
      }
      this.check(state);
      if (!options.readOnly) this.assertScope();
      return value;
    }, options);
  }
  override transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    return super.transaction(async state => {
      if (!options.readOnly) this.assertScope();
      this.check(state); const value = await body(state); this.check(state);
      if (!options.readOnly) this.assertScope();
      return value;
    }, options);
  }
  override recoverAbandonedLock(expected: ExecutionActor, observeOwner: (pid: number) => unknown) {
    this.assertScope();
    return super.recoverAbandonedLock(expected, pid => { this.assertScope(); const value = observeOwner(pid); this.assertScope(); return value; });
  }
  interruptionActor(): ExecutionActor {
    this.assertScope();
    if (!this.roles.includes("mcp")) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return { ...this.actor };
  }
  // Raw read deliberately permits diagnosis of a missing declaration. It has
  // no write/re-enrollment path and never enters another store lock.
  inventory(observeActors?: (pids: number[]) => unknown) {
    return super.transactionSync(state => executionParticipantInventory(state, observeActors), { readOnly: true });
  }
}
