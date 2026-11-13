import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// spec-subscription-F01: Cloud signs no plan end, so admission used the stored record's end. After
// an owner redeemed a code with no end, the next admission restored the old end ("Plan runs until
// Dec 1") and an offline phone lost AI after it. The redeemed end now wins until Cloud reports one.
// Runs the shipped admission (shared controller, entitlement check, Alpha's ports).
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const section=(start,end)=>{const a=ui.indexOf(start),b=ui.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return ui.slice(a,b).replace(/^export /gm,'');};
const code=stripTypeScriptTypes([
  section('function signInRefused(', '/** Notice shown when Cloud inference'),
  section('function signInClient(', '/**\n * A new key was stored'),
  section('async function admitCloudResident(', '/**\n * Cloud reported'),
  section('async function recheckResidentPlan(', '/** Bind or unbind'),
  section('function residentBindingController(', '/** The packaged-runtime refusal.'),
].join('\n'),{mode:'strip'});
const shared=await import('../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts');
const entitlement=await import('../apps/app/src/runtime/subscription-entitlement.ts');
const DAY=86_400_000;

async function admit(redeemed){
  const identityRow={credentialId:'credential-1',userId:'user-1',organizationId:null},records=[];
  const stored={version:1,environment:'production',...identityRow,status:'active',planName:'Pilot',verifiedAt:Date.now()-DAY,endsAt:Date.now()+20*DAY};
  // Cloud's billing snapshot: an active plan with no reported period end.
  const client={environment:'production',entitlementSource:()=>({issuer:'https://cloud.invalid',entitlement:async()=>null,entitlementKeys:async()=>[],fallbackPlan:async()=>({status:'active',planName:'Pilot',periodEnd:null})})};
  const box={operation:null,planRecheck:null,signInReadinessOwner:null,state:{session:{},open:false,cloudAccount:{credentialId:'credential-1'},residentPlanNotice:null,planEndsAt:stored.endsAt},active:{kind:'resident'},residentBinding:'unbound',cloud:client,service:null,redeemedPlanEnd:redeemed,AbortController,DOMException,Date,Error,
    CloudProtocolError:class extends Error {},EntitlementError:entitlement.EntitlementError,checkEntitlement:entitlement.checkEntitlement,planAdmission:entitlement.planAdmission,isEntitlementSignInFailure:entitlement.isEntitlementSignInFailure,residentAdmissionOutcome:entitlement.residentAdmissionOutcome,cloudUnreachable:entitlement.cloudUnreachable,CloudIdentityUnreachable:entitlement.CloudIdentityUnreachable,identityReadRefused:entitlement.identityReadRefused,
    CloudResidentBindingController:shared.CloudResidentBindingController,CloudResidentBindingError:shared.CloudResidentBindingError,recentResidentPlanAdmission:shared.recentResidentPlanAdmission,
    cloudCredentialStore:{read:async()=>({credentialId:'credential-1'})},cloudServiceName:()=>'Eliza Cloud',
    verifyService:async()=>{box.service={client,identity:identityRow};},
    readPlanAdmission:()=>stored,writePlanAdmission:record=>records.push(record),
    ownProviderSelected:()=>false,residentBindable:()=>true,residentEnvironment:()=>'production',makeCloud:()=>client,stopEntitlementRefresh(){},startEntitlementRefresh(){},update:patch=>{Object.assign(box.state,patch);},
    EntitlementRefresher:class {},detachService(){},queueResidentRebind(){},residentRebinds:()=>({queue(){}}),runQueuedResidentRebind(){}};
  vm.createContext(box);vm.runInContext(code,box);
  const admission=await box.admitCloudResident(new AbortController().signal);
  return {admission,records:records.filter(Boolean),stored,state:box.state};
}

test('after a no-end redeem, admission records no end instead of the earlier grant end',async()=>{
  const {admission,records,state}=await admit({environment:'production',credentialId:'credential-1',endsAt:null});
  assert.equal(admission.binding,'cloud');
  assert.equal(state.planEndsAt,null);
  assert.ok(records.length>0,'the admission was recorded');
  assert.ok(records.every(record=>record.endsAt===null),JSON.stringify(records));
});

test('a redeemed dated end replaces the stored one',async()=>{
  const end=Date.now()+90*DAY;
  const {records,state}=await admit({environment:'production',credentialId:'credential-1',endsAt:end});
  assert.equal(state.planEndsAt,end);assert.ok(records.every(record=>record.endsAt===end));
});

test('without a redeem, or for another credential or environment, the stored end is kept',async()=>{
  for(const redeemed of [null,{environment:'production',credentialId:'credential-2',endsAt:null},{environment:'staging',credentialId:'credential-1',endsAt:null}]){
    const {stored,state}=await admit(redeemed);
    assert.equal(state.planEndsAt,stored.endsAt,JSON.stringify(redeemed));
  }
});

// The restart after a redeem re-verifies the account into a new connection object; the redeemed
// end must still be recorded and shown for that same account, and never for another one.
const redeemCode=stripTypeScriptTypes(`${section('let homePresentationRevision=','\n')}\nglobalThis.controller={${section('  async residentRedeem(', '  /** Checks the plan again')}};`,{mode:'strip'});
async function redeem(nextCredential){
  const identity={environment:'production',credentialId:'credential-1',userId:'user-1',organizationId:null},end=Date.now()+90*DAY,writes=[];
  const account={identity,credentialReference:'ref-1',client:{environment:'production',redeemSubscriptionCode:async()=>({planEndsAt:end,paidPlanTakesPrecedence:false})}};
  const box={operation:null,service:account,redeemedPlanEnd:null,state:{redeemNotice:'',error:''},crypto,Error,
    update:patch=>Object.assign(box.state,patch),work:async(_message,action)=>action(new AbortController().signal),
    SubscriptionRedeemError:class extends Error {},redeemFailureMessage:()=>'',redeemSuccessMessage:()=>'Redeemed.',cloudServiceName:()=>'Eliza Cloud',cloud:account.client,
    readPlanAdmission:()=>({version:1,environment:'production',credentialId:'credential-1',endsAt:Date.now()+DAY}),writePlanAdmission:record=>writes.push(record),
    residentCloudFlow:()=>true,retire(){},residentAlwaysPresent:true,active:{},
    connectResident:async()=>{box.service={...account,identity:{...identity,credentialId:nextCredential}};},
    refreshMembershipBalance:async()=>{box.state.planEndsAt=null;}};
  vm.createContext(box);vm.runInContext(redeemCode,box);
  assert.equal(await box.controller.residentRedeem('CODE'),true);
  return {end,state:box.state,writes};
}

test('a redeemed end survives the restart that re-verifies the same account',async()=>{
  const {end,state,writes}=await redeem('credential-1');
  assert.equal(state.planEndsAt,end);
  assert.equal(writes.length,2);assert.ok(writes.every(record=>record.endsAt===end));
});

test('a restart that lands on another account does not take the redeemed end',async()=>{
  const {state,writes}=await redeem('credential-2');
  assert.equal(state.planEndsAt,null);
  assert.equal(writes.length,1,'only the pre-restart write for the redeeming account');
});
