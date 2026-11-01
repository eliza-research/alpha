// Subscription on the flag-off Android renderer: an unfunded account, a Cloud billing refusal in the
// middle of use, a membership code (accepted, and refused as invalid or expired), and the send that
// follows plan activation or a redeemed code. Nothing is resent, purchased or redeemed automatically.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The Capacitor bridge is
// the stub in flag-off-android.ts plus resident-stub.ts; Cloud answers are synthetic copies of the
// deployed shapes (billing snapshot v2, subscription redeem, the agent's `done` frame for a Cloud
// 402). It is not the native Agent plugin, the resident runtime, Eliza Cloud or a device.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, seedCompletedAccessSetup } from './flag-off-android';
import { residentStub, stub, setStub, type StubAccount } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
// Synthetic, never a real grant code: 16 Crockford characters once normalized.
const CODE = 'synt-hetc-0de0-0001', NORMALIZED = 'SYNTHETC0DE00001';
const NEEDED = 'Choose a monthly plan or enter a membership code to ask Alpha.';
const REFUSED = 'Eliza Cloud declined this AI request for your account’s billing. Check your subscription or enter a membership code, then send again. Nothing was retried or purchased.';
const SHEET_REFUSED = 'Eliza Cloud declined your last AI request for billing. Check your subscription or enter a membership code, then send again.';
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Subscription', exact: true });
const controls = (page: Page) => sheet(page).getByRole('region', { name: 'Subscription', exact: true });
async function send(page: Page, text: string) { await composer(page).fill(text); await composer(page).press('Enter'); }
/** Screenshots go to ALPHA_BILLING_SHOTS when set (the QA folder), otherwise beside the test result. */
async function shot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: process.env.ALPHA_BILLING_SHOTS ? join(process.env.ALPHA_BILLING_SHOTS, name) : info.outputPath(name), animations: 'disabled' });
}
async function boot(page: Page, account: Partial<StubAccount>) {
  const foreign = await fenceNetwork(page);
  await seedCompletedAccessSetup(page);
  await flagOffAndroid(page);
  await residentStub(page, { accounts: [{ token: 'synthetic-cloud-key', userId: id, email: 'owner@example.invalid', balance: 0, plan: 'credits', ...account }] });
  return foreign;
}
/** A new Eliza Cloud account: organization-credit mode at $0.00 and no membership. */
async function zeroAccount(page: Page) {
  const foreign = await boot(page, { balance: 0 });
  await page.goto('/');
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(sheet(page)).toBeVisible({ timeout: 30_000 });
  await expect(controls(page)).not.toContainText(/Available credits|Add credits|\$\d/);
  return foreign;
}
const configured = (page: Page) => stub(page, s => s.order.filter((entry: string) => entry.startsWith('configureCloudProvider')).length);

test('an account without a subscription is told why nothing was sent and gets the one Subscription popup back', async ({ page }, info) => {
  test.setTimeout(120_000);
  const foreign = await zeroAccount(page);
  await expect(controls(page).getByText('No active subscription', { exact: true })).toBeVisible();
  await expect(controls(page).getByRole('status').filter({ hasText: NEEDED })).toHaveCount(1);
  await expect(controls(page).getByRole('button', { name: 'Choose a monthly plan', exact: true })).toBeVisible();
  await expect(controls(page).getByRole('button', { name: 'Enter membership code', exact: true })).toBeVisible();
  await expect(page.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '01-zero-balance-sheet.png');
  await sheet(page).getByRole('button', { name: 'Close membership settings', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await send(page, 'Hello with no credits');
  // The reason is said in the composer's notice, the draft is kept, and the same popup returns.
  await expect(page.getByText('Not sent. ' + NEEDED, { exact: true }).first()).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  await expect(composer(page)).toHaveValue('Hello with no credits');
  await shot(page, info, '02-zero-balance-send-refused.png');
  expect(await harness(page, f => ({ streams: f.streams, posts: f.posts.length }))).toEqual({ streams: 0, posts: 0 });
  expect(await stub(page, s => s.opened)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('an invalid or expired membership code is refused in the popup and changes nothing', async ({ page }, info) => {
  test.setTimeout(120_000);
  const foreign = await zeroAccount(page);
  await setStub(page, { redeem: 'invalid' });
  const before = await configured(page);
  await controls(page).getByRole('button', { name: 'Enter membership code', exact: true }).click();
  const field = controls(page).getByRole('textbox', { name: 'Membership code' });
  await expect(field).toBeFocused();
  await field.fill(CODE);
  await controls(page).getByRole('button', { name: 'Redeem', exact: true }).click();
  // Cloud gives unknown, expired, disabled and used-up codes one answer (400 invalid_subscription_code).
  await expect(controls(page).getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  await expect(field).toHaveValue(CODE);
  await expect(controls(page)).not.toContainText(/Available credits|Add credits|\$\d/);
  await expect(controls(page).getByText('No active subscription', { exact: true })).toBeVisible();
  await shot(page, info, '03-code-invalid-or-expired.png');
  expect(await stub(page, s => s.redeemed.map((row: { code: string }) => row.code))).toEqual([NORMALIZED]);
  expect(await configured(page)).toBe(before);
  expect(foreign).toEqual([]);
});

test('a membership code works instead of credits: redeemed, AI rebinds and the next send replies without reload or sign-in', async ({ page }, info) => {
  test.setTimeout(150_000);
  const foreign = await zeroAccount(page);
  await page.evaluate(() => { (window as any).sameDocument = true; });
  await controls(page).getByRole('button', { name: 'Enter membership code', exact: true }).click();
  await controls(page).getByRole('textbox', { name: 'Membership code' }).fill(CODE);
  await controls(page).getByRole('button', { name: 'Redeem', exact: true }).click();
  // The plan is now the membership; the account panel shows the outcome beside the running agent.
  const plan = page.getByRole('dialog', { name: 'Eliza Cloud account & plan', exact: true });
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByText(/^Code redeemed for Plus\. It runs until /)).toBeVisible();
  await expect(plan.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '04-code-redeemed.png');
  const redeemed = await stub(page, s => s.redeemed);
  expect(redeemed.map((row: { code: string }) => row.code)).toEqual([NORMALIZED]);
  expect(redeemed[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await plan.getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  await send(page, 'Hello after redeeming');
  await expect(bubble(page, 'Hello after redeeming')).toHaveCount(1);
  await expect(conversation(page).getByText(/^Resident reply \d+$/)).toHaveCount(1, { timeout: 30_000 });
  await shot(page, info, '05-reply-after-code.png');
  expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
  await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
  expect(await harness(page, f => f.posts)).toEqual(['Hello after redeeming']);
  expect(await stub(page, s => s.opened)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a plan activated in Cloud billing closes the subscription popup on return and the next send replies', async ({ page }, info) => {
  test.setTimeout(150_000);
  const foreign = await zeroAccount(page);
  await page.evaluate(() => { (window as any).sameDocument = true; });
  // Plan selection opens Cloud's billing page only after the account check; nothing is bought here.
  await controls(page).getByRole('button', { name: 'Choose a monthly plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check the billing account', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’ll check the account before paying.', exact: true }).check();
  await page.getByRole('button', { name: 'Open billing', exact: true }).click();
  await expect.poll(() => stub(page, s => s.opened)).toEqual(['https://cloud.eliza.app/cloud/billing']);
  // The synthetic Cloud answer now reports an active plan, with the cash balance still zero.
  await stub(page, s => { s.accounts[0].plan = undefined; s.persist(); });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(sheet(page)).toHaveCount(0, { timeout: 30_000 });
  await send(page, 'Hello after choosing a plan');
  await expect(conversation(page).getByText(/^Resident reply \d+$/)).toHaveCount(1, { timeout: 30_000 });
  await shot(page, info, '06-reply-after-plan-activation.png');
  expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
  expect(await harness(page, f => f.posts)).toEqual(['Hello after choosing a plan']);
  expect(await stub(page, s => s.accounts[0].balance)).toBe(0);
  expect(foreign).toEqual([]);
});

test('Cloud declining a turn mid-use gives one answer and the popup; after plan activation the same chat replies', async ({ page }, info) => {
  test.setTimeout(150_000);
  // A low positive balance with no membership: the client admits it and Cloud decides per request.
  const foreign = await boot(page, { balance: 0.02 });
  await residentHome(page);
  // The agent's stream for a Cloud 402 that ends the turn before any text (conversation-routes.ts).
  await setStub(page, { stream: { failure: 'insufficient_credits', frame: 'done', runtime: true } });
  await send(page, 'What is on my calendar this week?');
  await expect(sheet(page)).toBeVisible({ timeout: 30_000 });
  await expect(controls(page).getByRole('status').filter({ hasText: SHEET_REFUSED })).toHaveCount(1);
  await expect(controls(page)).not.toContainText(/Available credits|Add credits|\$\d/);
  await expect(controls(page).getByRole('button', { name: 'Choose a monthly plan', exact: true })).toBeVisible();
  await expect(controls(page).getByRole('button', { name: 'Enter membership code', exact: true })).toBeVisible();
  await expect(page.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '07-midturn-refusal-popup.png');
  await sheet(page).getByRole('button', { name: 'Close membership settings', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  // One answer in the chat: the agent's provider prose and a second billing message never appear.
  await button(page, 'Expand chat').click();
  await expect(conversation(page).getByText(REFUSED, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/configured AI provider is out of credits|billing needs attention|Manage billing in/)).toHaveCount(0);
  await expect(bubble(page, 'What is on my calendar this week?')).toHaveCount(1);
  const offer = page.getByRole('button', { name: /^Check subscription or enter a membership code/ });
  await expect(offer).toHaveCount(1);
  await page.waitForTimeout(2000); // unrelated transient toasts settle before the screenshot
  await shot(page, info, '08-midturn-refusal-chat.png');
  await offer.click();
  await expect(sheet(page)).toBeVisible();
  // Nothing was retried, opened or bought.
  await page.waitForTimeout(1000);
  expect(await harness(page, f => f.streams)).toBe(1);
  expect(await stub(page, s => s.recoveries)).toEqual([]);
  expect(await stub(page, s => s.opened)).toEqual([]);
  // An active plan ends the refusal without changing the underlying legacy cash balance.
  await stub(page, s => { s.accounts[0].plan = undefined; s.stream = null; s.persist(); });
  await controls(page).getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0, { timeout: 30_000 });
  await send(page, 'Try my calendar again');
  await expect(conversation(page).getByText(/^Resident reply \d+$/)).toHaveCount(1, { timeout: 30_000 });
  await shot(page, info, '09-reply-after-plan-activation.png');
  expect(await harness(page, f => f.streams)).toBe(2);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('a refusal at zero balance ends when the owner returns from Cloud billing with a subscription', async ({ page }, info) => {
  test.setTimeout(150_000);
  const foreign = await boot(page, { balance: 0.02 });
  await residentHome(page);
  // The last request spent the balance: Cloud declines this turn and now reports $0.00.
  await setStub(page, { stream: { failure: 'insufficient_credits', frame: 'done', runtime: true } });
  await stub(page, s => { s.accounts[0].balance = 0; s.persist(); });
  await send(page, 'What is on my calendar this week?');
  await expect(sheet(page)).toBeVisible({ timeout: 30_000 });
  await expect(controls(page).getByRole('status').filter({ hasText: SHEET_REFUSED })).toHaveCount(1);
  await expect(controls(page)).not.toContainText(/Available credits|Add credits|\$\d/);
  await shot(page, info, '10-refusal-at-zero-popup.png');
  // The synthetic plan becomes active and the owner returns: no Refresh tap or cash top-up.
  await stub(page, s => { s.accounts[0].plan = undefined; s.stream = null; s.persist(); });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(sheet(page)).toHaveCount(0, { timeout: 30_000 });
  await send(page, 'Try my calendar again');
  await expect(conversation(page).getByText(/^Resident reply \d+$/)).toHaveCount(1, { timeout: 30_000 });
  await shot(page, info, '11-reply-after-return-from-billing.png');
  expect(await harness(page, f => f.streams)).toBe(2);
  expect(await stub(page, s => s.opened)).toEqual([]);
  expect(foreign).toEqual([]);
});
