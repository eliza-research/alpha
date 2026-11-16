import {test, expect, type Page} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
// AP-16 Contacts (docs/agentic-comms.md AC-03, AC-22): the list filter typed in the bar or applied by
// Alpha, its clearable chip, and the contact header order. Renderer evidence only: no address book,
// device or hosted model is involved, and the AOSP block's provider is the stubbed bridge.
const field = '[data-alpha-bar-field="filter"]';
const chip = '[data-alpha-list-filter-chip]';
const row = (page: Page, name: string) => page.locator('[data-alpha-layer="app"] button.tap').filter({hasText: name});
/** Requests that leave the renderer for data (fetch, XHR, sockets) from now on. */
function requests(page: Page) {
  const seen: string[] = [];
  page.on('request', request => { if (['fetch', 'xhr', 'websocket', 'eventsource'].includes(request.resourceType())) seen.push(request.url()); });
  return seen;
}
/** Contrast ratio of an element's text color on its own background. */
const contrast = (page: Page, selector: string) => page.locator(selector).evaluate(el => {
  const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]: number[]) => { const c = [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const style = getComputedStyle(el), [a, b] = [lum(rgb(style.color)), lum(rgb(style.backgroundColor))];
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
});
/** The listed controls in document order, by their data marker. */
const order = (page: Page, markers: string[]) => page.evaluate(markers => {
  const found = markers.map(marker => [marker, document.querySelector(`[data-alpha-contact-detail] ${marker}`)] as const).filter(([, el]) => el);
  return found.sort(([, a], [, b]) => a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(([marker]) => marker);
}, markers);

test.describe('dev Contacts (?mode=dev&fixture=1 dev build with ELIZA_DEV_ALLOW_TEST_MOCKS=1)', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/?mode=dev&fixture=1');
    await page.getByRole('button', {name: 'Contacts', exact: true}).click();
    await expect(page.locator(field)).toHaveAttribute('placeholder', 'Search or ask');
  });

  test('typing filters the list on the device and makes no network request', async ({page}) => {
    const seen = requests(page);
    await page.locator(field).pressSequentially('lum');
    await expect(row(page, 'Maya Chen')).toBeVisible();
    await expect(row(page, 'Sam Okafor')).toHaveCount(0);
    await expect(page.locator(chip)).toHaveCount(0);
    await page.locator(field).fill('');
    await expect(row(page, 'Sam Okafor')).toBeVisible();
    expect(seen).toEqual([]);
  });

  test('a sentence is not a filter; Enter asks Alpha, whose answer filters the list behind a chip that clears it', async ({page}) => {
    // A whole sentence at once: typed word by word, its first words would filter (D9).
    await page.locator(field).fill('Who do I know at Lumen?');
    await expect(row(page, 'Sam Okafor')).toBeVisible();
    await page.locator(field).press('Enter');
    await expect(page.locator(chip)).toContainText('Lumen · 1');
    await expect(row(page, 'Maya Chen')).toBeVisible();
    await expect(row(page, 'Sam Okafor')).toHaveCount(0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      expect(await contrast(page, chip)).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole('button', {name: 'Clear filter Lumen', exact: true}).click();
    await expect(page.locator(chip)).toHaveCount(0);
    await expect(row(page, 'Sam Okafor')).toBeVisible();
  });

  test('a contact header keeps back, avatar, name, favorite, then call, text, mail, directions in every state', async ({page}) => {
    const markers = ['[data-alpha-contact-back]', '[data-alpha-stage-avatar]', 'h1', '[data-alpha-contact-fav]', '[data-alpha-contact-actions]'];
    await row(page, 'Maya Chen').click();
    const actions = page.locator('[data-alpha-contact-actions] button');
    const labels = ['Call Maya Chen', 'Message Maya Chen', 'Email Maya Chen', 'Directions to Maya Chen'];
    await expect(order(page, markers)).resolves.toEqual(markers);
    await expect(actions).toHaveCount(labels.length);
    for (const [index, label] of labels.entries()) await expect(actions.nth(index)).toHaveAttribute('aria-label', label);
    await page.getByRole('button', {name: 'Open Alpha', exact: true}).click();
    await expect(page.locator('[data-alpha-contact-detail]')).toHaveAttribute('data-alpha-compact', 'true');
    await expect(order(page, markers)).resolves.toEqual(markers);
    for (const [index, label] of labels.entries()) await expect(actions.nth(index)).toHaveAttribute('aria-label', label);
    const [last, sheet] = await Promise.all([page.locator('[data-alpha-stage-last]').boundingBox(), page.locator('[data-alpha-layer="conversation"]').boundingBox()]);
    expect(last!.y + last!.height).toBeLessThanOrEqual(sheet!.y + 1);
  });
});

test.describe('AOSP Contacts (stubbed Alpha image bridge, as aosp-telephony-views.spec.ts)', () => {
  test('typing reads the device address book with the query and nothing else', async ({page}) => {
    await setupTelephony(page);
    await page.getByRole('button', {name: 'Contacts', exact: true}).first().click();
    await expect(page.getByRole('button', {name: /Carmen Ruiz/}).first()).toBeVisible();
    const seen = requests(page);
    await page.locator(field).pressSequentially('carm');
    await expect.poll(() => page.evaluate(() => ((window as any).telephonyInputs as [string, any][]).filter(entry => entry[0] === 'contacts.list').at(-1)?.[1]?.query)).toBe('carm');
    await expect(page.getByRole('button', {name: /Ada Okafor/})).toHaveCount(0);
    await expect(page.locator(chip)).toHaveCount(0);
    expect(seen).toEqual([]);
  });
});
