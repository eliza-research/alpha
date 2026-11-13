/** Bounded source projections for the screen-mode and guidance/readback models.
 * Provider, GPS, voice and native-session boundaries are closed asynchronous ports.
 * The screen, state controller and device-navigation readback are the real implementation. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {action,deferred,until} from './support.mjs';

const root=fileURLToPath(new URL('../../../../',import.meta.url)),driver=fileURLToPath(import.meta.url);
const shared='.eliza/client-features/plugins/plugin-maps/src/client/';
const fixedNow=Date.now(),providerId='fixture-maps',from={latitude:1,longitude:1},to={latitude:1.01,longitude:1.01};
const fix={coordinate:from,accuracyMeters:5,timestamp:fixedNow,precision:'precise'};
const destination={provider:'coordinates',providerPlaceId:'destination',name:'Destination',coordinates:to};
const place={providerId,id:'destination',name:'Destination',coordinate:to,attribution:'Synthetic provider',fetchedAt:fixedNow};
const config={status:'configured',providerId,connectionId:'conn_fixture_maps_123456',revision:'r1',capabilities:{map:false,search:true,placeDetails:true,modes:['walk','drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function prepared(extraSources,mutant){
 const sources=[driver,'specs/quint/refinement/services/support.mjs','upstream.lock.json','.eliza/client-features/.source.json',
  'apps/app/src/maps/screen.ts','apps/app/src/maps/device-navigation.ts',shared+'maps-screen.ts',shared+'state.ts',shared+'saved-places.ts',...extraSources];
 let hashes=captureInputs(sources);
 const compile=()=>build({stdin:{contents:`export {MapsScreenController} from './apps/app/src/maps/screen.ts';export {DeviceMapsNavigation} from './apps/app/src/maps/device-navigation.ts';export {MapsController} from './${shared}state.ts';export {SavedPlaces} from './${shared}saved-places.ts';`,resolveDir:root,loader:'ts'},bundle:true,write:false,metafile:true,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'source-canary-only',setup(b){
  if(!mutant)return;
  b.onLoad({filter:/\/maps-screen\.ts$/},args=>{
   let text=readFileSync(args.path,'utf8');
   if(mutant==='keep-guidance-after-end'){
    const needle='this.navigating = false;';assert.equal(text.split(needle).length,2,'One actual stop-guidance assignment');text=text.replace(needle,'this.navigating = true;');
   }else if(mutant==='keep-place-after-back'){
    const needle='if (this.selected) {\n      this.selected = undefined;';assert.ok(text.includes(needle),'Actual selected-place Back guard');text=text.replace(needle,'if (this.selected) {\n      this.selected = this.selected;');
   }else if(mutant==='end-guidance-on-view-leave'){
    const needle='if (!this.navigating)\n      void this.controller?.suspend()';assert.equal(text.split(needle).length,2,'One actual view-leave suspension');text=text.replace(needle,'void this.stopGuidance().catch(() => {});\n    '+needle);
   }else throw Error('Unknown Maps source canary');
   return{contents:text,loader:'ts'};
  });
 }}]});
 const bundle=await compile();
 sources.push(...Object.keys(bundle.metafile.inputs).filter(path=>existsSync(join(root,path))));
 const next=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(next[path],hash,'Maps input changed during compilation: '+path);hashes=next;
 // Discovery never authorizes bytes already read before their input hash existed.
 // Compile again against the captured closure and require the exact graph/output.
 const rebuilt=await compile();
 assert.deepEqual(Object.keys(rebuilt.metafile.inputs).sort(),Object.keys(bundle.metafile.inputs).sort(),'Maps dependency graph changed after capture');
 assert.equal(rebuilt.outputFiles[0].text,bundle.outputFiles[0].text,'Maps executable bytes changed after source capture');
 const verified=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(verified[path],hash,'Maps source changed before executable import: '+path);
 const directory=mkdtempSync(join(tmpdir(),'alpha-maps-source-')),input=join(directory,'maps-source.mjs');
 writeFileSync(input,bundle.outputFiles[0].contents);sources.push(input);Object.assign(hashes,captureInputs([input]));
 try{return{module:await import(input),sources,hashes,input,close:()=>rmSync(directory,{recursive:true,force:true})};}catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}

function fixture(module,{background=true,granted=true,direct=false}={}){
 const routes=[],events=[],listeners=new Set(),location={watch:null,failed:null,starts:0,stops:0},agent={starts:0,stops:0};
 let active=true,current=true,nativeRunning=false,nativeStopped,backgroundGate;
 const provider={providerId,connectionId:config.connectionId,async search(){return[place];},async detail(){return place;},async route(origin,target,mode,signal){const row={...deferred(),origin,target,mode,signal,id:'route'+(routes.length+1)+'_fixture_0123456789'};routes.push(row);return row.promise;}};
 const port={awaitingPermission:()=>false,async start(){events.push('origin-location-start');},async stop(){events.push('origin-location-stop');}};
 const host={connection:()=>({config,provider}),onConnectionChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},async initialize(){},diagnostics:()=>({configured:true,error:''}),coverage:()=>undefined,attribution:()=>place.attribution,
  createController:(c,p)=>new module.MapsController(c,p,new module.SavedPlaces('source-fixture',{getItem:()=>null,setItem(){}}),port),
  navigationLocation:{awaitingPermission:()=>false,async start(_once,accept,fail){location.starts++;location.watch=accept;location.failed=fail;},async stop(){location.stops++;location.watch=null;}},
  agentLocation:{awaitingPermission:()=>false,async start(_once,accept){agent.starts++;queueMicrotask(()=>accept(fix));},async stop(){agent.stops++;}},async locationGranted(){return granted;},
  voice:{enabled:true,update(key,text){events.push(['voice',key,text]);},pause(){events.push('voice-pause');},toggle(){}},
  background:{active:()=>nativeRunning,async start(_title,_text,stopped){events.push('background-start');nativeStopped=stopped;if(backgroundGate)await backgroundGate.promise;nativeRunning=background;return background;},update(){events.push('background-update');},async stop(){events.push('background-stop');nativeRunning=false;}},
  async share(){return'closed';},openWebsite(){throw Error('No live website port');},active:()=>active,invalidate(){},toast(text){events.push(['toast',text]);},discardHandoff(){events.push('discard-handoff');},now:()=>fixedNow,
 };
 const screen=new module.MapsScreenController(host);screen.ensure();const surface=screen.surface(async()=>true);
 const nav=new module.DeviceMapsNavigation(surface,{providerId,attribution:place.attribution,current:()=>current,directStart:async()=>direct},{now:()=>fixedNow});
 const controller=()=>screen.ensure();
 return{screen,surface,nav,routes,location,agent,events,controller,
  async settle(index,success=true){const r=routes[index];assert.ok(r,'An actual provider request exists');if(success)r.resolve({providerId,id:r.id,from:r.origin,to:r.target,mode:r.mode,geometry:[r.origin,r.target],distanceMeters:1500,durationSeconds:900,steps:[{instruction:'Continue',coordinate:r.origin,distanceMeters:1500,maneuver:'depart'},{instruction:'Arrive',coordinate:r.target,distanceMeters:0,maneuver:'arrive'}],attribution:place.attribution,fetchedAt:fixedNow,traffic:'none'});else r.reject(Error('Synthetic route unavailable'));await tick();},
  emitFix(){assert.equal(typeof location.watch,'function','Real guidance owns its location callback');location.watch(fix);},
  loseBackground(){nativeRunning=false;nativeStopped('system');},hide(){active=false;screen.hidden();},show(){active=true;},
  // The launcher showing Home or another view: Maps stops being the active view and is told so.
  leaveView(){active=false;screen.leaveView();},
  retire(){current=false;nav.retire();for(const listener of [...listeners])listener();},
  holdBackground(){backgroundGate=deferred();},releaseBackground(){backgroundGate.resolve();},
  async close(){nav.retire();screen.dispose();await tick();},
 };
}

function screenProjection(f){
 const s=f.screen,state=f.controller().snapshot();
 return{'s.searching':s.searching,'s.hasQuery':!!s.query,'s.selected':s.selected?(s.selected.origin==='location'?'location':'place'):'none','s.directions':s.directions,'s.originMode':s.originMode,'s.navigating':s.isNavigating(),'s.locating':s.locating,'s.origin':!!state.origin,'s.routeReady':state.route.phase==='ready'};
}
function guidanceProjection(f){
 const s=f.screen,state=f.controller().snapshot();
 return{'s.guidance':s.isNavigating(),'s.rerouting':s.rerouting,'s.located':!!s.navFix,'s.screenOff':s.backgroundRunning,
  // A pending reroute deliberately retains its admitted route value while the
  // state reports loading. Observe that value, independently of loading UI.
  's.route':state.route.value?f.routes.findIndex(row=>row.id===state.route.value.id)+1:0};
}
async function chooseDestination(f){f.screen.setQuery('Destination');f.screen.submit();await until(()=>f.controller().snapshot().search.phase==='ready','real search');f.screen.choose('place:'+providerId+':destination');await tick();}
async function typedRoute(f){await chooseDestination(f);f.screen.openDirections();f.screen.setOriginText('1, 1');f.screen.planOrigin();await until(()=>f.routes.length===1,'typed-origin route');await f.settle(0);}

export async function checkMapsScreenModes(extraSources=[],options={}){
 const p=await prepared(extraSources,options.mutant),traces=[];
 try{
  for(const mode of ['layers','typed-route','origin-search']){
   const f=fixture(p.module);try{
    const t={name:'actual Maps screen '+mode,expect:screenProjection(f),steps:[]};const point=(label,actions)=>t.steps.push({label,action:actions,expect:screenProjection(f)});
    f.screen.focusQuery();point('real focus draws results',action('focusSearch'));
    f.screen.setQuery('Destination');point('real typed query',action('typeQuery'));
    f.screen.submit();await until(()=>f.controller().snapshot().search.phase==='ready','actual search');point('real provider search submits',action('submitSearch'));assert.equal(f.routes.length,0,'Search must not route');
    f.screen.choose('place:'+providerId+':destination');await tick();point('actual result selection',action('pickResult'));
    if(mode==='layers'){
     f.screen.back();point('Back clears actual selected place',action('back'));assert.equal(f.screen.view().mode,'base','Back must retire selected-place layer');
     f.screen.back();point('Back clears retained query',action('back'));
    }else{
     f.screen.openDirections();point('Directions never request location or routing by themselves',action('openDirections'));assert.equal(f.routes.length,0);assert.equal(f.agent.starts,0);assert.equal(f.location.starts,0);
     f.screen.setOriginText(mode==='origin-search'?'Start':'1, 1');point('real typed origin invalidates route',action('editOrigin',mode!=='origin-search'));
     if(mode==='origin-search'){
      f.screen.planOrigin();await until(()=>f.controller().snapshot().originSearch.phase==='ready','actual origin search');point('origin search opens only origin layer',action('searchOrigin'));
      f.screen.back();point('Back closes only origin search',action('back'));assert.equal(f.screen.view().mode,'directions');
     }else{
      f.screen.planOrigin();await until(()=>f.routes.length===1,'actual typed-origin request');point('real coordinate origin plans without GPS',action('chooseOrigin'));assert.equal(f.agent.starts+f.location.starts,0);
      await f.settle(0);point('actual route publication',action('routePlanned',true));assert.equal(f.screen.view().mode,'directions');
      f.screen.start();await tick();point('Start creates actual guidance',action('start'));assert.equal(f.location.starts,1);
      f.screen.end();await tick();point('End releases actual guidance',action('end'));assert.equal(f.location.stops,1,'End releases one owned guidance watch');
      f.screen.back();point('Back closes directions but preserves place',action('back'));
     }
    }
    traces.push(t);
   }finally{await f.close();}
  }
  const receipt=await checkTraces({model:'MapsScreenModes',sources:p.sources,driverHashes:p.hashes,generatedSources:[p.input],traces,scope:'bounded-orchestration',assumptions:[
   'Actual MapsScreenController and MapsController execute search, selected place, directions, origin search, manual-coordinate planning, Start, End and layered Back. Private TypeScript fields are read without rewriting behavior; public view modes and independent provider/GPS call counts cross-check their state.',
   'Closed deterministic provider, storage, location, voice and background-session ports are not installed integrations. Three explicit schedules project searching, query, selection, directions, origin mode, navigation, locating, origin and route readiness.',
   'hidden, watch, originText, lastChoice and the shell handoff/counter fields are not projected. The starting point is typed before the location permission read settles, so opening directions requests no fix. Cross-app consumption, permission/watch races, native background lifecycle, saved places, agent commands, leaving the view and arbitrary interleavings are replayed from model traces by maps-screen-modes.mjs.',
  ]});
  return{receipt,obligations:[{model:'MapsScreenModes',obligation:'Unobserved shell, location, lifecycle and agent schedules',reason:receipt.assumptions?.at(-1)??'Only three explicit screen-layer schedules are observed.'}]};
 }finally{p.close();}
}

export async function checkMapsNavigationGuidanceReadback(extraSources=[],options={}){
 const p=await prepared(extraSources,options.mutant),traces=[];
 try{
  for(const mode of ['waiting-fix','background-loss','reroute-success','reroute-failure','view-leave','view-leave-session-loss']){
   const f=fixture(p.module);try{
    const t={name:'actual guidance '+mode,expect:guidanceProjection(f),steps:[]};const point=(label,actions)=>t.steps.push({label,action:actions,expect:guidanceProjection(f)});
    await typedRoute(f);point('real explicit origin publishes ready route',[action('requestRoute'),action('chooseOrigin'),action('routeReply',1,0,true)]);
    f.screen.start();point('real Start owns guidance before first fix',action('start'));assert.equal(f.surface.guidance()?.routeId,f.routes[0].id);
    await tick();point('closed native session confirms running',action('screenOffStarted'));assert.equal(f.events.filter(x=>x==='background-start').length,1);
    if(mode==='waiting-fix'){
     assert.equal(f.location.starts,1);assert.equal(f.screen.view().mode,'navigation');
    }else{
     f.emitFix();point('actual guidance watch accepts fresh fix',[action('grantLocation'),action('receiveFix',true)]);
     if(mode==='background-loss'){
      f.loseBackground();point('foreground survives actual native session loss',action('screenOffLost'));assert.equal(f.screen.isNavigating(),true);
     }else if(mode.startsWith('view-leave')){
      f.leaveView();await tick();point('leaving the Maps view keeps actual guidance, its watch and native session',action('leaveMaps'));
      assert.equal(f.screen.isNavigating(),true,'A view switch must keep actual guidance');assert.equal(f.surface.guidance()?.routeId,f.routes[0].id,'A view switch must keep the admitted route');
      assert.equal(f.location.stops,0,'A view switch must keep the guidance watch');assert.equal(f.events.filter(x=>x==='background-stop').length,0,'A view switch must keep the native session');
      if(mode==='view-leave-session-loss'){
       f.loseBackground();await tick();point('native session loss away from Maps releases guidance and route',action('screenOffLost'));
       assert.equal(f.screen.isNavigating(),false);assert.equal(f.surface.guidance(),null);assert.equal(f.location.stops,1,'Release retires the one guidance watch');traces.push(t);continue;
      }
      f.emitFix();point('the guidance watch still delivers away from Maps',action('receiveFix',true));assert.equal(f.screen.isNavigating(),true);
      f.show();point('Maps is shown again with the same guidance',action('openMaps'));assert.equal(f.surface.guidance()?.routeId,f.routes[0].id);
     }else{
      const reroute=f.surface.reroute(from);await until(()=>f.routes.length===2,'actual reroute request');point('actual reroute keeps guidance and route while pending',action('beginReroute'));
      assert.equal(f.surface.guidance()?.routeId,f.routes[0].id,'Pending reroute must retain actual admitted route');
      await f.settle(1,mode==='reroute-success');await reroute;point('actual provider settlement and guidance readback',action('rerouteReply',mode==='reroute-success'));
      assert.equal(f.surface.guidance()?.routeId,f.routes[mode==='reroute-success'?1:0].id,'Readback must name the actually admitted route');
     }
    }
    f.screen.end();await tick();point('actual End retires watch and native session',action('stop'));assert.equal(f.surface.guidance(),null,'End must clear actual guidance readback');assert.equal(f.location.stops,1);assert.equal(f.events.filter(x=>x==='background-stop').length,1);traces.push(t);
   }finally{await f.close();}
  }
  for(const outcome of ['success','failure']){
   const f=fixture(p.module);try{
    const t={name:'retired guidance request '+outcome,expect:{'s.guidance':false},steps:[]};
    const pending=f.nav.start({destination,travelMode:'walk'}).then(value=>({value}),error=>({error}));await until(()=>f.routes.length===1,'actual agent route request');
    t.steps.push({label:'actual agent request has granted fresh location',action:[action('grantLocation'),action('receiveFix',true),action('requestRoute')],expect:{'s.guidance':f.screen.isNavigating()}});
    f.retire();await f.settle(0,outcome==='success');const result=await pending;assert.equal(result.error?.code,'MAPS_PROVIDER_CHANGED');assert.equal(f.screen.isNavigating(),false);assert.equal(f.events.filter(x=>x==='background-start').length,0,'Retired reply must never start native guidance');
    t.steps.push({label:'actual retirement fences the late provider completion',action:action('switchOwner'),expect:{'s.guidance':f.screen.isNavigating(),'s.route':f.screen.state?.route.phase==='ready'?1:0}});traces.push(t);
   }finally{await f.close();}
  }
  const receipt=await checkTraces({model:'MapsNavigationGuidanceReadback',sources:p.sources,driverHashes:p.hashes,generatedSources:[p.input],traces,scope:'bounded-orchestration',assumptions:[
   'The real MapsScreenController, MapsController and DeviceMapsNavigation execute. The projection observes actual guidance, rerouting, fix presence, screen-off flag and provider-route identity allocation; public guidance readback is independently checked against the actual provider replies.',
   'Six manual-origin guidance schedules and two late agent-route retirement schedules use controlled provider replies, GPS callbacks and native-session confirmations. Provider calls and background start/stop/watch counts are independent effects, not inferred model outputs.',
   'Foreground background-session loss, pending/failed/successful reroutes, a launcher view switch during guidance (kept session, later fix, return, and session loss while away) and actual End are observed. The view flag itself is a closed host port (active), not projected. Assistant visibility, every permission/fix-age case, owner preference/direct-start, hidden-page lifecycle, automatic off-route triggers, overlapping owner changes, arbitrary route races and installed integrations remain separate obligations.',
  ]});
  return{receipt,obligations:[{model:'MapsNavigationGuidanceReadback',obligation:'Unobserved full navigation ownership and installed lifecycle',reason:'The explicit projection does not establish assistant visibility, all permission/direct-start/hidden-page schedules or arbitrary races.'}]};
 }finally{p.close();}
}
