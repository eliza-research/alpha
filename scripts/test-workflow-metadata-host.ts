/** Actual isolated47854 owner metadata CAS; no run/schedule/model calls. */
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import type { RemoteWorkflow, WorkflowMetadataReceipt } from '../apps/app/src/runtime/workflow-protocol.ts';
import { workflowHost, writeHostReport, type HostProcess, type HostReport } from './fixtures/workflow-host.ts';
const host = workflowHost(47854, 'local-workflow-approvals', { forwardedFor: true });
const {call} = host;
host.restore();
const restore = process.argv.includes('--restore');
type MetadataFixture = { workflowId: string; mutationId: string; receipt: WorkflowMetadataReceipt; pid: number };
const result: HostReport = {testedAt:new Date().toISOString(),scope:'Actual isolated47854 metadata-only durable mutation, no execution or model calls',passed:false};
try{assert.equal((await call('/api/workflow/status')).body.metadataMutationProtocol,1);if(restore){const saved=host.read<MetadataFixture>('metadata-fixture.json'),pid=host.read<HostProcess>('process.json').pid;assert.notEqual(pid,saved.pid);const resolved=await call(`/api/workflow/workflows/${saved.workflowId}/metadata-mutations/${saved.mutationId}`);assert.deepEqual(resolved.body.receipt,saved.receipt);assert.equal((await call(`/api/workflow/workflows/${saved.workflowId}/executions`)).body.executions.length,0);Object.assign(result,{changedPid:true,exactReceiptAfterRestart:true,zeroExecutions:true,passed:true});}else{
 const source=`import {createSmithers} from 'smthrs/create';const api=createSmithers({}, {dbPath:process.env.ELIZA_SMTHRS_DB_PATH});export default api.smithers(()=>api.Workflow({name:'Inactive metadata fixture'}));`;
 const made=await call('/api/workflow/workflows',{workflow:{name:'Alpha metadata '+Date.now(),description:'Original description',source,language:'typescript',steps:[]},activate:false});assert.equal(made.status,201);const workflowId=made.body.id,before=(await call(`/api/workflow/workflows/${workflowId}`)).body,mutationId=crypto.randomUUID(),body={mutationId,expectedVersionId:before.versionId,name:'Edited '+before.name,description:'Metadata-only synthetic description'};
 const responses=await Promise.all(Array.from({length:8},()=>call(`/api/workflow/workflows/${workflowId}/metadata`,body)));assert.ok(responses.every(r=>r.status===200));assert.equal(new Set(responses.map(r=>r.body.receipt.versionId)).size,1);const receipt=responses[0].body.receipt;
 assert.equal((await call(`/api/workflow/workflows/${workflowId}/metadata`,{...body,description:'Conflict'})).status,409);const stale=await call(`/api/workflow/workflows/${workflowId}/metadata`,{...body,mutationId:crypto.randomUUID()});assert.equal(stale.status,409);assert.equal(stale.body.code,'WORKFLOW_METADATA_NOT_APPLIED');assert.equal((await call(`/api/workflow/workflows/${workflowId}/metadata`,{...body,source:'forbidden'})).status,400);
 const after=(await call(`/api/workflow/workflows/${workflowId}`)).body;const omit=(o: RemoteWorkflow)=>Object.fromEntries(Object.entries(o).filter(([k])=>!['name','description','versionId','updatedAt'].includes(k)));assert.deepEqual(omit(after),omit(before));assert.equal(after.versionId,receipt.versionId);assert.equal((await call(`/api/workflow/workflows/${workflowId}/executions`)).body.executions.length,0);assert.equal((await call(`/api/workflow/workflows/${workflowId}/revisions`)).body.revisions.length,1);
 host.write('metadata-fixture.json',{workflowId,mutationId,receipt,pid:host.read<HostProcess>('process.json').pid} satisfies MetadataFixture);Object.assign(result,{workflowId,concurrentRequests:8,oneVersion:true,oneRevision:true,sourceAndOtherFieldsUnchanged:true,zeroExecutions:true,staleRefusal409:true,conflictingMutation409:true,sourceFieldRejected400:true,passed:true});
 }}catch(e){result.error=e instanceof Error ? e.message : String(e);}
writeHostReport('test-results/workflow-metadata', restore ? 'real-restart.json' : 'real-host.json', result);
