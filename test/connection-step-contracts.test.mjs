/** Connection controller, native connection, local agent and Cloud read authorization step
 * contracts. Real source is sliced or bundled and run with injected infrastructure: no renderer,
 * network, credential store or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {loadBrowserModule} from './fixtures/browser-source.mjs';

const read=name=>readFileSync(new URL('../apps/app/src/runtime/'+name,import.meta.url),'utf8');
const ui=read('connection-ui.tsx'),connection=read('native-connection.ts'),delegation=read('cloud-delegation-ui.tsx');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`${start} … ${end}`);return source.slice(a,b);}
const compile=text=>stripTypeScriptTypes(text.replace(/^export /gm,''),{mode:'strip'});
/** Runs sliced source in a context; free names in the slice resolve to (and assign) its properties. */
function load(text,context,expose=''){const box=vm.createContext({AbortController,DOMException,Date,Error,Promise,Map,Set,Math,JSON,console,setTimeout,queueMicrotask,...context});vm.runInContext(compile(text)+'\n'+expose,box);return box;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// ---- Plan window ----

test('a plan end that has passed is never carried forward by a refreshed active plan',()=>{
 const now=Date.now(),active={kind:'active',planName:'Plan',status:'active',allowance:null,expiresAt:now+50_000,refreshFailed:false};
 // The real onView of the admission's background refresh, with the account still current.
 const refresh=(lastKnown,view)=>{
  const account={},state={planEndsAt:lastKnown},recorded=[];
  const box=load('globalThis.onView=({'+between(ui,'    onView:next=>{','\n    onAuthFailure')+'}).onView;',{state,service:account,admitted:account,identity:{credentialId:'c'},environment:'production',
   update:patch=>Object.assign(state,patch),planAdmission:next=>next.kind==='active'||next.kind==='credits'?'admit':'unknown',cloudServiceName:()=>'Cloud',residentPlanEnded:()=>{},
   binding:{recordAdmission:(_identity,_plan,endsAt)=>recorded.push(endsAt)}});
  box.onView(view);return {shown:state.planEndsAt,recorded};
 };
 assert.deepEqual(refresh(now-1,active),{shown:null,recorded:[null]},'the old end is dropped after a renewal');
 assert.deepEqual(refresh(now+5_000,active),{shown:now+5_000,recorded:[now+5_000]});
 assert.deepEqual(refresh(null,active),{shown:null,recorded:[null]});
 assert.deepEqual(refresh(now-1,{...active,planEndsAt:now+7_000}),{shown:now+7_000,recorded:[now+7_000]},'the entitlement’s own end wins');
 assert.deepEqual(refresh(now+5_000,{...active,planEndsAt:null}),{shown:null,recorded:[null]},'a plan Cloud reports without an end has none');
 assert.deepEqual(refresh(now+5_000,{...active,source:'billing-limits',expiresAt:now+9_000}),{shown:now+9_000,recorded:[now+9_000]},'the billing period end wins');
 assert.deepEqual(refresh(now+5_000,{kind:'credits',source:'billing-limits'}),{shown:null,recorded:[null]});
 // A view that says nothing about the plan (an outage) leaves the last known end and stores nothing.
 assert.deepEqual(refresh(now-1,{kind:'unavailable',reason:'outage'}),{shown:now-1,recorded:[]});
 assert.deepEqual(refresh(now-1,{...active,refreshFailed:true}),{shown:null,recorded:[]});
});

// ---- Connection controller ----

function retireFixture(active){
 const state={session:null};
 const box=load(between(ui,'\nfunction retire(','/** The connection epoch whose lost resident'),{state,active,epoch:0,sending:null,testMocksEnabled:false,residentAlwaysPresent:true,RESIDENT_NAME:'On this device',actionReceipts:new Map(),conversationMemory:new Map(),appRequests:new Set(),
  clearClientObservationSupport:()=>{},retireConversationEvents:()=>{},retireReadReplies:()=>{},pauseHostedBackground:async()=>{},retireClockReviews:async()=>{},cancelStoppedReply:()=>{},update:patch=>Object.assign(state,patch)},'globalThis.retire=retire;');
 return box;
}
test('retiring the connection disconnects the resident client',async()=>{
 let disconnects=0;const box=retireFixture({kind:'resident',remote:{disconnect:async()=>{disconnects++;}}});
 await box.retire();assert.equal(disconnects,1);assert.equal(box.active,null);
 // A failed disconnect keeps the current error-aware retirement outcome and blocks dependent work.
 const failing=retireFixture({kind:'resident',remote:{disconnect:async()=>{throw Error('closed');}}});await assert.rejects(failing.retire(),/closed/);await tick();assert.equal(failing.active,null);assert.match(failing.state.error,/Couldn’t stop background delivery/);
 const remote=retireFixture({kind:'remote',remote:{disconnect:async()=>{disconnects++;}}});await remote.retire();assert.equal(disconnects,1);
 // A connection that replaces a still-active resident closes it too, unless it is the same client.
 const replace=(previous,next)=>{const box=load(between(ui,'\nfunction activate(','\n  update({ residentRecoveryReason')+'\n}',{active:previous,epoch:0,sending:null,actionReceipts:new Map(),conversationMemory:new Map(),appRequests:new Set(),
  clearClientObservationSupport:()=>{},retireConversationEvents:()=>{},retireReadReplies:()=>{},cancelStoppedReply:()=>{}},'globalThis.activate=activate;');box.activate(next);return box.active;};
 const client=()=>{const remote={closed:0,disconnect:async()=>{remote.closed++;}};return remote;};
 const earlier=client(),later=client();
 assert.equal(replace({kind:'resident',remote:earlier},{kind:'resident',remote:later}).remote,later);assert.equal(earlier.closed,1);assert.equal(later.closed,0);
 const same=client();replace({kind:'resident',remote:same},{kind:'resident',remote:same});assert.equal(same.closed,0,'a client activated again stays connected');
 const before=client();replace({kind:'resident',remote:before},{kind:'cloud',cloud:{}});assert.equal(before.closed,1);
 const paired=client();replace({kind:'remote',remote:paired},{kind:'resident',remote:client()});assert.equal(paired.closed,0);
});

test('the on-device agent’s own 401 never reads as a refused or expired Cloud sign-in',()=>{
 class CloudProtocolError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
 const context={testMocksEnabled:false,CloudProtocolError,CloudSignInError:class extends Error{},EntitlementError:class extends Error{},CodeExpiredError:class extends Error{},ACCOUNT_CHANGED:'changed',reportCloudProtocolError:()=>{},
  residentRecoveryReason:()=>null,residentRecoveryMessage:()=>'',signInFailureMessage:code=>code,residentSignInExpired:()=>'Sign in to Cloud again to turn AI back on.',cloudServiceName:()=>'Cloud',cloud:{environment:'production'}};
 const box=load(between(ui,'function signInRefused(','/** A newer sign-in replaced')+between(ui,'\nfunction errorKindOf(','/** A saved Cloud credential read')+between(ui,'\nfunction errorMessage(','/** A resident start that does not open'),context,'globalThis.api={signInRefused,errorKindOf,errorMessage};');
 const local=Object.assign(Error('Local agent request failed (HTTP 401).'),{status:401,source:'local-agent'});
 assert.equal(box.api.signInRefused({status:401}),true);assert.equal(box.api.errorKindOf({status:401}),'sign-in-rejected');
 assert.equal(box.api.errorMessage({status:401}),'Sign in to Cloud again to turn AI back on.');
 assert.equal(box.api.signInRefused(local),false);
 assert.equal(box.api.errorKindOf(local),null,'the sign-in page is not brought back by the agent’s own refusal');
 assert.equal(box.api.errorMessage(local),'Local agent request failed (HTTP 401).');
 // A turn the resident refuses restarts the resident before any sign-in route is considered.
 const send=ui.slice(ui.indexOf('  async send('));
 const restart=send.indexOf("if (expired(error) && generation === epoch && selected.kind === 'resident') {\n        residentLost(generation);"),signIn=send.indexOf("retire('Sign-in required');");
 assert.ok(restart>0&&signIn>restart);
});

// ---- Native connection ----

test('browser secrets fall back to memory only when durable storage never worked',async()=>{
 const box=load(between(connection,'export function memorySecretBackend()','const SECRET_DATABASE')+between(connection,'export function durableSecretsWithFallback(','function webSecrets()'),{},'globalThis.api={memorySecretBackend,durableSecretsWithFallback};');
 const refusal=()=>new DOMException('refused','InvalidStateError');
 // A private window: nothing durable ever answers, so the page keeps working from memory.
 const never={read:async()=>{throw refusal();},compareExchange:async()=>{throw refusal();}};
 const privateWindow=box.api.durableSecretsWithFallback(never,box.api.memorySecretBackend());
 assert.equal(await privateWindow.compareExchange('cloud:production',undefined,'key'),true);assert.equal(await privateWindow.read('cloud:production'),'key');
 // Durable storage that worked and then fails once: a removal is reported, never faked in memory.
 const durable=box.api.memorySecretBackend();let failNext=false;
 const flaky={read:slot=>durable.read(slot),compareExchange:async(slot,expected,value)=>{if(failNext){failNext=false;throw refusal();}return durable.compareExchange(slot,expected,value);}};
 const secrets=box.api.durableSecretsWithFallback(flaky,box.api.memorySecretBackend(),slot=>'ns:'+slot);
 await secrets.compareExchange('cloud:production',undefined,'key');assert.equal(await durable.read('ns:cloud:production'),'key','the slot name is mapped');
 failNext=true;await assert.rejects(secrets.compareExchange('cloud:production',undefined,null),error=>error.name==='InvalidStateError');
 assert.equal(await secrets.read('cloud:production'),'key','the key is still reported as stored');
 assert.equal(await secrets.compareExchange('cloud:production',undefined,null),true);assert.equal(await durable.read('ns:cloud:production'),null,'the retried sign-out removes the durable key');
 // Other failures are never swallowed.
 const broken=box.api.durableSecretsWithFallback({read:async()=>{throw Error('Stored connection secret is invalid.');},compareExchange:async()=>false},box.api.memorySecretBackend());
 await assert.rejects(broken.read('cloud:production'),/invalid/);
});

// ---- Local agent ----

const agent=await loadBrowserModule('apps/app/src/runtime/local-agent.ts');
test('Stop reads the conversation list once per conversation, and a refusal names its source',async()=>{
 const room='5f0c8a52-6d8e-4c4a-9a51-0b6e6f0d1a22',paths=[];let status=200;
 const local=new agent.LocalAgentProtocol({start:async()=>({}),request:async input=>{paths.push(input.path);
  if(input.path==='/api/conversations')return {status,body:JSON.stringify({conversations:[{id:'thread',title:'T',roomId:room}]})};
  return {status:200,body:JSON.stringify({aborted:true})};}});
 const session={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://device.alpha.invalid'};local.session=session;
 for(let i=0;i<3;i++)assert.equal(await local.abortTurn('thread'),'aborted');
 assert.equal(paths.filter(path=>path==='/api/conversations').length,1);assert.equal(paths.filter(path=>path===`/api/turns/${room}/abort`).length,3);
 // A new connection reads its own list.
 await local.disconnect();local.session=session;assert.equal(await local.abortTurn('thread'),'aborted');
 assert.equal(paths.filter(path=>path==='/api/conversations').length,2);
 status=401;const refusal=await local.request('/api/conversations',undefined,new AbortController().signal).catch(error=>error);
 assert.equal(refusal.status,401);assert.equal(refusal.source,'local-agent');assert.equal(agent.localAgentRefusal(refusal),true);
 assert.equal(agent.localAgentRefusal({status:401}),false);
});
test('waiting for shutdown tolerates a failed status read and polls with backoff',async()=>{
 const stopped={state:'stopped',serviceActive:false,socketListening:false};
 const run=async answers=>{let now=0,reads=0;const sleeps=[];
  const result=await agent.awaitLocalAgentStopped(async()=>{const answer=answers[Math.min(reads++,answers.length-1)];if(answer instanceof Error)throw answer;return answer;},{now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}}).then(()=>'stopped',error=>error.message);
  return {result,reads,sleeps};};
 const recovered=await run([Error('bridge busy'),{state:'stopping',serviceActive:true,socketListening:true},stopped]);
 assert.equal(recovered.result,'stopped');assert.deepEqual(recovered.sleeps,[200,400]);
 const stuck=await run([{state:'stopping',serviceActive:true,socketListening:true}]);
 assert.match(stuck.result,/Shutdown is still pending/);
 assert.ok(stuck.reads<=40,`a 30 s wait costs ${stuck.reads} status reads`);assert.equal(Math.max(...stuck.sleeps),1000);
 const failing=await run([Error('bridge gone')]);assert.match(failing.result,/Shutdown is still pending/);
});

// ---- Cloud read authorization ----

const delegationApi=load(between(delegation,'export function delegationCancelStep(','export function CloudDelegationPanel({'),{},'globalThis.api={delegationCancelStep};').api;
test('Cancel reads Cloud’s state before it cancels an authorization whose return was received',()=>{
 const step=delegationApi.delegationCancelStep;
 assert.equal(step('waiting',null),'cancel');
 assert.equal(step('finishing',null),'read-status','Cloud’s state is read before anything is cancelled');
 assert.equal(step('finishing','waiting'),'cancel');
 assert.equal(step('finishing','settled'),'done','a grant Cloud already holds is adopted, not cancelled');
 assert.equal(step('finishing','finishing'),'done');
});
