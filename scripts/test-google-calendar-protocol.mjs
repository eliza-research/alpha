// Synthetic transport only. No OAuth, provider, or network requests.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
if(!process.execArgv.includes('--experimental-transform-types')){
 const child=spawnSync(process.execPath,['--experimental-transform-types',process.argv[1]],{stdio:'inherit'});process.exit(child.status??1);
}
const {CloudProtocol}=await import('../apps/app/src/runtime/cloud-protocol.ts');
const {managedServiceRequest}=await import('../apps/app/src/runtime/managed-service-routes.ts');
const grant='72475cd0-e135-4c42-a9e2-fb5fe0820ada',calendarId='owner+one@example.invalid';
let credential={credentialId:'first',token:'synthetic-only',userId:'owner',organizationId:'org'},calls=[],mode='ok';
const row={calendarId,summary:'Personal',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'America/Los_Angeles',selected:true};
const event={externalId:'event-one',calendarId,title:'Fixture',description:'',location:'',status:'confirmed',startAt:'2026-10-13T15:00:00Z',endAt:'2026-10-13T16:00:00Z',isAllDay:false,timezone:'America/Los_Angeles',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{recurringEventId:null}};
const range={timeMin:'2026-10-01T00:00:00Z',timeMax:'2026-11-01T00:00:00Z',timeZone:'America/Los_Angeles'};
const signal=()=>new AbortController().signal;
const client=new CloudProtocol('production',async input=>{
 calls.push(input);assert.equal(input.headers.Authorization,'Bearer synthetic-only');assert.equal(input.redirect,'error');
 assert.equal(managedServiceRequest(input.url,input.method,input.body!==undefined),true);
 const url=new URL(input.url);let data;
 if(url.pathname.endsWith('/connect/initiate'))data={authUrl:mode==='bad-url'?'https://attacker.invalid':'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'};
 else{
  assert.equal(url.searchParams.get('side'),'owner');assert.equal(url.searchParams.get('grantId'),grant);
  if(url.pathname.endsWith('/calendars'))data=mode==='duplicate'?[row,row]:[{...row,...(mode==='malformed'?{primary:'yes'}:{})}];
  else{assert.equal(url.searchParams.get('calendarId'),calendarId);assert.equal(url.searchParams.get('timeZone'),range.timeZone);data={calendarId,events:[{...event}],syncedAt:'2026-10-13T17:00:00Z'};
   if(mode==='wrong-calendar')data.calendarId='other';
   if(mode==='wrong-event')data.events[0].calendarId='other';
   if(mode==='bad-time')data.events[0].endAt='not-a-date';
   if(mode==='bad-sync')data.syncedAt='not-a-date';
   if(mode==='partial')data.nextPageToken='unconsumed';
   if(mode==='truncated')data.truncated=true;
  }
 }
 if(mode==='changed')credential={...credential,organizationId:'other-org'};
 return {status:mode==='revoked'?409:200,data};
},{read:async()=>credential,write:async()=>{},clear:async()=>{}},async()=>{});
await client.initiateGoogle(signal());assert.deepEqual(calls.at(-1).body,{side:'owner',capabilities:['google.basic_identity','google.gmail.triage','google.calendar.read']});
await client.initiateGoogle(signal(),'write');assert.deepEqual(calls.at(-1).body.capabilities,['google.basic_identity','google.gmail.triage','google.calendar.read','google.calendar.write']);
for(const permission of ['send','drafts','mailbox']){
 await client.initiateGoogle(signal(),'read',permission);
 assert.deepEqual(calls.at(-1).body.capabilities,['google.basic_identity','google.gmail.triage','google.calendar.read',`google.gmail.${permission}`]);
 assert.equal(calls.at(-1).body.capabilities.includes('google.calendar.write'),false,'Gmail upgrade never adds Calendar writes');
}
await client.initiateGoogle(signal(),'read','modify');assert.deepEqual(calls.at(-1).body.capabilities,['google.basic_identity','google.gmail.triage','google.gmail.send','google.gmail.drafts','google.gmail.mailbox','google.calendar.read'],'one incremental modify consent retains Calendar read');
const beforeInvalidPermission=calls.length;
await assert.rejects(client.initiateGoogle(signal(),'read','manage'),TypeError);
assert.equal(calls.length,beforeInvalidPermission,'unsupported permissions never dispatch');
await client.initiateGmail(signal());assert.deepEqual(calls.at(-1).body.capabilities,['google.basic_identity','google.gmail.triage']);
assert.deepEqual(await client.googleCalendars(grant,signal()),[row]);
assert.equal((await client.googleCalendarFeed(grant,calendarId,range,signal())).events[0].title,'Fixture');
for(const value of ['wrong-calendar','wrong-event','bad-time','bad-sync','partial','truncated']){mode=value;await assert.rejects(client.googleCalendarFeed(grant,calendarId,range,signal()),e=>e.code==='invalid-response',value);}
for(const value of ['malformed','duplicate']){mode=value;await assert.rejects(client.googleCalendars(grant,signal()),e=>e.code==='invalid-response',value);}
mode='bad-url';await assert.rejects(client.initiateGoogle(signal()),e=>e.code==='invalid-response');
mode='changed';await assert.rejects(client.googleCalendars(grant,signal()),e=>e.code==='account-changed');
mode='revoked';await assert.rejects(client.googleCalendars(grant,signal()),e=>e.status===409);
mode='ok';const before=calls.length;
await assert.rejects(client.googleCalendars('not-a-grant',signal()));
await assert.rejects(client.googleCalendarFeed(grant,calendarId,{...range,timeMax:range.timeMin},signal()));
await assert.rejects(client.googleCalendarFeed(grant,calendarId,{...range,timeZone:'not/a-zone'},signal()));
const aborted=new AbortController();aborted.abort();await assert.rejects(client.googleCalendars(grant,aborted.signal));
assert.equal(calls.length,before,'invalid and aborted input never dispatches');
for(const path of ['/api/v1/eliza/google/calendar/feed','/api/v1/eliza/google/calendar/calendars']){
 assert.equal(managedServiceRequest('https://api.eliza.app'+path+'?side=owner','GET'),true);
 assert.equal(managedServiceRequest('https://api.eliza.app'+path,'POST',true),false);
 assert.equal(managedServiceRequest('https://api.eliza.app'+path,'GET',true),false);
 assert.equal(managedServiceRequest('https://other.invalid'+path,'GET'),false);
}
console.log('Google Calendar protocol: combined consent, typed reads, account isolation, malformed and incomplete responses, and managed route boundaries passed.');
