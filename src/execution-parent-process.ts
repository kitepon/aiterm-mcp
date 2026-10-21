// Read-only native source snapshot; adapters supply the actual core functions.
// No shell/PTY/API operation at module import and no test/live fallback.
import type { RuntimeProcess } from "./process-runtime.js";

export function readExecutionParentProcess<T extends { launch_id: string }>(name: string, bindings: {
  present(): boolean; metadata(): T | null;
  pane(): { code: number; stdout: string };
  processes(): RuntimeProcess[];
  select(meta: T, rows: RuntimeProcess[], panePid: number): { harness: string; processes: RuntimeProcess[] };
}): unknown {
  if (!bindings.present()) return null;
  const meta = bindings.metadata();
  if (!meta) return null;
  const launch_id = meta.launch_id;
  const pane = bindings.pane();
  if (pane.code !== 0) return null;
  const fields = pane.stdout.trim().split("\t"), pid = Number(fields[0]);
  if (fields.length !== 2 || !/^[1-9][0-9]*$/.test(fields[0]) || !Number.isSafeInteger(pid) || fields[1] !== "0") return null;
  const rows = bindings.processes();
  if (!rows.some(row => row.pid === pid)) return null;
  const selected = bindings.select(meta, rows, pid);
  if (selected.processes.length !== 1) return null;
  const after = bindings.pane();
  if (after.code !== 0 || after.stdout.trim() !== pane.stdout.trim() || bindings.metadata()?.launch_id !== launch_id) return null;
  const identity = ({ pid, started_identity }: RuntimeProcess) => ({ pid, started_identity });
  return { schema: "aiterm.execution-parent-process.v1",
    source: { launch: { session_id: name, launch_id }, boundary: null }, harness: selected.harness,
    harness_process: identity(selected.processes[0]),
    processes: rows.map(row => ({ ...identity(row), parent_pid: row.parent_pid })),
  };
}
