import {isFocusWorkflow} from './workflow-focus';
import {detectWorkflowTriggers,triggerDefinition,type TriggerCursor,type TriggerOccurrence,type TriggerSnapshot} from './workflow-triggers';
import {registerPlugin} from '../platform-plugins';
import {readLocationSimulation} from './location-simulation';
import {browserSensorEnabled} from './sensor-policy';
import {SavedPlaces} from '../maps/saved-places';
import {distanceToRoute} from '../maps/route-distance';
import {NativeMapsLocation,type Position} from '../maps/native-location';
type Bag=Record<string,any>;
export type TriggerJob=TriggerOccurrence&{id:string;sourceHash:string};
export type TriggerState={cursors:TriggerCursor[];queue:TriggerJob[]};
export const emptyTriggerState=():TriggerState=>({cursors:[],queue:[]});
const foreground=()=>!document.hidden&&document.documentElement.dataset.devBackground!=='true'&&!Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(element=>element.getClientRects().length);
const app=(api:Bag,name:string)=>({...api.get(name),...JSON.parse(localStorage.getItem('alpha.dev.app.'+name)||'{}')});
const sha=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
function sourceRecord(occurrence:TriggerOccurrence,snapshot:TriggerSnapshot):Bag{
 const source=occurrence.source;let rows:Bag[]=[];
 if(source.kind==='message')rows=(snapshot.messages[source.person]||[]).filter(row=>!row.me&&(source.id!==null?row.id===source.id:row.k===source.k));
 else if(source.kind==='email')rows=snapshot.mails.filter(row=>row.id===source.id);
 else if(source.kind==='event')rows=snapshot.events.filter(row=>row.id===source.id&&row.begin===source.begin&&row.end===source.end);
 else return source;
 if(rows.length!==1)throw Error('The trigger source changed or is no longer available.');return rows[0];
}
/** Hydrate only the exact triggering record, checking its captured content hash. */
export async function hydrateTriggerJob(job:TriggerJob,api:Bag,signal:AbortSignal){
 signal.throwIfAborted();const calendar=registerPlugin<any>('AlphaCalendar'),source=job.source;
 const snapshot:TriggerSnapshot={messages:app(api,'messages').threads||{},mails:app(api,'inbox').mails||[],events:[],places:{}};
 if(source.kind==='event'){const result=await calendar.list({begin:source.begin,end:source.end});if(result.truncated)throw Error('Calendar trigger input is incomplete.');snapshot.events=result.events;}
 const row=sourceRecord(job,snapshot);if(await sha(row)!==job.sourceHash)throw Error('The trigger source changed. Inspect it before running again.');signal.throwIfAborted();
 const messages=source.kind==='message'?{[source.person]:[structuredClone(row)]}:undefined;
 const mail=source.kind==='email'?{...row,atts:(row.atts||[]).map(({dataBase64,...attachment}:Bag)=>attachment)}:undefined;
 const input=source.kind==='time'?'':JSON.stringify(messages||mail||row);if(input.length>16000)throw Error('The trigger input is too large for this run.');
 return {input,messages,mail,event:source.kind==='event'?structuredClone(row):undefined};
}
const workflowUsesAgent=(flow:Bag)=>flow.steps.some((step:Bag)=>step.k==='Write'&&step.t.toLowerCase()!=='a note in notes'||step.k==='Notify'&&step.t.toLowerCase()==='a notification, only if urgent');
export function workflowNeedsReview(flow:Bag,connected=false){if(isFocusWorkflow(flow))return false;return flow.steps.some((step:Bag)=>step.k==='Speak'&&!['read it aloud','speak it when i pick up the phone'].includes(step.t.toLowerCase())||!connected&&step.k==='Write'&&step.t.toLowerCase()!=='a note in notes'||step.k==='Notify'&&step.t.toLowerCase()!=='a notification'&&(!connected||step.t.toLowerCase()!=='a notification, only if urgent')||step.k==='Do'&&/attachment|amount/i.test(step.t)||step.k==='If'&&/not at home/i.test(step.t));}
/** The caller supplies the existing simulator writer lease and atomic run-claim operation. */
export class WorkflowTriggerRuntime {
 private timer?:ReturnType<typeof setInterval>;private scanning=false;private stopped=false;private blocked=false;private api?:()=>Bag;private ready?:()=>boolean;
 private location=new NativeMapsLocation();private position?:Position;private watching=false;private report='';
 constructor(private busy:(flowId:string)=>boolean,private dispatch:(flow:Bag,api:Bag,job:TriggerJob)=>Promise<void>){ }
 connect(api:()=>Bag,ready:()=>boolean){this.api=api;this.ready=ready;this.timer=setInterval(()=>void this.tick(),1000);for(const event of this.events)window.addEventListener(event,this.wake);document.addEventListener('visibilitychange',this.wake);void this.tick();}
 private events=['alpha:dev-app-change','alpha:dev-location','alpha:device-state','focus'];
 private wake=()=>{this.blocked=false;void this.tick();};
 private async places(flows:Bag[]){
  const places:TriggerSnapshot['places']={},placeKeys:Record<string,string>={};const enabled=flows.some(flow=>flow.on&&flow.trig?.kind==='location');
  if(!enabled||!browserSensorEnabled('locationEnabled')){if(this.watching){this.watching=false;this.position=undefined;await this.location.stop();}return {places,placeKeys};}
  const config=readLocationSimulation();let position:Position|undefined;
  if(config.mode==='coordinates'){if(this.watching){this.watching=false;await this.location.stop();}position={coordinate:config,accuracyMeters:config.accuracy,timestamp:Date.now(),precision:'precise'};}
  else {if(!this.watching&&(await registerPlugin<any>('ElizaLocation').checkPermissions()).location==='granted'){this.watching=true;await this.location.start(false,value=>{this.position=value;},()=>{this.position=undefined;this.watching=false;});}position=this.position;}
  if(!position||Date.now()-position.timestamp>30000)return {places,placeKeys};
  const saved=new SavedPlaces().read();for(const [zone,id,radius] of [['home',config.homeId,config.radius],['work',config.workId,config.workRadius??200]] as const){const place=saved.find(item=>item.id===id);if(!place)continue;placeKeys[zone]=JSON.stringify([place.id,place.coordinate,radius]);const distance=distanceToRoute(position.coordinate,[place.coordinate]);places[zone]=distance+position.accuracyMeters<=radius?true:distance-position.accuracyMeters>radius?false:null;}
  return {places,placeKeys};
 }
 private async snapshot(api:Bag,flows:Bag[],state:TriggerState,now:number):Promise<TriggerSnapshot>{
  const calendar=registerPlugin<any>('AlphaCalendar'),events:Bag[]=[],ranges=new Set<string>();
  for(const flow of flows.filter(flow=>flow.on&&flow.trig?.kind==='event')){const cursor=state.cursors.find(row=>row.flowId===String(flow.id)&&row.definition===triggerDefinition(flow));const begin=Math.min(cursor?.through??now,now),end=Math.min(now,begin+86400000)+600001;const key=JSON.stringify([begin,end]);if(ranges.has(key))continue;ranges.add(key);const result=await calendar.list({begin,end});if(result.truncated)throw Error('Calendar trigger input is incomplete. Narrow the calendar before retrying.');for(const event of result.events)if(!events.some(row=>row.id===event.id&&row.begin===event.begin&&row.end===event.end))events.push(event);}
  return {messages:app(api,'messages').threads||{},mails:app(api,'inbox').mails||[],events,...await this.places(flows)};
 }
 private async tick(){
  if(this.stopped||this.scanning||!this.api||!this.ready?.())return;
  if(!foreground()){this.position=undefined;if(this.watching){this.watching=false;await this.location.stop();}return;}
  if(this.blocked)return;this.scanning=true;const api=this.api();
  try{
   const raw=localStorage.getItem('alpha.dev.app.workflows'),state=app(api,'workflows'),triggerState:TriggerState=state.triggerState||emptyTriggerState();
   if(!Array.isArray(triggerState.cursors)||!Array.isArray(triggerState.queue)||triggerState.queue.length>100)throw Error('Workflow trigger history needs recovery.');
   const incomingRaw=[localStorage.getItem('alpha.dev.app.messages'),localStorage.getItem('alpha.dev.app.inbox')];
   const now=Date.now(),snapshot=await this.snapshot(api,state.flows,triggerState,now);if(this.stopped||!foreground()||raw!==localStorage.getItem('alpha.dev.app.workflows'))return;
   const detected=detectWorkflowTriggers(state.flows,triggerState.cursors,snapshot,now);
   const queue=triggerState.queue.filter(job=>state.flows.some((flow:Bag)=>flow.on&&String(flow.id)===job.flowId&&triggerDefinition(flow)===job.definition));
   if(queue.length+detected.occurrences.length>100)throw Error('The workflow queue is full. Open queued workflows before checking more triggers.');
   for(const occurrence of detected.occurrences)queue.push({...occurrence,id:crypto.randomUUID(),sourceHash:await sha(sourceRecord(occurrence,snapshot))});
   if(this.stopped||!foreground()||raw!==localStorage.getItem('alpha.dev.app.workflows')||incomingRaw[0]!==localStorage.getItem('alpha.dev.app.messages')||incomingRaw[1]!==localStorage.getItem('alpha.dev.app.inbox'))return;
   // Empty polling need not write every second; retain precise cursors when an occurrence is queued.
   const comparable=(cursors:TriggerCursor[])=>JSON.stringify(cursors.map(cursor=>({...cursor,through:Math.floor(cursor.through/60000)})));
   if(detected.occurrences.length||JSON.stringify(queue)!==JSON.stringify(triggerState.queue)||comparable(detected.cursors)!==comparable(triggerState.cursors)){
    const next={cursors:detected.cursors,queue};if(JSON.stringify({...state,triggerState:next}).length>2_000_000)throw Error('Workflow history is full. Remove finished runs before checking more triggers.');api.setView('workflows',{triggerState:next});
   }
   if(this.report){this.report='';api.setView('workflows',{localTriggerError:''});}
  }catch(error){this.blocked=true;const message=error instanceof Error?error.message:'Couldn’t check triggers';if(message!==this.report){this.report=message;api.setView('workflows',{localTriggerError:message});}}
  finally{this.scanning=false;}
  if(!this.stopped&&foreground()){
   const state=app(api,'workflows'),job=(state.triggerState?.queue||[]).find((job:TriggerJob)=>{const flow=state.flows.find((flow:Bag)=>flow.on&&String(flow.id)===job.flowId&&triggerDefinition(flow)===job.definition);return flow&&!this.busy(job.flowId)&&!(workflowUsesAgent(flow)&&api.localWorkflowBusy?.())&&(!workflowNeedsReview(flow,api.localWorkflowReady?.())||api.isActive()&&String(state.open)===job.flowId&&!document.querySelector('dialog[open]'));});
   if(job){const flow=state.flows.find((flow:Bag)=>String(flow.id)===job.flowId);void this.dispatch(flow,api,job).finally(()=>{this.blocked=!!app(api,'workflows').triggerState?.queue.some((pending:TriggerJob)=>pending.id===job.id);if(!this.blocked)void this.tick();}).catch(()=>{this.blocked=true;});}
  }
 }
 dispose(){this.stopped=true;clearInterval(this.timer);for(const event of this.events)window.removeEventListener(event,this.wake);document.removeEventListener('visibilitychange',this.wake);void this.location.stop();}
}
