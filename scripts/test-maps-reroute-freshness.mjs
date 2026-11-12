import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from '../test/support/strip-types.mjs';
import { usableNavigationFix } from '../.eliza/client-features/plugins/plugin-maps/src/client/navigation-fix.ts';
import { MapsController } from '../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import { SavedPlaces } from '../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
import { MapsFailure, coordinate, failure } from '../.eliza/client-features/plugins/plugin-maps/src/client/contracts.ts';
import { distanceToRoute, routeProgress } from '../apps/app/src/maps/route-distance.ts';
import { atStep, guidanceView } from '../apps/app/src/maps/guidance.ts';
import { MapsScreenController } from '../apps/app/src/maps/screen.ts';

const ORIGIN = {latitude: 43.73, longitude: 7.42};
const END = {latitude: 43.74, longitude: 7.42};
const OFF_ROUTE = {latitude: 43.735, longitude: 7.43};
const source = stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/prototype/maps-adapter.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'strip'});

// Execute the actual adapter/render callbacks with the real shared screen and domain controllers.
// Only device, DOM and provider boundaries are fixtures: this does not establish physical GPS acceptance.
const realNow = Date.now;
async function fixture() {
 let now = realNow(), surface, receiveFix;
 Date.now = () => now;
 const requests = [];
 const config = {status:'configured',providerId:'fixture',connectionId:'conn_fixture_123456789',revision:'1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
 const place = {providerId:'fixture',id:'destination',name:'Destination',coordinate:END,attribution:'Fixture',fetchedAt:now};
 const provider = {providerId:'fixture',connectionId:'conn_fixture_123456789',detail:async()=>place,search:async()=>[place],route:async(from,to,mode)=>{
  requests.push(from);
  return {providerId:'fixture',id:'route_0123456789abcdef_'+requests.length,from,to,mode,geometry:[from,to],distanceMeters:1200,durationSeconds:300,steps:[{instruction:'Continue',coordinate:to,distanceMeters:1200}],attribution:'Fixture',fetchedAt:now,traffic:'none'};
 }};
 const noop = ()=>{};
 class Location { async start(_prompt, callback) { receiveFix = callback; } async stop() {} awaitingPermission() { return false; } }
 class Background { async start(){return false;} async stop(){} active(){return false;} update(){} }
 class Voice { enabled=true; pause(){} update(){} toggle(){this.enabled=!this.enabled;} }
 const storage = {getItem:()=>null,setItem:noop};
 const context = vm.createContext({console,queueMicrotask, setTimeout, clearTimeout, AbortController,
  MapsScreenController, mapShareLabel:()=> 'Share', shareMap:async()=>'closed', insideCloudCoverage:()=>true, describeMapsDisclosure:()=>'', DailyApps:{}, mapsEventStillThere:()=>false, connectionController:{getSnapshot:()=>({open:false})},
  initializeRegionalMaps:async()=>{}, regionalDiagnostics:()=>({}),
  MapsController:class extends MapsController { constructor(c,p){super(c,p,new SavedPlaces('freshness',storage),new Location());} },
  locationPermissionGranted:async()=>true,NativeMapsLocation:Location,BackgroundNavigation:Background,NavigationVoice:Voice,registerPlugin:()=>({}),Capacitor:{isNativePlatform:()=>false},isAndroid:false,
  regionalMapsConfigured:false,initializeCloudMaps:async()=>{},regionalMap:()=>undefined,cloudMapsCoverage:()=>undefined,cloudMapsBasemap:()=>undefined,cloudMapsDiagnostics:()=>({}),globalBasemap:{attribution:'Fixture'},
  mapsConnection:()=>({config,provider}),onMapsConnectionChange:()=>noop,
  bindAgentNavigation:options=>{surface=options.surface;return {dispose:noop,registered:()=>true};},residentMapsNavigationPort:{relay:false},keepCloudMapsCoverage:()=>noop,
  publishMapsSelection:noop,clearMapsSelection:noop,mapsEventReturnOffered:()=>undefined,
  window:{addEventListener:noop,removeEventListener:noop},document:{hidden:false,addEventListener:noop,removeEventListener:noop},
 });
 vm.runInContext(source+';globalThis.install=installPrototypeMapsAdapter;',context);
 const views={maps:{render:()=>({cats:[],nativeModeMetadata:[]})}};
 const dispose=context.install({prototype:{renderVals:noop}},views);
 const api={isActive:()=>true,set:noop,get:()=>({}),S:{stack:[]}};
 const render=()=>views.maps.render({},api);
 render();
 await surface.showDirections(place,'drive',false);
 await surface.planFrom(ORIGIN);
 assert.equal(surface.snapshot().route.phase,'ready',surface.snapshot().route.error?.message);
 render().dr.start();
 await Promise.resolve();
 const fix=(overrides={})=>({coordinate:OFF_ROUTE,accuracyMeters:8,precision:'precise',timestamp:now,...overrides});
 return {surface,render,requests,fix,emit:value=>receiveFix(value),advance:ms=>{now+=ms;},dispose:()=>{dispose();Date.now=realNow;}};
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
  assert.match(f.render().nativeStatus,/current route was kept/);
  f.emit(f.fix());
  assert.equal(f.requests.length,1,'fresh GPS does not reroute automatically');
  f.render().dr.nav.reroute();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,2);
  assert.notEqual(f.surface.snapshot().route.value,previous);
  assert.equal(f.surface.guidance().routeId,f.surface.snapshot().route.value.id);
 } finally { f.dispose(); }
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

test('shared navigation predicate rejects malformed, stale, future and approximate positions',()=>{
 const now=100_000, fix={timestamp:now,accuracyMeters:8,precision:'precise'};
 assert.equal(usableNavigationFix(fix,now),true);
 for(const changes of [{timestamp:now-30_001},{timestamp:now+5_001},{timestamp:NaN},{accuracyMeters:NaN},{accuracyMeters:-1},{accuracyMeters:51},{precision:'approximate'},{precision:'unknown'},{precision:undefined}])
  assert.equal(usableNavigationFix({...fix,...changes},now),false);
});
