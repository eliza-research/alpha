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
const {workflowRendererFixture}=await import('../scripts/workflow-renderer-fixture.ts');
const {WorkflowProtocol,WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected}=await import('../apps/app/src/runtime/workflow-protocol.ts');
const {resolveWorkflowTap,readyTapStep,tapRecheck}=await import('../apps/app/src/runtime/workflow-device-contract.ts');
const {runIntentReconcilable}=await import('../apps/app/src/runtime/workflow-intents.ts');

// The real adapter in the shared renderer fixture, as an Android shell with a synthetic agent and notification plugin.
const source=fs.readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.install=installWorkflowAdapter;';
const session={sessionId:'session',origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'};
const workflow={id:'flow',name:'Digest',description:'Reads notes',versionId:'v1',active:true,removed:false,steps:[{label:'Read',description:'Read notes'}]};
const execution={id:'run',workflowId:'flow',versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]};
const tap={token:'tap-1',operationId:'op',bindingHash:'hash',scope:'scope',origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,workflowId:'flow',runId:'run',versionId:'v1',retained:true};

function adapterFixture(options={}){
 const storage=options.storage||{},toasts=[],calls={run:0,consume:0,detail:0,receipt:0,list:0},listeners=new Set(),tapListeners=new Set();
 let view=options.view??'settings',pendingTap=options.tap?{...options.tap}:null,consumeFailures=options.consumeFailures||0;
 const gate=options.gate;
 const client={
  lifecycleSupported:async()=>false,supportsSubmissionReconciliation:async()=>!!options.reconciliation,
  list:async()=>{calls.list++;await gate?.list;return [workflow];},removedWorkflows:async()=>[],
  detail:async()=>{calls.detail++;return {...workflow};},executions:async()=>[],
  receipt:async()=>{calls.receipt++;await gate?.receipt;return {...execution};},approvals:async()=>null,
  phoneReview:async()=>({steps:[]}),reconcile:async()=>null,
  run:async(id,version,signal,beforeSubmit)=>{await beforeSubmit?.(undefined);calls.run++;return {...execution,id:'run-'+calls.run};},
 };
 const native={
  pendingWorkflowTap:async()=>pendingTap?{...pendingTap}:{},
  consumeWorkflowTap:async()=>{calls.consume++;if(consumeFailures>0){consumeFailures--;throw Error('Native consume failed');}pendingTap=null;},
  addListener:async(_event,listener)=>{tapListeners.add(listener);return {remove(){tapListeners.delete(listener);}};},
 };
 const localStorage=new Proxy({getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 class Shell{live=true;renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}componentDidUpdate(){}S(){return {view};}vset(){}vget(){return {};}api(){return api;}openView(next){view=next;}toast(message){toasts.push(message);}}
 const api={isActive:()=>true,track:()=>'',kx:()=>0,toast:message=>toasts.push(message),ic:{clock:'',check:''}};
 const views={workflows:{automationsManaged:true}};
 const controller={getWorkflowClient:()=>({sessionId:session.sessionId,scope:'scope',client}),getSnapshot:()=>({session,open:false,busy:false,startupResolved:true}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},open(){},workflowNoticeActions:async()=>[],getWorkflowDeviceTarget:()=>null};
 const context=workflowRendererFixture({WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,resolveWorkflowTap,readyTapStep,tapRecheck,
  Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android'},connectionController:controller,localStorage,queueMicrotask,AbortController,Date,console});
 // Every other native plugin stays inert: approval notices are not part of these cases.
 context.registerPlugin=name=>name==='AlphaNotifications'?native:new Proxy({},{get:()=>async()=>({})});
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 context.install(Shell,views);const shell=new Shell();shell.componentDidMount();
 return {render:()=>views.workflows.render({},api),toasts,calls,storage,context,close:()=>shell.componentWillUnmount(),tapEvent:()=>{for(const listener of tapListeners)listener();},get view(){return view;},get pendingTap(){return pendingTap;}};
}
const wait=async(fn,label='Workflow adapter did not settle.')=>{for(let count=0;count<400;count++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(label);};
const key=()=>'alpha.workflow.pending.v1:'+JSON.stringify([session.origin,session.ownerId,session.agentId,'flow']);

test('a run request without a submission identity is cleared only by its owner, and clearing starts nothing',async()=>{
 const storage={[key()]:JSON.stringify({workflowId:'flow',versionId:'v1',submittedAt:1,intentRevision:'r'})};
 const app=adapterFixture({storage,view:'workflows'});
 try{
  app.render().openWorkflow('flow');await wait(()=>app.render().detail);
  assert.match(app.render().fd.last,/Check runs · Clear request/);
  app.render().fd.run();
  assert.match(app.toasts.at(-1),/can’t check whether your earlier run started/);
  assert.equal(Object.keys(storage).length,1);assert.match(app.render().fd.last,/Tap Run now again to clear/);
  app.render().fd.run();await wait(()=>Object.keys(storage).length===0&&app.render().fd.notRunning);
  assert.match(app.toasts.at(-1),/Earlier run request cleared\. Nothing was sent/);assert.equal(app.calls.run,0);
  // A new run still needs its own review.
  app.render().fd.run();assert.equal(app.calls.run,0);assert.match(app.render().fd.last,/Tap Run now again to start it/);
  app.render().fd.run();await wait(()=>app.calls.run===1&&app.render().fd.notRunning);
 }finally{app.close();}
});

test('a request the agent can match is never offered for clearing',async()=>{
 const storage={[key()]:JSON.stringify({workflowId:'flow',versionId:'v1',submissionId:'11111111-1111-4111-8111-111111111111',submittedAt:1,intentRevision:'r'})};
 const app=adapterFixture({storage,view:'workflows',reconciliation:true});
 try{
  app.render().openWorkflow('flow');await wait(()=>app.render().detail);
  assert.match(app.render().fd.last,/Not received/);
  assert.equal(Object.keys(storage).length,1);
 }finally{app.close();}
});

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

test('a tapped run opens with its pending requests loaded instead of reading as an unknown outcome',async()=>{
 const app=adapterFixture({tap,view:'settings'});
 try{
  await wait(()=>app.render().runOpen,'The tapped run did not open.');
  assert.equal(app.view,'workflows');assert.equal(app.pendingTap,null);
  await wait(()=>!/outcome unknown/i.test(app.render().fd.last),'The opened workflow still reads as an unknown outcome.');
  assert.match(app.render().fd.last,/On/);
 }finally{app.close();}
});

test('a tap that arrives while a refresh is running is opened when the refresh ends',async()=>{
 let releaseList;const gate={list:new Promise(resolve=>{releaseList=resolve;})};
 // On Home the mount starts a tap check and then a refresh; the refresh moves the view on while the tap is read.
 const app=adapterFixture({tap,view:'',gate});
 try{
  await wait(()=>app.calls.list===1);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(app.view,'');assert.notEqual(app.pendingTap,null);assert.deepEqual(app.toasts,[]);
  releaseList();
  await wait(()=>app.view==='workflows'&&app.pendingTap===null,'The deferred tap was dropped.');
  assert.equal(app.render().runOpen,true);assert.equal(app.calls.consume,1);
 }finally{releaseList?.();app.close();}
});

test('a tap whose consume failed is consumed again without reopening its run',async()=>{
 const app=adapterFixture({tap,view:'settings',consumeFailures:1});
 try{
  await wait(()=>app.render().runOpen&&app.calls.consume===1);
  assert.notEqual(app.pendingTap,null);
  app.render().r.close();assert.equal(app.render().runOpen,false);
  app.tapEvent();await wait(()=>app.calls.consume===2&&app.pendingTap===null);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(app.render().runOpen,false);
 }finally{app.close();}
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
