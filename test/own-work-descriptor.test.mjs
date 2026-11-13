import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import test from "node:test";
import assert from "node:assert/strict";
const core = await import("../dist/core.js");
test('process descriptor: basename, first two non-flag arguments, masked secrets; Windows argv rules',()=>{
 assert.deepEqual(core.processDescriptor(['/usr/bin/node','./node_modules/vite/bin/vite.js','dev','--port','3000'],false),{exe:'node',args:['vite.js','dev']});
 assert.deepEqual(core.processDescriptor(['python','-m','http.server','8000'],false),{exe:'python',args:['http.server','8000']});
 assert.deepEqual(core.processDescriptor(['curl','https://example.invalid/x','user@host'],false),{exe:'curl',args:['…','…']});
 assert.deepEqual(core.processDescriptor(['C:\\Program Files\\nodejs\\Node.EXE','server.js'],true),{exe:'node',args:['server.js']});
 assert.deepEqual(core.windowsCommandLineArgv('"C:\\Program Files\\node.exe" "a b" c\\\\"d e" f\\"g "h""i"'),
  ['C:\\Program Files\\node.exe','a b','c\\d e','f"g','h"i']);
});
