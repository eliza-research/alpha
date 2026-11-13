import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const {workflowRendererFixture}=await import('../scripts/workflow-renderer-fixture.ts');
const {WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected}=await import('../apps/app/src/runtime/workflow-protocol.ts');
const {resolveWorkflowTap,readyTapStep,tapRecheck}=await import('../apps/app/src/runtime/workflow-device-contract.ts');

// The real adapter over a synthetic agent. The agent authenticates the connection, not the signed-in account, so it
// lists every run of the connection to whichever account is signed in.
const source=fs.readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.install=installWorkflowAdapter;';
const session={sessionId:'session',origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'};
const workflow={id:'flow',name:'Digest',description:'Reads notes',versionId:'v1',active:true,removed:false,steps:[{label:'Read',description:'Read notes'}]};
const LEDGER='alpha.workflow.run-accounts.v1';
const accountKey=user=>JSON.stringify(['production',user]);
const pendingKey=()=>'alpha.workflow.pending.v1:'+JSON.stringify([session.origin,session.ownerId,session.agentId,'flow']);

function adapterFixture(options={}){
 const storage=options.storage||{},toasts=[],cancels=[],listeners=new Set(),agentRuns=[...(options.runs||[])];
 const state={session,account:options.account===undefined?'a':options.account};
 let view='workflows',runCount=0,pendingTap=options.tap?{...options.tap}:null,consumed=0;
 const execution=id=>({id,workflowId:'flow',versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]});
 const client={
  lifecycleSupported:async()=>false,supportsSubmissionReconciliation:async()=>true,
  list:async()=>[workflow],removedWorkflows:async()=>[],detail:async()=>({...workflow}),
  executions:async()=>agentRuns.map(run=>({...run})),
  receipt:async id=>({...agentRuns.find(run=>run.id===id)}),approvals:async()=>null,phoneReview:async()=>({steps:[]}),
  reconcile:async()=>options.reconciled?{...options.reconciled}:null,
  run:async(_id,_version,_signal,beforeSubmit)=>{await beforeSubmit?.('sub-'+(runCount+1));await options.gate?.run;const run=execution('run-'+(++runCount));agentRuns.unshift(run);return {...run};},
  cancel:async(id,workflowId)=>{cancels.push({id,workflowId,session:state.session.sessionId});if(options.cancelFails)throw Error('offline');const run=agentRuns.find(r=>r.id===id);if(run){run.status='cancelled';run.finished=true;}return {...run};},
 };
 const native={pendingWorkflowTap:async()=>pendingTap?{...pendingTap}:{},consumeWorkflowTap:async()=>{consumed++;pendingTap=null;},addListener:async()=>({remove(){}})};
 const localStorage=new Proxy({getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 class Shell{live=true;renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}componentDidUpdate(){}S(){return {view};}vset(){}vget(){return {};}api(){return api;}openView(next){view=next;}toast(message){toasts.push(message);}}
 const api={isActive:()=>true,track:()=>'',kx:()=>0,toast:message=>toasts.push(message),ic:{clock:'',check:''}};
 const views={workflows:{automationsManaged:true}};
 const controller={getWorkflowClient:()=>state.session?{sessionId:state.session.sessionId,scope:'scope',client}:null,
  getSnapshot:()=>({session:state.session,cloudAccount:state.account?{environment:'production',userId:state.account,sessionId:'sign-in-'+state.account,credentialId:'credential'}:null,open:false,busy:false,startupResolved:true}),
  subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},open(){},workflowNoticeActions:async()=>[],getWorkflowDeviceTarget:()=>null};
 const context=workflowRendererFixture({WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,resolveWorkflowTap,readyTapStep,tapRecheck,
  Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android'},connectionController:controller,localStorage,queueMicrotask,AbortController,Date,console});
 context.registerPlugin=name=>name==='AlphaNotifications'?native:new Proxy({},{get:(_target,key)=>key==='addListener'?async()=>({remove(){}}):async()=>({})});
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 context.install(Shell,views);const shell=new Shell();shell.componentDidMount();
 const notify=()=>{for(const listener of [...listeners])listener();};
 return {render:()=>views.workflows.render({},api),toasts,cancels,storage,agentRuns,
  signIn(account,next=state.session){state.account=account;state.session=next;notify();},notify,
  get consumed(){return consumed;},close:()=>shell.componentWillUnmount()};
}
const wait=async(fn,label='Workflow adapter did not settle.')=>{for(let count=0;count<400;count++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(label);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
const opened=async app=>{app.render().openWorkflow('flow');await wait(()=>app.render().detail&&app.render().fd.notRunning);};
const started=async app=>{await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.render().runOpen&&app.agentRuns.length===1&&app.render().fd.notRunning);};
const ledger=app=>JSON.parse(app.storage[LEDGER]||'[]');

test('another account signing in cancels the previous account\'s run once and never shows it',async()=>{
 const app=adapterFixture();
 try{
  await started(app);
  assert.deepEqual(ledger(app).map(entry=>[entry.account,entry.runId]),[[accountKey('a'),'run-1']]);
  const before=app.toasts.length;
  app.signIn('b');
  // Everything on screen is dropped at once; the request follows without blocking the switch.
  assert.equal(app.render().runOpen,false);assert.equal(app.render().detail,false);
  await wait(()=>app.cancels.length===1);
  assert.deepEqual(app.cancels,[{id:'run-1',workflowId:'flow',session:'session'}]);
  // The agent still lists the run. The new account sees no run and gets no second request.
  app.notify();app.notify();await opened(app);app.notify();await pause();
  assert.equal(app.agentRuns.length,1);assert.equal(app.render().fd.hasRuns,false);assert.deepEqual(app.render().fd.runs,[]);assert.equal(app.render().runOpen,false);
  assert.equal(app.cancels.length,1);
  assert.deepEqual(app.toasts.slice(before),[]);
 }finally{app.close();}
});

test('a failed cancellation is not reported, not repeated, and the run stays hidden',async()=>{
 const app=adapterFixture({cancelFails:true});
 try{
  await started(app);const before=app.toasts.length;
  app.signIn('b');await wait(()=>app.cancels.length===1);
  await opened(app);app.notify();await pause();
  assert.equal(app.agentRuns[0].finished,false);
  assert.equal(app.render().fd.hasRuns,false);assert.equal(app.render().fd.notRunning,true);
  assert.equal(app.cancels.length,1);assert.deepEqual(app.toasts.slice(before),[]);
  // A later launch of the app under the new account keeps both: the claim and the fence are saved.
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns});
  try{await opened(again);await pause();assert.equal(again.render().fd.hasRuns,false);assert.deepEqual(again.cancels,[]);}finally{again.close();}
 }finally{app.close();}
});

test('signing out hides the run and the same account signing back in gets it back uncancelled',async()=>{
 const app=adapterFixture();
 try{
  await started(app);
  app.signIn(null);
  assert.equal(app.render().runOpen,false);
  await opened(app);assert.equal(app.render().fd.hasRuns,false);
  app.signIn('a');await opened(app);await pause();
  assert.equal(app.render().fd.hasRuns,true);assert.deepEqual(app.cancels,[]);
  // Its own account reading the finished run drops the record.
  app.agentRuns[0].finished=true;app.agentRuns[0].status='success';
  app.render().openWorkflow('flow');await wait(()=>app.storage[LEDGER]===undefined&&app.render().detail&&!app.render().fd.busy);
  assert.equal(app.render().fd.hasRuns,true);assert.deepEqual(app.cancels,[]);
 }finally{app.close();}
});

test('a run started with no account signed in is not recorded and stays visible',async()=>{
 const app=adapterFixture({account:null});
 try{
  await started(app);assert.equal(app.storage[LEDGER],undefined);
  app.signIn('b');await opened(app);await pause();
  assert.equal(app.render().fd.hasRuns,true);assert.deepEqual(app.cancels,[]);
 }finally{app.close();}
});

test('nothing is sent through another agent connection; the run is cancelled when its own connection returns under another account',async()=>{
 const app=adapterFixture();
 try{
  await started(app);
  app.signIn('b',{sessionId:'other',origin:'https://other.invalid',ownerId:'owner-b',agentId:'agent-b'});
  await pause();assert.deepEqual(app.cancels,[]);assert.equal(app.render().runOpen,false);
  app.signIn('b',{...session,sessionId:'session-2'});
  await wait(()=>app.cancels.length===1);
  assert.deepEqual(app.cancels,[{id:'run-1',workflowId:'flow',session:'session-2'}]);
  await opened(app);assert.equal(app.render().fd.hasRuns,false);
 }finally{app.close();}
});

test('a run accepted after the account changed is never shown and is cancelled once',async()=>{
 let release;const gate={run:new Promise(resolve=>{release=resolve;})};
 const app=adapterFixture({gate});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();
  await wait(()=>!!app.storage[pendingKey()]);
  assert.equal(JSON.parse(app.storage[pendingKey()]).account,accountKey('a'));
  app.signIn('b');release();
  await wait(()=>app.cancels.length===1);
  assert.deepEqual(app.cancels.map(entry=>entry.id),['run-1']);
  assert.equal(app.render().runOpen,false);
  await opened(app);app.notify();await pause();
  assert.equal(app.render().fd.hasRuns,false);assert.equal(app.cancels.length,1);
 }finally{app.close();}
});

test('a retained request of another account that did start a run is settled without showing or resending it',async()=>{
 const run={id:'run-9',workflowId:'flow',versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]};
 const storage={[pendingKey()]:JSON.stringify({workflowId:'flow',versionId:'v1',submittedAt:1,submissionId:'sub-1',account:accountKey('a'),intentRevision:'r'})};
 const app=adapterFixture({storage,account:'b',reconciled:run,runs:[run]});
 try{
  await opened(app);await wait(()=>app.cancels.length===1);
  assert.equal(app.storage[pendingKey()],undefined);
  assert.equal(app.render().fd.hasRuns,false);
  assert.deepEqual(app.cancels.map(entry=>entry.id),['run-9']);
 }finally{app.close();}
});

test('a retained request of another account that never started is not offered for a resend',async()=>{
 const storage={[pendingKey()]:JSON.stringify({workflowId:'flow',versionId:'v1',submittedAt:1,submissionId:'sub-1',account:accountKey('a'),intentRevision:'r'})};
 const app=adapterFixture({storage,account:'b'});
 try{
  await opened(app);
  assert.doesNotMatch(app.toasts.join('\n'),/Resend/);assert.equal(app.render().fd.runLabel,'Clear request');
  app.render().fd.run();
  assert.match(app.toasts.at(-1),/May have run · Clear request\?/);
  assert.equal(app.agentRuns.length,0);assert.deepEqual(app.cancels,[]);
 }finally{app.close();}
});
