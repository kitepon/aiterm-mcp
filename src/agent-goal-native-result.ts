import { z } from "zod";
import { sameGoalTarget, AgentGoalNotIssuedError, agentGoalResultSchema, nativeGoalSchema, agentGoalInputSchema, type AgentGoalInput, type GoalTarget } from "./agent-goal.js";
import { claudeCurrentGoalSchema, claudeGoalHistorySchema, type ClaudeGoalObservation } from "./harnesses/claude-goal.js";
export const agentGoalNativeResultSchema = agentGoalResultSchema.extend({
  schema: z.literal("aiterm.agent-goal-result.v2"),
  goal: z.discriminatedUnion("kind", [
    z.object({kind:z.literal("codex-cli"),native:nativeGoalSchema}).strict(),claudeCurrentGoalSchema,
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
export async function inspectClaudeAgentGoal(input: AgentGoalInput, runtime: {
  resolve(): GoalTarget|null;
  read(target: GoalTarget): Promise<Pick<ClaudeGoalObservation,"current"|"history">>;
}): Promise<z.infer<typeof agentGoalNativeResultSchema>> {
  input=agentGoalInputSchema.parse(input);
  const result:z.infer<typeof agentGoalNativeResultSchema>={schema:"aiterm.agent-goal-result.v2",session_id:input.session_id,launch_id:input.launch_id,harness:"claude-code",binding:null,
    availability:"unavailable",capabilities:{inspect:false,create:false,edit:false,pause:false,resume:false,clear:false},
    field_capabilities:{create:{objective:false,token_budget:false},edit:{objective:false,token_budget:false,combined:false}},
    outcome:"unavailable",mutation:input.action==="inspect"?"not_requested":"not_issued",readback:"not_attempted",reason:"binding_unavailable",observed_at:new Date().toISOString()};
  try{
    const target=runtime.resolve();
    if(!target||target.session_id!==input.session_id||target.launch_id!==input.launch_id||target.harness!=="claude-code"||!target.vendor_session_id)return result;
    if(input.expected_thread_id!==undefined&&input.expected_thread_id!==target.vendor_session_id)return {...result,reason:"thread_binding_mismatch"};
    if(input.action!=="inspect")return {...result,availability:"unsupported",outcome:"unsupported",reason:"native_goal_operation_unsupported"};
    const observed=await runtime.read(target);
    if(!sameGoalTarget(runtime.resolve(),target))return {...result,reason:"generation_replaced_after_status",readback:"failed"};
    return agentGoalNativeResultSchema.parse({...result,availability:"available",capabilities:{...result.capabilities,inspect:true},
      binding:{session_id:target.session_id,launch_id:target.launch_id,thread_id:target.vendor_session_id},
      goal:observed.current,...(observed.history?{native_history:observed.history}:{}),outcome:"observed",readback:"confirmed",reason:"native_goal_observed",observed_at:new Date().toISOString()});
  }catch(error){
    const reasons=new Set(["native_goal_status_input_unconfirmed","native_goal_fresh_dialog_unavailable","native_goal_dialog_changed","native_goal_binding_mismatch"]);
    const reason=error instanceof AgentGoalNotIssuedError?error.reason:error instanceof Error&&reasons.has(error.message)?error.message:"native_goal_fresh_status_unavailable";
    return {...result,reason,readback:"failed"};
  }
}
