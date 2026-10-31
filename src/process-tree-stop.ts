import { readRuntimeProcesses, signalRuntimeProcess, processSubtree, type NativeProcessIdentity, type RuntimeProcess } from "./process-runtime.js";

type Signal = "SIGTERM" | "SIGKILL";
export interface ProcessTreeStopRuntime {
  read(): RuntimeProcess[];
  signal(target: NativeProcessIdentity, signal: Signal, group: boolean): void;
  prepare?(body: () => void): void;
  pause(ms: number): Promise<void>;
  now(): number;
}
const same = (a: NativeProcessIdentity, b: NativeProcessIdentity) => a.pid === b.pid
  && a.started_identity === b.started_identity && a.argv_digest === b.argv_digest && a.process_group_id === b.process_group_id;

const nativeRuntime: ProcessTreeStopRuntime = {
  read: () => readRuntimeProcesses(true), signal: signalRuntimeProcess,
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => performance.now(),
};

/** TERM, a five-second grace, then KILL; only the original pane tree and verified groups are selected. */
export async function stopProcessTree(root: NativeProcessIdentity, verify: () => void,
  runtime: ProcessTreeStopRuntime = nativeRuntime): Promise<boolean> {
  if (!Number.isSafeInteger(root.pid) || root.pid <= 1 || root.pid === process.pid) throw new Error("invalid_process_tree_root");
  const initial = runtime.read();
  const liveRoot = initial.find(row => row.pid === root.pid && !row.zombie);
  if (!liveRoot || !same(root, liveRoot)) throw new Error("process_tree_root_changed");
  const tree = processSubtree(initial, root.pid);
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
  const signal = (row: RuntimeProcess, wanted: Signal) => (runtime.prepare ?? (body => body()))(() => {
    verify();
    const current = runtime.read();
    const target = current.find(value => value.pid === row.pid && !value.zombie);
    if (!target || !same(row, target)) return;
    const group = target.process_group_id !== null && groups.has(target.process_group_id)
      && current.filter(value => value.process_group_id === target.process_group_id && !value.zombie)
        .every(value => selected.has(value.pid) && same(selected.get(value.pid)!, value));
    runtime.signal(target, wanted, group);
    if (wanted === "SIGTERM") {
      for (const member of group ? current.filter(value => value.process_group_id === target.process_group_id) : [target]) terminated.add(key(member));
    }
  });
  let until: number | null = null;
  for (;;) {
    const alive = refresh();
    if (alive.length === 0) return true;
    if (until !== null && runtime.now() >= until) break;
    for (const row of childrenFirst(alive)) if (!terminated.has(key(row))) signal(row, "SIGTERM");
    until ??= runtime.now() + 5000;
    await runtime.pause(Math.min(100, Math.max(0, until - runtime.now())));
  }
  for (const row of childrenFirst(refresh())) signal(row, "SIGKILL");
  for (const deadline = runtime.now() + 2000; runtime.now() < deadline;) {
    if (refresh().length === 0) return true;
    await runtime.pause(100);
  }
  return refresh().length === 0;
}
