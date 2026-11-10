/** Real paired isolated47854, canonical approval SQLite and controlled own-file effects. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import type { WorkflowApproval } from '../apps/app/src/runtime/workflow-protocol.ts';
import { workflowHost, writeHostReport, type ApprovalFixture, type HostProcess, type HostReport } from './fixtures/workflow-host.ts';
const host = workflowHost(47854, 'local-workflow-approvals', { timeout: 60_000 });
const {call} = host;
const result: HostReport = {scope:'Actual paired app host, canonical Smithers approval and synthetic own-file effect only',testedAt:new Date().toISOString(),passed:false};
try{
 await host.pair();
 assert.equal(await host.unauthenticatedStatus(),401);
 assert.equal((await call('/api/workflow/status')).body.approvalReceiptProtocol,1);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-approval-effect-'));fs.chmodSync(dir,0o700);const effect=path.join(dir,'effect.txt');
 const source=`/** @jsxImportSource smthrs */
import {appendFileSync} from 'node:fs';import {createSmithers} from 'smthrs/create';import {approvalDecisionSchema} from 'smthrs';import {z} from 'zod';
const {Workflow,Sequence,Approval,Task,smithers,outputs}=createSmithers({decision:approvalDecisionSchema,output:z.object({message:z.string()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
export default smithers(()=><Workflow name="alpha-reviewed-approval"><Sequence><Approval id="write-fixture" output={outputs.decision} request={{title:'Write synthetic fixture?',summary:'Append one synthetic line to the test-owned temporary file.',metadata:{alphaPhone:{operation:'Append synthetic fixture line',target:'Test-owned temporary file',account:'Isolated local fixture owner'}}}}/><Task id="effect" output={outputs.output} noRetry sideEffect={true}>{()=>{appendFileSync(${JSON.stringify(effect)},'approved-effect\\n');return {message:'Fixture written after explicit approval'};}}</Task></Sequence></Workflow>);`;
 const made=await call('/api/workflow/workflows',{workflow:{name:'Alpha approval fixture '+Date.now(),source,language:'tsx',steps:[{id:'write-fixture',label:'Review synthetic file effect',kind:'approval'},{id:'effect',label:'Append synthetic own-file witness',kind:'task'}]},activate:false});assert.equal(made.status,201);const workflowId=made.body.id,versionId=made.body.versionId;
 const start=async()=>{const r=await call(`/api/workflow/workflows/${workflowId}/run`,{submissionId:crypto.randomUUID(),expectedVersionId:versionId,input:{}});assert.equal(r.status,202);return r.body.execution.id;};
 const approvals=async (runId: string)=>{for(let n=0;n<120;n++){const r=await call(`/api/workflow/executions/${runId}/approvals`);if(r.status===200&&r.body.approvals.length)return r.body;await new Promise(r=>setTimeout(r,250));}throw Error('No canonical approval');};
 const decide=(a: WorkflowApproval,approved: boolean,overrides: {expectedVersionId?: string; requestDigest?: string}={})=>call(`/api/workflow/executions/${a.runId}/approvals/${a.nodeId}/${a.iteration}`,{approved,expectedVersionId:versionId,requestDigest:a.requestDigest,...overrides});
 const runId=await start(),pending=await approvals(runId),a=pending.approvals[0];assert.equal(a.status,'pending');assert.equal(a.supported,true);assert.equal(fs.existsSync(effect),false);
 assert.equal((await decide(a,true,{expectedVersionId:'stale'})).status,409);assert.equal((await decide(a,true,{requestDigest:'0'.repeat(64)})).status,409);assert.equal(fs.existsSync(effect),false);
 const replies=await Promise.all([decide(a,true),decide(a,true)]);assert.deepEqual(replies.map(r=>r.status),[202,202]);assert.equal(replies[0].body.approvals[0].status,'approved');assert.equal((await decide(a,false)).status,409);
 for(let n=0;n<120;n++){const r=(await call(`/api/workflow/executions/${runId}`)).body.execution;if(r.finished){assert.equal(r.status,'finished');break;}await new Promise(r=>setTimeout(r,250));}assert.equal(fs.readFileSync(effect,'utf8'),'approved-effect\n');
 const deniedId=await start(),denied=(await approvals(deniedId)).approvals[0];assert.equal((await decide(denied,false)).status,202);assert.equal((await decide(denied,true)).status,409);assert.equal(fs.readFileSync(effect,'utf8'),'approved-effect\n');
 const cancelledId=await start(),cancelled=(await approvals(cancelledId)).approvals[0];assert.equal((await call(`/api/workflow/executions/${cancelledId}/cancel`,{})).status,202);assert.equal((await decide(cancelled,true)).status,409);assert.equal(fs.readFileSync(effect,'utf8'),'approved-effect\n');
 host.write('approval-fixture.json',{workflowId,versionId,runId,a,dir,effect,pid:host.read<HostProcess>('process.json').pid} satisfies ApprovalFixture);
 Object.assign(result,{workflowId,runId,unauthenticated401:true,noEffectBeforeApproval:true,staleVersionAndDigest409:true,concurrentSameDecisionIdempotent:true,conflictingDecision409:true,denialNoEffect:true,cancelledNoEffect:true,exactlyOneSyntheticEffect:true,passed:true});
}catch(e){result.error=e instanceof Error ? e.message : String(e);}
writeHostReport('test-results/workflow-approvals', 'real-host.json', result);
