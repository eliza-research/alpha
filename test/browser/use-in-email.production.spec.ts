// MVP-14 on the FLAG-OFF bundle: "Use in email" driven through the shipped assistant UI.
//
// The user opens an email in Inbox, asks the resident agent, and uses the finished reply from its
// message-actions menu. The reply arrives as the product receives one on Android: the user turn is
// posted to the agent over the native bridge and the answer streams back over it. The mailbox is a
// synthetic managed Gmail answered at the native HTTP boundary in the Cloud server's own response
// shapes. Nothing is injected into the renderer: no module is replaced, no `agentSay`, no fixture.
//
// Evidence boundary: source/test evidence for the flag-off renderer with the Android bridge
// stubbed (test/browser/flag-off-android.ts). It is not evidence for an installed APK, the resident
// runtime, a model reply, Eliza Cloud, Google or mail delivery, and no account or mail is real.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, type FlagOffAccount } from './flag-off-android';

const first = 'Thanks for the plan. Tuesday at 10 works for me.', second = 'I will bring the printed copies.';
const owner: FlagOffAccount = { connectionId: 'grant-owner', email: 'owner@example.invalid', connected: true, messages: [
  { externalId: 'm1', threadId: 't1', subject: 'Harbour schedule', from: 'Synthetic sender', fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], snippet: 'Can you do Tuesday?', bodyText: 'Can you do Tuesday at 10?', historyId: '101' }] };
const other: FlagOffAccount = { connectionId: 'grant-other', email: 'other@example.invalid', connected: false, messages: [
  { externalId: 'o1', threadId: 'ot1', subject: 'Other mailbox note', from: 'Another sender', fromEmail: 'another@example.invalid', to: ['other@example.invalid'], snippet: 'Unrelated', bodyText: 'Unrelated message in the other mailbox.', historyId: '201' }] };

const review = (page: Page) => page.getByRole('dialog', { name: 'Review email suggestion', exact: true });
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
const body = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true });
/** Keystore slots that hold `text`: where a local draft or its retained unsaved copy is stored. */
const drafts = (page: Page, text: string) => page.evaluate(text => Object.entries((window as any).flagOff.slots as Record<string, string>).filter(([, value]) => String(value).includes(text)).map(([slot]) => slot), text);
const mail = (page: Page) => harness(page, f => ({ prepares: f.mail.prepares as { requestId: string; grantId: string; digest: string; bodyText: string }[], dispatches: f.mail.dispatches as { requestId: string; grantId: string; digest: string; bodyText: string }[], sent: f.mail.sent as string[] }));

/** Inbox with the synthetic email open, on a connected resident agent. */
async function openEmail(page: Page, accounts: FlagOffAccount[] = [owner]) {
  await flagOffAndroid(page, { accounts });
  await residentHome(page);
  await button(page, 'Inbox').click();
  await button(page, 'Synthetic sender, Harbour schedule').click({ timeout: 30_000 });
  await expect(page.getByText('Can you do Tuesday at 10?', { exact: true })).toBeVisible();
}
/** The user asks; the resident agent's finished reply is the next thing in the conversation. */
async function ask(page: Page, question: string, reply: string) {
  await harness(page, f => f.replies.length);
  await page.evaluate(text => { (window as any).flagOff.replies.push(text); }, reply);
  const box = page.getByRole('textbox', { name: 'Message Alpha', exact: true }), opener = button(page, 'Open conversation');
  await expect(box.or(opener).filter({ visible: true }).first()).toBeVisible();
  if (!await box.isVisible()) await opener.click();
  await box.fill(question); await box.press('Enter');
  await expect(bubble(page, reply)).toHaveCount(1, { timeout: 20_000 });
}
async function openReview(page: Page, text: string) {
  await bubble(page, text).click();
  await page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Use in email', exact: true }).click();
  await expect(review(page)).toBeVisible();
}

test('a resident agent reply is reviewed and placed in a reply draft for the selected email, and nothing is prepared or sent', async ({ page }, info) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await openEmail(page);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  // The reply came from an agent turn over the native bridge, not from anything placed in the page.
  expect(await harness(page, f => ({ streams: f.streams, asked: f.posts.some((post: string) => post.includes('Draft a short reply accepting Tuesday')) }))).toEqual({ streams: 1, asked: true });

  await bubble(page, first).click();
  const item = page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Use in email', exact: true });
  await expect(item).toBeVisible();
  expect(await item.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(44);
  await item.click();
  const dialog = review(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.locator('[data-alpha-email-use-account]')).toHaveText('From owner@example.invalid');
  await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('New reply to sender@example.invalid (Synthetic sender) · Re: Harbour schedule');
  await expect(dialog.locator('[data-alpha-email-use-effect]')).toHaveText('A local draft opens with this text for you to edit.');
  await expect(dialog.getByRole('region', { name: 'Suggested text' })).toHaveText(first);
  await expect(dialog).toContainText('Files and photos are not attached');
  await expect(dialog).toContainText('Nothing is sent');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('use-in-email-review-production.png'), animations: 'disabled' });

  // Escape cancels: no draft exists and the reply keeps focus.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(body(page)).toHaveCount(0);

  // Confirming opens the normal composer for exactly that reply, under the reviewed account.
  await openReview(page, first);
  await review(page).getByRole('button', { name: 'Insert into draft', exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  await expect(body(page)).toHaveValue(first);
  await expect(body(page)).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Re: Harbour schedule');
  await expect(page.locator('.inbox-recipient-chip')).toHaveText(['sender@example.invalid']);
  await page.screenshot({ path: info.outputPath('use-in-email-draft-production.png'), animations: 'disabled' });

  // The draft is kept on this phone only: its text reaches the (stubbed) Keystore store, which is
  // where the account-change test below looks for a draft that must not exist.
  await expect.poll(() => drafts(page, 'Tuesday at 10 works'), { timeout: 20_000 }).not.toEqual([]);
  // Inserting is local: the provider was never asked to prepare or dispatch anything.
  expect(await mail(page)).toEqual({ prepares: [], dispatches: [], sent: [] });
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a draft that changed under the open review is not written to; the refreshed review appends below the user\'s text', async ({ page }) => {
  test.setTimeout(120_000);
  await openEmail(page);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  await openReview(page, first);
  await review(page).getByRole('button', { name: 'Insert into draft', exact: true }).click();
  await expect(body(page)).toHaveValue(first);
  await body(page).fill('My own opening line.');

  await ask(page, 'Add a line about the copies', second);
  await openReview(page, second);
  const dialog = review(page);
  await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('Your open reply draft · Re: Harbour schedule · to sender@example.invalid');
  await expect(dialog.locator('[data-alpha-email-use-effect]')).toHaveText('This draft already has text. The suggestion is added below it; nothing is replaced.');
  // Existing text is never replaced: the only confirmation offered is the append.
  await expect(dialog.getByRole('button', { name: 'Insert into draft', exact: true })).toHaveCount(0);
  const add = dialog.getByRole('button', { name: 'Add below existing text', exact: true });
  await expect(add).toBeVisible();
  // The composer is inert behind the review, so the user cannot type into it. The draft still
  // changes underneath (another edit path, for example dictation that finishes late): the review
  // was made for different text, so the insert is refused.
  expect(await page.locator('textarea[aria-label="Message"]').evaluate(element => !!element.closest('[inert]'))).toBe(true);
  await page.evaluate(() => { const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'My own opening line. Edited again.'); area.dispatchEvent(new Event('input', { bubbles: true })); });
  await add.click();
  await expect(dialog.getByRole('status')).toHaveText('The email or account changed since you opened this review. Check the destination and confirm again. Nothing was added.');
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveValue('My own opening line. Edited again.');
  // The review now describes the current draft; confirming it appends and replaces nothing.
  await add.click();
  await expect(dialog).toHaveCount(0);
  await expect(body(page)).toHaveValue('My own opening line. Edited again.\n\n' + second);
  await expect(page.getByText(/Agent suggestion added below your text\./)).toBeVisible();
  expect(await mail(page)).toEqual({ prepares: [], dispatches: [], sent: [] });
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('the Gmail account changes while the review is open: the insert is refused and no draft is created under either account', async ({ page }) => {
  test.setTimeout(120_000);
  await openEmail(page, [owner, other]);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  await openReview(page, first);
  const dialog = review(page);
  await expect(dialog.locator('[data-alpha-email-use-account]')).toHaveText('From owner@example.invalid');
  await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('New reply to sender@example.invalid (Synthetic sender) · Re: Harbour schedule');

  // While the review is open the phone leaves and returns to the app. In between, access to the
  // reviewed account ended at Eliza Cloud and another account is the connected one. Returning to the
  // app re-checks accounts (the native `appResumed` event), as it does on a phone.
  const before = await harness(page, f => f.mail.accountReads);
  await harness(page, f => { f.mail.accounts[0].connected = false; f.mail.accounts[1].connected = true; f.emit('DailyApps', 'appResumed'); });
  await expect.poll(() => harness(page, f => f.mail.accountReads)).toBeGreaterThan(before);
  // Inbox, inert behind the review, now lists the other account's mail; the reviewed email is gone.
  await expect(page.getByText('Other mailbox note', { exact: true })).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByText('Can you do Tuesday at 10?', { exact: true })).toHaveCount(0);

  // The review still shows what the user approved. Confirming it inserts nothing anywhere.
  await dialog.getByRole('button', { name: 'Insert into draft', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('The email or account changed since you opened this review. Check the destination and confirm again. Nothing was added.');
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveCount(0);
  // The refreshed review names the account and destination a second confirmation would use.
  await expect(dialog.locator('[data-alpha-email-use-account]')).toHaveText('From other@example.invalid');
  await expect(dialog.locator('[data-alpha-email-use-destination]')).toHaveText('A new email. You add the recipients and subject.');
  await expect(dialog.locator('[data-alpha-email-use-destination]')).not.toContainText('sender@example.invalid');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(body(page)).toHaveCount(0);
  // No local draft was stored for either account, and the provider was never asked for anything.
  expect(await drafts(page, 'Tuesday at 10 works')).toEqual([]);
  expect(await mail(page)).toEqual({ prepares: [], dispatches: [], sent: [] });
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('a send review left pending is discarded when a suggestion is added to its email; only the email reviewed afterwards can be sent', async ({ page }) => {
  test.setTimeout(150_000);
  await openEmail(page);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  await openReview(page, first);
  await review(page).getByRole('button', { name: 'Insert into draft', exact: true }).click();
  await expect(body(page)).toHaveValue(first);

  // The user reviews the send, then closes the review without cancelling it: it stays saved.
  await button(page, 'Send email').click();
  const sendReview = page.getByRole('dialog', { name: 'Review mail operation' });
  await expect(sendReview.getByRole('status')).toHaveText('Review every field before confirming. No mail has been sent.');
  await expect(sendReview.getByText(first, { exact: true })).toBeVisible();
  await sendReview.getByRole('button', { name: 'Close mail review', exact: true }).click();
  await expect(sendReview).toHaveCount(0);
  let state = await mail(page);
  expect(state.prepares.map(row => row.bodyText)).toEqual([first]);
  expect(state.dispatches).toEqual([]);

  // A second suggestion is reviewed and added below the text that was reviewed for sending.
  await ask(page, 'Add a line about the copies', second);
  await openReview(page, second);
  await expect(review(page).locator('[data-alpha-email-use-destination]')).toHaveText('Your open reply draft · Re: Harbour schedule · to sender@example.invalid');
  await review(page).getByRole('button', { name: 'Add below existing text', exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  await expect(body(page)).toHaveValue(first + '\n\n' + second);
  // The pending review was for other text: it is discarded, and the user is told nothing was sent.
  await expect(page.getByText('This email was edited after this review, so the review was discarded. Nothing was sent. Review the current email before sending.', { exact: true })).toBeVisible();
  expect((await mail(page)).dispatches).toEqual([]);

  // Sending now means a new review of the current text, under a new request.
  await button(page, 'Send email').click();
  await expect(sendReview.getByText(first + '\n\n' + second, { exact: true })).toBeVisible();
  state = await mail(page);
  expect(state.prepares.map(row => row.bodyText)).toEqual([first, first + '\n\n' + second]);
  expect(state.prepares[1].requestId).not.toBe(state.prepares[0].requestId);
  expect(state.prepares[1].digest).not.toBe(state.prepares[0].digest);
  await sendReview.getByRole('button', { name: 'Send this email', exact: true }).click();
  await expect(sendReview.getByRole('status')).toHaveText('Provider confirmed this operation.');
  state = await mail(page);
  // One dispatch, of the second request and digest. The first reviewed request was never dispatched.
  expect(state.dispatches).toEqual([state.prepares[1]]);
  expect(state.sent).toEqual(['Re: Harbour schedule | ' + first + '\n\n' + second]);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
});

test('outside Inbox the same agent reply offers no email action', async ({ page }) => {
  test.setTimeout(120_000);
  await openEmail(page);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  await bubble(page, first).click();
  await expect(page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Use in email', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await button(page, 'Notes').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  await button(page, 'Open conversation').click();
  await bubble(page, first).click();
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Use in email', exact: true })).toHaveCount(0);
  expect(await mail(page)).toEqual({ prepares: [], dispatches: [], sent: [] });
});

test('reopening the conversation in another view retires the earlier close animation', async ({ page }) => {
  await openEmail(page);
  await ask(page, 'Draft a short reply accepting Tuesday', first);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  // Keep the closing animation pending while the owner navigates and opens the
  // conversation from the other view's pill. Keyboard activation needs no settled animation.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await button(page, 'Notes').press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  await button(page, 'Open conversation').press('Enter');
  await page.clock.runFor(1_000);
  const panel = page.locator('[data-alpha-layer="conversation"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel).toHaveCSS('opacity', '1');
  await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(200);
  await bubble(page, first).click();
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Use in email', exact: true })).toHaveCount(0);
  expect(await mail(page)).toEqual({ prepares: [], dispatches: [], sent: [] });
});
