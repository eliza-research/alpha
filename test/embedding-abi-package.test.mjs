import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {embeddingApkProblems} from '../scripts/stage-embedding-host.ts';
import {stagedLibraries,embeddingHostState,nativeModelEnvironment} from '../scripts/build-embedding-host.ts';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Linux x64 model conversion selects the numerically qualified NumPy path',()=>{
 assert.deepEqual(nativeModelEnvironment('linux','x64'),{NPY_DISABLE_CPU_FEATURES:'X86_V4 AVX512_ICL AVX512_SPR'});
 assert.deepEqual(nativeModelEnvironment('darwin','arm64'),{});
 assert.deepEqual(nativeModelEnvironment('linux','arm64'),{});
});
function fixture(){
 const files=new Map(),rows=['arm64-v8a','x86_64'].map(abi=>({abi,libraries:['libelizainference.so','libc++_shared.so','libelizavoicejni.so'].map(name=>{
  const bytes=Buffer.from(abi+name);files.set(`lib/${abi}/${name}`,bytes);return{name,bytes:bytes.length,sha256:sha(bytes)};
 })}));
 for(const row of rows)files.set(`lib/${row.abi}/libeliza_bun.so`,Buffer.from('runtime'));
 return{files,manifest:{...rows[0],additionalAbis:[rows[1]]},bundle(){return{names:[...files.keys()],read:name=>files.get(name)}}};
}
test('every packaged resident ABI requires its own exact JNI closure',()=>{
 const f=fixture();assert.deepEqual(embeddingApkProblems(f.bundle(),f.manifest),[]);
 f.files.delete('lib/x86_64/libelizavoicejni.so');assert.match(embeddingApkProblems(f.bundle(),f.manifest).join('\n'),/x86_64\/libelizavoicejni.so/);
});
test('an ARM64 bridge cannot satisfy the x86 resident and unadmitted ABIs fail',()=>{
 const f=fixture();f.files.set('lib/x86_64/libelizavoicejni.so',f.files.get('lib/arm64-v8a/libelizavoicejni.so'));
 assert.match(embeddingApkProblems(f.bundle(),f.manifest).join('\n'),/library differs/);
 f.files.set('lib/armeabi-v7a/libeliza_bun.so',Buffer.from('runtime'));
 assert.match(embeddingApkProblems(f.bundle(),f.manifest).join('\n'),/ABI is not admitted: armeabi-v7a/);
});
test('single ABI resident APKs require only that admitted ABI',()=>{
 const f=fixture();for(const name of [...f.files.keys()])if(name.startsWith('lib/x86_64/'))f.files.delete(name);
 assert.deepEqual(embeddingApkProblems(f.bundle(),f.manifest),[]);
});
test('preflight readiness includes every declared embedding ABI',t=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embedding-abis-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,bytes] of f.files){if(!name.startsWith('lib/arm64-v8a/'))continue;const file=path.join(root,'android/app/src/main/jniLibs',name.slice(4));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 let staged=stagedLibraries(root,f.manifest);assert.equal(staged.length,6);
 assert.equal(embeddingHostState(f.manifest,{},staged).ready,false);
 assert.ok(staged.filter(row=>row.abi==='x86_64').every(row=>row.state==='missing'));
 for(const [name,bytes] of f.files){if(!name.startsWith('lib/x86_64/'))continue;const file=path.join(root,'android/app/src/main/jniLibs',name.slice(4));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 staged=stagedLibraries(root,f.manifest);assert.equal(embeddingHostState(f.manifest,{},staged).ready,true);
});
