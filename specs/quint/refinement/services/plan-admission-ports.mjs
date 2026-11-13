import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
export const planUi='apps/app/src/runtime/connection-ui.tsx';
export const planShared='.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';
export const DAY=86400000;
export async function planAdmissionImplementation(){
 const result=await build({absWorkingDir:root,stdin:{contents:`export * from './${planShared}';export * from './apps/app/src/runtime/subscription-entitlement.ts';`,resolveDir:root,sourcefile:'plan-admission-entry.ts'},bundle:true,write:false,format:'cjs',platform:'node',metafile:true,define:{'import.meta.env':'{}'},logLevel:'silent'});
 const ui=readFileSync(resolve(root,planUi),'utf8');
 const section=(start,end)=>{const a=ui.indexOf(start),b=ui.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return ui.slice(a,b).replace(/^export /gm,'');};
 const line=start=>section(start,'\n');
 const code=stripTypeScriptTypes([
  section('function readPlanAdmission(', '/** Notice shown when Cloud inference'),
  section('function signInClient(', '/**\n * A new key was stored'),
  line('function stopEntitlementRefresh('),line('function detachService('),
  section('async function admitCloudResident(', '/**\n * Reads the account and plan again'),
  section('function residentBindingController(', '/** The packaged-runtime refusal.'),
  `globalThis.redeemer={${section('  async residentRedeem(', '  /** Checks the plan again')}};`,
 ].join('\n'),{mode:'strip'});
 return {code:result.outputFiles[0].text+'\nObject.assign(globalThis,module.exports);\n'+code,
  sources:[planUi,...Object.keys(result.metafile.inputs).map(path=>resolve(root,path)).filter(existsSync),
   'vendor/eliza/packages/auth/src/auth/cloud-resident-binding.ts','vendor/eliza/packages/cloud/sdk/src/subscription-entitlement.ts',
   'upstream.lock.json','.eliza/client-features/.source.json','scripts/prepare-client-features.ts']};
}

export function planAdmissionFixture(implementation,{credential=1,endDays=2}={}){
 let now=1800000000000,saved=null,mode='active',reported='none',identityGate,planGate,background=false;
 const disk=new Map(),writes=[],reads=[],timers=new Map();let timerId=0,binds=0,clears=0,redeemCalls=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 class CloudProtocolError extends Error{constructor(code,status){super('Synthetic Cloud refusal');this.name='CloudProtocolError';this.code=code;this.status=status;}}
 const identity=()=>({environment:'production',credentialId:`credential-${saved}`,userId:`user-${saved}`,organizationId:null});
 const client={environment:'production',entitlementSource:()=>({issuer:'https://fixture.invalid',
  entitlement:async signal=>{reads.push(['entitlement',saved]);if(planGate)await planGate.promise;signal.throwIfAborted();if(mode==='billing-outage')throw Error('Synthetic billing outage');return null;},
  entitlementKeys:async()=>{throw Error('Signed entitlement outside this fixture');},
  fallbackPlan:async()=>{reads.push(['billing',saved]);return mode==='credits'?{status:'none',billingMode:'organization-credits',planName:null,periodEnd:null}:{status:mode==='ended'?'canceled':'active',planName:'Synthetic plan',periodEnd:reported==='future'?now+endDays*DAY:null};}}),
  redeemSubscriptionCode:async()=>{redeemCalls++;return {planEndsAt:reported==='future'?now+endDays*DAY:null,paidPlanTakesPrecedence:false};}};
 const box={module:{exports:{}},exports:{},Date:Clock,Error,DOMException,AbortController,TextEncoder,TextDecoder,URL,URLSearchParams,crypto,
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
  PLAN_ADMISSION:'fixture-plan',cloudEnvironmentAllowed:value=>value==='production',
  localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>{const record=JSON.parse(value);writes.push({record:structuredClone(record),at:now,background});disk.set(key,value);},removeItem:key=>{writes.push({record:null,at:now,background});disk.delete(key);}},
  operation:null,entitlementRefresher:null,redeemedPlanEnd:null,membershipRead:null,appRequests:new Set(),
  state:{session:{},cloudAccount:null,planEndsAt:null,residentPlanNotice:null,error:''},cloud:client,service:null,active:{kind:'resident'},
  CloudProtocolError,LocalCloudProviderStopUnconfirmed:class extends Error{},
  cloudCredentialStore:{read:async()=>{reads.push(['credential',saved]);return saved===null?null:{credentialId:`credential-${saved}`,credentialReference:`reference-${saved}`};}},
  verifyService:async(_client,signal)=>{reads.push(['identity',saved]);if(identityGate)await identityGate.promise;signal.throwIfAborted();
   if(mode==='offline')throw Error('Synthetic identity unreachable');if(mode==='rejected')throw new CloudProtocolError('http',401);
   const row=identity();box.service={client,identity:row,credentialReference:`reference-${saved}`};box.state.cloudAccount=row;},
  update:patch=>Object.assign(box.state,patch),residentEnvironment:()=> 'production',cloudServiceName:()=> 'Cloud',makeCloud:()=>client,
  errorMessage:error=>error?.message??'',retireReadReplies(){},clearPersonalSetup(){},queueResidentRebind(){clears++;},
  bindResidentCloudProvider:async()=>{binds++;return 'guard';},clearLocalProviderIfCurrent:async()=>{clears++;return 'cleared';},clearLocalProvider:async()=>{clears++;},
  work:async(_label,operation)=>operation(new AbortController().signal),residentCloudFlow:()=>false,
  redeemFailureMessage:()=>'',redeemSuccessMessage:()=> 'Redeemed',SubscriptionRedeemError:class extends Error{},
  refreshMembershipBalance:async()=>{},
 };
 box.exports=box.module.exports;vm.createContext(box);vm.runInContext(implementation.code,box);
 let admission=null,lastKind='none',verifiedWrites=0;
 const redeemed=()=>vm.runInContext('redeemedPlanEnd',box);
 const endClass=value=>value===null||value===undefined?'none':value<=now?'past':'future';
 const record=()=>box.readPlanAdmission();
 function observe(){
  const row=record(),outcome=admission?.binding??'none';
  const reason=admission?.notice?.open?'sign-in':box.state.residentPlanNotice==='offline'?'offline':box.state.residentPlanNotice==='needs-plan'?(lastKind==='ended'?'plan-ended':'needs-plan'):'none';
  const last=writes.filter(write=>write.record).at(-1);
  return {'s.credential':saved??0,'s.record':row?{present:true,credential:Number(row.credentialId.split('-')[1]),age:now-row.verifiedAt<=7*DAY?'fresh':'old',endsAt:endClass(row.endsAt)}:{present:false,credential:0,age:'fresh',endsAt:'none'},
   's.memoryEndsAt':endClass(box.state.planEndsAt),'s.redeemedEnd':redeemed()?endClass(redeemed().endsAt):'unset',
   's.binding':outcome,'s.admittedBy':['cloud','kept'].includes(outcome)?lastKind==='billing-outage'||outcome==='kept'?'grace':'verified':'none',
   's.notice':reason,'s.lastWrittenEnd':last?(last.record.endsAt===null?'none':last.record.endsAt<=last.at?'past':'future'):'none','s.writes':verifiedWrites};
 }
 async function admit(kind,end='none',signal=new AbortController().signal){
  mode=kind;reported=end;const before=writes.length;lastKind=kind;
  admission=await box.admitCloudResident(signal);
  verifiedWrites+=writes.slice(before).filter(write=>write.record).length;
  return admission;
 }
 async function refresh(){background=true;const refresher=box.entitlementRefresher;assert.ok(refresher);refresher.refreshNow();
  for(let attempt=0;refresher.controller&&attempt<100;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(refresher.controller,null);background=false;}
 return {box,writes,reads,timers,observe,record,
  effects:()=>({binds,clears,redeemCalls}),
  signIn(next=credential){saved=next;box.detachService();admission=null;lastKind='none';},
  admit,
  async redeem(end){reported=end;const before=redeemCalls;assert.equal(await box.redeemer.residentRedeem('SYNTHETIC'),true);assert.equal(redeemCalls,before+1);},
  windowPasses(){now+=7*DAY+1;},
  endPasses(){const values=[record()?.endsAt,box.state.planEndsAt,redeemed()?.endsAt].filter(value=>typeof value==='number'&&value>now);assert.ok(values.length);now=Math.max(...values)+1;},
  gates(value){identityGate=value.identity;planGate=value.plan;},
  async refreshFailed(){mode='billing-outage';await refresh();},
  // The background refresher of the admitted plan reads Cloud again and finds it verified.
  async refreshVerified(kind,end){mode=kind;reported=end;const before=writes.length;await refresh();
   verifiedWrites+=writes.slice(before).filter(write=>write.record).length;},
  close(){box.stopEntitlementRefresh();assert.equal(timers.size,0);},
 };
}
