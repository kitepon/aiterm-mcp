// Claude owns goal state. A fresh local status command, never a historical
// attachment alone, establishes current state for the bound native session.
import { z } from "zod";
export const claudeNativeGoalStatusSchema = z.object({
  type: z.literal("goal_status"), condition: z.string().min(1), met: z.boolean(),
  sentinel: z.boolean().optional(), reason: z.string().optional(),
  iterations: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(), tokens: z.number().int().nonnegative().optional(),
}).strict();
export const claudeCurrentGoalSchema = z.object({
  kind: z.literal("claude-code"), phase: z.literal("active"),
  native: claudeNativeGoalStatusSchema.extend({ met: z.literal(false) }),
  reported_turns: z.number().int().nonnegative().optional(),
}).strict();
export const claudeGoalHistorySchema = z.object({
  kind: z.literal("claude-code"), terminal: z.enum(["achieved", "cleared"]), native: claudeNativeGoalStatusSchema,
}).strict();
export interface ClaudeGoalObservation {
  current: z.infer<typeof claudeCurrentGoalSchema> | null;
  history?: z.infer<typeof claudeGoalHistorySchema>;
  query_uuid: string; observed_at: string;
}
const querySchema = z.object({ uuid: z.string().min(1), timestamp: z.string().datetime(),
  sessionId: z.string().min(1), isSidechain: z.literal(false), version: z.literal("2.1.310"),
  type: z.literal("system"), subtype: z.literal("local_command"), content: z.string(),
  commandRun: z.object({ command: z.literal("goal"), args: z.literal("") }),
});
export function observeClaudeGoalStatus(rows: unknown[], nativeSessionId: string, queryUuid: string): ClaudeGoalObservation {
  const matches = rows.flatMap((value, at) => typeof value === "object" && value !== null
    && (value as {uuid?:unknown}).uuid === queryUuid ? [at] : []);
  if (matches.length !== 1) throw new Error("fresh_bound_native_status_required");
  const at = matches[0], query = querySchema.parse(rows[at]);
  if (query.sessionId !== nativeSessionId) throw new Error("native_goal_binding_mismatch");
  const status = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/u.exec(query.content)?.[1];
  if (status === undefined) throw new Error("native_status_format_unavailable");
  let current: z.infer<typeof claudeNativeGoalStatusSchema> | null = null;
  let history: ClaudeGoalObservation["history"];
  for (const value of rows.slice(0, at + 1)) {
    const row = value as {type?:unknown; attachment?:{type?:unknown}; sessionId?:unknown; isSidechain?:unknown};
    if (row?.type !== "attachment" || row.attachment?.type !== "goal_status") continue;
    if (row.sessionId !== nativeSessionId || row.isSidechain !== false) throw new Error("native_goal_binding_mismatch");
    const native = claudeNativeGoalStatusSchema.parse(row.attachment);
    if (native.met) { current = null; history = {kind:"claude-code", terminal:native.sentinel ? "cleared" : "achieved", native}; }
    else current = native;
  }
  const result = {query_uuid:query.uuid, observed_at:query.timestamp, ...(history ? {history} : {})};
  if (status === "No goal set" || status === "No goal set. Usage: `/goal <condition>`") return {...result,current:null};
  if (!current) throw new Error("native_goal_evidence_missing");
  const prefix = "Goal active: " + current.condition;
  if (!status.startsWith(prefix)) throw new Error("native_goal_status_mismatch");
  const active = /^ \((\d+) turns?\)(?:\nLast check: ([\s\S]*))?$/u.exec(status.slice(prefix.length));
  if (!active || active[2] !== current.reason || !Number.isSafeInteger(Number(active[1]))) throw new Error("native_goal_status_mismatch");
  return {...result,current:claudeCurrentGoalSchema.parse({kind:"claude-code",phase:"active",native:current,reported_turns:Number(active[1])})};
}
/** The port owns the original worker's TTY and a native transcript cursor.
 * A request is sent once. No old command can satisfy a new query. */
export interface ClaudeGoalStatusPort {
  readRows(): unknown[];
  query(): Promise<void>;
  same(): boolean;
  pause(ms: number): Promise<void>;
  now?(): number;
}
export async function readFreshClaudeGoal(nativeSessionId: string, port: ClaudeGoalStatusPort): Promise<ClaudeGoalObservation> {
  if (!port.same()) throw new Error("generation_replaced");
  const before = port.readRows();
  const seen = new Set(before.map(row => (row as {uuid?:unknown})?.uuid));
  await port.query();
  const now = port.now ?? (() => performance.now()), until = now() + 2000;
  do {
    if (!port.same()) throw new Error("generation_replaced_after_status");
    const rows = port.readRows();
    // A truncated/replaced transcript is not a fresh append.
    if (rows.length < before.length || before.some((row, i) => JSON.stringify(row) !== JSON.stringify(rows[i])))
      throw new Error("native_goal_transcript_replaced");
    const candidates = rows.slice(before.length).filter(value => {
      const row = value as Record<string, any>;
      return row?.type === "system" && row.subtype === "local_command" && row.commandRun?.command === "goal"
        && row.commandRun.args === "" && row.sessionId === nativeSessionId && row.isSidechain === false && !seen.has(row.uuid);
    }) as {uuid:string}[];
    if (candidates.length > 1) throw new Error("native_goal_status_ambiguous");
    if (candidates.length === 1) return observeClaudeGoalStatus(rows, nativeSessionId, candidates[0].uuid);
    await port.pause(40);
  } while (now() < until);
  throw new Error("native_goal_fresh_status_unavailable");
}

import type { GoalNativeUi } from "../agent-goal-ui.js";
import { AgentGoalNotIssuedError } from "../agent-goal.js";
function plain(screen: string): string { return screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, ""); }
export function claudeGoalComposerEmpty(screen: string): boolean {
  const lines = plain(screen).split("\n");
  let at = lines.length - 1;
  while (at >= 0 && !/^\s*❯/u.test(lines[at])) at--;
  return at > 0 && /^\s*─{8,}\s*$/u.test(lines[at - 1]) && /^\s*❯\s*$/u.test(lines[at])
    && /^\s*─{8,}\s*$/u.test(lines[at + 1] ?? "");
}
export function observeClaudeGoalDialog(screen: string, rows: unknown[], sessionId: string): Pick<ClaudeGoalObservation,"current"|"history"> | null {
  const lines = plain(screen).split("\n").map(line => line.trim());
  const knownVersion=lines.some(line=>/Claude Code v2\.1\.310(?:\s|$)/u.test(line))
    || rows.some(value=>{const row=value as Record<string,any>;return row?.sessionId===sessionId&&row.isSidechain===false&&row.version==="2.1.310";});
  if(!knownVersion)return null;
  let end = lines.length - 1;
  while (end >= 0 && lines[end] !== "Esc to dismiss" && lines[end] !== "/goal clear to stop early · Esc to dismiss") end--;
  if (end < 0 || lines.slice(end + 1).some(line => line !== "")) return null;
  let current: z.infer<typeof claudeNativeGoalStatusSchema> | null = null;
  let history: ClaudeGoalObservation["history"];
  for (const value of rows) {
    const row = value as Record<string, any>;
    if (row?.type !== "attachment" || row.attachment?.type !== "goal_status") continue;
    if (row.sessionId !== sessionId || row.isSidechain !== false || row.version !== "2.1.310") throw new Error("native_goal_binding_mismatch");
    const native = claudeNativeGoalStatusSchema.parse(row.attachment);
    if (native.met) { current=null;history={kind:"claude-code",terminal:native.sentinel?"cleared":"achieved",native}; }
    else current=native;
  }
  if (lines[end] === "Esc to dismiss" && lines.slice(end - 5,end).filter(Boolean).join("\n") === "Goal\nNo goal set\n/goal <condition> to set one")
    return {current:null,...(history?{history}:{})};
  if (!current || lines[end] !== "/goal clear to stop early · Esc to dismiss") return null;
  let header = end - 1;
  while (header >= 0 && lines[header] !== "◎ Goal active") header--;
  if (header < 0) return null;
  const body = lines.slice(header + 1,end).filter(Boolean);
  // Wrapped/truncated conditions are not a canonical match. Keep the native
  // original and refuse this viewport rather than inventing a normalized goal.
  if (body.length !== 2 || !/^running .+ · .+ tokens$/u.test(body[0]) || body[1] !== "Goal: " + current.condition) return null;
  return {current:{kind:"claude-code",phase:"active",native:{...current,met:false}},...(history?{history}:{})};
}
export async function submitClaudeGoalCommand(ui: GoalNativeUi, command: "/goal" | "/goal clear"): Promise<void> {
  if (!claudeGoalComposerEmpty(ui.read())) throw new AgentGoalNotIssuedError("goal_input_not_empty_or_ready");
  await ui.paste(command);
  const now=ui.now??(()=>performance.now());
  let until=now()+1500, ready=false;
  do {
    const lines=plain(ui.read()).split("\n");
    if(lines.some((line,i)=>/^\s*❯\s+/u.test(line)&&line.replace(/^\s*❯\s+/u,"").trimEnd()===command&&/^\s*─{8,}\s*$/u.test(lines[i-1]??"")&&/^\s*─{8,}\s*$/u.test(lines[i+1]??""))){ready=true;break;}
    await ui.pause(40);
  } while(now()<until);
  if(!ready)throw new Error("native_goal_status_input_unconfirmed");
  await ui.keys(["Enter"]);
}
export async function clearClaudeGoal(ui: GoalNativeUi): Promise<void> {
  await submitClaudeGoalCommand(ui,"/goal clear");
  const now=ui.now??(()=>performance.now()), until=now()+1500;
  do {
    if(claudeGoalComposerEmpty(ui.read()))return;
    await ui.pause(40);
  }while(now()<until);
  throw new Error("native_goal_clear_command_unconfirmed");
}
export async function readClaudeGoalDialog(sessionId: string, ui: GoalNativeUi, readRows: () => unknown[]): Promise<Pick<ClaudeGoalObservation,"current"|"history">> {
  await submitClaudeGoalCommand(ui,"/goal");
  const now=ui.now??(()=>performance.now());
  let until=now()+2000;
  do {
    const observation=observeClaudeGoalDialog(ui.read(),readRows(),sessionId);
    if(observation){
      // Dismiss only the same recognized native goal dialog, once.
      if(!observeClaudeGoalDialog(ui.read(),readRows(),sessionId))throw new Error("native_goal_dialog_changed");
      await ui.keys(["Escape"]);
      return observation;
    }
    await ui.pause(40);
  }while(now()<until);
  throw new Error("native_goal_fresh_dialog_unavailable");
}
