import {installHomeCalendar,refreshHomeCalendar} from './helpers/home-calendar';
import {test,expect as baseExpect,type Page} from '@playwright/test';
// Most tests here load the app more than once (a reload, a second tab or a restart). Each load of the development server
// fetches its ~700 unbundled modules; with four workers on a loaded machine one load has taken 10-20s
// (traces show single module responses of 10s), so the 30s default timed out mid-reload. The timeout
// is explicit and per file; no step, wait or assertion changes.
test.describe.configure({timeout:90_000});
// After each load the cards fill from IndexedDB and the fixture's reads; under that load this has taken
// longer than the 5s default, so expectations wait up to 15s. What is expected is unchanged.
const expect=baseExpect.configure({timeout:15_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
import {returnToApps} from './app-navigation';
import {openBrowserCalendar,selectCalendarSource} from './helpers/browser-calendar';
// Daily overview contract on Home (development lane): every card names its source and when it was
// read, shows loading/empty/error states honestly, keeps overdue reminders visible, and shows the
// latest retained brief only when one exists. Mail and digest data here is synthetic and injected
// through the same adapters a provider uses; nothing is sent, and Home itself never reads mail.
// home-daily-overview.production.spec.ts covers the flag-off build.

const offline=()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
const home=(page:Page)=>page.getByRole('region',{name:'Home',exact:true});
const calendarCard=(page:Page)=>page.locator('[data-alpha-home-calendar]');
const inboxCard=(page:Page)=>home(page).locator('[data-alpha-home-inbox]');
const briefCard=(page:Page)=>home(page).locator('[data-alpha-home-brief]');
/** Home's agenda reads the calendar chosen in Calendar (Agent Calendar by default). The device-calendar
 * cases choose the test-mocks browser calendar, which is not remembered across reloads. */
const browserCalendarHome=async(page:Page)=>{await openBrowserCalendar(page);await returnToApps(page);};
/** The app's own time format for "now" and the neighbouring minutes, so a minute rollover cannot fail the comparison. */
const nearNow=(page:Page)=>page.evaluate(async()=>{const {formatTime}=await import('/src/prototype/locale-time.ts'),now=Date.now();return [-60000,0,60000].map(offset=>formatTime(new Date(now+offset)));});

test('calendar card keeps source and time accessible without generic app labels',async({page},info)=>{
 test.slow(); // Chooses the browser calendar in Calendar after every load.
 await page.addInitScript(offline);await page.goto('/');await browserCalendarHome(page);
 const card=calendarCard(page);
 await expect(card).toContainText('No upcoming events');
 const source=card.locator('[data-alpha-home-calendar-source]');
 const times=await nearNow(page);
 const origin=card.locator('[data-alpha-home-calendar-origin]');
 await expect(origin).toHaveText('');
 await expect(source).toHaveCount(0);
 expect(times.map(time=>`Read ${time} from the calendar saved in this app`)).toContain(await card.getAttribute('aria-description'));
 await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 const expected=await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),date=new Date(Date.now()+2*86400000);date.setHours(9,30,0,0);
  await new BrowserCalendar().save({calendarId:'local',title:'Synthetic overview event',begin:date.getTime(),end:date.getTime()+1800000,allDay:false,creationId:crypto.randomUUID()});
  const time=(value:number)=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  return {day:date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}),footer:`${time(date.getTime())} – ${time(date.getTime()+1800000)}`};
 });
 await page.reload();await browserCalendarHome(page);
 await expect(card).toHaveAccessibleName(`Open calendar event: Synthetic overview event, ${expected.day}, ${expected.footer}`);
 await expect(card.locator('.home-calendar-footer')).toHaveText(expected.footer);
 await expect(source).toHaveCount(0);
 await expect(origin).toHaveText('');
 await expect(card).not.toContainText('In this app');
 await expect(card).toHaveAttribute('aria-description',/^In this app\. Read \d{1,2}:\d{2}.* from the calendar saved in this app$/);
 // Successful read metadata stays accessible while the event time remains unclipped.
 expect(await card.evaluate(element=>{const footer=element.querySelector<HTMLElement>('.home-calendar-footer')!,a=footer.getBoundingClientRect(),box=element.getBoundingClientRect();return {footerClipped:footer.scrollWidth>footer.clientWidth,inside:a.right<=box.right&&a.bottom<=box.bottom,overflow:element.scrollWidth-element.clientWidth};})).toEqual({footerClipped:false,inside:true,overflow:0});
 await page.screenshot({path:info.outputPath('home-calendar-source.png'),animations:'disabled'});
});

test('events of an app calendar hidden in Calendar stay off Home until it is shown again',async({page})=>{
 test.slow(); // Chooses the browser calendar in Calendar after every load.
 await page.addInitScript(offline);await page.goto('/');await browserCalendarHome(page);
 const card=calendarCard(page);
 await expect(card).toContainText('No upcoming events');
 const toggle=()=>page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().changePreferences({action:'visibility'});});
 await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),date=new Date(Date.now()+2*86400000);date.setHours(9,30,0,0);
  await new BrowserCalendar().save({calendarId:'local',title:'Synthetic hidden event',begin:date.getTime(),end:date.getTime()+1800000,allDay:false,creationId:crypto.randomUUID()});
 });
 await page.reload();await browserCalendarHome(page);
 await expect(card).toContainText('Synthetic hidden event');
 await toggle();await page.reload();await browserCalendarHome(page);
 await expect(card).toContainText('No visible events');
 await expect(card).not.toContainText(/Synthetic hidden event|No upcoming events/);
 await expect(card).toHaveAccessibleName('Open your calendar');
 await expect(card).toHaveAttribute('data-alpha-home-calendar-event','false');
 // The calendar was still read; only its display is off.
 await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
 await toggle();await page.reload();await browserCalendarHome(page);
 await expect(card).toContainText('Synthetic hidden event');
});

test('a failed calendar read shows the failure with no read time, and opening Calendar from the card reads it again',async({page})=>{
 test.slow(); // Chooses the browser calendar in Calendar after every load.
 await page.addInitScript(offline);await page.goto('/');await browserCalendarHome(page);
 const card=calendarCard(page),source=card.locator('[data-alpha-home-calendar-source]');
 await expect(source).toHaveCount(0);
 await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),proto=BrowserCalendar.prototype as any;
  (window as any).__calendarList=proto.list;proto.list=()=>Promise.reject(Error('Calendar storage unavailable'));
  window.dispatchEvent(new Event('alpha:calendar-preferences'));
 });
 await expect(card).toContainText('Calendar unavailable');
 await expect(source).toHaveText('Open Calendar to retry');
 await expect(card).not.toContainText(/This app|Read \d/);
 await expect(card).toHaveAttribute('aria-description','Calendar could not be read. Open Calendar to retry.');
 // Staying on Home does not hide the failure, and the source working again changes nothing by itself.
 await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),proto=BrowserCalendar.prototype as any,list=(window as any).__calendarList;
  (window as any).__calendarReads=0;proto.list=function(...args:unknown[]){(window as any).__calendarReads++;return list.apply(this,args);};
 });
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent rerender');
 await page.waitForTimeout(500);
 await expect(card).toContainText('Calendar unavailable');
 expect(await page.evaluate(()=>(window as any).__calendarReads)).toBe(0);
 // The route the card names: opening Calendar from it reads the calendar again.
 await card.click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await expect.poll(()=>page.evaluate(()=>(window as any).__calendarReads)).toBeGreaterThan(0);
 await returnToApps(page);
 await expect(card).toContainText('No upcoming events');
 await expect(source).toHaveCount(0);
 await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('');
});

test('an overdue reminder stays on Home, marked overdue with its own source, and opens in Calendar',async({page,context},info)=>{
 test.slow(); // Chooses the browser calendar in Calendar after every load.
 await context.grantPermissions(['notifications']);
 await page.addInitScript(offline);await page.goto('/');await browserCalendarHome(page);
 const scheduled=await page.evaluate(async()=>{
  const {DailyApps}=await import('/src/daily.ts'),at=Date.now()+1500;
  const a=await DailyApps.scheduleReminder({id:'overview-overdue-a',title:'Synthetic overdue reminder',body:'',at});
  const b=await DailyApps.scheduleReminder({id:'overview-overdue-b',title:'Synthetic second overdue',body:'',at:at+200});
  // An event already in progress began before either reminder was due. It must not hide them.
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),begin=Date.now()-3600000;
  await new BrowserCalendar().save({calendarId:'local',title:'Synthetic in-progress event',begin,end:begin+3*3600000,allDay:false,creationId:crypto.randomUUID()});
  return {at,statuses:[a.status,b.status]};
 });
 expect(scheduled.statuses).toEqual(['scheduled','scheduled']);
 await expect.poll(()=>page.evaluate(at=>Date.now()>at+400,scheduled.at),{timeout:10000}).toBe(true);
 await page.reload();await browserCalendarHome(page);
 const card=calendarCard(page);
 await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','true');
 await expect(card).toContainText('Synthetic overdue reminder');
 const due=await page.evaluate(async at=>{const {overdueDueLabel}=await import('/src/prototype/home-cards.ts');return overdueDueLabel(at,Date.now());},scheduled.at);
 expect(due).toMatch(/^Due (\S+, \S+ \d+ )?\d{1,2}:\d{2}/);
 await expect(card).toHaveAccessibleName(`Open overdue reminder: Synthetic overdue reminder, ${due}`);
 await expect(card).toContainText('2 overdue reminders');
 await expect(card.locator('.home-calendar-footer')).toHaveText(due);
 // Its source is the reminder store and that store's read time, not a calendar.
 await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('');
 await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
 // The event in progress is not hidden: it is the next item, on its own line with its own source.
 const next=card.locator('[data-alpha-home-calendar-next-line]');
 await expect(next.locator('.home-calendar-next-text')).toHaveText('Next: Synthetic in-progress event Now');
 await expect(next.locator('[data-alpha-home-calendar-next-source]')).toHaveCount(0);
 await expect(card).toHaveAttribute('aria-description',/^Overdue reminder saved on this browser, read .+\. Next: Synthetic in-progress event, Now\. In this app\. Read .+ from the calendar saved in this app$/);
 // The next line stays inside the card without clipping its text.
 expect(await card.evaluate(element=>{const line=element.querySelector<HTMLElement>('.home-calendar-next-text')!,a=line.getBoundingClientRect(),box=element.getBoundingClientRect();return {clipped:line.scrollWidth>line.clientWidth,inside:a.bottom<=box.bottom&&a.right<=box.right};})).toEqual({clipped:false,inside:true});
 // It is still there after another render and a reload: nothing dismissed it.
 await page.reload();await browserCalendarHome(page);await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','true');
 await page.screenshot({path:info.outputPath('home-overdue.png'),animations:'disabled'});
 await card.click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 await expect(page.getByText('Synthetic overdue reminder').first()).toBeVisible();
 // Handling the oldest one moves the next overdue reminder up; handling both returns the card to the calendar.
 const done=(id:string)=>page.evaluate(async id=>{const {DailyApps}=await import('/src/daily.ts'),row=(await DailyApps.listReminders()).reminders.find(reminder=>reminder.id===id)!;return (await DailyApps.reminderDecision({id,occurrenceId:row.occurrenceId!,action:'done'})).status;},id);
 expect(await done('overview-overdue-a')).toBe('completed');
 await page.reload();await browserCalendarHome(page);
 await expect(card).toContainText('Synthetic second overdue');
 await expect(card).toContainText('Overdue reminder');await expect(card).not.toContainText('overdue reminders');
 await expect(card.locator('.home-calendar-next-text')).toHaveText('Next: Synthetic in-progress event Now');
 expect(await done('overview-overdue-b')).toBe('completed');
 await page.reload();await browserCalendarHome(page);
 await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 await expect(card).toContainText('Synthetic in-progress event');
 await expect(card.locator('[data-alpha-home-calendar-next-line]')).toHaveCount(0);
 await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('');
 await expect(card).toHaveAttribute('aria-description',/^In this app\. Read \d{1,2}:\d{2}.* from the calendar saved in this app$/);
});

test('an upcoming reminder is attributed to the reminder store, not to a calendar',async({page,context})=>{
 test.slow(); // Chooses the browser calendar in Calendar after every load.
 await context.grantPermissions(['notifications']);
 await page.addInitScript(offline);await page.goto('/');
 expect(await page.evaluate(async()=>{
  const {DailyApps}=await import('/src/daily.ts');
  return (await DailyApps.scheduleReminder({id:'overview-upcoming',title:'Synthetic upcoming reminder',body:'',at:Date.now()+3600000})).status;
 })).toBe('scheduled');
 const card=calendarCard(page);
 const attributed=async()=>{
  // The reminder store is read after each load; with parallel workers on the dev server that read
  // can take longer than the default wait (test.slow() does not extend expect timeouts).
  await expect(card).toContainText('Synthetic upcoming reminder',{timeout:20_000});
  await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');
  await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('Reminder');
  await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-description',/^Reminder saved on this browser, read .+/);
  await expect(card).not.toContainText(/In this app|This app|Calendar has not been verified/);
 };
 // Agent Calendar (the default source, not connected here) has no event before it: the reminder leads.
 await page.reload();await attributed();
 // The same reminder leads when the owner chose the browser calendar instead.
 await browserCalendarHome(page);await attributed();
});

test('calendar card shows the verified Agent Calendar event and its source without browser fallback',async({page},info)=>{
 await page.addInitScript(offline);await page.goto('/');await installHomeCalendar(page);
 const card=calendarCard(page);await expect(card).toContainText('Nothing planned');
 const event=await page.evaluate(()=>{const date=new Date(Date.now()+2*86400000);date.setHours(9,30,0,0);const end=new Date(date.getTime()+1800000),time=(d:Date)=>d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return{title:'Synthetic overview event',startAt:date.toISOString(),endAt:end.toISOString(),day:date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}),footer:time(date)+' – '+time(end)};});
 await installHomeCalendar(page,event);await page.reload();await installHomeCalendar(page,event);
 // The shared overview card names the event, its day and time; its source stays visible on the card.
 await expect(card).toHaveAccessibleName(`Open calendar event: Synthetic overview event, ${event.day}, ${event.footer}`);
 await expect(card.locator('.home-calendar-footer')).toHaveText(event.footer);
 await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveText('Agent Calendar');
 await expect(card).not.toContainText('In this app');await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 expect(await card.evaluate(element=>{const footer=element.querySelector<HTMLElement>('.home-calendar-footer')!,a=footer.getBoundingClientRect(),box=element.getBoundingClientRect();return{footerClipped:footer.scrollWidth>footer.clientWidth,inside:a.right<=box.right&&a.bottom<=box.bottom,overflow:element.scrollWidth-element.clientWidth};})).toEqual({footerClipped:false,inside:true,overflow:0});
 expect(await page.evaluate(()=>(window as any).homeCalendarFixture.requests.every((r:any)=>r.method==='GET'))).toBe(true);
 await page.screenshot({path:info.outputPath('home-calendar-source.png'),animations:'disabled'});
});

test('events excluded by the Agent Calendar feed stay off Home until included again',async({page})=>{
 await page.addInitScript(offline);await page.goto('/');
 const event={title:'Synthetic hidden event',startAt:new Date(Date.now()+86400000).toISOString(),endAt:new Date(Date.now()+90000000).toISOString()};
 await installHomeCalendar(page,event);const card=calendarCard(page);await expect(card).toContainText(event.title);
 await refreshHomeCalendar(page,{include:false});await expect(card).toContainText('Nothing planned');await expect(card).not.toContainText(event.title);await expect(card).toHaveAccessibleName('Open Agent Calendar');await expect(card).toHaveAttribute('data-alpha-home-calendar-event','false');
 expect(await page.evaluate(()=>(window as any).homeCalendarFixture.event.title)).toBe(event.title);
 await refreshHomeCalendar(page,{include:true});await expect(card).toContainText(event.title);
});

test('a failed Agent Calendar read stays honest until an explicit Calendar retry',async({page})=>{
 await page.addInitScript(offline);await page.goto('/');await installHomeCalendar(page);
 const card=calendarCard(page);await refreshHomeCalendar(page,{fail:true});await expect(card).toContainText('Calendar unavailable');await expect(card).not.toContainText(/Nothing planned|No upcoming/);await expect(card).toHaveAttribute('aria-description','Calendar service unavailable. Open Calendar to retry.');
 const before=await page.evaluate(()=>(window as any).homeCalendarFixture.requests.length);
 await page.evaluate(()=>{(window as any).homeCalendarFixture.fail=false;});await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent rerender');await page.waitForTimeout(500);
 expect(await page.evaluate(()=>(window as any).homeCalendarFixture.requests.length)).toBe(before);await expect(card).toHaveAttribute('aria-description','Calendar service unavailable. Open Calendar to retry.');
 // Opening Calendar from the failed card is the explicit retry: it reads the agent calendar again.
 await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');await returnToApps(page);await expect(card).toContainText('Nothing planned');
 expect(await page.evaluate(()=>(window as any).homeCalendarFixture.requests.length)).toBeGreaterThan(before);
});

test('an overdue reminder keeps priority over Agent Calendar and restores its event after completion',async({page,context},info)=>{
 await context.grantPermissions(['notifications']);await page.addInitScript(offline);await page.goto('/');
 const event={title:'Synthetic in-progress event',startAt:new Date(Date.now()-3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString()};await installHomeCalendar(page,event);
 const scheduled=await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts'),at=Date.now()+1500;const a=await DailyApps.scheduleReminder({id:'overview-overdue-a',title:'Synthetic overdue reminder',body:'',at});const b=await DailyApps.scheduleReminder({id:'overview-overdue-b',title:'Synthetic second overdue',body:'',at:at+200});const future=await DailyApps.scheduleReminder({id:'overview-future',title:'Unselected future reminder',body:'',at:at+3600000});return{at,statuses:[a.status,b.status,future.status]};});expect(scheduled.statuses).toEqual(['scheduled','scheduled','scheduled']);await expect.poll(()=>page.evaluate(at=>Date.now()>at+400,scheduled.at),{timeout:10000}).toBe(true);
 await page.reload();await installHomeCalendar(page,event);const card=calendarCard(page);await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','true');await expect(card).toContainText('Synthetic overdue reminder');await expect(card).toContainText('2 overdue reminders');await expect(card).toHaveAttribute('aria-description',/^Overdue reminder saved on this browser, read /);// The overdue reminder leads but never hides what comes next: the agent's in-progress event, before the later reminder.
 await expect(card).toHaveAttribute('aria-description',/Next: Synthetic in-progress event, Now\. Agent Calendar$/);await expect(card).not.toHaveAttribute('aria-description',/Unselected future reminder/);await page.screenshot({path:info.outputPath('home-overdue.png'),animations:'disabled'});
 await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');await expect(page.getByText('Synthetic overdue reminder').first()).toBeVisible();
 const done=(id:string)=>page.evaluate(async id=>{const {DailyApps}=await import('/src/daily.ts'),row=(await DailyApps.listReminders()).reminders.find(r=>r.id===id)!;return(await DailyApps.reminderDecision({id,occurrenceId:row.occurrenceId!,action:'done'})).status;},id);
 expect(await done('overview-overdue-a')).toBe('completed');await page.reload();await installHomeCalendar(page,event);await expect(card).toContainText('Synthetic second overdue');expect(await done('overview-overdue-b')).toBe('completed');await page.reload();await installHomeCalendar(page,event);await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');await expect(card).toContainText(event.title);await expect(card.locator('[data-alpha-home-calendar-source]')).toHaveText('Agent Calendar');
});

// With no agent event before it, a reminder saved on this phone leads Home under Agent Calendar with its own source.
test('an upcoming reminder leads Home under Agent Calendar with its own source and stays in Calendar',async({page,context})=>{
 await context.grantPermissions(['notifications']);await page.addInitScript(offline);await page.goto('/');await installHomeCalendar(page);
 expect(await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');return(await DailyApps.scheduleReminder({id:'overview-upcoming',title:'Synthetic upcoming reminder',body:'',at:Date.now()+3600000})).status;})).toBe('scheduled');
 await page.reload();await installHomeCalendar(page);const card=calendarCard(page);await expect(card).toContainText('Synthetic upcoming reminder');await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('Reminder');await expect(card).toHaveAttribute('aria-description',/^Reminder saved on this browser/);await expect(card).not.toContainText('Nothing planned');await expect(card).toHaveAttribute('data-alpha-home-calendar-overdue','false');
 expect(await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');return(await DailyApps.listReminders()).reminders.some(r=>r.id==='overview-upcoming');})).toBe(true);
 await card.click();await expect(page.getByText('Synthetic upcoming reminder',{exact:true}).first()).toBeVisible();
});

// The development lane has no connected agent, so Agent Calendar is not connected here. This guards the
// reminder's own attribution after a browser-calendar read and local midnight; the connected case (a
// ready agent feed with a device read time from an earlier day) is not reproduced in this lane.
test('after a browser calendar read and local midnight, a reminder under Agent Calendar keeps its own source',async({page,context})=>{
 test.slow(); // Chooses the browser calendar, then Agent Calendar, and crosses local midnight.
 await context.grantPermissions(['notifications']);
 const evening=new Date();evening.setHours(23,50,0,0);
 await page.clock.install({time:evening});
 await page.addInitScript(offline);await page.goto('/');
 expect(await page.evaluate(async()=>{
  const {DailyApps}=await import('/src/daily.ts');
  return (await DailyApps.scheduleReminder({id:'overview-agent-after-device',title:'Synthetic agent-scope reminder',body:'',at:Date.now()+3600000})).status;
 })).toBe('scheduled');
 await page.reload();
 // The browser calendar is read once, then the owner chooses Agent Calendar in Settings > Calendar.
 await openBrowserCalendar(page);
 await selectCalendarSource(page,'Agent Calendar');
 await returnToApps(page);
 const card=calendarCard(page);
 await expect(card).toContainText('Synthetic agent-scope reminder');
 // Past midnight the old browser-calendar read is from an earlier day; the reminder store is not.
 await page.clock.fastForward(20*60000);
 await returnToApps(page);
 await expect(card).toContainText('Synthetic agent-scope reminder');
 await expect(card).toHaveAttribute('data-alpha-home-calendar-stale','false');
 await expect(card.locator('[data-alpha-home-calendar-origin]')).toHaveText('Reminder');
 await expect(card).toHaveAttribute('aria-description',/^Reminder saved on this browser, read .+/);
 await expect(card).not.toContainText(/Not updated since/);
});


async function mailFixture(page:Page){
 await page.addInitScript(offline);await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  s.read=async()=>null;
  const f=(window as any).overviewMail={reads:0,threadReads:0,fail:false,rows:[
   {id:'unread-a',threadId:'thread-a',subject:'Synthetic overview subject',from:'Synthetic sender A',to:[],snippet:'Synthetic body preview',receivedAt:'2026-10-09T00:00:00Z',unread:true},
   {id:'read',threadId:'thread-read',subject:'Synthetic read subject',from:'Synthetic sender B',to:[],snippet:'',receivedAt:'2026-10-09T00:00:00Z',unread:false}]};
  const client={gmailAccounts:async()=>[{connectionId:'grant-overview',label:'Synthetic mailbox',connected:true,grantedCapabilities:['google.gmail.triage']}],
   gmailSearch:async()=>{f.reads++;if(f.fail)throw Error('Synthetic provider unavailable');return {messages:structuredClone(f.rows),syncedAt:'fixture',nextPageToken:null};},
   gmailThread:async()=>{f.threadReads++;throw Error('Synthetic thread read is not part of this test');},
   gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false})};
  c.getCloudClient=()=>({client,sessionId:'fixture-overview'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-overview',sessionId:'fixture-overview',credentialId:'fixture-only'}};c.getSnapshot=()=>snapshot;
 });
}
const mailReads=(page:Page)=>page.evaluate(()=>({reads:(window as any).overviewMail.reads,threads:(window as any).overviewMail.threadReads}));

test('Inbox card never reads mail from Home and shows the account and read time of the loaded page',async({page},info)=>{
 const renderErrors:string[]=[];page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Cannot update during an existing state transition'))renderErrors.push(message.text());});
 await mailFixture(page);
 const card=inboxCard(page);
 // A connected account alone does not make Home read mail: re-render, wait, and come back to the foreground.
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent rerender');
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(1500);
 expect(await mailReads(page)).toEqual({reads:0,threads:0});
 await expect(card).not.toContainText(/unread|Synthetic overview subject|Read \d/);
 await expect(card).toContainText(/Open to (check|load) email|Connect email|Inbox/);
 // The user opens Inbox: one explicit read. Home then shows that page's metadata and when it was read.
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();
 const times=await nearNow(page);
 await returnToApps(page);
 expect(await mailReads(page)).toEqual({reads:1,threads:0});
 await expect(card).toHaveAccessibleName('Open Inbox: 1 unread email');
 await expect(card).toContainText('1 unread');await expect(card).toContainText('Synthetic overview subject');
 await expect(card).not.toContainText('Synthetic body preview');await expect(card).not.toContainText('Synthetic read subject');
 const status=await card.getAttribute('aria-description');
 expect(times.map(time=>`Synthetic mailbox · Updated ${time}`)).toContain(status);
 await expect(card).toContainText(status!);
 // Staying on Home does not refresh it.
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Another unsent rerender');
 await page.waitForTimeout(1000);
 expect(await mailReads(page)).toEqual({reads:1,threads:0});
 await expect(card).toHaveAttribute('aria-description',status!);
 await page.screenshot({path:info.outputPath('home-inbox-read-time.png'),animations:'disabled'});
 // A failed refresh in Inbox is reported on Home with the time of the last successful read.
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();
 await page.evaluate(()=>{(window as any).overviewMail.fail=true;});
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 await returnToApps(page);
 await expect(card).toHaveAttribute('aria-description',/^Open to retry · last updated \d{1,2}:\d{2}/);
 await expect(card).not.toContainText('No unread');
 expect(renderErrors,'Inbox cache restoration must not update React during render').toEqual([]);
});

test('the latest retained brief appears with its agent and run time, reports failure, and is absent otherwise',async({page},info)=>{
 await page.addInitScript(offline);await page.goto('/');
 await expect(calendarCard(page)).toBeVisible();
 await expect(briefCard(page)).toHaveCount(0);
 await expect(home(page)).not.toContainText(/Morning brief|No brief yet/);
 const {ranAt,ranIso}=await page.evaluate(async()=>{
  const {rememberRetainedDigests}=await import('/src/runtime/hosted-digests.ts'),at=new Date(Date.now()-3600000);
  rememberRetainedDigests([
   {cursor:1,runId:'run-old',completedAt:new Date(at.getTime()-86400000).toISOString(),status:'succeeded',output:'Synthetic older brief'},
   {cursor:2,runId:'run-new',completedAt:at.toISOString(),status:'succeeded',output:{summary:'Synthetic brief: two meetings and one reply to send.'}}] as any,'Synthetic agent');
  const {whenLabel}=await import('/src/prototype/home-cards.ts');return {ranAt:whenLabel(at.getTime(),Date.now()),ranIso:at.toISOString()};
 });
 const card=briefCard(page);
 await expect(card).toBeVisible();
 await expect(card).toContainText('Latest brief');
 await expect(card).toContainText('Synthetic brief: two meetings and one reply to send.');
 await expect(card).not.toContainText('Synthetic older brief');
 await expect(card).toContainText(`Synthetic agent · Ran ${ranAt}`);
 await expect(card).toHaveAccessibleName(`Open scheduled digests. Latest brief from Synthetic agent, ran ${ranAt}: Synthetic brief: two meetings and one reply to send.`);
 await expect(card).toHaveAttribute('data-alpha-home-brief-failed','false');
 // The three existing cards keep their order and names.
 const tiles=home(page).locator('[data-alpha-home-layout] > .scr').first().getByRole('button');
 await expect(tiles).toHaveCount(4);
 await expect(tiles.nth(0)).toHaveAttribute('data-alpha-home-calendar','');await expect(tiles.nth(2)).toHaveAttribute('data-alpha-home-inbox','');await expect(tiles.nth(3)).toHaveAttribute('data-alpha-home-brief','');
 await card.scrollIntoViewIfNeeded();
 expect(await card.evaluate(element=>{const box=element.getBoundingClientRect(),title=element.querySelector('.home-brief-title')!.getBoundingClientRect(),status=element.querySelector('.home-brief-status')!.getBoundingClientRect();return {height:Math.round(box.height),overflow:element.scrollWidth-element.clientWidth,ordered:title.bottom<=status.top,inside:status.bottom<=box.bottom};})).toEqual({height:196,overflow:0,ordered:true,inside:true});
 await page.screenshot({path:info.outputPath('home-brief.png'),animations:'disabled'});
 // A newer occurrence that was recorded but did not run (missed) is a record, not a brief: it never
 // replaces the last brief that ran and is never presented as a run.
 const missed={cursor:3,runId:'run-missed',completedAt:new Date(Date.now()-1800000).toISOString(),status:'missed',output:{status:'missed',text:'The scheduled time was missed. No backlog was executed.'},error:null};
 const latest=await page.evaluate(async({missed,ranIso})=>{
  const {rememberRetainedDigests,latestRetainedDigest}=await import('/src/runtime/hosted-digests.ts');
  rememberRetainedDigests([{cursor:2,runId:'run-new',completedAt:ranIso,status:'succeeded',output:{summary:'Synthetic brief: two meetings and one reply to send.'}},missed] as any,'Synthetic agent');
  return latestRetainedDigest();
 },{missed,ranIso});
 expect(latest).toMatchObject({status:'succeeded',ranAt:ranIso});
 await expect(card).toContainText('Synthetic brief: two meetings and one reply to send.');
 await expect(card).toContainText(`Synthetic agent · Ran ${ranAt}`);
 await expect(card).not.toContainText('The scheduled time was missed');
 await expect(card).not.toContainText(/Did not run/);
 await expect(card).toHaveAttribute('data-alpha-home-brief-failed','false');
 // With only occurrences that did not run, there is no brief and no card.
 await page.evaluate(async missed=>{(await import('/src/runtime/hosted-digests.ts')).rememberRetainedDigests([missed] as any,'Synthetic agent');},missed);
 await expect(briefCard(page)).toHaveCount(0);
 await expect(home(page)).not.toContainText('The scheduled time was missed');
 // A newer failed run replaces it and says it failed.
 await page.evaluate(async()=>{
  const {rememberRetainedDigests}=await import('/src/runtime/hosted-digests.ts');
  rememberRetainedDigests([{cursor:4,runId:'run-failed',completedAt:new Date(Date.now()-60000).toISOString(),status:'failed',error:'Synthetic source expired'}] as any,'Synthetic agent');
 });
 await expect(card).toHaveAttribute('data-alpha-home-brief-failed','true');
 await expect(card).toContainText('Synthetic source expired');
 await expect(card).toContainText(/Synthetic agent · Failed \d{1,2}:\d{2}/);
 // Opening it shows the retained results list; nothing is run.
 await card.click();
 await expect(page.getByRole('dialog').getByRole('heading',{name:'Scheduled digests',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close scheduled digests',exact:true}).click();
 // When the retained result is cleared (for example the connection changes), the card goes away.
 await page.evaluate(async()=>{(await import('/src/runtime/hosted-digests.ts')).rememberRetainedDigests(null);});
 await expect(briefCard(page)).toHaveCount(0);
});

// The other half of the brief card's path: the digest panel is what records the retained result
// Home reads. This checks the value the panel publishes for the connected profile rather than the
// card (the test above covers the card). One run from an agent result to the rendered card is in
// journey-d-digests.spec.ts (development scheduler) and home-brief-result.production.spec.ts
// (flag-off build, Android bridge stubbed).
test('the digest panel publishes the connected profile\'s newest retained result and withdraws it on disconnect',async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.goto('/?mode=dev');
 const retained=()=>page.evaluate(async()=>(await import('/src/runtime/hosted-digests.ts')).latestRetainedDigest());
 await expect(page.locator('[data-alpha-home-calendar]')).toBeVisible();
 expect(await retained()).toBeNull();
 // Saved for the development profile before it is connected, as results retained from an earlier session.
 const completedAt=await page.evaluate(()=>{
  const at=Date.now()-3600000,iso=(value:number)=>new Date(value).toISOString(),key='alpha.browser.digests.local.v1',state=JSON.parse(localStorage.getItem(key)||'{"sources":[],"loops":[],"receipts":[],"results":[],"cursor":0,"acks":{}}');
  const row=(runId:string,completed:number,extra:object)=>({cursor:++state.cursor,runId,workflowId:'workflow',workflowVersionId:'version',templateVersion:'hosted-digest-1',scheduledAt:iso(completed),source:{observedAt:iso(completed),expiresAt:iso(Date.now()+3600000)},startedAt:iso(completed),completedAt:iso(completed),error:null,...extra});
  // Stored newest-first by cursor on purpose: the newest completion wins, not the last row.
  state.results.push(row('overview-new',at,{status:'finished',output:[{nodeId:'typed-steps',runId:'overview-new',text:'Synthetic retained brief.',steps:[{id:'source',text:'SYNTHETIC_RAW_SOURCE_456'}]}]}),row('overview-old',at-86400000,{status:'finished',output:'Synthetic older brief'}));
  localStorage.setItem(key,JSON.stringify(state));return iso(at);
 });
 expect(await retained()).toBeNull();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await expect.poll(retained,{timeout:20000}).toMatchObject({summary:'Synthetic retained brief.',ranAt:completedAt,status:'finished'});
 // Only the final summary is retained for Home, never the typed-step source payload.
 expect(JSON.stringify(await retained())).not.toContain('SYNTHETIC_RAW_SOURCE_456');
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});
 await expect.poll(retained).toBeNull();
});

test('workflows card shows when its rows were loaded, and nothing before a list is loaded',async({page},info)=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(offline);await page.goto('/?mode=dev&workflows=agent');
 const {installWorkflowListFixture}=await import('./workflow-navigation');await installWorkflowListFixture(page);
 await page.evaluate(async()=>{
  const f=(window as any).overviewFlows={lists:0,writes:0};
  const {WorkflowProtocol:P}=await import('/src/runtime/workflow-protocol.ts');
  P.prototype.lifecycleSupported=async()=>false;
  P.prototype.list=async()=>{f.lists++;return [{id:'overview',name:'Synthetic overview routine',active:true,description:'',versionId:'v1',steps:[]}];};
  for(const method of ['activate','pause','run','lifecycle','updateMetadata'])(P.prototype as any)[method]=async()=>{f.writes++;throw Error('Writes are not part of Home');};
 });
 const card=home(page).locator('[data-alpha-home-workflows]'),freshness=card.locator('[data-alpha-home-workflow-freshness]');
 // No agent: no rows and no load time.
 await expect(freshness).toHaveCount(0);
 await expect(card).not.toContainText(/Loaded \d/);
 await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');});
 await expect(card).toContainText('Synthetic overview routine');
 const times=await nearNow(page);
 expect(times.map(time=>`Loaded ${time}`)).toContain(await freshness.textContent());
 expect(times.map(time=>`Workflows from your agent, loaded ${time}`)).toContain(await card.getAttribute('aria-description'));
 expect(await card.evaluate(element=>({height:Math.round(element.getBoundingClientRect().height),overflowX:element.scrollWidth-element.clientWidth,overflowY:element.scrollHeight-element.clientHeight}))).toEqual({height:196,overflowX:0,overflowY:0});
 await card.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('home-workflows-loaded.png'),animations:'disabled'});
 // Disconnecting retires the rows and their load time together.
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});
 await expect(card).not.toContainText('Synthetic overview routine');
 await expect(freshness).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).overviewFlows.writes)).toBe(0);
});
