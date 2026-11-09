// Synthetic Cloud transport only: no OAuth, provider traffic, native calendars or account writes.
import assert from 'node:assert/strict';
import { GoogleCalendarReader, type GoogleCalendarBinding, type GoogleCalendarClient, type GoogleCalendarRead } from '../apps/app/src/runtime/google-calendar.ts';
import { CloudProtocolError, type GmailAccount, type GoogleCalendarEvent, type GoogleCalendarSummary } from '../apps/app/src/runtime/cloud-protocol.ts';
const binding: GoogleCalendarBinding = { environment:'production',userId:'owner',organizationId:'org',credentialId:'credential-generation',sessionId:'session-generation',connectionId:'grant' };
const summary: GoogleCalendarSummary = { calendarId:'primary@example.test',summary:'My calendar',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'America/Los_Angeles',selected:true };
const account: GmailAccount = { configured:true,connected:true,reason:'connected',connectionId:'grant',grantedCapabilities:['google.calendar.read'],label:'owner@example.test' };
const range = { timeMin:'2026-10-13T00:00:00Z',timeMax:'2026-10-16T00:00:00Z',timeZone:'America/Los_Angeles' };
const event: GoogleCalendarEvent = { externalId:'event',calendarId:summary.calendarId,title:'Appointment',description:'Read-only detail',location:'Office',status:'confirmed',startAt:'2026-10-13T18:00:00Z',endAt:'2026-10-13T19:00:00Z',isAllDay:false,timezone:'America/Los_Angeles',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{} };
const signal = () => new AbortController().signal;
const sourceOf = (calendarId: string) => `google:grant:${encodeURIComponent(calendarId)}`;
const primaryId = sourceOf(summary.calendarId);
function fixture(expectedRange = range) {
  let active: GoogleCalendarBinding|null = {...binding};
  const state = { accounts:[structuredClone(account)], calendars:[structuredClone(summary)], events:[structuredClone(event)], feeds:{} as Record<string,GoogleCalendarEvent[]|Error>, reads:[] as string[], listCount:0, accountCount:0, inFlight:0, maxInFlight:0, fail:null as Error|null, duringFeed:undefined as (()=>void|Promise<void>)|undefined, duringList:undefined as (()=>void)|undefined };
  const client: GoogleCalendarClient = {
    gmailAccounts: async () => { state.accountCount++; return structuredClone(state.accounts); },
    googleCalendars: async grant => { assert.equal(grant,'grant'); state.listCount++; state.duringList?.(); if(state.fail)throw state.fail;return structuredClone(state.calendars); },
    googleCalendarFeed: async (grant,id,input) => {
      assert.equal(grant,'grant');assert.deepEqual(input,expectedRange);state.reads.push(id);state.inFlight++;state.maxInFlight=Math.max(state.maxInFlight,state.inFlight);
      try{
        await state.duringFeed?.();await Promise.resolve();if(state.fail)throw state.fail;
        const own=state.feeds[id];if(own instanceof Error)throw own;
        return {calendarId:id,events:structuredClone(own??state.events),syncedAt:'2026-10-13T20:00:00Z'};
      }finally{state.inFlight--;}
    },
  };
  const reader = new GoogleCalendarReader(client,()=>active);
  /** One calendar's result, or the account-level failure. */
  const read = async (window = range, abort = signal(), id = primaryId): Promise<GoogleCalendarRead> => {
    const many = await reader.readMany([id], window, abort);
    return many.status === 'ready' ? many.results[0].result : many;
  };
  return { reader,state,read,setBinding:(value:GoogleCalendarBinding|null)=>{active=value;} };
}
let passed=0;
async function check(name:string,run:()=>Promise<void>) {await run();passed++;console.log(`ok ${passed} - ${name}`);}
await check('every readable calendar is listed with colour, Google\'s shown flag and writability; no selection gate',async()=>{
  const f=fixture();
  f.state.calendars=[{...summary,backgroundColor:'#9FE1E7',foregroundColor:'#000000'},{...summary,calendarId:'team@example.test',summary:'Team',primary:false,accessRole:'writer',selected:false,backgroundColor:'not-a-colour'},{...summary,calendarId:'holidays@example.test',summary:'Holidays',primary:false,accessRole:'reader'},{...summary,calendarId:'busy@example.test',accessRole:'freeBusyReader'}];
  const read=await f.reader.listSources(signal());assert.equal(read.status,'ready');if(read.status!=='ready')return;
  assert.deepEqual(read.calendars.map(c=>[c.providerCalendarId,c.accessRole,c.color,c.textColor,c.selected,c.writable]),[['primary@example.test','owner','#9fe1e7','#000000',true,false],['team@example.test','writer',null,null,false,false],['holidays@example.test','reader',null,null,true,false]]);
  f.state.accounts[0].grantedCapabilities=['google.calendar.read','google.calendar.write'];
  const write=await f.reader.listSources(signal());assert.equal(write.status,'ready');if(write.status!=='ready')return;
  assert.deepEqual(write.calendars.map(c=>c.writable),[true,true,false],'writer/owner with the write grant; reader never');
  // Reading needs no prior choice: any listed calendar can be read straight away.
  f.state.feeds['holidays@example.test']=[];assert.equal((await f.read(range,signal(),sourceOf('holidays@example.test'))).status,'ready');
});
await check('maps a calendar without modifying local calendars',async()=>{
  const f=fixture(),local=[{id:'local',title:'Preserved'}],before=structuredClone(local);
  const result=await f.read();assert.equal(result.status,'ready');if(result.status!=='ready')return;
  assert.equal(result.events[0].calendarId,primaryId);assert.equal(result.events[0].begin,Date.parse(event.startAt));
  assert.equal(result.events[0].writable,false);assert.equal(result.events[0].source,'google');assert.equal(result.events[0].body,'Read-only detail');
  assert.equal(result.events[0].id,`${primaryId}:event`);assert.equal(result.events[0].connectionId,'grant');assert.equal(result.events[0].providerCalendarId,summary.calendarId);
  assert.deepEqual(f.state.reads,[summary.calendarId]);assert.deepEqual(local,before);assert.equal(result.truncated,false);
});
await check('records carry series, links, guests and the owner\'s own answer; the answer is part of the revision',async()=>{
  const f=fixture();f.state.accounts[0].grantedCapabilities=['google.calendar.read','google.calendar.write'];
  const guests=[{email:'organizer@example.test',displayName:null,responseStatus:'accepted',self:false,organizer:true,optional:false},{email:'owner@example.test',displayName:'Owner',responseStatus:'tentative',self:true,organizer:false,optional:false}];
  f.state.events=[{...event,htmlLink:'https://www.google.com/calendar/event?eid=x',conferenceLink:'javascript:alert(1)',organizer:{email:'organizer@example.test',self:false},attendees:guests,metadata:{recurringEventId:'series_1'}}];
  const first=await f.read();assert.equal(first.status,'ready');if(first.status!=='ready')return;
  const row=first.events[0];
  assert.equal(row.writable,true);assert.equal(row.recurringEventId,'series_1');assert.equal(row.htmlLink,'https://www.google.com/calendar/event?eid=x');assert.equal(row.conferenceLink,null,'only https links are kept');
  assert.equal(row.selfResponse,'tentative');assert.equal(row.organizerSelf,false);assert.deepEqual(row.attendees,guests);
  f.state.events[0].attendees=[guests[0],{...guests[1],responseStatus:'accepted'}];
  const second=await f.read();assert.equal(second.status,'ready');if(second.status!=='ready')return;
  assert.notEqual(second.events[0].revision,row.revision,'a changed answer changes the revision');
  f.state.events=[{...event,organizer:{self:true},attendees:[]}];
  const own=await f.read();assert.equal(own.status,'ready');if(own.status==='ready'){assert.equal(own.events[0].organizerSelf,true);assert.equal(own.events[0].selfResponse,null);assert.equal(own.events[0].recurringEventId,null);}
});
await check('readMany checks the account and lists calendars once, reads at most three feeds at a time, and isolates failures',async()=>{
  const f=fixture(),ids=['a','b','c','d','e'].map(name=>`${name}@example.test`);
  f.state.calendars=ids.map((calendarId,index)=>({...summary,calendarId,primary:index===0}));
  for(const id of ids)f.state.feeds[id]=[{...event,calendarId:id,externalId:'only-'+id.slice(0,1)}];
  f.state.feeds['c@example.test']=new Error('network failed');
  f.state.feeds['d@example.test']=new CloudProtocolError('http',404);
  const many=await f.reader.readMany([...ids.map(sourceOf),sourceOf('gone@example.test'),sourceOf('a@example.test')],range,signal());
  assert.equal(many.status,'ready');if(many.status!=='ready')return;
  assert.equal(f.state.accountCount,1);assert.equal(f.state.listCount,1);assert.ok(f.state.maxInFlight<=3&&f.state.maxInFlight>1,`concurrency ${f.state.maxInFlight}`);
  assert.deepEqual(many.results.map(r=>r.result.status),['ready','ready','unavailable','permission-required','ready','permission-required'],'duplicates read once; unknown calendars are refused; one failure does not blank the others');
  assert.deepEqual(many.results.flatMap(r=>r.result.status==='ready'?r.result.events.map(e=>e.providerEventId):[]),['only-a','only-b','only-e']);
  assert.equal(many.calendars.length,5);
});
await check('empty feed remains ready; failed request is unavailable',async()=>{
  const f=fixture();f.state.events=[];const empty=await f.read();assert.equal(empty.status,'ready');if(empty.status==='ready')assert.deepEqual(empty.events,[]);
  f.state.fail=new Error('network failed');assert.equal((await f.read()).status,'unavailable');
});
await check('signed out and calendar permission absent are separate states',async()=>{
  const f=fixture();f.setBinding(null);assert.equal((await f.reader.listSources(signal())).status,'not-connected');
  f.setBinding({...binding});f.state.accounts[0].grantedCapabilities=['google.gmail.triage'];assert.equal((await f.reader.listSources(signal())).status,'permission-required');assert.equal(f.state.listCount,0);
});
await check('free busy-only source does not imply event detail permission',async()=>{
  const f=fixture();f.state.calendars[0].accessRole='freeBusyReader';const list=await f.reader.listSources(signal());assert.equal(list.status,'ready');if(list.status==='ready')assert.deepEqual(list.calendars,[]);
});
await check('account, organization, credential, session, environment and connection changes reject late data',async()=>{
  for(const field of Object.keys(binding) as (keyof GoogleCalendarBinding)[]){const f=fixture();f.state.duringFeed=()=>f.setBinding({...binding,[field]:field==='environment'?'staging':'other'});await assert.rejects(f.read(),{name:'AbortError'});}
});
await check('unmount/disconnect invalidation rejects late data',async()=>{
  const f=fixture();f.state.duringFeed=()=>f.reader.invalidate();await assert.rejects(f.read(),{name:'AbortError'});
});
await check('provider grant revoked: Cloud refuses the feed, and the next read reports not connected',async()=>{
  const f=fixture();f.state.duringFeed=()=>{f.state.accounts=[];f.state.feeds[summary.calendarId]=new CloudProtocolError('http',409);};assert.equal((await f.read()).status,'permission-required');
  assert.equal((await f.read()).status,'not-connected');
});
await check('calendar permission removed: the feed refusal and the next read report permission required',async()=>{
  const f=fixture();f.state.duringFeed=()=>{f.state.accounts[0].grantedCapabilities=[];f.state.feeds[summary.calendarId]=new CloudProtocolError('http',403);};assert.equal((await f.read()).status,'permission-required');
  assert.equal((await f.read()).status,'permission-required');
});
await check('a removed or restricted calendar is refused on the next read without reading its feed',async()=>{
  for(const restrict of [false,true]){const f=fixture();if(restrict)f.state.calendars[0].accessRole='freeBusyReader';else f.state.calendars=[];assert.equal((await f.read()).status,'permission-required');assert.deepEqual(f.state.reads,[]);}
});
await check('signed out during a feed fails the whole read as not connected',async()=>{
  const f=fixture();f.state.feeds[summary.calendarId]=new CloudProtocolError('credentials-missing');assert.equal((await f.read()).status,'not-connected');
});
await check('abort signal rejects late success even when a transport ignores it',async()=>{
  const f=fixture();const controller=new AbortController();f.state.duringFeed=()=>controller.abort();await assert.rejects(f.read(range,controller.signal),{name:'AbortError'});
});
await check('all-day spans keep exclusive UTC civil-date boundary through DST',async()=>{
  const dstRange={...range,timeMin:'2026-10-31T00:00:00Z',timeMax:'2026-11-03T00:00:00Z'};
  const f=fixture(dstRange);f.state.events=[{...event,isAllDay:true,timezone:'UTC',startAt:'2026-10-31T00:00:00Z',endAt:'2026-11-02T00:00:00Z'}];const result=await f.read(dstRange);assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].end-result.events[0].begin,2*86400000);assert.equal(result.events[0].timeZone,'UTC');assert.equal(result.events[0].allDay,true);}
  // An event with an unusable time zone is skipped; the rest of the calendar still shows.
  f.state.events=[{...f.state.events[0],timezone:'Invalid/Calendar'},{...event,externalId:'kept',startAt:'2026-11-01T10:00:00Z',endAt:'2026-11-01T11:00:00Z'}];const skipped=await f.read(dstRange);assert.equal(skipped.status,'ready');if(skipped.status==='ready')assert.deepEqual(skipped.events.map(row=>row.providerEventId),['kept']);
});
await check('actual Los Angeles all-day offsets become UTC civil dates with exclusive end',async()=>{
  const holidayRange={...range,timeMin:'2026-09-01T00:00:00Z',timeMax:'2026-09-10T00:00:00Z'};
  const f=fixture(holidayRange);f.state.events=[{...event,isAllDay:true,startAt:'2026-09-07T07:00:00Z',endAt:'2026-09-08T07:00:00Z'}];
  const result=await f.read(holidayRange);assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].begin,Date.parse('2026-09-07T00:00:00Z'));assert.equal(result.events[0].end,Date.parse('2026-09-08T00:00:00Z'));}
});
await check('spring and fall DST all-day boundaries use calendar dates, not elapsed duration',async()=>{
  for(const [startAt,endAt,startDay,endDay] of [
    ['2026-03-08T08:00:00Z','2026-03-09T07:00:00Z','2026-03-08','2026-03-09'],
    ['2026-11-01T07:00:00Z','2026-11-02T08:00:00Z','2026-11-01','2026-11-02'],
    ['2026-10-31T07:00:00Z','2026-11-02T08:00:00Z','2026-10-31','2026-11-02'],
  ]){
    const window={...range,timeMin:startDay+'T00:00:00Z',timeMax:endDay+'T23:59:59Z'},f=fixture(window);
    f.state.events=[{...event,isAllDay:true,timezone:null,startAt,endAt}]; // calendar timezone fallback
    const result=await f.read(window);assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].begin,Date.parse(startDay+'T00:00:00Z'));assert.equal(result.events[0].end,Date.parse(endDay+'T00:00:00Z'));}
  }
});
await check('an unknown all-day timezone is skipped, never shown on a guessed date; it does not hide other events',async()=>{
  const f=fixture();f.state.events=[{...event,isAllDay:true,timezone:'Invalid/Calendar'}];const r1=await f.read();assert.equal(r1.status,'ready');if(r1.status==='ready')assert.equal(r1.events.length,0);
});
await check('cancelled and out-of-window events excluded; recurrence instances stay individual',async()=>{
  const f=fixture();f.state.events=[{...event,externalId:'cancelled',status:'cancelled'}, {...event,externalId:'past',startAt:'2026-10-12T00:00:00Z',endAt:range.timeMin}, {...event,externalId:'occ1',metadata:{recurringEventId:'series'}},{...event,externalId:'occ2',startAt:'2026-10-14T18:00:00Z',endAt:'2026-10-14T19:00:00Z',metadata:{recurringEventId:'series'}}];
  const result=await f.read();assert.equal(result.status,'ready');if(result.status==='ready'){assert.deepEqual(result.events.map(row=>row.providerEventId),['occ1','occ2']);assert.ok(result.events.every(row=>row.repeat===undefined&&row.seriesId===undefined));}
});
await check('cross-source or duplicate records cannot enter a calendar',async()=>{
  for(const duplicate of [false,true]){const f=fixture();f.state.events=duplicate?[event,event]:[{...event,calendarId:'other'}];assert.equal((await f.read()).status,'unavailable');}
});
await check('protocol credential switch is cancellation; denied scope is permission-required',async()=>{
  const f=fixture();f.state.fail=new CloudProtocolError('account-changed');await assert.rejects(f.read(),{name:'AbortError'});
  f.state.fail=new CloudProtocolError('http',403);assert.equal((await f.read()).status,'permission-required');
});
await check('invalid ranges rejected without provider reads',async()=>{
  const f=fixture();await assert.rejects(f.read({...range,timeMax:range.timeMin}),TypeError);await assert.rejects(f.read({...range,timeZone:'invalid/zone'}),RangeError);assert.deepEqual(f.state.reads,[]);
});
console.log(`${passed} synthetic Google Calendar adapter checks passed; no live provider acceptance claimed.`);
