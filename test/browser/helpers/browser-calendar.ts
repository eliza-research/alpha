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
