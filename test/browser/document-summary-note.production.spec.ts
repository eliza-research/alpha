import {openRetainedNativeNotes} from './helpers/native-notes';
import {returnToApps} from './app-navigation';
// J03 on the FLAG-OFF bundle with an agent: a document chosen in Files, a reviewed question, the
// resident agent's answer and an explicit, reviewed Save that keeps one note linked to its source.
//
// The document arrives as the product receives one on Android: the system picker grants a
// selection, Android reads its bytes, and a retained source reference reopens only those bytes.
// The question is posted to the resident agent over the native bridge and the answer streams back
// over it. Notes are saved in the Keystore-backed slot. All of that is the stubbed Android bridge in
// test/browser/flag-off-android.ts; nothing is injected into the renderer.
//
// J05 (a reviewed page excerpt, a resident answer and an explicit Save) runs the same summary path
// on the native browser branch: see the J05 Android tests in journey-core-loops.production.spec.ts.
//
// Evidence boundary: source/test evidence for the flag-off renderer with the Android bridge
// stubbed. It is not evidence for an installed APK, the Android document provider, the resident
// runtime, a model answer, Eliza Cloud or a device, and no document, account or note is real.
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, type FlagOffDocument } from './flag-off-android';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const contents = 'Public fact: twelve raised beds.\nPRIVATE OMIT: do not send this line.';
const excerpt = 'Public fact: twelve raised beds.';
const answer = 'The report says there are twelve raised beds.';
const garden: FlagOffDocument = { name: 'garden-report.txt', mimeType: 'text/plain', text: contents };
const sha256 = createHash('sha256').update(contents).digest('hex');

const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
/** The notes saved in the Keystore-backed Notes slot (its envelope holds the collection's bytes). */
const savedNotes = (page: Page) => harness(page, f => { const slot = f.slots['notes-records:v1:device']; return slot ? JSON.parse(JSON.parse(slot).currentRaw).records : []; }) as Promise<any[]>;
/** What the user sent: each turn's text after the current-screen context the renderer adds. */
const sent = (page: Page) => harness(page, f => f.posts.map((post: string) => post.split('[USER MESSAGE]\n').pop())) as Promise<string[]>;

/** Files > Documents > the document > Ask Alpha, trimmed to the public line, and sent. */
async function askAboutDocument(page: Page) {
  await page.evaluate(text => { (window as any).flagOff.replies.push(text); }, answer);
  await button(page, 'Files').click();
  await button(page, 'Documents').click();
  await button(page, 'Open garden-report.txt').click();
  await expect(page.getByText('PRIVATE OMIT: do not send this line.', { exact: true })).toBeVisible();
  // Documents lists the file from storage; opening it selected that one path, and nothing was sent.
  expect(await harness(page, f => f.documents.picks)).toEqual([{ action: 'files', path: 'Documents/garden-report.txt' }]);
  await button(page, 'Ask Alpha').click();
  const question = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(question.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue(contents);
  await expect(question.getByRole('checkbox', { name: 'Link this source when saving the answer to Notes' })).toBeChecked();
  await question.getByRole('textbox', { name: 'Content excerpt' }).fill(excerpt);
  await question.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await expect(question).toHaveCount(0);
  // Composed only: nothing reaches the agent before Send.
  expect(await harness(page, f => f.streams)).toBe(0);
  await button(page, 'Send').click();
  await expect(bubble(page, answer)).toHaveCount(1, { timeout: 20_000 });
  // One turn: the question, the source's name and only the trimmed excerpt.
  expect(await sent(page)).toEqual(['Summarize this excerpt.\n\nSource: garden-report.txt\n\n' + excerpt]);
  expect(await harness(page, f => f.posts.join('\n'))).not.toContain('PRIVATE OMIT');
}

test('J03 on Android: a picked document, a trimmed question and the resident answer become one reviewed note whose source link reopens the exact bytes', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { document: garden });
  await residentHome(page);
  await openRetainedNativeNotes(page);
  await returnToApps(page);
  await askAboutDocument(page);

  // An answer alone saves nothing; the summary is reviewed first and Cancel is a real cancel.
  expect(await savedNotes(page)).toEqual([]);
  const card = page.getByRole('button', { name: /^Review summary note/ });
  await expect(card).toHaveCount(1);
  await card.click();
  const review = page.getByRole('dialog', { name: 'Save reviewed summary note' });
  await expect(review.getByRole('textbox', { name: 'Summary note text' })).toHaveValue(answer);
  await expect(review).toContainText('The note will link to garden-report.txt.');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await savedNotes(page)).toEqual([]);
  await card.click();
  await review.getByRole('textbox', { name: 'Summary note title' }).fill('Garden summary');
  await review.getByRole('textbox', { name: 'Summary note text' }).fill('There are twelve raised beds.');
  await review.getByRole('button', { name: 'Save reviewed note', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Summary note saved/ })).toHaveCount(1);
  await expect(card).toHaveCount(0);
  const saved = await savedNotes(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ title: 'Garden summary', body: 'There are twelve raised beds.' });
  expect(saved[0].documentSource).toEqual({ version: 1, name: 'garden-report.txt', mimeType: 'text/plain', size: Buffer.byteLength(contents), sha256, reference: expect.stringMatching(/^b1:[a-f0-9-]{36}$/) });
  expect(JSON.stringify(saved)).not.toContain('PRIVATE OMIT');

  // After a restart the note is the only one, and its source link reopens exactly the linked bytes.
  await page.reload();
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await openRetainedNativeNotes(page);
  await expect(page.getByRole('region', { name: 'Notes' }).getByRole('button', { name: /^Open (?!Trash$)/ })).toHaveCount(1);
  await button(page, 'Open Garden summary').click();
  await button(page, 'Attachment').click();
  const source = page.getByRole('dialog', { name: 'Note source document' });
  await expect(source).toContainText('garden-report.txt');
  await expect(source).toContainText(sha256);
  await source.getByRole('button', { name: 'Open linked source', exact: true }).click();
  await expect(source.getByRole('status')).toHaveText('Opened garden-report.txt.');
  expect(await harness(page, f => f.documents.opened)).toEqual([{ reference: saved[0].documentSource.reference, sha256, size: Buffer.byteLength(contents), mimeType: 'text/plain' }]);
  expect(await savedNotes(page)).toEqual(saved);
  expect(await harness(page, f => f.streams)).toBe(0);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('J03 on Android: a resident session that changes before Save withdraws the summary and saves nothing', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { document: garden });
  await residentHome(page);
  await openRetainedNativeNotes(page);
  await returnToApps(page);
  await askAboutDocument(page);
  await expect(page.getByRole('button', { name: /^Review summary note/ })).toHaveCount(1);
  // The resident agent is reconnected from Settings: a new verified session.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Settings').click();
  await button(page, 'Agent connection').click();
  await page.getByRole('region', { name: 'Settings',exact:true }).getByRole('button', { name: 'Reconnect agent', exact: true }).click();
  await expect.poll(() => harness(page, f => f.calls.filter((call: string) => call === 'Agent.start').length), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await button(page, 'Open conversation').click();
  // The restored conversation keeps the answer; the review bound to the earlier session is gone.
  await expect(bubble(page, answer)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Review summary note/ })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Save reviewed summary note' })).toHaveCount(0);
  expect(await savedNotes(page)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
