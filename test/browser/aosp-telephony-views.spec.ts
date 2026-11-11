import {test, expect, type Page} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
// The designed Phone, Messages and Contacts views against a stubbed bridge in the Alpha image shape
// (telephony-fixture.ts). Evidence for the renderer only: no device, SIM, carrier or provider is
// involved, and a call "placed" or a text handed to the bridge here proves nothing about a radio.
const inputs = (page: Page, method: string) => page.evaluate(method => ((window as any).telephonyInputs as [string, any][]).filter(row => row[0] === method).map(row => row[1]), method);
const open = (page: Page, name: string) => page.getByRole('button', {name, exact: true}).first().click();
const pill = '[data-alpha-layer="pill"]';
/** True when two elements' boxes overlap on screen. */
async function overlaps(page: Page, first: string, second: string) {
  const [a, b] = await Promise.all([page.locator(first).boundingBox(), page.locator(second).boundingBox()]);
  if (!a || !b) throw Error(`missing ${!a ? first : second}`);
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('Home shows one Messages card and one Phone card and keeps no telephony content', async ({page}) => {
  await setupTelephony(page);
  await expect(page.getByRole('button', {name: 'Open Messages, 2 unread'})).toBeVisible();
  await expect(page.getByRole('button', {name: /^Open Phone/})).toBeVisible();
  await page.getByRole('button', {name: 'Open Messages, 2 unread'}).click();
  await expect(page.locator('[data-alpha-messages-threads]')).toBeVisible();
  expect(await page.evaluate(() => /Ada Okafor|Running ten minutes/.test(JSON.stringify({...localStorage})))).toBe(false);
});

test('recents call on the owner tap; the keypad fits above the assistant controls on a small phone', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Phone');
  await page.getByRole('button', {name: /^Call Carmen Ruiz, outgoing/}).click();
  await expect.poll(() => inputs(page, 'placeCall')).toEqual([{number: '+15550100103'}]);
  await expect(page.getByRole('button', {name: /^Unknown, missed/})).toBeDisabled();
  await page.locator('[data-alpha-phone-tab="keypad"]').click();
  for (const key of ['5', '5', '5', '0', '1', '0', '0', '1', '0', '4']) await page.getByRole('button', {name: key, exact: true}).click();
  await expect(page.locator('[data-alpha-phone-number]')).toHaveValue('5550100104');
  await expect(page.getByRole('button', {name: 'Call Dev Patel'})).toBeVisible();
  for (const size of [{width: 412, height: 915}, {width: 360, height: 640}]) {
    await page.setViewportSize(size);
    await expect(page.locator('[data-alpha-phone-call]')).toBeInViewport({ratio: 1});
    expect(await overlaps(page, '[data-alpha-phone-call]', `${pill} > div`), `${size.width}x${size.height}`).toBe(false);
    expect(await overlaps(page, '[data-alpha-phone-number]', '[data-alpha-phone-keypad] button[aria-label="1"]')).toBe(false);
  }
  await page.locator('[data-alpha-phone-call]').click();
  await expect.poll(() => inputs(page, 'placeCall')).toEqual([{number: '+15550100103'}, {number: '5550100104'}]);
  await expect(page.locator('[data-alpha-phone-number]')).toHaveValue('');
});

test('voicemail opens with its transcript, deletes only after confirmation, and is absent without a carrier source', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Phone');
  await page.locator('[data-alpha-phone-tab="voicemail"]').click();
  await page.getByRole('button', {name: /^Voicemail from Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-phone-transcript]')).toContainText('The keys are with the neighbour');
  await expect(page.locator('[data-alpha-phone-play]')).toBeVisible();
  expect(await inputs(page, 'deleteVoicemail')).toEqual([]);
  await page.locator('[data-alpha-phone-voicemail-delete]').click();
  expect(await inputs(page, 'deleteVoicemail')).toEqual([]);
  await page.locator('[data-alpha-phone-voicemail-confirm]').click();
  await expect.poll(() => inputs(page, 'deleteVoicemail')).toEqual([{id: '31'}]);
  await expect(page.getByRole('button', {name: /^Voicemail from Ada Okafor/})).toHaveCount(0);
});
test('a phone whose carrier has no voicemail source shows no voicemail tab', async ({page}) => {
  await setupTelephony(page, {voicemail: 'unsupported'});
  await open(page, 'Phone');
  await expect(page.locator('[data-alpha-phone-tab="recents"]')).toBeVisible();
  await expect(page.locator('[data-alpha-phone-tab="voicemail"]')).toHaveCount(0);
});

test('a conversation has one bottom bar: its text field with the assistant in it', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  await expect(page.locator(pill)).toBeVisible();
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await expect.poll(() => inputs(page, 'markThreadRead')).toHaveLength(1);
  await expect(page.locator(pill)).toHaveCount(0);
  await expect(page.locator('[data-alpha-layer="composer"]')).toHaveCount(0);
  await expect(page.locator('[data-alpha-messages-alpha]')).toBeVisible();
  await expect(page.locator('[data-alpha-messages-composer]')).toBeInViewport({ratio: 1});
  await expect(page.locator('[data-alpha-messages-send]')).toBeDisabled();
  // Text typed in the field is the owner's; the assistant button takes it to Alpha instead of the contact.
  await page.locator('[data-alpha-messages-body]').fill('tell her I am ten minutes away');
  await page.locator('[data-alpha-messages-alpha]').click();
  await expect(page.locator('[data-alpha-messages-body]')).toHaveValue('');
  expect(await inputs(page, 'sendSms')).toEqual([]);
});

test('a draft Alpha was asked for lands in the open conversation and never replaces the owner text or sends', async ({page}) => {
  await setupTelephony(page);
  const place = (text: string, number?: string) => page.evaluate(async ([text, number]) => (await import('/src/prototype/sms-adapter.ts' as string)).placeAskedSmsDraft(text, number), [text, number] as const);
  await open(page, 'Messages');
  await expect(page.locator('[data-alpha-messages-threads]')).toBeVisible();
  expect(await place('Ten minutes away')).toBe('none-selected');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  expect(await place('Wrong person', '+15550100102'), 'a draft for another number does not land here').toBe('none-selected');
  expect(await place('Same ten digits abroad', '+445550100101')).toBe('none-selected');
  expect(await place('Ten minutes away', '+1 (555) 010-0101')).toBe('drafted');
  await expect(page.locator('[data-alpha-messages-body]')).toHaveValue('Ten minutes away');
  await expect(page.locator('[data-alpha-messages-suggested]')).toBeVisible();
  expect(await place('A second draft')).toBe('drafted');
  await expect(page.locator('[data-alpha-messages-body]')).toHaveValue('A second draft');
  await page.locator('[data-alpha-messages-body]').fill('My own words');
  expect(await place('Ignored')).toBe('occupied');
  await expect(page.locator('[data-alpha-messages-body]')).toHaveValue('My own words');
  await expect(page.locator('[data-alpha-messages-suggested]')).toHaveCount(0);
  expect(await inputs(page, 'sendSms')).toEqual([]);
});

test('suggested replies explain model-provider use before enabling the setting', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const suggestion = page.locator('[data-alpha-messages-suggest]');
  const review = page.getByRole('group', {name: 'Turn on suggested replies'});
  const preference = () => page.evaluate(() => localStorage.getItem('alpha.messages.suggest-replies.v1'));
  await suggestion.click();
  await expect(review).toContainText('connected model provider');
  expect(await preference()).toBeNull();
  await review.getByRole('button', {name: 'Cancel'}).click();
  await expect(review).toHaveCount(0);
  expect(await preference()).toBeNull();
  await suggestion.click();
  await review.getByRole('button', {name: 'Turn on'}).click();
  await expect(suggestion).toHaveAttribute('aria-pressed', 'true');
  expect(await preference()).toBe('1');
  await suggestion.click();
  await expect(suggestion).toHaveAttribute('aria-pressed', 'false');
  expect(await preference()).toBeNull();
});

test('the open conversation owns its send target after a new-message draft', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  await page.locator('[data-alpha-messages-new]').click();
  await page.locator('[data-alpha-messages-recipients]').fill('+15550100102');
  await page.locator('[data-alpha-messages-body]').fill('Draft for Bao');
  await page.locator('[data-alpha-messages]').getByRole('button', {name: 'Back', exact: true}).click();
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await expect(page.locator('[data-alpha-messages-body]')).toHaveValue('');
  await page.locator('[data-alpha-messages-body]').fill('Draft for Ada');
  await page.locator('[data-alpha-messages-send]').click();
  await expect.poll(async () => (await inputs(page, 'sendSms')).map(input => [input.recipients, input.body])).toEqual([[['+15550100101'], 'Draft for Ada']]);
});

test('one unread thread opened from Home can send only to that conversation', async ({page}) => {
  await setupTelephony(page, {singleUnread: true});
  await page.getByRole('button', {name: 'Open Messages, 1 unread'}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await page.locator('[data-alpha-messages-body]').fill('Draft for Ada');
  await page.locator('[data-alpha-messages-send]').click();
  await expect.poll(async () => (await inputs(page, 'sendSms')).map(input => input.recipients)).toEqual([['+15550100101']]);
});

test('Messages can open a system review without SMS permissions and request each missing permission', async ({page}) => {
  await setupTelephony(page, {granted: false});
  await open(page, 'Messages');
  await expect(page.getByRole('button', {name: 'Allow SMS read access'})).toBeVisible();
  await page.locator('[data-alpha-messages-new]').click();
  await page.locator('[data-alpha-messages-recipients]').fill('+15550100102');
  await page.locator('[data-alpha-messages-body]').fill('A draft for the messaging app');
  await page.getByRole('button', {name: 'Review in messaging app'}).click();
  await expect.poll(() => inputs(page, 'composeSms')).toEqual([{recipients: ['+15550100102'], body: 'A draft for the messaging app'}]);
  await page.getByRole('button', {name: 'Allow SMS send access'}).click();
  await page.getByRole('button', {name: 'Allow SIM access'}).click();
  await expect.poll(() => inputs(page, 'requestAccess')).toEqual([{access: 'sendSms'}, {access: 'phoneState'}]);
  await expect(page.locator('[data-alpha-messages-send]')).toBeEnabled();
});

test('a new message offers matching contacts and addresses the one tapped', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  await page.locator('[data-alpha-messages-new]').click();
  await expect(page.locator('[data-alpha-messages-picks] button')).toHaveCount(9);
  await page.locator('[data-alpha-messages-recipients]').fill('carm');
  await expect(page.locator('[data-alpha-messages-picks] button')).toHaveCount(1);
  await page.getByRole('button', {name: 'Carmen Ruiz, (555) 010-0103'}).click();
  await expect(page.locator('[data-alpha-messages-recipients]')).toHaveValue('+15550100103');
  await expect(page.locator('[data-alpha-messages-picks]').getByRole('button', {name: /Carmen Ruiz/})).toHaveCount(0);
});

test('Contacts searches in place, edits in the app with the version it read, and deletes after confirmation', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Contacts');
  await expect(page.locator('[data-alpha-contacts-search]')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Contacts'})).toHaveCount(0);
  await page.locator('[data-alpha-contacts-search]').fill('carm');
  await expect.poll(async () => (await inputs(page, 'contacts.list')).at(-1)?.query).toBe('carm');
  await page.getByRole('button', {name: /Carmen Ruiz/}).first().click();
  await expect(page.getByText('(555) 010-0103', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Edit contact', exact: true}).click();
  await expect(page.locator('[data-alpha-contact-editor]')).toBeVisible();
  await page.locator('[data-alpha-contact-name]').fill('Carmen R. Ruiz');
  await page.locator('[data-alpha-contact-save]').click();
  await expect.poll(() => inputs(page, 'contacts.save')).toHaveLength(1);
  const saved = (await inputs(page, 'contacts.save'))[0];
  expect(saved.id).toBe('13');
  expect(saved.version).toMatch(/^[0-9a-f]{64}$/);
  expect(saved.displayName).toBe('Carmen R. Ruiz');
  expect(saved.phoneNumbers).toEqual([{number: '+15550100103', type: 'mobile'}]);
  await expect(page.locator('[data-alpha-contact-editor]')).toHaveCount(0);
  expect(await inputs(page, 'contacts.remove')).toEqual([]);
  await page.locator('[data-alpha-contact-delete]').click();
  expect(await inputs(page, 'contacts.remove')).toEqual([]);
  await page.locator('[data-alpha-contact-confirm]').getByRole('button', {name: 'Delete', exact: true}).click();
  await expect.poll(() => inputs(page, 'contacts.remove')).toHaveLength(1);
  expect(await page.evaluate(() => /Carmen/.test(JSON.stringify({...localStorage})))).toBe(false);
});
