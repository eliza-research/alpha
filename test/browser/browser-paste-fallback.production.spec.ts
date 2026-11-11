import { test, expect, type Page } from '@playwright/test';
import { button, fenceNetwork, flagOffAndroid, harness, residentHome } from './flag-off-android';
// J05 on Android, flag-off production bundle: when the isolated-world page reader is unavailable (an
// old Android System WebView) or returns nothing usable, Ask about page opens the question review with
// an empty excerpt and Continue disabled until the user pastes text, as the web CORS-denied path does.
// A sensitive page, or excerpt text that looks like credentials, opens no review at all.
//
// The AlphaBrowser native plugin is a stub added at the Capacitor bridge in this file: it commits a
// test-owned page and answers reviewQuestion as each case needs. Evidence boundary: renderer source/
// test evidence only. Not the native BrowserReading code, an Android WebView, an APK or a device.

const PAGE = 'https://paste-fixture.test/harbour';
type Answer = { reject?: { message: string; code?: string }; text?: unknown };

/** Adds the AlphaBrowser plugin to the flag-off Android bridge. `window.browserStub.answer` decides reviewQuestion. */
async function nativeBrowser(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor, previous = bridge.nativePromise;
    const stub = w.browserStub = { calls: [] as string[], questions: 0, answer: { text: '' } as any, sequence: 0, navigation: 0 };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    bridge.PluginHeaders.push({ name: 'AlphaBrowser', methods: [...promise(['create', 'navigate', 'command', 'present', 'close', 'bookmarks', 'setBookmark', 'browsingState', 'saveBrowsingState', 'reviewQuestion', 'reviewReading', 'cancelReading', 'clearFind', 'find', 'findNext', 'share', 'downloads', 'clearBrowsingData', 'clearSiteData']), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] });
    bridge.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin !== 'AlphaBrowser') return previous(plugin, method, input);
      stub.calls.push(method);
      if (method === 'bookmarks') return { urls: [] };
      if (method === 'browsingState') return {};
      if (method === 'setBookmark') return { urls: [] };
      if (method === 'navigate') {
        // The page commits at once: one navigation, no error.
        const navigation = ++stub.navigation;
        setTimeout(() => w.flagOff.emit('AlphaBrowser', 'stateChanged', { session: input.session, id: input.id, private: false, sequence: ++stub.sequence, navigation, url: input.url, title: 'Harbour report', loading: false, committed: true, error: '', canBack: false, canForward: false }), 0);
        return {};
      }
      if (method === 'reviewQuestion') {
        stub.questions++;
        const answer = stub.answer;
        if (answer.reject) throw Object.assign(new Error(answer.reject.message), answer.reject.code ? { code: answer.reject.code } : {});
        return { text: answer.text };
      }
      return {};
    };
  });
}
async function openPage(page: Page) {
  await button(page, 'Browser').click();
  await button(page, 'Search or type address').click();
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(PAGE);
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter');
  await expect(button(page, 'Edit address')).toContainText('paste-fixture.test');
}
const answer = (page: Page, value: Answer) => page.evaluate(value => { (window as any).browserStub.answer = value; }, value);
async function askAboutPage(page: Page) {
  await button(page, 'Menu').click();
  await button(page, 'Ask about page').click();
  return page.getByRole('dialog', { name: 'Ask about selected content' });
}
const questions = (page: Page) => page.evaluate(() => (window as any).browserStub.questions as number);

test('an unreadable page opens the review with an empty excerpt; pasting enables Continue', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await nativeBrowser(page);
  await residentHome(page);
  await openPage(page);
  const cases: [string, Answer][] = [
    ['isolated world unavailable (code)', { reject: { message: 'Isolated page reading is unavailable. Update Android System WebView, then reload this page.', code: 'isolated-world-unavailable' } }],
    ['isolated world unavailable (current native message)', { reject: { message: 'Isolated page reading is unavailable. Update Android System WebView, then reload this page.' } }],
    ['empty excerpt', { text: '   ' }],
    ['invalid excerpt', { text: 42 }],
  ];
  for (const [name, value] of cases) {
    await answer(page, value);
    const before = await questions(page);
    const review = await askAboutPage(page);
    await expect(review, name).toBeVisible();
    expect(await questions(page), name).toBe(before + 1);
    const excerpt = review.getByRole('textbox', { name: 'Content excerpt' });
    await expect(excerpt, name).toHaveValue('');
    await expect(review.getByRole('button', { name: 'Use in conversation', exact: true }), name).toBeDisabled();
    await excerpt.fill('Pasted: the ferry leaves at nine.');
    await expect(review.getByRole('button', { name: 'Use in conversation', exact: true }), name).toBeEnabled();
    // The review still names its page source.
    await expect(review.getByRole('checkbox', { name: 'Link source' }), name).toBeChecked();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toHaveCount(0);
  }
  expect(await harness(page, f => f.posts)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a sensitive page or credential-like excerpt opens no review', async ({ page }) => {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await nativeBrowser(page);
  await residentHome(page);
  await openPage(page);
  const cases: [Answer, string][] = [
    [{ reject: { message: 'Reading unavailable on a sensitive or unverified page', code: 'sensitive-page' } }, 'Reading unavailable on a sensitive or unverified page'],
    [{ reject: { message: 'Reading unavailable on a sensitive or ambiguous page', code: 'sensitive-page' } }, 'Reading unavailable on a sensitive or ambiguous page'],
    [{ text: 'Your verification code is 482913. Do not share it.' }, 'This page may contain credentials or verification codes. Open a different page.'],
  ];
  for (const [value, message] of cases) {
    await answer(page, value);
    const before = await questions(page);
    await askAboutPage(page);
    await expect.poll(() => questions(page)).toBe(before + 1);
    await expect(page.locator('[data-alpha-toast]')).toContainText(message);
    await expect(page.getByRole('dialog', { name: 'Ask about selected content' })).toHaveCount(0);
  }
  expect(await harness(page, f => f.posts)).toEqual([]);
  expect(foreign).toEqual([]);
});
