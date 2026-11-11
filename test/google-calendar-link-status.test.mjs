// What Connect Google Calendar reports for an already active sync: Sync on only when the background dispatch moves
// between readbacks, and Synced only when no linked event on the destination waits on a conflict decision.
// Actual AgentCalendar and link helper; the agent port is synthetic. No Google or control write runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {tsImport} from 'tsx/esm/api';
const {AgentCalendar}=await tsImport(new URL('../apps/app/src/runtime/agent-calendar.ts',import.meta.url).href,{parentURL:import.meta.url});
const {assertAppRecordRequestAllowed}=await tsImport(new URL('../apps/app/src/runtime/app-record-route-policy.ts',import.meta.url).href,{parentURL:import.meta.url});
const bundle=buildSync({entryPoints:[new URL('../apps/app/src/runtime/google-accounts.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}}).outputFiles[0].text;
const {linkGoogleCalendar}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));

const OWNER='owner@example.test',GRANT='alpha-google:'+'a'.repeat(64);
const WRITE=['google.basic_identity','google.gmail.triage','google.calendar.read','google.calendar.write'];
const destination={connectorAccountId:GRANT,providerCalendarId:OWNER};
const sources=[{provider:'google',side:'owner',grantId:GRANT,connectorAccountId:GRANT,accountEmail:OWNER,calendarId:OWNER,summary:OWNER,description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:null,selected:true,includeInFeed:true,selectionVersion:1}];
const account={configured:true,connected:true,reason:'connected',connectionId:'11111111-1111-4111-8111-111111111111',label:OWNER,grantedCapabilities:WRITE};
const row=(title,state,calendar=destination)=>({id:'link-'+title,localEventId:'event-'+title,...calendar,providerEventId:null,providerEtag:null,localRevision:1,state,pendingOperation:null,lastErrorCode:null,lastErrorMessage:null,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',event:title?{title,startAt:'2026-11-02T10:00:00Z',endAt:'2026-11-02T11:00:00Z',isAllDay:false}:null});

/** dispatches: the pendingDispatch each sync-control readback returns, the last one repeating. */
async function linked({dispatches=[null],links=[],linksFail=false}={}){
 const f={controlReads:0,linkReads:0,writes:0};
 const port={identity:{origin:'https://calendar.example',ownerId:'owner',agentId:'agent'},sessionId:'session',scope:'owner',current:()=>true,request:async(path,method,body)=>{
  assertAppRecordRequestAllowed(path,method,body);
  if(method!=='GET'){f.writes++;throw Error('Unexpected control write');}
  if(path.startsWith('/api/lifeops/calendar/calendars'))return {calendars:structuredClone(sources)};
  if(path.startsWith('/api/lifeops/calendar/feed'))return {state:'complete',events:[]};
  if(path.startsWith('/api/lifeops/calendar/next-context'))return {event:null};
  if(path==='/api/lifeops/calendar/links?view=events'){f.linkReads++;if(linksFail)throw Error('Calendar links are unavailable');return {links:structuredClone(links)};}
  assert.equal(path,'/api/lifeops/calendar/sync-control');
  const pendingDispatch=dispatches[Math.min(f.controlReads++,dispatches.length-1)];
  return {revision:3,paused:false,destination,pendingDispatch};
 }};
 const calendar=new AgentCalendar(()=>port,{capture:async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]}),retainedReadOnly:async()=>true});
 await calendar.refresh({});assert.equal(calendar.state.status,'ready');
 try{return {f,result:await linkGoogleCalendar({calendar,current:()=>true,canChange:()=>true},[account],new AbortController().signal)};}
 finally{calendar.retire();}
}

test('the same pending dispatch on two readbacks is waiting, never Sync on',async()=>{
 const {f,result}=await linked({dispatches:[{linkId:'stuck'}]});
 assert.equal(result.outcome,'unconfirmed');
 assert.equal(result.message,'Waiting');
 assert.equal(f.controlReads,2);assert.equal(f.writes,0);assert.equal(f.linkReads,0);
});

test('a dispatch that moves between readbacks is Sync on',async()=>{
 const {result}=await linked({dispatches:[{linkId:'first'},{linkId:'second'}]});
 assert.equal(result.outcome,'syncing');assert.equal(result.message,`Syncing · ${OWNER}`);
});

test('a conflicted or quarantined event on the destination blocks Synced and is counted',async()=>{
 const {f,result}=await linked({links:[row('Dentist','conflicted'),row('Clean','clean'),row('','quarantined'),row('Elsewhere','conflicted',{connectorAccountId:GRANT,providerCalendarId:'team'})]});
 assert.equal(result.outcome,'unconfirmed');
 assert.equal(result.message,'2 held');
 assert.equal(f.linkReads,1);assert.equal(f.writes,0);
 const many=await linked({links:['A','B','C','D'].map(title=>row(title,'conflicted'))});
 assert.equal(many.result.message,'4 held');
});

test('Synced needs a clean link readback; an unreadable one is not confirmed',async()=>{
 const clean=await linked({links:[row('Clean','clean'),row('Other','conflicted',{connectorAccountId:GRANT,providerCalendarId:'team'})]});
 assert.equal(clean.result.outcome,'synced');assert.equal(clean.result.message,`Synced · ${OWNER}`);
 const failed=await linked({linksFail:true});
 assert.equal(failed.result.outcome,'unconfirmed');assert.equal(failed.result.message,'Unconfirmed · Calendar links are unavailable');
});
