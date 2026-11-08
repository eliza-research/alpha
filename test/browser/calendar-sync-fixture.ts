import type {Page} from '@playwright/test';
// Synthetic Google/native boundaries; actual Settings, controller and checkpoint code.
export async function calendarSyncFixture(page:Page,native=false,theme?:'light'|'dark'){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(theme?`/?mode=dev&theme=${theme}`:'/?mode=dev');
 await page.evaluate(async(native)=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx'),{saveGoogleCalendarSelection}=await import('/src/runtime/google-calendar-selection.ts'),{calendarDocument,initialCalendarState,prepareCalendarSource}=await import('/src/browser/calendar-store.ts');
  const userId='11111111-1111-4111-8111-111111111111',organizationId='22222222-2222-4222-8222-222222222222',grantId='33333333-3333-4333-8333-333333333333';
  const f=(window as any).calendarSyncFixture={writes:0,calls:[],remote:null,lost:false,keys:new Map(),credentialId:'fixture-credential',agentId:'fixture-agent'};
  const snapshot=connectionController.getSnapshot();
  let currentSnapshot:typeof snapshot|undefined, currentAgentId='', currentCredentialId='';
  connectionController.getSnapshot=()=>{
   if(!currentSnapshot||currentAgentId!==f.agentId||currentCredentialId!==f.credentialId){
    currentAgentId=f.agentId;currentCredentialId=f.credentialId;
    currentSnapshot={...snapshot,session:{agentId:f.agentId,sessionId:'fixture-agent-session'},cloudAccount:{environment:'production',userId,organizationId,sessionId:'fixture-cloud-session',credentialId:f.credentialId}} as any;
   }
   return currentSnapshot!;
  };
  const client={googleCalendarSync:async(input:any)=>{
   f.calls.push(structuredClone(input));const reply=(event:any)=>({version:1,calendarId:'primary',event,providerExactlyOnce:false});
   if(input.kind==='capabilities')return {version:1,calendarId:'primary',accountId:'fixture-google-user',accountEmail:'owner@example.invalid',calendarLabel:'Personal',read:true,write:true,idempotentCreate:true,conditionalWrites:true,providerExactlyOnce:false};
   expectNeverWrongAccount(input.selection);
   if(input.kind==='get')return reply(f.remote&&(input.reference.eventId===f.remote.eventId||input.reference.idempotencyKey==='alpha-calendar-sync:'+f.keySuffix)?f.remote:null);
   if(input.kind==='create'){
    f.writes++;f.keySuffix=input.idempotencyKey.slice('alpha-calendar-sync:'.length);f.remote={eventId:'google-event',etag:'"1"',event:structuredClone(input.event),visibility:'private',remindersDisabled:true};
    if(f.lost){f.lost=false;throw Object.assign(Error('Synthetic lost response'),{status:502,data:{code:'CALENDAR_SYNC_UNAVAILABLE',outcome:'unknown'}});}return reply(f.remote);
   }
   if(input.kind==='update'){if(input.expectedEtag!==f.remote.etag)throw Object.assign(Error('Revision changed'),{status:412,data:{code:'CALENDAR_SYNC_REVISION_CHANGED',outcome:'precondition_failed'}});f.writes++;f.remote={...f.remote,event:structuredClone(input.event),etag:'"next"'};return reply(f.remote);}
   if(input.kind==='delete'){f.writes++;f.remote=null;return {version:1,calendarId:'primary',deleted:true,providerExactlyOnce:false};}
   throw Error('Unexpected operation');
  }};
  function expectNeverWrongAccount(selection:any){if(selection.grantId!==grantId||selection.calendarId!=='primary'||selection.accountId!=='fixture-google-user')throw Error('Wrong Calendar authority');}
  connectionController.getCloudClient=()=>({client,sessionId:'fixture-cloud-session',credentialId:f.credentialId} as any);
  saveGoogleCalendarSelection({environment:'production',userId,organizationId},{connectionId:grantId,sourceId:`google:${grantId}:primary`,providerCalendarId:'primary',name:'Personal',account:'owner@example.invalid'});
  await prepareCalendarSource();await calendarDocument.edit(initialCalendarState,data=>{data.events=[{id:'alpha-event',calendarId:'local',title:'Local appointment',body:'Private details',location:'',begin:Date.parse('2026-10-16'),end:Date.parse('2026-10-17'),allDay:true,revision:'r1',repeat:'weekdays',who:['guest@example.invalid'],attendeeOptions:{'guest@example.invalid':{optional:true}},excluded:[Date.parse('2026-10-20')],alert:10}];});
  if(native){
   const {BrowserCalendar}=await import('/src/browser/calendar.ts'),{syncAttendees,syncRecurrence}=await import('/src/browser/calendar-sync-fields.ts');
   const local=(await calendarDocument.read(initialCalendarState)).events[0];
   f.native={enabled:false,consents:0,calls:[],deny:false,permission:true,requests:0,revision:'a'.repeat(64),event:{title:local.title,description:local.body,location:local.location,startAt:new Date(local.begin).toISOString().slice(0,10),endAt:new Date(local.end).toISOString().slice(0,10),timeZone:null,isAllDay:true,attendees:syncAttendees(local),recurrence:syncRecurrence(local)}};
   const slots=new Map<string,string>();
   const {BrowserCloudConnection}=await import('/src/browser/cloud-connection.ts');
   BrowserCloudConnection.prototype.secureRead=async(input:any)=>({value:slots.get(input.slot)??null});
   BrowserCloudConnection.prototype.secureWrite=async(input:any)=>{slots.set(input.slot,input.value);return {};};
   BrowserCloudConnection.prototype.secureCompareExchange=async(input:any)=>{if((slots.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)slots.delete(input.slot);else slots.set(input.slot,input.value);return {status:'saved'};};
   const projection=()=>({status:'ready',lease:'55555555-5555-4555-8555-555555555555',binding:{environment:'production',userId,organizationId,connectionId:grantId,providerAccountId:'fixture-google-user',calendarId:'primary',agentId:f.agentId,localSourceId:'native:7',localSourceRevision:'44444444-4444-4444-8444-444444444444'},destination:{account:'owner@example.invalid',calendar:'Personal'},events:[{id:'42',revision:f.native.revision}],enabled:f.native.enabled});
   (BrowserCalendar.prototype as any).sync=async(input:any)=>{
    f.native.calls.push(structuredClone(input));
    if(input.kind==='prepare')return f.native.permission?projection():{status:'permission-required'};
    if(input.kind==='enable'){f.native.consents++;if(f.native.deny)return {status:'cancelled'};f.native.enabled=true;return projection();}
    if(input.kind==='status')return projection();
    if(input.kind==='list')return {status:'ready',events:[{id:'42',revision:f.native.revision}]};
    if(input.kind==='get')return {status:'ready',snapshot:{eventId:'42',revision:f.native.revision,event:structuredClone(f.native.event)}};
    if(input.kind==='apply'){if(!f.native.enabled)return {status:'context-changed'};if(input.expectedRevision!==f.native.revision)return {status:'conflict'};f.native.event=structuredClone(input.event);f.native.revision='b'.repeat(64);return {status:'saved',snapshot:{eventId:'42',revision:f.native.revision,event:structuredClone(f.native.event)}};}
    if(input.kind==='delete'){if(!f.native.enabled)return {status:'context-changed'};return {status:'queued',receipt:{phase:'queued'}};}
    if(input.kind==='deletion')return {status:'receipt',receipt:{phase:f.native.phase||'undone'}};
    if(input.kind==='ack')return {status:'acknowledged'};
    if(input.kind==='pause'){f.native.enabled=false;return {status:'paused'};}
    if(input.kind==='cancel')return {status:'cancelled'};
    throw Error('Unexpected native Calendar fixture operation');
   };
   (BrowserCalendar.prototype as any).requestAccess=async()=>{f.native.requests++;f.native.permission=true;return {status:'granted'};};
   (window as any).Capacitor.isNativePlatform=()=>true;
  }
  const {openCalendarSyncSettings}=await import('/src/runtime/calendar-sync-settings.ts');openCalendarSyncSettings();
 },native);
 return page.getByRole('dialog',{name:'Google Calendar sync',exact:true});
}
