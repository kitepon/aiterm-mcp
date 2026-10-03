// 親配送の記録を、持ち主（登録したMCP process）から数える。
// parent-delivery.tsはcoreに依存するので、coreのpty_observeが使う分だけをここへ分ける。
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ensureStateRoot } from "./agent-shared.js";

const DELIVERY_DIRECTORIES = ["parent-deliveries", "claude-parent-deliveries", "cursor-parent-deliveries"];

/** 持ち主の保存場所の名前の先頭。pidの使い回しと取り違えないよう、開始時刻も入れる。 */
export function deliveryOwnerPrefix(owner: { pid: number; started_identity: string }): string {
  return `${owner.pid}-${createHash("sha256").update(owner.started_identity).digest("hex").slice(0, 16)}-`;
}

/** 渡したprocessのどれかが持ち主で、まだ親へ届け終えていない配送の数。届け終えた記録はactiveから出ている。 */
export function unfinishedDeliveriesOwnedBy(processes: { pid: number; started_identity: string }[], stateRoot = ensureStateRoot()): number {
  const prefixes = processes.map(deliveryOwnerPrefix);
  let count = 0;
  for (const prefix of ["", "remote-"]) {
    for (const directory of DELIVERY_DIRECTORIES) {
      const active = path.join(stateRoot, prefix + directory, "active");
      let owners: fs.Dirent[];
      try { owners = fs.readdirSync(active, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const owner of owners) {
        if (!owner.isDirectory() || !prefixes.some(candidate => owner.name.startsWith(candidate))) continue;
        try {
          count += fs.readdirSync(path.join(active, owner.name)).filter(name => name !== "owner.json" && name.endsWith(".json")).length;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
  }
  return count;
}
