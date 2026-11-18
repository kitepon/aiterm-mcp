import { readRuntimeProcesses, signalRuntimeProcesses, processSubtree, type NativeProcessIdentity, type RuntimeProcess } from "./process-runtime.js";

type Signal = "SIGTERM" | "SIGHUP" | "SIGKILL";
export interface ProcessTreeStopRuntime {
  read(): RuntimeProcess[];
  signal(target: NativeProcessIdentity, signal: Signal, group: boolean): void;
  /** All targets of one pass in a single call (Windows: one pwsh run). Without it, `signal` is called per target. */
  signalMany?(items: { target: NativeProcessIdentity; group: boolean }[], signal: Signal): void;
  prepare?(body: () => void): void;
  pause(ms: number): Promise<void>;
  now(): number;
}
const same = (a: NativeProcessIdentity, b: NativeProcessIdentity) => a.pid === b.pid
  && a.started_identity === b.started_identity && a.argv_digest === b.argv_digest && a.process_group_id === b.process_group_id;

const nativeRuntime: ProcessTreeStopRuntime = {
  read: () => readRuntimeProcesses(true), signal: (target, signal, group) => signalRuntimeProcesses([{ target, group }], signal), signalMany: signalRuntimeProcesses,
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => performance.now(),
};

/** TERM, a five-second grace, then KILL; only the original pane tree and verified groups are selected.
 * An interactive shell ignores TERM, so once its children are gone and only the pane root is left it is hung up,
 * as a closing terminal would. A root that started alone keeps the full grace. */
export async function stopProcessTree(root: NativeProcessIdentity, verify: () => void,
  runtime: ProcessTreeStopRuntime = nativeRuntime): Promise<boolean> {
  if (!Number.isSafeInteger(root.pid) || root.pid <= 1 || root.pid === process.pid) throw new Error("invalid_process_tree_root");
  const initial = runtime.read();
  const liveRoot = initial.find(row => row.pid === root.pid && !row.zombie);
  if (!liveRoot || !same(root, liveRoot)) throw new Error("process_tree_root_changed");
  if (liveRoot.session_identity === null) throw new Error("process_tree_session_unconfirmed");
  const tree = processSubtree(initial, root.pid);
  if (tree.some(row => row.session_identity === null)) throw new Error("process_tree_session_unconfirmed");
  if (tree.some(row => row.pid === process.pid)) throw new Error("process_tree_contains_checker");
  const inSession = (row: RuntimeProcess) => liveRoot.session_identity === undefined || row.session_identity === liveRoot.session_identity;
  const selected = new Map(tree.filter(inSession).map(row => [row.pid, row]));
  const groups = new Set([...selected.values()].map(row => row.process_group_id).filter((group): group is number =>
    group !== null && group > 1 && initial.some(row => row.pid === group && selected.has(row.pid))
    && initial.filter(row => row.process_group_id === group).every(row => selected.has(row.pid))));
  const terminated = new Set<string>();
  const key = (row: NativeProcessIdentity) => `${row.pid}:${row.started_identity}`;
  const childrenFirst = (rows: RuntimeProcess[]) => {
    const depth = (row: RuntimeProcess) => {
      const seen = new Set<number>();
      for (let parent = selected.get(row.parent_pid); parent && !seen.has(parent.pid); parent = selected.get(parent.parent_pid)) seen.add(parent.pid);
      return seen.size;
    };
    return [...rows].sort((a, b) => depth(b) - depth(a));
  };
  const refresh = (): RuntimeProcess[] => {
    const rows = runtime.read();
    const still = rows.filter(row => !row.zombie && selected.has(row.pid) && same(selected.get(row.pid)!, row));
    for (const parent of still) for (const row of processSubtree(rows, parent.pid)) {
      if (inSession(row) && !selected.has(row.pid)) selected.set(row.pid, row);
    }
    for (const row of rows) if (inSession(row) && row.process_group_id !== null && groups.has(row.process_group_id)) {
      if (!selected.has(row.pid)) selected.set(row.pid, row);
    }
    if (selected.has(process.pid)) throw new Error("process_tree_contains_checker");
    return rows.filter(row => !row.zombie && selected.has(row.pid) && same(selected.get(row.pid)!, row));
  };
  // One verify and one process-table read per pass, not per target: on Windows each is a pwsh run, so a 30-process seat took 68 s
  // (fox, 2026-11-18) and a remote hibernate outlived the caller's 60 s wait. Each target is still compared with that fresh table.
  const pass = (rows: RuntimeProcess[], wanted: Signal) => (runtime.prepare ?? (body => body()))(() => {
    verify();
    const current = runtime.read();
    const items: { target: RuntimeProcess; group: boolean }[] = [];
    for (const row of rows) {
      if (wanted === "SIGTERM" && terminated.has(key(row))) continue;
      const target = current.find(value => value.pid === row.pid && !value.zombie);
      if (!target || !same(row, target)) continue;
      const group = target.process_group_id !== null && groups.has(target.process_group_id)
        && current.filter(value => value.process_group_id === target.process_group_id && !value.zombie)
          .every(value => selected.has(value.pid) && same(selected.get(value.pid)!, value));
      items.push({ target, group });
      if (wanted === "SIGTERM") {
        for (const member of group ? current.filter(value => value.process_group_id === target.process_group_id) : [target]) terminated.add(key(member));
      }
    }
    if (runtime.signalMany) { if (items.length) runtime.signalMany(items, wanted); }
    else for (const { target, group } of items) runtime.signal(target, wanted, group);
  });
  let until: number | null = null, hungUp = false;
  for (;;) {
    const alive = refresh();
    if (alive.length === 0) return true;
    if (until !== null && runtime.now() >= until) break;
    pass(childrenFirst(alive).filter(row => !terminated.has(key(row))), "SIGTERM");
    if (until !== null && !hungUp && tree.length > 1 && alive.length === 1 && alive[0].pid === root.pid) { pass(alive, "SIGHUP"); hungUp = true; }
    until ??= runtime.now() + 5000;
    await runtime.pause(Math.min(100, Math.max(0, until - runtime.now())));
  }
  pass(childrenFirst(refresh()), "SIGKILL");
  for (const deadline = runtime.now() + 2000; runtime.now() < deadline;) {
    if (refresh().length === 0) return true;
    await runtime.pause(100);
  }
  return refresh().length === 0;
}
