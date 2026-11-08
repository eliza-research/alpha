import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {clientSpeechPatch} from '../scripts/client-speech-patch.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const target='packages/voice/src/native-cloud-speech.ts';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'client-speech-patch-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'patches/eliza');fs.mkdirSync(dir,{recursive:true});
 const body='export const relayVersion = 1;\n',patch=`--- /dev/null\n+++ b/${target}\n@@ -0,0 +1 @@\n+${body}`;
 const manifest={schema:1,baseCommit:'a'.repeat(40),patches:[{file:'voice.patch',sha256:sha(patch),targets:[{path:target,beforeSha256:null,afterSha256:sha(body)}]}]};
 const write=()=>{fs.writeFileSync(path.join(dir,'voice.patch'),patch);fs.writeFileSync(path.join(dir,'cloud-speech-client-manifest.json'),JSON.stringify(manifest));};write();
 const source=new Map([['packages/voice/src/random-id.ts',{bytes:Buffer.from('original'),mode:'100644',sha256:sha('original')}]]);
 const upstream={pin:manifest.baseCommit,read(name){assert.equal(name,'packages/voice/src');return source;}};
 return {root,dir,body,patch,manifest,write,source,upstream};
}
test('shared client additions preserve the authenticated base and bind all patch/output bytes',t=>{
 const f=fixture(t),before=[...f.source];const result=clientSpeechPatch(f.root,f.upstream);
 assert.deepEqual([...f.source],before);assert.equal(result.files.get(target).bytes.toString(),f.body);
 assert.equal(result.receipt.files[target],sha(f.body));assert.match(result.receipt.preparerSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.receipt.patches[0].sha256,sha(f.patch));
 assert.equal(clientSpeechPatch(f.root+path.sep,f.upstream).files.get(target).bytes.toString(),f.body);
});
test('shared client additions reject wrong source, existing targets, edits, traversal, digest and output changes',t=>{
 for(const kind of ['pin','existing','edit','traversal','digest','output']){
  const f=fixture(t);
  if(kind==='pin')f.manifest.baseCommit='b'.repeat(40);
  if(kind==='existing')f.source.set(target,{bytes:Buffer.from('existing')});
  if(kind==='edit')f.manifest.patches[0].targets[0].beforeSha256=sha('existing');
  if(kind==='traversal')f.manifest.patches[0].targets[0].path='packages/voice/src/../secret.ts';
  if(kind==='digest')f.manifest.patches[0].sha256='0'.repeat(64);
  if(kind==='output')f.manifest.patches[0].targets[0].afterSha256='0'.repeat(64);
  f.write();assert.throws(()=>clientSpeechPatch(f.root,f.upstream),/mismatch/,kind);
 }
});
test('shared client additions reject symlinked input and undeclared extra output',t=>{
 const linked=fixture(t),real=path.join(linked.root,'real.patch');fs.renameSync(path.join(linked.dir,'voice.patch'),real);fs.symlinkSync(real,path.join(linked.dir,'voice.patch'));
 assert.throws(()=>clientSpeechPatch(linked.root,linked.upstream),/Linked/);
 const extra=fixture(t),payload=extra.patch+'--- /dev/null\n+++ b/packages/voice/src/extra.ts\n@@ -0,0 +1 @@\n+export const unauthorized=1;\n';
 extra.manifest.patches[0].sha256=sha(payload);extra.write();fs.writeFileSync(path.join(extra.dir,'voice.patch'),payload);
 assert.throws(()=>clientSpeechPatch(extra.root,extra.upstream),/headers mismatch/);
});
