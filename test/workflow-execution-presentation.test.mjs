import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const {executionFixture}=await import('./fixtures/workflow-execution-fixture.mjs');
// Phone review hashes run on the crypto worker; event-loop turns do not bound that work.
const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await delay(10);}throw Error('Bounded fixture did not settle');};
test('finished manual text result has no device controls and Done closes without a new run',async()=>{const f=await executionFixture();try{const r=await f.openRun();assert.equal(r.phoneAvailable,false);assert.equal(r.phoneSyncAvailable,false);assert.equal(r.showRefresh,false);assert.equal(r.notice,'');assert.equal(r.out,f.run.output);assert.ok(r.log.some(x=>x.t===f.run.id));assert.equal(r.againLabel,'Done');r.again();assert.equal(f.render().runOpen,false);assert.equal(f.requests.filter(x=>x.body!==undefined).length,0);}finally{f.close();}});
test('pending device approvals retain review/reconciliation controls while manual runs do not',async()=>{for(const device of [false,true]){const f=await executionFixture({status:'waiting-approval',finished:false,device});try{const r=await f.openRun();assert.equal(r.phoneAvailable,device);assert.equal(r.phoneReviewAvailable,device);assert.equal(r.phoneSyncAvailable,device);assert.equal(r.notice,'Running');assert.equal(r.againLabel,'Cancel run');assert.equal(f.requests.filter(x=>x.body!==undefined).length,0);}finally{f.close();}}});
test('unknown and externally running executions retain visible uncertainty, cancellation and no-replay truth',async()=>{for(const state of ['outcome-unknown','worker-running']){const f=await executionFixture({status:'running',finished:false,device:true,reconciliation:{state,message:'Recorded state'}});try{const r=await f.openRun();assert.match(r.notice,state==='outcome-unknown'?/^Check before running again$/:/^Running$/);assert.equal(!!r.mayHaveRun,state==='outcome-unknown');assert.equal(r.showRefresh,true);assert.equal(r.phoneSyncAvailable,state==='outcome-unknown');assert.equal(r.againLabel,'Cancel run');assert.equal(f.requests.filter(x=>x.body!==undefined).length,0);}finally{f.close();}}});
test('an earlier workflow version is disclosed and never borrows current device steps',async()=>{const f=await executionFixture({status:'waiting-approval',finished:false,device:true,version:'v1'});try{const r=await f.openRun();assert.equal(r.phoneAvailable,false);assert.equal(r.phoneInspectAvailable,true);assert.match(r.versionNotice,/^Older version$/);}finally{f.close();}});
test('loading the saved request store shows checking, not an invented removal; real pending intent remains',async()=>{const f=await executionFixture();try{const load=f.context.WorkflowIntentStore.prototype.load;let release;f.context.WorkflowIntentStore.prototype.load=async function(...args){await new Promise(resolve=>release=resolve);return load.apply(this,args);};f.render().fd.runs[0].open();await settle(()=>release);assert.match(f.render().fd.last,/^Checking$/);assert.equal(f.render().fd.checking,true);assert.doesNotMatch(f.render().fd.last,/Unknown/);f.context.WorkflowIntentStore.prototype.load=load;release();await settle(()=>f.render().runOpen&&!f.render().r.againDisabled);}finally{f.close();}const pending=await executionFixture({pendingLifecycle:true});try{assert.match(pending.render().fd.last,/^Not received$/);assert.equal(pending.render().fd.deleteLabel,'Resend');assert.ok(pending.storage[pending.pendingKey]);assert.equal(pending.requests.filter(x=>x.body!==undefined).length,0);}finally{pending.close();}});

test('actual execution template keeps result visible and technical IDs/history in closed details',async()=>{
 const {executionMarkup}=await import('./fixtures/workflow-execution-markup.mjs');const {JSDOM}=await import('jsdom');
 const f=await executionFixture();try{const r=await f.openRun(),html=await executionMarkup(r),doc=new JSDOM(html).window.document;
 assert.match(doc.querySelector('h1').textContent,/manual text workflow/);assert.match(doc.body.textContent,/supplied text reached the saved draft/);
 const details=doc.querySelector('details[aria-label="Workflow execution details"]');assert.ok(details);assert.equal(details.hasAttribute('open'),false);assert.match(details.textContent,new RegExp(f.run.id));assert.match(details.textContent,/typed-steps/);assert.match(details.textContent,/Status\s*Finished/);
 assert.equal(doc.querySelector('[aria-label="Workflow phone steps"]'),null);assert.equal(doc.querySelector('[aria-label="Refresh"]'),null);assert.ok(doc.querySelector('button[aria-label="Back to workflow"]'));
 for(const node of doc.querySelectorAll('dd'))assert.equal(node.closest('details'),details);
 }finally{f.close();}
});

function receiptTimers(){
 const timers=new Map();
 let next=0;
 return {
  setTimeout(callback,delay){const id=++next;timers.set(id,{callback,delay});return id;},
  clearTimeout(id){timers.delete(id);},
  get delay(){return timers.values().next().value?.delay;},
  fire(){
   assert.equal(timers.size,1,'only one receipt refresh may be scheduled');
   const [id,{callback}]=timers.entries().next().value;
   timers.delete(id);
   callback();
  },
 };
}

test('an open receipt backs off unchanged reads and shows exact engine approval and completion without dispatching',async()=>{
 const timers=receiptTimers();
 let f,approvalStatus='pending',approveReceiptAvailable=true,overriddenVersion,readFailure=false;
 const request=(path)=>{
  if(path.endsWith('/status'))return {engine:'smthrs',status:'ready',approvalReceiptProtocol:1};
  if(path.endsWith('/approvals')){
   if(!approveReceiptAvailable)return Promise.reject(Error('Temporary read failure'));
   const {id:runId,workflowId,workflowVersionId,finished}=f.run;
   return {runId,workflowId,workflowVersionId,finished,cancellationRequested:false,approvals:[{
    runId,workflowId,workflowVersionId,nodeId:'review',iteration:0,requestDigest:'a'.repeat(64),
    status:approvalStatus,title:'Review fixture',summary:'Synthetic arithmetic',operation:'Calculate',
    target:'Fixture result',account:'Fixture account',supported:true,
   }]};
  }
  if(f&&path.endsWith('/executions/'+f.run.id)){
   if(readFailure)return Promise.reject(Error('Temporary read failure'));
   if(overriddenVersion)return {execution:{...f.run,workflowVersionId:overriddenVersion,status:'foreign'}};
  }
 };
 f=await executionFixture({status:'waiting-approval',finished:false,poll:{timers,request}});
 try{
  const initial=await f.openRun();
  assert.equal(timers.delay,2000);
  initial.approvals[0].approve();
  assert.equal(f.render().r.approvals[0].approveLabel,'Confirm approve');
  timers.fire();
  await settle(()=>timers.delay===4000);
  assert.equal(f.render().r.approvals[0].approveLabel,'Confirm approve','unchanged approval retains explicit review');
  overriddenVersion='other-version';
  timers.fire();
  await settle(()=>timers.delay===5000);
  assert.equal(f.render().r.status,'waiting-approval');
  assert.equal(f.render().r.approvals[0].approveLabel,'Confirm approve');
  overriddenVersion=undefined;
  readFailure=true;
  timers.fire();
  await settle(()=>timers.delay===5000);
  assert.equal(f.render().r.status,'waiting-approval');
  readFailure=false;
  approvalStatus='denied';
  timers.fire();
  await settle(()=>timers.delay===2000);
  assert.equal(f.render().r.approvals[0].status,'denied');
  initial.approvals[0].approve();
  assert.equal(f.render().r.approvals[0].canDecide,false);
  approveReceiptAvailable=false;
  Object.assign(f.run,{status:'succeeded',finished:true,output:'Fresh final output'});
  timers.fire();
  await settle(()=>f.render().r.status==='succeeded');
  assert.equal(f.render().r.out,'Fresh final output');
  assert.equal(f.render().r.againLabel,'Done');
  assert.equal(f.render().r.approvals[0].status,'denied');
  assert.equal(timers.delay,undefined);
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
  assert.deepEqual(f.storage,{});
 }finally{f.close();}
});

test('a manual refresh and owner retirement fence an in-flight automatic read',async()=>{
 const timers=receiptTimers();
 let f,held,release,holdNext=false;
 const request=(path,signal)=>{
  if(!f||!path.endsWith('/executions/'+f.run.id)||!holdNext)return;
  holdNext=false;
  held=signal;
  return new Promise(resolve=>{release=()=>resolve({execution:{...f.run,status:'old response'}});});
 };
 f=await executionFixture({status:'running',finished:false,poll:{timers,request}});
 try{
  await f.openRun();
  holdNext=true;
  timers.fire();
  assert.equal(timers.delay,undefined);
  assert.equal(held.aborted,false);
  f.render().r.ask();
  assert.equal(held.aborted,true);
  await settle(()=>!f.render().r.againDisabled);
  assert.equal(timers.delay,undefined,'no replacement timer while an aborted read is still settling');
  release();
  await settle(()=>timers.delay===2000);
  assert.equal(f.render().r.status,'running');
  holdNext=true;
  timers.fire();
  f.changeSession();
  assert.equal(held.aborted,true);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.render().runOpen,false);
  assert.equal(timers.delay,undefined);
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
 }finally{f.close();}
});

test('automatic completion leaves a retained approval intent for explicit receipt reconciliation',async()=>{
 const timers=receiptTimers();
 let f;
 const request=(path)=>{
  if(path.endsWith('/status'))return {engine:'smthrs',status:'ready',approvalReceiptProtocol:1};
  if(path.endsWith('/approvals')){
   const {id:runId,workflowId,workflowVersionId,finished}=f.run;
   return {runId,workflowId,workflowVersionId,finished,cancellationRequested:false,approvals:[]};
  }
 };
 f=await executionFixture({status:'waiting-approval',finished:false,poll:{timers,request}});
 const key='alpha.workflow.pending.v1:'+JSON.stringify(['https://agent.invalid','owner','agent',f.run.workflowId])+':approval:'+f.run.id;
 const retained=JSON.stringify({versionId:f.run.workflowVersionId,nodeId:'review',iteration:0,requestDigest:'a'.repeat(64),approved:true});
 f.storage[key]=retained;
 try{
  await f.openRun();
  Object.assign(f.run,{status:'succeeded',finished:true});
  timers.fire();
  await settle(()=>f.render().r.status==='succeeded');
  assert.equal(f.storage[key],retained);
  assert.equal(f.render().r.showRefresh,true);
  f.render().r.ask();
  await settle(()=>!f.render().r.againDisabled&&f.storage[key]===undefined);
  assert.equal(f.render().r.showRefresh,false);
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
 }finally{f.close();}
});

test('an older receipt discovers issued phone work read-only and still requires explicit Review',async()=>{
 const timers=receiptTimers(),calls={notice:0,review:0};
 const proposal={id:'private-proposal-id',title:'Save note',description:'Exact reviewed text',expiresAt:Date.now()+60_000};
 let pending=[];
 const f=await executionFixture({status:'waiting-approval',finished:false,device:true,version:'v1',poll:{timers},phone:{
  notice:async(review)=>{calls.notice++;assert.equal(review.runId,f.run.id);assert.equal(review.versionId,'v1');return pending;},
  review:async(review,context)=>{calls.review++;assert.equal(review.runId,f.run.id);assert.equal(context.selectedObject.revision,'v1');return [proposal];},
 }});
 try{
  const initial=await f.openRun();
  assert.equal(initial.phoneReviewAvailable,false);
  timers.fire();
  await settle(()=>timers.delay===4000);
  assert.equal(f.render().r.phoneReviewAvailable,false,'a waiting run alone proves no issued proposal');
  pending=[{id:proposal.id,expiresAt:proposal.expiresAt}];
  timers.fire();
  await settle(()=>f.render().r.phoneReviewAvailable);
  assert.equal(f.render().r.phoneNotice,'Device action awaiting review');
  assert.equal(f.render().r.phoneSteps.length,0);
  assert.deepEqual(calls,{notice:2,review:0});
  assert.equal(f.requests.filter(row=>row.path.endsWith('/phone-review')).length,2);
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
  pending=[];
  timers.fire();
  await settle(()=>!f.render().r.phoneReviewAvailable);
  assert.equal(f.render().r.phoneNotice,'');
  pending=[{id:proposal.id,expiresAt:proposal.expiresAt}];
  timers.fire();
  await settle(()=>f.render().r.phoneReviewAvailable);
  f.render().r.phoneReview();
  await settle(()=>!f.render().r.phoneBusy&&f.render().r.phoneSteps.length===1);
  assert.equal(calls.review,1);
  assert.equal(f.render().r.phoneSteps[0].description,proposal.description);
  f.render().r.phoneSteps[0].approve();
  assert.equal(f.render().r.phoneSteps[0].approveLabel,'Confirm approve');
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
 }finally{f.close();}
});

test('a mismatched phone review and retired context or owner cannot publish a pending hint',async()=>{
 const timers=receiptTimers();
 let release,signal,noticeReads=0;
 const phone={reviewWire:{versionId:'other-version'},notice:(_review,readSignal)=>{
  noticeReads++;signal=readSignal;
  return new Promise(resolve=>{release=()=>resolve([{id:'held',expiresAt:Date.now()+60_000}]);});
 }};
 const f=await executionFixture({status:'waiting-approval',finished:false,device:true,version:'v1',poll:{timers},phone});
 try{
  await f.openRun();
  timers.fire();
  await settle(()=>timers.delay===4000);
  assert.equal(noticeReads,0,'wrong pinned version is refused before reading proposals');
  delete phone.reviewWire.versionId;
  timers.fire();
  await settle(()=>release);
  f.selectRun({timeZone:'UTC'});
  release();
  await settle(()=>timers.delay===5000);
  assert.equal(f.render().r.phoneReviewAvailable,false);
  assert.equal(f.render().r.phoneNotice,'');
  release=undefined;
  timers.fire();
  await settle(()=>release);
  f.changeSession();
  assert.equal(signal.aborted,true);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.render().runOpen,false);
  assert.equal(timers.delay,undefined);
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
 }finally{f.close();}
});

test('an admitted discovery retires when the exact context revision or device target changes',async()=>{
 const timers=receiptTimers();
 const pending=[{id:'existing',expiresAt:Date.now()+60_000}];
 let fail=false,noticeReads=0;
 const phone={notice:async()=>{noticeReads++;if(fail)throw Error('Temporary proposal read failure');return pending;}};
 const f=await executionFixture({status:'waiting-approval',finished:false,device:true,version:'v1',poll:{timers},phone});
 try{
  await f.openRun();
  timers.fire();
  await settle(()=>f.render().r.phoneReviewAvailable);
  fail=true;
  timers.fire();
  await settle(()=>timers.delay===4000);
  assert.equal(f.render().r.phoneNotice,'Device action awaiting review');
  f.selectRun({timeZone:'UTC'});
  assert.equal(f.render().r.phoneReviewAvailable,false);
  assert.equal(f.render().r.phoneSyncAvailable,false);
  timers.fire();
  await settle(()=>timers.delay===2000);
  assert.equal(f.render().r.phoneNotice,'');
  fail=false;
  timers.fire();
  await settle(()=>f.render().r.phoneReviewAvailable);
  phone.target={...f.flow.phoneSpec.device,enrollmentId:'retired-enrollment'};
  assert.equal(f.render().r.phoneReviewAvailable,false);
  assert.equal(f.render().r.phoneSyncAvailable,false);
  const previousReads=noticeReads;
  phone.target=null;
  timers.fire();
  await settle(()=>timers.delay!==undefined);
  assert.equal(noticeReads,previousReads);
  assert.equal(f.render().r.phoneNotice,'');
  assert.equal(f.requests.filter(row=>row.body!==undefined).length,0);
 }finally{f.close();}
});
