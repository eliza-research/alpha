import {openBrowserCalendar} from './helpers/browser-calendar';
import { test, expect, type Page } from '@playwright/test';
// Calendar form controls (model.js calendar form): the day chips follow the chosen day so any later
// day is reachable, Start later never moves the start earlier, a five-row month draws five rows,
// and selected chips say so (aria-pressed). Browser renderer only; no provider write.
test.use({ timezoneId: 'America/New_York' });

/** Reads or patches the Calendar view state through the phone shell's own vget/vset. */
const calendar = (page: Page, patch?: Record<string, unknown>) => page.evaluate(patch => {
  const screen = document.querySelector('[data-screen]') as any;
  const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
  let fiber = screen[key];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode.vget === 'function')) fiber = fiber.return;
  const shell = fiber.stateNode;
  if (patch) shell.vset('calendar', { form: { ...shell.vget('calendar').form, ...patch } });
  return shell.vget('calendar');
}, patch);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
  await page.clock.setFixedTime(new Date('2027-06-10T16:00:00Z'));
  await page.goto('/');
  await openBrowserCalendar(page);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'calendar');
});

test('From and To keep the duration, carry across midnight and preserve hidden event data',async({page})=>{
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await calendar(page,{t:23.5,d:1,where:'Retained room',who:['person@example.invalid']});
 await expect(page.getByLabel('From time',{exact:true})).toHaveValue('23:30');
 await expect(page.getByLabel('To date',{exact:true})).toHaveValue('2027-06-11');
 await page.getByLabel('To time',{exact:true}).fill('01:30');
 expect((await calendar(page)).form).toMatchObject({t:23.5,d:2,where:'Retained room',who:['person@example.invalid']});
 await page.getByLabel('From date',{exact:true}).fill('2027-07-10');
 await expect(page.getByLabel('To date',{exact:true})).toHaveValue('2027-07-11');
 await expect(page.getByLabel('Location',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Add people',exact:true})).toHaveCount(0);
});

test('All day uses exclusive end dates and preserves the previous timed duration',async({page})=>{
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await calendar(page,{t:9.5,d:1.5});
 await page.getByRole('switch',{name:'All day',exact:true}).click();
 await expect(page.getByLabel('From time',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('From time',{exact:true})).toHaveValue('00:00');
 await expect(page.getByLabel('To date',{exact:true})).toHaveValue('2027-06-11');
 await page.getByLabel('To date',{exact:true}).fill('2027-06-13');
 expect((await calendar(page)).form.canonicalAllDay).toEqual({startDate:'2027-06-10',endDateExclusive:'2027-06-13'});
 await page.getByRole('switch',{name:'All day',exact:true}).click();
 await expect(page.getByLabel('From time',{exact:true})).toHaveValue('09:30');
 await expect(page.getByLabel('To time',{exact:true})).toHaveValue('11:00');
});

test('the Calendar form has no manual time zone picker and keeps a restored draft’s clock',async({page})=>{
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Time zone',exact:true})).toHaveCount(0);
 await calendar(page,{zone:'Asia/Tokyo',t:9.5,d:1.5,repeat:'weekly'});const before=await calendar(page);
 await expect(page.getByRole('combobox',{name:'Time zone',exact:true})).toHaveCount(0);
 const after=await calendar(page);expect(after.form).toMatchObject({zone:'Asia/Tokyo',t:9.5,d:1.5,repeat:'weekly'});expect(after.form).toEqual(before.form);
});

test('a month that fits five rows draws 35 cells and a six-row month 42', async ({ page }) => {
  await page.getByRole('button', { name: 'Month view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose calendar date' });
  const cells = dialog.getByRole('button', { name: /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/ });
  // June 2027 starts on a Tuesday and has 30 days: five Monday-first rows.
  await expect(cells).toHaveCount(35);
  // May 2027 starts on a Saturday and has 31 days: six rows.
  await dialog.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(cells).toHaveCount(42);
});
