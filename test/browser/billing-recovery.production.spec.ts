// Subscription on the flag-off Android renderer: an unfunded account, a Cloud billing refusal in the
// middle of use, a membership code (accepted, and refused as invalid or expired), and the send that
// follows plan activation or a redeemed code. Nothing is resent, purchased or redeemed automatically.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The Capacitor bridge is
// the stub in flag-off-android.ts plus resident-stub.ts; Cloud answers are synthetic copies of the
// deployed shapes (billing snapshot v2, subscription redeem, the agent's `done` frame for a Cloud
// 402). It is not the native Agent plugin, the resident runtime, Eliza Cloud or a device.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, seedCompletedAccessSetup } from './flag-off-android';
import { residentStub, stub, setStub, type StubAccount } from './resident-stub';

const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
// Synthetic, never a real grant code: 16 Crockford characters once normalized.
const CODE = 'synt-hetc-0de0-0001', NORMALIZED = 'SYNTHETC0DE00001';
const NEEDED = 'Choose a plan or enter a membership code to ask Alpha.';
const REFUSED = 'Billing declined';
const SHEET_REFUSED = 'Billing declined';
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Account', exact: true });
const controls = (page: Page) => sheet(page).getByRole('region', { name: 'Balance and membership', exact: true });
async function send(page: Page, text: string) { await composer(page).fill(text); await composer(page).press('Enter'); }
async function shot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath(name), animations: 'disabled' });
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
  await expect(controls(page)).toContainText('$0.00');
  return foreign;
}
const configured = (page: Page) => stub(page, s => s.order.filter((entry: string) => entry.startsWith('configureCloudProvider')).length);

test('an account without a subscription is told why nothing was sent and gets the one Subscription popup back', async ({ page }, info) => {
  test.setTimeout(120_000);
  const foreign = await zeroAccount(page);
  await expect(controls(page).getByText('No plan', { exact: true })).toBeVisible();
  await expect(controls(page).getByRole('status').filter({ hasText: NEEDED })).toHaveCount(0);
  await expect(controls(page).getByRole('button', { name: 'Choose a plan', exact: true })).toBeVisible();
  await expect(controls(page).getByRole('button', { name: 'Use code', exact: true })).toBeVisible();
  await expect(page.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '01-zero-balance-sheet.png');
  await sheet(page).getByRole('button', { name: 'Close Account', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await send(page, 'Hello with no credits');
  // The Account popup explains the refusal; keep the draft without adding a duplicate notice.
  await expect(page.getByText('Not sent. ' + NEEDED, { exact: true })).toHaveCount(0);
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
  await controls(page).getByRole('button', { name: 'Use code', exact: true }).click();
  const field = controls(page).getByRole('textbox', { name: 'Membership code' });
  await expect(field).toBeFocused();
  await field.fill(CODE);
  await controls(page).getByRole('button', { name: 'Redeem', exact: true }).click();
  // Cloud gives unknown, expired, disabled and used-up codes one answer (400 invalid_subscription_code).
  await expect(controls(page).getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  await expect(field).toHaveValue(CODE);
  await expect(controls(page)).toContainText('$0.00');
  await expect(controls(page).getByText('No plan', { exact: true })).toBeVisible();
  await shot(page, info, '03-code-invalid-or-expired.png');
  expect(await stub(page, s => s.redeemed.map((row: { code: string }) => row.code))).toEqual([NORMALIZED]);
  expect(await configured(page)).toBe(before);
  expect(foreign).toEqual([]);
});

test('a membership code works instead of credits: redeemed, AI rebinds and the next send replies without reload or sign-in', async ({ page }, info) => {
  test.setTimeout(150_000);
  const foreign = await zeroAccount(page);
  await page.evaluate(() => { (window as any).sameDocument = true; });
  await controls(page).getByRole('button', { name: 'Use code', exact: true }).click();
  await controls(page).getByRole('textbox', { name: 'Membership code' }).fill(CODE);
  await controls(page).getByRole('button', { name: 'Redeem', exact: true }).click();
  // The plan is now the membership; the account panel shows the outcome beside the running agent.
  const plan = page.getByRole('dialog', { name: 'Account', exact: true });
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByText(/^Code redeemed for Plus\. It runs until /)).toBeVisible();
  await expect(plan.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '04-code-redeemed.png');
  const redeemed = await stub(page, s => s.redeemed);
  expect(redeemed.map((row: { code: string }) => row.code)).toEqual([NORMALIZED]);
  expect(redeemed[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await plan.getByRole('button', { name: 'Close Account', exact: true }).click();
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
  await controls(page).getByRole('button', { name: 'Choose a plan', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review billing account', exact: true })).toHaveCount(0);
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
  await expect(controls(page)).toContainText('$0.02');
  expect(await stub(page, s => s.accounts[0].balance)).toBe(0.02);
  await expect(controls(page).getByRole('button', { name: 'Choose a plan', exact: true })).toBeVisible();
  await expect(controls(page).getByRole('button', { name: 'Use code', exact: true })).toBeVisible();
  await expect(page.getByText(/AI is off/)).toHaveCount(0);
  await shot(page, info, '07-midturn-refusal-popup.png');
  await sheet(page).getByRole('button', { name: 'Close Account', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  // One answer in the chat: the agent's provider prose and a second billing message never appear.
  await button(page, 'Expand chat').click();
  await expect(conversation(page).getByText(REFUSED, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/configured AI provider is out of credits|billing needs attention|Manage billing in/)).toHaveCount(0);
  await expect(bubble(page, 'What is on my calendar this week?')).toHaveCount(1);
  const offer = page.getByRole('button', { name: /^Subscription/ });
  await expect(offer).toHaveCount(1);
  // Unrelated transient toasts settle before the screenshot; a long one stays up to 10 s.
  await expect(page.locator('[data-alpha-toast] .drop')).toHaveCount(0, { timeout: 11_000 });
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
  await controls(page).getByRole('button', { name: 'Refresh account', exact: true }).click();
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
  await expect(controls(page)).toContainText('$0.00');
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

test('an unchanged active subscription does not clear a Cloud billing refusal', async ({ page }) => {
  const foreign = await boot(page, { plan: undefined, balance: 0 });
  await residentHome(page);
  await setStub(page, { stream: { failure: 'insufficient_credits', frame: 'done', runtime: true } });
  await send(page, 'Check my account');
  await expect(sheet(page)).toBeVisible();
  await expect(controls(page).getByText('Plus', { exact: true })).toBeVisible();
  const reads = () => stub(page, s => s.cloud.filter((r: { path: string }) => r.path === '/api/v1/billing/limits').length);
  const before = await reads();
  await controls(page).getByRole('button', { name: 'Refresh account', exact: true }).click();
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(controls(page).getByRole('status').filter({ hasText: SHEET_REFUSED })).toHaveCount(1);
  await expect(sheet(page)).toBeVisible();
  expect(await harness(page, f => f.streams)).toBe(1);
  expect(await stub(page, s => s.opened)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('refused turns retain their answers and defer plan checks until the owner returns', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await boot(page, { plan: undefined, balance: 0 });
  await residentHome(page);
  const reads = () => stub(page, s => s.cloud.filter((r: { path: string }) => r.path === '/api/v1/subscription/entitlement').length);
  const stops = () => stub(page, s => s.order.filter((entry: string) => entry === 'Agent.stop').length);
  const before = await reads(), stopped = await stops(), bound = await configured(page);
  // The agent's stream for a Cloud 402 subscription_required that ends the turn before any text.
  await setStub(page, { stream: { failure: 'subscription_required', frame: 'done', runtime: true } });
  await send(page, 'What is on my calendar this week?');
  await expect.poll(() => harness(page, f => f.streams)).toBe(1);
  await button(page, 'Expand chat').click();
  // Both terminal refusals stay visible. No plan read may interrupt or replace either reply.
  await expect(conversation(page).getByText('Plan needed', { exact: true })).toHaveCount(1, { timeout: 30_000 });
  expect(await reads()).toBe(before);
  // A second refusal is also held until the owner returns.
  await send(page, 'Try my calendar again');
  await expect(conversation(page).getByText('Plan needed', { exact: true })).toHaveCount(2, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  expect(await reads()).toBe(before);
  // On return, account display and provider admission each read their own authority.
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect.poll(reads).toBe(before + 2);
  // A second foreground event refreshes the account display, but the plan check is throttled.
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect.poll(reads).toBe(before + 3);
  await page.waitForTimeout(1000);
  expect(await reads()).toBe(before + 3);
  // The return checks did not stop or rebind the running agent; nothing was retried or opened.
  expect(await stops()).toBe(stopped);
  expect(await configured(page)).toBe(bound);
  expect(await harness(page, f => f.streams)).toBe(2);
  expect(await stub(page, s => s.recoveries)).toEqual([]);
  expect(await stub(page, s => s.opened)).toEqual([]);
  expect(foreign).toEqual([]);
});
