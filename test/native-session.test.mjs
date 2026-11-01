import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeSessionReceipt,nativePaneTarget,nativeSessionTarget,nativeSessionCondition} from '../dist/native-session.js';

const target={native_id:'$1355',session_id:'idle-native-proof',server_pid:74940,pane_id:'%1',pane_pid:76120};
test('native create receipts accept exact OS output and reject ambiguous or unsafe identities',()=>{
 for(const platform of ['linux','darwin','win32'])assert.deepEqual(parseNativeSessionReceipt('$1355\tidle-native-proof\t74940\t%1\t76120\r\n',platform),target);
 assert.deepEqual(parseNativeSessionReceipt('$1355 idle-native-proof 74940 %1 76120\n','win32'),target);
 for(const value of ['$1355 idle-native-proof 74940 %1 76120\n','$1355\tforeign name\t74940\t%1\t76120\n','$1355\tidle-native-proof\t0\t%1\t76120\n','$1355\tidle-native-proof\t9007199254740992\t%1\t76120\n','$1355\tidle-native-proof\t74940\t%1\t76120\nextra'])assert.throws(()=>parseNativeSessionReceipt(value,'linux'),/unconfirmed/);
 assert.throws(()=>parseNativeSessionReceipt('$1355  idle-native-proof 74940 %1 76120','win32'),/unconfirmed/);
});
test('Windows pane targets retain their server session identity despite recycled pane numbers',()=>{
 assert.equal(nativePaneTarget(target,'win32'),'idle-native-proof:.%1');
 assert.equal(nativePaneTarget({...target,native_id:'$1357',session_id:'second'},'win32'),'second:.%1');
 assert.equal(nativePaneTarget(target,'linux'),'%1');
 assert.match(nativeSessionCondition(target),/pid},74940/);
 for(const text of ['session_id},$1355','session_name},idle-native-proof','pane_id},%1','pane_pid},76120'])assert.ok(nativeSessionCondition(target).includes(text));
 assert.ok(!nativeSessionCondition(target).includes('pane_dead'));
 assert.ok(nativeSessionCondition(target,true).includes('#{&&:#{==:#{pane_dead},1},#{==:#{pane_pid},}}'));
});
test('session commands use exact session names without a pane suffix on Windows',()=>{
 assert.equal(nativeSessionTarget(target,'win32'),'=idle-native-proof');
 for(const platform of ['linux','darwin'])assert.equal(nativeSessionTarget(target,platform),'$1355');
});
