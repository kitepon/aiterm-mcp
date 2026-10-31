import fs from "node:fs";
import { createHash } from "node:crypto";
import { agentMetadataPath, type AgentMetadata, type AgentWaitObservation } from "./agent-shared.js";
import { AitermError } from "./errors.js";

type Launch = Pick<AgentMetadata, "aiterm_session" | "launch_id">;
type Completion = Pick<AgentWaitObservation, "vendor" | "vendor_session_id" | "turn_id" | "operation_id" | "at">;
type ActivityRecord = { kind: "created" | "input" | "turn_end"; at: string; key?: string };
export interface AgentActivity {
  tracked: boolean;
  last_input_at: string | null;
  last_turn_end_at: string | null;
}
const activityPath = (launch: Launch) => agentMetadataPath(launch.aiterm_session, launch.launch_id).replace(/\.agent\.json$/, ".activity.jsonl");
const validTime = (at: unknown): at is string => typeof at === "string" && at.length <= 40 && Number.isFinite(Date.parse(at));
const unreadable = () => new AitermError("AGENT_ACTIVITY_UNCONFIRMED: 席の最終入力・番終了の記録を確認できません。", 2);

function read(launch: Launch): { activity: AgentActivity; completed: Set<string> } {
  const activity: AgentActivity = { tracked: false, last_input_at: null, last_turn_end_at: null };
  const completed = new Set<string>();
  let text: string;
  try { text = fs.readFileSync(activityPath(launch), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { activity, completed }; throw unreadable(); }
  if (!text.endsWith("\n")) throw unreadable();
  for (const line of text.trimEnd().split("\n")) {
    let record: ActivityRecord;
    try { record = JSON.parse(line); } catch { throw unreadable(); }
    if (!record || !["created", "input", "turn_end"].includes(record.kind) || !validTime(record.at)
      || (record.kind === "turn_end" && (typeof record.key !== "string" || !/^[a-f0-9]{64}$/.test(record.key)))) throw unreadable();
    activity.tracked = true;
    if (record.kind === "created") continue;
    if (record.kind === "turn_end") {
      if (completed.has(record.key!)) continue;
      completed.add(record.key!);
    }
    const field = record.kind === "input" ? "last_input_at" : "last_turn_end_at";
    if (activity[field] === null || Date.parse(record.at) > Date.parse(activity[field]!)) activity[field] = record.at;
  }
  return { activity, completed };
}

export function readAgentActivity(launch: Launch): AgentActivity { return read(launch).activity; }

function append(launch: Launch, record: ActivityRecord): void {
  // Hook and sender must not overwrite each other's metadata snapshots.
  fs.appendFileSync(activityPath(launch), JSON.stringify(record) + "\n", { mode: 0o600 });
}

export function initializeAgentActivity(meta: AgentMetadata): void {
  if (!validTime(meta.created_at)) throw unreadable();
  fs.writeFileSync(activityPath(meta), JSON.stringify({ kind: "created", at: meta.created_at }) + "\n", { mode: 0o600, flag: "wx" });
}

export function recordAgentInput(launch: Launch, at = new Date().toISOString()): void {
  if (!validTime(at)) throw unreadable();
  append(launch, { kind: "input", at });
}

export function recordAgentTurnEnd(launch: Launch, event: Completion): void {
  if (!validTime(event.at)) throw unreadable();
  const key = createHash("sha256").update(JSON.stringify([event.vendor, event.vendor_session_id,
    event.turn_id ?? event.operation_id ?? event.at])).digest("hex");
  if (!read(launch).completed.has(key)) append(launch, { kind: "turn_end", at: event.at, key });
}
