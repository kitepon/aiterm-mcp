// core.readSeatTurns on one persistent worker thread, so the server keeps answering other calls meanwhile
// (observation-results.md readSeatTurns, 0.70.43; before, ~2.4 s of production seats blocked the whole server per poll).
import { Worker, isMainThread, parentPort, workerData, SHARE_ENV } from "node:worker_threads";
import type { SeatTurnsResult } from "./core.js";

const ROLE = "aiterm-seat-turns";
type Reply = { id: number; result?: SeatTurnsResult; error?: string };

if (!isMainThread && workerData === ROLE && parentPort) {
  const port = parentPort;
  // Messages wait in the port until this listener is attached.
  void import("./core.js").then(core => port.on("message", ({ id, ids }: { id: number; ids: string[] }) => {
    let reply: Reply;
    try { reply = { id, result: core.readSeatTurns(ids) }; }
    catch (e) { reply = { id, error: e instanceof Error ? e.message : String(e) }; }
    port.postMessage(reply);
  }));
}

type Pending = { ids: string[]; resolve: (value: SeatTurnsResult) => void; reject: (error: Error) => void };
let current: { worker: Worker; pending: Map<number, Pending> } | null = null;
let nextId = 0;

/** Reads in call order on the worker. A worker that dies answers its pending reads with `fallback` (the synchronous read). */
export function readSeatTurnsOffLoop(ids: string[], fallback: (ids: string[]) => SeatTurnsResult): Promise<SeatTurnsResult> {
  if (!current) {
    let worker: Worker;
    // execArgv []: a parent's --import preload (e.g. one that re-roots HOME/TMPDIR) must not run again on the shared env.
    try { worker = new Worker(new URL(import.meta.url), { workerData: ROLE, env: SHARE_ENV, execArgv: [] }); }
    catch { return Promise.resolve().then(() => fallback(ids)); }
    worker.unref();
    const slot = { worker, pending: new Map<number, Pending>() };
    worker.on("message", (reply: Reply) => {
      const call = slot.pending.get(reply.id);
      if (!call) return;
      slot.pending.delete(reply.id);
      if (!slot.pending.size) worker.unref();
      if (reply.error !== undefined) call.reject(new Error(reply.error)); else call.resolve(reply.result!);
    });
    const lost = () => {
      if (current === slot) current = null;
      for (const call of slot.pending.values()) { try { call.resolve(fallback(call.ids)); } catch (e) { call.reject(e as Error); } }
      slot.pending.clear();
    };
    worker.on("error", lost);
    worker.on("exit", lost);
    current = slot;
  }
  const slot = current, id = nextId++;
  return new Promise((resolve, reject) => {
    slot.pending.set(id, { ids, resolve, reject });
    slot.worker.ref(); // an awaited read keeps the process alive; an idle worker does not
    slot.worker.postMessage({ id, ids });
  });
}
