import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// npm test starts each .mjs without a TypeScript loader; mirror owning runtime tests.
if(!process.versions.bun&&!process.execArgv.some(value=>value==='tsx'||value==='--import=tsx')){
 const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});
 if(child.error)throw child.error;process.exit(child.status??1);
}
const {workflowRendererFixture}=await import('../scripts/workflow-renderer-fixture.mjs');
const {WorkflowProtocol,WorkflowHttpError,WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected}=await import('../apps/app/src/runtime/workflow-protocol.ts');
const {resolveWorkflowTap,readyTapStep,tapRecheck}=await import('../apps/app/src/runtime/workflow-device-contract.ts');

// A removal or restore recorded on the phone but never received by the agent: the app stopped between the record and
// the send, or the request was lost. The agent holds no receipt and the workflow keeps the version the request names.
const source=fs.readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.install=installWorkflowAdapter;';
const session={sessionId:'session',origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'};
const mutationId='22222222-2222-4222-8222-222222222222';
const lifecycleSlot=()=>'alpha.workflow.pending.v1:'+JSON.stringify([session.origin,session.ownerId,session.agentId,'flow'])+':lifecycle';
const retained=(operation='remove')=>({[lifecycleSlot()]:JSON.stringify({mutationId,versionId:'v1',operation,intentRevision:'r'})});

/** The real adapter over a synthetic agent that applies a mutation ID at most once, for the version it names. */
function adapterFixture(options={}){
 const storage=options.storage||{},toasts=[],sent=[];
 const agent={versionId:options.versionId||'v1',removed:!!options.removed,receipts:new Map(),applications:0,ongoing:!!options.ongoing};
 const workflow=()=>({id:'flow',name:'Digest',description:'Reads notes',versionId:agent.versionId,active:false,removed:agent.removed,triggerCleanup:agent.removed?'complete':undefined,steps:[{label:'Read',description:'Read notes'}]});
 const client={
  lifecycleSupported:async()=>true,supportsSubmissionReconciliation:async()=>true,
  list:async()=>agent.removed?[]:[workflow()],removedWorkflows:async()=>agent.removed?[workflow()]:[],
  detail:async()=>workflow(),executions:async()=>[],approvals:async()=>null,phoneReview:async()=>({steps:[]}),reconcile:async()=>null,
  reconcileLifecycle:async(_id,_version,mutation)=>agent.receipts.get(mutation)??null,
  lifecycle:async()=>{throw Error('A retained change must never be sent under a new identity');},
  resendLifecycle:async(id,version,mutation,operation)=>{
   sent.push({id,version,mutation,operation});
   if(options.lost)throw Error('offline');
   const held=agent.receipts.get(mutation);if(held)return held;
   if(agent.versionId!==version||agent.ongoing){
    // The earlier copy of the same request arrives once the run has ended, just after this one was refused.
    if(options.appliesAfterRefusal){agent.ongoing=false;apply(id,version,mutation,operation);}
    throw new WorkflowLifecycleRejected();
   }
   return apply(id,version,mutation,operation);
  },
 };
 const apply=(id,version,mutation,operation)=>{
   const receipt={mutationId:mutation,workflowId:id,previousVersionId:version,versionId:'v2',operation,appliedAt:'2026-01-01T00:00:00.000Z'};
   agent.versionId='v2';agent.removed=operation==='remove';agent.applications++;agent.receipts.set(mutation,receipt);return receipt;
 };
 const localStorage=new Proxy({getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 let view='workflows';
 class Shell{live=true;renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}componentDidUpdate(){}S(){return {view};}vset(){}vget(){return {};}api(){return api;}openView(next){view=next;}toast(message){toasts.push(message);}}
 const api={isActive:()=>true,track:()=>'',kx:()=>0,toast:message=>toasts.push(message),ic:{clock:'',check:''}};
 const views={workflows:{automationsManaged:true}};
 const controller={getWorkflowClient:()=>({sessionId:session.sessionId,scope:'scope',client}),getSnapshot:()=>({session,open:false,busy:false,startupResolved:true}),subscribe:()=>()=>{},open(){},workflowNoticeActions:async()=>[],getWorkflowDeviceTarget:()=>null};
 const context=workflowRendererFixture({WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,resolveWorkflowTap,readyTapStep,tapRecheck,
  Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android'},connectionController:controller,localStorage,queueMicrotask,AbortController,Date,console});
 // Native plugins stay inert: notices and taps are not part of these cases.
 context.registerPlugin=()=>new Proxy({},{get:(_target,name)=>name==='addListener'?async()=>({remove(){}}):async()=>({})});
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 context.install(Shell,views);const shell=new Shell();shell.componentDidMount();
 return {render:()=>views.workflows.render({},api),back:()=>views.workflows.back(),toasts,sent,storage,agent,close:()=>shell.componentWillUnmount()};
}
const wait=async(fn,label='Workflow adapter did not settle.')=>{for(let count=0;count<400;count++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(label);};
const opened=async app=>{app.render().openWorkflow('flow');await wait(()=>app.render().detail&&app.render().fd.notRunning!==undefined&&!app.render().fd.isRunning);};

test('a removal the agent never received is sent again under its original identity after a second tap',async()=>{
 const app=adapterFixture({storage:retained()});
 try{
  await opened(app);
  assert.match(app.toasts.at(-1),/no record of your earlier removal or restore/);
  assert.match(app.render().fd.last,/The workflow action sends that same request again/);
  assert.equal(Object.keys(app.storage).length,1);
  // The first tap only reviews: nothing is sent and the request stays retained.
  app.render().fd.del();
  assert.match(app.toasts.at(-1),/Tap the workflow action again to send that same request once more/);
  assert.match(app.render().fd.last,/It can only apply once/);
  assert.deepEqual(app.sent,[]);assert.equal(Object.keys(app.storage).length,1);
  app.render().fd.del();await wait(()=>Object.keys(app.storage).length===0&&!app.render().fd.isRunning);
  assert.deepEqual(app.sent,[{id:'flow',version:'v1',mutation:mutationId,operation:'remove'}]);
  assert.equal(app.agent.applications,1);assert.equal(app.agent.removed,true);
  assert.equal(app.render().fd.deleteLabel,'Restore workflow');
  assert.match(app.toasts.at(-1),/removed under your original request/);
 }finally{app.close();}
});

test('leaving the resend review sends nothing and keeps the request retained',async()=>{
 const app=adapterFixture({storage:retained()});
 try{
  await opened(app);
  app.render().fd.del();assert.match(app.render().fd.last,/It can only apply once/);
  assert.equal(app.back(),true);assert.match(app.render().fd.last,/The workflow action sends that same request again/);assert.equal(app.render().detail,true);
  assert.deepEqual(app.sent,[]);assert.equal(Object.keys(app.storage).length,1);
 }finally{app.close();}
});

test('a resend refused while the workflow keeps its version stays retained and can be sent again',async()=>{
 const app=adapterFixture({storage:retained(),ongoing:true});
 try{
  await opened(app);
  app.render().fd.del();app.render().fd.del();
  await wait(()=>app.sent.length===1&&!app.render().fd.isRunning);
  assert.equal(app.agent.applications,0);assert.match(app.toasts.at(-1),/was not applied/);
  // An earlier copy of the request could still arrive, so the change stays blocked and the same request is offered again.
  assert.equal(Object.keys(app.storage).length,1);
  assert.match(app.render().fd.last,/The workflow action sends that same request again/);
  app.agent.ongoing=false;
  app.render().fd.del();app.render().fd.del();
  await wait(()=>Object.keys(app.storage).length===0&&!app.render().fd.isRunning);
  assert.equal(app.sent.length,2);assert.equal(app.sent[1].mutation,mutationId);
  assert.equal(app.agent.applications,1);assert.equal(app.agent.removed,true);
 }finally{app.close();}
});

test('a resend refused because the workflow changed is released as a known non-change',async()=>{
 const app=adapterFixture({storage:retained()});
 try{
  await opened(app);
  app.render().fd.del();app.agent.versionId='v5';app.render().fd.del();
  await wait(()=>Object.keys(app.storage).length===0&&!app.render().fd.isRunning);
  assert.equal(app.sent.length,1);assert.equal(app.agent.applications,0);assert.equal(app.agent.removed,false);
  assert.match(app.toasts.at(-1),/was not applied/);
  assert.equal(app.render().fd.deleteLabel,'Remove workflow');
  assert.match(app.render().fd.last,/Paused on this agent/);
 }finally{app.close();}
});

test('a refused resend whose earlier copy was applied meanwhile is released as applied',async()=>{
 const app=adapterFixture({storage:retained(),ongoing:true,appliesAfterRefusal:true});
 try{
  await opened(app);
  app.render().fd.del();app.render().fd.del();
  await wait(()=>Object.keys(app.storage).length===0&&!app.render().fd.isRunning);
  assert.equal(app.agent.applications,1);assert.equal(app.render().fd.deleteLabel,'Restore workflow');
  assert.match(app.toasts.at(-1),/removed under your original request/);
 }finally{app.close();}
});

test('a resend with no answer stays retained and is offered again only after the receipt is read',async()=>{
 const app=adapterFixture({storage:retained(),lost:true});
 try{
  await opened(app);
  app.render().fd.del();app.render().fd.del();
  await wait(()=>app.sent.length===1&&!app.render().fd.isRunning);
  assert.equal(Object.keys(app.storage).length,1);assert.equal(app.agent.applications,0);
  assert.match(app.render().fd.last,/outcome unknown — tap the workflow action to refresh its receipt/);
  // The next tap reads the receipt; it does not send.
  app.render().fd.del();await wait(()=>/sends that same request again/.test(app.render().fd.last));
  assert.equal(app.sent.length,1);
 }finally{app.close();}
});

test('a retained change whose version is no longer current is released without an offer to resend',async()=>{
 const app=adapterFixture({storage:retained(),versionId:'v9'});
 try{
  await opened(app);
  assert.equal(Object.keys(app.storage).length,0);assert.match(app.toasts.at(-1),/Nothing changed/);
  assert.deepEqual(app.sent,[]);
 }finally{app.close();}
});

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
