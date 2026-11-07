import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { usableNavigationFix } from '../apps/app/src/maps/navigation-fix.ts';
import { MapsController } from '../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import { SavedPlaces } from '../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
import { MapsFailure, coordinate, failure } from '../.eliza/client-features/plugins/plugin-maps/src/client/contracts.ts';
import { distanceToRoute, routeProgress } from '../apps/app/src/maps/route-distance.ts';
import { atStep, guidanceView } from '../apps/app/src/maps/guidance.ts';

const ORIGIN = {latitude: 43.73, longitude: 7.42};
const END = {latitude: 43.74, longitude: 7.42};
const OFF_ROUTE = {latitude: 43.735, longitude: 7.43};
const source = stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/prototype/maps-adapter.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function installPrototypeMapsAdapter', 'function installPrototypeMapsAdapter'), {mode: 'strip'});

// Execute the actual adapter/render callbacks with the real shared controller. Only device,
// DOM and provider boundaries are fixtures: this does not establish physical GPS acceptance.
async function fixture(options = {}) {
 let now = Date.now(), surface, receiveFix;
 const requests = [];
 // Route requests listed in options.fail (1-based) are refused by the provider.
 const fail = new Set(options.fail || []);
 const timers = options.timers || {setTimeout, clearTimeout};
 const config = {status:'configured',providerId:'fixture',connectionId:'conn_fixture_123456789',revision:'1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
 const place = {providerId:'fixture',id:'destination',name:'Destination',coordinate:END,attribution:'Fixture',fetchedAt:now};
 const provider = {providerId:'fixture',connectionId:'conn_fixture_123456789',detail:async()=>place,search:async()=>[place],route:async(from,to,mode)=>{
  requests.push(from);
  if (fail.has(requests.length)) throw new MapsFailure('unavailable', 'Maps is unavailable right now.');
  return {providerId:'fixture',id:'route_0123456789abcdef_'+requests.length,from,to,mode,geometry:[from,to],distanceMeters:1200,durationSeconds:300,steps:[{instruction:'Continue',coordinate:to,distanceMeters:1200}],attribution:'Fixture',fetchedAt:now,traffic:'none'};
 }};
 const noop = ()=>{};
 class Location { async start(_prompt, callback) { receiveFix = callback; } async stop() {} awaitingPermission() { return false; } }
 class Background { async start(){return false;} async stop(){} active(){return false;} update(){} }
 class Voice { pause(){} update(){} }
 const storage = {getItem:()=>null,setItem:noop};
 const context = vm.createContext({console,queueMicrotask, setTimeout:timers.setTimeout, clearTimeout:timers.clearTimeout, AbortController,
  readDevicePreferences:async()=>({askBeforeAgentActions:true}),
  usableNavigationFix:fix=>usableNavigationFix(fix,now), coordinate, failure, MapsFailure, distanceToRoute, routeProgress, atStep, guidanceView,
  MapsController:class extends MapsController { constructor(c,p){super(c,p,new SavedPlaces('freshness',storage),new Location());} },
  locationPermissionGranted:async()=>true,NativeMapsLocation:Location,BackgroundNavigation:Background,NavigationVoice:Voice,registerPlugin:()=>({}),Capacitor:{isNativePlatform:()=>false},isAndroid:false,
  regionalMapsConfigured:false,initializeCloudMaps:async()=>{},cloudMapsConnecting:()=>undefined,connectionController:{getCloudClient:()=>({sessionId:'fixture'}),getSnapshot:()=>({open:false})},regionalMap:()=>undefined,cloudMapsCoverage:()=>undefined,cloudMapsDiagnostics:()=>({}),globalBasemap:{attribution:'Fixture'},
  mapsConnection:()=>({config,provider}),onMapsConnectionChange:()=>noop,
  bindAgentNavigation:options=>{surface=options.surface;return {dispose:noop,registered:()=>true};},residentMapsNavigationPort:{relay:false},
  publishMapsSelection:noop,clearMapsSelection:noop,mapsEventReturnOffered:()=>undefined,
  window:{addEventListener:noop,removeEventListener:noop},document:{hidden:false,addEventListener:noop,removeEventListener:noop},
 });
 vm.runInContext(source+';globalThis.install=installPrototypeMapsAdapter;',context);
 const views={maps:{render:()=>({cats:[],nativeModeMetadata:[]})}};
 const dispose=context.install({prototype:{renderVals:noop}},views);
 const api={isActive:()=>true,set:noop,get:()=>({}),S:{stack:[]}};
 const render=()=>views.maps.render({},api);
 render();
 const fix=(overrides={})=>({coordinate:OFF_ROUTE,accuracyMeters:8,precision:'precise',timestamp:now,...overrides});
 if(options.navigate===false)return {surface,render,requests,fix,emit:value=>receiveFix(value),dispose,place};
 await surface.showDirections(place,'drive',false);
 await surface.planFrom(ORIGIN);
 assert.equal(surface.snapshot().route.phase,'ready',surface.snapshot().route.error?.message);
 render().dr.start();
 await Promise.resolve();
 return {surface,render,requests,fix,emit:value=>receiveFix(value),advance:ms=>{now+=ms;},dispose,place};
}

test('actual Maps UI refuses an aged reroute callback and preserves the exact active route', async()=>{
 const f=await fixture();
 try {
  f.emit(f.fix());
  const button=f.render().dr.nav;
  assert.equal(button.canReroute,true);
  const previous=f.surface.snapshot().route.value;
  f.advance(30_001); // No GPS event: even a callback retained from the previous render must recheck.
  button.reroute();
  assert.equal(f.requests.length,1);
  assert.equal(f.surface.snapshot().route.value,previous);
  assert.equal(f.surface.guidance().routeId,previous.id);
  assert.equal(f.surface.guidance().rerouting,false);
  assert.equal(f.render().dr.nav.canReroute,false);
  assert.match(f.render().nativeStatus,/current route is kept/);
  f.emit(f.fix());
  assert.equal(f.requests.length,1,'fresh GPS does not reroute automatically');
  f.render().dr.nav.reroute();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,2);
  assert.notEqual(f.surface.snapshot().route.value,previous);
  assert.equal(f.surface.guidance().routeId,f.surface.snapshot().route.value.id);
 } finally { f.dispose(); }
});

/** Manual timers: the retry delay is driven by the test, never by wall-clock time. */
function manualTimers() {
 let next = 1; const pending = new Map();
 return {pending,
  setTimeout:(callback,ms)=>{const id=next++;pending.set(id,{callback,ms});return id;},
  clearTimeout:id=>{pending.delete(id);},
  fire(){const entries=[...pending];pending.clear();for(const [,timer] of entries)timer.callback();return entries.map(([,timer])=>timer.ms);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a failed reroute keeps the route being followed and tries again', async()=>{
 const timers=manualTimers(), f=await fixture({fail:[2],timers});
 try {
  f.emit(f.fix());
  const original=f.surface.guidance().routeId;
  f.render().dr.nav.reroute();
  await settle();
  assert.equal(f.requests.length,2);
  const kept=f.surface.guidance();
  assert.ok(kept,'guidance continues');
  assert.equal(kept.routeId,original,'the route being followed is kept');
  assert.equal(kept.rerouting,false);
  const view=f.render();
  assert.equal(view.dr.nav.going,true);
  assert.equal(view.nativeStatus,'Couldn’t get a new route. Keeping the current route and trying again.');
  assert.equal(view.nativeStatusVisible,true);
  assert.match(view.dr.min,/min$/,'the route sheet still shows the followed route');
  // Still off route: guidance keeps measuring against the kept route and its notice stays.
  f.emit(f.fix());
  assert.equal(f.render().nativeStatus,'Couldn’t get a new route. Keeping the current route and trying again.');
  assert.equal(f.render().dr.nav.offRoute,true);
  // Exactly one automatic retry, from the latest precise fix.
  assert.deepEqual(timers.fire(),[10_000]);
  await settle();
  assert.equal(f.requests.length,3,'one automatic retry');
  assert.equal(timers.pending.size,0,'a successful retry schedules nothing more');
  const next=f.surface.guidance();
  assert.notEqual(next.routeId,original,'the retried route replaces the kept one');
  assert.equal(next.routeId,f.surface.snapshot().route.value.id);
  assert.equal(f.render().nativeStatus,'New route ready.');
 } finally { f.dispose(); }
});

test('a retry stops when guidance ends or the device is back on the route', async()=>{
 {
  const timers=manualTimers(), f=await fixture({fail:[2],timers});
  try {
   f.emit(f.fix());f.render().dr.nav.reroute();await settle();
   assert.equal(timers.pending.size,1);
   f.render().dr.nav.end();
   assert.equal(timers.pending.size,0,'End cancels the retry');
   assert.equal(f.surface.guidance(),null);
  } finally { f.dispose(); }
 }
 {
  const timers=manualTimers(), f=await fixture({fail:[2,3],timers});
  try {
   f.emit(f.fix());f.render().dr.nav.reroute();await settle();
   assert.deepEqual(timers.fire(),[10_000]);await settle();
   assert.equal(f.requests.length,3);
   assert.equal(f.surface.guidance().rerouting,false);
   // A second failure waits longer before the next attempt.
   assert.deepEqual([...timers.pending.values()].map(timer=>timer.ms),[20_000]);
   f.emit(f.fix({coordinate:ORIGIN}));
   assert.equal(f.render().dr.nav.offRoute,false);
   timers.fire();await settle();
   assert.equal(f.requests.length,3,'back on the route: no further request');
   assert.equal(timers.pending.size,0);
   assert.ok(f.surface.guidance(),'guidance continues on the kept route');
  } finally { f.dispose(); }
 }
});

test('approximate or inaccurate updates invalidate an older precise fix without replacing the route', async()=>{
 for(const update of [{accuracyMeters:900},{precision:'approximate',accuracyMeters:8}]) {
  const f=await fixture();
  try {
   f.emit(f.fix());
   const callback=f.render().dr.nav.reroute;
   const previous=f.surface.snapshot().route.value;
   f.emit(f.fix(update));
   assert.equal(f.surface.guidance().fix,undefined);
   callback();
   assert.equal(f.render().dr.nav.canReroute,false);
   assert.equal(f.requests.length,1);
   assert.equal(f.surface.snapshot().route.value,previous);
   assert.equal(f.surface.guidance().routeId,previous.id);
   f.emit(f.fix());
   assert.equal(f.render().dr.nav.canReroute,true);
  } finally { f.dispose(); }
 }
});

test('a starting point the user typed or chose is kept when a late GPS fix arrives', async()=>{
 const TYPED={latitude:43.735,longitude:7.43};
 for(const [label,expected,text] of [['typed',TYPED,'43.735, 7.43'],['chosen',END,'Destination']]){
  const f=await fixture({navigate:false});
  try {
   await f.surface.showPlace(f.place,false);
   // Directions asks for the device's location; the user sets a starting point before it arrives.
   f.render().pc.dirs();
   f.render().onOrigin({target:{value:label==='typed'?text:'Harbour'}});
   f.render().originKey({key:'Enter',preventDefault(){}});
   await settle();
   // A searched place is chosen from the results.
   if(label==='chosen'){f.render().results[0].go();await settle();}
   assert.equal(f.surface.snapshot().route.phase,'ready',label);
   assert.deepEqual(f.surface.snapshot().route.value.from,expected,label);
   f.emit(f.fix({coordinate:ORIGIN}));
   await settle();
   const view=f.render();
   assert.equal(view.originText,text,`${label}: the starting point text stays`);
   assert.deepEqual(f.surface.snapshot().origin,expected,`${label}: the user's starting point stays the origin`);
   assert.equal(f.surface.snapshot().route.phase,'ready',label);
   assert.deepEqual(f.surface.snapshot().route.value.from,expected,`${label}: the route is planned from the user's point, not the late fix`);
   assert.ok(f.requests.every(from=>from.latitude===expected.latitude&&from.longitude===expected.longitude),`${label}: no route was planned from the device`);
  } finally { f.dispose(); }
 }
});

test('editing the starting point cancels a pending location request', async()=>{
 const f=await fixture({navigate:false});
 try {
  await f.surface.showPlace(f.place,false);
  f.render().pc.dirs();
  assert.equal(f.render().nativeLocationBusy,true);
  f.render().onOrigin({target:{value:'Harbour'}});
  assert.equal(f.render().nativeLocationBusy,false);
  f.emit(f.fix({coordinate:ORIGIN}));
  await settle();
  assert.equal(f.render().originText,'Harbour','the text being typed is not replaced by “Your location”');
  assert.equal(f.surface.snapshot().origin,null,'the late fix is not left as the origin');
  assert.equal(f.requests.length,0,'nothing was planned from the device');
 } finally { f.dispose(); }
});

test('shared navigation predicate rejects malformed, stale, future and approximate positions',()=>{
 const now=100_000, fix={timestamp:now,accuracyMeters:8,precision:'precise'};
 assert.equal(usableNavigationFix(fix,now),true);
 for(const changes of [{timestamp:now-30_001},{timestamp:now+5_001},{timestamp:NaN},{accuracyMeters:NaN},{accuracyMeters:-1},{accuracyMeters:51},{precision:'approximate'},{precision:'unknown'},{precision:undefined}])
  assert.equal(usableNavigationFix({...fix,...changes},now),false);
});
