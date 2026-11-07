import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarAgentWrite as canonicalCalendarAgentWrite,CalendarAgentWriteRefused} from '../scripts/calendar-agent-write-host.ts';
// Match Alpha's explicit source namespace at its managed provider boundary.
const calendarAgentWrite=(...args)=>canonicalCalendarAgentWrite(...args,'alpha-google');
const scope='a'.repeat(64),source=`alpha-google:${scope}`;
const event={title:'Private test',description:'',location:'',startAt:'2026-10-14T18:00:00.000Z',endAt:'2026-10-14T18:02:00.000Z',timeZone:'UTC',isAllDay:false,attendees:[],recurrence:[]};
const snapshot={eventId:'event-1',etag:'"version-1"',event};
const caps={version:1,calendarId:'owner@example.test',accountId:'account-1',read:true,write:true,idempotentCreate:true,conditionalWrites:true,providerExactlyOnce:false};
function fixture(){
 const calls=[];let deleted=false;let feedVersion=snapshot.etag;let returnedSnapshot=snapshot;
 const client={async googleCalendarSync(input){calls.push(input);if(input.kind==='capabilities')return caps;if(input.kind==='get')return {event:deleted?null:returnedSnapshot};if(input.kind==='delete'){deleted=true;return {deleted:true};}return {event:returnedSnapshot};},async googleCalendarFeed(){return {syncedAt:'2026-10-15T00:00:00Z',events:[{...event,externalId:snapshot.eventId,metadata:{etag:feedVersion},organizer:null,status:'confirmed'}]};}};
 return {client,calls,setFeedVersion:v=>{feedVersion=v;},setSnapshot:v=>{returnedSnapshot=v;}};
}
const base={operation:'write-execute',grantId:source,calendarId:caps.calendarId,accountId:caps.accountId};
const payload={action:'schedule_event',side:'owner',grantId:source,calendarId:caps.calendarId,title:event.title,startsAtMs:Date.parse(event.startAt),endsAtMs:Date.parse(event.endAt),timeZone:'UTC',attendees:[],notifyAttendees:false};
const signal=()=>new AbortController().signal;
test('create uses exact account and stable key, and requires matching provider readback',async()=>{const f=fixture();const r=await calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable-key'}},signal());assert.equal(r.event.id,`${source}:event-1`);const write=f.calls.find(x=>x.kind==='create');assert.equal(write.idempotencyKey,'stable-key');assert.equal(write.selection.accountId,'account-1');assert.equal(f.calls.filter(x=>x.kind==='create').length,1);});
test('changed account never dispatches a write',async()=>{const f=fixture();await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,accountId:'other',payload,preflight:{idempotencyKey:'stable'}},signal()),/account changed/);assert.equal(f.calls.filter(x=>x.kind==='create').length,0);});
test('stale approved revision prevents update',async()=>{const f=fixture();await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload:{...payload,action:'modify_event',eventId:`${source}:event-1`,expectedProviderVersion:'old',patch:{title:'Changed'}},preflight:{providerEventId:'event-1',providerVersion:'old'}},signal()),/revision changed/);assert.equal(f.calls.filter(x=>x.kind==='update').length,0);});
test('missing postwrite readback does not retry create',async()=>{const f=fixture();f.setFeedVersion('changed');await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal()),/read back/);assert.equal(f.calls.filter(x=>x.kind==='create').length,1);});
test('source mismatch refuses before reading provider',async()=>{const f=fixture();await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,grantId:'other'},signal()),/source changed/);assert.equal(f.calls.length,0);});
test('delete requires exact ETag and verifies absence',async()=>{const f=fixture();const r=await calendarAgentWrite(f.client,'grant',scope,{...base,payload:{...payload,action:'cancel_event',eventId:`${source}:event-1`,expectedProviderVersion:snapshot.etag,cancellationMode:'organizer_cancel'},preflight:{providerEventId:'event-1',providerVersion:snapshot.etag}},signal());assert.equal(r.event.externalId,'event-1');assert.equal(f.calls.find(x=>x.kind==='delete').expectedEtag,snapshot.etag);assert.equal(f.calls.at(-1).kind,'get');});
test('a provider event id stays confined to the explicitly selected source',async()=>{const f=fixture();const r=await calendarAgentWrite(f.client,'grant',scope,{operation:'write-target',grantId:source,calendarId:caps.calendarId,eventId:'event-1'},signal());assert.equal(r.event.externalId,'event-1');assert.equal(f.calls.find(x=>x.kind==='get').selection.calendarId,caps.calendarId);});

test('a provider result with different event content never reports success or repeats the write',async()=>{const f=fixture();f.setSnapshot({...snapshot,event:{...event,title:'Different'}});await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal()),/approved change/);assert.equal(f.calls.filter(x=>x.kind==='create').length,1);});
test('authoritative sync ETag is retained when the feed omits revision metadata',async()=>{const f=fixture();f.setFeedVersion(undefined);const r=await calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal());assert.equal(r.event.metadata.etag,snapshot.etag);});

// The protocol adapter creates this error from an authenticated Cloud HTTP response.
const refused=(status=400,data={code:'CALENDAR_SYNC_INVALID',outcome:'not_accepted'})=>Object.assign(new Error('Cloud response'),{name:'CloudProtocolError',code:'http',status,data});
test('only explicit nonacceptance from the mutation itself is retryable',async()=>{
 for(const [status,outcome] of [[400,'not_accepted'],[412,'precondition_failed']]){
  const f=fixture(),sync=f.client.googleCalendarSync;f.client.googleCalendarSync=async input=>{if(input.kind==='create'){f.calls.push(input);throw refused(status,{code:'CALENDAR_SYNC_INVALID',outcome});}return sync(input);};
  await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal()),error=>error instanceof CalendarAgentWriteRefused&&error.refusal.outcome===outcome&&error.refusal.grantId===source&&error.refusal.accountId===caps.accountId);
  assert.equal(f.calls.filter(x=>x.kind==='create').length,1);
 }
});
test('timeouts, generic HTTP failures and malformed rejection claims stay unknown',async()=>{
 for(const failure of [new TypeError('Network failed'),refused(503),refused(400,{code:'OTHER_INVALID',outcome:'not_accepted'}),refused(400,{code:'CALENDAR_SYNC_INVALID',outcome:'unknown'}),Object.assign(refused(),{code:'invalid-response'}),{code:'http',status:400,data:{code:'CALENDAR_SYNC_INVALID',outcome:'not_accepted'}}]){
  const f=fixture(),sync=f.client.googleCalendarSync;f.client.googleCalendarSync=async input=>{if(input.kind==='create')throw failure;return sync(input);};
  await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal()),error=>!(error instanceof CalendarAgentWriteRefused));
 }
});
test('a rejection of post-write readback cannot turn acceptance into a safe retry',async()=>{
 const f=fixture();f.client.googleCalendarFeed=async()=>{throw refused();};
 await assert.rejects(calendarAgentWrite(f.client,'grant',scope,{...base,payload,preflight:{idempotencyKey:'stable'}},signal()),error=>!(error instanceof CalendarAgentWriteRefused));assert.equal(f.calls.filter(x=>x.kind==='create').length,1);
});
