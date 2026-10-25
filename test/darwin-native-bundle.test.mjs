import './seat-env.mjs';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {darwinNativePackages,verifyNativeArchive} from '../scripts/bundle-darwin-native.mjs';
const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url)));
test('cross-platform MCPB includes both exact locked Darwin FFI packages regardless of build host',()=>{
 const result=darwinNativePackages(lock);assert.deepEqual(result.map(x=>x.name),['@koromix/koffi-darwin-arm64','@koromix/koffi-darwin-x64']);assert.ok(result.every(x=>x.version==='3.3.4'&&x.integrity.startsWith('sha512-')));
 for(const change of [data=>delete data.packages['node_modules/@koromix/koffi-darwin-x64'],data=>data.packages['node_modules/koffi'].version='3.3.5',data=>data.packages['node_modules/@koromix/koffi-darwin-arm64'].integrity='unknown']){const copy=structuredClone(lock);change(copy);assert.throws(()=>darwinNativePackages(copy));}
 assert.equal(verifyNativeArchive(Buffer.from('changed bytes'),result[0].integrity),false);
});
