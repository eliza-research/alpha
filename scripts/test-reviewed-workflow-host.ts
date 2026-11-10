import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { workflowHost, writeHostReport, type HostProcess, type HostReport } from './fixtures/workflow-host.ts';
const host = workflowHost(47848, 'local-reviewed-workflows');
const {call} = host;
type SubmissionFixture = { workflowId: string; submissionId: string; runId: string; versionId: string; pidBefore: number };
const result: HostReport = {scope:'Real paired isolated app host47848 durable reviewed workflow admission; no phone/UI claim',testedAt:new Date().toISOString(),passed:false};
try{
 if(process.argv.includes('--restore')){host.restore();const saved=host.read<SubmissionFixture>('submission-fixture.json');const pid=host.read<HostProcess>('process.json').pid;assert.notEqual(pid,saved.pidBefore);assert.equal(typeof saved.pidBefore,'number');const response=await call(`/api/workflow/workflows/${saved.workflowId}/submissions/${saved.submissionId}`);assert.equal(response.status,200);assert.equal(response.body.execution?.id,saved.runId);result.afterProcessRestart=true;result.pidBefore=saved.pidBefore;result.pidAfter=pid;result.runId=saved.runId;result.sameRunId=true;result.passed=true;}else{
 const who = await host.pair();
 assert.equal(who.role,'OWNER');
 assert.equal(await host.unauthenticatedStatus(),401);
 assert.equal((await call('/api/workflow/status')).body.manualSubmissionProtocol,1);
 const source=`/** @jsxImportSource smthrs */\nimport {createSmithers} from "smthrs/create";\nimport {z} from "zod";\nconst {Workflow,Task,smithers,outputs}=createSmithers({answer:z.object({value:z.number()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});\nexport default smithers(()=><Workflow name="alpha-reviewed-arithmetic"><Task id="answer" output={outputs.answer}>{{value:7*8}}</Task></Workflow>);`;
 const created=await call('/api/workflow/workflows',{workflow:{name:'Alpha reviewed arithmetic '+Date.now(),source,language:'tsx',steps:[{id:'answer',label:'Arithmetic 7 x 8',kind:'task'}]},activate:false});assert.equal(created.status,201);const workflowId=created.body.id;const detail=(await call(`/api/workflow/workflows/${workflowId}`)).body;const submissionId=crypto.randomUUID(),body={submissionId,expectedVersionId:detail.versionId,input:{}};
 const responses=await Promise.all(Array.from({length:8},()=>call(`/api/workflow/workflows/${workflowId}/run`,body)));if(!responses.every(r=>r.status===202)){result.submissionStatuses=responses.map(r=>r.status);throw Error("Admission failed");}assert.equal(new Set(responses.map(r=>r.body.execution.id)).size,1);const runId=responses[0].body.execution.id;
 assert.equal((await call(`/api/workflow/workflows/${workflowId}/run`,{...body,input:{changed:true}})).status,409);
 const refusedId=crypto.randomUUID(),refused=await call(`/api/workflow/workflows/${workflowId}/run`,{...body,submissionId:refusedId,expectedVersionId:'stale'});assert.equal(refused.status,409);assert.equal(refused.body.code,'WORKFLOW_VERSION_NOT_ADMITTED');assert.equal(refused.body.workflowId,workflowId);assert.equal(refused.body.submissionId,refusedId);assert.equal(refused.body.expectedVersionId,'stale');assert.equal((await call(`/api/workflow/workflows/${workflowId}/submissions/${refusedId}`)).body.execution,null);result.typedNonAdmissionVerified=true;
 assert.equal((await call(`/api/workflow/workflows/${workflowId}/submissions/${submissionId}`)).body.execution?.id,runId);
 let receipt;for(let n=0;n<120;n++){receipt=(await call(`/api/workflow/executions/${runId}`)).body.execution;if(receipt.finished)break;await new Promise(r=>setTimeout(r,500));}
 assert.ok(receipt, 'Expected an execution receipt');
 result.status=receipt.status;result.output=receipt.output;assert.equal(receipt.status,'finished');assert.equal(receipt.finished,true);
 const history=(await call(`/api/workflow/workflows/${workflowId}/executions`)).body.executions;assert.equal(history.length,1);
 const saved={workflowId,submissionId,runId,versionId:detail.versionId,pidBefore:host.read<HostProcess>('process.json').pid};host.write('submission-fixture.json',saved);Object.assign(result,{...saved,concurrentRequests:8,executionCount:1,unauthenticatedStatus:401,requestConflictStatus:409,staleVersionStatus:409,passed:true});
 }
}catch(e){result.error=e instanceof Error ? e.message : String(e);}
writeHostReport('test-results/workflow-submissions', process.argv.includes('--restore') ? 'real-restart.json' : 'real-host.json', result);
