/** Synthetic held file-effect boundary only, on isolated47848. --prepare performs an explicit hard stop after cancel acknowledgement. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { workflowHost, writeHostReport, type HostProcess, type HostReport } from './fixtures/workflow-host.ts';
const host = workflowHost(47848, 'local-reviewed-workflows');
const {profile, expectOk: call} = host;
host.restore();
const prepare = process.argv.includes('--prepare');
const file = 'cancellation-fixture.json';
type CancelFixture = {workflowId: string; runId: string; versionId: string; submissionId: string; effect: string; dir: string; cancellationRequestedAt: string; statusBeforeStop: string; finishedBeforeStop: boolean; pidBefore: number};
const result: HostReport = {testedAt:new Date().toISOString(),scope:'Isolated real host durable cancellation, hard process stop/restart and synthetic held file-effect witness',passed:false};
try{if(prepare){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cancel-effect-'));fs.chmodSync(dir,0o700);const effect=path.join(dir,'effect.txt');
 const source=`/** @jsxImportSource smthrs */
import {appendFileSync} from 'node:fs';
import {createSmithers} from 'smthrs/create';
const api=createSmithers({}, {dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
await new Promise(resolve=>setTimeout(resolve,15000));
appendFileSync(${JSON.stringify(effect)},'synthetic-effect\\n');
export default api.smithers(()=>api.Workflow({name:'alpha-cancel-effect'}));`;
 const made=await call('/api/workflow/workflows',{workflow:{name:'Alpha cancellation recovery '+Date.now(),source,language:'tsx',steps:[{id:'held',label:'Synthetic held file witness',kind:'task'}]},activate:false});const workflowId=made.id,detail=await call(`/api/workflow/workflows/${workflowId}`),submissionId=crypto.randomUUID();const started=await call(`/api/workflow/workflows/${workflowId}/run`,{submissionId,expectedVersionId:detail.versionId,input:{}});const runId=started.execution.id;assert.equal(started.execution.finished,false);assert.equal(fs.existsSync(effect),false);
 const cancelled=await call(`/api/workflow/executions/${runId}/cancel`,{});assert.ok(typeof cancelled.execution.cancellationRequestedAt==='string');const metadata=host.read<HostProcess>('process.json');assert.equal(metadata.port,47848);assert.equal(metadata.profile,profile);
 const saved={workflowId,runId,versionId:detail.versionId,submissionId,effect,dir,cancellationRequestedAt:cancelled.execution.cancellationRequestedAt,statusBeforeStop:cancelled.execution.status,finishedBeforeStop:cancelled.execution.finished,pidBefore:metadata.pid};host.write(file,saved satisfies CancelFixture);process.kill(metadata.pid,'SIGKILL');Object.assign(result,{phase:'prepare',statusBeforeStop:saved.statusBeforeStop,finishedBeforeStop:saved.finishedBeforeStop,intentAcknowledged:true,hardStop:true,passed:true});
 }else{
 const saved=host.read<CancelFixture>(file);const metadata=host.read<HostProcess>('process.json');assert.notEqual(metadata.pid,saved.pidBefore);const receipt=(await call(`/api/workflow/executions/${saved.runId}`)).execution;assert.equal(receipt.status,'cancelled');assert.equal(receipt.finished,true);assert.equal(receipt.cancellationRequestedAt,saved.cancellationRequestedAt);
 // Longer than the original held source; a resumed module would write its witness.
 await new Promise(resolve=>setTimeout(resolve,18000));assert.equal(fs.existsSync(saved.effect),false);const unchanged=(await call(`/api/workflow/executions/${saved.runId}`)).execution;assert.equal(unchanged.events.length,receipt.events.length);assert.equal((await call(`/api/workflow/workflows/${saved.workflowId}/executions`)).executions.length,1);
 const control=await call(`/api/workflow/workflows/${saved.workflowId}/run`,{submissionId:crypto.randomUUID(),expectedVersionId:saved.versionId,input:{}});for(let i=0;i<80;i++){const current=(await call(`/api/workflow/executions/${control.execution.id}`)).execution;if(current.finished){assert.equal(current.status,'finished');break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.equal(fs.readFileSync(saved.effect,'utf8'),'synthetic-effect\n');
 Object.assign(result,{phase:'verify',statusBeforeStop:saved.statusBeforeStop,finishedBeforeStop:saved.finishedBeforeStop,sameIntent:true,cancelledAfterRestart:true,noEffectAfterHold:true,noNewEvents:true,positiveControlExactlyOneEffect:true,passed:true});fs.rmSync(saved.dir,{recursive:true,force:true});
 }}catch(error){result.error=error instanceof Error ? error.message : String(error);}
writeHostReport('test-results/workflow-cancel-recovery', prepare ? 'prepare.json' : 'verify.json', result);
