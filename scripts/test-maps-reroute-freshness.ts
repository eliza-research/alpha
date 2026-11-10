import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { prototypeScript } from './fixtures/prototype-script.ts';
import { usableNavigationFix } from '../.eliza/client-features/plugins/plugin-maps/src/client/navigation-fix.ts';
import { MapsController } from '../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import { SavedPlaces } from '../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
import type { Coordinate, MapsProvider, Place, ProviderConfig } from '../.eliza/client-features/plugins/plugin-maps/src/client/contracts.ts';
import type { MapsLocation, Position } from '../.eliza/client-features/plugins/plugin-maps/src/client/location.ts';
import type { MapsNavigationSurface } from '../apps/app/src/maps/device-navigation.ts';
import { MapsScreenController } from '../apps/app/src/maps/screen.ts';

const ORIGIN = {latitude: 43.73, longitude: 7.42};
const END = {latitude: 43.74, longitude: 7.42};
const OFF_ROUTE = {latitude: 43.735, longitude: 7.43};
const source = await prototypeScript('maps-adapter.ts', 'installPrototypeMapsAdapter');
type FixtureRender = {
 cats: unknown[];
 nativeModeMetadata: unknown[];
 nativeStatus: string;
 dr: { start(): void; nav: { canReroute: boolean; reroute(): void } };
};

// Execute the actual adapter/render callbacks with the real shared screen and domain controllers.
// Only device, DOM and provider boundaries are fixtures: this does not establish physical GPS acceptance.
const realNow = Date.now;
async function fixture() {
 let now = realNow();
 const bindings: { surface?: MapsNavigationSurface; receiveFix?: (position: Position) => void } = {};
 Date.now = () => now;
 const requests: Coordinate[] = [];
 const config: ProviderConfig = {status:'configured',providerId:'fixture',connectionId:'conn_fixture_123456789',revision:'1',capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
 const place: Place = {providerId:'fixture',id:'destination',name:'Destination',coordinate:END,attribution:'Fixture',fetchedAt:now};
 const provider: MapsProvider = {providerId:'fixture',connectionId:'conn_fixture_123456789',detail:async()=>place,search:async()=>[place],route:async(from,to,mode)=>{
  requests.push(from);
  return {providerId:'fixture',id:'route_0123456789abcdef_'+requests.length,from,to,mode,geometry:[from,to],distanceMeters:1200,durationSeconds:300,steps:[{instruction:'Continue',coordinate:to,distanceMeters:1200}],attribution:'Fixture',fetchedAt:now,traffic:'none'};
 }};
 const noop = ()=>{};
 class Location implements MapsLocation { async start(_prompt: boolean, callback: (position: Position) => void) { bindings.receiveFix = callback; } async stop() {} awaitingPermission() { return false; } }
 class Background { async start(){return false;} async stop(){} active(){return false;} update(){} }
 class Voice { enabled=true; pause(){} update(){} toggle(){this.enabled=!this.enabled;} }
 const storage = {getItem:()=>null,setItem:noop};
 const context = vm.createContext({console,queueMicrotask, setTimeout, clearTimeout, AbortController,
  MapsScreenController, shareMap:async()=>'closed', insideCloudCoverage:()=>true, describeMapsDisclosure:()=>'', DailyApps:{}, mapsEventStillThere:()=>false, connectionController:{getSnapshot:()=>({open:false})},
  initializeRegionalMaps:async()=>{}, regionalDiagnostics:()=>({}),
  MapsController:class extends MapsController { constructor(c: ProviderConfig, p?: MapsProvider){super(c,p,new SavedPlaces('freshness',storage),new Location());} },
  locationPermissionGranted:async()=>true,NativeMapsLocation:Location,BackgroundNavigation:Background,NavigationVoice:Voice,registerPlugin:()=>({}),Capacitor:{isNativePlatform:()=>false},isAndroid:false,
  regionalMapsConfigured:false,initializeCloudMaps:async()=>{},regionalMap:()=>undefined,cloudMapsCoverage:()=>undefined,cloudMapsBasemap:()=>undefined,cloudMapsDiagnostics:()=>({}),globalBasemap:{attribution:'Fixture'},
  mapsConnection:()=>({config,provider}),onMapsConnectionChange:()=>noop,
  bindAgentNavigation: (options: { surface: MapsNavigationSurface }) => {bindings.surface=options.surface;return {dispose:noop,registered:()=>true};},residentMapsNavigationPort:{relay:false},keepCloudMapsCoverage:()=>noop,
  publishMapsSelection:noop,clearMapsSelection:noop,mapsEventReturnOffered:()=>undefined,
  window:{addEventListener:noop,removeEventListener:noop},document:{hidden:false,addEventListener:noop,removeEventListener:noop},
 });
 vm.runInContext(source, context);
 const views: { maps: { render(state: object, api: object): Pick<FixtureRender, 'cats' | 'nativeModeMetadata'> } } = {maps:{render:()=>({cats:[],nativeModeMetadata:[]})}};
 const dispose: () => void = context.installPrototypeMapsAdapter({prototype:{renderVals:noop}},views);
 const surface = bindings.surface;
 assert.ok(surface);
 const api={isActive:()=>true,set:noop,get:()=>({}),S:{stack:[]}};
 const render = () => views.maps.render({},api) as FixtureRender;
 render();
 await surface.showDirections(place,'drive',false);
 await surface.planFrom(ORIGIN);
 const planned = surface.snapshot()?.route;
 assert.equal(planned?.phase,'ready',planned?.error?.message ?? 'Expected a ready route');
 render().dr.start();
 await Promise.resolve();
 const fix = (overrides: Partial<Position> = {}): Position => ({coordinate:OFF_ROUTE,accuracyMeters:8,precision:'precise',timestamp:now,...overrides});
 const currentRoute = () => { const route = surface.snapshot()?.route.value; assert.ok(route); return route; };
 const guidance = () => { const active = surface.guidance(); assert.ok(active); return active; };
 const emit = (position: Position) => { assert.ok(bindings.receiveFix); bindings.receiveFix(position); };
 return {render,requests,fix,currentRoute,guidance,emit,advance:(ms: number)=>{now+=ms;},dispose:()=>{dispose();Date.now=realNow;}};
}

test('actual Maps UI refuses an aged reroute callback and preserves the exact active route', async()=>{
 const f=await fixture();
 try {
  f.emit(f.fix());
  const button=f.render().dr.nav;
  assert.equal(button.canReroute,true);
  const previous=f.currentRoute();
  f.advance(30_001); // No GPS event: even a callback retained from the previous render must recheck.
  button.reroute();
  assert.equal(f.requests.length,1);
  assert.equal(f.currentRoute(),previous);
  assert.equal(f.guidance().routeId,previous.id);
  assert.equal(f.guidance().rerouting,false);
  assert.equal(f.render().dr.nav.canReroute,false);
  assert.match(f.render().nativeStatus,/current route was kept/);
  f.emit(f.fix());
  assert.equal(f.requests.length,1,'fresh GPS does not reroute automatically');
  f.render().dr.nav.reroute();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,2);
  assert.notEqual(f.currentRoute(),previous);
  assert.equal(f.guidance().routeId,f.currentRoute().id);
 } finally { f.dispose(); }
});

test('approximate or inaccurate updates invalidate an older precise fix without replacing the route', async()=>{
 const updates: Partial<Position>[] = [{accuracyMeters:900},{precision:'approximate',accuracyMeters:8}];
 for(const update of updates) {
  const f=await fixture();
  try {
   f.emit(f.fix());
   const callback=f.render().dr.nav.reroute;
   const previous=f.currentRoute();
   f.emit(f.fix(update));
   assert.equal(f.guidance().fix,undefined);
   callback();
   assert.equal(f.render().dr.nav.canReroute,false);
   assert.equal(f.requests.length,1);
   assert.equal(f.currentRoute(),previous);
   assert.equal(f.guidance().routeId,previous.id);
   f.emit(f.fix());
   assert.equal(f.render().dr.nav.canReroute,true);
  } finally { f.dispose(); }
 }
});

test('shared navigation predicate rejects malformed, stale, future and approximate positions',()=>{
 const now=100_000, fix: Position = {coordinate: OFF_ROUTE,timestamp:now,accuracyMeters:8,precision:'precise'};
 assert.equal(usableNavigationFix(fix,now),true);
 const invalidChanges: Partial<Position>[] = [{timestamp:now-30_001},{timestamp:now+5_001},{timestamp:NaN},{accuracyMeters:NaN},{accuracyMeters:-1},{accuracyMeters:51},{precision:'approximate'},{precision:'unknown'},{precision:undefined}];
 for(const changes of invalidChanges)
  assert.equal(usableNavigationFix({...fix,...changes},now),false);
});
