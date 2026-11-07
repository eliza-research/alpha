import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
// Issue #411: wide Calendar day columns and the large-text agenda against the real browser calendar
// provider. Viewport and text-size changes stand in for rotation and system font scaling only.
test.use({hasTouch:true,isMobile:true,viewport:{width:1280,height:800},timezoneId:'UTC'});

test('Calendar leads with the previous day, opens overnight segments as the original event and lists the day at large text',async({page})=>{
 await page.clock.setFixedTime(new Date('2027-03-13T08:00Z'));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const calendar=registerPlugin<any>('AlphaCalendar');
  for(const [title,begin,end] of [['Previous source','2027-03-12T14:00Z','2027-03-12T15:00Z'],['Current source','2027-03-13T14:00Z','2027-03-13T15:00Z'],['Overnight source','2027-03-13T23:00Z','2027-03-14T01:00Z']]){const creationId=crypto.randomUUID();await calendar.save({creationId,separateCreation:true,calendarId:'local',title,begin:Date.parse(begin),end:Date.parse(end)});await calendar.acknowledgeCreation({creationId});}
 });
 await page.reload();await openBrowserCalendar(page);
 const columns=page.locator('[data-alpha-calendar-day]');
 await expect(columns).toHaveCount(5);
 await expect(columns.nth(1)).toHaveAttribute('aria-current','date');
 await expect(columns.nth(0).getByRole('button',{name:/^Previous source,/})).toBeVisible();
 await expect(columns.nth(1).getByRole('button',{name:/^Current source,/})).toBeVisible();
 await expect(columns.nth(2).getByRole('button',{name:/^Overnight source,/})).toBeVisible();
 const labels=await columns.evaluateAll(list=>list.map(column=>column.getAttribute('aria-label')));
 await page.screenshot({animations:'disabled',path:test.info().outputPath('calendar-days.png')});
 // The next day's segment opens the original event; closing keeps the same days on screen.
 await columns.nth(2).getByRole('button',{name:/^Overnight source,/}).click();
 await expect(page.getByRole('heading',{name:'Overnight source',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 await expect.poll(()=>columns.evaluateAll(list=>list.map(column=>column.getAttribute('aria-label')))).toEqual(labels);
 // Large text lists the selected day, all of its sources included, with explicit times.
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 const agenda=page.getByRole('region',{name:'Calendar agenda',exact:true});
 await expect(agenda).toBeVisible();
 await expect(columns).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Calendar timeline',exact:true})).toBeHidden();
 await expect(agenda.getByRole('button',{name:/^Current source, 2:00\sPM$/})).toBeVisible();
 await expect(agenda.getByRole('button',{name:/^Overnight source, 11:00\sPM$/})).toBeVisible();
 await page.screenshot({animations:'disabled',path:test.info().outputPath('calendar-large-text-agenda.png')});
 await agenda.getByRole('button',{name:/^Overnight source,/}).click();
 await expect(page.getByRole('heading',{name:'Overnight source',exact:true})).toBeVisible();
});
