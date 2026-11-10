import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseBuildPolicy} from './build-policy-source.ts';

import {coreStateBuildRecord,CORE_STATE_TARGET,NOTES_STATE_TARGETS,TURN_STATE_TARGET,ROOM_QUEUE_TARGET,EMBEDDING_STATE_TARGET,NAMED_EMBEDDING_TARGETS,PLUGIN_CONNECTOR_TARGET} from './core-state-patch.ts';

export const MOBILE_BUILD_RECEIPT='alpha-mobile-build.json';
export const MOBILE_UUID_POLICY='scripts/upstream-mobile-build.ts';
export const MOBILE_BUILD_INPUTS=['scripts/build-mobile-agent.ts','scripts/mobile-uuid-adapter.ts','scripts/mobile-bundle-smoke.ts','scripts/build-policy-source.ts'];
const hash=(bytes: any)=>createHash('sha256').update(bytes).digest('hex');
const json=(file: any)=>JSON.parse(fs.readFileSync(file,'utf8'));
const safe=(name: any)=>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every((part: any)=>part&&part!=='.'&&part!=='..');
function readRegular(root: any,name: any){
 if(!safe(name))throw Error('Unsafe mobile UUID build path');
 const file=path.join(root,name);
 for(let current=file;current!==root;current=path.dirname(current)){
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink()||(current===file?!stat.isFile():!stat.isDirectory()))throw Error('Mobile UUID build input must be regular');
 }
 const bytes=fs.readFileSync(file);
 if(bytes.length>2*1024*1024)throw Error('Mobile UUID build input exceeds size bound');
 return bytes;
}

/** Only the reviewed UUID barrel is adapted; every algorithm remains its real package module. */
export function uuidCommonJsBridge(contents: any,indexPath: any){
 const rows=contents.trim().split(/\r?\n/);
 const exports=rows.map((row: any)=>/^export \{ default as ([A-Za-z][A-Za-z0-9]*) \} from '(\.\/[A-Za-z][A-Za-z0-9]*\.js)';$/.exec(row));
 if(exports.length!==14||exports.some((row: any)=>!row)||new Set(exports.map((row: any)=>row?.[1])).size!==14)throw Error('Unreviewed UUID barrel syntax');
 return exports.map((row: any,i: any)=>`var binding${i}=require(${JSON.stringify(path.resolve(path.dirname(indexPath),row[2]))}).default;`).join('\n')+'\nmodule.exports={'+exports.map((row: any,i: any)=>`${row[1]}:binding${i}`).join(',')+'};\n';
}

export function mobileBuildInputs(root: any,source: any){
 root=path.resolve(root);source=path.resolve(source);
 const policyBytes=readRegular(root,MOBILE_UUID_POLICY),policy=parseBuildPolicy(policyBytes);
 const pin=json(path.join(root,'upstream.lock.json')).commit;
 if(policy.schema!==1||policy.baseCommit!==pin||policy.package?.name!=='uuid'||policy.package.version!=='14.0.2'||policy.package.root!=='node_modules/.bun/uuid@14.0.2/node_modules/uuid')throw Error('Unreviewed mobile UUID build policy');
 if(policy.bun?.version!=='1.4.2'||!policy.bun.revision||policy.builder?.path!=='packages/agent/scripts/build-mobile-bundle.ts')throw Error('Unreviewed mobile UUID producer');
 if(json(path.join(source,'.alpha-runtime-source.json')).base!==pin)throw Error('Mobile UUID producer source differs from reviewed pin');
 if(hash(readRegular(source,policy.builder.path))!==policy.builder.sha256)throw Error('Mobile UUID producer changed');
 if(hash(readRegular(source,'bun.lock'))!==policy.lockSha256)throw Error('Mobile UUID dependency lock changed');
 const packageRoot=path.join(source,policy.package.root),packageFiles=policy.package.files;
 if(!packageFiles||Object.keys(packageFiles).length!==23||!Object.hasOwn(packageFiles,'package.json')||!Object.hasOwn(packageFiles,'dist-node/index.js'))throw Error('Incomplete reviewed UUID package inventory');
 for(const [name,digest] of Object.entries(packageFiles)){
  if(name!=='package.json'&&!/^dist-node\/[A-Za-z][A-Za-z0-9-]*\.js$/.test(name))throw Error('Unreviewed UUID input path');
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||hash(readRegular(packageRoot,name))!==digest)throw Error('Reviewed UUID package input changed: '+name);
 }
 const installed=json(path.join(packageRoot,'package.json'));
 if(installed.name!==policy.package.name||installed.version!==policy.package.version)throw Error('Installed UUID version differs');
 const expectedInventory=Object.keys(packageFiles).filter((name: any)=>name.startsWith('dist-node/')).sort();
 const actualInventory=fs.readdirSync(path.join(packageRoot,'dist-node')).filter((name: any)=>name.endsWith('.js')).map((name: any)=>'dist-node/'+name).sort();
 if(!isDeepStrictEqual(expectedInventory,actualInventory))throw Error('Reviewed UUID package has unexpected modules');
 const adapterFiles=Object.fromEntries(MOBILE_BUILD_INPUTS.map((name: any)=>[name,hash(readRegular(root,name))]));
 return {policy,packageRoot,identity:{format:'alpha-mobile-build-v1',sourcePin:pin,sourceStampSha256:hash(readRegular(source,'.alpha-runtime-source.json')),lockSha256:hash(readRegular(source,'bun.lock')),policySha256:hash(policyBytes),adapterFiles,bun:policy.bun,builder:policy.builder,uuid:{version:policy.package.version,files:packageFiles}}};
}

export function expectedMobileUuidTransforms(inputs: any){
 const index=path.join(inputs.packageRoot,'dist-node/index.js');
 return [{
  path:inputs.policy.package.root+'/dist-node/index.js',
  sourceSha256:inputs.policy.package.files['dist-node/index.js'],
  bridgeSha256:hash(uuidCommonJsBridge(readRegular(inputs.packageRoot,'dist-node/index.js').toString('utf8'),index)),
 }];
}

export function mobileBuildReceipt(root: any,source: any,bundle: any,transforms: any,coreTransforms: any){
 const inputs=mobileBuildInputs(root,source),expected=expectedMobileUuidTransforms(inputs);
 if(!isDeepStrictEqual(transforms,expected))throw Error('Mobile UUID producer must transform exactly the reviewed barrel');
 return {...inputs.identity,transforms,coreState:coreStateBuildRecord(root,coreTransforms,[CORE_STATE_TARGET,...NOTES_STATE_TARGETS,TURN_STATE_TARGET,ROOM_QUEUE_TARGET,EMBEDDING_STATE_TARGET,...NAMED_EMBEDDING_TARGETS,PLUGIN_CONNECTOR_TARGET]),bundleSha256:hash(fs.readFileSync(bundle)),smoke:{uuidSemantics:true,messageTurnBeforeProvider:true}};
}

/** Reject stale producers even when the original upstream source stamp still matches. */
export function verifyMobileBuildReceipt(root: any,source: any,agent: any=path.join(source,'packages/agent/dist-mobile')){
 const receipt=json(path.join(agent,MOBILE_BUILD_RECEIPT));
 const expected=mobileBuildReceipt(root,source,path.join(agent,'agent-bundle.js'),receipt.transforms,receipt.coreState?.transforms);
 if(!isDeepStrictEqual(receipt,expected))throw Error('Mobile build receipt differs from reviewed producer or bundle');
 return receipt;
}
