import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('unavailable initial workflow tap lookup establishes no retained tap and preserves later validation',()=>{
 const script=`
 import assert from 'node:assert/strict';
 import {resolveWorkflowTap} from './apps/app/src/runtime/workflow-notice-taps.ts';
 const route={scope:'a'.repeat(64),origin:'https://agent.invalid',ownerId:'owner',agentId:'agent',workflowId:'flow',runId:'run',versionId:'v1'};
 const tap={...route,token:'tap',operationId:'operation',bindingHash:'b'.repeat(64),retained:true};
 let unavailable=true,reads=0,consumed=0,pendingReads=0;
 const native={pendingWorkflowTap:async()=>{pendingReads++;if(unavailable)throw Error('Activity inactive');return tap;},consumeWorkflowTap:async()=>{consumed++;}};
 const binding={...route,current:()=>true,receipt:async()=>{reads++;return {id:'run',workflowId:'flow',versionId:'v1'};},detail:async()=>{reads++;return {id:'flow',versionId:'v1'};}};
 assert.equal((await resolveWorkflowTap(native,binding,new AbortController().signal)).kind,'lookup-unavailable');
 assert.equal(pendingReads,1);assert.equal(reads,0);assert.equal(consumed,0);
 const abort=new AbortController();abort.abort();
 await assert.rejects(()=>resolveWorkflowTap(native,binding,abort.signal),{name:'AbortError'});
 unavailable=false;
 assert.equal((await resolveWorkflowTap(native,binding,new AbortController().signal)).kind,'ready');
 assert.equal(reads,2);assert.equal(consumed,0);
 binding.receipt=async()=>{throw Error('Agent offline');};
 await assert.rejects(()=>resolveWorkflowTap(native,binding,new AbortController().signal),/Agent offline/);
 binding.receipt=async()=>({id:'run',workflowId:'flow',versionId:'different'});
 assert.equal((await resolveWorkflowTap(native,binding,new AbortController().signal)).kind,'unavailable');
 binding.receipt=async()=>({id:'run',workflowId:'flow',versionId:'v1'});
 let checks=0;native.pendingWorkflowTap=async()=>{if(++checks===2)throw Error('Queue recheck unavailable');return tap;};
 await assert.rejects(()=>resolveWorkflowTap(native,binding,new AbortController().signal),/Queue recheck unavailable/);
 assert.equal(consumed,0);
 console.log('PASS');`;
 assert.match(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'}),/PASS/);
});
test('owner return requires current workflow revision, pending exact proposal, expiry and stable session',()=>{
 const script=`
 import assert from 'node:assert/strict';
 import {revalidateWorkflowApprovalNotice} from './.eliza/client-features/packages/contracts/src/notice-routes.ts';
 // The adapter's binding of the shared revalidation to the workflow client and phone actions.
 const check=(notice,client,actions,valid,signal,now)=>revalidateWorkflowApprovalNotice(notice,{detail:client.detail,receipt:client.receipt,phoneReview:client.phoneReview,pending:actions},valid,signal,now);
 import {workflowApprovalNotice} from './apps/app/src/runtime/workflow-device-contract.ts';
 const route={scope:'a'.repeat(64),origin:'https://agent.invalid',ownerId:'owner',agentId:'agent',workflowId:'flow',runId:'run',versionId:'v1'};
 const bound=await workflowApprovalNotice(route,'proposal'),notice={...bound,route,expiresAt:200};
 function fixture(){let live=true;return {valid:()=>live,stop:()=>live=false,client:{detail:async()=>({versionId:'v1'}),receipt:async()=>({id:'run',workflowId:'flow',versionId:'v1',finished:false}),phoneReview:async()=>({finished:false,cancellationRequestedAt:null})},actions:async()=>[{id:'proposal',expiresAt:200}]};}
 const run=(f,n=notice)=>check(n,f.client,f.actions,f.valid,new AbortController().signal,()=>100);
 assert.equal(await run(fixture()),'resume');
 for(const change of [f=>f.client.detail=async()=>({versionId:'v2'}),f=>f.client.detail=async()=>({versionId:'v1',removed:true}),f=>f.client.receipt=async()=>({versionId:'v2'}),f=>f.client.receipt=async()=>({versionId:'v1',finished:true}),f=>f.client.phoneReview=async()=>({cancellationRequestedAt:'now'}),f=>f.actions=async()=>[],f=>f.actions=async()=>[{id:'different',expiresAt:200}],f=>f.actions=async()=>[{id:'proposal',expiresAt:201}]]){const f=fixture();change(f);assert.equal(await run(f),'withdraw');}
 assert.equal(await run(fixture(),{...notice,expiresAt:99}),'withdraw');
 assert.equal(await run(fixture(),{...notice,bindingHash:'b'.repeat(64)}),'withdraw');
 const stale=fixture();stale.client.detail=async()=>{stale.stop();return {versionId:'v1'}};assert.equal(await run(stale),'stale');
 const offline=fixture();offline.client.detail=async()=>{throw Error('offline')};await assert.rejects(()=>run(offline),/offline/);
 console.log('PASS');`;
 assert.match(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'}),/PASS/);
});
