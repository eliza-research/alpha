import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifiedFile} from '../scripts/host-speech-admission.ts';
import {sourceManifest} from '../scripts/combined-agent-source.ts';
import {verifyEmbeddingInputs} from '../scripts/stage-embedding-host.ts';
import {mkdirSync} from 'node:fs';
import {readNativeBuildReceipt} from '../scripts/native-build-inputs.ts';
test('admission verifies exact bytes and reviewed digest, rejecting links and oversized assets',t=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-speech-admission-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'fixture'),data=Buffer.from('synthetic admission fixture'),sha=createHash('sha256').update(data).digest('hex');writeFileSync(file,data);
 verifiedFile(file,sha,data.length,true);
 assert.throws(()=>verifiedFile(file,'0'.repeat(64),data.length),/checksum/);
 assert.throws(()=>verifiedFile(file,sha,data.length-1),/size/);
 assert.throws(()=>verifiedFile(file,sha,data.length+1,true),/size/);
 symlinkSync(file,join(root,'link'));assert.throws(()=>verifiedFile(join(root,'link'),sha,data.length));
});

// Source snapshots admit the current reviewed engine; retained library records keep their original pin.
test('source snapshots accept only the reviewed 5c5d engine and reject old or foreign gitlinks',t=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-engine-identity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Admission fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8'}).trim();
 git('init');git('commit','--allow-empty','-m','Fixture');
 const engine='plugins/plugin-local-inference/native/llama.cpp';mkdirSync(join(root,engine),{recursive:true});
 for(const pin of new Set(['6337fd4c4bd071c17235986344d552d4036e177b','cc8c979157e1f577448d8b8c6ff598b7cfc3d661','1'.repeat(40),'b3eb2bf63b3c02cd37ee09d442911ace99975b38'])){
  git('update-index','--add','--cacheinfo','160000,'+pin+','+engine);
  assert.throws(()=>sourceManifest(root),/Unqualified source gitlink identity/);
 }
 const pin='5c5d6163c81cfc2f85ce3c12f10adbec5ae165cd';git('update-index','--cacheinfo','160000,'+pin+','+engine);
 assert.deepEqual(sourceManifest(root).entries[engine],{type:'gitlink',commit:pin,initialized:false});
});

test('embedding source admission rejects the historical producer and binds current JNI identity',()=>{
 const reviewed='5c5d6163c81cfc2f85ce3c12f10adbec5ae165cd';
 const actual=execFileSync('git',['-C','vendor/eliza','ls-tree','HEAD','plugins/plugin-local-inference/native/llama.cpp'],{encoding:'utf8'}).match(/^160000 commit ([a-f0-9]{40})\t/)[1];
 assert.equal(actual,reviewed);
 const qualification=JSON.parse(readFileSync(new URL('../android/embedding-host/qualified-host.json',import.meta.url),'utf8'));
 const {appId}=JSON.parse(readFileSync(new URL('../app.config.json',import.meta.url),'utf8'));
 assert.equal(qualification.forkPin,'6337fd4c4bd071c17235986344d552d4036e177b','historical library provenance is retained');
 assert.notEqual(qualification.forkPin,reviewed,'old library bytes are not relabeled as the current engine');
 assert.equal(qualification.identity,appId);
 assert.equal(qualification.jniBinding.className,appId.replaceAll('.','/')+'/ElizaVoiceNative');
 assert.throws(()=>verifyEmbeddingInputs(process.cwd(),qualification,{requireProducerInputs:true}), /Embedding producer input changed/,
  'the retained historical producer cannot qualify different current source inputs');
 const generated=readNativeBuildReceipt(process.cwd());
 if(generated) assert.doesNotThrow(()=>verifyEmbeddingInputs(process.cwd(),generated.embedding,{requireProducerInputs:true}));
 const admitted=generated?.embedding??qualification;
 const retainedAppId='ai.example.other';
 assert.throws(()=>verifyEmbeddingInputs(process.cwd(),{...admitted,identity:retainedAppId}),/Embedding host source or identity admission changed/);
 const retainedBinding={...admitted.jniBinding,className:retainedAppId.replaceAll('.','/')+'/ElizaVoiceNative'};
 assert.throws(()=>verifyEmbeddingInputs(process.cwd(),{...admitted,jniBinding:retainedBinding}),/Native registration identity qualification missing or changed/);
 const {producerInputs,...nativeOnly}=admitted;
 assert.ok(producerInputs.length>0,'the real qualification still binds its producer inputs');
 assert.throws(()=>verifyEmbeddingInputs(process.cwd(),nativeOnly,{requireProducerInputs:true}),/Embedding producer input qualification missing or changed/,'native-only equality cannot replace full producer qualification');
 const voice=JSON.parse(readFileSync(new URL('../android/voice-host/qualified-voice-host.json',import.meta.url),'utf8'));
 assert.equal(voice.identity,appId);
 assert.equal(voice.qualified,false);
});
