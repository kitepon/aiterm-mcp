import {z} from 'zod';
import {AgentGoalNotIssuedError} from '../agent-goal.js';
import type {GoalNativeUi} from '../agent-goal-ui.js';
import {grokPaneObservation} from './grok.js';
import stringWidth from 'string-width';

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
  goal_id:z.string().uuid(),objective:z.string().min(1),status:z.enum(['active','user_paused']),phase:z.enum(['Idle','Planning','Executing']),
  token_budget:z.number().int().positive(),elapsed_ms:z.number().int().nonnegative(),created_at:z.string().datetime({offset:true}),
  current_subagent_id:z.string().nullable(),current_subagent_role:z.string().nullable(),
  total_worker_rounds:z.number().int().nonnegative(),total_verify_rounds:z.number().int().nonnegative(),
  token_baseline:z.number().int().nonnegative(),tokens_used_high_water:z.number().int().nonnegative(),parent_tokens_spent:z.number().int().nonnegative(),last_session_tokens_seen:z.number().int().nonnegative(),
  history:z.array(z.object({timestamp:z.string().datetime({offset:true}),event:z.string(),detail:z.string().optional()}).strict()),
  evaluator_blocked_streak:z.number().int().nonnegative(),verifier_id:z.string().min(1),classifier_runs_attempted:z.number().int().nonnegative(),rounds_since_verify:z.number().int().nonnegative(),classifier_stall_count:z.number().int().nonnegative(),consecutive_not_achieved:z.number().int().nonnegative(),last_strategist_fired_at:z.number().int().nonnegative(),strategist_cap_bonus:z.number().int().nonnegative(),
}).strict();
const elapsedDisplay=z.string().max(64).regex(/^(?:\d+s|\d+m[0-5]\ds|\d+h[0-5]\dm)$/u);
export const grokCurrentStatusSchema=z.discriminatedUnion('source',[z.object({
  source:z.literal('/goal status'),status:z.enum(['Active','UserPaused']),phase:z.enum(['Idle','Planning','Executing']),
  tokens_used:z.number().int().nonnegative().safe(),elapsed_display:elapsedDisplay,
}).strict(),z.object({
  source:z.literal('goal detail'),status:z.enum(['Active','Paused']),phase:z.null(),tokens_used:z.null(),
  status_display:z.string().min(1).max(128),phase_display:z.string().min(1).max(64).nullable(),
  budget_display:z.string().min(1).max(128),elapsed_display:elapsedDisplay,
}).strict()]);
// Keep the persisted native snapshot distinct from the current worker's
// fresh status. Resuming a worker can reset its in-memory phase without
// rewriting that snapshot; never present the stored phase as current.
export const grokCurrentGoalSchema=z.object({kind:z.literal('grok-cli'),native:grokNativeGoalStateSchema,current_status:grokCurrentStatusSchema}).strict();

export function grokGoalFromFreshStatus(text:string,before:unknown,after:unknown):z.infer<typeof grokCurrentGoalSchema>{
  const first=grokNativeGoalStateSchema.parse(before),native=grokNativeGoalStateSchema.parse(after);
  if(first.goal_id!==native.goal_id||first.objective!==native.objective)throw Error('native_goal_identity_changed');
  const prefix=`Goal: ${native.objective}\nStatus: `;
  if(!text.startsWith(prefix))throw Error('native_goal_status_mismatch');
  const match=text.slice(prefix.length).match(/^(Active|UserPaused) \| Phase: (Idle|Planning|Executing)\nGoal tokens used: (\d+)\nElapsed: ([^\r\n]+)$/u);
  if(!match)throw Error('native_goal_active_status_unverified');
  return grokCurrentGoalSchema.parse({kind:'grok-cli',native,current_status:{source:'/goal status',status:match[1],phase:match[2],tokens_used:Number(match[3]),elapsed_display:match[4]}});
}

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

const plainScreen=(screen:string)=>screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu,'');
function fullHeader(screen:string):{column:number;row:number;text:string}|null{
  const raw=screen.split('\n'),lines=plainScreen(screen).split('\n');
  const at=lines.slice(0,2).findIndex(line=>/^\s+.*\[[^\]\r\n]*Goal: [^\]\r\n]+\].*\[Dashboard\]\s*$/u.test(line));
  if(at<0)return null;
  const start=lines[at].indexOf('Goal: ');
  return {column:stringWidth(lines[at].slice(0,start))+2,row:at+1,text:raw[at]};
}
function emptyFullComposer(screen:string):boolean{
  const text=plainScreen(screen);
  const modalCaption=text.split('\n').some(line=>{
    const match=line.match(/^\s*[┌╭](.*)$/u);
    return !!match&&/[^─\s╮┐]/u.test(match[1]);
  });
  return !modalCaption&&/^\s*│\s*❯\s*│\s*$/mu.test(text)&&/Ctrl\+x:shortcuts/u.test(text);
}
function detailFrame(screen:string):{row:number;text:string;body:string[]}|null{
  const raw=screen.split('\n'),lines=plainScreen(screen).split('\n');
  const tops=lines.flatMap((line,i)=>/^\s*┌─ Goal ─+ \[✗\] ─┐\s*$/u.test(line)?[i]:[]);
  if(tops.length!==1)return null;
  const top=tops[0],header=lines[top],left=stringWidth(header.slice(0,header.indexOf('┌'))),right=stringWidth(header.slice(0,header.lastIndexOf('┐')));
  const body:string[]=[];
  for(let i=top+1;i<lines.length;i++){
    const line=lines[i];
    if(line.includes('└')&&stringWidth(line.slice(0,line.indexOf('└')))===left&&line.includes('┘'))return {row:top+1,text:raw[top],body};
    const bars=Array.from(line.matchAll(/│/gu),match=>({index:match.index!,column:stringWidth(line.slice(0,match.index))}));
    const a=bars.find(bar=>bar.column===left),b=bars.find(bar=>bar.column===right);
    if(!a||!b)return null;
    body.push(line.slice(a.index+1,b.index).trim());
  }
  return null;
}
export function grokGoalFromDetail(screen:string,before:unknown,after:unknown):z.infer<typeof grokCurrentGoalSchema>{
  const first=grokNativeGoalStateSchema.parse(before),native=grokNativeGoalStateSchema.parse(after),frame=detailFrame(screen);
  if(first.goal_id!==native.goal_id||first.objective!==native.objective)throw Error('native_goal_identity_changed');
  if(!frame||frame.body[0]!==native.objective)throw Error('native_goal_detail_mismatch');
  const field=(prefix:string)=>{const rows=frame.body.filter(line=>line.startsWith(prefix));if(rows.length!==1)throw Error('native_goal_detail_unverified');return rows[0].slice(prefix.length);};
  const statuses=frame.body.filter(line=>/^Status: (?:Active(?:\s.*)?|Paused)$/u.test(line));
  if(statuses.length!==1)throw Error('native_goal_detail_unverified');
  const display=statuses[0].slice('Status: '.length),phase=display.indexOf(' · ');
  return grokCurrentGoalSchema.parse({kind:'grok-cli',native,current_status:{source:'goal detail',status:display.startsWith('Active')?'Active':'Paused',phase:null,tokens_used:null,
    status_display:display,phase_display:phase<0?null:display.slice(phase+3),budget_display:field('Budget: '),elapsed_display:field('Elapsed: ')}});
}
async function readGrokGoalDetail(port:GrokGoalStatusPort,before:unknown,initial:string):Promise<{current:z.infer<typeof grokCurrentGoalSchema>}>{
  const state=grokNativeGoalStateSchema.parse(before),header=fullHeader(initial);
  if(!header||!port.ui.click||!emptyFullComposer(initial)||detailFrame(initial)||/[\r\n\x00-\x1f\x7f]/u.test(state.objective)||state.objective.trim()!==state.objective)
    throw new AgentGoalNotIssuedError('native_goal_status_input_unconfirmed');
  const now=port.ui.now??(()=>performance.now());let opened:ReturnType<typeof detailFrame>=null;
  await port.ui.click(header.column,header.row,screen=>{
    const fresh=fullHeader(screen);
    return fresh?.column===header.column&&fresh.row===header.row&&emptyFullComposer(screen)&&!detailFrame(screen);
  });
  try{
    for(const until=now()+2000;now()<until;await port.ui.pause(30)){
      const screen=port.ui.read();opened=detailFrame(screen);
      if(opened)return {current:grokGoalFromDetail(screen,state,port.state())};
    }
    throw Error('native_goal_detail_unavailable');
  }finally{
    if(opened){
      const current=detailFrame(port.ui.read());
      if(!current)throw Error('native_goal_detail_changed');
      await port.ui.keys(['g'],{row:current.row,text:current.text});
      let closed=false;
      for(const until=now()+2000;now()<until;await port.ui.pause(30)){
        const screen=port.ui.read();
        if(!detailFrame(screen)&&emptyFullComposer(screen)){closed=true;break;}
      }
      if(!closed)throw Error('native_goal_detail_close_unconfirmed');
      const after=grokNativeGoalStateSchema.parse(port.state());
      if(after.goal_id!==state.goal_id||after.objective!==state.objective)throw Error('native_goal_identity_changed');
    }
  }
}
export async function readFreshGrokGoal(sessionId:string,port:GrokGoalStatusPort):Promise<{current:z.infer<typeof grokCurrentGoalSchema>|null}>{
  const before=port.rows();
  const beforeState=port.state();
  const initial=port.ui.read();
  if(fullHeader(initial))return readGrokGoalDetail(port,beforeState,initial);
  if(composer(initial)!=='')throw new AgentGoalNotIssuedError('native_goal_status_input_unconfirmed');
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
    return {current:grokGoalFromFreshStatus(text,beforeState,state)};
  }
  throw Error('native_goal_fresh_status_unavailable');
}
