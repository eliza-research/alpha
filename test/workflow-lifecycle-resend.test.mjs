import test from 'node:test';
import assert from 'node:assert/strict';
const {WorkflowProtocol,WorkflowHttpError,WorkflowLifecycleRejected}=await import('../apps/app/src/runtime/workflow-protocol.ts');

const mutationId='22222222-2222-4222-8222-222222222222';

/** A synthetic agent behind the real route client. */
function agentRoutes(options={}){
 const agent={versionId:'v1',receipts:new Map(),posts:[],applications:0};
 const request=async(path,body)=>{
  if(path.endsWith('/status'))return {engine:'smthrs',status:'ready',lifecycleMutationProtocol:1};
  const read=/\/lifecycle-mutations\/([0-9a-f-]+)$/.exec(path);
  if(read)return {mutationId:read[1],receipt:agent.receipts.get(read[1])??null};
  if(path.endsWith('/lifecycle')){
   agent.posts.push(body);
   const held=agent.receipts.get(body.mutationId);if(held)return {mutationId:body.mutationId,receipt:held};
   if(options.refuse||agent.versionId!==body.expectedVersionId)throw new WorkflowHttpError(409,{code:'WORKFLOW_LIFECYCLE_NOT_APPLIED',workflowId:'flow',mutationId:body.mutationId,expectedVersionId:body.expectedVersionId});
   const receipt={mutationId:body.mutationId,workflowId:'flow',previousVersionId:body.expectedVersionId,versionId:'v2',operation:body.operation,appliedAt:'2026-01-01T00:00:00.000Z'};
   agent.versionId='v2';agent.applications++;agent.receipts.set(body.mutationId,receipt);return {mutationId:body.mutationId,receipt};
  }
  throw Error('Unexpected route '+path);
 };
 return {agent,client:new WorkflowProtocol(request)};
}

test('the route client resends one lifecycle change under its identity and applies it at most once',async()=>{
 const {agent,client}=agentRoutes(),signal=new AbortController().signal;
 const receipt=await client.resendLifecycle('flow','v1',mutationId,'remove',signal);
 assert.deepEqual(agent.posts,[{mutationId,expectedVersionId:'v1',operation:'remove'}]);
 assert.equal(receipt.versionId,'v2');assert.equal(receipt.mutationId,mutationId);
 // A change the agent already holds a receipt for is answered from the receipt: nothing is posted again.
 assert.deepEqual(await client.resendLifecycle('flow','v1',mutationId,'remove',signal),receipt);
 assert.equal(agent.posts.length,1);assert.equal(agent.applications,1);
});

test('the route client reports a refused resend as not applied and rejects an unusable identity before sending',async()=>{
 const {agent,client}=agentRoutes({refuse:true}),signal=new AbortController().signal;
 await assert.rejects(client.resendLifecycle('flow','v1',mutationId,'restore',signal),WorkflowLifecycleRejected);
 assert.equal(agent.posts.length,1);assert.equal(agent.applications,0);
 await assert.rejects(client.resendLifecycle('flow','v1','not-a-uuid','remove',signal),/Invalid lifecycle reconciliation/);
 await assert.rejects(client.resendLifecycle('flow','v1',mutationId,'erase',signal),/Invalid lifecycle reconciliation/);
 assert.equal(agent.posts.length,1);
});
