import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
// The agent gets the phone's position through the launcher's own location permission:
// read with checkPermissions, never requested, and sent only to a peer that declares the field.
const [{PhoneLocationReader,PHONE_LOCATION_REUSE_MS,PHONE_LOCATION_STALE_MS,PHONE_LOCATION_WAIT_MS},{sanitizePhoneContext},{ClientObservationSupportCache,ClientObservationSupportSession,contextForObservationSupport}]=await loadBrowserModule(['phone-location','phone-context','client-observation-support'].map(name=>`apps/app/src/runtime/${name}.ts`));

const fix={latitude:37.774929,longitude:-122.419416,accuracy:8.6,timestamp:1_795_000_000_000};
function ports({granted=true,available=true,coords=fix,now=fix.timestamp+1000,hang=false}={}){
 const calls={check:0,read:0,request:0,options:[]};
 const state={granted,coords,now,hang};
 return {calls,state,ports:{available:()=>available,now:()=>state.now,bridge:{
  checkPermissions:async()=>{calls.check++;return {location:state.granted?'granted':'prompt'};},
  requestPermissions:async()=>{calls.request++;throw Error('a chat turn never prompts');},
  getCurrentPosition:options=>{calls.read++;calls.options.push(options);return state.hang?new Promise(()=>{}):state.coords?Promise.resolve({coords:state.coords,cached:false}):Promise.reject(Error('no fix'));},
 }}};
}
const signal=()=>new AbortController().signal;

test('a granted launcher reports a rounded, canonical last known position',async()=>{
 const {ports:p,calls}=ports(),reader=new PhoneLocationReader(p);
 assert.deepEqual(await reader.read(signal()),{latitude:37.77493,longitude:-122.41942,accuracyMeters:9,capturedAt:fix.timestamp});
 assert.equal(calls.request,0);
 assert.equal(calls.options[0].maxAge>0,true,'the platform may answer from its cached fix');
 // A fresh fix is reused without another platform read.
 await reader.read(signal());assert.equal(calls.read,1);
});

test('without the permission or the native plugin nothing is read or prompted',async()=>{
 for(const options of [{granted:false},{available:false}]){
  const {ports:p,calls}=ports(options);
  assert.equal(await new PhoneLocationReader(p).read(signal()),undefined);
  assert.equal(calls.read,0);assert.equal(calls.request,0);
 }
 // Revoking the permission forgets an earlier fix.
 const {ports:p,state}=ports(),reader=new PhoneLocationReader(p);
 assert.ok(await reader.read(signal()));
 state.granted=false;assert.equal(await reader.read(signal()),undefined);
 state.granted=true;state.coords=undefined;state.now+=PHONE_LOCATION_REUSE_MS+1;
 assert.equal(await reader.read(signal()),undefined);
});

test('a slow fix never holds the turn, and an old fix eventually stops being reported',async()=>{
 const {ports:p,state}=ports(),reader=new PhoneLocationReader(p);
 assert.ok(await reader.read(signal()));
 state.hang=true;state.now+=PHONE_LOCATION_REUSE_MS+1;
 const started=Date.now(),earlier=await reader.read(signal());
 assert.ok(Date.now()-started<PHONE_LOCATION_WAIT_MS+1000);
 assert.equal(earlier.capturedAt,fix.timestamp,'the earlier fix stands in while it is recent');
 state.now=fix.timestamp+PHONE_LOCATION_STALE_MS+1;
 assert.equal(await reader.read(signal()),undefined);
 const cancelled=new AbortController();cancelled.abort();
 await assert.rejects(reader.read(cancelled.signal),{name:'AbortError'});
});

test('the sanitizer keeps only a valid position',()=>{
 const base={view:'home',revision:4,sensitive:false};
 const location={latitude:37.77493,longitude:-122.41942,accuracyMeters:9,capturedAt:fix.timestamp};
 assert.deepEqual(sanitizePhoneContext({...base,location}).location,location);
 assert.equal('location' in sanitizePhoneContext(base),false);
 for(const bad of [{...location,latitude:120},{...location,address:'1 Market St'},{latitude:1,longitude:2}])assert.throws(()=>sanitizePhoneContext({...base,location:bad}));
 assert.throws(()=>sanitizePhoneContext({...base,sensitive:true,location}));
});

test('the position goes only to a peer that declares the location field',async()=>{
 const binding={origin:'https://agent.example',ownerId:'owner',agentId:'agent',sessionId:'session',connectionEpoch:2,serverInstanceId:'11111111-1111-4111-8111-111111111111'};
 const status=fields=>({serverInstanceId:binding.serverInstanceId,clientTurnObservationSupport:{version:1,optionalFields:fields}});
 const location={latitude:1,longitude:2,capturedAt:3};
 const context={view:'home',revision:1,sensitive:false,location};
 const cache=new ClientObservationSupportCache();
 assert.equal(cache.admit(status(['calendarDay']),binding),true);
 assert.equal('location' in contextForObservationSupport(context,cache,binding),false);
 assert.equal(cache.admit(status(['calendarDay','location']),binding),true);
 assert.deepEqual(contextForObservationSupport(context,cache,binding).location,location);
 const {connectionEpoch,serverInstanceId,...session}=binding;
 for(const [fields,expected] of [[['calendarDay'],undefined],[['calendarDay','location'],location]]){
  const peer=new ClientObservationSupportSession({...session,connectionEpoch},()=>true,async()=>status(fields));
  assert.deepEqual((await peer.context(context,signal())).location,expected,JSON.stringify(fields));
 }
});
