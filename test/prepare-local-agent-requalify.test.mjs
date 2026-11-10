import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareLocalAgentFixture} from './fixtures/prepare-local-agent.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function fixture(t){
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'alpha-requalify-test-')));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 return prepareLocalAgentFixture(temp);
}

test('canonical producer requalifies verified committed source and preserves prior stamp',t=>{
 const f=fixture(t);const r=f.prepare(f.args);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readFileSync(f.backup),f.old);
 const current=JSON.parse(fs.readFileSync(f.stamp));assert.equal(current.base,f.after);
 assert.equal(current.lockSha256,sha(fs.readFileSync(path.join(f.product,'upstream.lock.json'))));
 assert.equal(current.preparerSha256,sha(fs.readFileSync(path.join(f.product,'scripts/prepare-local-agent.ts'))));
 assert.deepEqual(current.patches,[]);assert.equal(fs.existsSync(f.stamp+'.requalify-lock'),false);
});

for(const kind of ['stale-stamp','missing-source-directory','dirty-source','wrong-commit','default-refusal','backup-parent-symlink']){
 test(`requalification rejects ${kind} without replacing the stamp`,t=>{
  const f=fixture(t);let args=f.args,override={};
  if(kind==='stale-stamp')args=['--requalify-from','0'.repeat(64),'--preserve-stamp',f.backup];
  if(kind==='missing-source-directory')override.ALPHA_LOCAL_AGENT_SOURCE_DIR='';
  if(kind==='dirty-source')fs.appendFileSync(path.join(f.runtime,'README.md'),'dirty\n');
  if(kind==='wrong-commit')f.git(['checkout','--quiet','--detach',f.before],f.runtime);
  if(kind==='default-refusal')args=[];
  if(kind==='backup-parent-symlink'){const alias=path.resolve(f.product,'..','alias');fs.symlinkSync(f.runtime,alias,'dir');args=['--requalify-from',sha(f.old),'--preserve-stamp',path.join(alias,'prior-stamp.json')];}
  const r=f.prepare(args,override);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(f.stamp),f.old);assert.equal(fs.existsSync(f.backup),false);
 });
}
