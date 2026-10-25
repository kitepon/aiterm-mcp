// MCPB is built on one OS and used on both macOS architectures. npm's optional
// dependencies otherwise install only the builder's native Koffi module.
import {readFileSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function darwinNativePackages(lock){
 const version=lock.packages?.['node_modules/koffi']?.version;
 if(version!=='3.3.4')throw Error('Unaccepted Koffi version');
 return ['arm64','x64'].map(arch=>{
  const name=`@koromix/koffi-darwin-${arch}`,entry=lock.packages?.[`node_modules/${name}`];
  if(entry?.version!==version||!/^sha512-[A-Za-z0-9+/]+=*$/u.test(entry.integrity??''))throw Error('Darwin native dependency lock missing');
  return {name,version,integrity:entry.integrity};
 });
}
export function verifyNativeArchive(bytes,expected){return 'sha512-'+createHash('sha512').update(bytes).digest('base64')===expected;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stage=path.join(root,'dist/mcpb-stage/server');
 const npmCli=process.env.npm_execpath;if(!npmCli)throw Error('Run native bundling through npm run mcpb:build');
 const lock=JSON.parse(readFileSync(path.join(stage,'package-lock.json'),'utf8')),cache=path.join(root,'dist/mcpb-native-archives');mkdirSync(cache,{recursive:true});
 for(const entry of darwinNativePackages(lock)){
  const stdout=execFileSync(process.execPath,[npmCli,'pack',`${entry.name}@${entry.version}`,'--ignore-scripts','--json','--pack-destination',cache],{cwd:root,encoding:'utf8'});
  const raw=JSON.parse(stdout),packed=Array.isArray(raw)?raw[0]:Object.values(raw)[0],archive=path.join(cache,packed.filename);
  if(!verifyNativeArchive(readFileSync(archive),entry.integrity))throw Error('Darwin native archive integrity mismatch');
  const target=path.join(stage,'node_modules',entry.name);rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
  execFileSync('tar',['-xzf',archive,'-C',target,'--strip-components=1'],{stdio:'inherit'});
  const actual=JSON.parse(readFileSync(path.join(target,'package.json'),'utf8'));
  if(actual.name!==entry.name||actual.version!==entry.version)throw Error('Darwin native package mismatch');
 }
}
