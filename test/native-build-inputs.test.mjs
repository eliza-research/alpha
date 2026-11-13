import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {embeddingProducerInputPaths,nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated} from '../scripts/embedding-native-contract.ts';
import {nativeRecipe,nativeRecipeDigest,readNativeBuildReceipt,verifyNativeFileBytes,nativeOutputInventory,NATIVE_BUILD_RECEIPT,fileDigest,bytesDigest,withNativeCacheLock} from '../scripts/native-build-inputs.ts';

const root=path.resolve(import.meta.dirname,'..');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-recipe-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const name of ['upstream.lock.json','app.config.json','android/voice-host/qualified-voice-host.json','android/embedding-host/build-toolchain.json','android/embedding-host/qualified-host.json','android/embedding-host/native-requirements.txt','android/embedding-host/bootstrap-requirements.txt','android/paradee-voice/asr-inputs.json','scripts/build-embedding-host.ts','scripts/prepare-embedding-host.ts','scripts/embedding-native-contract.ts','scripts/embedding-build-remap.ts','scripts/native-build-inputs.ts','scripts/android-stage-voice-models.ts','scripts/local-agent-source.ts']){
    fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(dir,name));
  }
  fs.mkdirSync(path.join(dir,'vendor'));fs.symlinkSync(path.join(root,'vendor/eliza'),path.join(dir,'vendor/eliza'),'dir');
  return dir;
}
test('native cache identity changes with producer code, model pins and compiler inputs',t=>{
  const dir=fixture(t),before=nativeRecipeDigest(nativeRecipe(dir));
  for(const name of ['scripts/prepare-embedding-host.ts','android/embedding-host/native-requirements.txt','android/embedding-host/bootstrap-requirements.txt','android/voice-host/qualified-voice-host.json']){
    const file=path.join(dir,name),original=fs.readFileSync(file);
    if(name.endsWith('.json')){const record=JSON.parse(original);record.models[0].sha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(record));}
    else fs.appendFileSync(file,'\n# new producer input\n');
    assert.notEqual(nativeRecipeDigest(nativeRecipe(dir)),before,name);fs.writeFileSync(file,original);
  }
});
function receiptFor(dir){
  const recipe=nativeRecipe(dir),pin=JSON.parse(fs.readFileSync(path.join(dir,'upstream.lock.json'))).commit;
  const voice=JSON.parse(fs.readFileSync(path.join(dir,'android/voice-host/qualified-voice-host.json')));voice.pin=pin;
  const source=name=>execFileSync('git',['-C',path.join(dir,'vendor/eliza'),'show',pin+':'+name]);
  const binding=nativeBinding(source(nativeInputPaths.at(-1)).toString(),source(nativeInputPaths.at(-2)).toString(),recipe.identity);
  const embedding={model:JSON.parse(fs.readFileSync(path.join(dir,'android/embedding-host/qualified-host.json'))).model,identity:recipe.identity,pin,forkPin:recipe.engineCommit,abi:'arm64-v8a',jniIdentityRelocated:true,jniBinding:binding,
    libraries:[...voice.abis[0].libraries.map(row=>({...row,alignment16KiB:true})),{name:'libelizavoicejni.so',bytes:4,sha256:'a'.repeat(64),alignment16KiB:true}],
    inputs:nativeInputs(binding).map(name=>({path:name,sourceSha256:bytesDigest(source(name)),generatedSha256:bytesDigest(nativeGenerated(name,source(name).toString(),recipe.identity,binding))})),
    producerInputs:embeddingProducerInputPaths.map(name=>({path:name,sha256:bytesDigest(source(name))}))};
  const receipt={schema:'alpha-native-build/v1',consumerSdkCommit:pin,recipeSha256:nativeRecipeDigest(recipe),recipe,producer:{sdkCommit:pin,platform:'linux',arch:'x64',...recipe.toolchain,python:recipe.python},voice,embedding,files:[],qualification:{deviceExecuted:false,userAccepted:false}};
  receipt.files=[...nativeOutputInventory(receipt)].map(([name,row])=>({path:name,bytes:row?.bytes||4,sha256:row?.sha256||'a'.repeat(64)}));
  return receipt;
}
test('generated native receipts reject qualification claims, incomplete inventories and substituted bytes',t=>{
  const dir=fixture(t),original=receiptFor(dir);
  const file=path.join(dir,NATIVE_BUILD_RECEIPT);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(original));assert.ok(readNativeBuildReceipt(dir));
  for(const mutate of [r=>r.qualification.deviceExecuted=true,r=>r.voice.models[0].sha256='0'.repeat(64),r=>r.files.pop(),r=>r.files.push({path:'extra',bytes:1,sha256:'a'.repeat(64)}),r=>r.embedding.libraries[0].sha256='0'.repeat(64),r=>r.voice.abis[0].libraries[0].sha256='0'.repeat(64)]){
    const receipt=structuredClone(original);mutate(receipt);fs.writeFileSync(file,JSON.stringify(receipt));assert.throws(()=>readNativeBuildReceipt(dir));
  }
});
test('native cache reuse rejects changed, linked and escaping outputs',t=>{
  const dir=fixture(t),file=path.join(dir,'output');fs.writeFileSync(file,'good');
  const files=[{path:'output',bytes:4,sha256:fileDigest(file)}];
  assert.doesNotThrow(()=>verifyNativeFileBytes(dir,files));
  fs.writeFileSync(file,'evil');assert.throws(()=>verifyNativeFileBytes(dir,files),/Native output changed/);
  fs.unlinkSync(file);fs.symlinkSync(path.join(root,'package.json'),file);assert.throws(()=>verifyNativeFileBytes(dir,files),/symbolic link/);
  files[0].path='../output';assert.throws(()=>verifyNativeFileBytes(dir,files),/Invalid native output path/);
});
test('concurrent native producers serialize and a failed producer releases its cache',async t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-lock-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const events=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const first=withNativeCacheLock(dir,async()=>{events.push('first');await pending;throw Error('producer failed');});
  const second=withNativeCacheLock(dir,async()=>{events.push('second');});
  await new Promise(resolve=>setTimeout(resolve,120));assert.deepEqual(events,['first']);
  release();await assert.rejects(first,/producer failed/);await second;
  assert.deepEqual(events,['first','second']);
  await withNativeCacheLock(dir,async()=>events.push('third'));assert.equal(events.at(-1),'third');
});
