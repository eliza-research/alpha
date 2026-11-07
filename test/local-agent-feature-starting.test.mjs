import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {ownerRouteGroup,ownerRouteAllowed} from '../apps/app/src/runtime/owner-route-policy.ts';
import {anyAbortSignal} from '../apps/app/src/runtime/abort-signal.ts';
// The actual protocol class, with only platform/transport/time collaborators injected.
// No app import, SDK runtime, real HTTP, profile or provider is started.
const source=readFileSync(process.env.ALPHA_FEATURE_STARTING_SOURCE||'apps/app/src/runtime/local-agent.ts','utf8');
const begin=source.indexOf('export class LocalAgentProtocol {'),end=source.indexOf('export const LOCAL_PROVIDER_MODEL=',begin);
assert.ok(begin>=0&&end>begin);
const classCode=stripTypeScriptTypes(source.slice(begin,end).replace(/^export /gm,''),{mode:'transform'});
const pending=(extra={})=>({status:503,body:JSON.stringify({error:'feature_starting',code:'feature_starting',phase:'app-route-tail',status:'pending',retryable:true,...extra})});
const ok=value=>({status:200,body:JSON.stringify(value)});
function fixture(request){
 const clock={now:0,timers:new Map(),next:0,beforeTick:null},calls=[];
 class ClockDate extends Date {static now(){return clock.now;}}
 const schedule=(fn,ms)=>{const id=++clock.next;clock.timers.set(id,{fn,at:clock.now+ms});return id;};
 const clear=id=>clock.timers.delete(id);
 const bridge={start:async()=>{},request:async(input,signal)=>{calls.push(structuredClone(input));return request(input,signal,calls.length,clock);}};
 const Protocol=new Function('Capacitor','browserBridge','nativeBridge','unavailableBridge','ownerRouteGroup','ownerRouteAllowed','anyAbortSignal','Date','setTimeout','clearTimeout',classCode+';return LocalAgentProtocol;')({isNativePlatform:()=>false},bridge,{}, {},ownerRouteGroup,ownerRouteAllowed,anyAbortSignal,ClockDate,schedule,clear);
 const client=new Protocol(bridge);client.session={ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.invalid'};
 async function run(promise){
  let done=false,value,error;promise.then(result=>{done=true;value=result;},cause=>{done=true;error=cause;});
  for(let turn=0;!done&&turn<512;turn++){
   for(let i=0;i<30;i++)await Promise.resolve();
   if(done)break;
   const next=[...clock.timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
   assert.ok(next,'Synthetic protocol stalled without an owned timer');
   const [id,timer]=next;clock.now=timer.at;clock.beforeTick?.();
   if(clock.timers.delete(id))timer.fn();
  }
  assert.equal(done,true,'Protocol exceeded the existing logical deadline');
  if(error)throw error;return value;
 }
 return {client,calls,clock,run};
}
const path='/api/lifeops/calendar/feed?side=owner&timeZone=UTC';
test('a canonical pending record read survives until its handler registers without changing request identity',async()=>{
 const f=fixture((_input,_signal,count)=>count<3?pending():ok({fixtureReady:true}));
 assert.deepEqual(await f.run(f.client.request(path,undefined,new AbortController().signal)),{fixtureReady:true});
 assert.equal(f.calls.length,3);assert.equal(f.clock.now,2000);
 const identity=({timeoutMs,...rest})=>rest;
 assert.deepEqual(identity(f.calls[1]),identity(f.calls[0]));assert.deepEqual(identity(f.calls[2]),identity(f.calls[0]));assert.equal(f.calls[0].method,'GET');
 assert.equal(f.clock.timers.size,0);
});
test('generic, failed, malformed and unknown feature failures are not retried',async()=>{
 const failures=[{status:503,body:'{}'},pending({code:'feature_unavailable',error:'feature_unavailable',status:'failed',retryable:false}),pending({status:'failed'}),pending({status:'unknown'}),pending({phase:'unknown'}),pending({status:'runtime_starting',phase:'agent-deferred-boot'}),pending({retryable:'true'}),pending({retryAfter:-1}),{status:503,body:'not-json'}];
 for(const failure of failures){const f=fixture(()=>failure);await assert.rejects(f.run(f.client.request(path,undefined,new AbortController().signal)),error=>error.status===503);assert.equal(f.calls.length,1);assert.equal(f.clock.timers.size,0);}
});
test('feature-starting mutations are not reissued and accepted or pending success outcomes stay unchanged',async()=>{
 const route='/api/lifeops/calendar/events',body={title:'Synthetic only'};
 const f=fixture(()=>pending());await assert.rejects(f.run(f.client.request(route,body,new AbortController().signal,{},'POST')),error=>error.status===503);assert.equal(f.calls.length,1);
 for(const value of [{outcome:'accepted_without_readback'},{status:'pending'},{code:'feature_starting',retryable:true}]){const g=fixture(()=>ok(value));assert.deepEqual(await g.run(g.client.request(route,body,new AbortController().signal,{},'POST')),value);assert.equal(g.calls.length,1);}
 const outside=fixture(()=>pending());await assert.rejects(outside.run(outside.client.request('/api/status',undefined,new AbortController().signal)),error=>error.status===503);assert.equal(outside.calls.length,1);
});
test('caller cancellation before or during deferred registration never issues another read',async()=>{
 const first=new AbortController();first.abort(new DOMException('Cancelled','AbortError'));const a=fixture(()=>pending());await assert.rejects(a.run(a.client.request(path,undefined,first.signal)),{name:'AbortError'});assert.equal(a.calls.length,0);
 const controller=new AbortController(),f=fixture(()=>pending());f.clock.beforeTick=()=>controller.abort(new DOMException('Changed query','AbortError'));
 await assert.rejects(f.run(f.client.request(path,undefined,controller.signal)),{name:'AbortError'});assert.equal(f.calls.length,1);assert.equal(f.clock.timers.size,0);
});
test('a replaced owner or same-owner session cannot borrow the pending read',async()=>{
 for(const ownerId of ['fixture-owner','different-owner']){const f=fixture(()=>pending());f.clock.beforeTick=()=>{f.client.session={...f.client.session,ownerId,sessionId:'replacement'};};await assert.rejects(f.run(f.client.request(path,undefined,new AbortController().signal)),/connection changed/);assert.equal(f.calls.length,1);assert.equal(f.clock.timers.size,0);}
});
test('the original logical deadline bounds a pending handler and a stalled retry',async()=>{
 const f=fixture(()=>pending());await assert.rejects(f.run(f.client.request(path,undefined,new AbortController().signal)),error=>error.status===503||error.name==='TimeoutError');assert.ok(f.clock.now<=120000);assert.ok(f.calls.length<=121);assert.equal(f.clock.timers.size,0);
 const g=fixture((_input,_signal,count)=>count===1?pending():new Promise(()=>{}));await assert.rejects(g.run(g.client.request(path,undefined,new AbortController().signal)),{name:'TimeoutError'});assert.equal(g.calls.length,2);assert.equal(g.clock.now,120000);assert.equal(g.clock.timers.size,0);
});
test('numeric body Retry-After is clamped while the absent loopback header uses the canonical one-second default',async()=>{
 for(const [hint,expected] of [[undefined,1000],[0,250],[100,5000]]){const f=fixture((_input,_signal,count)=>count===1?pending(hint===undefined?{}:{retryAfter:hint}):ok({ready:true}));await f.run(f.client.request(path,undefined,new AbortController().signal));assert.equal(f.clock.now,expected);assert.equal(f.calls.length,2);assert.equal(f.clock.timers.size,0);}
});

test('the real WebView AbortSignal.any fallback releases caller listeners after every read attempt',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(AbortSignal,'any');
 Object.defineProperty(AbortSignal,'any',{configurable:true,writable:true,value:undefined});
 try{
  for(const heldRetry of [false,true]){
   const controller=new AbortController(),signal=controller.signal,active=new Set();
   const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
   signal.addEventListener=(type,listener,options)=>{if(type==='abort')active.add(listener);return add(type,listener,options);};
   signal.removeEventListener=(type,listener,options)=>{if(type==='abort')active.delete(listener);return remove(type,listener,options);};
   const f=fixture((_input,_signal,count)=>count===1?pending():heldRetry?new Promise(()=>{}):count<4?pending():ok({ready:true}));
   const request=f.run(f.client.request(path,undefined,signal));
   if(heldRetry)await assert.rejects(request,{name:'TimeoutError'});else assert.deepEqual(await request,{ready:true});
   assert.equal(signal.aborted,false,'attempt cleanup never aborts its caller');assert.equal(active.size,0);assert.equal(f.clock.timers.size,0);
  }
 }finally{if(descriptor)Object.defineProperty(AbortSignal,'any',descriptor);else delete AbortSignal.any;}
});
