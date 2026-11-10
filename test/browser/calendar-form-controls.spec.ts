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

test('day chips reach a month ahead, keep Today one tap away and mark the chosen day', async ({ page }) => {
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  const row = page.locator('div.scr[style*="pan-x"]').first(), chips = row.locator('button');
  await expect(chips.first()).toBeVisible();
  for (let i = 0; i < 3 && (await calendar(page)).form.off < 30; i++) await chips.last().click();
  expect((await calendar(page)).form.off).toBeGreaterThanOrEqual(30);
  await expect(chips.first()).toContainText('Today');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await chips.first().click();
  expect((await calendar(page)).form.off).toBe(0);
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
});

test('Start later near midnight never moves the start earlier', async ({ page }) => {
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  const later = page.getByRole('button', { name: 'Start later', exact: true });
  await calendar(page, { t: 23.5, d: 1 });
  await later.click();
  expect((await calendar(page)).form.t).toBe(23.5);
  await calendar(page, { t: 22, d: 1 });
  await later.click();
  expect((await calendar(page)).form.t).toBe(22.25);
  await calendar(page, { t: 22.75, d: 1.25 });
  await later.click();
  expect((await calendar(page)).form.t).toBe(22.75);
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
