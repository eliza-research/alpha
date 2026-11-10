import {test} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
// Screenshots of each telephony view for layout review. Runs only when ALPHA_TELEPHONY_SHOTS names a
// directory; it asserts nothing and is not part of the browser suite's evidence.
const out = process.env.ALPHA_TELEPHONY_SHOTS;
test.skip(!out, 'layout review only');
test('telephony views', async ({page}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  page.on('pageerror', error => errors.push(String(error).slice(0, 300)));
  const shot = async (name: string) => { await page.waitForTimeout(500); await page.screenshot({path: `${out}/${name}.png`}); };
  const step = async (name: string, run: () => Promise<unknown>) => { try { await run(); await shot(name); } catch (error) { console.log(`STEP ${name} failed: ${String(error).slice(0, 400)}`); await shot(`${name}-failed`); } };
  await setupTelephony(page);
  await shot('01-home');
  await step('02-phone-recents', () => page.getByRole('button', {name: 'Phone', exact: true}).first().click());
  await step('03-phone-keypad', async () => { await page.locator('[data-alpha-phone-tab="keypad"]').click(); for (const key of ['5', '5', '5', '0', '1']) await page.getByRole('button', {name: key, exact: true}).click(); });
  await step('04-phone-voicemail', () => page.locator('[data-alpha-phone-tab="voicemail"]').click());
  await step('05-phone-voicemail-open', () => page.getByRole('button', {name: /Voicemail from Ada/}).click());
  await step('06-contacts', () => page.locator('[data-alpha-phone-tab="contacts"]').click());
  await step('07-contact', () => page.getByRole('button', {name: /Carmen Ruiz/}).first().click());
  await step('08-contact-edit', () => page.getByRole('button', {name: 'Edit contact', exact: true}).click());
  await page.goto('/');
  await step('09-messages', () => page.getByRole('button', {name: 'Messages', exact: true}).first().click());
  await step('10-thread', () => page.getByRole('button', {name: /Ada Okafor/}).first().click());
  await step('11-thread-typing', () => page.locator('[data-alpha-messages-body]').fill('On my way. Order me the soup.'));
  await page.goto('/');
  await step('12-new-message', async () => { await page.getByRole('button', {name: 'Messages', exact: true}).first().click(); await page.locator('[data-alpha-messages-new]').click(); });
  console.log('ERRORS', JSON.stringify(errors.slice(0, 12)));
});
