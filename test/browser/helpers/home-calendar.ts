import {expect,type Page} from '@playwright/test';

export type HomeCalendarEvent={title:string;startAt:string;endAt:string;isAllDay?:boolean};
/** Read-only CalendarService fixture. Home never substitutes browser Calendar records. */
export async function installHomeCalendar(page:Page,event:HomeCalendarEvent|null=null){
 await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
 await page.evaluate(async input=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const identity={ownerId:'home-calendar-owner',agentId:'home-calendar-agent',sessionId:'home-calendar-session',origin:location.origin};
  const calendar={provider:'eliza',side:'owner',grantId:'home-calendar-grant',connectorAccountId:'home-calendar-account',accountEmail:null,calendarId:'home-calendar',summary:'Home Calendar fixture',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'UTC',selected:true,includeInFeed:true,selectionVersion:0};
  const event=input?{id:'home-event',externalId:'home-event',agentId:identity.agentId,provider:calendar.provider,side:calendar.side,grantId:calendar.grantId,connectorAccountId:calendar.connectorAccountId,calendarId:calendar.calendarId,title:input.title,description:'Synthetic calendar detail',location:'',status:'confirmed',startAt:input.startAt,endAt:input.endAt,isAllDay:!!input.isAllDay,timezone:'UTC',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{etag:'home-event-v1'},syncedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}:null;
  const fixture=(window as any).homeCalendarFixture={event,include:true,fail:false,reads:0,requests:[] as {path:string;method:string}[]};
  const port={identity,sessionId:identity.sessionId,current:()=>true,request:async(path:string,method:string,_body:unknown,signal:AbortSignal)=>{
   signal.throwIfAborted();fixture.requests.push({path,method});if(method!=='GET')throw Error('Home fixture forbids provider writes');
   const url=new URL(path,location.origin),events=fixture.include&&fixture.event?[structuredClone(fixture.event)]:[];
   if(url.pathname==='/api/notes/state')return{success:true,data:{notes:[],trash:[],revision:0}};
   if(fixture.fail)throw Error('Calendar service unavailable');
   if(url.pathname==='/api/lifeops/calendar/calendars')return{calendars:[{...calendar,includeInFeed:fixture.include}]};
   if(url.pathname==='/api/lifeops/calendar/feed')return{calendarId:calendar.calendarId,events,source:'cache',state:'complete',sources:[],timeMin:url.searchParams.get('timeMin'),timeMax:url.searchParams.get('timeMax'),syncedAt:new Date().toISOString()};
   if(url.pathname==='/api/lifeops/calendar/next-context'){
    fixture.reads++;const selected=events[0]??null;
    return{event:selected,readScope:{selection:'next_event',timeMin:new Date().toISOString(),timeMax:new Date(Date.now()+7*86400000).toISOString(),exhaustive:false},calendarFeedState:'complete',calendarSources:[],startsAt:selected?.startAt??null,startsInMinutes:selected?(Date.parse(selected.startAt)-Date.now())/60000:null,attendeeCount:0,attendeeNames:[],location:null,conferenceLink:null,preparationChecklist:[],linkedMailState:'unavailable',linkedMailError:null,linkedMail:[]};
   }
   throw Error('Unexpected Home Calendar request '+path);
  }};
  connectionController.getAppRecordClient=()=>port as any;
  await connectionController.offline();
  window.dispatchEvent(new CustomEvent('alpha:canonical-calendar-invalidated',{detail:{sessionId:identity.sessionId}}));
 },event);
 await expect.poll(()=>page.evaluate(()=>(window as any).homeCalendarFixture.reads)).toBeGreaterThan(0);
}

export async function refreshHomeCalendar(page:Page,change:{include?:boolean;fail?:boolean}){
 await page.evaluate(change=>{Object.assign((window as any).homeCalendarFixture,change);window.dispatchEvent(new CustomEvent('alpha:canonical-calendar-invalidated',{detail:{sessionId:'home-calendar-session'}}));},change);
}
