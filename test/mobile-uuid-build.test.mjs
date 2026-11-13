import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {expectedMobileUuidTransforms,mobileBuildInputs,mobileBuildReceipt,verifyMobileBuildReceipt,uuidCommonJsBridge,MOBILE_BUILD_RECEIPT,MOBILE_BUILD_INPUTS} from '../scripts/mobile-uuid-adapter.ts';
import {actualPolicy, barrel, hash, mobileUuidFixture} from './fixtures/mobile-uuid-build.mjs';

function fixture(t){
 const result=mobileUuidFixture();
 t.after(result.cleanup);
 return result;
}
test('the reviewed UUID barrel uses the real algorithm modules through a bounded namespace bridge',t=>{
 const f=fixture(t),inputs=mobileBuildInputs(f.root,f.source);
 const index=path.join(inputs.packageRoot,'dist-node/index.js');
 const contents=uuidCommonJsBridge(fs.readFileSync(index,'utf8'),index);
 assert.equal((contents.match(/require\(/g)||[]).length,14);
 assert.match(contents,/v4:binding7/);assert.match(contents,/\/dist-node\/v4\.js"\)\.default/);
 assert.doesNotMatch(contents,/randomUUID|Math\.random|crypto\.random/);
 const [observed]=expectedMobileUuidTransforms(inputs);
 assert.equal(observed.sourceSha256,f.policy.package.files['dist-node/index.js']);
 assert.equal(observed.bridgeSha256,hash(contents));
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
 const f=fixture(t),observed=expectedMobileUuidTransforms(mobileBuildInputs(f.root,f.source));
 const receipt=mobileBuildReceipt(f.root,f.source,f.bundle,observed,f.coreTransforms),directory=path.dirname(f.bundle);
 const save=value=>fs.writeFileSync(path.join(directory,MOBILE_BUILD_RECEIPT),JSON.stringify(value));save(receipt);
 assert.deepEqual(verifyMobileBuildReceipt(f.root,f.source),receipt);
 for(const transforms of [[],[...observed,...observed],[{...observed[0],bridgeSha256:'0'.repeat(64)}]])assert.throws(()=>mobileBuildReceipt(f.root,f.source,f.bundle,transforms,f.coreTransforms),/exactly the reviewed barrel/);
 for(const mutate of [value=>value.smoke.uuidSemantics=false,value=>value.bundleSha256='0'.repeat(64),value=>value.adapterFiles[MOBILE_BUILD_INPUTS[0]]='0'.repeat(64),value=>value.sourceStampSha256='0'.repeat(64),value=>value.coreState.inputHashes['scripts/core-state-patch.ts']='0'.repeat(64)]){const changed=structuredClone(receipt);mutate(changed);save(changed);assert.throws(()=>verifyMobileBuildReceipt(f.root,f.source),/differs/);}
 save(receipt);fs.appendFileSync(f.bundle,'changed');assert.throws(()=>verifyMobileBuildReceipt(f.root,f.source),/differs/);
});
