import {test,expect} from '@playwright/test';
// Renderer side of patch 0041: provider fields for all-day, chosen-zone and repeating direct
// saves, handoff routing and the on-device source disclosure. No provider writes here.
test.use({timezoneId:'America/New_York'});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('all-day, zoned and repeating forms map to exact provider fields',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {calendarOptionEvent,calendarUsesOptions,calendarNeedsHandoff,calendarZoneChoices,zonedInstant}=await import('/src/prototype/calendar-adapter.ts');
  const now=new Date(2026,10,2,8),base={title:' Fair ',notes:'n',where:'Hall',off:3,t:9.5,d:1.5,repeat:'none',who:[],video:false,alert:null};
  const allDay=calendarOptionEvent({...base,allDay:true},'America/New_York',now);
  const multiDay=calendarOptionEvent({...base,allDay:true,canonicalAllDay:{startDate:'2026-11-05',endDateExclusive:'2026-11-08'}},'America/New_York',now);
  const tokyo=calendarOptionEvent({...base,zone:'Asia/Tokyo'},'America/New_York',now);
  const weekdays=calendarOptionEvent({...base,repeat:'weekdays'},'America/New_York',now);
  let gap='';try{calendarOptionEvent({...base,off:6,t:2.5,d:1},'America/New_York',new Date(2026,2,2));}catch(error){gap=(error as Error).message;}
  return {allDay,multiDay,tokyo,weekdays,gap,
   uses:[calendarUsesOptions(base,'America/New_York'),calendarUsesOptions({...base,allDay:true},'America/New_York'),calendarUsesOptions({...base,zone:'America/New_York'},'America/New_York'),calendarUsesOptions({...base,zone:'UTC'},'America/New_York'),calendarUsesOptions({...base,repeat:'weekly'},'America/New_York')],
   handoff:[calendarNeedsHandoff(base),calendarNeedsHandoff({...base,who:['a@example.com']}),calendarNeedsHandoff({...base,alert:10}),calendarNeedsHandoff({...base,video:true})],
   zones:calendarZoneChoices('America/New_York','Asia/Tokyo').slice(0,3),
   ambiguous:zonedInstant({year:2026,month:11,day:1},90,'America/New_York')};
 });
 expect(result.allDay).toEqual({title:'Fair',body:'n',location:'Hall',rrule:'',begin:Date.UTC(2026,10,5),end:Date.UTC(2026,10,6),allDay:true,timeZone:'UTC'});
 expect(result.multiDay).toMatchObject({begin:Date.UTC(2026,10,5),end:Date.UTC(2026,10,8)});
 expect(result.tokyo).toMatchObject({allDay:false,timeZone:'Asia/Tokyo',begin:Date.UTC(2026,10,5,0,30),end:Date.UTC(2026,10,5,2,0),rrule:''});
 expect(result.weekdays).toMatchObject({timeZone:'America/New_York',rrule:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',begin:Date.UTC(2026,10,5,14,30)});
 expect(result.gap).toContain('does not exist or occurs twice');
 expect(result.uses).toEqual([false,true,false,true,true]);
 expect(result.handoff).toEqual([false,true,true,true]);
 expect(result.zones).toEqual(['America/New_York','Asia/Tokyo','UTC']);
 expect(result.ambiguous).toBeUndefined();
});
