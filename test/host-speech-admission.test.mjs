import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifiedFile,speechAssets} from '../scripts/host-speech-admission.mjs';
import {sourceManifest} from '../scripts/combined-agent-source.mjs';
import {mkdirSync} from 'node:fs';
test('admission verifies exact bytes and reviewed digest, rejecting links and oversized assets',t=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-speech-admission-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'fixture'),data=Buffer.from('synthetic admission fixture'),sha=createHash('sha256').update(data).digest('hex');writeFileSync(file,data);
 verifiedFile(file,sha,data.length,true);
 assert.throws(()=>verifiedFile(file,'0'.repeat(64),data.length),/checksum/);
 assert.throws(()=>verifiedFile(file,sha,data.length-1),/size/);
 assert.throws(()=>verifiedFile(file,sha,data.length+1,true),/size/);
 symlinkSync(file,join(root,'link'));assert.throws(()=>verifiedFile(join(root,'link'),sha,data.length));
});
test('host asset manifest matches the current shared worker pins: Paradee, optional G2P data, Phonon-2 and required VAD',()=>{
 const source=file=>readFileSync(new URL('../vendor/eliza/plugins/plugin-local-inference/src/'+file,import.meta.url),'utf8');
 const parse=text=>[...text.matchAll(/path: "([^"]+)",\s+sha256: "([^"]+)",\s+bytes: ([\d_]+)/g)].map(([,path,sha256,bytes])=>({path,sha256,bytes:Number(bytes.replaceAll('_',''))}));
 const tts=source('host-tts-worker.ts'),asr=source('host-asr-worker.ts'),assets=source('host-asr-assets.ts');
 assert.deepEqual(speechAssets.tts,parse(tts.split('PARADEE_ASSETS:')[1].split('];')[0]));
 assert.deepEqual(speechAssets.espeak,parse(tts.split('ESPEAK_DATA_ASSETS:')[1].split('];')[0]));
 // Phonon-2 (the parakeet backend, upstream default) is the one ASR model the host worker admits here.
 assert.deepEqual(speechAssets.asr,[...parse(assets.split('PHONON_ASR_ASSETS:')[1].split('];')[0]),...parse(asr.split('const VAD_ASSET')[1].split('};')[0])]);
 // No package script names the retired Kokoro or Whisper speech paths.
 assert.doesNotMatch(readFileSync(new URL('../package.json',import.meta.url),'utf8'),/kokoro|whisper/i);
});
test('frozen local-speech source retains its reviewed engine and explicitly refuses a newer unqualified pin',()=>{
 const source=readFileSync(new URL('../scripts/combined-agent-source.mjs',import.meta.url),'utf8');
 const reviewed='b3eb2bf63b3c02cd37ee09d442911ace99975b38';
 assert.ok(source.includes("'plugins/plugin-local-inference/native/llama.cpp':'"+reviewed+"'"));
 const actual=execFileSync('git',['-C','vendor/eliza','ls-tree','HEAD','plugins/plugin-local-inference/native/llama.cpp'],{encoding:'utf8'}).match(/^160000 commit ([a-f0-9]{40})\t/)[1];
 if(actual!==reviewed){
  assert.ok(!source.includes("'plugins/plugin-local-inference/native/llama.cpp':'"+actual+"'"),'a pin move cannot qualify the local speech source');
  const qualification=JSON.parse(readFileSync(new URL('../android/embedding-host/qualified-host.json',import.meta.url),'utf8'));
  const pin=JSON.parse(readFileSync(new URL('../upstream.lock.json',import.meta.url),'utf8')).commit;
  assert.equal(qualification.requalification?.required,true);assert.equal(qualification.requalification.atPin,pin);
  assert.ok(qualification.requalification.reason.includes(actual.slice(0,8)),'the refusal names the current unqualified engine');
 }
});

// The reviewed source uses the qualified fused-speech engine at 6337fd4c.
test('source snapshots accept only the reviewed 6337 engine and reject old or foreign gitlinks',t=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-engine-identity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Admission fixture','-c','user.email=fixture@example.invalid','-C',root,...args],{encoding:'utf8'}).trim();
 git('init');git('commit','--allow-empty','-m','Fixture');
 const engine='plugins/plugin-local-inference/native/llama.cpp';mkdirSync(join(root,engine),{recursive:true});
 const actual=execFileSync('git',['-C','vendor/eliza','ls-tree','HEAD',engine],{encoding:'utf8'}).match(/^160000 commit ([a-f0-9]{40})\t/)[1];
 for(const pin of new Set(['cc8c979157e1f577448d8b8c6ff598b7cfc3d661','1'.repeat(40),...(actual==='b3eb2bf63b3c02cd37ee09d442911ace99975b38'?[]:[actual])])){
  git('update-index','--add','--cacheinfo','160000,'+pin+','+engine);
  assert.throws(()=>sourceManifest(root),/Unqualified source gitlink identity/);
 }
 const pin='6337fd4c4bd071c17235986344d552d4036e177b';git('update-index','--cacheinfo','160000,'+pin+','+engine);
 assert.deepEqual(sourceManifest(root).entries[engine],{type:'gitlink',commit:pin,initialized:false});
});
