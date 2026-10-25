import { z } from "zod";
import { sameGoalTarget, AgentGoalNotIssuedError, agentGoalResultSchema, nativeGoalSchema, agentGoalInputSchema, type AgentGoalInput, type GoalTarget } from "./agent-goal.js";
import { claudeCurrentGoalSchema, claudeGoalHistorySchema, type ClaudeGoalObservation } from "./harnesses/claude-goal.js";
import {grokCurrentGoalSchema} from './harnesses/grok-goal.js';
export const agentGoalNativeResultSchema = agentGoalResultSchema.extend({
  schema: z.literal("aiterm.agent-goal-result.v2"),
  goal: z.discriminatedUnion("kind", [
    z.object({kind:z.literal("codex-cli"),native:nativeGoalSchema}).strict(),claudeCurrentGoalSchema,grokCurrentGoalSchema,
  ]).nullable().optional(), native_history:claudeGoalHistorySchema.optional(),
}).strict();
export const agentGoalWireResultSchema = z.discriminatedUnion("schema", [agentGoalResultSchema, agentGoalNativeResultSchema]);
// MCP requires an object root. Validate the tagged branches as well as the
// advertised property shape; Codex v1 remains byte-compatible.
export const agentGoalOutputSchema = agentGoalResultSchema.extend({
  schema:z.enum(["aiterm.agent-goal-result.v1","aiterm.agent-goal-result.v2"]),
  goal:z.union([nativeGoalSchema,agentGoalNativeResultSchema.shape.goal.unwrap().unwrap()]).nullable().optional(),
  native_history:claudeGoalHistorySchema.optional(),
}).superRefine((value, context)=>{
  const parsed=agentGoalWireResultSchema.safeParse(value);
  if(!parsed.success){for(const issue of parsed.error.issues)context.addIssue({...issue});return;}
  if(value.schema==="aiterm.agent-goal-result.v2"&&value.goal&&"kind" in value.goal&&value.goal.kind!==value.harness)
    context.addIssue({code:"custom",path:["goal"],message:"native goal kind must match bound harness"});
});
export type AgentGoalWireResult = z.infer<typeof agentGoalWireResultSchema>;
export async function manageGrokAgentGoal(input:AgentGoalInput,runtime:{resolve():GoalTarget|null;read(target:GoalTarget):Promise<{current:z.infer<typeof grokCurrentGoalSchema>|null}>}):Promise<z.infer<typeof agentGoalNativeResultSchema>>{
  input=agentGoalInputSchema.parse(input);
  const result:z.infer<typeof agentGoalNativeResultSchema>={schema:'aiterm.agent-goal-result.v2',session_id:input.session_id,launch_id:input.launch_id,harness:'grok-cli',binding:null,
    availability:'unavailable',capabilities:{inspect:false,create:false,edit:false,pause:false,resume:false,clear:false},outcome:'unavailable',mutation:input.action==='inspect'?'not_requested':'not_issued',readback:'not_attempted',reason:'binding_unavailable',observed_at:new Date().toISOString()};
  try{
    const target=runtime.resolve();
    if(!target||target.session_id!==input.session_id||target.launch_id!==input.launch_id||target.harness!=='grok-cli'||!target.vendor_session_id)return result;
    if(input.expected_thread_id!==undefined&&input.expected_thread_id!==target.vendor_session_id)return {...result,reason:'thread_binding_mismatch'};
    if(input.action!=='inspect')return {...result,availability:'unsupported',outcome:'unsupported',reason:'native_goal_operation_unsupported'};
    const observed=await runtime.read(target);
    if(!sameGoalTarget(runtime.resolve(),target))return {...result,reason:'generation_replaced_after_status',readback:'failed'};
    return agentGoalNativeResultSchema.parse({...result,binding:{session_id:target.session_id,launch_id:target.launch_id,thread_id:target.vendor_session_id},availability:'available',capabilities:{...result.capabilities,inspect:true},goal:observed.current,outcome:'observed',readback:'confirmed',reason:'native_goal_observed'});
  }catch(error){return {...result,reason:error instanceof AgentGoalNotIssuedError?error.reason:'native_goal_fresh_status_unavailable',readback:'failed'};}
}
export async function manageClaudeAgentGoal(input: AgentGoalInput, runtime: {
  resolve(): GoalTarget|null;
  read(target: GoalTarget): Promise<Pick<ClaudeGoalObservation,"current"|"history">>;
  clear?(target: GoalTarget): Promise<void>;
  setObjective?(target: GoalTarget,objective:string): Promise<void>;
}, origin: "user"|"automatic"="automatic"): Promise<z.infer<typeof agentGoalNativeResultSchema>> {
  input=agentGoalInputSchema.parse(input);
  const result:z.infer<typeof agentGoalNativeResultSchema>={schema:"aiterm.agent-goal-result.v2",session_id:input.session_id,launch_id:input.launch_id,harness:"claude-code",binding:null,
    availability:"unavailable",capabilities:{inspect:false,create:false,edit:false,pause:false,resume:false,clear:false},
    field_capabilities:{create:{objective:false,token_budget:false},edit:{objective:false,token_budget:false,combined:false}},
    outcome:"unavailable",mutation:input.action==="inspect"?"not_requested":"not_issued",readback:"not_attempted",reason:"binding_unavailable",observed_at:new Date().toISOString()};
  let issued=false;
  try{
    const target=runtime.resolve();
    if(!target||target.session_id!==input.session_id||target.launch_id!==input.launch_id||target.harness!=="claude-code"||!target.vendor_session_id)return result;
    if(input.expected_thread_id!==undefined&&input.expected_thread_id!==target.vendor_session_id)return {...result,reason:"thread_binding_mismatch"};
    if(input.action!=="inspect" && !(input.action==="clear"&&runtime.clear) && !(["create","edit"].includes(input.action)&&runtime.setObjective))return {...result,availability:"unsupported",outcome:"unsupported",reason:"native_goal_operation_unsupported"};
    if(input.action!=="inspect"&&origin!=="user")return {...result,outcome:"rejected",reason:"user_authorization_required"};
    const observed=await runtime.read(target);
    if(!sameGoalTarget(runtime.resolve(),target))return {...result,reason:"generation_replaced_after_status",readback:"failed"};
    const snapshot = (value: Pick<ClaudeGoalObservation,"current"|"history">) => ({goal:value.current,...(value.history?{native_history:value.history}:{})});
    Object.assign(result,{availability:"available",capabilities:{...result.capabilities,inspect:true,clear:!!runtime.clear,create:!!runtime.setObjective,edit:!!runtime.setObjective},
      field_capabilities:{create:{objective:!!runtime.setObjective,token_budget:false},edit:{objective:!!runtime.setObjective,token_budget:false,combined:false}},
      binding:{session_id:target.session_id,launch_id:target.launch_id,thread_id:target.vendor_session_id},
      ...snapshot(observed),outcome:"observed",readback:"confirmed",reason:"native_goal_observed",observed_at:new Date().toISOString()});
    if(input.action==="inspect")return agentGoalNativeResultSchema.parse(result);
    if(input.token_budget!==undefined)return {...result,outcome:"unsupported",reason:"native_goal_field_unsupported"};
    if(input.action==="create"&&observed.current!==null)return {...result,outcome:"rejected",reason:"goal_already_exists"};
    if(input.action==="edit"&&observed.current===null)return {...result,outcome:"rejected",reason:"goal_missing"};
    if(!sameGoalTarget(runtime.resolve(),target))return {...result,availability:"unavailable",outcome:"unavailable",reason:"generation_replaced"};
    issued=true;delete result.goal;delete result.native_history;result.readback="not_attempted";
    try{if(input.action==="clear")await runtime.clear!(target);else await runtime.setObjective!(target,input.objective!);}catch(error){
      if(!(error instanceof AgentGoalNotIssuedError))throw error;
      issued=false;
      try{
        const fresh=await runtime.read(target);
        if(!sameGoalTarget(runtime.resolve(),target))throw new Error("generation_replaced");
        return {...result,...snapshot(fresh),outcome:error.outcome,mutation:"not_issued",readback:"confirmed",reason:error.reason};
      }catch{return {...result,outcome:error.outcome,mutation:"not_issued",readback:"failed",reason:error.reason};}
    }
    if(!sameGoalTarget(runtime.resolve(),target))throw new Error("generation_replaced_after_mutation");
    const after=await runtime.read(target);
    if(!sameGoalTarget(runtime.resolve(),target))throw new Error("generation_replaced_after_readback");
    const matches=input.action==="clear" ? after.current===null && (observed.current===null || (after.history?.terminal==="cleared"&&after.history.native.condition===observed.current.native.condition)) : after.current?.phase==="active" && after.current.native.condition===input.objective;
    return agentGoalNativeResultSchema.parse({...result,...snapshot(after),mutation:matches?"acknowledged":"outcome_unknown",outcome:matches?"applied":"outcome_unknown",readback:matches?"confirmed":"mismatch",reason:matches?"native_goal_readback_confirmed":"native_goal_changed_before_readback",observed_at:new Date().toISOString()});

  }catch(error){
    if(issued)return {...result,outcome:"outcome_unknown",mutation:"outcome_unknown",readback:"failed",reason:"native_goal_mutation_unconfirmed"};
    const reasons=new Set(["native_goal_status_input_unconfirmed","native_goal_fresh_dialog_unavailable","native_goal_dialog_changed","native_goal_binding_mismatch"]);
    const reason=error instanceof AgentGoalNotIssuedError?error.reason:error instanceof Error&&reasons.has(error.message)?error.message:"native_goal_fresh_status_unavailable";
    return {...result,reason,readback:"failed"};
  }
}
