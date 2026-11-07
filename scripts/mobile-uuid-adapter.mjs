import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const MOBILE_BUILD_RECEIPT='alpha-mobile-build.json';
export const MOBILE_UUID_POLICY='patches/eliza/mobile-uuid-build.json';
export const MOBILE_BUILD_INPUTS=['scripts/build-mobile-agent.mjs','scripts/mobile-uuid-adapter.mjs','scripts/mobile-bundle-smoke.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const safe=name=>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
function readRegular(root,name){
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
export function uuidCommonJsBridge(contents,indexPath){
 const rows=contents.trim().split(/\r?\n/);
 const exports=rows.map(row=>/^export \{ default as ([A-Za-z][A-Za-z0-9]*) \} from '(\.\/[A-Za-z][A-Za-z0-9]*\.js)';$/.exec(row));
 if(exports.length!==14||exports.some(row=>!row)||new Set(exports.map(row=>row?.[1])).size!==14)throw Error('Unreviewed UUID barrel syntax');
 return exports.map((row,i)=>`var binding${i}=require(${JSON.stringify(path.resolve(path.dirname(indexPath),row[2]))}).default;`).join('\n')+'\nmodule.exports={'+exports.map((row,i)=>`${row[1]}:binding${i}`).join(',')+'};\n';
}

export function mobileBuildInputs(root,source){
 root=path.resolve(root);source=path.resolve(source);
 const policyBytes=readRegular(root,MOBILE_UUID_POLICY),policy=JSON.parse(policyBytes);
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
  if(!/^[a-f0-9]{64}$/.test(digest)||hash(readRegular(packageRoot,name))!==digest)throw Error('Reviewed UUID package input changed: '+name);
 }
 const installed=json(path.join(packageRoot,'package.json'));
 if(installed.name!==policy.package.name||installed.version!==policy.package.version)throw Error('Installed UUID version differs');
 const expectedInventory=Object.keys(packageFiles).filter(name=>name.startsWith('dist-node/')).sort();
 const actualInventory=fs.readdirSync(path.join(packageRoot,'dist-node')).filter(name=>name.endsWith('.js')).map(name=>'dist-node/'+name).sort();
 if(!isDeepStrictEqual(expectedInventory,actualInventory))throw Error('Reviewed UUID package has unexpected modules');
 const adapterFiles=Object.fromEntries(MOBILE_BUILD_INPUTS.map(name=>[name,hash(readRegular(root,name))]));
 return {policy,packageRoot,identity:{format:'alpha-mobile-build-v1',sourcePin:pin,sourceStampSha256:hash(readRegular(source,'.alpha-runtime-source.json')),lockSha256:hash(readRegular(source,'bun.lock')),policySha256:hash(policyBytes),adapterFiles,bun:policy.bun,builder:policy.builder,uuid:{version:policy.package.version,files:packageFiles}}};
}

export function createMobileUuidAdapter(root,source){
 const inputs=mobileBuildInputs(root,source),index=path.join(inputs.packageRoot,'dist-node/index.js'),transforms=[];
 return {inputs,transforms,plugin:{name:'reviewed-mobile-uuid-cjs',setup(build){
  // Older UUID packages already use CommonJS and remain the upstream producer's
  // responsibility. Only this exact locked ESM package needs the adapter.
  build.onLoad({filter:/[\\/]uuid@14\.0\.2[\\/]node_modules[\\/]uuid[\\/]dist(?:-node)?[\\/]index\.js$/},args=>{
   if(path.resolve(args.path)!==index)throw Error('Unreviewed UUID barrel reached the Android producer');
   const bytes=readRegular(inputs.packageRoot,'dist-node/index.js');
   if(hash(bytes)!==inputs.policy.package.files['dist-node/index.js'])throw Error('UUID barrel changed during build');
   const contents=uuidCommonJsBridge(bytes.toString('utf8'),index);
   transforms.push({path:inputs.policy.package.root+'/dist-node/index.js',sourceSha256:hash(bytes),bridgeSha256:hash(contents)});
   return {loader:'js',contents};
  });
 }}};
}

export function mobileBuildReceipt(root,source,bundle,transforms){
 const inputs=mobileBuildInputs(root,source),index=path.join(inputs.packageRoot,'dist-node/index.js');
 const expected=[{path:inputs.policy.package.root+'/dist-node/index.js',sourceSha256:inputs.policy.package.files['dist-node/index.js'],bridgeSha256:hash(uuidCommonJsBridge(readRegular(inputs.packageRoot,'dist-node/index.js').toString('utf8'),index))}];
 if(!isDeepStrictEqual(transforms,expected))throw Error('Mobile UUID producer must transform exactly the reviewed barrel');
 return {...inputs.identity,transforms,bundleSha256:hash(fs.readFileSync(bundle)),smoke:{uuidSemantics:true,messageTurnBeforeProvider:true}};
}

/** Reject stale producers even when the original upstream source stamp still matches. */
export function verifyMobileBuildReceipt(root,source,agent=path.join(source,'packages/agent/dist-mobile')){
 const receipt=json(path.join(agent,MOBILE_BUILD_RECEIPT));
 const expected=mobileBuildReceipt(root,source,path.join(agent,'agent-bundle.js'),receipt.transforms);
 if(!isDeepStrictEqual(receipt,expected))throw Error('Mobile build receipt differs from reviewed producer or bundle');
 return receipt;
}
