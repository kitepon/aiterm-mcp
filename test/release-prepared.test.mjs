import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('a reviewed prepared release validates metadata without rewriting or duplicating its release commit', async t => {
  const root=mkdtempSync(join(tmpdir(),'prepared-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'mcpb'));
  const files=['package.json','package-lock.json','server.json','mcpb/manifest.json','README.md','README.ja.md','CHANGELOG.md'];
  for(const file of [...files,'scripts/release.mjs'])copyFileSync(new URL('../'+file,import.meta.url),join(root,file));
  const before=files.map(file=>readFileSync(join(root,file),'utf8'));
  const version=JSON.parse(before[0]).version, calls=[], original=childProcess.execFileSync, args=[...process.argv], npm=process.env.npm_execpath;
  childProcess.execFileSync=(command, argv, options)=>{
    calls.push({command,args:[...argv]});assert.equal(options.cwd,root);
    if(command==='git'&&argv[0]==='branch')return 'main';
    if(command==='git'&&argv[0]==='rev-parse')return '1'.repeat(40);
    return '';
  };syncBuiltinESMExports();process.argv[2]=version;process.env.npm_execpath=join(root,'fake-npm.js');
  try { await import(pathToFileURL(join(root,'scripts/release.mjs')).href); }
  finally { childProcess.execFileSync=original;syncBuiltinESMExports();process.argv=args;if(npm===undefined)delete process.env.npm_execpath;else process.env.npm_execpath=npm; }
  assert.deepEqual(files.map(file=>readFileSync(join(root,file),'utf8')),before);
  assert.ok(calls.some(call=>call.args.includes('test/release-metadata.test.mjs')),'same metadata validation still required');
  assert.ok(!calls.some(call=>call.command==='git'&&['add','commit'].includes(call.args[0])));
  assert.ok(calls.some(call=>call.command==='git'&&call.args[0]==='tag'&&call.args[1]==='v'+version));
  assert.ok(calls.some(call=>call.command==='gh'&&call.args[0]==='release'),'only mocked publication commands run');
});
