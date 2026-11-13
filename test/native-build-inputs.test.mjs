import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {embeddingProducerInputPaths,nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated} from '../scripts/embedding-native-contract.ts';
import {nativeRecipe,nativeRecipeDigest,readNativeBuildReceipt,verifyNativeFileBytes,nativeOutputInventory,NATIVE_BUILD_RECEIPT,fileDigest,bytesDigest,withNativeCacheLock,prepareNativeSource,nativeAndroidSdk,clearStagedNativeInputs} from '../scripts/native-build-inputs.ts';

const root=path.resolve(import.meta.dirname,'..');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-recipe-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const name of ['upstream.lock.json','app.config.json','android/voice-host/qualified-voice-host.json','android/embedding-host/build-toolchain.json','android/embedding-host/qualified-host.json','android/embedding-host/native-requirements.txt','android/embedding-host/bootstrap-requirements.txt','android/paradee-voice/asr-inputs.json','scripts/build-embedding-host.ts','scripts/prepare-embedding-host.ts','scripts/embedding-native-contract.ts','scripts/embedding-build-remap.ts','scripts/native-build-inputs.ts','scripts/android-stage-voice-models.ts','scripts/local-agent-source.ts','scripts/voice-host.ts','scripts/paradee-runtime.ts','scripts/android-abis.ts','scripts/copy-file-clone.ts','scripts/stage-embedding-host.ts']){
    fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(dir,name));
  }
  fs.mkdirSync(path.join(dir,'vendor'));fs.symlinkSync(path.join(root,'vendor/eliza'),path.join(dir,'vendor/eliza'),'dir');
  return dir;
}
test('native cache identity changes with producer code, model pins and compiler inputs',t=>{
  const dir=fixture(t),before=nativeRecipeDigest(nativeRecipe(dir));
  for(const name of ['scripts/prepare-embedding-host.ts','android/embedding-host/native-requirements.txt','android/embedding-host/bootstrap-requirements.txt','android/voice-host/qualified-voice-host.json','android/embedding-host/qualified-host.json','scripts/voice-host.ts','scripts/paradee-runtime.ts','scripts/android-abis.ts','scripts/copy-file-clone.ts','scripts/stage-embedding-host.ts']){
    const file=path.join(dir,name),original=fs.readFileSync(file);
    if(name.endsWith('.json')){const record=JSON.parse(original);(record.models?.[0]??record.model).sha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(record));}
    else fs.appendFileSync(file,'\n# new producer input\n');
    assert.notEqual(nativeRecipeDigest(nativeRecipe(dir)),before,name);fs.writeFileSync(file,original);
  }
});
test('archive source freeze binds every native producer input and changes with ABI policy',t=>{
  const dir=fixture(t),recipe=nativeRecipe(dir);
  const snapshot=()=>JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/source-snapshot.ts')],{cwd:dir,encoding:'utf8'}));
  const before=snapshot();
  for(const [name,digest] of Object.entries(recipe.productInputs))assert.equal(before.files[name],digest,`Missing native producer input: ${name}`);
  const policy='scripts/android-abis.ts';
  fs.appendFileSync(path.join(dir,policy),'\n// changed ABI policy\n');
  const after=snapshot();
  assert.notEqual(after.digest,before.digest);
  assert.equal(after.files[policy],fileDigest(path.join(dir,policy)));
  assert.notEqual(after.files[policy],recipe.productInputs[policy]);
});
function receiptFor(dir){
  const recipe=nativeRecipe(dir),pin=JSON.parse(fs.readFileSync(path.join(dir,'upstream.lock.json'))).commit;
  const voice=JSON.parse(fs.readFileSync(path.join(dir,'android/voice-host/qualified-voice-host.json')));voice.pin=pin;voice.forkPin=recipe.engineCommit;
  const source=name=>execFileSync('git',['-C',path.join(dir,'vendor/eliza'),'show',pin+':'+name]);
  const binding=nativeBinding(source(nativeInputPaths.at(-1)).toString(),source(nativeInputPaths.at(-2)).toString(),recipe.identity);
  const embedding={model:JSON.parse(fs.readFileSync(path.join(dir,'android/embedding-host/qualified-host.json'))).model,identity:recipe.identity,pin,forkPin:recipe.engineCommit,abi:'arm64-v8a',jniIdentityRelocated:true,jniBinding:binding,
    libraries:[...voice.abis[0].libraries.map(row=>({...row,alignment16KiB:true})),{name:'libelizavoicejni.so',bytes:4,sha256:'a'.repeat(64),alignment16KiB:true}],
    inputs:nativeInputs(binding).map(name=>({path:name,sourceSha256:bytesDigest(source(name)),generatedSha256:bytesDigest(nativeGenerated(name,source(name).toString(),recipe.identity,binding))})),
    producerInputs:embeddingProducerInputPaths.map(name=>({path:name,sha256:bytesDigest(source(name))})),
    additionalAbis:[{abi:'x86_64',libraries:[...voice.abis[1].libraries.map(row=>({...row,alignment16KiB:true})),{name:'libelizavoicejni.so',bytes:4,sha256:'b'.repeat(64),alignment16KiB:true}]}]};
  const receipt={schema:'alpha-native-build/v1',consumerSdkCommit:pin,recipeSha256:nativeRecipeDigest(recipe),recipe,producer:{sdkCommit:pin,platform:'linux',arch:'x64',...recipe.toolchain,python:recipe.python},voice,embedding,files:[],qualification:{deviceExecuted:false,userAccepted:false}};
  receipt.files=[...nativeOutputInventory(receipt)].map(([name,row])=>({path:name,bytes:row?.bytes||4,sha256:row?.sha256||'a'.repeat(64)}));
  return receipt;
}
test('generated native receipts reject qualification claims, incomplete inventories and substituted bytes',t=>{
  const dir=fixture(t),original=receiptFor(dir);
  const file=path.join(dir,NATIVE_BUILD_RECEIPT);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(original));assert.ok(readNativeBuildReceipt(dir));
  for(const mutate of [r=>r.qualification.deviceExecuted=true,r=>r.voice.models[0].sha256='0'.repeat(64),r=>r.files.pop(),r=>r.files.push({path:'extra',bytes:1,sha256:'a'.repeat(64)}),r=>r.embedding.libraries[0].sha256='0'.repeat(64),r=>r.voice.abis[0].libraries[0].sha256='0'.repeat(64),r=>delete r.embedding.additionalAbis,r=>r.embedding.additionalAbis[0].abi='arm64-v8a',r=>r.embedding.additionalAbis[0].libraries[0].sha256='0'.repeat(64),r=>r.embedding.additionalAbis[0].libraries.pop()]){
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
for(const linkedAbi of ['arm64-v8a','x86_64'])test(`native refresh refuses linked ${linkedAbi} before deleting any staged inputs`,t=>{
  const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-refresh-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const product=path.join(temp,'product'),external=path.join(temp,'external');
  const bundle=path.join(product,'.eliza/paradee-voice/native/build-record.json');
  fs.mkdirSync(path.dirname(bundle),{recursive:true});fs.writeFileSync(bundle,'prior bundle');
  const survivors=[bundle];
  for(const abi of ['arm64-v8a','x86_64']){
    const directory=path.join(product,'android/app/src/main/jniLibs',abi);
    fs.mkdirSync(path.dirname(directory),{recursive:true});
    const target=abi===linkedAbi?external:directory;fs.mkdirSync(target,{recursive:true});
    if(abi===linkedAbi)fs.symlinkSync(external,directory,'dir');
    for(const name of ['libelizainference.so','libelizavoicejni.so','libc++_shared.so']){
      const file=path.join(target,name);fs.writeFileSync(file,'retained '+abi);survivors.push(file);
    }
  }
  assert.throws(()=>clearStagedNativeInputs(product),/symbolic link/);
  for(const file of survivors)assert.ok(fs.existsSync(file),`refresh removed ${file}`);
  assert.equal(fs.readFileSync(bundle,'utf8'),'prior bundle');
  for(const name of ['libelizainference.so','libelizavoicejni.so','libc++_shared.so'])assert.equal(fs.readFileSync(path.join(external,name),'utf8'),'retained '+linkedAbi);
});
test('native refresh clears its owned outputs and preserves unrelated JNI files',t=>{
  const product=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-refresh-owned-')));
  t.after(()=>fs.rmSync(product,{recursive:true,force:true}));
  const bundle=path.join(product,'.eliza/paradee-voice/native/build-record.json');
  fs.mkdirSync(path.dirname(bundle),{recursive:true});fs.writeFileSync(bundle,'prior bundle');
  const removed=[bundle],retained=[];
  for(const abi of ['arm64-v8a','x86_64']){
    const directory=path.join(product,'android/app/src/main/jniLibs',abi);fs.mkdirSync(directory,{recursive:true});
    for(const name of ['libelizainference.so','libelizavoicejni.so','libc++_shared.so']){const file=path.join(directory,name);fs.writeFileSync(file,'old');removed.push(file);}
    const other=path.join(directory,'libeliza_bun.so');fs.writeFileSync(other,'unrelated');retained.push(other);
  }
  clearStagedNativeInputs(product);
  for(const file of removed)assert.equal(fs.existsSync(file),false);
  for(const file of retained)assert.equal(fs.readFileSync(file,'utf8'),'unrelated');
});
test('concurrent native producers serialize and a failed producer releases its cache',async t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-lock-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const events=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  let started;
  const entered=new Promise(resolve=>{started=resolve;});
  const first=withNativeCacheLock(dir,async()=>{events.push('first');started();await pending;throw Error('producer failed');});
  await entered;
  const second=withNativeCacheLock(dir,async()=>{events.push('second');});
  await new Promise(resolve=>setTimeout(resolve,120));assert.deepEqual(events,['first']);
  release();await assert.rejects(first,/producer failed/);await second;
  assert.deepEqual(events,['first','second']);
  await withNativeCacheLock(dir,async()=>events.push('third'));assert.equal(events.at(-1),'third');
});
test('a fresh native source cache checks out successfully and preserves later dirty files',t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-source-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const repository=path.join(dir,'repository'),source=path.join(dir,'source');fs.mkdirSync(repository);
  const git=(...args)=>execFileSync('git',['-C',repository,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--quiet');fs.writeFileSync(path.join(repository,'input'),'reviewed');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','input');
  const pin=git('rev-parse','HEAD');prepareNativeSource(repository,source,pin);
  assert.equal(fs.readFileSync(path.join(source,'input'),'utf8'),'reviewed');assert.equal(fs.existsSync(path.join(source,'.git/objects/info/alternates')),false);
  fs.writeFileSync(path.join(source,'input'),'local work');assert.throws(()=>prepareNativeSource(repository,source,pin),/tracked modifications/);assert.equal(fs.readFileSync(path.join(source,'input'),'utf8'),'local work');
  const linked=path.join(dir,'linked-source'),before=git('symbolic-ref','HEAD');fs.symlinkSync(repository,linked,'dir');
  assert.throws(()=>prepareNativeSource(repository,linked,pin),/symbolic link/);
  assert.equal(git('symbolic-ref','HEAD'),before);assert.equal(fs.existsSync(path.join(repository,'.git/alpha-native-checkout')),false);
  const child=path.join(linked,'new-cache');assert.throws(()=>prepareNativeSource(repository,child,pin),/symbolic link/);assert.equal(fs.existsSync(child),false);
});
test('native build and inspection share Linux and macOS SDK discovery',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-sdk-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const linux=path.join(home,'Android/Sdk');fs.mkdirSync(linux,{recursive:true});assert.equal(nativeAndroidSdk({},home),linux);
  const mac=path.join(home,'Library/Android/sdk');fs.mkdirSync(mac,{recursive:true});assert.equal(nativeAndroidSdk({},home),mac);assert.equal(nativeAndroidSdk({ANDROID_HOME:linux},home),linux);
});
