import {expect, test, type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';
import {openCanonicalCalendar} from './helpers/canonical-calendar';

const title = 'Canonical event return';
const location = '12 Market Street, Test Town';
const back = (page: Page) => page.getByRole('button', {name: 'Back to event', exact: true});
const view = (page: Page) => page.locator('html');

async function openEventMaps(page: Page) {
  await page.getByRole('button', {name: new RegExp('^' + title + ',')}).click();
  await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
  await page.getByRole('button', {name: location, exact: true}).click();
  await expect(view(page)).toHaveAttribute('data-active-view', 'maps');
  await expect(back(page)).toBeVisible();
}

async function installHeldReads(page: Page) {
  await openCanonicalCalendar(page, {eventTitle: title, location});
  await page.evaluate(async () => {
    const {connectionController} = await import('/src/runtime/connection-ui.tsx');
    const port = connectionController.getAppRecordClient()!;
    const request = port.request.bind(port);
    const reads: Array<{signal: AbortSignal; finish: () => void}> = [];
    (window as any).heldMapsReturns = reads;
    port.request = async (path, method, body, signal) => {
      const url = new URL(path, window.location.origin);
      const min = Date.parse(url.searchParams.get('timeMin') ?? '');
      const max = Date.parse(url.searchParams.get('timeMax') ?? '');
      const answer = await request(path, method, body, signal);
      if (url.pathname === '/api/lifeops/calendar/feed' && max - min === 2) {
        await new Promise<void>(finish => reads.push({signal, finish}));
      }
      return answer;
    };
  });
}

const reads = (page: Page) => page.evaluate(() =>
  (window as any).heldMapsReturns.map((read: {signal: AbortSignal}) => read.signal.aborted) as boolean[]);
const finish = (page: Page, index: number) => page.evaluate(async index => {
  (window as any).heldMapsReturns[index].finish();
  await new Promise<void>(requestAnimationFrame);
}, index);

test('a fresh canonical Maps visit owns its return while the prior visit still settles', async ({page}) => {
  test.setTimeout(90000);
  await installHeldReads(page);
  await openEventMaps(page);
  await back(page).click();
  await expect.poll(() => reads(page)).toEqual([false]);

  await returnToApps(page);
  await page.getByRole('button', {name: 'Calendar', exact: true}).click();
  await openEventMaps(page);
  await back(page).click();
  await expect.poll(() => reads(page)).toEqual([true, false]);

  await finish(page, 0);
  await expect(view(page)).toHaveAttribute('data-active-view', 'maps');
  await expect(page.getByText("Can't check this event. Try again.", {exact: true})).toHaveCount(0);
  await back(page).click();
  expect(await reads(page)).toEqual([true, false]);

  await finish(page, 1);
  await expect(view(page)).toHaveAttribute('data-active-view', 'calendar');
  await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
});

test('visible pagehide retires a held canonical Maps return before pageshow', async ({page}) => {
  test.setTimeout(90000);
  await installHeldReads(page);
  await openEventMaps(page);
  await back(page).click();
  await expect.poll(() => reads(page)).toEqual([false]);

  expect(await page.evaluate(() => {
    const visible = !document.hidden;
    window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}));
    return visible;
  })).toBe(true);
  await expect.poll(() => reads(page)).toEqual([true]);
  await finish(page, 0);
  await expect(view(page)).toHaveAttribute('data-active-view', 'maps');
  await expect(page.getByText("Can't check this event. Try again.", {exact: true})).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  await back(page).click();
  await expect.poll(() => reads(page)).toEqual([true, false]);
  await finish(page, 1);
  await expect(view(page)).toHaveAttribute('data-active-view', 'calendar');
  await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
});
