import assert from 'node:assert/strict';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, sourceModule, deferred, until} from './support.mjs';
import {serviceInputs} from './source-inputs.mjs';

const basePath = '.eliza/client-features/plugins/plugin-calendar/src/linked-sync/';
const binding = {environment:'production',userId:'user',organizationId:'org',connectionId:'11111111-1111-4111-8111-111111111111',providerAccountId:'account',calendarId:'primary',agentId:'agent',localSourceId:'local',localSourceRevision:'source-r1'};
const event = title => ({title,description:'',location:'',startAt:'2026-11-08T12:00:00.000Z',endAt:'2026-11-08T13:00:00.000Z',timeZone:'UTC',isAllDay:false,attendees:[]});
const identity = value => !value ? 0 : ['original','edited','remote'].indexOf(value.title) + 1;

export async function calendarLinkedRefinement(extraSources = []) {
  const sources = serviceInputs([basePath+'sync-controller.ts',basePath+'linked-store.ts',basePath+'google-sync-port.ts',
    '.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts','specs/quint/refinement/services/calendar-linked.mjs','specs/quint/refinement/services/support.mjs']);
  sources.push(...extraSources);
  const driverHashes = captureInputs(sources);
  const {CalendarLinkedStore} = await sourceModule(basePath+'linked-store.ts');
  const {LinkedCalendarReconciler,linkedCalendarSemanticDigest} = await sourceModule('.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts');
  const {CalendarSyncController} = await sourceModule(basePath+'sync-controller.ts');
  const hashes = new Map([[null,0]]);
  for(const name of ['original','edited','remote'])hashes.set(await linkedCalendarSemanticDigest(event(name)),identity(event(name)));
  const traces = [];
  async function fixture({kind='create',local=1,remote=0,common=0,state='dirty',result='succeeded',effect=true,localFailure=false,checkpointFailure=false,etag=1,checkpointEtag=1}={}) {
    let disk=null, current=true, lostCheckpoint=checkpointFailure, localValue=local?{eventId:'local-1',revision:'r1',event:event(['','original','edited','remote'][local])}:null;
    let remoteValue=remote?{eventId:'remote-1',etag:'e'+etag,event:event(['','original','edited','remote'][remote])}:null;
    let writes=0,localWrites=0;const sent=[];
    const storage={async read(){return structuredClone(disk);},async compareExchange(_slot,before,next){if(JSON.stringify(before)!==JSON.stringify(disk))return{status:'conflict'};if(lostCheckpoint&&next.links[0]?.state==='clean'){lostCheckpoint=false;throw Error('checkpoint write unavailable');}disk=structuredClone(next);return{status:'saved'};}};
    let store=await CalendarLinkedStore.open(binding,()=>current,storage);
    let row=await store.link('local-1','r1');
    if(kind!=='create'||remote||common||state!=='dirty')row=await store.save(row,{state,pendingOperation:state==='clean'||state==='conflicted'||state==='paused'?null:kind,
      providerEventId:kind==='create'&&!remote?null:'remote-1',providerEtag:kind==='create'&&!remote?null:'e'+checkpointEtag,
      lastCommonSemanticHash:common?await linkedCalendarSemanticDigest(event(['','original','edited','remote'][common])):null});
    // Store uses null for an absent pending operation; the model names that equality class.
    if(row.pendingOperation==='none')throw Error('Fixture supplied an invalid store operation');
    const snapshot=()=>{const saved=disk.links[0];return {'s.state':saved.state,'s.pending':saved.pendingOperation??'none','s.local':identity(localValue?.event),
      's.remote':identity(remoteValue?.event),'s.knownProvider':!!saved.providerEventId,'s.common':hashes.get(saved.lastCommonSemanticHash),'s.writes':writes,'s.localWrites':localWrites};};
    const localPort={async get(){return structuredClone(localValue);},async applyProviderEvent(id,value,expected){if(localFailure||localValue?.revision!==expected)throw Error('local CAS refused');localWrites++;localValue={eventId:id,revision:'r2',event:structuredClone(value)};return structuredClone(localValue);},async delete(_id,expected){if(localFailure||localValue?.revision!==expected)throw Error('local CAS refused');localWrites++;localValue=null;}};
    const mutation=async (operation,value)=>{writes++;sent.push(snapshot());if(effect){remoteValue=operation==='delete'?null:{eventId:'remote-1',etag:'e2',event:structuredClone(value)};}
      if(result==='unknown')throw Error('response lost');if(result!=='succeeded')throw{outcome:result,code:'CALENDAR_SYNC_FIXTURE',message:'refused'};return structuredClone(remoteValue);};
    const provider={async get(){return structuredClone(remoteValue);},create:(_row,value)=>mutation('create',value),update:(_row,value)=>mutation('update',value),delete:()=>mutation('delete')};
    const engine=()=>new LinkedCalendarReconciler(store,localPort,provider);
    return {snapshot,sent,localPort,storage,engine,row:()=>structuredClone(disk.links[0]),async restart(){store=await CalendarLinkedStore.open(binding,()=>current,storage);},retire(){current=false;},get local(){return localValue;},set local(value){localValue=value;},get remote(){return remoteValue;},set remote(value){remoteValue=value;}};
  }
  const configurations = [
    {name:'create confirmed'}, {name:'create reply lost without effect',result:'unknown',effect:false},
    {name:'create reply lost after effect',result:'unknown'},
    {name:'update confirmed',kind:'update',local:2,remote:1,common:1,state:'clean'},
    {name:'structured refusal keeps pending',result:'not_accepted',effect:false},
    {name:'conditional revision refusal',kind:'update',local:2,remote:1,common:1,state:'clean',result:'precondition_failed',effect:false},
    {name:'two changed sides conflict',kind:'update',local:2,remote:3,common:1,state:'clean',path:'conflict'},
    {name:'provider edit pulled with CAS',kind:'update',local:1,remote:2,common:1,state:'clean',path:'pull'},
    {name:'provider pull CAS rejected',kind:'update',local:1,remote:2,common:1,state:'clean',path:'pull',localFailure:true},
    {name:'provider deletion removes unchanged local',kind:'update',local:1,remote:0,common:1,state:'clean',path:'pull'},
    {name:'pending missing local deletion',kind:'delete',local:0,remote:1,common:1},
    {name:'missing local without delete quarantines',kind:'update',local:0,remote:1,common:1,state:'clean',path:'missing'},
    {name:'same semantic contents refresh checkpoint',kind:'update',local:1,remote:1,common:1,state:'clean',path:'clean'},
    {name:'checkpoint write lost after provider commit',checkpointFailure:true,result:'succeeded'},
  ];
  for(const config of configurations) {
    const f=await fixture(config), initial=f.snapshot(), row=f.row();
    const trace={name:config.name,init:action('initFor',row.state,row.pendingOperation??'none',initial['s.local'],initial['s.remote'],initial['s.common'],!!row.providerEventId,false,false,config.etag??1,row.providerEtag?Number(row.providerEtag.slice(1)):0),expect:initial,steps:[]};
    const outcome=await f.engine().reconcile(row);
    if(f.sent.length){trace.steps.push({label:'provider mutation sees the durable pending checkpoint',action:[action('begin'),action('analyzed'),action('stage'),action('dispatch')],expect:f.sent[0]});
      trace.steps.push({label:'provider status and checkpoint write settle separately',action:action('providerResult',config.checkpointFailure?'unknown':config.result??'succeeded',config.effect??true),expect:{...f.snapshot(),'s.outcome':outcome}});
    }else {const actions=[action('begin'),action('analyzed')];if(config.path==='pull')actions.push(action('pullResult',!config.localFailure));trace.steps.push({label:'real reconciliation compares semantic snapshots',action:actions,expect:{...f.snapshot(),'s.outcome':outcome}});}
    await f.restart();trace.steps.push({label:'fresh linked store restores the exact durable checkpoint',action:action('restart'),expect:f.snapshot()});
    if(outcome==='quarantined'){
      assert.equal(await f.engine().reconcile(f.row()),'quarantined');trace.steps.push({label:'quarantine prevents another provider dispatch',action:action('blocked'),expect:f.snapshot()});
      const recovered=await f.engine().recoverDispatch(f.row());
      // Without a settle-window release, the real result is either landed or unresolved.
      // not_landed requires an elapsed settle window; this driver never supplies one.
      // The model's boolean records confirmed landing, never truthiness of the result string.
      assert.ok(recovered==='landed'||recovered==='unresolved',`Unexpected bounded recovery result: ${recovered}`);
      trace.steps.push({label:'recovery uses actual provider evidence without a new mutation',action:[action('beginRecovery'),action('recoveryReply')],expect:{...f.snapshot(),'s.recovery':recovered==='landed'}});
    }
    traces.push(trace);
  }
  // The actual controller serializes review and requires an unchanged review for enable.
  for(const mode of ['normal','local-changed','owner-changed','concurrent']) {
    const f=await fixture(), gate=deferred();let entered=false,active=true,enabled=true;
    const localPort={...f.localPort,async get(id){if(mode==='concurrent'&&!entered){entered=true;await gate.promise;}return f.localPort.get(id);}};
    const controller=new CalendarSyncController(async()=>({reviewIdentity:'review',binding,client:{async googleCalendarSync(input){assert.equal(input.kind,'capabilities');return{version:1,calendarId:'primary',accountId:'account',accountEmail:'owner@example.test',calendarLabel:'Primary',read:true,write:true,conditionalWrites:true,idempotentCreate:true,providerExactlyOnce:false};}},local:localPort,storage:f.storage,current:()=>active,events:async()=>[{id:'local-1',revision:f.local.revision}]}),{async read(){return enabled;},async write(_scope,value){enabled=value;}});
    const trace={name:`reviewed controller admission ${mode}`,expect:{'s.enabled':true,'s.writes':0},steps:[]};
    await controller.pause();
    trace.steps.push({label:'explicit pause saves disabled preference',action:action('pause'),expect:{'s.enabled':enabled}});
    const reviewPromise=controller.review();
    if(mode==='concurrent'){await until(()=>entered,'review local read');await assert.rejects(controller.review(),/already running/);gate.resolve();}
    const review=await reviewPromise;
    trace.steps.push({label:'real review captures current local revision',action:action('reviewSync'),expect:{'s.reviewedRevision':Number(review.events[0].revision.slice(1))}});
    if(mode==='local-changed'){f.local={...f.local,revision:'r2',event:event('edited')};trace.steps.push({label:'local revision changes after review',action:action('localEdit'),expect:{'s.revision':2}});}
    if(mode==='owner-changed'){active=false;trace.steps.push({label:'captured owner is retired',action:action('switchOwner'),expect:{'s.enabled':enabled}});}
    if(['local-changed','owner-changed'].includes(mode)){await assert.rejects(controller.enable(review));trace.steps.push({label:'stale consent cannot enable sync',action:{...action('enable'),reject:true},expect:{'s.enabled':enabled}});}
    else {await controller.enable(review);trace.steps.push({label:'unchanged exact review enables preference',action:action('enable'),expect:{'s.enabled':enabled}});}
    traces.push(trace);
  }
  for(const pauseInFlight of [false,true]) {
    const f=await fixture(), gate=deferred();let enabled=true, writes=0;
    const common={version:1,calendarId:'primary',providerExactlyOnce:false};
    const client={async googleCalendarSync(input){
      if(input.kind==='capabilities')return{...common,accountId:'account',accountEmail:'owner@example.test',calendarLabel:'Primary',read:true,write:true,conditionalWrites:true,idempotentCreate:true};
      if(input.kind==='get')return{...common,event:f.remote};
      assert.equal(input.kind,'create');writes++;
      if(pauseInFlight)await gate.promise;
      f.remote={eventId:'remote-1',etag:'e2',visibility:'private',remindersDisabled:true,event:structuredClone(input.event)};
      return{...common,event:f.remote};
    }};
    const controller=new CalendarSyncController(async()=>({reviewIdentity:'review',binding,client,local:f.localPort,storage:f.storage,current:()=>true,events:async()=>[{id:'local-1',revision:f.local.revision}]}),{async read(){return enabled;},async write(_scope,value){enabled=value;}});
    const snapshot=()=>({...f.snapshot(),'s.writes':writes,'s.enabled':enabled});
    const trace={name:`full shared controller sync pause ${pauseInFlight}`,expect:snapshot(),steps:[]};
    const running=controller.sync().then(value=>({value}),error=>({error}));
    await until(()=>writes===1,'shared controller provider create');
    if(pauseInFlight){
      trace.steps.push({label:'full sync loop persists the link before its actual provider request',action:[action('begin'),action('analyzed'),action('stage'),action('dispatch')],expect:snapshot()});
      await controller.pause();trace.steps.push({label:'pause cancels the running controller and persists its preference',action:action('pause'),expect:snapshot()});
      gate.resolve();const result=await running;assert.equal(result.error?.name,'AbortError');
      trace.steps.push({label:'applied request with aborted checkpoint retains the dirty intent',action:action('abandonedWrite',true),expect:snapshot()});
      const review=await controller.review();await controller.enable(review);await controller.sync();
      trace.steps.push({label:'explicit resume reads the idempotent provider result without another create',action:[action('reviewSync'),action('enable'),action('begin'),action('analyzed')],expect:snapshot()});
    }else{
      const result=await running;assert.equal(result.value?.pushed,1,JSON.stringify({result,row:f.row()}));
      trace.steps.push({label:'normal shared sync returns its persisted provider checkpoint',action:[action('begin'),action('analyzed'),action('stage'),action('dispatch'),action('providerResult','succeeded',true)],expect:snapshot()});
    }
    assert.equal(writes,1);traces.push(trace);
  }
  return checkTraces({model:'CalendarLinkedSync',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'Actual shared reconciler, linked-store CAS and controller review/enable and full sync paths execute. Provider mutations and primitive storage failure are controlled ports.',
    'Three event bodies and two opaque revision/ETag classes bound semantic comparison. Data hashes are computed by the real implementation.',
    'Two full shared sync-loop schedules include cancellation after dispatch and explicit resume/readback. Canonical AgentCalendar select/resume, server dispatch, native Calendar provider mutation and arbitrary repeated merges remain further obligations.',
    'A successful external mutation followed by failed checkpoint persistence is quarantined when the failure handler can still save. Process death between individual writes remains an external durability obligation.'
  ]});
}
