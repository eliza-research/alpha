import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/generate-licenses.ts',import.meta.url),'utf8');
const start=source.indexOf('export function reviewedPackagedEntries('),end=source.indexOf('/** Verify a checked-in packaged notice set',start);
assert.ok(start>=0&&end>start);
const JSON_OUTPUT='apps/app/public/licenses/third-party-notices.json',TEXT_OUTPUT='apps/app/public/licenses/THIRD_PARTY_NOTICES.txt';
const context=vm.createContext({fs,path,createHash,JSON_OUTPUT,TEXT_OUTPUT,BUN_ENTRY:'Bun JavaScript runtime (libeliza_bun.so)'});
const reviewedPackagedEntries=vm.runInContext(source.slice(start,end).replace('export function','function')+';reviewedPackagedEntries',context);
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-notice-review-'));
 const entries=[{name:'Bun JavaScript runtime (libeliza_bun.so)',text:'Real reviewed Bun terms'},{name:'runtime-package',text:'Bundled in the on-device agent. MIT terms'},{name:'source-package',text:'MIT source terms'}];
 const json=JSON.stringify(entries)+'\n',text='Exact complete notice text\n',review='docs/security/resident-staged-review-test.json';
 const record={schema:1,sdk:'a'.repeat(40),bundleSha256:'b'.repeat(64),audit:{input:'packaged-runtime notices'},evidenceFiles:{'third-party-notices.json':sha(json),'THIRD_PARTY_NOTICES.txt':sha(text)}};
 const write=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data));};
 write(JSON_OUTPUT,json);write(TEXT_OUTPUT,text);write('upstream.lock.json',{commit:record.sdk});write('docs/dependency-audit.dispositions.json',{resident:{shippedSetEvidence:review}});write(review,record);
 return {root,entries,record,review,write,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('source verification accepts only the exact reviewed runtime rows without staging or writing assets',()=>{
 const f=fixture();try{const before=fs.readFileSync(path.join(f.root,JSON_OUTPUT));const rows=reviewedPackagedEntries(f.root);assert.deepEqual(JSON.parse(JSON.stringify(rows)),f.entries.slice(0,2));assert.deepEqual(fs.readFileSync(path.join(f.root,JSON_OUTPUT)),before);assert.equal(fs.existsSync(path.join(f.root,'android/app/src/main/assets/agent')),false);}finally{f.close();}
});
for(const change of ['SDK','JSON','text','review-path','symlink','bundle-shape'])test(`source verification refuses changed ${change}`,()=>{
 const f=fixture();try{
  if(change==='bundle-shape'){f.record.bundleSha256=['b'.repeat(64)];f.write(f.review,f.record);}
  if(change==='SDK')f.write('upstream.lock.json',{commit:'c'.repeat(40)});
  if(change==='JSON')f.write(JSON_OUTPUT,'[]\n');
  if(change==='text')f.write(TEXT_OUTPUT,'Changed terms\n');
  if(change==='review-path')f.write('docs/dependency-audit.dispositions.json',{resident:{shippedSetEvidence:'../unrelated.json'}});
  if(change==='symlink'){const p=path.join(f.root,TEXT_OUTPUT);fs.renameSync(p,p+'.held');fs.symlinkSync(p+'.held',p);}
  assert.throws(()=>reviewedPackagedEntries(f.root));
 }finally{f.close();}
});
