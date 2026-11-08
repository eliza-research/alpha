import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createMobileUuidAdapter,mobileBuildInputs,mobileBuildReceipt,verifyMobileBuildReceipt,uuidCommonJsBridge,MOBILE_BUILD_RECEIPT,MOBILE_UUID_POLICY,MOBILE_BUILD_INPUTS} from '../scripts/mobile-uuid-adapter.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const actualPolicy=JSON.parse(fs.readFileSync(new URL('../patches/eliza/mobile-uuid-build.json',import.meta.url)));
const barrel=[['MAX','max'],['NIL','nil'],...['parse','stringify','v1','v1ToV6','v3','v4','v5','v6','v6ToV1','v7','validate','version'].map(name=>[name,name])].map(([name,file])=>`export { default as ${name} } from './${file}.js';`).join('\n')+'\n';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-uuid-producer-')),source=path.join(root,'source'),policy=structuredClone(actualPolicy);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const json=(name,value)=>write(name,JSON.stringify(value));
 json('upstream.lock.json',{commit:policy.baseCommit});json('source/.alpha-runtime-source.json',{base:policy.baseCommit,patches:[]});write('source/bun.lock','fixture pinned dependency lock');policy.lockSha256=hash('fixture pinned dependency lock');
 write('source/'+policy.builder.path,'fixture unchanged producer');policy.builder.sha256=hash('fixture unchanged producer');
 for(const name of MOBILE_BUILD_INPUTS)write(name,'fixture '+name);
 for(const name of Object.keys(policy.package.files)){
  const bytes=name==='package.json'?JSON.stringify({name:'uuid',version:'14.0.2'}):name==='dist-node/index.js'?barrel:'export default "fixture";\n';
  write('source/'+policy.package.root+'/'+name,bytes);policy.package.files[name]=hash(bytes);
 }
 const save=()=>json(MOBILE_UUID_POLICY,policy);save();
 const bundle=path.join(source,'packages/agent/dist-mobile/agent-bundle.js');write('source/packages/agent/dist-mobile/agent-bundle.js','fixture bundled output');
 return {root,source,policy,write,json,save,bundle};
}
function transform(f){
 const adapter=createMobileUuidAdapter(f.root,f.source);let load;
 adapter.plugin.setup({onLoad(options,callback){
  assert.ok(options.filter.test('/node_modules/.bun/uuid@14.0.2/node_modules/uuid/dist-node/index.js'));
  for(const version of ['8.3.2','9.0.1'])assert.equal(options.filter.test(`/node_modules/.bun/uuid@${version}/node_modules/uuid/dist/index.js`),false,'upstream CommonJS dependencies are not rewritten');
  load=callback;
 }});
 return {adapter,load,index:path.join(f.source,f.policy.package.root,'dist-node/index.js')};
}
test('the reviewed UUID barrel uses the real algorithm modules through a bounded namespace bridge',t=>{
 const f=fixture(t),{adapter,load,index}=transform(f),result=load({path:index});
 assert.equal(result.loader,'js');assert.equal((result.contents.match(/require\(/g)||[]).length,14);
 assert.match(result.contents,/v4:binding7/);assert.match(result.contents,/\/dist-node\/v4\.js"\)\.default/);
 assert.doesNotMatch(result.contents,/randomUUID|Math\.random|crypto\.random/);
 assert.equal(adapter.transforms.length,1);assert.equal(adapter.transforms[0].sourceSha256,f.policy.package.files['dist-node/index.js']);
 assert.throws(()=>load({path:index.replace('/dist-node/','/dist/')}),/Unreviewed UUID barrel/);
});
test('barrel parser refuses extra statements, missing or duplicate exports, and path traversal',()=>{
 for(const text of [barrel+'evil();\n',barrel.replace("./v4.js","../v4.js"),barrel.replace('v4 }','v5 }'),barrel.replace(/export.*v4.*\n/,''),barrel.replace("'./v4.js'",'"./v4.js"')])assert.throws(()=>uuidCommonJsBridge(text,'/fixture/index.js'),/Unreviewed UUID barrel syntax/);
});
test('changed producer, dependency lock, package module or package version is rejected',t=>{
 for(const name of ['source/'+actualPolicy.builder.path,'source/bun.lock','source/'+actualPolicy.package.root+'/dist-node/v4.js']){
  const f=fixture(t);fs.appendFileSync(path.join(f.root,name),'changed');assert.throws(()=>mobileBuildInputs(f.root,f.source),/changed/);
 }
 const f=fixture(t);f.policy.package.version='15.0.0';f.save();assert.throws(()=>mobileBuildInputs(f.root,f.source),/Unreviewed/);
 const g=fixture(t);g.json('source/'+g.policy.package.root+'/package.json',{name:'uuid',version:'15.0.0'});g.policy.package.files['package.json']=hash(fs.readFileSync(path.join(g.source,g.policy.package.root,'package.json')));g.save();assert.throws(()=>mobileBuildInputs(g.root,g.source),/Installed UUID version differs/);
});
test('package symlinks and undeclared extra modules cannot enter a build',t=>{
 const f=fixture(t),module=path.join(f.source,f.policy.package.root,'dist-node/v4.js'),outside=path.join(f.root,'outside.js');fs.copyFileSync(module,outside);fs.unlinkSync(module);fs.symlinkSync(outside,module);assert.throws(()=>mobileBuildInputs(f.root,f.source),/must be regular/);
 const g=fixture(t);g.write('source/'+g.policy.package.root+'/dist-node/extra.js','extra');assert.throws(()=>mobileBuildInputs(g.root,g.source),/unexpected modules/);
});
test('exactly one transform and its complete producer receipt are required',t=>{
 const f=fixture(t),{adapter,load,index}=transform(f);load({path:index});
 const receipt=mobileBuildReceipt(f.root,f.source,f.bundle,adapter.transforms),directory=path.dirname(f.bundle);
 const save=value=>fs.writeFileSync(path.join(directory,MOBILE_BUILD_RECEIPT),JSON.stringify(value));save(receipt);
 assert.deepEqual(verifyMobileBuildReceipt(f.root,f.source),receipt);
 for(const transforms of [[],[...adapter.transforms,...adapter.transforms],[{...adapter.transforms[0],bridgeSha256:'0'.repeat(64)}]])assert.throws(()=>mobileBuildReceipt(f.root,f.source,f.bundle,transforms),/exactly the reviewed barrel/);
 for(const mutate of [value=>value.smoke.uuidSemantics=false,value=>value.bundleSha256='0'.repeat(64),value=>value.adapterFiles[MOBILE_BUILD_INPUTS[0]]='0'.repeat(64),value=>value.sourceStampSha256='0'.repeat(64)]){const changed=structuredClone(receipt);mutate(changed);save(changed);assert.throws(()=>verifyMobileBuildReceipt(f.root,f.source),/differs/);}
 save(receipt);fs.appendFileSync(f.bundle,'changed');assert.throws(()=>verifyMobileBuildReceipt(f.root,f.source),/differs/);
});
test('producer and its pre-provider smoke are bound into staging and packaging admission',()=>{
 const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
 assert.match(read('scripts/stage-local-agent-runtime.mjs'),/scripts\/build-mobile-agent\.mjs/);
 assert.match(read('scripts/stage-local-agent-runtime.mjs'),/verifyMobileBuildReceipt\(root,source\)/);
 assert.match(read('scripts/runtime-profile.mjs'),/verifyMobileBuildReceipt\(root,source,agent\)/);
 for(const name of MOBILE_BUILD_INPUTS)assert.ok(read('scripts/source-snapshot.mjs').includes(name));
 assert.match(read('scripts/verify-packaged-runtime.py'),/mobile_policy_file\.exists\(\) or/);
 assert.match(read('scripts/build-mobile-agent.mjs'),/Bun\.revision!==inputs\.policy\.bun\.revision/);
 assert.match(read('scripts/build-mobile-agent.mjs'),/MOBILE_UUID_AND_TURN_SMOKE_OK/);
});
