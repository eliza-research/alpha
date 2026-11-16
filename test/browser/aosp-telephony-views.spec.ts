import {test, expect, type Page} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
// The designed Phone, Messages and Contacts views against a stubbed bridge in the Alpha image shape
// (telephony-fixture.ts). Evidence for the renderer only: no device, SIM, carrier or provider is
// involved, and a call "placed" or a text handed to the bridge here proves nothing about a radio.
const inputs = (page: Page, method: string) => page.evaluate(method => ((window as any).telephonyInputs as [string, any][]).filter(row => row[0] === method).map(row => row[1]), method);
const open = (page: Page, name: string) => page.getByRole('button', {name, exact: true}).first().click();
const pill = '[data-alpha-layer="pill"]';
// AP-16: the one bottom bar is the composer. In a conversation it addresses the person; on the list it filters.
const personField = '[data-alpha-bar-field="person"]';
const barSend = (page: Page) => page.locator('[data-alpha-input-bar]').getByRole('button', {name: 'Send', exact: true});
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

test('an SMS notification opens only its thread on launch and waits for an unsent draft', async ({page}) => {
  await setupTelephony(page, {smsNoticeThread: 'thread:102'});
  const title = page.locator('[data-alpha-messages-title]');
  const draft = page.locator(personField);
  await expect(title).toHaveText('Bao Tran');
  await expect.poll(() => inputs(page, 'acknowledgeSmsNotice')).toEqual([{token: '1'}]);
  expect(new Set((await inputs(page, 'listMessages')).map(input => input.threadId))).toEqual(new Set(['thread:102']));

  await draft.fill('Unsent draft');
  await page.evaluate(() => {
    (window as any).smsNoticeTap = {threadId: 'thread:101', token: '2'};
    window.dispatchEvent(new Event('alpha:sms-notice-open'));
  });
  await expect(title).toHaveText('Bao Tran');
  await expect(draft).toHaveValue('Unsent draft');
  expect(await inputs(page, 'acknowledgeSmsNotice')).toEqual([{token: '1'}]);
  await draft.fill('');

  await expect(title).toHaveText('Ada Okafor');
  await expect.poll(() => inputs(page, 'acknowledgeSmsNotice')).toEqual([{token: '1'}, {token: '2'}]);
  expect(new Set((await inputs(page, 'listMessages')).map(input => input.threadId))).toEqual(new Set(['thread:102', 'thread:101']));
  await expect.poll(async () => new Set((await inputs(page, 'markThreadRead')).map(input => input.threadId))).toEqual(new Set(['thread:101']));
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
});

test('recents call on the owner tap; the keypad fits above the bar on a small phone', async ({page}) => {
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
    expect(await overlaps(page, '[data-alpha-phone-call]', '[data-alpha-input-bar]'), `${size.width}x${size.height}`).toBe(false);
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

test('Phone keeps its selector in Contacts and switching tabs leaves one Back entry', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Phone');
  const tab = (name: string) => page.locator(`[data-alpha-phone-tab="${name}"]`);
  await tab('contacts').click();
  await expect(page.locator('[data-alpha-contacts-header]')).toBeVisible();
  await expect(tab('contacts')).toHaveAttribute('aria-pressed', 'true');
  await tab('keypad').click();
  await expect(page.locator('[data-alpha-phone-keypad]')).toBeVisible();
  await tab('contacts').click();
  await tab('recents').click();
  await expect(tab('recents')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
  await expect(tab('recents')).toHaveCount(0);
  await open(page, 'Contacts');
  await expect(page.locator('[data-alpha-contacts-header]')).toBeVisible();
  await expect(tab('contacts')).toHaveCount(0);
});

test('Messages stays below the status bar at both launcher widths', async ({page}) => {
  const inset = 64;
  await setupTelephony(page);
  await page.evaluate(inset => document.documentElement.style.setProperty('--native-top-inset', `${inset}px`), inset);
  await open(page, 'Messages');
  const button = page.locator('[data-alpha-messages-new]');
  for (const size of [{width: 412, height: 915}, {width: 360, height: 640}]) {
    await page.setViewportSize(size);
    await expect(button).toBeInViewport({ratio: 0.99});
    await expect.poll(() => button.evaluate((compose, inset) => {
      const list = document.querySelector('[data-alpha-messages-threads]');
      const bounds = compose.getBoundingClientRect();
      return {
        belowStatusBar: bounds.top >= inset,
        aboveThreads: !!list && list.getBoundingClientRect().top >= bounds.bottom,
      };
    }, inset)).toEqual({belowStatusBar: true, aboveThreads: true});
  }
  await button.click();
  const back = page.locator('[data-alpha-messages]').getByRole('button', {name: 'Back', exact: true});
  await expect(back).toBeVisible();
  expect((await back.boundingBox())?.y).toBeGreaterThanOrEqual(inset);
  await back.click();
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(back).toBeVisible();
  expect((await back.boundingBox())?.y).toBeGreaterThanOrEqual(inset);
});

test('a conversation has one bottom bar: the bar addresses the person, with no second composer, mic or send', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  await expect(page.locator('[data-alpha-bar-field="filter"]')).toBeVisible();
  await expect(page.locator(pill)).not.toBeVisible();
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await expect.poll(() => inputs(page, 'markThreadRead')).toHaveLength(1);
  await expect(page.locator('[data-alpha-composer]:visible')).toHaveCount(1);
  await expect(page.locator(personField)).toBeVisible();
  await expect(page.locator(personField)).toHaveAttribute('placeholder', /^Text /);
  for (const gone of ['[data-alpha-messages-body]', '[data-alpha-messages-send]', '[data-alpha-messages-alpha]']) await expect(page.locator(gone)).toHaveCount(0);
  await expect(page.locator('[data-alpha-messages-accessories]')).toBeInViewport({ratio: 1});
  // An empty bar offers dictation; Send appears with text.
  await expect(barSend(page)).toHaveCount(0);
  // Text typed in the bar is the owner's text to the person; nothing goes anywhere until Send.
  await page.locator(personField).fill('tell her I am ten minutes away');
  await expect(page.locator(personField)).toHaveValue('tell her I am ten minutes away');
  await expect(barSend(page)).toBeEnabled();
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
});

test('a draft Alpha was asked for replaces the slot, keeps one Undo, and never sends', async ({page}) => {
  await setupTelephony(page);
  const sms = (call: string, ...args: unknown[]) => page.evaluate(async ([call, args]) => ((await import('/src/prototype/sms-adapter.ts' as string)) as any)[call as string](...(args as unknown[])), [call, args] as const);
  await open(page, 'Messages');
  await expect(page.locator('[data-alpha-messages-threads]')).toBeVisible();
  expect(await sms('placeAskedSmsDraft', 'Ten minutes away')).toBe('none-selected');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  expect(await sms('placeAskedSmsDraft', 'Wrong person', '+15550100102'), 'a draft for another number does not land here').toBe('none-selected');
  expect(await sms('placeAskedSmsDraft', 'Same ten digits abroad', '+445550100101')).toBe('none-selected');
  expect(await sms('placeAskedSmsDraft', 'Ten minutes away', '+1 (555) 010-0101')).toBe('drafted');
  await expect(page.locator(personField)).toHaveValue('Ten minutes away');
  expect(await sms('placeAskedSmsDraft', 'A second draft')).toBe('drafted');
  await expect(page.locator(personField)).toHaveValue('A second draft');
  await page.locator(personField).fill('My own words');
  expect(await sms('placeAskedSmsDraft', 'Alpha rewrote it')).toBe('drafted');
  await expect(page.locator(personField)).toHaveValue('Alpha rewrote it');
  expect(await sms('readSmsDraft')).toEqual({by: 'alpha', text: 'Alpha rewrote it', canUndo: true, threadId: expect.any(String)});
  expect(await sms('undoSmsDraft')).toBe(true);
  await expect(page.locator(personField)).toHaveValue('My own words');
  expect(await sms('undoSmsDraft'), 'one Undo').toBe(false);
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
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
  await page.locator(personField).fill('Draft for Bao');
  await page.locator('[data-alpha-messages]').getByRole('button', {name: 'Back', exact: true}).click();
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await expect(page.locator(personField)).toHaveValue('');
  await page.locator(personField).fill('Draft for Ada');
  await barSend(page).click();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).map(input => [input.recipients, input.body])).toEqual([[['+15550100101'], 'Draft for Ada']]);
});

test('an outgoing SMS bubble appears on Send and an exact provider row replaces it', async ({page}) => {
  await setupTelephony(page, {controlledSms: true});
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const body = 'Yes. Seven at the usual place?';
  const draft = page.locator(personField);
  const thread = page.locator('[data-alpha-messages-thread]');
  const send = barSend(page);
  const text = thread.getByText(body, {exact: true});
  await expect(text).toHaveCount(1);
  await draft.fill(body);
  await send.evaluate(button => (button as HTMLButtonElement).click());
  await expect(text).toHaveCount(1);
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  await send.click();
  await expect(text).toHaveCount(2);
  await expect(send).toBeDisabled();
  const [request] = await inputs(page, 'sendComposedSms');
  const provisional = thread.locator(`[data-alpha-message-id="${request.operationId}"]`);
  await expect(provisional).toHaveCSS('opacity', '0.68');
  await page.evaluate(() => (window as any).smsReview.finish('sent'));
  await expect(draft).toHaveValue('');
  await expect(provisional).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    w.smsReview.addProviderRow(41, 'thread:101');
    w.smsProviderChanged();
  });
  await expect(thread.locator('[data-alpha-message-id="sms:41"]')).toHaveText(body);
  await expect(provisional).toHaveCount(0);
  await expect(text).toHaveCount(2);
  expect(await inputs(page, 'sendComposedSms')).toHaveLength(1);
  expect(await inputs(page, 'sendSms')).toEqual([]);
});

test('a missing composer reply releases Send and a retry retains its operation identity', async ({page}) => {
  await page.clock.install();
  await setupTelephony(page, {controlledSms: true});
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const draft = page.locator(personField);
  const send = barSend(page);
  const body = 'Keep this exact draft if the composer does not reply.';
  await draft.fill(body);
  await send.click();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).length).toBe(1);
  const [first] = await inputs(page, 'sendComposedSms');
  await expect(send).toBeDisabled();
  await page.evaluate(() => {
    const w = window as any;
    w.firstComposerReply = w.smsReview;
  });

  await page.clock.fastForward(30_001);
  await expect(send).toBeEnabled();
  await expect(draft).toHaveValue(body);
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveText('May have sent');
  expect(await inputs(page, 'sendComposedSms')).toEqual([first]);

  await send.click();
  await expect.poll(() => inputs(page, 'sendComposedSms')).toEqual([first, first]);
  await page.evaluate(async () => (window as any).firstComposerReply.finish('sent'));
  await expect(send).toBeDisabled();
  await expect(draft).toHaveValue(body);
  await page.evaluate(async () => (window as any).smsReview.finish('sent'));
  await expect(draft).toHaveValue('');
  expect(await inputs(page, 'sendSms')).toEqual([]);
});

test('the journal clears a sent draft after the composer reply times out', async ({page}) => {
  await page.clock.install();
  await setupTelephony(page, {controlledSms: true});
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const draft = page.locator(personField);
  const send = barSend(page);
  const body = 'A late journal receipt settles this draft.';
  await draft.fill(body);
  await send.click();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).length).toBe(1);

  await page.clock.fastForward(30_001);
  await expect(send).toBeEnabled();
  await expect(draft).toHaveValue(body);
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveText('May have sent');

  await page.evaluate(async () => {
    const w = window as any;
    w.smsReview.addProviderRow(42, 'thread:101');
    await w.smsReview.finish('sent', true);
  });
  await expect(draft).toHaveValue('');
  await expect(page.locator('[data-alpha-message-id="sms:42"]')).toHaveText(body);
  expect(await inputs(page, 'sendComposedSms')).toHaveLength(1);
});

test('the registered telephony profile still chooses native review', async ({page}) => {
  await setupTelephony(page, {controlledSms: true});
  await open(page, 'Messages');
  await page.evaluate(() => {
    const w = window as any;
    const client = w[Symbol.for('elizaos.native-telephony.profile')];
    w.reviewedSend = client.sendSms({recipients: ['+15550100101'], body: 'Reviewed request', subscriptionId: 1}, 'reviewed-operation');
  });
  await expect.poll(() => inputs(page, 'sendSms')).toEqual([{
    recipients: ['+15550100101'], body: 'Reviewed request', subscriptionId: 1, operationId: 'reviewed-operation',
  }]);
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  const result = await page.evaluate(async () => {
    const w = window as any;
    await w.smsReview.finish('cancelled');
    return w.reviewedSend;
  });
  expect(result.status).toBe('cancelled');
});

test('the owner Send button routes a group text through the manual MMS port', async ({page}) => {
  await setupTelephony(page, {mms: true});
  await open(page, 'Messages');
  await page.locator('[data-alpha-messages-new]').click();
  await page.locator('[data-alpha-messages-recipients]').fill('+15550100101, +15550100102');
  await page.locator(personField).fill('Group text');
  await barSend(page).click();
  await expect.poll(() => inputs(page, 'sendComposedMms')).toEqual([expect.objectContaining({
    recipients: ['+15550100101', '+15550100102'], body: 'Group text', subscriptionId: 1, attachments: [],
  })]);
  expect(await inputs(page, 'sendMms')).toEqual([]);
});

test('the journal clears a sent group draft after the MMS composer reply times out', async ({page}) => {
  await page.clock.install();
  await setupTelephony(page, {mms: true, controlledMms: true});
  await open(page, 'Messages');
  await page.locator('[data-alpha-messages-new]').click();
  const draft = page.locator(personField);
  const send = barSend(page);
  await page.locator('[data-alpha-messages-recipients]').fill('+15550100101, +15550100102');
  await draft.fill('Group text settles without a second send.');
  await send.click();
  await expect.poll(async () => (await inputs(page, 'sendComposedMms')).length).toBe(1);

  await page.clock.fastForward(30_001);
  await expect(send).toBeEnabled();
  await expect(draft).toHaveValue('Group text settles without a second send.');
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveText('May have sent');

  await page.evaluate(() => (window as any).finishMms());
  await expect(page.locator('[data-alpha-messages-threads]')).toBeVisible();
  await expect(draft).toHaveCount(0);
  expect(await inputs(page, 'sendComposedMms')).toHaveLength(1);
});

test('clearing the text in the bar sends only the remaining picture on the next MMS tap', async ({page}) => {
  await page.clock.install();
  await setupTelephony(page, {mms: true, controlledMms: true});
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const draft = page.locator(personField);
  const send = barSend(page);
  const body = 'These words must not go with the picture again.';
  const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=', 'base64');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name: 'Add picture', exact: true}).click();
  await (await chooser).setFiles({name: 'picture.png', mimeType: 'image/png', buffer: picture});
  await expect(page.getByRole('button', {name: 'Remove picture-1.png'})).toBeVisible();
  await draft.fill(body);
  await send.click();
  await expect.poll(async () => (await inputs(page, 'sendComposedMms')).length).toBe(1);
  const [first] = await inputs(page, 'sendComposedMms');
  expect(first).toMatchObject({body, attachments: [{data: picture.toString('base64')}]});

  await page.clock.fastForward(30_001);
  await expect(send).toBeEnabled();
  await draft.fill('');
  await expect(draft).toHaveValue('');
  await send.click();
  await expect.poll(async () => (await inputs(page, 'sendComposedMms')).length).toBe(2);
  const [, second] = await inputs(page, 'sendComposedMms');
  expect(second).toMatchObject({body: '', recipients: first.recipients, attachments: first.attachments});
  expect(second.operationId).not.toBe(first.operationId);
});

test('a refused or failed manual SMS removes the provisional bubble and keeps the draft', async ({page}) => {
  await setupTelephony(page, {controlledSms: true});
  await open(page, 'Messages');
  await page.getByRole('button', {name: /^Ada Okafor/}).click();
  const draft = page.locator(personField);
  const body = 'Leave this draft unsent';
  const bubble = page.locator('[data-alpha-messages-thread]').getByText(body, {exact: true});
  await draft.fill(body);
  await barSend(page).click();
  await expect(bubble).toBeVisible();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).length).toBe(1);
  await page.evaluate(() => (window as any).smsReview.finish('cancelled'));
  await expect(bubble).toHaveCount(0);
  await expect(draft).toHaveValue(body);
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveCount(0);
  await barSend(page).click();
  await expect(bubble).toBeVisible();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).length).toBe(2);
  await page.evaluate(() => (window as any).smsReview.finish('failed'));
  await expect(bubble).toHaveCount(0);
  await expect(draft).toHaveValue(body);
  await expect(page.getByRole('img', {name: 'Message failed'})).toBeVisible();
  await expect(page.locator('[data-alpha-messages-notice]')).toHaveCount(0);
  expect(await inputs(page, 'sendComposedSms')).toHaveLength(2);
});

for (const smsRoleHeld of [true, false]) {
  test(`a new SMS uses the provider conversation when available (SMS role held: ${smsRoleHeld})`, async ({page}) => {
    await setupTelephony(page, {controlledSms: true, smsRoleHeld});
    await open(page, 'Messages');
    await page.locator('[data-alpha-messages-new]').click();
    const body = 'Starting a conversation';
    const draft = page.locator(personField);
    const messages = page.locator('[data-alpha-messages]');
    const bubbles = messages.locator('[data-alpha-message-id]').filter({hasText: body});
    await page.locator('[data-alpha-messages-recipients]').fill('+1 (555) 010-0501');
    await draft.fill(body);
    await barSend(page).click();
    await expect(bubbles).toBeVisible();
    await expect.poll(async () => (await inputs(page, 'sendComposedSms')).length).toBe(1);
    await page.evaluate(() => (window as any).smsReview.finish('submitted'));
    if (smsRoleHeld) {
      await expect(draft).toHaveValue('');
      await expect(bubbles).toBeVisible();
      await page.evaluate(() => {
        const w = window as any;
        w.smsReview.addProviderRow(42, 'thread:501');
        w.smsProviderChanged();
      });
      await expect(page.locator('[data-alpha-messages-thread] [data-alpha-message-id="sms:42"]')).toHaveText(body);
      await expect(bubbles).toHaveCount(1);
    } else {
      await expect(page.locator('[data-alpha-messages-threads]')).toBeVisible();
      await expect(draft).toHaveCount(0);
      await expect(bubbles).toHaveCount(0);
    }
    await expect(page.locator('[data-alpha-messages-notice]')).toHaveCount(0);
  });
}

test('one unread thread opened from Home can send only to that conversation', async ({page}) => {
  await setupTelephony(page, {singleUnread: true});
  await page.getByRole('button', {name: 'Open Messages, 1 unread'}).click();
  await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
  await page.locator(personField).fill('Draft for Ada');
  await barSend(page).click();
  await expect.poll(async () => (await inputs(page, 'sendComposedSms')).map(input => input.recipients)).toEqual([['+15550100101']]);
});

test('Messages can open a system review without SMS permissions and request each missing permission', async ({page}) => {
  await setupTelephony(page, {granted: false});
  await open(page, 'Messages');
  await expect(page.getByRole('button', {name: 'Allow SMS read access'})).toBeVisible();
  await page.locator('[data-alpha-messages-new]').click();
  await page.locator('[data-alpha-messages-recipients]').fill('+15550100102');
  await page.locator(personField).fill('A draft for the messaging app');
  await page.getByRole('button', {name: 'Review in messaging app'}).click();
  await expect.poll(() => inputs(page, 'composeSms')).toEqual([{recipients: ['+15550100102'], body: 'A draft for the messaging app'}]);
  await page.getByRole('button', {name: 'Allow SMS send access'}).click();
  await page.getByRole('button', {name: 'Allow SIM access'}).click();
  await expect.poll(() => inputs(page, 'requestAccess')).toEqual([{access: 'sendSms'}, {access: 'phoneState'}]);
  await expect(barSend(page)).toBeEnabled();
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

test('Messages adds a selected contact number and keeps its unsent draft', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Messages');
  const compose = page.locator('[data-alpha-messages-new]');
  const recipients = page.getByRole('textbox', {name: 'To', exact: true});
  const body = page.locator(personField);
  await compose.click();
  await recipients.fill('+15550100101');
  await body.fill('Keep this message unsent.');
  await page.getByRole('button', {name: 'Choose contacts'}).click();
  const picker = page.getByRole('region', {name: 'Choose a contact'});
  await expect(picker).toBeVisible();
  await picker.getByRole('searchbox', {name: 'Search contacts'}).fill('Bao');
  await picker.getByRole('button', {name: 'Search', exact: true}).click();
  await expect.poll(async () => (await inputs(page, 'contacts.list')).at(-1)?.query).toBe('Bao');
  await picker.getByRole('button', {name: 'Bao Tran, (555) 010-0112'}).click();
  await expect(picker).toHaveCount(0);
  await expect(recipients).toHaveValue('+15550100101, +15550100112');
  await expect(body).toHaveValue('Keep this message unsent.');
  await page.locator('[data-alpha-messages]').getByRole('button', {name: 'Back', exact: true}).click();
  await compose.click();
  await expect(recipients).toHaveValue('+15550100101, +15550100112');
  await expect(body).toHaveValue('Keep this message unsent.');
  expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  expect(await inputs(page, 'sendComposedMms')).toEqual([]);
});

test('Contacts searches from the bar, edits in the app with the version it read, and deletes after confirmation', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Contacts');
  // AP-16 (AC-22): the bar is the search field; the list header keeps only its title.
  await expect(page.locator('[data-alpha-bar-field="filter"]')).toHaveAttribute('placeholder', 'Search or ask');
  await expect(page.getByRole('heading', {name: 'Contacts'})).toBeVisible();
  await page.locator('[data-alpha-bar-field="filter"]').fill('carm');
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

test('Settings shows the SIM, carrier, number and network, and links to Android for the IMEI', async ({page}) => {
  await setupTelephony(page);
  await open(page, 'Settings');
  await page.getByRole('button', {name: 'General', exact: true}).click();
  expect(await inputs(page, 'phoneInfo'), 'nothing is read before the page opens').toEqual([]);
  await page.getByRole('button', {name: 'Phone', exact: true}).click();
  for (const text of ['Synthetic Carrier', '(555) 010-0100', '5G', 'Good', 'Slot 1']) await expect(page.getByText(text, {exact: true})).toBeVisible();
  await expect(page.getByText('Alpha', {exact: true}).first()).toBeVisible();
  expect(await inputs(page, 'phoneInfo')).toHaveLength(1);
  await page.getByRole('button', {name: 'IMEI', exact: true}).click();
  await expect.poll(() => inputs(page, 'openSettings')).toEqual([{page: 'about'}]);
  expect(await page.evaluate(() => /Synthetic Carrier|5550100100/.test(JSON.stringify({...localStorage})))).toBe(false);
});
