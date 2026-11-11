import assert from 'node:assert/strict';
import test from 'node:test';
import {AgentCalendar,calendarSourceKey,type CalendarPreservation} from '../apps/app/src/runtime/agent-calendar';
import {assertAppRecordRequestAllowed} from '../apps/app/src/runtime/app-record-route-policy';
import type {AppRecordPort} from '../apps/app/src/runtime/agent-calendar-client';
import {canonicalCalendarRow,canonicalCalendarEditorTiming,calendarFormMinutes,calendarFormPatch,type CanonicalCalendarForm} from '../apps/app/src/runtime/agent-calendar-view';

function deferred<T>(){
 let resolve!:(value:T)=>void, reject!:(error:Error)=>void;
 const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail;});
 return {promise,resolve,reject};
}
async function fixture(){
 const snapshot={fingerprint:'unchanged',present:false,readable:true,pending:false,records:[]};
 let capture:CalendarPreservation['capture']=async()=>snapshot;
 const preservation:CalendarPreservation={capture:signal=>capture(signal),retainedReadOnly:async()=>true};
 const source={provider:'google',side:'owner',grantId:'test-grant',connectorAccountId:'test-account',calendarId:'primary',selectionVersion:1};
 const port={identity:{origin:'https://calendar.example',ownerId:'test-owner',agentId:'test-agent'},sessionId:'test-session',scope:'owner',current:()=>true} as unknown as AppRecordPort;
 const writes:string[]=[];
 const api={
  getLifeOpsCalendarFeed:async()=>({state:'complete',events:[]}),
  getLifeOpsCalendars:async()=>({calendars:[source]}),
  getLifeOpsNextCalendarEventContext:async()=>({event:null}),
  createLifeOpsCalendarEvent:async(request:{idempotencyKey:string})=>{writes.push(request.idempotencyKey);return {outcome:'accepted_without_readback'};},
 };
 const calendar=new AgentCalendar(()=>port,preservation,()=>api as never);
 await calendar.refresh({});
 const create=(key:string)=>calendar.create(calendarSourceKey(source as never),{idempotencyKey:key,title:'Synthetic test',startAt:'2026-10-25T09:00:00Z',endAt:'2026-10-25T10:00:00Z'} as Parameters<AgentCalendar['create']>[1]);
 return {calendar,snapshot,writes,create,setCapture:(next:CalendarPreservation['capture'])=>{capture=next;}};
}

test('pending reservation covers the first await and refuses a concurrent write',async()=>{
 const f=await fixture(),held=deferred<typeof f.snapshot>();let captures=0;
 f.setCapture(()=>{captures++;return held.promise;});
 const first=f.create('first');
 assert.equal(f.calendar.state.mutating,true,'disable writes while preservation is unresolved');
 await assert.rejects(f.create('overlap'),/Wait for the current Calendar source/);
 assert.equal(captures,1,'the refused request must not enter preservation');
 assert.deepEqual(f.writes,[],'preservation must precede the accepted write');
 held.resolve(f.snapshot);await first;
 assert.deepEqual(f.writes,['first']);
 assert.equal(f.calendar.state.mutating,false);
 f.calendar.retire();
});

test('preservation rejection releases pending and permits a later explicit write',async()=>{
 const f=await fixture(),held=deferred<typeof f.snapshot>();
 f.setCapture(()=>held.promise);
 const failed=f.create('failed');
 const rejected=assert.rejects(failed,/Synthetic preservation failure/);
 assert.equal(f.calendar.state.mutating,true);
 held.reject(new Error('Synthetic preservation failure'));await rejected;
 assert.equal(f.calendar.state.mutating,false);
 assert.deepEqual(f.writes,[],'failed preservation must not send a write');
 f.setCapture(async()=>f.snapshot);
 await f.create('later-explicit-request');
 assert.deepEqual(f.writes,['later-explicit-request']);
 assert.equal(f.calendar.state.mutating,false);
 f.calendar.retire();
});

async function syncFixture(){
 const source={provider:'google',side:'owner',grantId:'alpha-google:'+ 'a'.repeat(64),connectorAccountId:'alpha-google:'+ 'a'.repeat(64),calendarId:'primary',selectionVersion:1,accessRole:'owner',summary:'Reviewed Google',accountEmail:'owner@acme.com'};
 const local={id:'agent:eliza:owner:grant:eliza-calendar:calendar:primary:retained',agentId:'test-agent',provider:'eliza',side:'owner',grantId:'eliza-calendar',calendarId:'primary',externalId:'retained'};
 let active=true,currentGrant={...source},revision=0,paused=true,destination:any=null,changedDuringRead=false;
 const calls:Array<{path:string;method:string;body:any}>=[];
 const port:AppRecordPort={identity:{origin:'https://calendar.example',ownerId:'test-owner',agentId:'test-agent'} as AppRecordPort['identity'],sessionId:'session',scope:'owner',current:()=>active,request:async(path,method,body)=>{
  assertAppRecordRequestAllowed(path,method,body);calls.push({path,method,body});
  if(path.startsWith('/api/lifeops/calendar/calendars')){if(changedDuringRead)active=false;return {calendars:[currentGrant]};}
  if(path.startsWith('/api/lifeops/calendar/feed'))return {state:'complete',events:[local]};
  if(path.startsWith('/api/lifeops/calendar/next-context'))return {event:null};
  assert.equal(path,'/api/lifeops/calendar/sync-control');
  if(method==='POST'){const request=body as any;assert.equal(request.expectedRevision,revision);revision++;if(request.operation==='select')destination=request.destination;if(request.operation==='resume')paused=false;if(request.operation==='pause')paused=true;}
  return {revision,paused,destination,pendingDispatch:null};
 }};
 const preservation:CalendarPreservation={capture:async()=>({fingerprint:'same',present:true,readable:true,pending:false,records:[{id:'legacy-only',revision:'legacy-v1'}]}),retainedReadOnly:async()=>true};
 const calendar=new AgentCalendar(()=>port,preservation);await calendar.refresh({});
 return {calendar,source,local,calls,port,setGrant:(patch:any)=>{currentGrant={...currentGrant,...patch};},retire:()=>{active=false;},changeDuringRead:()=>{changedDuringRead=true;}};
}
test('canonical sync review uses the active Calendar event IDs and explicit canonical select then resume routes',async()=>{
 const f=await syncFixture();const review=await f.calendar.reviewSync();
 assert.deepEqual(review.visibleLocalEventIds,[f.local.id]);assert(!review.visibleLocalEventIds.includes('legacy-only'));
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0,'review must not enable or backfill');
 await f.calendar.changeSync(review,'select','select-operation',()=>true,calendarSourceKey(f.source as never));
 let writes=f.calls.filter(c=>c.method==='POST');assert.deepEqual(writes[0].body,{operation:'select',expectedRevision:0,idempotencyKey:'select-operation',destination:{connectorAccountId:f.source.connectorAccountId,providerCalendarId:'primary'}});
 const selected=await f.calendar.reviewSync();assert.equal(selected.control.paused,true,'select must not enable');
 await f.calendar.changeSync(selected,'resume','resume-operation',()=>true);
 writes=f.calls.filter(c=>c.method==='POST');assert.equal(writes.length,2);assert.equal(writes[1].body.operation,'resume');assert.equal(writes[1].body.expectedRevision,1);
 assert(writes.every(c=>c.path==='/api/lifeops/calendar/sync-control'));
 f.calendar.retire();
});
test('sync refuses a revoked or changed destination before any control write',async()=>{
 const f=await syncFixture(),review=await f.calendar.reviewSync();f.setGrant({selectionVersion:2});
 await assert.rejects(f.calendar.changeSync(review,'select','changed',()=>true,calendarSourceKey(f.source as never)),/destination changed/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);f.calendar.retire();
});
test('sync refuses owner changes and a newly retained draft after asynchronous grant verification',async()=>{
 const f=await syncFixture(),review=await f.calendar.reviewSync();f.changeDuringRead();
 await assert.rejects(f.calendar.changeSync(review,'select','changed-owner',()=>true,calendarSourceKey(f.source as never)),/owner or agent changed/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);f.calendar.retire();
 const g=await syncFixture(),review2=await g.calendar.reviewSync();let checks=0;
 await assert.rejects(g.calendar.changeSync(review2,'select','draft',()=>++checks===1,calendarSourceKey(g.source as never)),/context changed/);
 assert.equal(g.calls.filter(c=>c.method==='POST').length,0);g.calendar.retire();
});
test('sync route exposure remains exact and rejects unowned bodies, query changes and other methods',()=>{
 for(const method of ['GET','POST'])assert.doesNotThrow(()=>assertAppRecordRequestAllowed('/api/lifeops/calendar/sync-control',method,method==='GET'?undefined:{}));
 for(const path of ['/api/lifeops/calendar/sync-control?grantId=other','/api/lifeops/calendar/sync-control/other','/api/lifeops/calendar/sync-control%2Fother'])assert.throws(()=>assertAppRecordRequestAllowed(path,'POST',{}));
 for(const method of ['PATCH','DELETE','PUT'])assert.throws(()=>assertAppRecordRequestAllowed('/api/lifeops/calendar/sync-control',method,undefined));
 assert.throws(()=>assertAppRecordRequestAllowed('/api/lifeops/calendar/sync-control','GET',{}));
});

// The editor copies a row's fractional hours into the form; every minute of the day must survive the round trip.
const timed=(start:string,end:string)=>({id:'event',externalId:'event',agentId:'test-agent',provider:'google',side:'owner',grantId:'test-grant',connectorAccountId:'test-account',calendarId:'primary',title:'Synthetic',description:'',location:'',status:'confirmed',startAt:start,endAt:end,timezone:'UTC',isAllDay:false,htmlLink:null,conferenceLink:null,organizer:{self:true},attendees:[],metadata:{etag:'v1'}}) as never;
const form=(row:{t:number;d:number},day:number):CanonicalCalendarForm=>({ownerKey:'owner',operationKey:'operation',sourceKey:'source',date:{year:2026,month:11,day},startMinutes:calendarFormMinutes(row.t),durationMinutes:calendarFormMinutes(row.d),timeZone:'UTC',title:'Synthetic',notes:'',location:''});
test('every start minute of the day round-trips from an event row to whole form minutes',()=>{
 const now=new Date('2026-11-07T00:00:00Z');
 for(let minute=0;minute<1440;minute++){
  const start=Date.UTC(2026,10,7,0,minute),row=canonicalCalendarRow(timed(new Date(start).toISOString(),new Date(start+3600000).toISOString()),'UTC',now);
  assert.equal(calendarFormMinutes(row.t),minute);assert.equal(calendarFormMinutes(row.d),60);
 }
});
test('moving an event that starts at an awkward minute to another day keeps its time',()=>{
 const now=new Date('2026-11-07T00:00:00Z');
 for(const [start,end] of [['16:20','17:35'],['08:05','09:05'],['17:02','17:47']]){
  const row=canonicalCalendarRow(timed(`2026-11-07T${start}:00Z`,`2026-11-07T${end}:00Z`),'UTC',now),edit=form(row,8);
  assert(Number.isInteger(edit.startMinutes)&&Number.isInteger(edit.durationMinutes));
  const patch=calendarFormPatch(edit,timed(`2026-11-07T${start}:00Z`,`2026-11-07T${end}:00Z`),{timing:true});
  assert.equal(Date.parse(patch.startAt as string),Date.parse(`2026-11-08T${start}:00Z`));assert.equal(Date.parse(patch.endAt as string),Date.parse(`2026-11-08T${end}:00Z`));
 }
 const row=canonicalCalendarRow(timed('2026-11-07T16:20:00Z','2026-11-07T17:35:00Z'),'UTC',now);assert.equal(calendarFormMinutes(row.d),75);
});

// A layout row uses elapsed duration. A civil editor must derive both displayed endpoints instead.
test('spring clock change and multi-day editor ranges retain their real endpoint clocks',()=>{
 const event=timed('2027-03-14T06:30:00Z','2027-03-14T07:30:00Z');
 const row=canonicalCalendarEditorTiming(event,'America/New_York',new Date('2027-03-14T12:00Z'));
 assert.equal(row.t,1.5);assert.equal(row.d,2);assert.equal(row.locked,false);
 const fields={...form(row,14),date:{year:2027,month:3,day:14},timeZone:'America/New_York',title:'Metadata edit'};
 const metadata=calendarFormPatch(fields,event,{timing:false,zone:false});assert.equal(metadata.title,'Metadata edit');assert(!('startAt' in metadata));assert(!('endAt' in metadata));
 const move=calendarFormPatch({...fields,date:{year:2027,month:3,day:15}},event,{timing:true,zone:false});
 assert.equal(move.startAt,'2027-03-15T05:30:00.000Z');assert.equal(move.endAt,'2027-03-15T07:30:00.000Z');
 const long=canonicalCalendarEditorTiming(timed('2027-03-13T22:17Z','2027-03-16T08:23Z'),'America/New_York',new Date('2027-03-13T12:00Z'));
 assert.equal(calendarFormMinutes(long.d),3546);
});
test('changing one endpoint preserves the original repeated hour and seconds on the untouched endpoint',()=>{
 const event=timed('2027-11-07T05:30:23Z','2027-11-07T07:30:19Z');
 const row=canonicalCalendarEditorTiming(event,'America/New_York',new Date('2027-11-07T12:00Z'));
 const fields={...form(row,7),date:{year:2027,month:11,day:7},timeZone:'America/New_York',durationMinutes:120};
 const patch=calendarFormPatch(fields,event,{timing:true,zone:false});
 assert(!('startAt' in patch));assert.equal(patch.endAt,'2027-11-07T08:30:00.000Z');
 assert.throws(()=>calendarFormPatch({...fields,startMinutes:75},event,{timing:true,zone:false}),/ambiguous|repeated|more than one|twice/i);
 const backwards=canonicalCalendarEditorTiming(timed('2027-11-07T05:45:00Z','2027-11-07T06:15:00Z'),'America/New_York');
 assert.equal(backwards.locked,true);
});
