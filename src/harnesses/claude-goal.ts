// Claude owns goal state. A fresh local status command, never a historical
// attachment alone, establishes current state for the bound native session.
import { z } from "zod";
const currentSessionSchema=z.object({pid:z.number().int().positive(),sessionId:z.string().uuid(),procStart:z.string().regex(/^\d+$/u),pidDomain:z.string(),version:z.literal("2.1.310"),kind:z.literal("interactive")});
export function claudeCurrentSessionOwner(record:unknown,expected:{pid:number;sessionId:string;procStart:string;pidDomain:string}):"match"|"mismatch"|"unavailable" {
  const parsed=currentSessionSchema.safeParse(record);
  if(!parsed.success||parsed.data.pid!==expected.pid||parsed.data.procStart!==expected.procStart||parsed.data.pidDomain!==expected.pidDomain)return "unavailable";
  return parsed.data.sessionId===expected.sessionId?"match":"mismatch";
}
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

import { nativeGoalStyledRows, type GoalNativeUi } from "../agent-goal-ui.js";
import { AgentGoalNotIssuedError } from "../agent-goal.js";
function plain(screen: string): string { return screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, ""); }
export function claudeGoalComposer(screen: string): { text: string; columns: number; rows: number } | null {
  const lines = plain(screen).split("\n");
  let at=lines.length-1;
  while(at>=0&&!/^\s*❯/u.test(lines[at]))at--;
  const rule=/^\s*─{8,}\s*$/u;
  if(at<1||!rule.test(lines[at-1]))return null;
  const end=lines.findIndex((line,i)=>i>at&&rule.test(line));
  if(end<0)return null;
  const first=/^\s*❯[ \u00a0]?(.*)$/u.exec(lines[at]);
  if(!first)return null;
  const continuation=lines.slice(at+1,end);
  if(continuation.some(line=>!line.startsWith("  ")))return null;
  const prefix=/^\s*❯[ \u00a0]?/u.exec(lines[at])![0];
  const styled=nativeGoalStyledRows(screen)[at]?.slice([...prefix].length).filter(cell=>cell.text.trim())??[];
  const placeholder=continuation.length===0&&first[1].trimEnd()==="Press up to edit queued messages"
    &&styled.length>0&&styled.some(cell=>cell.dim)&&styled.every(cell=>cell.dim||cell.inverse);
  return {text:placeholder?"":[first[1].trimEnd(),...continuation.map(line=>line.slice(2).trimEnd())].join("\n"),columns:lines[at-1].trim().length,rows:lines.length};
}
export function claudeGoalComposerEmpty(screen: string): boolean {
  return claudeGoalComposer(screen)?.text==="";
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
  const conditionLines=current.condition.split("\n");
  // Exact native newlines are supported; no guessed wrapping/whitespace.
  if(conditionLines.some(line=>!line||line!==line.trim()))return null;
  if (!/^running .+ · .+ tokens$/u.test(body[0]) || JSON.stringify(body.slice(1)) !== JSON.stringify(["Goal: "+conditionLines[0],...conditionLines.slice(1)])) return null;
  return {current:{kind:"claude-code",phase:"active",native:{...current,met:false}},...(history?{history}:{})};
}
export async function submitClaudeGoalCommand(ui: GoalNativeUi, command: "/goal" | `/goal ${string}`): Promise<void> {
  if (!claudeGoalComposerEmpty(ui.read())) throw new AgentGoalNotIssuedError("goal_input_not_empty_or_ready");
  await ui.paste(command);
  const now=ui.now??(()=>performance.now());
  let until=now()+1500, ready=false;
  do {
    if(claudeGoalComposer(ui.read())?.text===command){ready=true;break;}
    await ui.pause(40);
  } while(now()<until);
  if(!ready)throw new Error("native_goal_status_input_unconfirmed");
  await ui.keys(["Enter"]);
}
/** A bounded, fully visible literal objective. Native wrapping and file
 * folding remain unsupported before submission rather than being normalized. */
export function validateClaudeGoalObjective(objective: string, screen: string): void {
  if(objective.trim().toLowerCase()==="clear")throw new AgentGoalNotIssuedError("native_goal_objective_reserved","unsupported");
  const lines=objective.split("\n"), composer=claudeGoalComposer(screen);
  if(!composer||composer.text!=="")throw new AgentGoalNotIssuedError("goal_input_not_empty_or_ready");
  if(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(objective)||lines.some(line=>!line||line!==line.trim()))
    throw new AgentGoalNotIssuedError("native_goal_objective_not_representable","unsupported");
  // This is a conservative upper bound, not a Unicode width approximation:
  // ASCII occupies one cell; every other point is allowed up to two cells.
  const boundedWidth=(line:string)=>[...line].reduce((n,c)=>n+(c.codePointAt(0)!<=0x7e?1:2),0);
  if(lines.length+10>composer.rows||lines.some(line=>boundedWidth(line)+10>composer.columns))
    throw new AgentGoalNotIssuedError("native_goal_objective_exceeds_viewport","unsupported");
}
export async function setClaudeGoalObjective(ui: GoalNativeUi, objective: string): Promise<void> {
  validateClaudeGoalObjective(objective,ui.read());
  await submitClaudeGoalCommand(ui,`/goal ${objective}`);
  const now=ui.now??(()=>performance.now()),until=now()+1500;
  do{if(claudeGoalComposerEmpty(ui.read()))return;await ui.pause(40);}while(now()<until);
  throw new Error("native_goal_set_command_unconfirmed");
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
