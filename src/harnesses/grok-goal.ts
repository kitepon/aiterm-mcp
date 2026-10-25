import {z} from 'zod';
import {AgentGoalNotIssuedError} from '../agent-goal.js';
import type {GoalNativeUi} from '../agent-goal-ui.js';
import {grokPaneObservation} from './grok.js';

// Grok 1.0.70 owns this registry. A stale PID or another current session is
// never repaired by choosing a newer directory or by loading a conversation.
const activeSessionSchema=z.array(z.object({session_id:z.string().uuid(),pid:z.number().int().positive(),
  pid_start:z.number().int().nonnegative().safe(),cwd:z.string()}));
export function grokCurrentSessionOwner(record:unknown,expected:{pid:number;procStart:string;sessionId:string;cwd:string}):'match'|'mismatch'|'unavailable'{
  const parsed=activeSessionSchema.safeParse(record);
  if(!parsed.success)return 'unavailable';
  const rows=parsed.data.filter(row=>row.pid===expected.pid);
  if(rows.length!==1||String(rows[0].pid_start)!==expected.procStart||rows[0].cwd!==expected.cwd)return 'unavailable';
  return rows[0].session_id===expected.sessionId?'match':'mismatch';
}

export const grokNativeGoalStateSchema=z.object({
  goal_id:z.string().uuid(),objective:z.string().min(1),status:z.enum(['active','user_paused']),phase:z.literal('Executing'),
  token_budget:z.number().int().positive(),elapsed_ms:z.number().int().nonnegative(),created_at:z.string().datetime({offset:true}),
  current_subagent_id:z.string().nullable(),current_subagent_role:z.string().nullable(),
  total_worker_rounds:z.number().int().nonnegative(),total_verify_rounds:z.number().int().nonnegative(),
  token_baseline:z.number().int().nonnegative(),tokens_used_high_water:z.number().int().nonnegative(),parent_tokens_spent:z.number().int().nonnegative(),last_session_tokens_seen:z.number().int().nonnegative(),
  history:z.array(z.object({timestamp:z.string().datetime({offset:true}),event:z.string(),detail:z.string().optional()}).strict()),
  evaluator_blocked_streak:z.number().int().nonnegative(),verifier_id:z.string().min(1),classifier_runs_attempted:z.number().int().nonnegative(),rounds_since_verify:z.number().int().nonnegative(),classifier_stall_count:z.number().int().nonnegative(),consecutive_not_achieved:z.number().int().nonnegative(),last_strategist_fired_at:z.number().int().nonnegative(),strategist_cap_bonus:z.number().int().nonnegative(),
}).strict();
export const grokCurrentGoalSchema=z.object({kind:z.literal('grok-cli'),native:grokNativeGoalStateSchema}).strict();

function composer(screen:string):string|null{
  const plain=screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu,'');
  if(grokPaneObservation(plain).state!=='idle')return null;
  const lines=plain.split('\n');
  let anchor=-1;
  for(let i=lines.length-1;i>=0;i--)if(/^minimal\s+·\s/u.test(lines[i])){anchor=i;break;}
  // Completion rows also have ❯. The composer belongs to its current layout
  // anchor, never to the last cursor anywhere in the viewport.
  const row=anchor>=0?lines[anchor+1]:lines.filter(line=>/^\s*│\s*[❯>]/u.test(line)).at(-1);
  if(row===undefined||!/^\s*(?:│\s*)?[❯>]/u.test(row))return null;
  const tail=anchor>=0?lines.slice(anchor+2):[];
  if(tail.some(line=>line.includes('↑/↓ navigate'))&&tail.filter(line=>/^❯/u.test(line)).join('\n')!=='❯ status Show the goal')return null;
  return row===undefined?null:row.replace(/^\s*(?:│\s*)?[❯>]\s?/u,'').replace(/\s*│\s*$/u,'').trimEnd();
}

export interface GrokGoalStatusPort {
  ui:GoalNativeUi;
  rows():unknown[];
  state():unknown|null;
}
export async function readFreshGrokGoal(sessionId:string,port:GrokGoalStatusPort):Promise<{current:z.infer<typeof grokCurrentGoalSchema>|null}>{
  const before=port.rows();
  if(composer(port.ui.read())!=='')throw new AgentGoalNotIssuedError('native_goal_status_input_unconfirmed');
  await port.ui.paste('/goal status');
  const now=port.ui.now??(()=>performance.now());
  let pasted=false;
  for(const until=now()+2000;now()<until;await port.ui.pause(30)){
    if(composer(port.ui.read())==='/goal status'){pasted=true;break;}
  }
  if(!pasted)throw new AgentGoalNotIssuedError('native_goal_status_input_unconfirmed');
  await port.ui.keys(['Enter']);
  for(const until=now()+2000;now()<until;await port.ui.pause(30)){
    port.ui.read(); // current native session and foreground ownership guard
    const rows=port.rows();
    if(rows.length<before.length||before.some((row,i)=>JSON.stringify(row)!==JSON.stringify(rows[i])))throw Error('native_goal_transcript_replaced');
    const tail=rows.slice(before.length) as any[];
    const query=tail.flatMap((row,i)=>row?.method==='session/update'&&row.params?.sessionId===sessionId
      &&row.params.update?.sessionUpdate==='user_message_chunk'&&row.params.update?._meta?.hostTurn===true
      &&row.params.update.content?.type==='text'&&row.params.update.content?.text==='/goal status'?[i]:[]);
    if(query.length>1)throw Error('native_goal_status_ambiguous');
    if(query.length!==1)continue;
    const replies=tail.slice(query[0]+1).filter(row=>row?.method==='session/update'&&row.params?.sessionId===sessionId
      &&row.params.update?.sessionUpdate==='agent_message_chunk'&&row.params.update?._meta?.hostTurn===true
      &&row.params.update.content?.type==='text');
    if(replies.length>1)throw Error('native_goal_status_ambiguous');
    if(replies.length!==1)continue;
    const text=replies[0].params.update.content.text;
    const state=port.state();
    if(text==='No goal is currently set. Use /goal <objective> to start one.'){
      if(state!==null)throw Error('native_goal_status_mismatch');
      return {current:null};
    }
    // Current active-state display has not yet been accepted against this
    // CLI version. A known persisted snapshot alone cannot satisfy a query.
    grokNativeGoalStateSchema.parse(state);
    throw Error('native_goal_active_status_unverified');
  }
  throw Error('native_goal_fresh_status_unavailable');
}
