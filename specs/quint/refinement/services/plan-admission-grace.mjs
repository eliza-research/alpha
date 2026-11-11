import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {planAdmissionImplementation,planAdmissionFixture} from './plan-admission-ports.mjs';
import {action,deferred,until} from './support.mjs';

const scenarios={
 renewalAfterPastEndTest:[['signIn',1],['verified','active','future'],['endPasses'],['verified','active','none'],['admitOffline']],
 offlineGraceTest:[['signIn',1],['verified','credits','none'],['admitOffline'],['windowPasses'],['admitOffline']],
 otherAccountRecordIgnoredTest:[['signIn',1],['verified','active','none'],['signIn',2],['admitOffline'],['admitBillingOutage']],
 billingOutageAdmitsFromRecordTest:[['signIn',1],['verified','active','future'],['admitBillingOutage']],
 planEndedRemovesGraceTest:[['signIn',1],['verified','active','none'],['planEnded'],['admitOffline']],
 pastEndGivesNoGraceTest:[['signIn',1],['verified','active','future'],['endPasses'],['admitOffline']],
 rejectedSignInForgetsGraceTest:[['signIn',1],['verified','active','future'],['signInRejected'],['admitOffline']],
 redeemedEndPrecedesRecordTest:[['signIn',1],['verified','active','none'],['redeem','future'],['endPasses'],['verified','active','none']],
};

export function assertAdmissionEffects(fixture){
 for(const {record,at} of fixture.writes)if(record)assert.ok(record.endsAt===null||record.endsAt>at,'Never store a plan end already past');
 assert.equal(fixture.effects().binds,0,'Admission does not bind a provider or dispatch inference');
 const byCall=fixture.reads.filter(([kind])=>kind==='billing').length;
 assert.ok(byCall<=fixture.reads.filter(([kind])=>kind==='entitlement').length,'No extra billing read without an entitlement read');
}

export async function checkPlanAdmissionGrace(extraSources=[]){
 const temporary=mkdtempSync(join(tmpdir(),'quint-plan-admission-'));
 try{
  const implementation=await planAdmissionImplementation(),compiled=join(temporary,'plan-admission.cjs');writeFileSync(compiled,implementation.code);
  const sources=[...implementation.sources,'package-lock.json',fileURLToPath(import.meta.url),'specs/quint/refinement/services/plan-admission-ports.mjs','specs/quint/refinement/services/support.mjs',compiled,...extraSources];
  const driverHashes=captureInputs(sources),traces=[],observations=[];
  const rebuilt=await planAdmissionImplementation();assert.equal(rebuilt.code,implementation.code,'Exact executable closure after capture');
  async function execute(f,trace,command){
   const [name,...args]=command;
   if(name==='signIn')f.signIn(args[0]);
   else if(name==='verified')await f.admit(args[0],args[1]);
   else if(name==='admitOffline')await f.admit('offline');
   else if(name==='admitBillingOutage')await f.admit('billing-outage');
   else if(name==='signInRejected')await f.admit('rejected');
   else if(name==='planEnded')await f.admit('ended');
   else if(name==='redeem')await f.redeem(args[0]);
   else if(name==='endPasses')f.endPasses();
   else if(name==='windowPasses')f.windowPasses();
   else if(name==='refreshFailed')await f.refreshFailed();
   else throw Error(name);
   assertAdmissionEffects(f);const expect=f.observe();observations.push(expect);
   trace.steps.push({label:name+' through actual admission ports',action:action(name,...args),expect});
  }
  // Each named scenario uses its original transition sequence. Two physical end boundaries
  // and both account labels supply additional bounded walks without inventing independent clocks.
  for(const [name,commands] of Object.entries(scenarios))for(const endDays of [1/24,3]){
   const f=planAdmissionFixture(implementation,{endDays}),trace={name:`${name}: ${endDays} day end`,expect:f.observe(),steps:[]};
   try{for(const command of commands)await execute(f,trace,command);traces.push(trace);}finally{f.close();}
  }
  for(let seed=0;seed<12;seed++){
   const f=planAdmissionFixture(implementation,{endDays:(seed%3)+1}),trace={name:`physically consistent bounded walk ${seed}`,expect:f.observe(),steps:[]};
   try{
    await execute(f,trace,['signIn',seed%2+1]);
    await execute(f,trace,['verified',seed%3===0?'credits':'active',seed%3===1?'future':'none']);
    if(seed%3===1){await execute(f,trace,['endPasses']);await execute(f,trace,['verified','active','none']);}
    if(seed%3===2)await execute(f,trace,['redeem',seed%2?'future':'none']);
    await execute(f,trace,['refreshFailed']);
    await execute(f,trace,['admitBillingOutage']);await execute(f,trace,['admitOffline']);traces.push(trace);
   }finally{f.close();}
  }
  // Hold a real plan read while the closed credential store changes. The controller's actual
  // post-read credential fence must refuse the old result without minting a new admission record.
  for(const aborted of [false,true]){
   const f=planAdmissionFixture(implementation),trace={name:`held old plan result after credential replacement${aborted?' and abort':''}`,expect:f.observe(),steps:[]};
   try{
    await execute(f,trace,['signIn',1]);await execute(f,trace,['verified','active','future']);
    const gate=deferred(),controller=new AbortController();f.gates({plan:gate});const pending=f.admit('active','future',controller.signal).then(value=>({value}),error=>({error}));
    await until(()=>f.reads.filter(([kind])=>kind==='entitlement').length===2,'held entitlement read');
    f.signIn(2);f.gates({});await f.admit('active','future');
    trace.steps.push({label:'new credential verifies its own record',action:[action('signIn',2),action('verified','active','future')],expect:f.observe()});
    const before=f.writes.length,current=f.observe(),refresher=f.box.entitlementRefresher;
    if(aborted)controller.abort();gate.resolve();const result=await pending;
    if(aborted)assert.equal(result.error?.name,'AbortError');else assert.equal(result.error?.code,'account-changed');
    assert.equal(f.writes.length,before);
    assert.deepEqual(f.observe(),current);assert.equal(f.box.entitlementRefresher,refresher);
    trace.steps.push({label:'old completion cannot erase or replace the newer admission',expect:f.observe()});traces.push(trace);
   }finally{f.close();}
  }
  const witnesses={
   KeptOfflineWitness:value=>value['s.binding']==='kept',
   PastEndInMemoryWitness:value=>value['s.memoryEndsAt']==='past'&&value['s.binding']==='cloud',
   OtherAccountRecordWitness:value=>value['s.record'].present&&value['s.record'].credential!==value['s.credential']&&value['s.notice']==='offline',
   OldRecordUnbindsWitness:value=>value['s.record'].age==='old'&&value['s.binding']==='unbound'&&value['s.notice']==='offline',
   BillingOutageAdmitsWitness:value=>value['s.binding']==='cloud'&&value['s.admittedBy']==='grace',
   RedeemedEndPastWitness:value=>value['s.redeemedEnd']==='past'&&value['s.binding']==='cloud',
  };
  for(const [name,holds] of Object.entries(witnesses))assert.ok(observations.some(holds),`Actual source reached ${name}`);
  const f=planAdmissionFixture(implementation);f.signIn(1);await f.admit('active','future');
  const actual=f.observe(),altered=structuredClone(actual);altered['s.record'].credential=2;
  assert.throws(()=>assert.deepEqual(altered,actual),assert.AssertionError);
  f.writes.push({record:{endsAt:0},at:1});assert.throws(()=>assertAdmissionEffects(f),/Never store/);f.writes.pop();f.close();
  const receipt=await checkTraces({model:'PlanAdmissionGrace',sources,driverHashes,generatedSources:[compiled],traces,scope:'bounded-orchestration',assumptions:[
   'The unchanged shared CloudResidentBindingController and entitlement/outcome implementation execute with exact Alpha admission, plan-window, record parsing/storage, retirement and redeem functions. Closed Cloud/secure-storage ports contain synthetic identities and plans only.',
   'All nine state fields are observations of actual controller returns, JSON record writes, Alpha state, redeemed end and independent counters. Binding is the admission decision target; no provider apply or inference dispatch is claimed. Notice symbols classify the observed admission reason/view, not literal UI copy.',
   'The eight named transition sequences run at two physical end boundaries. Twelve bounded walks and one held-read replacement schedule use a single real fixture clock. Arbitrary independent model age/end transitions, full sign-in/out, bind/apply failure and native credential storage are not observed.',
   'The writes field counts verified admission record writes, while lastWrittenEnd also observes the actual redeem writes, matching the model distinction. Source sign-out clears its record whereas the model preserves one; that stronger source transition is explicitly excluded from this projection.',
  ]});
  return {receipt,coverage:{namedScenarios:8,witnesses:Object.keys(witnesses),canaries:['wrong-credential-observation','past-end-write']},obligations:[{model:'PlanAdmissionGrace',obligation:'Unobserved sign-out, binding effects and arbitrary clock schedules',reason:'This bounded admission-decision projection excludes the source-different signOut transition, sign-in UI orchestration, arbitrary combinations of model time dimensions, native bind/apply effects, signed-token cryptography and real Cloud/Keystore persistence. It does not establish full implementation refinement.'}]};
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
