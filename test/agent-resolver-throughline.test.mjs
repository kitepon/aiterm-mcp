import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveThroughlineBin, runThroughlineHandoffContext } from '../dist/agent-resolver.js';

test('Throughline PATH discovery skips the extensionless Windows npm wrapper', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'throughline-discovery-'));
  const savedPath=process.env.PATH, savedBin=process.env.THROUGHLINE_BIN;
  const windows=process.platform==='win32';
  const bin=path.join(dir,windows?'throughline.cmd':'throughline');
  const payload=JSON.stringify({schema:'throughline.handoff_context.v1',status:'ready',sessionId:'fixture-session',context:'FIXTURE_CONTEXT'});
  try {
    if(windows) {
      fs.writeFileSync(path.join(dir,'throughline'),'#!/bin/sh\nexit 9\n');
      fs.writeFileSync(bin,'@echo off\r\nexit /b 9\r\n');
      fs.writeFileSync(path.join(dir,'throughline.ps1'),`Write-Output '${payload}'\r\n`);
    } else fs.writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' '${payload}'\n`,{mode:0o755});
    delete process.env.THROUGHLINE_BIN;
    process.env.PATH=dir+path.delimiter+savedPath;
    const resolved=resolveThroughlineBin();
    assert.ok(resolved,'the runnable PATH entry must be found');
    assert.equal(fs.realpathSync.native(resolved),fs.realpathSync.native(bin));
    const result=runThroughlineHandoffContext(bin,'fixture-session');
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).context,'FIXTURE_CONTEXT');
    process.env.THROUGHLINE_BIN=path.join(dir,'missing');
    assert.equal(resolveThroughlineBin(),null,'an invalid explicit override must not fall back to PATH');
  } finally {
    if(savedPath===undefined)delete process.env.PATH;else process.env.PATH=savedPath;
    if(savedBin===undefined)delete process.env.THROUGHLINE_BIN;else process.env.THROUGHLINE_BIN=savedBin;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
