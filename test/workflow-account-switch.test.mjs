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
 const storage=options.storage||{},toasts=[],cancels=[],listeners=new Set(),agentRuns=options.sharedRuns||[...(options.runs||[])];
 const state={session,account:options.account===undefined?'a':options.account};
 let view='workflows',runCount=options.runCount||0,wireStarts=0,pendingTap=options.tap?{...options.tap}:null,consumed=0;
 const execution=(id,workflowId)=>({id,workflowId,versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]});
 const client={
  lifecycleSupported:async()=>false,supportsSubmissionReconciliation:async()=>true,
  list:async()=>[workflow],removedWorkflows:async()=>[],detail:async id=>({...workflow,id}),
  executions:async id=>agentRuns.filter(run=>run.workflowId===id).map(run=>({...run})),
  receipt:async id=>({...agentRuns.find(run=>run.id===id)}),approvals:async()=>null,phoneReview:async()=>({steps:[]}),
  reconcile:async()=>options.reconciled?{...options.reconciled}:null,
  run:async(id,_version,_signal,beforeSubmit)=>{await beforeSubmit?.('sub-'+(runCount+1));wireStarts++;await options.gate?.run;const run=execution('run-'+(++runCount),id);if(options.finished){run.finished=true;run.status='success';}agentRuns.unshift(run);return {...run};},
  cancel:async(id,workflowId)=>{cancels.push({id,workflowId,session:state.session.sessionId});if(options.cancelFails)throw Error('offline');const run=agentRuns.find(r=>r.id===id);if(run){run.status='cancelled';run.finished=true;}return {...run};},
 };
 const native={pendingWorkflowTap:async()=>pendingTap?{...pendingTap}:{},consumeWorkflowTap:async()=>{consumed++;pendingTap=null;},addListener:async()=>({remove(){}})};
 let unconfirmedRead=false;
 const localStorage=new Proxy({getItem:key=>{if(key===LEDGER&&(options.ledgerStorage?.read||unconfirmedRead)){unconfirmedRead=false;throw Error('Ledger read unavailable');}return storage[key]??null;},setItem:(key,value)=>{if(key===LEDGER&&options.ledgerStorage?.write)throw Error('Ledger write unavailable');storage[key]=value;if(key===LEDGER&&options.ledgerStorage?.unconfirmedWrite){options.ledgerStorage.unconfirmedWrite=false;unconfirmedRead=true;}},removeItem:key=>{if(key===LEDGER&&options.ledgerStorage?.write)throw Error('Ledger write unavailable');delete storage[key];}},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 class Shell{live=true;renderVals(){return {};}componentDidMount(){}componentWillUnmount(){}componentDidUpdate(){}S(){return {view};}vset(){}vget(){return {};}api(){return api;}openView(next){view=next;}toast(message){toasts.push(message);}}
 const api={isActive:()=>true,track:()=>'',kx:()=>0,toast:message=>toasts.push(message),ic:{clock:'',check:''}};
 const views={workflows:{automationsManaged:true}};
 const controller={getWorkflowClient:()=>state.session?{sessionId:state.session.sessionId,scope:'scope',client}:null,
  getSnapshot:()=>({session:state.session,cloudAccount:state.account?{environment:'production',userId:state.account,sessionId:'sign-in-'+state.account,credentialId:'credential'}:null,open:false,busy:false,startupResolved:true}),
  subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},open(){},workflowNoticeActions:async()=>[],getWorkflowDeviceTarget:()=>null};
 const context=workflowRendererFixture({WorkflowAdmissionRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,resolveWorkflowTap,readyTapStep,tapRecheck,
  ...(options.noLocks?{navigator:{}}:{}),Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android'},connectionController:controller,localStorage,queueMicrotask,AbortController,Date,console});
 context.registerPlugin=name=>name==='AlphaNotifications'?native:new Proxy({},{get:(_target,key)=>key==='addListener'?async()=>({remove(){}}):async()=>({})});
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 context.install(Shell,views);const shell=new Shell();shell.componentDidMount();
 const notify=()=>{for(const listener of [...listeners])listener();};
 return {render:()=>views.workflows.render({},api),toasts,cancels,storage,agentRuns,locks:context.navigator?.locks,
  signIn(account,next=state.session){state.account=account;state.session=next;notify();},notify,
  get consumed(){return consumed;},get wireStarts(){return wireStarts;},close:()=>shell.componentWillUnmount()};
}
const wait=async(fn,label='Workflow adapter did not settle.')=>{for(let count=0;count<400;count++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(label);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
const opened=async(app,id='flow')=>{app.render().openWorkflow(id);await wait(()=>app.render().detail&&app.render().fd.notRunning);};
const started=async app=>{await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.render().runOpen&&app.agentRuns.length===1&&app.render().fd.notRunning);};
const ledger=app=>JSON.parse(app.storage[LEDGER]||'[]');
function uncertainAccountApp(account,options={}){
 const owner=JSON.stringify([session.origin,session.ownerId,session.agentId]);
 const old={id:'run-1',workflowId:'flow',versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]};
 const storage={
  [LEDGER]:JSON.stringify([{owner,account:accountKey('a'),workflowId:'flow',requestId:'sub-1'}]),
  [pendingKey()]:JSON.stringify({workflowId:'flow',versionId:'v1',submittedAt:1,submissionId:'sub-1',account:accountKey('a'),intentRevision:'r'}),
 };
 return adapterFixture({storage,account,runs:[old],runCount:1,...options});
}

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

test('recording a new run never evicts older unfinished account ownership',async()=>{
 const owner=JSON.stringify([session.origin,session.ownerId,session.agentId]);
 const stored=Array.from({length:200},(_,i)=>({owner,account:accountKey('a'),runId:'older-run-'+i,workflowId:'older-flow-'+i}));
 const old={id:'older-run-0',workflowId:'older-flow-0',versionId:'v1',status:'running',finished:false,startedAt:'2026-01-01T00:00:00.000Z',events:[]};
 const app=adapterFixture({storage:{[LEDGER]:JSON.stringify(stored)},runs:[old],cancelFails:true});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.wireStarts===1&&app.render().runOpen);
  assert.equal(ledger(app).length,201);
  app.signIn('b');await wait(()=>app.cancels.length===201);
  assert.ok(app.cancels.some(run=>run.id===old.id));
  app.render().openWorkflow(old.workflowId);await wait(()=>app.render().detail&&app.render().fd.notRunning);
  assert.equal(app.render().fd.hasRuns,false);
  assert.equal(app.agentRuns.find(run=>run.id===old.id).finished,false);
 }finally{app.close();}
});

test('an ownership reservation that cannot be saved refuses the run before dispatch',async()=>{
 const ledgerStorage={write:true};
 const app=adapterFixture({ledgerStorage});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();
  await wait(()=>app.toasts.includes('Run history unavailable'));
  assert.equal(app.wireStarts,0);assert.deepEqual(app.agentRuns,[]);assert.equal(app.storage[pendingKey()],undefined);
  assert.equal(app.render().runOpen,false);assert.equal(app.render().detail,false);
  ledgerStorage.write=false;
  await started(app);assert.equal(app.wireStarts,1);
 }finally{app.close();}
});

test('a lost ownership promotion keeps its durable fence across reload and account change',async()=>{
 let release;const gate={run:new Promise(resolve=>{release=resolve;})},ledgerStorage={write:false};
 const app=adapterFixture({gate,ledgerStorage});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.wireStarts===1);
  assert.equal(ledger(app)[0].account,accountKey('a'));assert.equal(ledger(app)[0].runId,undefined);
  ledgerStorage.write=true;release();await wait(()=>app.agentRuns.length===1&&app.toasts.includes('Run history unavailable'));
  assert.ok(app.storage[pendingKey()]);assert.equal(ledger(app)[0].runId,undefined);
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns,reconciled:app.agentRuns[0],ledgerStorage});
  try{
   again.render().openWorkflow('flow');await wait(()=>again.toasts.includes('Run history unavailable'));
   assert.equal(again.render().runOpen,false);assert.equal(again.render().detail,false);assert.deepEqual(again.cancels,[]);
   assert.ok(again.storage[pendingKey()]);
   ledgerStorage.write=false;await opened(again);await wait(()=>again.cancels.length===1);
   assert.equal(again.render().fd.hasRuns,false);assert.equal(again.storage[pendingKey()],undefined);
   again.notify();await pause();assert.equal(again.cancels.length,1);
  }finally{again.close();}
 }finally{app.close();}
});

test('unreadable ownership never becomes empty history for another account',async()=>{
 const ledgerStorage={read:false},app=adapterFixture({ledgerStorage});
 try{
  await started(app);const retained=app.storage[LEDGER];ledgerStorage.read=true;app.signIn('b');
  assert.equal(app.render().runOpen,false);assert.equal(app.render().detail,false);
  app.render().openWorkflow('flow');await wait(()=>app.toasts.includes('Run history unavailable'));
  assert.equal(app.render().runOpen,false);assert.equal(app.render().detail,false);assert.deepEqual(app.cancels,[]);
  assert.equal(app.storage[LEDGER],retained);
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns,ledgerStorage});
  try{
   again.render().openWorkflow('flow');await pause();
   assert.equal(again.render().detail,false);assert.ok(again.toasts.includes('Run history unavailable'));
   ledgerStorage.read=false;await opened(again);await wait(()=>again.cancels.length===1);
   assert.equal(again.render().fd.hasRuns,false);
  }finally{again.close();}
 }finally{app.close();}
});

test('clearing an uncertain submission retains its foreign pending fence and permits an exact later owned run',async()=>{
 const app=uncertainAccountApp('b');
 try{
  await opened(app);assert.equal(app.render().fd.hasRuns,false);
  app.render().fd.run();app.render().fd.run();await wait(()=>app.storage[pendingKey()]===undefined);
  assert.equal(ledger(app)[0].requestId,'sub-1');assert.deepEqual(app.cancels,[]);
  app.render().fd.run();app.render().fd.run();await wait(()=>app.render().runOpen&&app.agentRuns.length===2);
  assert.equal(app.render().r.log.find(row=>row.k==='Execution').t,'run-2');
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns,runCount:2});
  try{await opened(again);assert.equal(again.render().fd.runs.length,1);assert.deepEqual(again.cancels,[]);}finally{again.close();}
 }finally{app.close();}
});

for(const account of [null,'b'])test(`a later ${account?'finished account':'device-owned'} run stays shared behind an older pending account fence`,async()=>{
 const app=uncertainAccountApp(account);
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.storage[pendingKey()]===undefined);
  app.render().fd.run();app.render().fd.run();await wait(()=>app.render().runOpen&&app.agentRuns.length===2);
  assert.equal(app.render().r.log.find(row=>row.k==='Execution').t,'run-2');
  if(!account){
   assert.equal(ledger(app).find(row=>row.runId==='run-2').account,'');
   app.signIn('b');await pause();assert.deepEqual(app.cancels,[]);
   const reloaded=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns,runCount:2});
   try{await opened(reloaded);assert.equal(reloaded.render().fd.runs.length,1);assert.deepEqual(reloaded.cancels,[]);}finally{reloaded.close();}
  }
  const finished=app.agentRuns.find(run=>run.id==='run-2');finished.finished=true;finished.status='success';
  app.render().r.ask();await wait(()=>app.render().r?.againLabel==='Done'&&!app.render().r.againDisabled);
  assert.equal(ledger(app).find(row=>row.runId==='run-2').account,'');
  const again=adapterFixture({storage:app.storage,account:'c',runs:app.agentRuns,runCount:2});
  try{await opened(again);assert.equal(again.render().fd.runs.length,1);assert.deepEqual(again.cancels,[]);}finally{again.close();}
 }finally{app.close();}
});

test('a cancellation claim that cannot be saved sends nothing and retains account isolation',async()=>{
 const ledgerStorage={write:false},app=adapterFixture({ledgerStorage});
 try{
  await started(app);ledgerStorage.write=true;app.signIn('b');await opened(app);await pause();
  assert.deepEqual(app.cancels,[]);assert.equal(app.render().fd.hasRuns,false);assert.equal(ledger(app)[0].cancel,undefined);
  ledgerStorage.write=false;app.notify();await wait(()=>app.cancels.length===1);app.notify();await pause();
  assert.equal(app.cancels.length,1);assert.equal(ledger(app)[0].cancel,true);
 }finally{app.close();}
});

test('two documents retain both reservations and claim each exact run at most once',async()=>{
 let release;const gate={run:new Promise(resolve=>{release=resolve;})},storage={},sharedRuns=[];
 const first=adapterFixture({storage,sharedRuns,gate,cancelFails:true});
 const second=adapterFixture({storage,sharedRuns,gate,runCount:1,cancelFails:true});
 try{
  await Promise.all([opened(first),opened(second,'second-flow')]);
  first.render().fd.run();first.render().fd.run();second.render().fd.run();second.render().fd.run();
  await wait(()=>first.wireStarts===1&&second.wireStarts===1);
  assert.deepEqual(ledger(first).map(row=>row.workflowId).sort(),['flow','second-flow']);
  assert.ok(ledger(first).every(row=>row.requestId&&!row.runId));
  release();await wait(()=>first.render().runOpen&&second.render().runOpen);
  assert.deepEqual(ledger(first).map(row=>row.runId).sort(),['run-1','run-2']);
  first.signIn('b');second.signIn('b');await wait(()=>first.cancels.length+second.cancels.length===2);
  first.notify();second.notify();await pause();
  assert.deepEqual([...first.cancels,...second.cancels].map(row=>row.id).sort(),['run-1','run-2']);
  assert.ok(ledger(first).every(row=>row.cancel===true));
 }finally{release();first.close();second.close();}
});

test('an account switch while a cancellation claim waits never sends on the captured account binding',async()=>{
 const app=adapterFixture();let release,held;
 try{
  await started(app);
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  held=app.locks.request(LEDGER,{mode:'exclusive'},()=>{entered();return new Promise(resolve=>{release=resolve;});});
  await ready;app.signIn('b');app.signIn('a');release();await held;
  await wait(()=>ledger(app)[0].cancel===true);await pause();
  assert.deepEqual(app.cancels,[]);
  await opened(app);assert.equal(app.render().fd.hasRuns,true);
 }finally{release?.();await held;app.close();}
});

test('missing cross-document locking makes history unavailable and never dispatches a run',async()=>{
 const app=adapterFixture({noLocks:true});
 try{
  app.render().openWorkflow('flow');await wait(()=>app.toasts.includes('Run history unavailable'));
  assert.equal(app.render().detail,false);assert.equal(app.render().runOpen,false);
  assert.equal(app.wireStarts,0);assert.equal(app.storage[pendingKey()],undefined);assert.deepEqual(app.agentRuns,[]);
 }finally{app.close();}
});

test('a promotion written without confirmation retains the request and recovers its exact fence after reload',async()=>{
 let release;const gate={run:new Promise(resolve=>{release=resolve;})},ledgerStorage={unconfirmedWrite:false};
 const app=adapterFixture({gate,ledgerStorage});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.wireStarts===1);
  ledgerStorage.unconfirmedWrite=true;release();await wait(()=>app.toasts.includes('Run history unavailable'));
  assert.equal(ledger(app)[0].runId,'run-1');assert.ok(app.storage[pendingKey()]);assert.equal(app.render().runOpen,false);
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns,reconciled:app.agentRuns[0]});
  try{await opened(again);await wait(()=>again.cancels.length===1);assert.equal(again.render().fd.hasRuns,false);assert.equal(again.storage[pendingKey()],undefined);}finally{again.close();}
 }finally{release();app.close();}
});

test('a cancellation claim written without confirmation sends no request and remains consumed after reload',async()=>{
 const ledgerStorage={unconfirmedWrite:false},app=adapterFixture({ledgerStorage});
 try{
  await started(app);ledgerStorage.unconfirmedWrite=true;app.signIn('b');await opened(app);await pause();
  assert.deepEqual(app.cancels,[]);assert.equal(ledger(app)[0].cancel,true);assert.equal(app.render().fd.hasRuns,false);
  const again=adapterFixture({storage:app.storage,account:'b',runs:app.agentRuns});
  try{await opened(again);again.notify();await pause();assert.deepEqual(again.cancels,[]);assert.equal(again.render().fd.hasRuns,false);}finally{again.close();}
 }finally{app.close();}
});


test('an unconfirmed completed shared marker reconciles its retained account request after reload',async()=>{
 let release;const gate={run:new Promise(resolve=>{release=resolve;})},ledgerStorage={unconfirmedWrite:false};
 const app=uncertainAccountApp('b',{gate,ledgerStorage,finished:true});
 try{
  await opened(app);app.render().fd.run();app.render().fd.run();await wait(()=>app.storage[pendingKey()]===undefined);
  app.render().fd.run();app.render().fd.run();await wait(()=>app.wireStarts===1);
  ledgerStorage.unconfirmedWrite=true;release();await wait(()=>app.toasts.includes('Run history unavailable'));
  const exact=ledger(app).find(row=>row.runId==='run-2');assert.equal(exact.account,'');assert.equal(exact.requestId,'sub-2');assert.ok(app.storage[pendingKey()]);
  const again=adapterFixture({storage:app.storage,account:'c',runs:app.agentRuns,reconciled:app.agentRuns.find(row=>row.id==='run-2')});
  try{await opened(again);assert.equal(again.storage[pendingKey()],undefined);assert.equal(again.render().fd.runs.length,1);assert.deepEqual(again.cancels,[]);}finally{again.close();}
 }finally{release();app.close();}
});
