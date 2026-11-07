import assert from 'node:assert/strict';
import test from 'node:test';
import {AgentCalendar,calendarSourceKey,type CalendarPreservation} from '../apps/app/src/runtime/agent-calendar';
import {assertAppRecordRequestAllowed} from '../apps/app/src/runtime/app-record-route-policy';
import type {AppRecordPort} from '../apps/app/src/runtime/agent-calendar-client';

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
