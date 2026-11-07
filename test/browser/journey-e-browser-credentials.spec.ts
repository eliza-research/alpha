// Journey E: Browser + credentials, driven start to finish through rendered controls in the
// browser build (development profile, /?mode=dev).
//
// Evidence boundary: a pass is source/test evidence for the browser renderer only. It is NOT
// APK, emulator, AOSP image, physical-device or real-integration evidence.
//
// Synthetic fixtures (all test-owned, nothing leaves this machine):
// - Web pages come from an in-process HTTP server on 127.0.0.1 started by this spec.
// - The search engine is an external boundary: https://www.google.com/search is fulfilled by
//   Playwright with a test-owned results page; no real request is sent.
// - The device speech engine is replaced by a recording fixture (same prototype hook that
//   reading-sensitive.spec.ts uses), so no audio is played; the reviewed text handed to speech
//   is what is asserted.
// - Password values are only the development vault's built-in synthetic records and the
//   development provider's disposable sample sign-in. Nothing is typed into a credential field.
//
// Native-only steps (not provable here; the spec asserts the honest browser-build state instead):
// - Isolated per-tab WebView and a persistent browsing profile across a cold start. The browser
//   build renders sandboxed iframes; only the regular tab list is asserted across a reload.
// - Android Autofill (service selection, fill, save prompt): the UI states it is unavailable.
// - BiometricPrompt / Keystore unlock: the development vault unlocks without a prompt.
// - TLS lock indicator: never shown in the browser build.
import {createServer, type Server} from 'node:http';
import {test, expect, type Page} from '@playwright/test';

const article = '<article><h1>Harbour notes</h1><p>The ferry leaves at nine.</p><script>window.injected=true</script><p hidden>Hidden text</p></article>';
let server: Server, origin = '';
const hits: string[] = [];
// Held responses for /arrivals?held: the document a page is leaving for commits only when the test releases it.
const held: Array<() => void> = [];
const releaseArrivals = () => { for (const finish of held.splice(0)) finish(); };

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url || '';
    hits.push(path);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'text/html');
    if (path === '/article') response.end(article);
    // A page that leaves for another document by itself. The destination is held by the server,
    // so the old document stays on screen until the test lets the navigation commit.
    else if (path === '/departures') response.end('<head><meta http-equiv="refresh" content="1;url=/arrivals?held"></head><article><h1>Departures</h1><p>Old page text.</p></article>');
    else if (path === '/arrivals?held') held.push(() => response.end('<article><h1>Arrivals</h1><p>New page text.</p></article>'));
    else if (path === '/arrivals') response.end('<article><h1>Arrivals</h1><p>New page text.</p></article>');
    else if (path === '/members') response.end('<article><h1>Members</h1><form><input type="password" aria-label="Member key"></form></article>');
    else response.end(`<article><h1>Page ${path.slice(1)}</h1></article>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing server address');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { releaseArrivals(); await new Promise<void>(resolve => server.close(() => resolve())); });

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const addressBox = (page: Page) => page.getByRole('textbox', {name: 'Address', exact: true});
// Each tab owns one sandboxed frame; only the current tab's frame is visible.
const heading = (page: Page, name: string) => page.locator('iframe[title="Website"]:visible').contentFrame().getByRole('heading', {name, exact: true});
async function enter(page: Page, value: string) {
  // A new tab opens with the address field already focused for editing.
  if (!await addressBox(page).isVisible()) await page.getByRole('button', {name: /^(Edit address|Search or type address)$/}).first().click();
  await addressBox(page).fill(value);
  await addressBox(page).press('Enter');
}
async function menu(page: Page, name: string) { await button(page, 'Menu').click(); await button(page, name).click(); }
const providerDocument = (page: Page) => page.evaluate(async () => (await import('/src/browser/preference-documents.ts')).passwordProviderDocument.readRaw());

test('browser navigation, tabs, private tab, reviewed reading and password manager complete as one journey', async ({page}) => {
  test.setTimeout(240_000);
  const searches: string[] = [];
  await page.route('https://www.google.com/search**', route => {
    searches.push(new URL(route.request().url()).searchParams.get('q') || '');
    return route.fulfill({contentType: 'text/html', body: '<h1>Results fixture</h1>'});
  });
  await page.goto('/?mode=dev');
  await page.evaluate(async () => {
    const {BrowserVoice} = await import('/src/browser/voice.ts');
    (window as any).speechCalls = [];
    BrowserVoice.prototype.synthesizeLocal = async function (input: {text: string}) { (window as any).speechCalls.push(input.text); throw Error('Fixture terminal'); };
  });

  await test.step('navigate, search, Back and Forward', async () => {
    await button(page, 'Browser').click();
    await expect(page.getByRole('heading', {name: 'New tab', exact: true})).toBeVisible();
    await enter(page, `${origin}/one`);
    await expect(heading(page, 'Page one')).toBeVisible();
    await expect(button(page, 'Edit address')).toContainText('/one');
    // The browser build cannot verify TLS, so it must not claim a secure connection.
    await expect(page.getByRole('img', {name: 'Secure connection', exact: true})).toHaveCount(0);
    await enter(page, 'ferry timetable');
    await expect(heading(page, 'Results fixture')).toBeVisible();
    expect(searches).toEqual(['ferry timetable']);
    await button(page, 'Previous page').click();
    await expect(heading(page, 'Page one')).toBeVisible();
    await button(page, 'Next page').click();
    await expect(heading(page, 'Results fixture')).toBeVisible();
    await button(page, 'Previous page').click();
    await expect(heading(page, 'Page one')).toBeVisible();
  });

  await test.step('second tab, switch between tabs', async () => {
    await button(page, 'Tabs').click();
    await expect(page.getByRole('heading', {name: '1 tab', exact: true})).toBeVisible();
    await button(page, 'New tab').click();
    await expect(page.getByRole('note', {name: 'Private tab notice'})).toHaveCount(0);
    await enter(page, `${origin}/article`);
    await expect(heading(page, 'Harbour notes')).toBeVisible();
    await expect(button(page, 'Tabs')).toHaveText('2');
    await button(page, 'Tabs').click();
    await expect(page.getByRole('heading', {name: '2 tabs', exact: true})).toBeVisible();
    await button(page, `Switch to ${origin}/one`).click();
    await expect(heading(page, 'Page one')).toBeVisible();
    await button(page, 'Tabs').click();
    await button(page, `Switch to ${origin}/article`).click();
    await expect(heading(page, 'Harbour notes')).toBeVisible();
  });

  await test.step('reviewed page reading hands only reviewed text to local speech', async () => {
    await menu(page, 'Read aloud');
    const review = page.getByRole('dialog', {name: 'Read page excerpt'});
    await expect(review.getByRole('status', {name: 'Reading status'})).toHaveText('Public page text loaded. Review before reading.');
    const excerpt = review.getByRole('textbox', {name: 'Excerpt to read'});
    await expect(excerpt).toHaveValue('Harbour notes\n\nThe ferry leaves at nine.');
    expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
    expect(await page.evaluate(() => (window as any).speechCalls)).toEqual([]);
    await excerpt.fill('The ferry leaves at nine.');
    await review.getByRole('button', {name: 'Read locally', exact: true}).click();
    await expect(review.getByRole('status', {name: 'Reading status'})).toHaveText('Fixture terminal');
    expect(await page.evaluate(() => (window as any).speechCalls)).toEqual(['The ferry leaves at nine.']);
    await review.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(review).toHaveCount(0);
  });

  // Journey hardening (docs/core-loop-audit.md, work order 14): navigation during approval.
  await test.step('a page that navigates while its excerpt is under review retires that review; nothing of the old page is read', async () => {
    await enter(page, `${origin}/departures`);
    await expect(heading(page, 'Departures')).toBeVisible();
    await menu(page, 'Read aloud');
    const review = page.getByRole('dialog', {name: 'Read page excerpt'});
    await expect(review.getByRole('status', {name: 'Reading status'})).toHaveText('Public page text loaded. Review before reading.');
    await expect(review.getByRole('textbox', {name: 'Excerpt to read'})).toHaveValue('Departures\n\nOld page text.');
    await expect(review.getByRole('button', {name: 'Read locally', exact: true})).toBeEnabled();
    // The page starts leaving on its own; the old document is still shown while the request is held.
    await expect.poll(() => held.length).toBe(1);
    await expect(heading(page, 'Departures')).toBeVisible();
    await expect(review).toBeVisible();
    // The navigation commits while the review is open: the review of the old target is withdrawn.
    releaseArrivals();
    await expect(heading(page, 'Arrivals')).toBeVisible();
    await expect(review).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Read locally', exact: true})).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).speechCalls)).toEqual(['The ferry leaves at nine.']);
    // The host cannot see where a sandboxed page took itself, so it says so and offers no reading
    // of that unknown document: the menu offers neither Read aloud nor a page question, so no review
    // opens and nothing is spoken.
    await expect(page.getByRole('status').filter({hasText: 'The website navigated inside'})).toBeVisible();
    await button(page, 'Menu').click();
    await expect(button(page, 'Reload page')).toBeVisible();
    await expect(button(page, 'Read aloud')).toHaveCount(0);
    await expect(button(page, 'Ask about page')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog',{name:'Browser menu',exact:true})).toHaveCount(0);
    await expect(review).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).speechCalls)).toEqual(['The ferry leaves at nine.']);
    // Going to the new address explicitly restores a reviewable page: the review is of that page.
    await enter(page, `${origin}/arrivals`);
    await expect(heading(page, 'Arrivals')).toBeVisible();
    await menu(page, 'Read aloud');
    await expect(review.getByRole('status', {name: 'Reading status'})).toHaveText('Public page text loaded. Review before reading.');
    await expect(review.getByRole('textbox', {name: 'Excerpt to read'})).toHaveValue('Arrivals\n\nNew page text.');
    await review.getByRole('button', {name: 'Read locally', exact: true}).click();
    await expect(review.getByRole('status', {name: 'Reading status'})).toHaveText('Fixture terminal');
    expect(await page.evaluate(() => (window as any).speechCalls)).toEqual(['The ferry leaves at nine.', 'Arrivals\n\nNew page text.']);
    await review.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(review).toHaveCount(0);
  });

  await test.step('a page with a credential field is refused for reading and for questions', async () => {
    await enter(page, `${origin}/members`);
    await expect(heading(page, 'Members')).toBeVisible();
    await menu(page, 'Read aloud');
    const review = page.getByRole('dialog', {name: 'Read page excerpt'});
    await expect(review.getByRole('status', {name: 'Reading status'})).toContainText('may contain credentials or verification codes');
    await expect(review.getByRole('textbox', {name: 'Excerpt to read'})).toHaveValue('');
    await expect(review.getByRole('textbox', {name: 'Excerpt to read'})).toBeDisabled();
    await expect(review.getByRole('button', {name: 'Read locally', exact: true})).toBeDisabled();
    await review.getByRole('button', {name: 'Close', exact: true}).click();
    expect(await page.evaluate(() => (window as any).speechCalls)).toHaveLength(2);
    // A plain-HTTP local page is not an acceptable question source: honest refusal, no editor,
    // and the menu must not stay open over the refusal.
    await menu(page, 'Ask about page');
    await expect(page.getByText('Load a public HTTPS page before asking about it.', {exact: true})).toBeVisible();
    await expect(page.getByRole('dialog', {name: 'Ask about selected content'})).toHaveCount(0);
    await expect(button(page, 'Close menu')).toHaveCount(0);
  });

  await test.step('private tab is marked, kept out of history and gone after reload', async () => {
    await menu(page, 'New private tab');
    await expect(page.getByRole('note', {name: 'Private tab notice'})).toContainText('not saved in Alpha history');
    await enter(page, `${origin}/private`);
    await expect(heading(page, 'Page private')).toBeVisible();
    await expect(page.getByRole('img', {name: 'Private tab', exact: true})).toBeVisible();
    await button(page, 'Tabs').click();
    await expect(page.getByRole('heading', {name: '3 tabs', exact: true})).toBeVisible();
    await expect(button(page, `Switch to private tab ${origin}/private`)).toBeVisible();
    await button(page, 'Back to page').click();
    await menu(page, 'Bookmarks and history');
    await button(page, 'History').click();
    await expect(button(page, `${origin}/one`)).toBeVisible();
    await expect(button(page, `${origin}/article`)).toBeVisible();
    await expect(button(page, `${origin}/members`)).toBeVisible();
    await expect(button(page, `${origin}/private`)).toHaveCount(0);
    expect(hits.filter(path => path === '/private').length).toBeGreaterThan(0);

    await page.reload();
    await button(page, 'Browser').click();
    await expect(button(page, 'Tabs')).toHaveText('2');
    await button(page, 'Tabs').click();
    await expect(page.getByRole('heading', {name: '2 tabs', exact: true})).toBeVisible();
    await expect(button(page, `Switch to ${origin}/one`)).toBeVisible();
    await expect(button(page, `Switch to ${origin}/members`)).toBeVisible();
    await expect(page.getByRole('button', {name: /private/i})).toHaveCount(1); // only the "New private tab" control
    await button(page, 'Back to page').click();
  });

  await test.step('password manager from the Browser menu: honest autofill state and development vault', async () => {
    await menu(page, 'Password manager');
    const settings = page.getByRole('region', {name: 'Settings'});
    await expect(settings.getByRole('heading', {name: 'Password manager', exact: true})).toBeVisible();
    await expect(settings).toContainText(/Vault\s*Locked/);
    await expect(settings).toContainText('Unavailable in this browser. Use Show or Copy for website passwords.');
    await expect(settings).toContainText(/Autofill service\s*None selected/);
    await expect(settings).toContainText(/Provider\s*Not installed/);
    await expect(settings).toContainText('No provider selected');
    expect(await providerDocument(page)).toBeNull();
    await settings.getByRole('button', {name: /^Unlock passwords/}).click();
    await expect(settings).toContainText(/Vault\s*Unlocked · locks after 60 s or when you leave/);
    await expect(settings.getByRole('button', {name: /^Open Example sign-in/})).toBeVisible();
    await button(page, 'Lock passwords').click();
    await expect(settings).toContainText(/Vault\s*Locked/);
    await expect(settings.getByRole('button', {name: /^Open Example sign-in/})).toHaveCount(0);
  });

  await test.step('development provider: install, select, unlock, fill the disposable sample, lock', async () => {
    await button(page, 'Add development provider').click();
    await button(page, 'Add provider').click();
    await expect(page.getByText('Development provider installed', {exact: true})).toBeVisible();
    await button(page, 'Choose password provider').click();
    await button(page, 'Proton Pass · development').click();
    await expect(page.getByText('Development provider selected', {exact: true})).toBeVisible();
    await button(page, 'Open development vault').click();
    await expect(page.getByText('Vault locked', {exact: true})).toBeVisible();
    await button(page, 'Unlock development vault').click();
    await button(page, 'Fill sample sign-in').click();
    await expect(page.getByLabel('Sample sign-in')).toContainText('demo-only-password');
    expect(await page.locator('dialog input').count()).toBe(0);
    await button(page, 'Lock vault').click();
    await expect(page.getByLabel('Sample sign-in')).toHaveCount(0);
  });

  await test.step('after reload only the provider choice persists; no sample value is stored', async () => {
    await page.reload();
    await button(page, 'Browser').click();
    await menu(page, 'Password manager');
    const settings = page.getByRole('region', {name: 'Settings'});
    await expect(page.getByText('Development provider selected', {exact: true})).toBeVisible();
    await expect(settings).toContainText(/Vault\s*Locked/);
    await expect(settings).toContainText(/Autofill service\s*None selected/);
    const stored = await providerDocument(page);
    expect(JSON.parse(stored!)).toMatchObject({installed: true, selection: 'proton'});
    expect(stored).not.toContain('password');
    expect(stored).not.toContain('alex');
    await button(page, 'Open development vault').click();
    await expect(page.getByText('Vault locked', {exact: true})).toBeVisible();
    await expect(page.getByLabel('Sample sign-in')).toHaveCount(0);
  });
});
