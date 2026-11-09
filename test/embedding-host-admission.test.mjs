import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyEmbeddingHost, verifyEmbeddingInputs} from '../scripts/stage-embedding-host.mjs';
import {embeddingProducerInputPaths,nativeInputPaths, nativeBinding, nativeInputs, nativeGenerated} from '../scripts/embedding-native-contract.mjs';
const root=path.resolve(import.meta.dirname,'..');
const git=(directory,...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const committed=JSON.parse(fs.readFileSync(path.join(root,'android/embedding-host/qualified-host.json'),'utf8'));
// The admission rules are tested on a qualification shaped like the committed record but made for the
// pinned source: native build inputs and engine gitlink read from vendor/eliza at upstream.lock.json,
// and the built pin left as recorded (a reviewed build is never relabelled). The committed record's own
// state at the pin is the last test in this file.
const lockCommit=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
const appId=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;
const sha=value=>createHash('sha256').update(value).digest('hex');
const qualified=(()=>{
 const record=structuredClone(committed);delete record.requalification;delete record.producerInputs;
 record.forkPin=git(path.join(root,'vendor/eliza'),'ls-tree',lockCommit,'plugins/plugin-local-inference/native/llama.cpp').match(/^160000 commit ([a-f0-9]{40})\t/)[1];
 // The build inputs come from the shared native contract at the pin (registered JNI: the Java class too).
 const show=file=>execFileSync('git',['-C',path.join(root,'vendor/eliza'),'show',lockCommit+':'+file]);
 const binding=nativeBinding(show(nativeInputPaths.at(-1)).toString('utf8'),show(nativeInputPaths.at(-2)).toString('utf8'),appId);
 if(binding.mode==='registered')record.jniBinding=binding;
 record.inputs=nativeInputs(binding).map(file=>{
  const source=show(file),generated=nativeGenerated(file,source.toString('utf8'),appId,binding);
  return {path:file,sourceSha256:sha(source),generatedSha256:sha(generated)};
 });
 return record;
})();
function fixture({currentOnly=false,producerInputs=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-admission-'));
 for(const name of ['upstream.lock.json','app.config.json','android/embedding-host/qualified-host.json']){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(dir,name));}
 const vendor=path.join(dir,'vendor/eliza');fs.mkdirSync(path.dirname(vendor),{recursive:true});
 if(currentOnly){
  fs.mkdirSync(vendor);git(vendor,'init');
  for(const name of new Set([...qualified.inputs.map(row=>row.path),...embeddingProducerInputPaths])){const file=path.join(vendor,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,execFileSync('git',['-C',path.join(root,'vendor/eliza'),'show','HEAD:'+name]));}
 }else{
  fs.mkdirSync(vendor);git(vendor,'init');
  // Borrow only local objects. Flatten their existing alternates so this fixture does not
  // add another level to Git's alternates limit or fetch unrelated history.
  const objects=git(path.join(root,'vendor/eliza'),'rev-parse','--path-format=absolute','--git-path','objects');
  const borrowed=[],seen=new Set();
  const borrow=directory=>{
   directory=fs.realpathSync(directory);
   if(seen.has(directory))return;
   seen.add(directory);
   const file=path.join(directory,'info/alternates');
   if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){
    const alternate=line.startsWith('"')?JSON.parse(line):line;
    borrow(path.resolve(directory,alternate));
   }
   borrowed.push(directory);
  };
  borrow(objects);
  fs.writeFileSync(path.join(vendor,'.git/objects/info/alternates'),borrowed.join('\n')+'\n');
  git(vendor,'sparse-checkout','init','--no-cone');
  git(vendor,'sparse-checkout','set','--no-cone',...qualified.inputs.map(row=>'/'+row.path),...embeddingProducerInputPaths.map(name=>'/'+name),'/plugins/plugin-local-inference/native/llama.cpp');
  git(vendor,'checkout','--detach',JSON.parse(fs.readFileSync(path.join(dir,'upstream.lock.json'),'utf8')).commit);
 }
 git(vendor,'config','user.name','Embedding fixture');git(vendor,'config','user.email','embedding-fixture@example.invalid');
 if(currentOnly){
  fs.mkdirSync(path.join(vendor,'plugins/plugin-local-inference/native/llama.cpp'),{recursive:true});
  git(vendor,'add',...new Set([...qualified.inputs.map(row=>row.path),...embeddingProducerInputPaths]));git(vendor,'update-index','--add','--cacheinfo','160000,'+qualified.forkPin+',plugins/plugin-local-inference/native/llama.cpp');git(vendor,'commit','-m','Current native input fixture');
  const commit=git(vendor,'rev-parse','HEAD'),file=path.join(dir,'upstream.lock.json'),lock=JSON.parse(fs.readFileSync(file,'utf8'));lock.commit=commit;fs.writeFileSync(file,JSON.stringify(lock));fs.writeFileSync(path.join(vendor,'.git/shallow'),commit+'\n');
 }
 // Tiny content fixtures retain the production manifest shape; the known BGE hash is checked last.
 for(const row of qualified.libraries){const file=path.join(dir,'android/app/src/main/jniLibs/arm64-v8a',row.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture-'+row.name);}
 const manifest=structuredClone(qualified);for(const row of manifest.libraries){row.sha256=createHash('sha256').update('fixture-'+row.name).digest('hex');row.bytes=Buffer.byteLength('fixture-'+row.name);}
 if(producerInputs){
  // These generated digests describe a synthetic build, not the historical receipt's producer.
  manifest.pin='1'.repeat(40);
  manifest.producerInputs=embeddingProducerInputPaths.map(name=>({path:name,sha256:sha(execFileSync('git',['-C',vendor,'show','HEAD:'+name]))}));
 }
 fs.writeFileSync(path.join(dir,'android/embedding-host/qualified-host.json'),JSON.stringify(manifest));
 // The voice host stages the same arm64 engine file, so its record names the same bytes.
 fs.mkdirSync(path.join(dir,'android/voice-host'),{recursive:true});
 fs.writeFileSync(path.join(dir,'android/voice-host/qualified-voice-host.json'),JSON.stringify({abis:[{abi:'arm64-v8a',libraries:[manifest.libraries.find(row=>row.name==='libelizainference.so')]}]}));
 return {dir,vendor,manifest,lock(commit){const file=path.join(dir,'upstream.lock.json'),lock=JSON.parse(fs.readFileSync(file,'utf8'));lock.commit=commit;fs.writeFileSync(file,JSON.stringify(lock));},write(){fs.writeFileSync(path.join(dir,'android/embedding-host/qualified-host.json'),JSON.stringify(manifest));},close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('missing and corrupted native host bytes fail before APK packaging',()=>{
 for(const name of qualified.libraries.map(row=>row.name)){
  const f=fixture();try{const file=path.join(f.dir,'android/app/src/main/jniLibs/arm64-v8a',name);fs.unlinkSync(file);assert.throws(()=>verifyEmbeddingHost(f.dir),/missing or changed/);fs.writeFileSync(file,'tampered');assert.throws(()=>verifyEmbeddingHost(f.dir),/missing or changed/);}finally{f.close();}
 }
});
test('partial native set, changed identity and wrong model dimensions are refused',()=>{
 for(const mutation of [m=>m.libraries.pop(),m=>m.identity='other.product',m=>m.model.dimensions=1536,m=>m.pin='0'.repeat(40)]){
  const f=fixture();try{mutation(f.manifest);f.write();assert.throws(()=>verifyEmbeddingHost(f.dir),/admission changed|Incomplete/);}finally{f.close();}
 }
});
test('embedding and voice host records that name different arm64 engines are refused, naming both files',()=>{
 const f=fixture();try{
  const file=path.join(f.dir,'android/voice-host/qualified-voice-host.json'),voice=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.throws(()=>verifyEmbeddingHost(f.dir),/BGE384 model missing/,'matching records pass the engine check');
  for(const mutate of [row=>row.sha256='0'.repeat(64),row=>row.bytes+=1]){
   const changed=structuredClone(voice);mutate(changed.abis[0].libraries[0]);fs.writeFileSync(file,JSON.stringify(changed));
   assert.throws(()=>verifyEmbeddingHost(f.dir),error=>/libelizainference\.so differs/.test(error.message)&&error.message.includes('android/embedding-host/qualified-host.json')&&error.message.includes('android/voice-host/qualified-voice-host.json'));
  }
  fs.writeFileSync(file,JSON.stringify({abis:[{abi:'x86_64',libraries:voice.abis[0].libraries}]}));
  assert.throws(()=>verifyEmbeddingHost(f.dir),/libelizainference\.so differs/);
  fs.unlinkSync(file);assert.throws(()=>verifyEmbeddingHost(f.dir),/qualified-voice-host\.json is missing/);
 }finally{f.close();}
});
test('a valid native set does not bypass the pinned local model admission',()=>{
 const f=fixture();try{assert.throws(()=>verifyEmbeddingHost(f.dir),/BGE384 model missing/);const model=path.join(f.dir,qualified.model.path);fs.mkdirSync(path.dirname(model),{recursive:true});fs.writeFileSync(model,'incorrect model');assert.throws(()=>verifyEmbeddingHost(f.dir),/BGE384 model missing or changed/);}finally{f.close();}
});

test('text-only pin change reuses exact reviewed native bytes without relabeling the built pin',()=>{
 const f=fixture();try{
  git(f.vendor,'commit','--allow-empty','-m','Advance runtime without changing native inputs');f.lock(git(f.vendor,'rev-parse','HEAD'));
  const current=JSON.parse(fs.readFileSync(path.join(f.dir,'upstream.lock.json'),'utf8')).commit;
  assert.notEqual(current,qualified.pin);assert.doesNotThrow(()=>verifyEmbeddingInputs(f.dir,qualified));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'android/embedding-host/qualified-host.json'),'utf8')).pin,qualified.pin);
 }finally{f.close();}
});
test('every changed committed native build input is refused even when the runtime lock matches',()=>{
 for(const producerInputs of [false,true])for(const input of qualified.inputs){
  const f=fixture({producerInputs});try{
   fs.appendFileSync(path.join(f.vendor,input.path),'\n// changed native build input\n');git(f.vendor,'add',input.path);git(f.vendor,'commit','-m','Change native input');f.lock(git(f.vendor,'rev-parse','HEAD'));
   const prefix=producerInputs&&embeddingProducerInputPaths.includes(input.path)?'Embedding producer input changed: ':'Native build input changed: ';
   assert.throws(()=>verifyEmbeddingHost(f.dir),error=>error.message.includes(prefix+input.path));
  }finally{f.close();}
 }
});
test('changed engine gitlink, dirty JNI and mismatched locked vendor checkout are refused',()=>{
 const fork='plugins/plugin-local-inference/native/llama.cpp';
 for(const mutation of [
  f=>{git(f.vendor,'update-index','--cacheinfo','160000,'+'1'.repeat(40)+','+fork);git(f.vendor,'commit','-m','Change engine pin');f.lock(git(f.vendor,'rev-parse','HEAD'));},
  f=>fs.appendFileSync(path.join(f.vendor,qualified.inputs.at(-1).path),'\n// dirty JNI\n'),
  f=>{git(f.vendor,'commit','--allow-empty','-m','Advance checkout without updating runtime lock');},
 ]){const f=fixture();try{mutation(f);assert.throws(()=>verifyEmbeddingHost(f.dir),/source admission changed/);}finally{f.close();}}
});
test('missing, incomplete or altered native qualification cannot admit a new source pin',()=>{
 for(const mutation of [
  m=>delete m.inputs,m=>m.inputs.pop(),m=>m.inputs.push(m.inputs[0]),
  m=>m.inputs[0].sourceSha256='0'.repeat(64),m=>m.inputs.at(-1).generatedSha256='0'.repeat(64),
  m=>m.forkPin='0'.repeat(40),m=>delete m.qualificationReceiptSha256,m=>m.jniIdentityRelocated=false,
 ]){const f=fixture();try{mutation(f.manifest);f.write();assert.throws(()=>verifyEmbeddingHost(f.dir),/qualification missing or changed|admission changed|Native build input changed/);}finally{f.close();}}
});

test('current-only shallow native inputs admit reviewed bytes without fetching the historical build pin',()=>{
 const f=fixture({currentOnly:true,producerInputs:true});try{
  assert.equal(git(f.vendor,'rev-parse','--is-shallow-repository'),'true');
  assert.throws(()=>git(f.vendor,'cat-file','-e',qualified.pin));
  assert.doesNotThrow(()=>verifyEmbeddingInputs(f.dir,f.manifest,{requireProducerInputs:true}));
 }finally{f.close();}
});

test('explicit unpackaged builds admit absence, never a partial resident payload or host',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-unpackaged-'));
 try{
  assert.deepEqual(verifyEmbeddingHost(dir,{allowAbsentRuntime:true}),{status:'not-packaged',distributable:false});
  assert.throws(()=>verifyEmbeddingHost(dir));
  for(const relative of ['android/app/src/main/assets/agent/alpha-source.json','android/app/src/main/assets/agent/agent-bundle.js','android/app/src/main/assets/agent/workflow-worker/manifest.json','android/app/src/main/jniLibs/arm64-v8a/libelizainference.so','android/app/src/main/jniLibs/x86_64/libelizavoicejni.so']){
   const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'partial');
   assert.throws(()=>verifyEmbeddingHost(dir,{allowAbsentRuntime:true}));fs.unlinkSync(file);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the committed record is admissible at the pin, or names why it must be requalified and is refused',()=>{
 let admissible=true;try{verifyEmbeddingInputs(root,committed);}catch{admissible=false;}
 if(admissible){assert.equal(committed.requalification,undefined,'an admissible record carries no requalification note');return;}
 // A pin move that changes the engine gitlink or a native build input voids the reviewed bytes.
 const note=committed.requalification;
 assert.equal(note?.required,true,'an inadmissible record says that requalification is required');
 assert.equal(note.atPin,lockCommit,'for the current pin');
 assert.ok(typeof note.reason==='string'&&note.reason.length>20);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-requalify-'));
 try{
  for(const name of ['upstream.lock.json','app.config.json','android/embedding-host/qualified-host.json']){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});if(name==='android/embedding-host/qualified-host.json')fs.writeFileSync(path.join(dir,name),JSON.stringify(committed));else fs.copyFileSync(path.join(root,name),path.join(dir,name));}
  assert.throws(()=>verifyEmbeddingHost(dir),/requalification required/,'distribution admission names the requalification first');
  assert.deepEqual(verifyEmbeddingHost(dir,{allowAbsentRuntime:true}),{status:'not-packaged',distributable:false},'an unpackaged developer build is unaffected');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('complete producer closure is required for new embedding-capable admission and preserves the built pin',()=>{
 const legacy=fixture();try{assert.throws(()=>verifyEmbeddingInputs(legacy.dir,legacy.manifest,{requireProducerInputs:true}),/producer input qualification missing/);}finally{legacy.close();}
 const f=fixture({producerInputs:true});try{
  const built=f.manifest.pin;assert.doesNotThrow(()=>verifyEmbeddingInputs(f.dir,f.manifest,{requireProducerInputs:true}));assert.equal(f.manifest.pin,built);
 }finally{f.close();}
});
test('the formal-only SDK advance admits only the exact reviewed and current manifest digests', {
 skip:lockCommit!=='9add52f6b83efa77241fb72ae769729121944cac',
},()=>{
 const verify=receipt=>verifyEmbeddingInputs(root,receipt,{requireProducerInputs:true});
 assert.doesNotThrow(()=>verify(committed));
 assert.equal(committed.pin,'99b49439ce9d0cb5607e9831b9f7f58d89525029');
 for(const name of ['package.json','packages/agent/package.json']){
  const current=sha(execFileSync('git',['-C',path.join(root,'vendor/eliza'),'show',lockCommit+':'+name]));
  for(const sha256 of [current,'0'.repeat(64)]){
   const changed=structuredClone(committed);
   changed.producerInputs.find(row=>row.path===name).sha256=sha256;
   assert.throws(()=>verify(changed),{message:'Embedding host source admission changed: Embedding producer input changed: '+name});
  }
 }
});
test('missing, duplicated or changed producer records cannot qualify embeddings',()=>{
 for(const mutate of [r=>r.producerInputs.pop(),r=>r.producerInputs.push(r.producerInputs[0]),r=>r.producerInputs[0].sha256='0'.repeat(64)]){
  const f=fixture({producerInputs:true});try{mutate(f.manifest);assert.throws(()=>verifyEmbeddingInputs(f.dir,f.manifest,{requireProducerInputs:true}),/producer input/);}finally{f.close();}
 }
});
test('producer helper drift is rejected both dirty and after a committed source change',()=>{
 const f=fixture({producerInputs:true});try{
  const helper='packages/app/scripts/aosp/compile-libllama.ts';fs.appendFileSync(path.join(f.vendor,helper),'\n// changed producer helper\n');
  assert.throws(()=>verifyEmbeddingInputs(f.dir,f.manifest,{requireProducerInputs:true}),/source admission changed/);
  git(f.vendor,'add',helper);git(f.vendor,'commit','-m','Change producer helper');f.lock(git(f.vendor,'rev-parse','HEAD'));
  assert.throws(()=>verifyEmbeddingInputs(f.dir,f.manifest,{requireProducerInputs:true}),/Embedding producer input changed/);
 }finally{f.close();}
});

test('staging serializes the original producer receipt inputs without replacing its built pin',()=>{
 const stage=fs.readFileSync(new URL('../scripts/stage-embedding-host.mjs',import.meta.url),'utf8');
 const literal=stage.match(/const manifest=(\{pin:receipt\.pin[^\n]+);/)[1];
 const make=new Function('receipt','identity','model','libraries','hash','args','return '+literal);
 const receipt={pin:'1'.repeat(40),forkPin:'2'.repeat(40),abi:'arm64-v8a',inputs:[],producerInputs:[{path:'packages/app/scripts/stage-elizavoice-lib.ts',sha256:'3'.repeat(64)}]};
 const manifest=JSON.parse(JSON.stringify(make(receipt,'test.app',{},[],()=> '4'.repeat(64),['--receipt','fixture.json'])));
 assert.deepEqual(manifest.producerInputs,receipt.producerInputs);assert.equal(manifest.pin,receipt.pin);
});
