// Product free/busy executor and the real DeviceActions client over a calendar fixture that
// holds titles and unrelated calendars. Synthetic provider and reviews: no CalendarProvider,
// Android permission dialog, WebView or agent is exercised here.
import assert from 'node:assert/strict';
import {abortablePause,executeCalendarAvailability,parseAvailabilityEvents,parseAvailabilitySources,SOURCE_LIST_ATTEMPTS,SOURCE_LIST_RETRY_MS,type AvailabilityProvider,type AvailabilityReview} from '../apps/app/src/runtime/calendar-availability.ts';
import {DeviceActions} from '../apps/app/src/runtime/device-actions.ts';

const ZONE='America/New_York',signal=()=>new AbortController().signal;
// 2026-10-13 is a Tuesday; New York is UTC-4. The window is the whole local day.
const day={type:'calendar_availability' as const,start:'2026-10-13T04:00:00.000Z',end:'2026-10-14T04:00:00.000Z',timeZone:ZONE};
const afternoon={type:'calendar_availability' as const,start:'2026-10-13T19:00:00.000Z',end:'2026-10-13T20:00:00.000Z',timeZone:ZONE};
const rev=(letter:string)=>letter.repeat(64);
type Row={calendarId:string;title:string;start:string;end:string;allDay:boolean;availability:'busy'|'free'|'tentative'};
/** A provider with event content and calendars the owner never chooses. */
function fixture(){
 const state={permission:'granted',zone:ZONE,requests:0,lists:0,reads:[] as string[][],extraField:false,
  calendars:[{id:'1',name:'WORK_CALENDAR_NAME',account:'owner@work.example',sourceRevision:rev('a')},{id:'2',name:'HOME_CALENDAR_NAME',account:'owner@home.example',sourceRevision:rev('b')},{id:'3',name:'UNRELATED_CALENDAR_NAME',account:'partner@else.example',sourceRevision:rev('c')}],
  rows:[
   {calendarId:'1',title:'SECRET_STANDUP_TITLE',start:'2026-10-13T13:00:00.000Z',end:'2026-10-13T13:30:00.000Z',allDay:false,availability:'busy'},
   {calendarId:'1',title:'SECRET_FOCUS_TITLE',start:'2026-10-13T19:00:00.000Z',end:'2026-10-13T20:00:00.000Z',allDay:false,availability:'free'},
   {calendarId:'2',title:'SECRET_MAYBE_TITLE',start:'2026-10-13T21:00:00.000Z',end:'2026-10-13T22:00:00.000Z',allDay:false,availability:'tentative'},
   {calendarId:'3',title:'UNRELATED_PARTNER_TITLE',start:'2026-10-13T19:15:00.000Z',end:'2026-10-13T19:45:00.000Z',allDay:false,availability:'busy'},
  ] as Row[]};
 const provider:AvailabilityProvider={
  requestWorkflowReadAccess:async()=>{state.requests++;return {status:state.permission};},
  availabilitySources:async input=>{state.lists++;if(state.permission!=='granted')return {status:'permission-required'};if(input.timeZone!==state.zone)return {status:'timezone-changed'};return {status:'ready',timeZone:input.timeZone,calendars:structuredClone(state.calendars)};},
  readAvailability:async input=>{
   state.reads.push(input.calendars.map(item=>item.id));
   if(input.timeZone!==state.zone)return {status:'timezone-changed'};
   for(const chosen of input.calendars)if(state.calendars.find(item=>item.id===chosen.id)?.sourceRevision!==chosen.revision)return {status:'changed'};
   const ids=new Set(input.calendars.map(item=>item.id));
   // The selection is applied at the provider: unselected calendars are never read.
   return {status:'ready',freshness:'local',events:state.rows.filter(row=>ids.has(row.calendarId)).map(row=>({start:row.start,end:row.end,allDay:row.allDay,availability:row.availability,...(state.extraField?{title:row.title}:{})}))};
  },
 };
 return {state,provider};
}
function reviews(choice:string[]|null,confirm=true,hooks:{afterChoose?:()=>void;afterConfirm?:()=>void}={}){
 const seen={offered:[] as string[],results:[] as unknown[],chosen:[] as string[]};
 const review:AvailabilityReview={
  chooseCalendars:async(sources,_operation,_signal,current)=>{current();seen.offered=sources.map(source=>source.name);hooks.afterChoose?.();return choice;},
  confirmResult:async(result,chosen,_signal,current)=>{current();seen.results.push(structuredClone(result));seen.chosen=chosen.map(source=>source.name);hooks.afterConfirm?.();return confirm;},
 };
 return {seen,review};
}
const run=(provider:AvailabilityProvider,operation:typeof day,review:AvailabilityReview,options:{context?:string;device?:string;current?:()=>void;signal?:AbortSignal}={})=>
 executeCalendarAvailability(provider,operation,options.context??ZONE,options.signal??signal(),options.current??(()=>{}),review,()=>options.device??ZONE);
/** No fixture title, calendar name or account appears anywhere in the value. */
const noSecrets=(value:unknown)=>{const text=JSON.stringify(value);for(const secret of ['SECRET','UNRELATED','CALENDAR_NAME','owner@','partner@'])assert.ok(!text.includes(secret),`shared value must not contain ${secret}`);};
/** A structured result additionally has no field that could carry event or calendar content. */
const noContent=(value:unknown)=>{noSecrets(value);if(typeof value==='string')return;const text=JSON.stringify(value);for(const field of ['"title"','"name"','"account"','"description"','"location"','"id"','"calendarId"'])assert.ok(!text.includes(field),`shared value must not contain a ${field} field`);};
const refused=(outcome:Awaited<ReturnType<typeof run>>,pattern:RegExp)=>{assert.equal(outcome.status,'failed');assert.equal(outcome.foregroundResult,undefined);assert.match(outcome.summary,pattern);assert.match(outcome.summary,/Nothing was shared\.$/);noSecrets(outcome);};

// Authorized calendars only: free events excluded, tentative flagged, unrelated calendar unread.
{
 const {state,provider}=fixture(),{seen,review}=reviews(['1','2']);
 const outcome=await run(provider,day,review);
 assert.equal(outcome.status,'succeeded');
 const result=outcome.foregroundResult!;
 assert.deepEqual(result,{version:1,kind:'calendar_availability',window:{start:day.start,end:day.end,timeZone:ZONE},calendarCount:2,status:'busy',transparentIgnored:1,busy:[
  {start:'2026-10-13T13:00:00.000Z',end:'2026-10-13T13:30:00.000Z',allDay:false,tentative:false},
  {start:'2026-10-13T21:00:00.000Z',end:'2026-10-13T22:00:00.000Z',allDay:false,tentative:true}]});
 assert.deepEqual(state.reads,[['1','2'],['1','2']],'only the chosen calendars are read, once for review and once before sharing');
 assert.deepEqual(seen.offered,['WORK_CALENDAR_NAME','HOME_CALENDAR_NAME','UNRELATED_CALENDAR_NAME']);
 assert.deepEqual(seen.chosen,['WORK_CALENDAR_NAME','HOME_CALENDAR_NAME']);
 assert.deepEqual(seen.results,[result],'the owner reviewed exactly the shared result');
 noContent(result);noSecrets(outcome.summary);
 assert.match(outcome.summary,/Shared 2 busy times from 2 calendars you chose\. 1 event marked free was ignored\. No event titles or details were shared\./);
}
// A window covered only by an event marked free is free; the unrelated calendar's busy event is not consulted.
{
 const {state,provider}=fixture(),{review}=reviews(['1']);
 const outcome=await run(provider,afternoon,review);
 assert.equal(outcome.status,'succeeded');
 assert.deepEqual(outcome.foregroundResult,{version:1,kind:'calendar_availability',window:{start:afternoon.start,end:afternoon.end,timeZone:ZONE},calendarCount:1,status:'free',busy:[],transparentIgnored:1});
 assert.ok(state.reads.every(ids=>!ids.includes('3')));
 assert.match(outcome.summary,/Shared that you are free in this window, from 1 calendar you chose\./);
}
// All-day events block the owner's whole local civil day, not the UTC day.
{
 const {state,provider}=fixture();
 state.rows=[{calendarId:'2',title:'SECRET_HOLIDAY_TITLE',start:'2026-10-13T00:00:00.000Z',end:'2026-10-14T00:00:00.000Z',allDay:true,availability:'busy'}];
 const whole=await run(provider,day,reviews(['2']).review);
 assert.deepEqual(whole.foregroundResult!.busy,[{start:'2026-10-13T04:00:00.000Z',end:'2026-10-14T04:00:00.000Z',allDay:true,tentative:false}]);
 // 9pm-10pm New York on the 13th is 01:00-02:00 UTC on the 14th: still inside the local all-day date.
 const evening={...day,start:'2026-10-14T01:00:00.000Z',end:'2026-10-14T02:00:00.000Z'};
 const late=await run(provider,evening,reviews(['2']).review);
 assert.equal(late.foregroundResult!.status,'busy');
 assert.deepEqual(late.foregroundResult!.busy,[{start:evening.start,end:evening.end,allDay:true,tentative:false}]);
 // 9pm-10pm New York on the 12th is 01:00-02:00 UTC on the 13th: the UTC date matches but the local date does not.
 const before={...day,start:'2026-10-13T01:00:00.000Z',end:'2026-10-13T02:00:00.000Z'};
 const early=await run(provider,before,reviews(['2']).review);
 assert.equal(early.foregroundResult!.status,'free');assert.deepEqual(early.foregroundResult!.busy,[]);
 // An all-day event marked free never makes the owner busy.
 state.rows[0].availability='free';
 const transparent=await run(provider,day,reviews(['2']).review);
 assert.equal(transparent.foregroundResult!.status,'free');assert.equal(transparent.foregroundResult!.transparentIgnored,1);
 noContent(whole.foregroundResult);noContent(transparent.foregroundResult);
}
// Permission: a denial reads nothing and offers no calendars.
{
 const {state,provider}=fixture();state.permission='denied';
 const {seen,review}=reviews(['1']);
 refused(await run(provider,day,review),/Calendar access was not allowed/);
 assert.equal(state.requests,1);assert.equal(state.lists,0);assert.deepEqual(state.reads,[]);assert.deepEqual(seen.offered,[]);
 // Permission revoked between the grant and the read.
 const later=fixture();
 const original=later.provider.readAvailability;later.provider.readAvailability=async input=>{await original(input);return {status:'permission-required'};};
 refused(await run(later.provider,day,reviews(['1']).review),/Calendar access was not allowed/);
}
// Time zone: the request, the phone context, the phone clock and the provider must agree.
{
 for(const options of [{context:'Europe/London'},{device:'Europe/London'},{context:undefined as unknown as string,device:ZONE}]){
  const {state,provider}=fixture();
  refused(await executeCalendarAvailability(provider,day,options.context,signal(),()=>{},reviews(['1']).review,()=>options.device??ZONE),/different time zone/);
  assert.equal(state.requests,0);assert.deepEqual(state.reads,[]);
 }
 const native=fixture();native.state.zone='Asia/Tokyo';
 refused(await run(native.provider,day,reviews(['1']).review),/different time zone/);assert.deepEqual(native.state.reads,[]);
 // The phone's zone changes while the owner is choosing.
 let device=ZONE;const moving=fixture();
 const outcome=await executeCalendarAvailability(moving.provider,day,ZONE,signal(),()=>{},reviews(['1'],true,{afterChoose:()=>{device='Asia/Tokyo';}}).review,()=>device);
 refused(outcome,/different time zone/);
}
// Cancellation at either step shares nothing; cancelling the choice reads nothing.
{
 const first=fixture();refused(await run(first.provider,day,reviews(null).review),/cancelled\. No calendar was read/);assert.deepEqual(first.state.reads,[]);
 const second=fixture();refused(await run(second.provider,day,reviews(['1'],false).review),/cancelled/);assert.equal(second.state.reads.length,1);
}
// Stale context: session, screen or phone context changed, or the request was aborted.
{
 let live=true;const current=()=>{if(!live)throw Error('Availability review context changed');};
 const during=fixture();
 refused(await run(during.provider,day,reviews(['1'],true,{afterChoose:()=>{live=false;}}).review,{current}),/changed before this availability check finished/);
 assert.deepEqual(during.state.reads,[],'a choice made on a stale screen is never read');
 live=true;const afterReview=fixture();
 refused(await run(afterReview.provider,day,reviews(['1'],true,{afterConfirm:()=>{live=false;}}).review,{current}),/changed before this availability check finished/);
 live=false;const never=fixture();
 refused(await run(never.provider,day,reviews(['1']).review,{current}),/changed before/);assert.equal(never.state.requests,0);
 live=true;const controller=new AbortController(),aborted=fixture();
 refused(await run(aborted.provider,day,reviews(['1'],true,{afterConfirm:()=>controller.abort()}).review,{signal:controller.signal}),/cancelled/);
}
// Stale calendar data: an event added, or a source changed, during review is never reported as reviewed.
{
 const added=fixture();
 refused(await run(added.provider,day,reviews(['1'],true,{afterConfirm:()=>{added.state.rows.push({calendarId:'1',title:'SECRET_NEW_TITLE',start:'2026-10-13T15:00:00.000Z',end:'2026-10-13T16:00:00.000Z',allDay:false,availability:'busy'});}}).review),/calendar changed during this review/);
 const renamed=fixture();
 refused(await run(renamed.provider,day,reviews(['1'],true,{afterChoose:()=>{renamed.state.calendars[0].sourceRevision=rev('d');}}).review),/chosen calendar changed/);
 const swapped=fixture();
 refused(await run(swapped.provider,day,reviews(['1'],true,{afterConfirm:()=>{swapped.state.calendars[0].sourceRevision=rev('d');}}).review),/chosen calendar changed/);
}
// A stale/unavailable/revoked read is unknown availability, including after an empty
// first read was reviewed as free. A non-ready payload must never be interpreted as free.
for(const status of ['stale','unavailable','permission-required','changed','freshness-unknown']){
 for(const failedRead of [1,2]){
  const {provider,state}=fixture();state.rows=[];const read=provider.readAvailability;let calls=0;
  provider.readAvailability=async input=>++calls===failedRead?{status,events:[]}:read(input);
  const {review,seen}=reviews(['1']);
  refused(await run(provider,day,review),/Nothing was shared/);
  assert.equal(calls,failedRead);
  assert.equal(seen.results.length,failedRead-1,'no review before a successful read; no receipt after a failed re-read');
 }
}
// Even ready + empty intervals cannot claim free without explicit freshness evidence.
for(const freshness of [undefined,null,'remote-cache','stale']){
 for(const failedRead of [1,2]){
  const {provider,state}=fixture();state.rows=[];const read=provider.readAvailability;let calls=0;
  provider.readAvailability=async input=>{const answer=await read(input);return ++calls===failedRead?{...answer,freshness}:answer;};
  refused(await run(provider,day,reviews(['1']).review),/availability is unknown/);
  assert.equal(calls,failedRead);
 }
}
// Fail closed: provider content, forged choices and bounds.
{
 const leaky=fixture();leaky.state.extraField=true;const leakyReview=reviews(['1']);
 refused(await run(leaky.provider,day,leakyReview.review),/changed before/);assert.deepEqual(leakyReview.seen.results,[],'a row carrying a title is rejected before review');
 for(const choice of [['99'],['1','1'],[] as string[],Array.from({length:17},(_,index)=>String(index+1))]){const forged=fixture();forged.state.calendars=Array.from({length:20},(_,index)=>({id:String(index+1),name:'N',account:'A',sourceRevision:rev('a')}));refused(await run(forged.provider,day,reviews(choice).review),/changed before/);assert.deepEqual(forged.state.reads,[]);}
 const none=fixture();none.state.calendars=[];refused(await run(none.provider,day,reviews(['1']).review),/No readable calendars/);
 const many=fixture();many.provider.readAvailability=async()=>({status:'too-many'});refused(await run(many.provider,day,reviews(['1']).review),/more than 200 events/);
 // An unavailable calendar list is asked for a bounded number of times, then fails with nothing read.
 const down=fixture();let downLists=0;const downPauses:number[]=[];down.provider.availabilitySources=async()=>{downLists++;return {status:'unavailable'};};
 refused(await executeCalendarAvailability(down.provider,day,ZONE,signal(),()=>{},reviews(['1']).review,()=>ZONE,async milliseconds=>{downPauses.push(milliseconds);}),/unavailable right now/);
 assert.equal(downLists,SOURCE_LIST_ATTEMPTS);assert.deepEqual(downPauses,Array(SOURCE_LIST_ATTEMPTS-1).fill(SOURCE_LIST_RETRY_MS));assert.deepEqual(down.state.reads,[]);
 // Focus returning just after the permission prompt: the list succeeds on a later attempt and the check completes.
 const refocus=fixture(),listSources=refocus.provider.availabilitySources;let refocusLists=0;
 refocus.provider.availabilitySources=async input=>++refocusLists<3?{status:'unavailable'}:listSources(input);
 const refocused=await executeCalendarAvailability(refocus.provider,day,ZONE,signal(),()=>{},reviews(['1']).review,()=>ZONE,async()=>{});
 assert.equal(refocused.status,'succeeded');assert.equal(refocusLists,3);assert.deepEqual(refocus.state.reads,[['1'],['1']]);
 // Only an unavailable list is retried: a denial, a zone change or a stale screen ends the check at once.
 for(const status of ['permission-required','timezone-changed']){const once=fixture();let lists=0;once.provider.availabilitySources=async()=>{lists++;return {status};};refused(await executeCalendarAvailability(once.provider,day,ZONE,signal(),()=>{},reviews(['1']).review,()=>ZONE,async()=>{throw Error('must not wait');}),status==='permission-required'?/not allowed/:/different time zone/);assert.equal(lists,1);}
 const left=fixture();let leftLists=0,leftLive=true;left.provider.availabilitySources=async()=>{leftLists++;return {status:'unavailable'};};
 refused(await executeCalendarAvailability(left.provider,day,ZONE,signal(),()=>{if(!leftLive)throw Error('Availability review context changed');},reviews(['1']).review,()=>ZONE,async()=>{leftLive=false;}),/changed before this availability check finished/);
 assert.equal(leftLists,1,'a screen that changed while waiting is never asked again');
 // The wait itself ends as soon as the review is aborted: a ten-minute wait would otherwise time this test out.
 const stop=new AbortController(),waiting=abortablePause(600000,stop.signal);setTimeout(()=>stop.abort(),5);
 await assert.rejects(waiting);await assert.rejects(abortablePause(600000,stop.signal));
 const stopping=fixture(),stopped=new AbortController();let stoppingLists=0;stopping.provider.availabilitySources=async()=>{stoppingLists++;return {status:'unavailable'};};
 refused(await executeCalendarAvailability(stopping.provider,day,ZONE,stopped.signal,()=>{},reviews(['1']).review,()=>ZONE,(milliseconds,abort)=>{setTimeout(()=>stopped.abort(),5);return abortablePause(milliseconds*2000,abort);}),/cancelled/);
 assert.equal(stoppingLists,1);
 assert.throws(()=>parseAvailabilityEvents([{start:day.start,end:day.end,allDay:false,availability:'busy',title:'x'}]),/Unexpected/);
 assert.throws(()=>parseAvailabilityEvents([{start:day.start,end:day.end,allDay:false,availability:'out-of-office'}]),/Invalid/);
 assert.throws(()=>parseAvailabilityEvents(Array.from({length:201},()=>({start:day.start,end:day.end,allDay:false,availability:'busy'}))),/bound/);
 assert.throws(()=>parseAvailabilitySources([{id:'1',sourceRevision:'short'}]),/Invalid/);
 assert.throws(()=>parseAvailabilitySources([{id:'1',sourceRevision:rev('a')},{id:'1',sourceRevision:rev('a')}]),/Invalid/);
 assert.throws(()=>parseAvailabilitySources(Array.from({length:65},(_,index)=>({id:String(index),sourceRevision:rev('a')}))),/Too many/);
}
// The exact reviewed result is what DeviceActions journals and uploads as the receipt.
{
 const session={ownerId:'owner',agentId:'agent',origin:'https://agent.example',sessionId:'session'},digest='b'.repeat(64);
 const credential={installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:['calendar.local-event.v1','notes.local-record.v1','calendar.availability-read.v1']};
 const make=(operation:unknown)=>({id:'free-busy',digest,state:'pending',subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+600000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:null as unknown});
 for(const mode of ['shared','cancelled','stale-zone'] as const){
  const listed=[make(day)],posted:{path:string;body:any}[]=[],entries=new Map<string,any>();let serverState='pending';
  const request=async(path:string,body:unknown)=>{if(body===undefined)return {proposals:listed};posted.push({path,body});if(path.endsWith('/decision'))serverState='approved';else if(path.endsWith('/claim'))serverState='executing';else if(path.endsWith('/receipt'))serverState='done';return {proposal:{...listed[0],state:serverState,execution:{attemptId:'attempt'}},digest};};
  const journal={reserve:async(input:any)=>{if(entries.has(input.proposalId))return {created:false,entry:entries.get(input.proposalId)};const entry={...input,phase:'reserved'};entries.set(input.proposalId,entry);return {created:true,entry};},markApplying:async(input:any)=>Object.assign(entries.get(input.proposalId),{phase:'applying',attemptId:input.attemptId}),finish:async(input:any)=>Object.assign(entries.get(input.proposalId),input,{phase:'terminal'}),list:async()=>({entries:[...entries.values()]}),get:async(input:any)=>({entry:entries.get(input.proposalId)||null})};
  const {state,provider}=fixture(),{review}=reviews(['1','2'],mode!=='cancelled');
  const actions=new DeviceActions(session,credential,'f'.repeat(64),request as any,journal as any,async()=>{throw Error('The device executor must not run a foreground review');},undefined,false,false,
   (operation,_id,context,abort)=>{assert.equal(entries.get('free-busy').phase,'applying','the review runs only after the journal claim');if(operation.type!=='calendar_availability')throw Error('Unexpected review');return executeCalendarAvailability(provider,operation,context.timeZone,abort,()=>{},review,()=>ZONE);});
  const home={view:'home' as const,revision:4,sensitive:false,timeZone:ZONE};
  if(mode==='stale-zone'){
   // The phone moved zones after the agent asked: the card is replaced by a notice and cannot be approved.
   const moved={...home,timeZone:'Asia/Tokyo'},items=await actions.pendingReview(moved as any,signal());
   assert.equal(items[0].proposal,null);assert.match(items[0].notice!,/different time zone/);
   await assert.rejects(actions.approve('free-busy',moved as any,signal()));
   assert.equal(posted.length,0);assert.equal(state.requests,0);assert.equal(entries.size,0);continue;
  }
  const cards=await actions.pending(home as any,signal());
  assert.equal(cards[0].title,'Check availability');assert.match(cards[0].description,/You choose which calendars this phone reads\. Only busy times are shared/);
  // A locked phone or an unrelated screen cannot review it.
  assert.match((await actions.pendingReview({...home,sensitive:true} as any,signal()))[0].notice!,/Unlock the phone/);
  assert.match((await actions.pendingReview({...home,view:'notes'} as any,signal()))[0].notice!,/Open Home or Calendar/);
  await actions.pending(home as any,signal());
  const receipt=await actions.approve('free-busy',home as any,signal());
  const uploaded=posted.find(item=>item.path.endsWith('/receipt'))!.body.receipt;
  if(mode==='cancelled'){
   assert.equal(receipt.status,'failed');assert.equal(uploaded.outcome,'failed');assert.equal(uploaded.result,undefined);
   assert.equal(entries.get('free-busy').result.foregroundResult,undefined);noSecrets(uploaded);noSecrets(entries.get('free-busy'));continue;
  }
  assert.equal(receipt.status,'succeeded');assert.equal(uploaded.outcome,'applied');
  assert.deepEqual(uploaded.result,{version:1,kind:'calendar_availability',window:{start:day.start,end:day.end,timeZone:ZONE},calendarCount:2,status:'busy',transparentIgnored:1,busy:[
   {start:'2026-10-13T13:00:00.000Z',end:'2026-10-13T13:30:00.000Z',allDay:false,tentative:false},{start:'2026-10-13T21:00:00.000Z',end:'2026-10-13T22:00:00.000Z',allDay:false,tentative:true}]});
  assert.deepEqual(entries.get('free-busy').result.foregroundResult,uploaded.result,'journal and receipt hold the same exact result');
  noContent(uploaded.result);noSecrets(posted);noSecrets(entries.get('free-busy'));
  assert.deepEqual(state.reads,[['1','2'],['1','2']]);
 }
}
console.log('PASS: foreground Calendar availability executor: owner-chosen calendars only, free events excluded, tentative flagged, all-day busy by local civil day, permission/time-zone/stale-context/stale-calendar refusals, fail-closed provider content, exact journaled receipt through DeviceActions. Synthetic provider and reviews only.');
