// 親配送の記録を、持ち主（登録したMCP process）から数える。
// parent-delivery.tsはcoreに依存するので、coreのpty_observeが使う分だけをここへ分ける。
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { agentHarness, agentMetadataPath, agentsDir, ensureStateRoot, type AgentKind } from "./agent-shared.js";

const DELIVERY_DIRECTORIES = ["parent-deliveries", "claude-parent-deliveries", "cursor-parent-deliveries"];

/** 持ち主の保存場所の名前の先頭。pidの使い回しと取り違えないよう、開始時刻も入れる。 */
export function deliveryOwnerPrefix(owner: { pid: number; started_identity: string }): string {
  return `${owner.pid}-${createHash("sha256").update(owner.started_identity).digest("hex").slice(0, 16)}-`;
}

/** A child result a seat waits for, as an exclusion entry names it (harness, and session unless null). */
export type ChildResultRef = { session: string; harness: string | null };

/**
 * The unfinished deliveries that `seat` waits for (parent-delivery.md "親の席への数え方"): a local child's metadata names its
 * parent seat (`parent_session_id`). Only when that names no Aiterm seat here, the child is on another terminal, or its metadata
 * cannot be read, the owner process in the seat's subtree decides, as before 0.70.42. A manager that adopted a dead owner's
 * records is not charged for them.
 */
export function pendingChildResultsFor(seat: string, processes: { pid: number; started_identity: string }[],
  excluded: (child: ChildResultRef) => boolean = () => false, stateRoot = ensureStateRoot()): number {
  const prefixes = processes.map(deliveryOwnerPrefix);
  // A parent named by a child is a seat here when Aiterm holds an agent record for that name (host-root and the like are not).
  let listing: string[] | null = null;
  const isSeat = (name: string) => (listing ??= (() => { try { return fs.readdirSync(agentsDir()); } catch { return []; } })())
    .some(file => file.startsWith(`${name}.`) && file.endsWith(".agent.json"));
  let count = 0;
  for (const prefix of ["", "remote-"]) {
    for (const directory of DELIVERY_DIRECTORIES) {
      const active = path.join(stateRoot, prefix + directory, "active");
      let owners: fs.Dirent[];
      try { owners = fs.readdirSync(active, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const owner of owners) {
        if (!owner.isDirectory()) continue;
        const ownedHere = prefixes.some(candidate => owner.name.startsWith(candidate));
        let names: string[];
        try { names = fs.readdirSync(path.join(active, owner.name)).filter(name => name !== "owner.json" && name.endsWith(".json")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        for (const name of names) {
          let child: ChildResultRef | null = null, parent: string | null = null;
          try {
            const boundary = JSON.parse(fs.readFileSync(path.join(active, owner.name, name), "utf8"))?.boundary;
            if (typeof boundary?.session_id === "string") child = { session: boundary.session_id, harness: null };
            if (child && !boundary.remote && typeof boundary.launch_id === "string") {
              const meta = JSON.parse(fs.readFileSync(agentMetadataPath(child.session, boundary.launch_id), "utf8"));
              child.harness = typeof meta?.kind === "string" ? agentHarness(meta.kind as AgentKind) : null;
              if (typeof meta?.parent_session_id === "string" && isSeat(meta.parent_session_id)) parent = meta.parent_session_id;
            }
          } catch { /* unreadable record or child: the owner decides */ }
          if (!(parent === null ? ownedHere : parent === seat)) continue;
          if (child && excluded(child)) continue;
          count++;
        }
      }
    }
  }
  return count;
}
