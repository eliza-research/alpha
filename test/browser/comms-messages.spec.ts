import {test, expect, type Page} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
import {setTextScale} from './accessibility-states';
// AP-16 Messages (docs/agentic-comms.md AC-01, AC-10, AC-13 to AC-16, AC-22, AC-24, AC-31): the one
// bottom bar, the thread's draft slot and the draft bubble in the stage. Renderer evidence only: no
// device, SIM, carrier or SMS provider is involved, and a text handed to the stub bridge proves
// nothing about a radio.
const personField = '[data-alpha-bar-field="person"]', filterField = '[data-alpha-bar-field="filter"]', alphaField = '[data-alpha-bar-field="alpha"]';
const bubble = '[data-alpha-draft-bubble]';
const barSend = (page: Page) => page.locator('[data-alpha-input-bar]').getByRole('button', {name: 'Send', exact: true});
const openAlpha = (page: Page) => page.getByRole('button', {name: 'Open Alpha', exact: true}).click();
const inputs = (page: Page, method: string) => page.evaluate(method => ((window as any).telephonyInputs as [string, any][]).filter(row => row[0] === method).map(row => row[1]), method);
const sms = (page: Page, call: string, ...args: unknown[]) => page.evaluate(async ([call, args]) => ((await import('/src/prototype/sms-adapter.ts' as string)) as any)[call as string](...(args as unknown[])), [call, args] as const);
/** Requests the page makes while `act` runs, other than the development server's own modules. */
async function requestsDuring(page: Page, act: () => Promise<void>) {
  const seen: string[] = [], record = (request: {url(): string; resourceType(): string}) => { if (['fetch', 'xhr', 'websocket', 'eventsource'].includes(request.resourceType())) seen.push(request.url()); };
  page.on('request', record);
  try { await act(); } finally { page.off('request', record); }
  return seen;
}
/** Every line of the draft can be brought into the stage, and Edit and Send stay on screen (AC-13). */
async function draftReachable(page: Page) {
  const draft = page.locator(bubble);
  await expect(draft).toBeVisible();
  for (const block of ['start', 'end'] as const) {
    await draft.evaluate((el, block) => el.scrollIntoView({block}), block);
    const [box, sheet] = await Promise.all([draft.boundingBox(), page.locator('[data-alpha-layer="conversation"]').boundingBox()]);
    if (!box || !sheet) throw Error('missing draft or sheet');
    if (block === 'start') expect(box.y, 'the first line can be scrolled into the stage').toBeGreaterThanOrEqual(0);
    else expect(box.y + box.height, 'the last line can be scrolled above the sheet').toBeLessThanOrEqual(sheet.y + 1);
    for (const control of ['[data-alpha-draft-edit]', '[data-alpha-draft-send]']) await expect(page.locator(control)).toBeInViewport({ratio: 1});
  }
}

test.describe('Messages on the Alpha image: the telephony stub bridge (as aosp-telephony-views.spec.ts)', () => {
  test('a 1,600-character Alpha draft is reachable line by line with Edit and Send on screen, at default and largest text', async ({page}) => {
    await setupTelephony(page);
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
    const words = Array.from({length: 400}, (_, i) => `w${i % 100}`).join(' ').slice(0, 1600);
    expect(await sms(page, 'placeAskedSmsDraft', words)).toBe('drafted');
    await openAlpha(page);
    await expect(page.locator(bubble)).toHaveAttribute('data-alpha-draft-bubble', 'alpha');
    await expect(page.locator(bubble)).toHaveAttribute('aria-label', "Alpha's draft, not sent");
    await draftReachable(page);
    await setTextScale(page, 2);
    await draftReachable(page);
    expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  });

  test('nothing reaches the SMS bridge until Send on the bubble; a retry keeps one journal entry; Alpha notes the send quietly', async ({page}) => {
    await setupTelephony(page);
    // The first send fails in transport; the retry returns a receipt bound to the reviewed text.
    await page.addInitScript(() => { let first = true; (window as any).telephonyAnswers = {sendComposedSms: async (input: any) => {
      if (first) { first = false; throw Error('transport'); }
      const {smsBindingHash} = await import('/src/runtime/aosp-telephony.ts' as string);
      const bindingHash = await smsBindingHash({recipients: input.recipients, body: input.body, subscriptionId: input.subscriptionId});
      return {kind: 'sms-send', operationId: input.operationId, subscriptionId: input.subscriptionId, bindingHash, status: 'submitted', parts: [{index: 0, recipientIndex: 0, partIndex: 0, sent: 'unknown', delivery: 'unknown'}], createdAt: Date.now()};
    }}; });
    await page.reload();
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    expect(await sms(page, 'placeAskedSmsDraft', 'Ten minutes away')).toBe('drafted');
    await openAlpha(page);
    await expect(page.locator(bubble)).toContainText('Ten minutes away');
    expect(await inputs(page, 'sendComposedSms'), 'a pending draft sends nothing').toEqual([]);
    await page.locator('[data-alpha-draft-send]').click();
    await expect.poll(() => inputs(page, 'sendComposedSms')).toHaveLength(1);
    await page.locator('[data-alpha-draft-send]').click();
    await expect.poll(() => inputs(page, 'sendComposedSms')).toHaveLength(2);
    const sent = await inputs(page, 'sendComposedSms');
    expect(new Set(sent.map(row => row.operationId)).size, 'the retry carries the same operation, so the journal holds one send').toBe(1);
    await expect(page.getByText(/^Sent to /)).toBeVisible();
  });

  test('type to Ada, open Alpha, reload: the SMS draft returns to the thread', async ({page}) => {
    await setupTelephony(page);
    // The stub bridge keeps no secure slots; this one keeps the SMS draft slots across a reload, as the
    // phone's renderer secure store would (a stand-in, not the Android store).
    await page.addInitScript(() => {
      const cap = (window as any).Capacitor, native = cap.nativePromise, key = (slot: string) => 'fixture.secure.' + slot;
      cap.PluginHeaders.find((header: any) => header.name === 'AlphaConnection').methods.push({name: 'secureCompareExchange', rtype: 'promise'});
      cap.nativePromise = async (plugin: string, method: string, input: any) => {
        if (plugin !== 'AlphaConnection' || !String(input?.slot).startsWith('sms-draft:v1:')) return native(plugin, method, input);
        if (method === 'secureRead') return {value: localStorage.getItem(key(input.slot))};
        if (method !== 'secureCompareExchange') return native(plugin, method, input);
        if (localStorage.getItem(key(input.slot)) !== (input.expectedValue ?? null)) return {status: 'conflict'};
        if (input.value === null) localStorage.removeItem(key(input.slot)); else localStorage.setItem(key(input.slot), input.value);
        return {status: 'saved'};
      };
    });
    await page.reload();
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    await page.locator(personField).fill('Draft that survives');
    await openAlpha(page);
    await expect(page.locator(bubble)).toHaveAttribute('data-alpha-draft-bubble', 'owner');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('fixture.secure.sms-draft:v1:')).length)).toBe(1);
    await page.reload();
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    await expect(page.locator(personField)).toHaveValue('Draft that survives');
    expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  });

  test('a suggested reply is faint text only while the owner has turned suggested replies on; accepting it sends nothing', async ({page}) => {
    await setupTelephony(page);
    await page.evaluate(async () => (await import('/src/prototype/sms-adapter.ts' as string)).setSmsReplySuggester(async () => 'See you at three'));
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    await expect(page.locator('[data-alpha-messages-title]')).toHaveText('Ada Okafor');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-alpha-faint]'), 'opt-in off: no faint reply').toHaveCount(0);
    await page.locator('[data-alpha-messages-suggest]').click();
    await page.getByRole('group', {name: 'Turn on suggested replies'}).getByRole('button', {name: 'Turn on'}).click();
    await page.locator('[data-alpha-messages]').getByRole('button', {name: 'Back', exact: true}).click();
    await page.getByRole('button', {name: /^Ada Okafor/}).click();
    const faint = page.locator('[data-alpha-faint]');
    await expect(faint).toHaveAttribute('aria-label', 'Suggestion: See you at three, double-tap to use');
    await expect(page.locator(personField)).toHaveValue('');
    await faint.click();
    await expect(page.locator(personField)).toHaveValue('See you at three');
    expect(await inputs(page, 'sendComposedSms')).toEqual([]);
  });
});

test.describe('Messages in the development build: ?mode=dev&fixture=1 with ELIZA_DEV_ALLOW_TEST_MOCKS=1 (scripted replies, no adapters)', () => {
  test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})));
    await page.goto('/?mode=dev&fixture=1');
    await page.getByRole('button', {name: 'Messages', exact: true}).first().click();
  });

  test('typing in the list filters it on the phone with no network request', async ({page}) => {
    const requests = await requestsDuring(page, async () => {
      await page.locator(filterField).fill('maya');
      await expect(page.getByRole('button', {name: /^(Unread, )?Maya Chen$/})).toBeVisible();
      await expect(page.getByRole('button', {name: /^(Unread, )?Jordan Park$/})).toHaveCount(0);
    });
    expect(requests).toEqual([]);
    await page.locator(filterField).fill('');
    await expect(page.getByRole('button', {name: /^(Unread, )?Jordan Park$/})).toBeVisible();
  });

  test('a sentence in the list bar does not filter, and only Enter sends it to Alpha, whose answer filters the list with a clearable chip', async ({page}) => {
    await page.locator(filterField).fill('find texts about the prototype');
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', {name: /^(Unread, )?Jordan Park$/}), 'a sentence is a question, not a filter').toBeVisible();
    await expect(page.locator('[data-alpha-layer="conversation"]').getByText('find texts about the prototype', {exact: true}), 'nothing is sent while typing').toHaveCount(0);
    await page.locator(filterField).press('Enter');
    await expect(page.locator('[data-alpha-layer="conversation"]').getByText('find texts about the prototype', {exact: true})).toBeVisible();
    const chip = page.locator('[data-alpha-list-filter-chip]');
    await expect(chip).toContainText('the prototype');
    await expect(page.getByRole('button', {name: /^(Unread, )?Jordan Park$/})).toHaveCount(0);
    await chip.getByRole('button', {name: 'Clear filter the prototype'}).click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByRole('button', {name: /^(Unread, )?Jordan Park$/})).toBeVisible();
  });

  test('Alpha drafts into the thread\'s slot; Undo, Edit and Send act only on the owner\'s taps', async ({page}) => {
    await page.getByRole('button', {name: /^(Unread, )?Maya Chen$/}).click();
    await page.locator(personField).fill('My words');
    await openAlpha(page);
    await expect(page.locator(bubble)).toHaveAttribute('data-alpha-draft-bubble', 'owner');
    await page.locator(alphaField).fill("tell maya I'm running ten minutes late");
    await page.locator(alphaField).press('Enter');
    await expect(page.locator(bubble)).toHaveAttribute('data-alpha-draft-bubble', 'alpha');
    await expect(page.locator(bubble)).toContainText("I'm running ten minutes late.");
    await expect(page.locator(bubble)).toContainText("Alpha's draft · not sent");
    await page.locator('[data-alpha-draft-undo]').click();
    await expect(page.locator(bubble)).toHaveAttribute('data-alpha-draft-bubble', 'owner');
    await expect(page.locator(bubble)).toContainText('My words');
    await page.locator('[data-alpha-draft-edit]').click();
    await expect(page.locator(personField)).toBeFocused();
    await expect(page.locator(personField)).toHaveValue('My words');
    await openAlpha(page);
    await page.locator('[data-alpha-draft-send]').click();
    await expect(page.locator('[data-alpha-draft-sent="true"]')).toHaveText('My words');
    await expect(page.locator(bubble)).toHaveCount(0);
    await expect(page.getByText('Sent to Maya Chen', {exact: true})).toBeVisible();
  });
});
