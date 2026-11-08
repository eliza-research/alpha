import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['scripts/prepare-local-agent.mjs','scripts/local-agent-source.mjs','scripts/copy-file-clone.mjs','vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs','vendor/eliza/packages/app/scripts/lib/committed-source.mjs'];

function fixture(t){
 const temp=fs.mkdtempSync(path.join(root,'.requalify-test-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const sdk=path.join(temp,'sdk'),product=path.join(temp,'product');
 fs.mkdirSync(sdk);fs.mkdirSync(product);
 const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'file',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const run=(cmd,args,options={})=>spawnSync(cmd,args,{env,encoding:'utf8',...options});
 const git=(args,cwd=sdk)=>{const r=run('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','--quiet']);
 fs.writeFileSync(path.join(sdk,'package.json'),JSON.stringify({name:'fixture',workspaces:[]}));
 fs.writeFileSync(path.join(sdk,'turbo.json'),JSON.stringify({tasks:{}}));
 fs.writeFileSync(path.join(sdk,'README.md'),'before\n');git(['add','.']);git(['commit','--quiet','-m','before']);const before=git(['rev-parse','HEAD']);
 fs.writeFileSync(path.join(sdk,'README.md'),'after\n');git(['commit','--quiet','-am','after']);const after=git(['rev-parse','HEAD']);
 for(const file of sourceFiles){const target=path.join(product,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
 const lock=path.join(product,'upstream.lock.json');fs.writeFileSync(lock,JSON.stringify({url:sdk,commit:before}));
 const runtime=path.join(product,'artifacts','runtime');const childEnv={...env,ALPHA_LOCAL_AGENT_SOURCE_DIR:runtime};
 const prepare=(args=[],override={})=>spawnSync(process.execPath,[path.join(product,'scripts/prepare-local-agent.mjs'),'--source-only',...args],{cwd:product,env:{...childEnv,...override},encoding:'utf8'});
 const initial=prepare();assert.equal(initial.status,0,initial.stderr);
 const stamp=path.join(runtime,'.alpha-runtime-source.json'),old=fs.readFileSync(stamp),backup=path.join(temp,'prior-stamp.json');
 git(['fetch','--quiet',sdk,after],runtime);git(['checkout','--quiet','--detach',after],runtime);fs.writeFileSync(lock,JSON.stringify({url:sdk,commit:after}));
 return {sdk,product,runtime,stamp,old,backup,before,after,git,prepare,args:['--requalify-from',sha(old),'--preserve-stamp',backup]};
}

test('canonical producer requalifies verified committed source and preserves prior stamp',t=>{
 const f=fixture(t);const r=f.prepare(f.args);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readFileSync(f.backup),f.old);
 const current=JSON.parse(fs.readFileSync(f.stamp));assert.equal(current.base,f.after);
 assert.equal(current.lockSha256,sha(fs.readFileSync(path.join(f.product,'upstream.lock.json'))));
 assert.equal(current.preparerSha256,sha(fs.readFileSync(path.join(f.product,'scripts/prepare-local-agent.mjs'))));
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
