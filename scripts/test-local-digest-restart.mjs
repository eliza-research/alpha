#!/usr/bin/env node
// Destructive process tests own only their temporary synthetic runtime/profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {sourceDirectory,verifySource} from './local-agent-source.mjs';
const product=path.resolve(import.meta.dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=90000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await check();if(result)return result;await sleep(100);}throw Error('Timed out waiting for isolated digest recovery');}
if(process.env.ALPHA_DIGEST_CRASH_CHILD==='1'){
 const source=process.env.ALPHA_DIGEST_SOURCE,dir=process.env.ALPHA_DIGEST_FIXTURE,phase=process.env.ALPHA_DIGEST_PHASE;
 const load=relative=>import(pathToFileURL(path.join(source,relative)).href);
 const {ModelType,ServiceType,TaskService}=await load('packages/core/src/index.ts');
 const {createRealTestRuntime}=await load('packages/app/test/helpers/real-runtime.ts');
 const {workflowPlugin}=await load('plugins/plugin-workflow/src/index.ts');
 const write=(name,value)=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2));
 const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json')));
 const state=await createRealTestRuntime({characterName:'AlphaDigestCrashFixture',pgliteDir:path.join(dir,'db'),removePgliteDirOnCleanup:false,plugins:[workflowPlugin,{name:'synthetic-crash-model',description:'Synthetic read-only test model',models:{[ModelType.TEXT_LARGE]:async()=>{
   fs.appendFileSync(path.join(dir,'model-calls.jsonl'),JSON.stringify({phase,at:new Date().toISOString()})+'\n');
   if(phase==='admit'){write('provider-entered',{phase});await new Promise(()=>{});}
   return 'Synthetic recovery task remains open. No current phone data was read.';
 }}}]});
 const engine=state.runtime.getService('embedded_workflow_service');
 const owner='synthetic-crash-owner';
 const loop=async(source,at)=>engine.saveHostedDigest(owner,randomUUID(),{version:1,template:'morning',sourceId:source.id,sourceRevision:source.revision,timeZone:'UTC',localTime:new Date(at).toISOString().slice(11,16),enabled:true});
 try{
  if(phase==='admit'){
   const source=await engine.saveDigestSource(owner,{id:randomUUID(),kind:'tasks',label:'Synthetic recovery snapshot',text:'Synthetic recovery task is open. Explicit snapshot only.',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),confirmed:true});
   const scheduledAt=Math.floor(Date.now()/60000)*60000,receipt=await loop(source,scheduledAt);
   const run=await engine.startWorkflow(receipt.workflowId,{mode:'trigger',triggerData:{scheduledAtMs:scheduledAt,workflowVersionId:receipt.versionId}});
   write('admitted',{source,receipt,scheduledAt,runId:run.id});
   await new Promise(()=>{});
  }else if(phase==='recover'){
   const saved=read('admitted');
   const run=await until(async()=>{const row=await engine.getExecution(saved.runId);return row.reconciliation?.state==='outcome-unknown'&&row;});
   assert.equal(run.finished,false);assert.equal(run.id,saved.runId);
   assert.equal(run.stoppedAt,null);
   const repeats=await Promise.all([1,2].map(()=>engine.startWorkflow(saved.receipt.workflowId,{mode:'trigger',triggerData:{scheduledAtMs:saved.scheduledAt,workflowVersionId:saved.receipt.versionId}})));
   assert.ok(repeats.every(r=>r.id===saved.runId));
   const entries=(await engine.digestResults(owner,'crash-reader')).entries.filter(e=>e.workflowId===saved.receipt.workflowId);
   assert.equal(entries.length,0);
   const missedAt=Math.floor(Date.now()/60000)*60000-86400000,missed=await loop(saved.source,missedAt);
   const tasks=await state.runtime.getTasks({agentIds:[state.runtime.agentId],tags:['trigger']});
   const task=tasks.find(t=>t.metadata?.trigger?.workflowId===missed.workflowId);assert.ok(task);
   await state.runtime.updateTask(task.id,{metadata:{...task.metadata,updatedAt:missedAt,updateInterval:1,idempotencyKey:`${missed.workflowId}:${Math.floor(missedAt/60000)}`,trigger:{...task.metadata.trigger,nextRunAtMs:missedAt}}});
   // A later occurrence of the interrupted loop. Its next daily occurrence is a day away, so the loop is
   // moved to the current minute; the occurrence must get its own run and an explicit record, never the
   // unknown run again. At the pin the unknown run stays unfinished, so the loop records overlap.
   const nextAt=Math.floor(Date.now()/60000)*60000;
   const edited=await engine.saveHostedDigest(owner,randomUUID(),{version:1,template:'morning',sourceId:saved.source.id,sourceRevision:saved.source.revision,timeZone:'UTC',localTime:new Date(nextAt).toISOString().slice(11,16),enabled:true},saved.receipt.workflowId,saved.receipt.versionId);
   assert.equal(edited.workflowId,saved.receipt.workflowId);assert.notEqual(edited.versionId,saved.receipt.versionId);
   const next=await engine.startWorkflow(saved.receipt.workflowId,{mode:'trigger',triggerData:{scheduledAtMs:nextAt,workflowVersionId:edited.versionId}});
   assert.notEqual(next.id,saved.runId);
   const nextEntry=await until(async()=>(await engine.digestResults(owner,'next-reader')).entries.find(e=>e.runId===next.id));
   assert.equal(nextEntry.workflowId,saved.receipt.workflowId);
   assert.ok(!['missed','unavailable'].includes(nextEntry.status),`next occurrence recorded ${nextEntry.status}`);
   assert.equal((await engine.getExecution(saved.runId)).reconciliation?.state,'outcome-unknown');
   const unknownEntries=(await engine.digestResults(owner,'next-reader')).entries.filter(e=>e.runId===saved.runId);assert.equal(unknownEntries.length,0);
   // A source that lapses while the agent is down: its occurrence fires at the next boot.
   const lapsing=await engine.saveDigestSource(owner,{id:randomUUID(),kind:'tasks',label:'Synthetic lapsing snapshot',text:'Synthetic task that must not be read after expiry.',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+5000).toISOString(),confirmed:true});
   const lapsedAt=Math.floor(Date.now()/60000)*60000,lapsed=await loop(lapsing,lapsedAt);
   const lapsedTask=(await state.runtime.getTasks({agentIds:[state.runtime.agentId],tags:['trigger']})).find(t=>t.metadata?.trigger?.workflowId===lapsed.workflowId);assert.ok(lapsedTask);
   await state.runtime.updateTask(lapsedTask.id,{metadata:{...lapsedTask.metadata,updatedAt:lapsedAt,updateInterval:1,idempotencyKey:`${lapsed.workflowId}:${Math.floor(lapsedAt/60000)}`,trigger:{...lapsedTask.metadata.trigger,nextRunAtMs:lapsedAt}}});
   write('recovered',{sameRunId:true,resultCount:entries.length,duplicateAdmissionsSameRun:true,runId:run.id,reconciliation:run.reconciliation.state,finished:run.finished,nextOccurrence:{runId:next.id,status:nextEntry.status}});
   write('overdue',{receipt:missed,scheduledAt:missedAt,taskId:task.id});
   write('lapsed',{receipt:lapsed,scheduledAt:lapsedAt,expiresAt:lapsing.expiresAt,taskId:lapsedTask.id});
  }else if(phase==='overdue'){
   const saved=read('overdue'),lapsed=read('lapsed');
   await until(()=>Date.now()>Date.parse(lapsed.expiresAt));
   const {registerTriggerTaskWorker}=await load('packages/agent/src/triggers/runtime.ts');registerTriggerTaskWorker(state.runtime);
   if(!state.runtime.getService(ServiceType.TASK))await state.runtime.registerService(TaskService);
   const entries=await until(async()=>{const rows=(await engine.digestResults(owner,'overdue-reader')).entries.filter(e=>e.workflowId===saved.receipt.workflowId);return rows.length&&rows;});
   const lapsedEntries=await until(async()=>{const rows=(await engine.digestResults(owner,'lapsed-reader')).entries.filter(e=>e.workflowId===lapsed.receipt.workflowId);return rows.length&&rows;});
   assert.equal(lapsedEntries.length,1);assert.equal(lapsedEntries[0].status,'unavailable');assert.equal(lapsedEntries[0].scheduledAt,new Date(lapsed.scheduledAt).toISOString());
   assert.equal(entries.length,1);assert.equal(entries[0].status,'missed');assert.equal(entries[0].scheduledAt,new Date(saved.scheduledAt).toISOString());
   const task=await until(async()=>{const rows=await state.runtime.getTasks({agentIds:[state.runtime.agentId],tags:['trigger']});const t=rows.find(t=>t.id===saved.taskId);return t?.metadata?.trigger?.nextRunAtMs>Date.now()&&t;});
   const again=await engine.startWorkflow(saved.receipt.workflowId,{mode:'trigger',triggerData:{scheduledAtMs:saved.scheduledAt,workflowVersionId:saved.receipt.versionId}});assert.equal(again.id,entries[0].runId);
   write('overdue-result',{status:entries[0].status,resultCount:1,nextOccurrenceFuture:true,duplicateAdmissionSameRun:true,runId:entries[0].runId,nextRunAtMs:task.metadata.trigger.nextRunAtMs,lapsedStatus:lapsedEntries[0].status,lapsedRunId:lapsedEntries[0].runId});
  }else if(phase==='overdue-restart'){
   // A fourth independent runtime must read the committed receipt and future schedule.
   // Same-process repeated admission alone cannot establish restart persistence.
   const saved=read('overdue'),previous=read('overdue-result');
   const {registerTriggerTaskWorker}=await load('packages/agent/src/triggers/runtime.ts');registerTriggerTaskWorker(state.runtime);
   if(!state.runtime.getService(ServiceType.TASK))await state.runtime.registerService(TaskService);
   const retained=await engine.digestResults(owner,'overdue-restart-reader');
   const entries=retained.entries.filter(e=>e.workflowId===saved.receipt.workflowId);
   assert.equal(entries.length,1);assert.equal(entries[0].runId,previous.runId);
   assert.equal(entries[0].status,'missed');assert.equal(entries[0].scheduledAt,new Date(saved.scheduledAt).toISOString());
   const tasks=await state.runtime.getTasks({agentIds:[state.runtime.agentId],tags:['trigger']});
   const task=tasks.find(t=>t.id===saved.taskId);assert.ok(task);
   assert.equal(task.metadata.trigger.nextRunAtMs,previous.nextRunAtMs);
   assert.ok(task.metadata.trigger.nextRunAtMs>Date.now());
   const repeats=await Promise.all([1,2].map(()=>engine.startWorkflow(saved.receipt.workflowId,{mode:'trigger',triggerData:{scheduledAtMs:saved.scheduledAt,workflowVersionId:saved.receipt.versionId}})));
   assert.ok(repeats.every(run=>run.id===previous.runId&&run.finished));
   const after=(await engine.digestResults(owner,'overdue-restart-reader')).entries.filter(e=>e.workflowId===saved.receipt.workflowId);
   assert.equal(after.length,1);assert.equal(after[0].runId,previous.runId);assert.equal(after[0].status,'missed');
   const lapsed=read('lapsed'),lapsedAfter=retained.entries.filter(e=>e.workflowId===lapsed.receipt.workflowId);
   assert.equal(lapsedAfter.length,1);assert.equal(lapsedAfter[0].runId,previous.lapsedRunId);assert.equal(lapsedAfter[0].status,'unavailable');
   write('overdue-restart-result',{sameMissedRunId:true,resultCount:after.length,futureSchedulePreserved:true,nextRunAtMs:task.metadata.trigger.nextRunAtMs,duplicateAdmissionsSameRun:true});
  }else throw Error('Unknown fixture phase');
 }finally{await state.cleanup();}
 process.exit(0);
}else{
 if(process.platform==='win32')throw Error('This fixture requires POSIX process groups');
 // Input: the pinned upstream source with its dependencies installed. ALPHA_ELIZA_SOURCE names one
 // explicitly; otherwise the directory `npm run agent:prepare` creates for the current pin is used.
 const commit=JSON.parse(fs.readFileSync(path.join(product,'upstream.lock.json'))).commit;
 const supplied=process.env.ALPHA_ELIZA_SOURCE;
 const prepare='  ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" npm run agent:prepare\n'
  +`(creates artifacts/local-agent-resident-${commit} from the pinned commit and installs its dependencies with Bun; about 6 GB).\n`
  +'Then run `npm run agent:test-digest-restart` again, or set ALPHA_ELIZA_SOURCE to the absolute path of another prepared checkout of that commit.';
 const refuse=reason=>{console.error(`agent:test-digest-restart cannot run: ${reason}\nPrepare the pinned runtime source first:\n${prepare}`);process.exit(2);};
 if(supplied!==undefined&&!path.isAbsolute(supplied))refuse(`ALPHA_ELIZA_SOURCE must be an absolute path (got ${JSON.stringify(supplied)}).`);
 const source=supplied||sourceDirectory(product);
 if(!fs.existsSync(path.join(source,'.alpha-runtime-source.json'))&&!fs.existsSync(path.join(source,'package.json')))refuse(`no prepared runtime source at ${source}.`);
 if(!fs.existsSync(path.join(source,'node_modules')))refuse(`the runtime source at ${source} has no installed dependencies (it was prepared with --source-only, or the install was removed).`);
 const bun=process.env.ALPHA_BUN||'bun';
 if(spawnSync(bun,['--version'],{stdio:'ignore'}).status!==0)refuse(`Bun is not available as ${JSON.stringify(bun)} (install Bun or set ALPHA_BUN).`);
 const verify=()=>verifySource(source,commit);verify();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-digest-crash-'));const children=new Set();
 const killOwned=child=>{assert.ok(Number.isSafeInteger(child.pid)&&child.pid>1);try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
 const cleanEnv=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const start=phase=>{const log=fs.openSync(path.join(dir,phase+'.log'),'a');const child=spawn(bun,['--conditions=eliza-source',fileURLToPath(import.meta.url)],{cwd:dir,detached:true,env:{...cleanEnv,ALPHA_DIGEST_CRASH_CHILD:'1',ALPHA_DIGEST_SOURCE:source,ALPHA_DIGEST_FIXTURE:dir,ALPHA_DIGEST_PHASE:phase},stdio:['ignore',log,log]});fs.closeSync(log);children.add(child);child.once('exit',()=>children.delete(child));child.once('error',error=>{child.spawnError=error;children.delete(child);});return child;};
 const finish=child=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{killOwned(child);reject(Error(`Fixture exceeded 120 seconds; evidence: ${dir}`));},120000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(Error(`Fixture exited ${code}/${signal}; evidence: ${dir}`));});});
 try{
  const held=start('admit');
  await until(()=>{if(held.spawnError)throw held.spawnError;if(held.exitCode!==null||held.signalCode!==null)throw Error(`Admission exited; evidence: ${dir}`);return fs.existsSync(path.join(dir,'provider-entered.json'))&&fs.existsSync(path.join(dir,'admitted.json'));});
  const killed=new Promise(resolve=>held.once('exit',(_,signal)=>resolve(signal)));killOwned(held);assert.equal(await killed,'SIGKILL');
  await finish(start('recover'));await finish(start('overdue'));await finish(start('overdue-restart'));
  const calls=fs.readFileSync(path.join(dir,'model-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  // The later occurrence of the interrupted loop makes one model call only if it ran instead of recording overlap.
  const next=JSON.parse(fs.readFileSync(path.join(dir,'recovered.json'))).nextOccurrence;
  assert.equal(calls.filter(c=>c.phase==='admit').length,1);assert.equal(calls.filter(c=>c.phase==='recover').length,next.status==='overlap'?0:1);assert.equal(calls.filter(c=>c.phase==='overdue').length,0);assert.equal(calls.filter(c=>c.phase==='overdue-restart').length,0);
  verify();
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({evidenceClass:'host-runtime',notEvidenceFor:['Android','emulator','device','real inference'],upstreamCommit:commit,crashDuringInference:true,scope:'owned-process-group',preservedSameRun:true,unknownOutcomeNotReplayed:true,noFabricatedResult:true,overdueSkippedWithoutInference:true,missedReceiptSurvivesRestart:true,futureScheduleSurvivesRestart:true,sameLoopLaterOccurrence:next.status,lapsedSourceAtBootUnavailable:true,modelAttempts:calls.length,unchecked:['kill after admission commit before worker lease']},null,2));
  console.log(JSON.stringify({evidence:dir,result:JSON.parse(fs.readFileSync(path.join(dir,'result.json')))}));
 }finally{await Promise.all([...children].map(child=>new Promise(resolve=>{child.once('exit',resolve);killOwned(child);})));}
}
