import {expect, type Page} from '@playwright/test';

/** Compatibility fixtures seed the persisted authority retained from older installations.
 * This is a synthetic upgrade state, not a current Settings choice or permission grant. */
export async function openRetainedCalendarSource(page:Page,authority:'android-native'|'browser-local'|'canonical'){
  await page.evaluate(authority=>{
    const root=document.getElementById('root') as any,key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
    if(!key)throw Error('Phone shell is unavailable');
    const pending=[root[key]];
    while(pending.length){const fiber=pending.pop(),shell=fiber?.stateNode;
      if(typeof shell?.vset==='function'&&typeof shell?.openView==='function'){
        if(shell.vget('calendar').form)throw Error('Cannot replace an active Calendar draft');
        shell.vset('calendar',{calendarAuthority:authority,open:null});
        shell.openView('calendar',{calendarAuthority:authority});return;
      }
      if(fiber?.sibling)pending.push(fiber.sibling);if(fiber?.child)pending.push(fiber.child);
    }
    throw Error('Phone shell is unavailable');
  },authority);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
}
/** Historical fixture name, retained for developer/native compatibility campaigns. */
export async function selectCalendarSource(page:Page,name:string){
  const authority=name==='Android calendars'?'android-native':name==='Browser calendar (development)'?'browser-local':name==='Agent Calendar'?'canonical':null;
  if(!authority)throw Error('Unsupported retained Calendar fixture authority');
  await openRetainedCalendarSource(page,authority);
}

/** The test-mocks-only browser provider retains its real browser transactions. */
export async function openBrowserCalendar(page: Page) {
  await expect(page.getByRole('button', {name: 'Calendar', exact: true})).toBeVisible();
  await selectCalendarSource(page, 'Browser calendar (development)');
}

/** Use the visible event menu; editing and deletion are no longer inline controls. */
export async function chooseCalendarEventAction(page: Page, action: 'Edit event' | 'Delete event') {
  const menu = page.locator('details').filter({has: page.getByLabel('Event actions', {exact: true})});
  await expect(menu).toBeVisible();
  if (await menu.getAttribute('open') === null) await menu.getByLabel('Event actions', {exact: true}).click();
  await menu.getByRole('button', {name: action, exact: true}).click();
}

/** What a Home calendar card titles itself while its calendar cannot be read. */
export const calendarUnavailable = 'Calendar unavailable';

/** Makes every browser-calendar read reject, then asks Home to read its calendar again. */
export async function failBrowserCalendarReads(page: Page) {
  await page.evaluate(async () => {
    const {BrowserCalendar} = await import('/src/browser/calendar.ts'), proto = BrowserCalendar.prototype as any;
    (window as any).__calendarList = proto.list;
    proto.list = () => Promise.reject(Error('Calendar storage unavailable'));
    window.dispatchEvent(new Event('alpha:calendar-preferences'));
  });
}

/** Lets browser-calendar reads work again, counting them in `window.__calendarReads`. Home is asked
 * to read again only with `notify`; without it the next read must come from somewhere else. */
export async function restoreBrowserCalendarReads(page: Page, {notify}: {notify: boolean}) {
  await page.evaluate(async notify => {
    const {BrowserCalendar} = await import('/src/browser/calendar.ts'), proto = BrowserCalendar.prototype as any, list = (window as any).__calendarList;
    (window as any).__calendarReads = 0;
    proto.list = function (...args: unknown[]) { (window as any).__calendarReads++; return list.apply(this, args); };
    if (notify) window.dispatchEvent(new Event('alpha:calendar-preferences'));
  }, notify);
}

/** Adjust the current From fields through the visible editor controls. */
export async function shiftCalendarStart(page:Page,minutes:number){
  const date=page.getByLabel('From date',{exact:true});
  const time=page.getByLabel('From time',{exact:true});
  const next=new Date(`${await date.inputValue()}T${await time.inputValue()}:00Z`);
  next.setUTCMinutes(next.getUTCMinutes()+minutes);
  await date.fill(next.toISOString().slice(0,10));
  await time.fill(next.toISOString().slice(11,16));
}

/** Seed a retained event-location field after its manual editor was removed. */
export async function setRetainedCalendarLocation(page:Page,value:string){
 await page.evaluate(value=>{
  const root=document.getElementById('root') as any;
  const container=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!container)throw Error('Phone shell is unavailable');
  const pending=[root[container]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.vset==='function'&&shell.S?.().view==='calendar'){
    const form=shell.vget('calendar').form;
    if(!form)throw Error('Open the event editor first');
    shell.vset('calendar',{form:{...form,where:value}});
    return;
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open Calendar first');
 },value);
}
