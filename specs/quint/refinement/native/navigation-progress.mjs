import {build} from 'esbuild';
import {existsSync,readFileSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qmap,qset} from '../check-traces.mjs';

const model='NavigationProgress';
const modelPath='specs/quint/native/NavigationProgress.qnt';
const prepared='.eliza/client-features';
const preparedManifest=prepared+'/.source.json';
const maps=prepared+'/plugins/plugin-maps/src/client';
const adapter='apps/app/src/prototype/maps-adapter.ts';
const mapsScreen='plugins/plugin-maps/src/client/maps-screen.ts';
const pinnedMapsScreen='vendor/eliza/'+mapsScreen;
const position=(east,north=0)=>({latitude:north/6371000*180/Math.PI,longitude:east/6371000*180/Math.PI});
const destination=position(500);
const labels=['First','Second','Arrive'];
const points=[100,250,500];
const nativeOwners=[1,2,3,4,5];
const baseTime=1_700_000_000_000;
const flush=async()=>{for(let n=0;n<32;n++)await Promise.resolve();};
function hold(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {resolve,reject,promise};
}
async function captureImplementation(additionalSources=[]){
 const root=resolve('.');
 const options={absWorkingDir:root,stdin:{contents:`
  export {MapsScreenController} from './apps/app/src/maps/screen.ts';
  export {BackgroundNavigation} from './apps/app/src/maps/background-navigation.ts';
  export {MapsController} from './${maps}/state.ts';
  export {SavedPlaces} from './${maps}/saved-places.ts';
  export {usableNavigationFix} from './${maps}/navigation-fix.ts';
 `,resolveDir:root,sourcefile:'quint-maps-guidance.ts'},bundle:true,write:false,platform:'node',format:'esm',metafile:true};
 const discover=await build(options);
 const inputs=Object.keys(discover.metafile.inputs).filter(path=>existsSync(resolve(path)));
 const sources=[...inputs,modelPath,adapter,'upstream.lock.json',preparedManifest,'bun.lock',
  'scripts/prepare-client-features.ts',pinnedMapsScreen,
  fileURLToPath(import.meta.url),...additionalSources];
 const driverHashes=captureInputs(sources);
 const manifest=JSON.parse(readFileSync(preparedManifest,'utf8'));
 const pin=JSON.parse(readFileSync('upstream.lock.json','utf8')).commit;
 if(manifest.baseCommit!==pin)throw Error('Maps source is from a different prepared pin');
 const digest=createHash('sha256').update(readFileSync(pinnedMapsScreen)).digest('hex');
 if(manifest.sourceFiles[mapsScreen]!==digest||manifest.files[mapsScreen]!==digest)
  throw Error('Prepare the pinned Maps screen before checking navigation');
 for(const path of inputs.filter(path=>path.startsWith(prepared+'/'))){
  const expected=manifest.files[relative(prepared,path)];
  if(createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw Error('Unauthenticated Maps input '+path);
 }
 const compiled=await build(options);
 const implementation=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 return {implementation,sources,driverHashes};
}
async function fixture({MapsScreenController,MapsController,SavedPlaces,BackgroundNavigation,usableNavigationFix}){
 let now=baseTime,foreground=true,native=true,permission=false,watch=0,watchStops=0,descriptionChange="unchanged";
 const location=new Map(),availability=new Map(),pendingStarts=new Map(),nativeListeners=new Map(),startDescriptions=new Map();
 const retiredListeners=new Map(),startCommands=[],stopCommands=[],updateCommands=[],updateReplies=[];
 const requests=[],bgIds=new Map();
 const noop=()=>{};
 const locationIdle={start:async()=>{},stop:async()=>{},awaitingPermission:()=>false};
 const navigationLocation={
  async start(prompt,fix,error){if(prompt)throw Error('Guidance must use a permissioned watch');watch=screen.navSession;location.set(watch,{fix,error});},
  async stop(){watch=0;watchStops++;},
  awaitingPermission:()=>permission
 };
 const bgId=uuid=>{if(!bgIds.has(uuid))throw Error('Unowned synthetic native UUID');return bgIds.get(uuid);};
 const bridge={
  navigationAvailability(){
   const session=background.session;
   if(!session)throw Error('Availability called without reservation');
   const id=screen.navSession;bgIds.set(session.id,id);
   const held=hold();availability.set(id,held);return held.promise;
  },
  async addListener(name,callback){
   if(name!=='navigationStopped')throw Error('Unexpected bridge listener');
   const id=bgId(background.session.id);
   nativeListeners.set(id,callback);retiredListeners.set(id,callback);
   return {remove:async()=>{nativeListeners.delete(id);}};
  },
  startNavigation({sessionId,title,text}){
   const id=bgId(sessionId),held=hold();startCommands.push(id);pendingStarts.set(id,held);
   startDescriptions.set(id,{title,text});return held.promise;
  },
  async stopNavigation({sessionId}){stopCommands.push(bgId(sessionId));return {stopped:true};},
  updateNavigation({sessionId}){
   const id=bgId(sessionId),held=hold();updateCommands.push(id);updateReplies.push({id,...held});return held.promise;
  }
 };
 const background=new BackgroundNavigation(bridge,()=>native);
 const backgroundPort={
  active:()=>background.active(),start:(...args)=>background.start(...args),stop:()=>background.stop(),
  update(title,text){
   const current=background.session;
   if(current&&(current.title!==title||current.text!==text)){
    const initial=startDescriptions.get(bgId(current.id));
    descriptionChange=initial?.title===title&&initial?.text===text?'matches-start':'changed';
   }
   background.update(title,text);
  }
 };
 const voice={enabled:true,pause:noop,update:noop,toggle(){this.enabled=!this.enabled;}};
 const config={status:'configured',providerId:'fixture',connectionId:'conn_fixture_123456789',revision:'1',
  capabilities:{map:false,search:true,placeDetails:true,modes:['drive'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}};
 const provider={
  providerId:config.providerId,connectionId:config.connectionId,
  route(from,to,mode,signal){const held=hold();requests.push({from,to,mode,signal,...held});return held.promise;}
 };
 const screen=new MapsScreenController({
  connection:()=>({config,provider}),onConnectionChange:()=>noop,initialize:async()=>{},
  diagnostics:()=>({configured:true,error:''}),coverage:()=>undefined,attribution:()=> 'Fixture',
  createController:(c,p)=>new MapsController(c,p,new SavedPlaces('quint-maps',{getItem:()=>null,setItem:noop}),locationIdle),
  navigationLocation,agentLocation:locationIdle,locationGranted:async()=>true,voice,background:backgroundPort,
  share:async()=> 'closed',openWebsite:noop,active:()=>foreground,invalidate:noop,toast:noop,now:()=>now
 });
 const surface=screen.surface(async()=>true);
 await surface.showDirections({providerId:'fixture',id:'destination',name:'Destination',coordinate:destination,
  attribution:'Fixture',fetchedAt:now},'drive',false);
 const routeId=route=>route?Number(route.id.slice('fixture-route-'.length)):0;
 function finishRoute(request,route){
  const entry=requests[request-1];entry.settled=true;
  const {from,to,mode,resolve}=entry;
  resolve({providerId:'fixture',id:'fixture-route-'+route,from,to,mode,geometry:[from,to],distanceMeters:500,
   durationSeconds:180,steps:points.map((meters,index)=>({instruction:labels[index],coordinate:position(meters),distanceMeters:100})),
   fetchedAt:now,attribution:'Fixture',traffic:'none'});
 }
 const planning=surface.planFrom(position(0));
 await flush();finishRoute(1,1);await planning;
 function observe(){
  const route=screen.state?.route,nav=screen.controller?screen.view().navigation:undefined;
  const session=background.session;
  const description=session&&startDescriptions.get(bgId(session.id));
  return {
   's.foreground':foreground,'s.permission':permission,'s.releases':screen.lifecycle.releases,
   's.selected':!!screen.selected,'s.routePhase':route?.phase??'none','s.route':routeId(route?.value),
   's.routeRequests':requests.length,'s.pendingRoutes':qset(requests.flatMap((request,i)=>request.settled?[]:[i+1])),
   's.abortedRequests':qset(requests.flatMap((request,i)=>request.signal.aborted?[i+1]:[])),
   's.navigating':screen.navigating,'s.navSession':screen.navSession,'s.navRoute':screen.navRouteId?Number(screen.navRouteId.slice('fixture-route-'.length)):0,
   's.navStep':screen.navStep,'s.follow':screen.follow,'s.arrived':screen.arrived,'s.offRoute':screen.offRoute,
   's.rerouting':screen.rerouting,'s.rerouteCleared':screen.rerouteCleared,
   's.fixPresent':!!screen.navFix,'s.fixUsable':usableNavigationFix(screen.navFix,now),'s.accuracy':screen.navFix?.accuracyMeters??-1,
   's.displayedStep':nav?labels.indexOf(nav.instruction):-1,'s.canReroute':nav?.canReroute??false,
   's.watch':watch,'s.watchStops':watchStops,
   's.bridgeGeneration':background.generation,'s.bridgeOwner':session?bgId(session.id):0,
   's.bridgeStage':session?session.started?'running':session.listener?'starting':'availability':'none',
   's.backgroundRunning':screen.backgroundRunning,'s.backgroundStops':screen.lifecycle.backgroundStops,
   's.pendingAvailability':qset([...availability.keys()]),'s.pendingStarts':qset([...pendingStarts.keys()]),
   's.registered':qset([...nativeListeners.keys()]),
   's.bridgeDirty':!!(session&&!session.started&&description&&(session.title!==description.title||session.text!==description.text)),
   's.startCommands':[...startCommands],'s.stopCommands':[...stopCommands],
   's.updateCommands':[...updateCommands],
   's.pendingUpdates':qmap(nativeOwners.map(id=>[id,updateReplies.filter(reply=>reply.id===id).length]))
  };
 }
 return {
  observe,
  async start(nativeEnabled){native=nativeEnabled;screen.start();await flush();},
  async available(id,allowed){const held=availability.get(id);availability.delete(id);held.resolve({background:allowed});await flush();},
  async backgroundAck(id,accepted){
   const held=pendingStarts.get(id);pendingStarts.delete(id);if(accepted)held.resolve();else held.reject(Error('synthetic background refusal'));await flush();
  },
  async backgroundStopped(id,reason){
   const callback=retiredListeners.get(id);
   if(!callback)throw Error('Missing held native listener');
   const uuid=[...bgIds].find(([,owned])=>owned===id)?.[0];
   callback({sessionId:uuid,reason});await flush();
  },
  async updateResult(id,active){
   const index=updateReplies.findIndex(reply=>reply.id===id);
   if(index<0)throw Error('Missing held instruction update');
   updateReplies.splice(index,1)[0].resolve({active});await flush();
  },
  async fix(id,accuracy,precise,age,positionKind){
   descriptionChange="unchanged";
   const point=fixPoints[positionKind];
   if(!point)throw Error('Unknown synthetic fix position');
   location.get(id).fix({coordinate:point,accuracyMeters:accuracy,precision:precise?'precise':'approximate',timestamp:now-age});
   await flush();return descriptionChange;
  },
  async locationFailed(id){location.get(id).error(Error('synthetic watch refused'));await flush();},
  ageFix(){now+=30001;},
  async reroute(){screen.reroute();await flush();},
  async routeResult(request,route){if(route)finishRoute(request,route);else {requests[request-1].settled=true;requests[request-1].reject(Error('synthetic route refused'));}await flush();},
  async end(){screen.end();await flush();},
  async hide(){foreground=false;screen.hidden();await flush();},
  show(){foreground=true;},
  holdPermission(value){permission=value;},
  stopFollowing(){screen.stopFollowing();},
  recenter(){screen.recenter();}
 };
}
const fixPoints={
 'past':position(365),'near-first':position(139),'away-first':position(141),
 'near-second':position(212),'near-arrival':position(476),'away-arrival':position(474),
 'off-76':position(365,76),'off-99':position(365,99),'off-101':position(365,101)
};
export const navigationProgressScenarios={
 maneuver:[['start',false],['fix',1,30,true,0,'past'],['fix',1,30,true,0,'away-first'],['fix',1,30,true,0,'near-first'],['fix',1,30,true,0,'near-second']],
 arrival:[['start',true],['available',1,true],['backgroundAck',1,true],['fix',1,31,true,0,'near-arrival'],['fix',1,30,true,0,'away-arrival'],['fix',1,30,true,0,'near-arrival'],['fix',1,30,true,0,'past'],['end']],
 'off-route-and-stale':[ ['start',false],['fix',1,50,true,0,'off-99'],['fix',1,50,true,0,'off-101'],['ageFix'],['reroute'],
  ['fix',1,30,true,0,'off-76'],['fix',1,30,false,0,'off-76'],['reroute']],
 'successful-reroute':[['start',false],['fix',1,30,true,0,'near-first'],['fix',1,30,true,0,'off-76'],['reroute'],
  ['fix',1,30,true,0,'near-second'],['routeResult',2,2]],
 'failed-reroute':[['start',true],['available',1,true],['backgroundAck',1,true],['fix',1,30,true,0,'off-76'],['reroute'],['routeResult',2,0],['fix',1,30,true,0,'past']],
 'end-during-reroute':[['start',false],['fix',1,30,true,0,'off-76'],['reroute'],['end'],['routeResult',2,2],['start',false],['fix',1,30,true,0,'near-first']],
 'released-reroute':[['start',false],['fix',1,30,true,0,'off-76'],['reroute'],['hide'],['routeResult',2,2]],
 'hidden-pending-background':[['start',true],['hide'],['available',1,true],['backgroundAck',1,true],['backgroundStopped',1,'unavailable']],
 'hidden-availability-refusal':[['start',true],['hide'],['available',1,false]],
 'hidden-start-refusal':[['start',true],['available',1,true],['hide'],['backgroundAck',1,false]],
 'hidden-permission-refusal':[['start',true],['holdPermission',true],['hide'],['available',1,false]],
 'stale-start-refusal':[['start',true],['available',1,true],['end'],['start',true],['available',3,true],
  ['backgroundAck',3,true],['hide'],['backgroundAck',1,false]],
 'foreground-only-hidden':[['start',true],['available',1,false],['hide']],
 'permission-keeps-screen':[['start',false],['holdPermission',true],['hide'],['show'],['holdPermission',false],['hide']],
 'late-native-ack':[['start',true],['available',1,true],['end'],['start',true],['available',3,true],['backgroundAck',3,true],['backgroundAck',1,true],['backgroundStopped',1,'notification']],
 'old-availability':[['start',true],['end'],['start',true],['available',1,true],['available',3,true],['backgroundAck',3,true]],
 'starting-instruction':[['start',true],['available',1,true],['fix',1,30,true,0,'near-first'],['backgroundAck',1,true],['updateResult',1,true]],
 'failed-native-start':[['start',true],['available',1,true],['backgroundAck',1,false],['fix',1,30,true,0,'near-first']],
 'notification-stop':[['start',true],['available',1,true],['backgroundAck',1,true],['backgroundStopped',1,'notification'],['backgroundStopped',1,'notification']],
 'foreground-native-loss':[['start',true],['available',1,true],['backgroundAck',1,true],['fix',1,30,true,0,'near-first'],['fix',1,30,true,0,'near-first'],['updateResult',1,false]],
 'late-native-update':[['start',true],['available',1,true],['backgroundAck',1,true],['fix',1,30,true,0,'near-first'],['end'],
  ['start',true],['available',3,true],['backgroundAck',3,true],['updateResult',1,false]],
 'location-failure-and-stale':[['start',false],['end'],['start',false],['locationFailed',1],['fix',1,30,true,0,'near-arrival'],['locationFailed',3]],
 'freshness-edges':[['start',false],['fix',1,30,true,-5000,'past'],['fix',1,30,true,-5001,'past'],
  ['fix',1,50,true,30000,'near-first'],['fix',1,51,true,0,'near-second'],['fix',1,30,true,30001,'near-second']],
 'follow':[['start',false],['stopFollowing'],['recenter'],['end']]
};
async function sourceTraces(implementation){
 const traces=[];
 for(const [name,schedule] of Object.entries(navigationProgressScenarios)){
  const actual=await fixture(implementation),expect=actual.observe(),steps=[];
  for(const [name,...args] of schedule){
   const outcome=await actual[name](...args);
   steps.push({label:name,action:{name,args:name==='fix'?[...args,outcome]:args},expect:actual.observe()});
  }
  traces.push({name,init:{name:'init'},expect,steps});
 }
 return traces;
}
export async function checkNavigationProgress(extraSources=[]){
 const {implementation,sources,driverHashes}=await captureImplementation(extraSources);
 const traces=await sourceTraces(implementation);
 return checkTraces({model,modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
  'The actual prepared MapsScreenController, MapsController and BackgroundNavigation execute with controlled GPS, provider, storage, voice and Capacitor ports.',
  'Three maneuver coordinates, two route identities, held route/provider replies and exact synthetic background IDs bound the schedules. Observations settle synchronous route invalidation/loading and promise callbacks between steps.',
  'Physical GPS/geometry completeness, installed Android background ownership, permission UI and unrestricted asynchronous schedules remain separate.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--observe'){
  const {implementation}=await captureImplementation();
  console.log(JSON.stringify(await sourceTraces(implementation),null,2));
 }else console.log(JSON.stringify(await checkNavigationProgress(),null,2));
}
