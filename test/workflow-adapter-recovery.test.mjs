import test from 'node:test';
import assert from 'node:assert/strict';
const {WorkflowProtocol}=await import('../apps/app/src/runtime/workflow-protocol.ts');
const {readyTapStep,tapRecheck}=await import('../apps/app/src/runtime/workflow-device-contract.ts');
const {runIntentReconcilable}=await import('../apps/app/src/runtime/workflow-intents.ts');

test('a retained request is matchable only with reconciliation and a submission identity for this workflow',()=>{
 const reconcilable=runIntentReconcilable;
 const intent={workflowId:'flow',versionId:'v1',submissionId:'s'};
 assert.equal(reconcilable(intent,'flow',true),true);
 assert.equal(reconcilable(intent,'flow',false),false);
 assert.equal(reconcilable({workflowId:'flow',versionId:'v1'},'flow',true),false);
 assert.equal(reconcilable({...intent,workflowId:'other'},'flow',true),false);
 assert.equal(reconcilable({...intent,versionId:1},'flow',true),false);
 assert.equal(reconcilable(null,'flow',true),false);
 assert.equal(reconcilable('text','flow',true),false);
});

test('tap decisions',()=>{
 const tapStep=readyTapStep,recheck=tapRecheck;
 assert.equal(tapStep('a',null),'open');assert.equal(tapStep('a','b'),'open');assert.equal(tapStep('a','a'),'consume-only');
 assert.equal(recheck({operationRunning:true,generationChanged:true}),'after-operation');
 assert.equal(recheck({operationRunning:true,generationChanged:false}),'after-operation');
 assert.equal(recheck({operationRunning:false,generationChanged:true}),'now');
 assert.equal(recheck({operationRunning:false,generationChanged:false}),'none');
});

for(const reconciliation of [false,true])test(`a run of a version other than the reviewed one is reported ${reconciliation?'with':'without'} submission identities`,async()=>{
 let ran='v1',posts=0;
 const remote={id:'flow',name:'Flow',description:'',versionId:'v1',active:true,steps:[]};
 const client=new WorkflowProtocol(async(path,body)=>{
  if(path.endsWith('/status'))return {engine:'smthrs',status:'ready',...(reconciliation?{manualSubmissionProtocol:1}:{})};
  if(path.endsWith('/run')){posts++;return {...(body.submissionId?{submissionId:body.submissionId}:{}),execution:{id:'run',workflowId:'flow',workflowVersionId:ran,events:[],status:'queued',finished:false,startedAt:new Date().toISOString()}};}
  return remote;
 });
 const signal=new AbortController().signal;
 assert.equal((await client.run('flow','v1',signal)).versionId,'v1');
 ran='v2';
 await assert.rejects(client.run('flow','v1',signal),/reviewed version changed/);
 assert.equal(posts,2);
});
