import {openLegacyNotes} from './helpers/legacy-notes';
// Journey J05: Web research -> note, driven through rendered controls in the browser build
// (development profile, /?mode=dev, with the development agent profile connected).
//
// Evidence boundary: a pass is source/test evidence for the browser renderer only. It is NOT
// APK, emulator, AOSP image, physical-device or real-integration evidence.
//
// Synthetic fixtures:
// - The web page is test-owned: https://public-fixture.test/harbour is fulfilled by Playwright
//   (page.route), the approach web-summary-note.spec.ts uses. A question source must be a public
//   HTTPS address, so a plain-HTTP 127.0.0.1 server cannot stand in here (journey E asserts that
//   refusal). No real site is contacted; any other external request fails the test.
// - The agent is the development agent profile with a scripted reply saved through Settings.
//   No model or hosted agent is involved, so answer quality is not evidence of anything.
//
// Native-only steps (not provable here):
// - Excerpt extraction from the isolated native WebView (Browser.reviewQuestion) and its
//   navigation/revision binding; the browser build re-fetches the public page without credentials.
// - A real agent answering from the reviewed excerpt.
// - Encrypted native Notes storage; here the browser Notes document is read back.
import {test, expect, type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';

test.describe.configure({mode: 'serial'});
const url = 'https://public-fixture.test/harbour';
const html = '<article><h1>Harbour report</h1><p>The ferry leaves at nine from pier four.</p><p>OMIT THIS: internal planning detail.</p></article>';
const answer = 'The ferry leaves at nine.';
const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
// The test selects the retained (Older notes) document explicitly, as web-summary-note.spec.ts does.
const notes = (page: Page) => page.evaluate(async () => JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()) || '{"records":[]}').records as any[]);
const agentMessages = (page: Page) => page.evaluate(async () => (await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c: any) => c.messages) as {role: string; text: string}[]);
const sourceHeading = (page: Page) => page.locator('iframe[title="Website"]:visible').contentFrame().getByRole('heading', {name: 'Harbour report', exact: true});

/** Connects the development agent with a scripted reply, then opens the fixture page in Browser. */
async function begin(page: Page, external: string[], crossOriginReadable: boolean) {
  page.on('request', request => { const host = new URL(request.url()).hostname; if (/^https?:/.test(request.url()) && !['127.0.0.1', 'localhost', 'public-fixture.test'].includes(host)) external.push(request.url()); });
  // The frame navigation always loads; the renderer's credential-free re-read is a fetch, which a
  // site without CORS denies.
  await page.route(url, route => route.request().resourceType() === 'fetch' && !crossOriginReadable ? route.abort() : route.fulfill({contentType: 'text/html', headers: crossOriginReadable ? {'access-control-allow-origin': '*'} : {}, body: html}));
  await page.goto('/?mode=dev');
  await button(page, 'Settings').click();
  await button(page, 'Agent connection').click();
  await page.getByRole('textbox', {name: 'Scripted reply'}).fill(answer);
  await page.getByRole('button', {name: 'Save development reply'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Development reply saved.'})).toBeVisible();
  await page.getByRole('button', {name: 'Connect development profile'}).click();
  await returnToApps(page);await openLegacyNotes(page);await returnToApps(page);
  await button(page, 'Browser').click();
  await button(page, 'Search or type address').click();
  await page.getByRole('textbox', {name: 'Address', exact: true}).fill(url);
  await page.getByRole('textbox', {name: 'Address', exact: true}).press('Enter');
  await expect(sourceHeading(page)).toBeVisible();
  expect(await notes(page)).toEqual([]);
}
async function askAboutPage(page: Page) {
  await button(page, 'Menu').click();
  await button(page, 'Ask about page').click();
  return page.getByRole('dialog', {name: 'Ask about selected content'});
}
/** Sends the reviewed draft, checks what the agent received and returns the summary review. */
async function sendAndOpenSummary(page: Page, question: string, excerpt: string) {
  await expect(page.getByRole('textbox', {name: 'Message Alpha', exact: true})).toHaveValue(new RegExp(question.replace(/[.?]/g, '\\$&')));
  expect((await agentMessages(page)).filter(message => message.role === 'user')).toEqual([]);
  await button(page, 'Send').click();
  await expect(page.getByRole('button', {name: `Message actions: ${answer}`, exact: true})).toBeVisible();
  const sent = (await agentMessages(page)).filter(message => message.role === 'user').map(message => message.text.split('[USER MESSAGE]\n')[1]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain(question);
  expect(sent[0]).toContain(excerpt);
  expect(sent[0]).toContain(url);
  expect(JSON.stringify(await agentMessages(page))).not.toContain('OMIT THIS');
  // An answer alone saves nothing.
  expect(await notes(page)).toEqual([]);
  await page.getByRole('button', {name: /^Review summary note/}).click();
  return page.getByRole('dialog', {name: 'Save reviewed summary note'});
}
async function expectOneLinkedNoteAfterReload(page: Page, title: string, body: string) {
  await page.reload();
  const saved = await notes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({title, body, webSource: {kind: 'web-page', version: 1, url}});
  expect(JSON.stringify(saved)).not.toContain('OMIT THIS');
  await openLegacyNotes(page);
  await expect(page.getByRole('region', {name: 'Notes'}).getByRole('button', {name: /^Open (?!Trash$)/})).toHaveCount(1);
  await button(page, `Open ${title}`).click();
  await expect(page.getByRole('textbox', {name: 'Title', exact: true})).toHaveValue(title);
  await expect(page.getByRole('textbox', {name: 'Note', exact: true})).toHaveValue(body);
  await button(page, 'Web source linked').click();
  const source = page.getByRole('dialog', {name: 'Note web source'});
  await expect(source).toContainText(url);
  await expect(source).toContainText('Its contents may have changed since the summary was saved.');
  await source.getByRole('button', {name: 'Open source page', exact: true}).click();
  await expect(source).toHaveCount(0);
  await expect(sourceHeading(page)).toBeVisible();
  await expect(button(page, 'Edit address')).toContainText('public-fixture.test');
  // Opening the source is navigation only: the note is unchanged and still the only one.
  expect(await notes(page)).toEqual(saved);
}

test('reviewed page excerpt, development agent answer and explicit Save leave exactly one source-linked note', async ({page}) => {
  test.setTimeout(240_000);
  const external: string[] = [];
  await begin(page, external, true);

  const review = await askAboutPage(page);
  const excerpt = review.getByRole('textbox', {name: 'Content excerpt'});
  await expect(excerpt).toHaveValue(/The ferry leaves at nine from pier four\./);
  await expect(excerpt).toHaveValue(/OMIT THIS/);
  await expect(review.getByRole('checkbox', {name: 'Link this source when saving the answer to Notes'})).toBeChecked();
  // The user bounds what is shared: the edited excerpt and question are the only page text sent.
  await excerpt.fill('The ferry leaves at nine from pier four.');
  await review.getByRole('textbox', {name: 'Question about content'}).fill('When does the ferry leave?');
  await review.getByRole('button', {name: 'Use in conversation', exact: true}).click();
  await expect(review).toHaveCount(0);

  const summary = await sendAndOpenSummary(page, 'When does the ferry leave?', 'The ferry leaves at nine from pier four.');
  await expect(summary).toContainText(`The note will link to ${url}.`);
  await expect(summary.getByRole('textbox', {name: 'Summary note text'})).toHaveValue(answer);
  // Cancel is a real cancel.
  await summary.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(summary).toHaveCount(0);
  expect(await notes(page)).toEqual([]);
  await page.getByRole('button', {name: /^Review summary note/}).click();
  await summary.getByRole('textbox', {name: 'Summary note title'}).fill('Harbour summary');
  await summary.getByRole('textbox', {name: 'Summary note text'}).fill('Ferry departs at nine from pier four.');
  await summary.getByRole('button', {name: 'Save reviewed note', exact: true}).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByText('Summary note saved with its source.', {exact: true})).toBeVisible();
  expect(await notes(page)).toHaveLength(1);
  // The saved marker is not a second Save.
  await expect(page.getByRole('button', {name: /^Review summary note/})).toHaveCount(0);
  await page.getByRole('button', {name: /^Summary note saved/}).click();
  await expect(summary).toHaveCount(0);
  expect(await notes(page)).toHaveLength(1);

  await expectOneLinkedNoteAfterReload(page, 'Harbour summary', 'Ferry departs at nine from pier four.');
  expect(external).toEqual([]);
});

test('when cross-origin reading is denied, pasted text is reviewed instead and still saves one linked note', async ({page}) => {
  test.setTimeout(240_000);
  const external: string[] = [];
  await begin(page, external, false);

  const review = await askAboutPage(page);
  const excerpt = review.getByRole('textbox', {name: 'Content excerpt'});
  // Nothing was read from the page; nothing can continue until the user supplies text.
  await expect(excerpt).toHaveValue('');
  await expect(review.getByRole('button', {name: 'Use in conversation', exact: true})).toBeDisabled();
  await excerpt.fill('Pasted: the ferry leaves at nine.');
  await review.getByRole('button', {name: 'Use in conversation', exact: true}).click();
  await expect(review).toHaveCount(0);

  const summary = await sendAndOpenSummary(page, 'Summarize this excerpt.', 'Pasted: the ferry leaves at nine.');
  await summary.getByRole('textbox', {name: 'Summary note title'}).fill('Pasted harbour summary');
  await summary.getByRole('button', {name: 'Save reviewed note', exact: true}).click();
  await expect(summary).toHaveCount(0);
  expect(await notes(page)).toHaveLength(1);

  await expectOneLinkedNoteAfterReload(page, 'Pasted harbour summary', answer);
  expect(external).toEqual([]);
});

// J05-6: the tab navigates after the question review is already open (the fetch has finished). The
// review belongs to the page it was made from, so it closes and leaves nothing behind.
test('navigating after the question review opens closes it: no draft, no message and no note', async ({page}) => {
  test.setTimeout(240_000);
  const external: string[] = [];
  await begin(page, external, true);
  await page.route('https://public-fixture.test/elsewhere', route => route.fulfill({contentType: 'text/html', body: '<h1>Another page</h1>'}));
  await page.evaluate(async () => { const {registerPlugin} = await import('/src/platform-plugins.ts'); await registerPlugin<any>('AlphaBrowser').addListener('stateChanged', (event: any) => { (window as any).webNavigation = event; }); });
  await button(page, 'Menu').click();
  await button(page, 'Reload page').click();
  await expect(sourceHeading(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).webNavigation)).toBe(true);

  const review = await askAboutPage(page);
  await expect(review.getByRole('textbox', {name: 'Content excerpt'})).toHaveValue(/The ferry leaves at nine/);
  await review.getByRole('textbox', {name: 'Question about content'}).fill('When does the ferry leave?');
  await page.evaluate(async () => { const {registerPlugin} = await import('/src/platform-plugins.ts'); const event = (window as any).webNavigation; await registerPlugin<any>('AlphaBrowser').navigate({session: event.session, id: event.id, url: 'https://public-fixture.test/elsewhere'}); });
  await expect(page.locator('iframe[title="Website"]:visible').contentFrame().getByRole('heading', {name: 'Another page', exact: true})).toBeVisible();
  await expect(review).toHaveCount(0);
  // Nothing was placed in the conversation: opening it shows an empty composer.
  await expect(page.getByRole('textbox', {name: 'Message Alpha', exact: true})).toHaveCount(0);
  await button(page, 'Open conversation').click();
  await expect(page.getByRole('textbox', {name: 'Message Alpha', exact: true})).toHaveValue('');
  expect((await agentMessages(page)).filter(message => message.role === 'user')).toEqual([]);
  expect(await notes(page)).toEqual([]);
  expect(external).toEqual([]);
});
