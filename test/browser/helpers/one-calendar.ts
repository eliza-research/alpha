import {expect,type Page} from '@playwright/test';

/** Closed fixture for the one merged Calendar: the agent's CalendarService feed (built-in Eliza Calendar plus
 * the Google calendars the owner shows in Google) and the Cloud Google connection behind Settings. Nothing
 * leaves the page; the agent port and Cloud client are read-only. `googleInFeed` is the CalendarService
 * answer: false is the earlier opt-in default, true is the managed host's Google-visible default. With
 * `google: false` no Google account is connected: the agent lists only its built-in calendar. */
export async function installOneCalendar(page:Page,{googleInFeed,google=true}:{googleInFeed:boolean;google?:boolean}){
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
 await page.evaluate(async({googleInFeed,google})=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const identity={ownerId:'one-calendar-owner',agentId:'one-calendar-agent',sessionId:'one-calendar-session',origin:location.origin};
  const owner='owner@example.test',grant='alpha-google:'+'c'.repeat(64),holidays='en.usa#holiday@group.v.calendar.google.com';
  const at=(days:number,hour:number)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);return d.toISOString();};
  const civil=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00.000Z`;};
  const source=(provider:string,grantId:string,calendarId:string,summary:string,accessRole:string,included:boolean)=>({provider,side:'owner',grantId,connectorAccountId:grantId,accountEmail:provider==='google'?owner:null,calendarId,summary,description:null,primary:calendarId===owner||provider==='eliza',accessRole,backgroundColor:null,foregroundColor:null,timeZone:null,selected:true,includeInFeed:included,selectionVersion:0});
  const calendars=[source('eliza','eliza-calendar','primary','Eliza Calendar','owner',true),source('google',grant,owner,owner,'owner',googleInFeed),source('google',grant,holidays,'Holidays in United States','reader',googleInFeed)].slice(0,google?3:1);
  const event=(calendar:typeof calendars[number],id:string,title:string,startAt:string,endAt:string,isAllDay=false)=>({id:`${calendar.grantId}:${id}`,externalId:id,agentId:identity.agentId,provider:calendar.provider,side:'owner',grantId:calendar.grantId,connectorAccountId:calendar.connectorAccountId,calendarId:calendar.calendarId,title,description:'',location:'',status:'confirmed',startAt,endAt,isAllDay,timezone:isAllDay?null:'UTC',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{etag:`"${id}-v1"`},syncedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  // Tomorrow, from three sources: the built-in calendar, the owner's Google calendar and Google's Holidays.
  const events=[event(calendars[0],'dentist','Dentist',at(1,11),at(1,12)),...(google?[event(calendars[1],'standup','Team standup',at(1,9),at(1,10)),event(calendars[1],'design-review','Design review',at(1,14),at(1,15)),event(calendars[2],'holiday','Public holiday',civil(1),civil(2),true)]:[])];
  const included=()=>events.filter(e=>calendars.some(s=>s.includeInFeed&&s.grantId===e.grantId&&s.calendarId===e.calendarId));
  const f=(window as any).oneCalendarFixture={requests:[] as string[],googleCalendarLists:0};
  const port={identity,sessionId:identity.sessionId,current:()=>true,request:async(path:string,method:string,_body:unknown,signal:AbortSignal)=>{
   signal.throwIfAborted();f.requests.push(`${method} ${path}`);if(method!=='GET')throw Error('The one-calendar fixture is read only');
   const url=new URL(path,location.origin);
   if(url.pathname==='/api/notes/state')return{success:true,data:{notes:[],trash:[],revision:0}};
   if(url.pathname==='/api/lifeops/calendar/calendars')return{calendars:structuredClone(calendars)};
   if(url.pathname==='/api/lifeops/calendar/feed')return{calendarId:'all',events:structuredClone(included()),source:'synced',state:'complete',sources:[],timeMin:url.searchParams.get('timeMin'),timeMax:url.searchParams.get('timeMax'),syncedAt:new Date().toISOString()};
   if(url.pathname==='/api/lifeops/calendar/next-context'){
    const next=included().filter(e=>Date.parse(e.endAt)>Date.now()).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt))[0]??null;
    return{event:next,readScope:{selection:'next_event',timeMin:new Date().toISOString(),timeMax:new Date(Date.now()+7*86400000).toISOString(),exhaustive:false},calendarFeedState:'complete',calendarSources:[],startsAt:next?.startAt??null,startsInMinutes:next?(Date.parse(next.startAt)-Date.now())/60000:null,attendeeCount:0,attendeeNames:[],location:null,conferenceLink:null,preparationChecklist:[],linkedMailState:'unavailable',linkedMailError:null,linkedMail:[]};
   }
   throw Error('Unexpected one-calendar request '+path);
  }};
  const connection='5a7c1e2d-3b4f-4a6e-8c9d-0e1f2a3b4c5d';
  const client={
   gmailAccounts:async()=>google?[{connectionId:connection,label:owner,configured:true,connected:true,reason:'connected',grantedCapabilities:['google.gmail.triage','google.gmail.send','google.calendar.read','google.calendar.write']}]:[],
   googleCalendars:async()=>{f.googleCalendarLists++;return[{calendarId:owner,summary:owner,description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'UTC',selected:true},{calendarId:holidays,summary:'Holidays in United States',description:null,primary:false,accessRole:'reader',backgroundColor:null,foregroundColor:null,timeZone:'UTC',selected:true}];},
   googleCalendarFeed:async()=>{throw Error('The one-calendar fixture reads Google only through the agent feed');},
   initiateGoogle:async()=>{throw Error('No authorization in this fixture');},
   disconnectGmail:async()=>{throw Error('No disconnect in this fixture');},
  };
  c.getAppRecordClient=()=>port as any;
  await c.offline();
  c.getCloudClient=()=>({client,sessionId:'one-calendar-cloud',credentialId:'one-calendar-credential'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'8d0f6a3e-1c2b-4d5e-9f60-7a8b9c0d1e2f',organizationId:'1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b',sessionId:'one-calendar-cloud',credentialId:'one-calendar-credential'}};
  c.getSnapshot=()=>snapshot as any;
  window.dispatchEvent(new CustomEvent('alpha:canonical-calendar-invalidated',{detail:{sessionId:identity.sessionId}}));
 },{googleInFeed,google});
 await expect.poll(()=>page.evaluate(()=>(window as any).oneCalendarFixture.requests.filter((r:string)=>r.includes('/api/lifeops/calendar/next-context')).length)).toBeGreaterThan(0);
}
