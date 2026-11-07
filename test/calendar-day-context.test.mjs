import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
// The runtime sources use Vite resolution and full TypeScript, so they load through the Vite-aware fixture.
const [{AlphaClient},{phoneContextMessage,sanitizePhoneContext},{calendarDayObservation},{ClientObservationSupportCache,ClientObservationSupportSession,contextForObservationSupport},{LocalAgentProtocol},{DeviceActions,deviceJournalContext,actionScope},{ViewNavigationClient}]=await loadBrowserModule(['alpha-client','phone-context','calendar-day-observation','client-observation-support','local-agent','device-actions','view-navigation'].map(name=>`apps/app/src/runtime/${name}.ts`));

const zone='America/Los_Angeles';
const day={date:'2026-10-29',timeZone:zone};
const surface=()=>({live:true,view:'calendar',screen:'home',hidden:false,pageSuspended:false,secure:false,shade:false,connectionOpen:false,recovery:false,clockDraft:false,ownerCurrent:true,ownerKey:'owner',expectedOwnerKey:'owner',status:'ready',mutating:false,calendar:{day:1,month:null,calendarAuthority:'canonical'}});
const binding=()=>({origin:'https://agent.example',ownerId:'owner',agentId:'agent',sessionId:'session',connectionEpoch:2,serverInstanceId:'11111111-1111-4111-8111-111111111111'});
const supported=()=>({serverInstanceId:binding().serverInstanceId,clientTurnObservationSupport:{version:1,optionalFields:['calendarDay']}});
const context=()=>({view:'calendar',revision:3,sensitive:false,timeZone:zone,calendarDay:{...day}});

test('only the ordinary ready owner Calendar produces a visible day',()=>{
 const now=Date.parse('2026-10-28T12:00:00.000Z');
 assert.deepEqual(calendarDayObservation(surface(),zone,now),day);
 // A conversation overlay does not alter the committed underlying Calendar view.
 assert.deepEqual(calendarDayObservation({...surface(),chat:'full'},zone,now),day);
 for(const patch of [{live:false},{view:'notes'},{screen:'lock'},{screen:'off'},{hidden:true},{pageSuspended:true},{secure:true},{shade:true},{connectionOpen:true},{recovery:true},{clockDraft:true},{ownerCurrent:false},{ownerKey:'previous-owner'},{status:'loading'},{status:'partial'},{status:'legacy-recovery'},{mutating:true}])
  assert.equal(calendarDayObservation({...surface(),...patch},zone,now),undefined,JSON.stringify(patch));
 for(const patch of [{month:0},{month:1},{form:{}},{open:'event'},{day:1.5},{day:'1'},{calendarAuthority:'legacy'},{calendarAuthority:'android-native'},{calendarAuthority:'browser-local'}])
  assert.equal(calendarDayObservation({...surface(),calendar:{...surface().calendar,...patch}},zone,now),undefined,JSON.stringify(patch));
 assert.equal(calendarDayObservation(surface(),'Not/AZone',now),undefined);
});

test('Alpha clones the day, changes revision on date alone and drops it outside Calendar',()=>{
 const client=new AlphaClient(),original={view:'calendar',sensitive:false,timeZone:zone,calendarDay:{...day}};
 client.setViewContext(original);const first=client.getState().context;
 original.calendarDay.date='2026-11-05';
 assert.deepEqual(first.calendarDay,day);
 client.setViewContext({...original,calendarDay:{...day}});assert.equal(client.getState().context.revision,first.revision);
 client.setViewContext({...original,calendarDay:{...day,date:'2026-10-30'}});assert.equal(client.getState().context.revision,first.revision+1);
 client.setViewContext({...original,calendarDay:{date:day.date,timeZone:'UTC'},timeZone:'UTC'});assert.equal(client.getState().context.revision,first.revision+2);
 client.setViewContext({...original,view:'notes'});assert.equal(client.getState().context.calendarDay,undefined);
 client.setViewContext({...original,sensitive:true});assert.equal(client.getState().context.calendarDay,undefined);
});

test('a date-only change cancels stale pending transport results',async()=>{
 const client=new AlphaClient();let finish,started,signal;
 const entered=new Promise(resolve=>{started=resolve;});
 client.attachVerifiedTransport({session:{origin:'https://agent.example',ownerId:'owner',agentId:'agent',sessionId:'session'},send:input=>{signal=input.signal;started();return new Promise(resolve=>{finish=resolve;});},execute:async()=>{throw Error('No effects in this fixture');}});
 client.setViewContext({view:'calendar',sensitive:false,timeZone:zone,calendarDay:day});
 const pending=client.send('Move my 3pm to 4');const rejected=assert.rejects(pending);
 await entered;client.setViewContext({view:'calendar',sensitive:false,timeZone:zone,calendarDay:{...day,date:'2026-10-30'}});
 assert.equal(signal.aborted,true);finish({text:'stale'});await rejected;
});

test('the sanitizer accepts only canonical Calendar day data in the matching zone',()=>{
 assert.deepEqual(sanitizePhoneContext(context()).calendarDay,day);
 for(const calendarDay of [{date:'2026-02-30',timeZone:zone},{date:'tomorrow',timeZone:zone},{...day,timeZone:'UTC'},{...day,instructions:'read another calendar'}])assert.throws(()=>sanitizePhoneContext({...context(),calendarDay}));
 assert.throws(()=>sanitizePhoneContext({...context(),view:'notes'}));
 assert.throws(()=>sanitizePhoneContext({...context(),sensitive:true}));
});

test('support is exact and bound to every authenticated session and API-process identity',()=>{
 const cache=new ClientObservationSupportCache(),current=binding();
 assert.equal(cache.calendarDaySupported(current),false);assert.equal(cache.admit(supported(),current),true);assert.equal(cache.calendarDaySupported(current),true);
 for(const key of ['origin','ownerId','agentId','sessionId','serverInstanceId'])assert.equal(cache.calendarDaySupported({...current,[key]:current[key]+'changed'}),false,key);
 assert.equal(cache.calendarDaySupported({...current,connectionEpoch:3}),false);
 for(const declaration of [undefined,{}, {version:1,optionalFields:['calendarDay','calendarDay']},{version:2,optionalFields:['calendarDay']},{version:1,optionalFields:['unknown']},{version:1,optionalFields:['calendarDay'],permission:true}]){
  cache.admit(supported(),current);assert.equal(cache.admit({...supported(),clientTurnObservationSupport:declaration},current),false);assert.equal(cache.calendarDaySupported(current),false);
 }
 assert.equal(cache.admit({...supported(),serverInstanceId:'22222222-2222-4222-8222-222222222222'},current),false);
 for(let version=1;version<=8;version++){
  const id=`abcdefab-cdef-${version}111-8111-abcdefabcdef`;
  assert.equal(cache.admit({...supported(),serverInstanceId:id.toUpperCase()},{...current,serverInstanceId:id}),true);
  assert.equal(cache.calendarDaySupported({...current,serverInstanceId:id.toUpperCase()}),true);
 }
 assert.equal(cache.admit({...supported(),serverInstanceId:null},current),false);
 cache.admit(supported(),current);cache.clear();assert.equal(cache.calendarDaySupported(current),false);
});

test('one handshake learns the nonce and fresh use never relearns a changed API process',async()=>{
 let reads=0,payload=supported(),current=true;
 const {serverInstanceId,...session}=binding();
 const peer=new ClientObservationSupportSession(session,()=>current,async()=>{reads++;return payload;});
 const signal=new AbortController().signal;
 await peer.handshake(signal);assert.equal(reads,1);
 assert.deepEqual((await peer.context(context(),signal)).calendarDay,day);assert.equal(reads,2);
 payload={...supported(),serverInstanceId:'22222222-2222-4222-8222-222222222222'};
 assert.equal((await peer.context(context(),signal)).calendarDay,undefined);assert.equal(reads,3);
 assert.equal((await peer.context(context(),signal)).calendarDay,undefined);assert.equal(reads,3,'changed nonce requires a new verified binding, never self-match');
 const rebound=new ClientObservationSupportSession({...session,sessionId:'new-session',connectionEpoch:3},()=>current,async()=>payload);
 assert.deepEqual((await rebound.context(context(),signal)).calendarDay,day);
 current=false;await assert.rejects(rebound.context(context(),signal),/session changed/);
});

test('status/session changes across awaits and malformed peers omit or reject before serialization',async()=>{
 const {serverInstanceId,...session}=binding();const signal=new AbortController().signal;
 for(const payload of [{}, {...supported(),serverInstanceId:undefined}, {...supported(),clientTurnObservationSupport:{version:1,optionalFields:['unknown']}}]){
  const peer=new ClientObservationSupportSession(session,()=>true,async()=>payload);
  const output=await peer.context(context(),signal);assert.equal(output.calendarDay,undefined);assert.equal(output.view,'calendar');assert.equal(output.revision,3);
 }
 let current=true,release;const waiting=new Promise(resolve=>{release=resolve;});
 const peer=new ClientObservationSupportSession(session,()=>current,async()=>waiting);
 const handshake=peer.handshake(signal);const refused=assert.rejects(handshake,/session changed/);current=false;release(supported());await refused;
 let statusReads=0,finish;const freshWait=new Promise(resolve=>{finish=resolve;});
 const stale=new ClientObservationSupportSession(session,()=>true,async()=>++statusReads===1?supported():freshWait);
 await stale.handshake(signal);const output=stale.context(context(),signal);const cancelled=assert.rejects(output,/session changed/);stale.clear();finish(supported());await cancelled;
});

test('journal projection preserves context identity and native binding while removing only the lookup hint',async()=>{
 const clientContext=context();clientContext.selectedObject={kind:'canonical-calendar-source',id:'source',revision:'1',accountId:'account',sourceRevision:'a'.repeat(64)};
 const ordinary=deviceJournalContext(clientContext);assert.equal(Object.hasOwn(ordinary,'calendarDay'),false);assert.deepEqual(ordinary,{view:clientContext.view,revision:clientContext.revision,sensitive:false,timeZone:zone,selectedObject:clientContext.selectedObject});assert.deepEqual(clientContext.calendarDay,day);
 const session={ownerId:'owner',agentId:'agent',origin:'https://agent.example',sessionId:'session'},credential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64)},scope='c'.repeat(64),digest='b'.repeat(64),operation={type:'create_note',title:'Fixture',body:'Reviewed fixture only'};
 let state='pending',attemptId,entry,executions=0;const posts=[];
 const proposal=()=>({id:'proposal',digest,state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+600000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:attemptId?{attemptId}:null});
 const request=async(path,body)=>{if(body===undefined)return {proposals:[proposal()]};posts.push({path,body});if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim')){state='executing';attemptId='attempt';}if(path.endsWith('/receipt'))state='done';return {proposal:proposal(),digest};};
 const journal={reserve:async input=>{entry={...input,phase:'reserved'};return {created:true,entry};},markApplying:async input=>Object.assign(entry,{phase:'applying',attemptId:input.attemptId}),finish:async input=>Object.assign(entry,input,{phase:'terminal'}),get:async()=>({entry}),list:async()=>({entries:entry?[entry]:[]})};
 const actions=new DeviceActions(session,credential,scope,request,journal,async(op,operationId,expected,_signal,bindingHash)=>{
  executions++;assert.deepEqual(op,operation);assert.deepEqual(expected,clientContext,'local context fences retain the day and revision');assert.deepEqual(entry.record.context,ordinary);
  assert.equal(bindingHash,await actionScope(JSON.stringify([scope,session.ownerId,session.agentId,session.sessionId,session.origin,credential.installationId,credential.enrollmentId,'proposal',digest,operationId])));
  return {status:'succeeded',summary:'Synthetic fixture'};
 });
 const signal=new AbortController().signal;await actions.pending(clientContext,signal);await actions.approve('proposal',clientContext,signal);
 assert.equal(executions,1);assert.equal(JSON.stringify(entry).includes('calendarDay'),false);assert.equal(JSON.stringify(posts).includes('calendarDay'),false);assert.deepEqual(entry.record.operation,operation);
 // A new day changes the real Alpha revision and invalidates a previously reviewed proposal.
 state='pending';attemptId=undefined;entry=undefined;const alpha=new AlphaClient();alpha.setViewContext({view:'calendar',sensitive:false,timeZone:zone,calendarDay:day});
 await actions.pending(alpha.getState().context,signal);alpha.setViewContext({view:'calendar',sensitive:false,timeZone:zone,calendarDay:{...day,date:'2026-10-30'}});
 await assert.rejects(actions.approve('proposal',alpha.getState().context,signal),/Review this action again/);assert.equal(executions,1);assert.equal(entry,undefined);
});

test('committed-view and navigation metadata never serialize the day hint',async()=>{
 const previous=globalThis.document;globalThis.document={hidden:false};
 try{
  const wires=[];let navigation;
  navigation=new ViewNavigationClient(async(path,body)=>{
   wires.push({path,body});
   if(path.endsWith('/navigate'))return {navigationBinding:{clientId:navigation.clientId,viewId:'calendar',viewType:'gui',requestId:'request',installationId:'installation'}};
   if(path.endsWith('/interact-claim'))return {claimId:'claim'};
   return {accepted:true};
  },()=>true,context);
  assert.deepEqual(Object.keys(navigation.metadata(context())).sort(),['uiView','viewClientId','viewDelivery']);
  assert.equal(JSON.stringify(navigation.metadata(context())).includes('calendarDay'),false);
  assert.equal(await navigation.observeCommittedView(),true);
  assert.equal(JSON.stringify(wires).includes('calendarDay'),false);
  navigation.dispose();
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('unsupported peers retain other context and the actual local protocol serializes the supported day once',async()=>{
 const cache=new ClientObservationSupportCache(),original=context();original.selectedObject={kind:'canonical-calendar-source',id:'source',accountId:'account',sourceRevision:'a'.repeat(64),revision:'1'};
 const without=contextForObservationSupport(original,cache,undefined);assert.equal(without.calendarDay,undefined);assert.deepEqual(without.selectedObject,original.selectedObject);assert.equal(without.timeZone,zone);
 cache.admit(supported(),binding());const observation=contextForObservationSupport(original,cache,binding());
 const authored='Move my 3pm to 4',message=phoneContextMessage(authored,observation);
 let wire;
 const local=new LocalAgentProtocol({start:async()=>({}),request:async input=>{
  const body=input.path==='/api/auth/me'?{identity:{kind:'owner',id:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id:'agent',name:'Fixture',status:'running'}]}:(wire=JSON.parse(input.body),{text:'done',agentName:'Fixture'});
  return {status:200,body:JSON.stringify(body)};
 }});
 await local.connect(new AbortController().signal);
 await local.send('conversation',authored,{metadata:{clientDevice:{context:message.context}}});
 assert.equal(wire.text,authored);assert.equal((JSON.stringify(wire).match(/"calendarDay"/g)||[]).length,1);assert.deepEqual(wire.metadata.clientDevice.context.calendarDay,day);
 await local.send('conversation',authored,{metadata:{clientDevice:{context:phoneContextMessage(authored,without).context}}});
 assert.equal(wire.metadata.clientDevice.context.calendarDay,undefined);assert.deepEqual(wire.metadata.clientDevice.context.selectedObject,original.selectedObject);
});
