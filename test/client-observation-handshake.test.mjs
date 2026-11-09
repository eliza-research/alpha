import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
// The runtime source uses Vite resolution and full TypeScript, so it loads through the Vite-aware fixture.
const {ClientObservationSupportSession}=await loadBrowserModule('apps/app/src/runtime/client-observation-support.ts');

const day={date:'2026-10-29',timeZone:'America/Los_Angeles'};
const session={origin:'https://agent.example',ownerId:'owner',agentId:'agent',sessionId:'session',connectionEpoch:2};
const supported={serverInstanceId:'11111111-1111-4111-8111-111111111111',clientTurnObservationSupport:{version:1,optionalFields:['calendarDay']}};
const context=()=>({view:'calendar',revision:3,sensitive:false,timeZone:day.timeZone,calendarDay:{...day}});
const live=()=>new AbortController().signal;

test('a cancelled first handshake does not stop a later Calendar turn from learning support',async()=>{
 let reads=0,release;
 const peer=new ClientObservationSupportSession(session,()=>true,async signal=>{reads++;if(reads===1)return new Promise((_,reject)=>{release=()=>reject(signal.reason);signal.addEventListener('abort',release,{once:true});});return supported;});
 const first=new AbortController();const handshake=peer.handshake(first.signal);
 first.abort(new DOMException('Cloud account changed','AbortError'));
 await assert.rejects(handshake,error=>error.name==='AbortError');
 assert.deepEqual((await peer.context(context(),live())).calendarDay,day);
 assert.equal(reads,3,'one fresh handshake, then one fresh comparison');
});

test('a turn waiting on another caller\'s handshake returns as soon as its own turn is cancelled',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});
 const peer=new ClientObservationSupportSession(session,()=>true,async()=>waiting);
 const shared=peer.handshake(live());
 const turn=new AbortController();const output=peer.context(context(),turn.signal);
 turn.abort(new DOMException('Turn cancelled','AbortError'));
 await assert.rejects(output,error=>error.name==='AbortError');
 release(supported);await shared;
 assert.deepEqual((await peer.context(context(),live())).calendarDay,day);
});

test('a turn whose shared handshake was cancelled by another caller learns under its own signal',async()=>{
 let reads=0;
 const peer=new ClientObservationSupportSession(session,()=>true,async signal=>{reads++;if(reads===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return supported;});
 const other=new AbortController();const shared=peer.handshake(other.signal);shared.catch(()=>{});
 const output=peer.context(context(),live());
 other.abort(new DOMException('Cloud account changed','AbortError'));
 assert.deepEqual((await output).calendarDay,day);
});

test('a retired session still refuses after a cancelled handshake',async()=>{
 const peer=new ClientObservationSupportSession(session,()=>true,async signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const first=new AbortController();const handshake=peer.handshake(first.signal);
 peer.clear();first.abort();
 await assert.rejects(handshake);
 await assert.rejects(peer.handshake(live()),error=>error.name==='AbortError');
 await assert.rejects(peer.context(context(),live()),/session changed/);
});
