import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createNativeDeliveryServer} from '../dist/execution-native-server.js';

async function fixture(t,name){
 const effects=[];const server=createNativeDeliveryServer({children:()=>[],currentLaunchId:()=> 'a'.repeat(32),
  pauseGoal:async target=>{effects.push('pause:'+target.session_id);return {status:'paused'};},
  sendKey:session_id=>{effects.push('key:'+session_id);return {session_id,outcome:'accepted'};}});
 const client=new Client({name,version:'artificial'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 t.after(async()=>{await client.close();await server.close();});return {client,effects};
}
test('native MCP whole-app stop requires the existing host and Owner metadata',async t=>{
 for(const name of ['bellteam','codex-mcp-client']){
  const f=await fixture(t,name);
  const result=await f.client.callTool({name:'agent_stop',arguments:{session_id:'goal-artificial',pause_goals:true},_meta:{'aiterm/goal':{origin:'user'}}});
  if(name==='bellteam'){assert.equal(result.isError,undefined);assert.equal(result.structuredContent.targets[0].goal_pause,'paused');assert.deepEqual(f.effects,['pause:goal-artificial','key:goal-artificial']);}
  else{assert.equal(result.isError,true);assert.deepEqual(f.effects,[]);}
 }
});
test('ordinary one-Bot stop keeps its previous key-only behavior',async t=>{
 const f=await fixture(t,'codex-mcp-client');const result=await f.client.callTool({name:'agent_stop',arguments:{session_id:'goal-artificial'}});
 assert.equal(result.isError,undefined);assert.deepEqual(f.effects,['key:goal-artificial']);assert.equal(result.structuredContent.targets[0].goal_pause,undefined);
});
