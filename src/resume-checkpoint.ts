// Offline resume records only. No core, path-creating reader, or native operation.
import {createHash} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {AGENT_LINEAGE_RE} from './agent-shared.js';
import {agentResumeRecipeSchema, agentLifecycleSchema, resumeAttemptSchema, resumeNativeSchema,
  resumeTemplateSchema, resumeResolutionSchema, recoveryOriginSchema, agentResumeRecipeDigest} from './agent-lifecycle.js';
import {codexResumeProofSchema} from './harnesses/codex.js';
import {agentResumeFailureSchema} from './agent-resume-diagnostic.js';

export const RESUME_CHECKPOINT_MAX_BYTES = 16 * 1024 * 1024;
export const RESUME_CHECKPOINT_FILE_BYTES = 4 * 1024 * 1024;
const launch = z.string().regex(/^[a-f0-9]{32}$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const session = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const absolute = z.string().refine(p => path.isAbsolute(p) && path.normalize(p) === p && !p.includes('\0'));
const generation = z.object({schema:z.literal('aiterm.agent-generation.v1'),launch_id:launch,previous_launch_id:launch.nullable()}).strict();
const initialDelivery = z.object({status:z.enum(['not_requested','not_sent','submitted_unconfirmed','started']),reason:z.string(),turn_started:z.boolean().nullable()}).strict();
const processShape = z.object({identity:z.string(),parent:z.string().nullable(),argv_digest:digest}).strict();
// This first scope excludes other harness homes and Windows provenance instead of dropping them.
const metadata = z.object({kind:z.literal('codex'),aiterm_session:session,launch_id:launch,event_file:absolute,
  created_at:z.iso.datetime(),cwd:absolute,write_scope:z.string().optional(),vendor_session_id:z.string().uuid(),
  resumed_from:launch.optional(),initial_prompt:z.enum(['none','not_sent','done']),initial_prompt_delivery:initialDelivery.optional(),
  initial_prompt_cursor:z.number().int().safe().nonnegative().nullable().optional(),agent_executable:absolute,
  launch_operation_id:z.string().nullable().optional(),launch_request_digest:digest.nullable().optional(),
  hook_route:z.literal('shared_codex_home'),completion_route:z.literal('codex_transcript'),
  agent_role:z.literal('subagent'),parent_session_id:session,delegation_depth:z.number().int().safe().positive(),
  lineage:z.string().min(1).max(4096).regex(AGENT_LINEAGE_RE),delegation_allowed:z.literal(true),node_platform:z.literal('linux'),
  codex_home:absolute,fast:z.literal(false),model:z.string().nullable().optional(),startup_processes:z.array(z.string()).optional(),
  startup_process_shapes:z.array(processShape).optional(),
}).strict();
export const resumeCheckpointSuffixes = {
  generation:'.active-launch.json',metadata:'.agent.json',recipe:'.resume.json',template:'.resume-template.json',
  lifecycle:'.lifecycle.json',attempt:'.resume-attempt.json',native:'.resume-native.json',proof:'.codex-resume.json',
  resolution:'.resume-resolution.json',recovery_origin:'.resume-recovery-origin.json',failure:'.resume-failure.json',
} as const;
const schemas = {generation,metadata,recipe:agentResumeRecipeSchema,template:resumeTemplateSchema,lifecycle:agentLifecycleSchema,
  attempt:resumeAttemptSchema,native:resumeNativeSchema,proof:codexResumeProofSchema,resolution:resumeResolutionSchema,
  recovery_origin:recoveryOriginSchema,failure:agentResumeFailureSchema};
export const resumeCheckpointSchema = z.object({schema:z.literal('aiterm.resume-checkpoint.v1'),scope:z.object({
  session_id:session,launch_id:launch,uid:z.number().int().nonnegative(),node_platform:z.literal('linux'),state_base:absolute,
  socket:absolute,configuration_root:absolute,vendor_session_id:z.string().uuid(),
}).strict(),records:z.array(z.object({launch_id:launch,kind:z.enum(Object.keys(resumeCheckpointSuffixes) as [keyof typeof schemas,...(keyof typeof schemas)[]]),
  bytes_base64:z.string().max(Math.ceil(RESUME_CHECKPOINT_FILE_BYTES/3)*4),sha256:digest}).strict()).min(1).max(512)}).strict();
export type ResumeCheckpoint = z.infer<typeof resumeCheckpointSchema>;
export function resumeCheckpointDigest(bytes:Uint8Array):string {return createHash('sha256').update(bytes).digest('hex');}
function refuse():never {throw new Error('RESUME_STATE_UNCONFIRMED');}
export function resumeCheckpointRecord(launch_id:string,kind:keyof typeof schemas,bytes:Buffer):ResumeCheckpoint['records'][number] {
  if(bytes.length>RESUME_CHECKPOINT_FILE_BYTES)refuse();
  return {launch_id,kind,bytes_base64:bytes.toString('base64'),sha256:resumeCheckpointDigest(bytes)};
}
export function resumeCheckpointRecordPath(scope:ResumeCheckpoint['scope'],record:Pick<ResumeCheckpoint['records'][number],'launch_id'|'kind'>):string {
  session.parse(scope.session_id);launch.parse(record.launch_id);
  const stem=record.kind==='generation'?scope.session_id:`${scope.session_id}.${record.launch_id}`;
  return path.join(scope.state_base,`aiterm-mcp-${scope.uid}`,'agents',stem+resumeCheckpointSuffixes[record.kind]);
}
/** Validate every trust boundary before any caller writes a destination file. Original record bytes survive unchanged. */
export function validateResumeCheckpoint(input:unknown):ResumeCheckpoint {
  const bundle=resumeCheckpointSchema.parse(input),scope=bundle.scope;
  const values=new Map<string,any>();
  for(const record of bundle.records){
    const key=`${record.launch_id}/${record.kind}`,bytes=Buffer.from(record.bytes_base64,'base64');
    if(values.has(key)||bytes.length>RESUME_CHECKPOINT_FILE_BYTES||bytes.toString('base64')!==record.bytes_base64
      ||resumeCheckpointDigest(bytes)!==record.sha256)refuse();
    const value=schemas[record.kind].parse(JSON.parse(bytes.toString('utf8')));
    if(value.launch_id!==record.launch_id)refuse();
    values.set(key,value);
  }
  const get=(id:string,kind:keyof typeof schemas,required=true):any=>{
    const value=values.get(`${id}/${kind}`);if(required&&!value)refuse();return value;
  };
  const pointer=get(scope.launch_id,'generation');
  const visited=new Set<string>();let id:string|undefined=scope.launch_id;
  while(id!==undefined){
    if(visited.has(id)||visited.size>=64)refuse();visited.add(id);
    const m=get(id,'metadata'),recipe=get(id,'recipe');
    if(m.initial_prompt_delivery!==undefined&&m.initial_prompt_cursor===undefined)refuse();
    if(m.aiterm_session!==scope.session_id||m.vendor_session_id!==scope.vendor_session_id||m.codex_home!==scope.configuration_root
      ||m.event_file!==resumeCheckpointRecordPath(scope,{launch_id:id,kind:'metadata'}).replace(/\.agent\.json$/,'.events.jsonl')
      ||recipe.kind!=='codex'||recipe.vendor_session_id!==scope.vendor_session_id||recipe.configuration_root!==scope.configuration_root
      ||recipe.fast!==false||recipe.cwd!==m.cwd||recipe.executable!==m.agent_executable||recipe.model!==(m.model??null))refuse();
    if(Object.keys(recipe.environment).some(key=>/(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$/i.test(key)))refuse();
    const lineage=['agent_role','parent_session_id','delegation_depth','lineage','delegation_allowed'];
    if(lineage.some(k=>m[k]!==undefined)&&lineage.some(k=>m[k]===undefined))refuse();
    const life=get(id,'lifecycle',false),origin=get(id,'recovery_origin',false),attempt=get(id,'attempt',false);
    if(life&&origin)refuse();
    if(life){
      const proof=get(id,'proof');
      if(life.state!=='hibernated'||life.socket!==scope.socket||life.recipe_digest!==agentResumeRecipeDigest(recipe)
        ||life.resume_proof_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(proof))))refuse();
    }
    if(origin){
      if(origin.socket!==scope.socket||origin.previous_launch_id!==m.resumed_from||origin.recipe_digest!==agentResumeRecipeDigest(recipe)
        ||origin.resume_proof_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(get(id,'proof'))))
        ||origin.previous_native_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(get(id,'native')))))refuse();
      const failed=get(origin.previous_launch_id,'attempt');
      if(failed.state!=='failed'||failed.next_launch_id!==id||origin.failed_attempt_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(failed))))refuse();
    }
    if(attempt&&(!life&&!origin||attempt.state==='resuming'||attempt.recipe_digest!==agentResumeRecipeDigest(recipe)))refuse();
    const native=get(id,'native',false);if(native&&native.session_id!==scope.session_id)refuse();
    const proof=get(id,'proof',false);
    if(proof&&(proof.session_id!==scope.vendor_session_id||!proof.file.startsWith(scope.configuration_root+path.sep+'sessions'+path.sep)))refuse();
    const template=get(id,'template',false);
    if(template&&(template.kind!=='codex'||template.configuration_root!==scope.configuration_root
      ||Object.keys(template.environment).some(key=>/(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$/i.test(key))))refuse();
    const failure=get(id,'failure',false);if(failure&&failure.session_id!==scope.session_id)refuse();
    if(id===scope.launch_id){
      if(pointer.previous_launch_id!==(m.resumed_from??null)||attempt)refuse();
      if(!life){
        if(!m.resumed_from)refuse();
        const previous=get(m.resumed_from,'attempt');
        if(previous.state!=='failed'||previous.next_launch_id!==id
          ||JSON.stringify({...get(m.resumed_from,'recipe'),launch_id:id})!==JSON.stringify(recipe))refuse();
        get(id,'native');
      }
    }
    if(m.resumed_from){
      const previous=get(m.resumed_from,'attempt');
      if(previous.next_launch_id!==id)refuse();
      const pm=get(m.resumed_from,'metadata');
      if(lineage.some(k=>pm[k]!==m[k]))refuse();
    }
    id=m.resumed_from;
  }
  for(const record of bundle.records){
    if(!visited.has(record.launch_id)||(record.kind==='generation'&&record.launch_id!==scope.launch_id))refuse();
    if(record.kind==='attempt'&&!visited.has(get(record.launch_id,'attempt').next_launch_id))refuse();
    if(record.kind==='resolution'){
      const r=get(record.launch_id,'resolution'),m=get(record.launch_id,'metadata'),old=get(r.previous_launch_id,'attempt');
      const source=get(r.previous_launch_id,'lifecycle',false)??get(r.previous_launch_id,'recovery_origin',false);
      if(m.resumed_from!==r.previous_launch_id||old.state!=='failed'||old.next_launch_id!==r.launch_id||r.vendor_session_id!==scope.vendor_session_id
        ||!source||r.recipe_digest!==source.recipe_digest||r.resume_proof_digest!==source.resume_proof_digest
        ||r.attempt_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(old)))
        ||r.native_digest!==resumeCheckpointDigest(Buffer.from(JSON.stringify(get(r.launch_id,'native')))))refuse();
    }
  }
  return bundle;
}
export function encodeResumeCheckpoint(input:unknown):Buffer {
  const bytes=Buffer.from(JSON.stringify(validateResumeCheckpoint(input))+'\n');
  if(bytes.length>RESUME_CHECKPOINT_MAX_BYTES)refuse();return bytes;
}
export function decodeResumeCheckpoint(bytes:Buffer):ResumeCheckpoint {
  if(bytes.length>RESUME_CHECKPOINT_MAX_BYTES||bytes.length===0||bytes[bytes.length-1]!==10)refuse();
  const bundle=validateResumeCheckpoint(JSON.parse(bytes.toString('utf8')));
  if(!encodeResumeCheckpoint(bundle).equals(bytes))refuse();return bundle;
}
