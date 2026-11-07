import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {AGENT_MODEL} from '../scripts/agent-model.mjs';

function launch({route,override,swaps,existingToken=true,retainedIdentity=true,runtimeConfigUpdate=false,repeat=false,autoReset}={}) {
 const dir=mkdtempSync(join(tmpdir(),'alpha-model-')),profile=join(dir,'profile'),source=join(dir,'source'),receipt=join(dir,'models.json'),childReceipt=join(dir,'child.json'),bun=join(dir,'fake-bun');
 mkdirSync(profile);mkdirSync(join(source,'packages/app/src/runtime'),{recursive:true});writeFileSync(join(source,'packages/app/src/runtime/dev-server.ts'),'');
 execFileSync('git',['init','-q',source]);execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
 writeFileSync(bun,`#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(childReceipt)},JSON.stringify({pid:process.pid,hostRevision:process.env.ELIZA_HOST_CONTEXT_REVISION,autoReset:process.env.ELIZA_PGLITE_AUTO_RESET??null,unexpected:process.env.ALPHA_UNRELATED_ENV??null,token:process.env.ELIZA_API_TOKEN,nativeViews:JSON.parse(process.env.ELIZA_NATIVE_VIEW_DECLARATIONS),swaps:{secret:process.env.ELIZA_SECRET_SWAP_ENABLED??null,pii:process.env.ELIZA_PII_SWAP_ENABLED??null},config:JSON.parse(fs.readFileSync(process.env.ELIZA_CONFIG_PATH,'utf8'))}));fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify(Object.fromEntries(['CEREBRAS_MODEL','CEREBRAS_SMALL_MODEL','CEREBRAS_LARGE_MODEL'].map(k=>[k,process.env[k]]))));${runtimeConfigUpdate?"fs.writeFileSync(process.env.ELIZA_CONFIG_PATH,JSON.stringify({...JSON.parse(fs.readFileSync(process.env.ELIZA_CONFIG_PATH,'utf8')),runtimeSelection:'retained'}));":''}`,{mode:0o700});
 const tokenPath=join(profile,'owner-token'),retainedToken='a'.repeat(64);if(existingToken)writeFileSync(tokenPath,retainedToken,{mode:0o600});
 // An existing profile carries an explicitly retained agent identity; the launcher refuses ambiguous ones.
 const identity={agents:{list:[{id:'retained',default:true,name:'Retained Eliza',identityName:'Retained Eliza'}]}};
 const config=join(profile,'eliza.json');if(route||(existingToken&&retainedIdentity))writeFileSync(config,JSON.stringify({serviceRouting:{llmText:route??{backend:'cerebras',transport:'direct'}},...identity,fixtureKeep:'preserve'}),{mode:0o600});
 const before=existsSync(config)?readFileSync(config,'utf8'):null;
 let ownedLivePid;
 const env={...process.env,ALPHA_UNRELATED_ENV:'must-stay-outside',ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:'47999',ALPHA_BUN:bun,CEREBRAS_API_KEY:'synthetic-fixture-key'};for(const key of ['ELIZA_SECRET_SWAP_ENABLED','ELIZA_PII_SWAP_ENABLED','CEREBRAS_MODEL','ELIZA_PGLITE_AUTO_RESET'])delete env[key];Object.assign(env,swaps||{});if(override!==undefined)env.CEREBRAS_MODEL=override;if(autoReset!==undefined)env.ELIZA_PGLITE_AUTO_RESET=autoReset;
 try {
  let result=spawnSync(process.execPath,[resolve('scripts/start-local-remote.mjs')],{env,encoding:'utf8',timeout:15000});
  const firstChild=existsSync(childReceipt)?JSON.parse(readFileSync(childReceipt,'utf8')):null;
  if(repeat){assert.equal(result.status,0,result.stderr);result=spawnSync(process.execPath,[resolve('scripts/start-local-remote.mjs')],{env,encoding:'utf8',timeout:15000});}
  const child=existsSync(childReceipt)?JSON.parse(readFileSync(childReceipt,'utf8')):null;let childAlive=false;if(child)try{process.kill(child.pid,0);childAlive=true;ownedLivePid=child.pid;}catch(error){if(error.code!=='ESRCH')throw error;}
  const launchRecord=join(profile,'process.json');
  return {status:result.status,error:result.stderr,firstChild,child,launch:existsSync(launchRecord)?JSON.parse(readFileSync(launchRecord,'utf8')):null,childAlive,retainedToken,token:readFileSync(tokenPath,'utf8'),models:existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):null,before,after:existsSync(config)?readFileSync(config,'utf8'):null};
 } finally {if(ownedLivePid){try{process.kill(ownedLivePid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}rmSync(dir,{recursive:true,force:true});}
}
test('new local profile uses the selected model consistently in saved routing and child environment',()=>{
 const r=launch({override:'fixture-model',existingToken:false});assert.equal(r.status,0,r.error);assert.deepEqual(r.models,{CEREBRAS_MODEL:'fixture-model',CEREBRAS_SMALL_MODEL:'fixture-model',CEREBRAS_LARGE_MODEL:'fixture-model'});assert.equal(JSON.parse(r.after).serviceRouting.llmText.largeModel,'fixture-model');assert.match(r.token,/^[a-f0-9]{64}$/);assert.equal(r.child.token,r.token);
});
test('existing local profile retains distinct reviewed models without rewriting its configuration',()=>{
 const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'fixture-small',largeModel:'fixture-large'}});assert.equal(r.status,0,r.error);assert.deepEqual(r.models,{CEREBRAS_MODEL:'fixture-large',CEREBRAS_SMALL_MODEL:'fixture-small',CEREBRAS_LARGE_MODEL:'fixture-large'});assert.equal(r.after,r.before);
});
test('conflicting or malformed explicit model selection fails before a child starts and preserves the profile',()=>{
 for(const override of ['different-model','bad model']){const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'saved',largeModel:'saved'},override});assert.notEqual(r.status,0);assert.equal(r.models,null);assert.equal(r.after,r.before);assert.match(r.error,override==='bad model'?/Invalid agent model identifier/:/conflicts with the saved profile/);}
});

test('redaction rejects unqualified source before starting a child or creating configuration',()=>{
 const r=launch({swaps:{ELIZA_SECRET_SWAP_ENABLED:'true',ELIZA_PII_SWAP_ENABLED:'true'},retainedIdentity:false});assert.notEqual(r.status,0);assert.equal(r.models,null);assert.equal(r.after,null);assert.match(r.error,/Prepared runtime base commit changed/);
});
test('invalid or partial redaction selection cannot silently start an unprotected agent',()=>{
 for(const [swaps,error] of [[{ELIZA_PII_SWAP_ENABLED:'true'},/Set ELIZA_SECRET_SWAP_ENABLED and ELIZA_PII_SWAP_ENABLED together/],[{ELIZA_SECRET_SWAP_ENABLED:'yes',ELIZA_PII_SWAP_ENABLED:'true'},/must be true or false/]]){
  const r=launch({swaps,retainedIdentity:false});assert.notEqual(r.status,0);assert.equal(r.models,null);assert.equal(r.after,null);assert.match(r.error,error);
 }
});

test('private launch preserves the existing hex token and child routing configuration',()=>{
 const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'small',largeModel:'large'}});
 assert.equal(r.status,0,r.error);assert.equal(r.token,r.retainedToken);assert.equal(r.child.token,r.retainedToken);
 assert.deepEqual(r.child.config,JSON.parse(r.before));assert.equal(r.childAlive,false);
});
test('runtime configuration updates remain in the persistent profile',()=>{
 const r=launch({runtimeConfigUpdate:true});assert.equal(r.status,0,r.error);assert.equal(JSON.parse(r.after).runtimeSelection,'retained');
});

// Host launcher and backend keep upstream swaps off unless both are explicitly enabled;
// only the packaged Android resident runtime turns them on by default.
test('host launcher defaults upstream secret and PII swaps off',()=>{
 for(const swaps of [undefined,{ELIZA_SECRET_SWAP_ENABLED:'false',ELIZA_PII_SWAP_ENABLED:'false'}]){
  const r=launch({swaps});assert.equal(r.status,0,r.error);
  assert.notEqual(r.child.swaps.secret,'true');assert.notEqual(r.child.swaps.pii,'true');
  assert.equal(r.launch.egressRedactionRequested,'off');
  assert.doesNotMatch(JSON.stringify(r.launch),/synthetic-fixture-key/);
 }
});
test('local host uses the product-owned native route policy rather than inherited caller environment',()=>{
 const r=launch({swaps:{ELIZA_NATIVE_VIEW_DECLARATIONS:JSON.stringify([{id:'wallet',label:'Wallet',path:'/wallet'}])}});assert.equal(r.status,0,r.error);assert.deepEqual(r.child.nativeViews,JSON.parse(readFileSync(resolve('config/native-view-declarations.json'),'utf8')));assert.deepEqual(r.child.nativeViews.map(view=>view.id),['photos','maps','camera','notes','calendar','inbox']);
});

test('local host owns a fresh nonsecret retirement revision on each launch of the same profile',()=>{
 const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'small',largeModel:'large'},repeat:true,swaps:{ELIZA_HOST_CONTEXT_REVISION:'forged-caller-revision'}});
 assert.equal(r.status,0,r.error);
 for(const child of [r.firstChild,r.child]){assert.match(child.hostRevision,/^boot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);assert.doesNotMatch(child.hostRevision,/synthetic-fixture-key|forged-caller-revision/);}
 assert.notEqual(r.firstChild.hostRevision,r.child.hostRevision);
 assert.equal(r.firstChild.token,r.retainedToken);assert.equal(r.child.token,r.retainedToken);
 assert.equal(r.after,r.before);assert.equal(r.childAlive,false);
});


test('local launcher preserves the explicit database recovery choice in the spawned child',()=>{
 for(const autoReset of [undefined,'0','1']){
  const r=launch({autoReset});assert.equal(r.status,0,r.error);
  assert.equal(r.child.autoReset,autoReset??null);assert.equal(r.child.unexpected,null);assert.equal(r.childAlive,false);
  assert.equal(r.child.token,r.retainedToken);
 }
});
