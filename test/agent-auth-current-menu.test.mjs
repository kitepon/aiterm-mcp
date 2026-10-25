import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'auth-menu-'));
process.env.HOME=root;process.env.TMPDIR=root;process.env.XDG_RUNTIME_DIR=root;
const {claudeAuthPane}=await import('../dist/harnesses/claude.js');
const core=await import('../dist/core.js');
const sessions=[];
after(()=>{for(const session of sessions)core.closeSession(session);assert.equal(core.listSessionsResult().sessions.length,0);fs.rmSync(root,{recursive:true,force:true});});
const native={skip:process.platform==='win32'||spawnSync('tmux',['-V']).status!==0};
const oldTheme='Choose the text style that looks best with your terminal\n❯ 1. Dark mode\n  2. Light mode\n';
const currentLogin='Select login method:\n  1. Claude account with subscription\n❯ 2. Anthropic Console account\n';
async function fixture(){
 const dir=fs.mkdtempSync(path.join(root,'cli-'));const bin=path.join(dir,'claude');
 fs.writeFileSync(bin,`#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const dir=${JSON.stringify(dir)};
if(process.argv.includes('status')){console.log('{"loggedIn":false}');process.exit(1)}
let at=2,occupied=false,keys=[];
function paint(){let screen=${JSON.stringify(oldTheme)};
if(occupied)screen+='Paste code here if prompted > existing-draft';
else screen+='Select login method:\\n'+(at===1?'❯ 1. Claude account with subscription\\n  2. Anthropic Console account\\n':'  1. Claude account with subscription\\n❯ 2. Anthropic Console account\\n');
process.stdout.write('\\x1b[2J\\x1b[H'+screen);}
process.stdin.setRawMode(true);process.stdin.resume();paint();
setInterval(()=>{if(!occupied&&fs.existsSync(path.join(dir,'occupy'))){occupied=true;paint()}},10);
process.stdin.on('data',data=>{
 if(data.equals(Buffer.from('\\x1b[B'))){keys.push('Down');at=at===1?2:1;paint()}
 else if(data.includes(13)){keys.push('Enter');fs.writeFileSync(path.join(dir,'selected'),String(at));process.stdout.write('\\x1b[2J\\x1b[HWaiting for official response\\n')}
 else keys.push('other');
 fs.writeFileSync(path.join(dir,'keys'),JSON.stringify(keys));
});
`,{mode:0o755});process.env.CLAUDE_BIN=bin;
 const receipt=await core.authenticateAgent('claude',{action:'start',cwd:dir,relogin:true});sessions.push(receipt.session_id);return {dir,receipt};
}
test('CURRENT-MENU-1: old theme cursor1 plus current login cursor2 selects requested current option1',native,async()=>{
 const pane=claudeAuthPane(oldTheme+currentLogin);
 assert.equal(pane.native_input.selected_id,'option-2');
 assert.deepEqual(pane.ui.choices.map(row=>row.label),['Claude account with subscription','Anthropic Console account']);
 const {dir,receipt}=await fixture();
 await core.authenticateAgent('claude',{action:'respond',session_id:receipt.session_id,expected_binding:receipt.auth_ui.binding,expected_prompt_digest:receipt.auth_ui.prompt_digest,response:{kind:'choice',id:'option-1'}});
 assert.equal(fs.readFileSync(path.join(dir,'selected'),'utf8'),'1');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'keys'),'utf8')),['Down','Enter']);
});
test('CURRENT-MENU-1: occupied current code field deactivates old theme and refuses before any key',native,async()=>{
 const pane=claudeAuthPane(oldTheme+'Paste code here if prompted > existing-draft');
 assert.equal(pane.ui,undefined);assert.deepEqual(pane.native_input,{kind:'authorization_code',empty:false});
 const {dir,receipt}=await fixture();fs.writeFileSync(path.join(dir,'occupy'),'1');
 let now;
 for(let i=0;i<50;i++){now=await core.authenticateAgent('claude',{action:'status',session_id:receipt.session_id});if(now.auth_ui.stage==='unavailable')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(now.auth_ui.stage,'unavailable');assert.equal(now.auth_ui.input,null);
 await assert.rejects(core.authenticateAgent('claude',{action:'respond',session_id:receipt.session_id,expected_binding:receipt.auth_ui.binding,expected_prompt_digest:receipt.auth_ui.prompt_digest,response:{kind:'choice',id:'option-1'}}),error=>error.effect==='not_issued'&&error.reason_code==='AGENT_AUTH_STAGE_MISMATCH');
 assert.equal(fs.existsSync(path.join(dir,'keys')),false);assert.equal(fs.existsSync(path.join(dir,'selected')),false);
});
