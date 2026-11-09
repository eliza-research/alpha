import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifiedFile,speechAssets} from '../scripts/host-speech-admission.mjs';
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
});
test('frozen combined source admits only the current reviewed native gitlink',()=>{
 const source=readFileSync(new URL('../scripts/combined-agent-source.mjs',import.meta.url),'utf8');
 const actual=execFileSync('git',['-C','vendor/eliza','ls-tree','HEAD','plugins/plugin-local-inference/native/llama.cpp'],{encoding:'utf8'}).match(/^160000 commit ([a-f0-9]{40})\t/)[1];
 assert.ok(source.includes("'plugins/plugin-local-inference/native/llama.cpp':'"+actual+"'"));
});
