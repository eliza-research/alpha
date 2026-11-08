import {test,expect,type Page} from '@playwright/test';
import {installOneCalendar} from './helpers/one-calendar';
import {settled} from './helpers/settled';

const requests=(page:Page)=>page.evaluate(()=>(window as any).oneCalendarFixture as {requests:string[];googleCalendarLists:number});

test('Calendar shows a saved reminder when there are no calendar events or Google connection',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-07T19:00:00Z'));
 await installOneCalendar(page,{googleInFeed:false,google:false,localEvents:false});
 const title='Bring the blue notebook';
 const saved=await page.evaluate(async title=>{
  const {DailyApps}=await import('/src/daily.ts');
  const at=Date.now()+60*60*1000;
  const result=await DailyApps.scheduleReminder({id:crypto.randomUUID(),title,body:'',at});
  if(result.status==='scheduled')window.dispatchEvent(new Event('alpha:reminders-committed'));
  return result.status;
 },title);
 expect(saved).toBe('scheduled');
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await expect(page.getByText(title,{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Refresh Calendar',{exact:true})).toHaveCount(0);
 const observed=await requests(page);
 expect(observed.googleCalendarLists).toBe(0);
 expect(observed.requests.every(request=>request.startsWith('GET '))).toBe(true);
});

test('Calendar, Home and Google accounts show one merged calendar without a calendar choice',async({page},info)=>{
 // A returning owner whose device kept the removed picker's choice (Holidays only): it no longer narrows anything.
 await page.addInitScript(()=>{const owner=JSON.stringify(['production','8d0f6a3e-1c2b-4d5e-9f60-7a8b9c0d1e2f','1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b']),connectionId='5a7c1e2d-3b4f-4a6e-8c9d-0e1f2a3b4c5d',providerCalendarId='en.usa#holiday@group.v.calendar.google.com';
  localStorage.setItem(`alpha.google-calendar-selection.v1:${owner}`,JSON.stringify({version:1,owner,selection:{connectionId,sourceId:`google:${encodeURIComponent(connectionId)}:${encodeURIComponent(providerCalendarId)}`,providerCalendarId,name:'Holidays in United States',account:'owner@example.test'}}));});
 await installOneCalendar(page,{googleInFeed:true});
 const card=page.locator('[data-alpha-home-calendar]');
 // Home reads the merged feed: Google's Holidays leads tomorrow, ahead of the owner's own calendars.
 await expect(card).toContainText('Public holiday');
 await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 // Holidays is shown but read only in Google: its event names the source and offers no change.
 await expect(page.getByText('Holidays in United States · Read only',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit event',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Delete event',exact:true})).toHaveCount(0);
 await settled(page);
 await page.screenshot({path:info.outputPath('read-only-holiday.png')});
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 for(const title of ['Team standup','Dentist','Design review','Public holiday'])await expect(page.getByText(title,{exact:true}).first()).toBeVisible();
 await page.evaluate(async()=>{const {googleConnectionController}=await import('/src/runtime/google-connection-ui.tsx');googleConnectionController.open();});
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel.getByRole('status')).toHaveText('Calendar includes the calendars you show in Google.');
 await expect(panel.getByRole('radio')).toHaveCount(0);
 await expect(panel.getByText('Calendar to display')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'Add Google account',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Check Google connections',exact:true})).toBeVisible();
 // The kept slot is now only the device sync destination; it was read and did not narrow the merged view.
 expect(await page.evaluate(async()=>{const {readGoogleCalendarSelection}=await import('/src/runtime/google-calendar-selection.ts');return readGoogleCalendarSelection({environment:'production',userId:'8d0f6a3e-1c2b-4d5e-9f60-7a8b9c0d1e2f',organizationId:'1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b'})?.name;})).toBe('Holidays in United States');
 const fixture=await requests(page);
 expect(fixture.googleCalendarLists,'Google accounts never lists calendars to choose from').toBe(0);
 expect(fixture.requests.every(request=>request.startsWith('GET ')),'reading the merged calendar writes nothing').toBe(true);
});

test('Calendar Settings keeps one Google entry without narrowing the merged Calendar or Home',async({page})=>{
 await installOneCalendar(page,{googleInFeed:true});
 const card=page.locator('[data-alpha-home-calendar]');
 await expect(card).toContainText('Public holiday');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Apps',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();
 const google=page.getByRole('button',{name:'Google Calendar',exact:true});
 await expect(google).toBeVisible();
 await expect(google).toContainText('Connected');
 await expect(page.getByText('Calendars shown in Alpha',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('switch',{name:/^Show .+ calendar$/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Change .+ calendar color$/})).toHaveCount(0);
 await expect(page.getByText('Current source',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await expect(card).toContainText('Public holiday');
 await card.click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 for(const title of ['Team standup','Dentist','Design review','Public holiday'])await expect(page.getByText(title,{exact:true}).first()).toBeVisible();
 const fixture=await requests(page);
 expect(fixture.googleCalendarLists,'Settings never asks for a calendar chooser').toBe(0);
 expect(fixture.requests.every(request=>request.startsWith('GET ')),'visiting Settings changes no calendar source').toBe(true);
});

test('without a connected Google account Calendar and Home show the local calendar with no errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await installOneCalendar(page,{googleInFeed:true,google:false});
 const card=page.locator('[data-alpha-home-calendar]');
 await expect(card).toContainText('Dentist');
 await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await expect(page.getByText('Refresh Calendar',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(page.getByText('Dentist',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Team standup',{exact:true})).toHaveCount(0);
 await page.evaluate(async()=>{const {googleConnectionController}=await import('/src/runtime/google-connection-ui.tsx');googleConnectionController.open();});
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel.getByRole('status')).toHaveText('No Google account connected.');
 await expect(panel.getByRole('radio')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'Connect Google account',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Close Google accounts',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Apps',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();
 const google=page.getByRole('button',{name:'Google Calendar',exact:true});
 await expect(google).toBeVisible();
 await expect(google).toContainText('Not connected');
 await expect(page.getByRole('switch',{name:/^Show .+ calendar$/})).toHaveCount(0);
 await expect(page.getByText('Calendars shown in Alpha',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Current source',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(card).toContainText('Dentist');
 await expect(card).not.toContainText('Team standup');
 const fixture=await requests(page);
 expect(fixture.googleCalendarLists,'no Google calendar is listed without a Google account').toBe(0);
 expect(fixture.requests.every(request=>request.startsWith('GET ')),'local Calendar remains available without a Google grant or write').toBe(true);
 expect(errors,'no page errors').toEqual([]);
});

for(const title of ['Dentist','Team standup'])test(`editable ${title} exposes its supported event actions`,async({page})=>{
 await installOneCalendar(page,{googleInFeed:true});
 await page.locator('[data-alpha-home-calendar]').click();
 await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 await page.getByText(title,{exact:true}).first().click();
 await expect(page.getByRole('button',{name:'Edit event',exact:true})).toBeVisible();
 if(title==='Team standup'){
  await expect(page.getByRole('button',{name:'Delete event',exact:true})).toHaveCount(0);
  await expect(page.getByText('Delete or decline this event in Google Calendar.',{exact:true})).toBeVisible();
 }else await expect(page.getByRole('button',{name:'Delete event',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue(title);
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeVisible();
 expect((await requests(page)).requests.every(request=>request.startsWith('GET '))).toBe(true);
});
